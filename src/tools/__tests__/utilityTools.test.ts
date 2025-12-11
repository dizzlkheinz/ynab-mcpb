import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ynab from 'ynab';
import { handleGetUser, handleConvertAmount, ConvertAmountSchema } from '../utilityTools.js';

// Mock the YNAB API
const mockYnabAPI = {
  user: {
    getUser: vi.fn(),
  },
} as unknown as ynab.API;

describe('Utility Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleGetUser', () => {
    it('should return user information successfully', async () => {
      const mockUser = {
        id: 'user-123',
      };

      const mockResponse = {
        data: {
          user: mockUser,
        },
      };

      (mockYnabAPI.user.getUser as any).mockResolvedValue(mockResponse);

      const result = await handleGetUser(mockYnabAPI);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.user).toBeDefined();
      expect(parsed.user.id).toBe('user-123');
      expect(mockYnabAPI.user.getUser).toHaveBeenCalledTimes(1);
    });

    it('should handle 401 authentication errors', async () => {
      const error = new Error('401 Unauthorized');
      (mockYnabAPI.user.getUser as any).mockRejectedValue(error);

      const result = await handleGetUser(mockYnabAPI);

      expect(result.content[0].text).toContain('Invalid or expired YNAB access token');
    });

    it('should handle 403 authorization errors', async () => {
      const error = new Error('403 Forbidden');
      (mockYnabAPI.user.getUser as any).mockRejectedValue(error);

      const result = await handleGetUser(mockYnabAPI);

      expect(result.content[0].text).toContain('Insufficient permissions to access YNAB data');
    });

    it('should handle 429 rate limiting errors', async () => {
      const error = new Error('429 Too Many Requests');
      (mockYnabAPI.user.getUser as any).mockRejectedValue(error);

      const result = await handleGetUser(mockYnabAPI);

      expect(result.content[0].text).toContain('Rate limit exceeded. Please try again later');
    });

    it('should handle 500 server errors', async () => {
      const error = new Error('500 Internal Server Error');
      (mockYnabAPI.user.getUser as any).mockRejectedValue(error);

      const result = await handleGetUser(mockYnabAPI);

      expect(result.content[0].text).toContain('YNAB service is currently unavailable');
    });

    it('should handle generic errors', async () => {
      const error = new Error('Network error');
      (mockYnabAPI.user.getUser as any).mockRejectedValue(error);

      const result = await handleGetUser(mockYnabAPI);

      expect(result.content[0].text).toContain('Failed to get user information');
    });
  });

  describe('handleConvertAmount', () => {
    it('should convert dollars to milliunits correctly', async () => {
      const params = { amount: 10.5, to_milliunits: true };

      const result = await handleConvertAmount(mockYnabAPI, params);
      const response = JSON.parse(result.content[0].text);

      expect(response.conversion.original_amount).toBe(10.5);
      expect(response.conversion.converted_amount).toBe(10500);
      expect(response.conversion.to_milliunits).toBe(true);
      expect(response.conversion.description).toBe('$10.50 = 10500 milliunits');
    });

    it('should convert milliunits to dollars correctly', async () => {
      const params = { amount: 10500, to_milliunits: false };

      const result = await handleConvertAmount(mockYnabAPI, params);
      const response = JSON.parse(result.content[0].text);

      expect(response.conversion.original_amount).toBe(10500);
      expect(response.conversion.converted_amount).toBe(10.5);
      expect(response.conversion.to_milliunits).toBe(false);
      expect(response.conversion.description).toBe('10500 milliunits = $10.50');
    });

    it('should handle zero amounts', async () => {
      const params = { amount: 0, to_milliunits: true };

      const result = await handleConvertAmount(mockYnabAPI, params);
      const response = JSON.parse(result.content[0].text);

      expect(response.conversion.original_amount).toBe(0);
      expect(response.conversion.converted_amount).toBe(0);
      expect(response.conversion.description).toBe('$0.00 = 0 milliunits');
    });

    it('should handle negative amounts', async () => {
      const params = { amount: -5.25, to_milliunits: true };

      const result = await handleConvertAmount(mockYnabAPI, params);
      const response = JSON.parse(result.content[0].text);

      expect(response.conversion.original_amount).toBe(-5.25);
      expect(response.conversion.converted_amount).toBe(-5250);
      expect(response.conversion.description).toBe('$-5.25 = -5250 milliunits');
    });

    it('should handle floating-point precision correctly', async () => {
      const params = { amount: 0.01, to_milliunits: true };

      const result = await handleConvertAmount(mockYnabAPI, params);
      const response = JSON.parse(result.content[0].text);

      expect(response.conversion.converted_amount).toBe(10);
    });

    it('should handle large amounts', async () => {
      const params = { amount: 999999.99, to_milliunits: true };

      const result = await handleConvertAmount(mockYnabAPI, params);
      const response = JSON.parse(result.content[0].text);

      expect(response.conversion.converted_amount).toBe(999999990);
    });

    it('should round to nearest milliunit when converting from dollars', async () => {
      const params = { amount: 10.5555, to_milliunits: true };

      const result = await handleConvertAmount(mockYnabAPI, params);
      const response = JSON.parse(result.content[0].text);

      expect(response.conversion.converted_amount).toBe(10556); // Rounded from 10555.5
    });
  });

  describe('ConvertAmountSchema validation', () => {
    it('should validate correct parameters', () => {
      const validParams = { amount: 10.5, to_milliunits: true };
      const result = ConvertAmountSchema.safeParse(validParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validParams);
      }
    });

    it('should reject non-finite numbers', () => {
      const invalidParams = { amount: Infinity, to_milliunits: true };
      const result = ConvertAmountSchema.safeParse(invalidParams);

      expect(result.success).toBe(false);
    });

    it('should reject NaN values', () => {
      const invalidParams = { amount: NaN, to_milliunits: true };
      const result = ConvertAmountSchema.safeParse(invalidParams);

      expect(result.success).toBe(false);
    });

    it('should reject missing amount parameter', () => {
      const invalidParams = { to_milliunits: true };
      const result = ConvertAmountSchema.safeParse(invalidParams);

      expect(result.success).toBe(false);
    });

    it('should reject missing to_milliunits parameter', () => {
      const invalidParams = { amount: 10.5 };
      const result = ConvertAmountSchema.safeParse(invalidParams);

      expect(result.success).toBe(false);
    });

    it('should reject non-boolean to_milliunits parameter', () => {
      const invalidParams = { amount: 10.5, to_milliunits: 'true' };
      const result = ConvertAmountSchema.safeParse(invalidParams);

      expect(result.success).toBe(false);
    });
  });
});
