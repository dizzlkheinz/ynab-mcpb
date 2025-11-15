import { describe, it, expect, beforeAll } from 'vitest';
import * as ynab from 'ynab';
import { handleListAccounts, handleGetAccount } from '../accountTools.js';

const isSkip = ['true', '1', 'yes', 'y', 'on'].includes(
  (process.env['SKIP_E2E_TESTS'] || '').toLowerCase().trim(),
);
const runIntegrationTests = !isSkip;
const describeIntegration = runIntegrationTests ? describe : describe.skip;

describeIntegration('Account Tools Integration', () => {
  let ynabAPI: ynab.API;
  let testBudgetId: string;

  beforeAll(async () => {
    const accessToken = process.env['YNAB_ACCESS_TOKEN'];
    if (!accessToken) {
      throw new Error(
        'YNAB_ACCESS_TOKEN is required. Set it in your .env file to run integration tests.',
      );
    }
    ynabAPI = new ynab.API(accessToken);

    // Get the first budget for testing
    const budgetsResponse = await ynabAPI.budgets.getBudgets();
    testBudgetId = budgetsResponse.data.budgets[0].id;
  });

  it('should successfully list accounts from real API', { meta: { tier: 'core', domain: 'accounts' } }, async () => {
    const result = await handleListAccounts(ynabAPI, { budget_id: testBudgetId });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsedContent = JSON.parse(result.content[0].text);
    expect(parsedContent.accounts).toBeDefined();
    expect(Array.isArray(parsedContent.accounts)).toBe(true);

    console.warn(`✅ Successfully listed ${parsedContent.accounts.length} accounts`);

    // Verify account structure
    if (parsedContent.accounts.length > 0) {
      const account = parsedContent.accounts[0];
      expect(account).toHaveProperty('id');
      expect(account).toHaveProperty('name');
      expect(account).toHaveProperty('type');
      expect(account).toHaveProperty('balance');
    }
  });

  it('should successfully get account details from real API', { meta: { tier: 'domain', domain: 'accounts' } }, async () => {
    // First get the list of accounts to get a valid account ID
    const listResult = await handleListAccounts(ynabAPI, { budget_id: testBudgetId });
    const parsedListContent = JSON.parse(listResult.content[0].text);

    if (parsedListContent.accounts.length === 0) {
      console.warn('⚠️ No accounts found in test budget, skipping account detail test');
      return;
    }

    const testAccountId = parsedListContent.accounts[0].id;

    const result = await handleGetAccount(ynabAPI, {
      budget_id: testBudgetId,
      account_id: testAccountId,
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsedContent = JSON.parse(result.content[0].text);
    expect(parsedContent.account).toBeDefined();
    expect(parsedContent.account.id).toBe(testAccountId);
    expect(parsedContent.account).toHaveProperty('name');
    expect(parsedContent.account).toHaveProperty('type');
    expect(parsedContent.account).toHaveProperty('balance');

    console.warn(`✅ Successfully retrieved account: ${parsedContent.account.name}`);
  });

  it('should handle invalid budget ID gracefully', { meta: { tier: 'domain', domain: 'accounts' } }, async () => {
    const result = await handleListAccounts(ynabAPI, { budget_id: 'invalid-budget-id' });

    expect(result.content).toHaveLength(1);
    const parsedContent = JSON.parse(result.content[0].text);
    expect(parsedContent.error).toBeDefined();
    expect(parsedContent.error.message).toContain('Failed to list accounts');

    console.warn('✅ Correctly handled invalid budget ID:', parsedContent.error.message);
  });

  it('should handle invalid account ID gracefully', { meta: { tier: 'domain', domain: 'accounts' } }, async () => {
    const result = await handleGetAccount(ynabAPI, {
      budget_id: testBudgetId,
      account_id: 'invalid-account-id',
    });

    expect(result.content).toHaveLength(1);
    const parsedContent = JSON.parse(result.content[0].text);
    expect(parsedContent.error).toBeDefined();
    expect(parsedContent.error.message).toContain('Failed to get account');

    console.warn('✅ Correctly handled invalid account ID:', parsedContent.error.message);
  });
});
