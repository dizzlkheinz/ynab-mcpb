import {
  ErrorHandler,
  YNABErrorCode,
  YNABAPIError,
  ValidationError,
  createErrorHandler,
} from '../../server/errorHandler';
import { responseFormatter } from '../../server/responseFormatter';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListBudgets } from '../../tools/budgetTools';
import { handleListAccounts } from '../../tools/accountTools';
import { handleListTransactions } from '../../tools/transactionTools';
import { handleListCategories } from '../../tools/categoryTools';
import { handleListPayees } from '../../tools/payeeTools';
import { handleListMonths } from '../../tools/monthTools';
import { handleGetUser } from '../../tools/utilityTools';

// Mock the YNAB API
vi.mock('ynab');

describe('Error Handler Integration Tests', () => {
  let mockYnabAPI: any;

  beforeEach(() => {
    mockYnabAPI = {
      budgets: {
        getBudgets: vi.fn(),
      },
      accounts: {
        getAccounts: vi.fn(),
      },
      transactions: {
        getTransactions: vi.fn(),
      },
      categories: {
        getCategories: vi.fn(),
      },
      payees: {
        getPayees: vi.fn(),
      },
      months: {
        getBudgetMonths: vi.fn(),
      },
      user: {
        getUser: vi.fn(),
      },
    };
  });

  describe('401 Unauthorized Errors', () => {
    it('should handle 401 errors in budget tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('Request failed with status 401 Unauthorized');
      mockYnabAPI.budgets.getBudgets.mockRejectedValue(error);

      const result = await handleListBudgets(mockYnabAPI);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe(401);
      expect(parsed.error.message).toContain('Invalid or expired YNAB access token');
    });

    it('should handle 401 errors in account tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('401 - Unauthorized access');
      mockYnabAPI.accounts.getAccounts.mockRejectedValue(error);

      const result = await handleListAccounts(mockYnabAPI, { budget_id: 'test-budget' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe(401);
      expect(parsed.error.message).toContain('Invalid or expired YNAB access token');
    });

    it('should handle 401 errors in transaction tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('Unauthorized - 401');
      mockYnabAPI.transactions.getTransactions.mockRejectedValue(error);

      const result = await handleListTransactions(mockYnabAPI, { budget_id: 'test-budget' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe(401);
      expect(parsed.error.message).toContain('Invalid or expired YNAB access token');
    });
  });

  describe('403 Forbidden Errors', () => {
    it('should handle 403 errors in category tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('403 Forbidden - insufficient permissions');
      mockYnabAPI.categories.getCategories.mockRejectedValue(error);

      const result = await handleListCategories(mockYnabAPI, { budget_id: 'test-budget' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe(403);
      expect(parsed.error.message).toContain('Insufficient permissions');
    });

    it('should handle 403 errors in payee tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('Request forbidden: 403');
      mockYnabAPI.payees.getPayees.mockRejectedValue(error);

      const result = await handleListPayees(mockYnabAPI, { budget_id: 'test-budget' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe(403);
      expect(parsed.error.message).toContain('Insufficient permissions');
    });
  });

  describe('404 Not Found Errors', () => {
    it('should handle 404 errors in month tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('Budget not found - 404');
      mockYnabAPI.months.getBudgetMonths.mockRejectedValue(error);

      const result = await handleListMonths(mockYnabAPI, { budget_id: 'invalid-budget' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe(404);
      expect(parsed.error.message).toContain('Budget or month not found');
    });
  });

  describe('429 Rate Limit Errors', () => {
    it('should handle 429 errors in utility tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('Too many requests - 429');
      mockYnabAPI.user.getUser.mockRejectedValue(error);

      const result = await handleGetUser(mockYnabAPI);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe(429);
      expect(parsed.error.message).toContain('Rate limit exceeded');
    });
  });

  describe('500 Internal Server Errors', () => {
    it('should handle 500 errors consistently across tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('Internal server error - 500');
      mockYnabAPI.budgets.getBudgets.mockRejectedValue(error);

      const result = await handleListBudgets(mockYnabAPI);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe(500);
      expect(parsed.error.message).toContain('YNAB service is currently unavailable');
    });
  });

  describe('Network and Connection Errors', () => {
    it('should handle network timeout errors', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('Network timeout');
      mockYnabAPI.budgets.getBudgets.mockRejectedValue(error);

      const result = await handleListBudgets(mockYnabAPI);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe('UNKNOWN_ERROR');
      expect(parsed.error.message).toContain('Failed to list budgets');
    });

    it('should handle connection refused errors', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('ECONNREFUSED: Connection refused');
      mockYnabAPI.accounts.getAccounts.mockRejectedValue(error);

      const result = await handleListAccounts(mockYnabAPI, { budget_id: 'test-budget' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.error.code).toBe('UNKNOWN_ERROR');
      expect(parsed.error.message).toContain('Failed to list accounts');
    });
  });

  describe('Error Response Structure', () => {
    it('should maintain consistent error response structure across all tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const error = new Error('Test error');
      const tools = [
        () => handleListBudgets(mockYnabAPI),
        () => handleListAccounts(mockYnabAPI, { budget_id: 'test' }),
        () => handleListTransactions(mockYnabAPI, { budget_id: 'test' }),
        () => handleListCategories(mockYnabAPI, { budget_id: 'test' }),
        () => handleListPayees(mockYnabAPI, { budget_id: 'test' }),
        () => handleListMonths(mockYnabAPI, { budget_id: 'test' }),
        () => handleGetUser(mockYnabAPI),
      ];

      // Mock all API calls to reject
      mockYnabAPI.budgets.getBudgets.mockRejectedValue(error);
      mockYnabAPI.accounts.getAccounts.mockRejectedValue(error);
      mockYnabAPI.transactions.getTransactions.mockRejectedValue(error);
      mockYnabAPI.categories.getCategories.mockRejectedValue(error);
      mockYnabAPI.payees.getPayees.mockRejectedValue(error);
      mockYnabAPI.months.getBudgetMonths.mockRejectedValue(error);
      mockYnabAPI.user.getUser.mockRejectedValue(error);

      for (const tool of tools) {
        const result = await tool();

        expect(result).toHaveProperty('content');
        expect(result.content).toHaveLength(1);
        expect(result.content[0]).toHaveProperty('type', 'text');

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveProperty('error');
        expect(parsed.error).toHaveProperty('code');
        expect(parsed.error).toHaveProperty('message');
      }
    });
  });

  describe('Sensitive Data Sanitization', () => {
    it('should sanitize sensitive data in error messages across all tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      // Create a YNABAPIError with sensitive data in the original error
      const originalError = new Error(
        'Authentication failed with token: abc123xyz and key: secret456',
      );
      const ynabError = ErrorHandler.createYNABError(
        YNABErrorCode.UNAUTHORIZED,
        'Test error',
        originalError,
      );
      mockYnabAPI.budgets.getBudgets.mockRejectedValue(ynabError);

      const result = await handleListBudgets(mockYnabAPI);
      const parsed = JSON.parse(result.content[0].text);

      // Should not contain the actual sensitive values
      expect(result.content[0].text).not.toContain('abc123xyz');
      expect(result.content[0].text).not.toContain('secret456');

      // Should contain sanitized versions if details are present
      if (parsed.error.details) {
        expect(parsed.error.details).toContain('token=***');
        expect(parsed.error.details).toContain('key=***');
      }
    });
  });

  describe('ErrorHandler with real ResponseFormatter', () => {
    it('should format errors using real responseFormatter', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const errorHandler = createErrorHandler(responseFormatter);

      const error = new YNABAPIError(YNABErrorCode.UNAUTHORIZED, 'Test error');
      const result = errorHandler.handleError(error, 'testing');

      // Should produce properly formatted JSON
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe(401);
    });

    it('should work with ValidationError', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const errorHandler = createErrorHandler(responseFormatter);

      const error = new ValidationError('Test validation error', 'Invalid input');
      const result = errorHandler.handleError(error, 'testing');

      // Should produce properly formatted JSON
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toBe('Test validation error');
      expect(parsed.error.details).toBe('Invalid input');
    });
  });

  describe('Minify override integration', () => {
    it('should respect responseFormatter minify settings', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const errorHandler = createErrorHandler(responseFormatter);

      // Test with minify override
      const result = responseFormatter.runWithMinifyOverride(true, () => {
        const error = new ValidationError('Test error');
        return errorHandler.handleError(error, 'testing');
      });

      // Should be minified (no extra whitespace)
      expect(result.content[0].text).not.toContain('\n  ');
    });

    it('should handle pretty formatting', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const errorHandler = createErrorHandler(responseFormatter);

      // Test with pretty formatting
      const result = responseFormatter.runWithMinifyOverride(false, () => {
        const error = new ValidationError('Test error');
        return errorHandler.handleError(error, 'testing');
      });

      // Should contain newlines for pretty formatting
      const text = result.content[0].text;
      expect(text).toMatch(/[\r\n]/);
      // Pretty text should be longer than its compact form
      const compact = JSON.stringify(JSON.parse(text));
      expect(text.length).toBeGreaterThan(compact.length);
      expect(() => JSON.parse(text)).not.toThrow();
    });
  });

  describe('Static vs instance consistency', () => {
    beforeEach(() => {
      // Set up static ErrorHandler with same formatter
      ErrorHandler.setFormatter(responseFormatter);
    });

    it('should produce identical results for static and instance calls', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const errorHandler = createErrorHandler(responseFormatter);

      const error = new YNABAPIError(YNABErrorCode.NOT_FOUND, 'Test error');

      const staticResult = ErrorHandler.handleError(error, 'testing');
      const instanceResult = errorHandler.handleError(error, 'testing');

      expect(staticResult).toEqual(instanceResult);
    });

    it('should produce identical results for createValidationError', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const errorHandler = createErrorHandler(responseFormatter);

      const staticResult = ErrorHandler.createValidationError('Test error', 'Details');
      const instanceResult = errorHandler.createValidationError('Test error', 'Details');

      expect(staticResult).toEqual(instanceResult);
    });
  });

  describe('Circular dependency resolution', () => {
    it('should not have circular dependency issues', { meta: { tier: 'domain', domain: 'server' } }, () => {
      // This test verifies that we can create ErrorHandler without importing responseFormatter
      const customFormatter = {
        format: (value: unknown) => JSON.stringify(value),
      };

      expect(() => {
        const errorHandler = createErrorHandler(customFormatter);
        const error = new ValidationError('Test');
        errorHandler.handleError(error, 'testing');
      }).not.toThrow();
    });

    it('should work with different formatter implementations', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const customFormatter = {
        format: (value: unknown) => `CUSTOM: ${JSON.stringify(value)}`,
      };

      const errorHandler = createErrorHandler(customFormatter);
      const error = new ValidationError('Test');
      const result = errorHandler.handleError(error, 'testing');

      expect(result.content[0].text).toContain('CUSTOM:');
      expect(() => JSON.parse(result.content[0].text.substring(8))).not.toThrow();
    });
  });

  describe('ErrorHandler factory', () => {
    it('should create different instances with different formatters', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const formatter1 = { format: (v: unknown) => `F1: ${JSON.stringify(v)}` };
      const formatter2 = { format: (v: unknown) => `F2: ${JSON.stringify(v)}` };

      const handler1 = createErrorHandler(formatter1);
      const handler2 = createErrorHandler(formatter2);

      const error = new ValidationError('Test');
      const result1 = handler1.handleError(error, 'testing');
      const result2 = handler2.handleError(error, 'testing');

      expect(result1.content[0].text).toContain('F1:');
      expect(result2.content[0].text).toContain('F2:');
    });

    it('should maintain instance isolation', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const formatter1 = { format: vi.fn((v) => JSON.stringify(v)) };
      const formatter2 = { format: vi.fn((v) => JSON.stringify(v)) };

      const handler1 = createErrorHandler(formatter1);
      const handler2 = createErrorHandler(formatter2);

      const error = new ValidationError('Test');
      handler1.handleError(error, 'testing');

      expect(formatter1.format).toHaveBeenCalledOnce();
      expect(formatter2.format).not.toHaveBeenCalled();

      // Test the other direction to verify complete isolation
      handler2.handleError(error, 'testing');
      expect(formatter2.format).toHaveBeenCalledOnce();
      expect(formatter1.format).toHaveBeenCalledOnce(); // Still only called once
    });
  });
});
