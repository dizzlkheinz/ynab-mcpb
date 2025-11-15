import { describe, it, expect, beforeAll } from 'vitest';
import * as ynab from 'ynab';
import { handleListPayees, handleGetPayee } from '../payeeTools.js';

/**
 * Integration tests for payee tools using real YNAB API
 */
const runIntegrationTests = process.env['SKIP_E2E_TESTS'] !== 'true';
const describeIntegration = runIntegrationTests ? describe : describe.skip;

describeIntegration('Payee Tools Integration', () => {
  let ynabAPI: ynab.API;
  let testBudgetId: string;
  let testPayeeId: string;

  beforeAll(async () => {
    const accessToken = process.env['YNAB_ACCESS_TOKEN'];
    if (!accessToken) {
      throw new Error(
        'YNAB_ACCESS_TOKEN is required. Set it in your .env file to run integration tests.',
      );
    }

    ynabAPI = new ynab.API(accessToken);
    const budgetsResponse = await ynabAPI.budgets.getBudgets();
    testBudgetId = budgetsResponse.data.budgets[0].id;
  });

  describe('handleListPayees', () => {
    it('should successfully list payees from real API', { meta: { tier: 'domain', domain: 'payees' } }, async () => {
      const result = await handleListPayees(ynabAPI, { budget_id: testBudgetId });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.payees).toBeDefined();
      expect(Array.isArray(parsedContent.payees)).toBe(true);
      expect(parsedContent.payees.length).toBeGreaterThan(0);

      // Store first payee ID for next test
      testPayeeId = parsedContent.payees[0].id;

      // Verify payee structure
      const firstPayee = parsedContent.payees[0];
      expect(firstPayee.id).toBeDefined();
      expect(firstPayee.name).toBeDefined();
      expect(firstPayee.deleted).toBeDefined();
      expect(typeof firstPayee.deleted).toBe('boolean');

      // Check for transfer payees
      const transferPayees = parsedContent.payees.filter(
        (p: any) => p.transfer_account_id !== null,
      );
      console.warn(`✅ Successfully listed ${parsedContent.payees.length} payees`);
      console.warn(`   - ${transferPayees.length} transfer payees`);
      console.warn(`   - ${parsedContent.payees.length - transferPayees.length} regular payees`);
    });

    it('should handle invalid budget ID gracefully', { meta: { tier: 'domain', domain: 'payees' } }, async () => {
      const result = await handleListPayees(ynabAPI, { budget_id: 'invalid-budget-id' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error).toBeDefined();
      expect(parsedContent.error.message).toBeDefined();

      console.warn(`✅ Correctly handled invalid budget ID: ${parsedContent.error.message}`);
    });
  });

  describe('handleGetPayee', () => {
    it('should successfully get payee details from real API', { meta: { tier: 'domain', domain: 'payees' } }, async () => {
      // Use the payee ID from the previous test
      const result = await handleGetPayee(ynabAPI, {
        budget_id: testBudgetId,
        payee_id: testPayeeId,
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.payee).toBeDefined();

      const payee = parsedContent.payee;
      expect(payee.id).toBe(testPayeeId);
      expect(payee.name).toBeDefined();
      expect(payee.deleted).toBeDefined();
      expect(typeof payee.deleted).toBe('boolean');

      console.warn(`✅ Successfully retrieved payee: ${payee.name}`);
      if (payee.transfer_account_id) {
        console.warn(`   - Transfer payee for account: ${payee.transfer_account_id}`);
      } else {
        console.warn(`   - Regular payee`);
      }
    });

    it('should handle invalid payee ID gracefully', { meta: { tier: 'domain', domain: 'payees' } }, async () => {
      const result = await handleGetPayee(ynabAPI, {
        budget_id: testBudgetId,
        payee_id: 'invalid-payee-id',
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error).toBeDefined();
      expect(parsedContent.error.message).toBeDefined();

      console.warn(`✅ Correctly handled invalid payee ID: ${parsedContent.error.message}`);
    });

    it('should handle invalid budget ID gracefully', { meta: { tier: 'domain', domain: 'payees' } }, async () => {
      const result = await handleGetPayee(ynabAPI, {
        budget_id: 'invalid-budget-id',
        payee_id: testPayeeId,
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error).toBeDefined();
      expect(parsedContent.error.message).toBeDefined();

      console.warn(`✅ Correctly handled invalid budget ID: ${parsedContent.error.message}`);
    });
  });
});
