import { describe, it, expect, beforeAll } from 'vitest';
import * as ynab from 'ynab';
import { handleGetUser, handleConvertAmount } from '../utilityTools.js';

/**
 * Utility Tools Integration Tests
 * Skips if YNAB_ACCESS_TOKEN is not set or if SKIP_E2E_TESTS is true
 */
const hasToken = !!process.env['YNAB_ACCESS_TOKEN'];
const shouldSkip = process.env['SKIP_E2E_TESTS'] === 'true' || !hasToken;
const describeIntegration = shouldSkip ? describe.skip : describe;

describeIntegration('Utility Tools Integration Tests', () => {
  let ynabAPI: ynab.API;

  beforeAll(() => {
    const accessToken = process.env['YNAB_ACCESS_TOKEN']!;
    ynabAPI = new ynab.API(accessToken);
  });

  describe('handleGetUser', () => {
    it('should retrieve user information from YNAB API', { meta: { tier: 'core', domain: 'utility' } }, async () => {
      const result = await handleGetUser(ynabAPI);
      const response = JSON.parse(result.content[0].text);

      expect(response).toHaveProperty('user');
      expect(response.user).toHaveProperty('id');
      expect(typeof response.user.id).toBe('string');
      expect(response.user.id.length).toBeGreaterThan(0);
    });
  });

  describe('handleConvertAmount', () => {
    it('should convert various dollar amounts to milliunits', { meta: { tier: 'domain', domain: 'utility' } }, async () => {
      const testCases = [
        { dollars: 1.0, expectedMilliunits: 1000 },
        { dollars: 0.01, expectedMilliunits: 10 },
        { dollars: 10.5, expectedMilliunits: 10500 },
        { dollars: 999.99, expectedMilliunits: 999990 },
        { dollars: 0, expectedMilliunits: 0 },
        { dollars: -5.25, expectedMilliunits: -5250 },
      ];

      for (const testCase of testCases) {
        const result = await handleConvertAmount({
          amount: testCase.dollars,
          to_milliunits: true,
        });
        const response = JSON.parse(result.content[0].text);

        expect(response.conversion.converted_amount).toBe(testCase.expectedMilliunits);
        expect(response.conversion.to_milliunits).toBe(true);
        expect(response.conversion.description).toContain(`$${testCase.dollars.toFixed(2)}`);
        expect(response.conversion.description).toContain(
          `${testCase.expectedMilliunits} milliunits`,
        );
      }
    });

    it('should convert various milliunit amounts to dollars', { meta: { tier: 'domain', domain: 'utility' } }, async () => {
      const testCases = [
        { milliunits: 1000, expectedDollars: 1.0 },
        { milliunits: 10, expectedDollars: 0.01 },
        { milliunits: 10500, expectedDollars: 10.5 },
        { milliunits: 999990, expectedDollars: 999.99 },
        { milliunits: 0, expectedDollars: 0 },
        { milliunits: -5250, expectedDollars: -5.25 },
      ];

      for (const testCase of testCases) {
        const result = await handleConvertAmount({
          amount: testCase.milliunits,
          to_milliunits: false,
        });
        const response = JSON.parse(result.content[0].text);

        expect(response.conversion.converted_amount).toBe(testCase.expectedDollars);
        expect(response.conversion.to_milliunits).toBe(false);
        expect(response.conversion.description).toContain(`${testCase.milliunits} milliunits`);
        expect(response.conversion.description).toContain(
          `$${testCase.expectedDollars.toFixed(2)}`,
        );
      }
    });

    it('should handle precision edge cases', { meta: { tier: 'domain', domain: 'utility' } }, async () => {
      // Test floating-point precision issues
      const precisionTests = [
        { amount: 0.1 + 0.2, to_milliunits: true }, // Should handle 0.30000000000000004
        { amount: 1.005, to_milliunits: true }, // Should round correctly
        { amount: 999.999, to_milliunits: true }, // Should handle near-integer values
      ];

      for (const test of precisionTests) {
        const result = await handleConvertAmount(test);
        const response = JSON.parse(result.content[0].text);

        expect(response.conversion).toHaveProperty('converted_amount');
        expect(typeof response.conversion.converted_amount).toBe('number');
        expect(Number.isInteger(response.conversion.converted_amount)).toBe(true);
      }
    });
  });
});
