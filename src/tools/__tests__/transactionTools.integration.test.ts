import { describe, it, expect, beforeAll } from 'vitest';
import * as ynab from 'ynab';
import { handleListTransactions, handleGetTransaction } from '../transactionTools.js';

const isSkip = ['true', '1', 'yes', 'y', 'on'].includes(
  (process.env['SKIP_E2E_TESTS'] || '').toLowerCase().trim(),
);
const runIntegrationTests = !isSkip;
const describeIntegration = runIntegrationTests ? describe : describe.skip;

describeIntegration('Transaction Tools Integration', () => {
  let ynabAPI: ynab.API;
  let testBudgetId: string;
  let testAccountId: string;

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

    // Get the first account for testing
    const accountsResponse = await ynabAPI.accounts.getAccounts(testBudgetId);
    testAccountId = accountsResponse.data.accounts[0].id;
  });

  it('should successfully list transactions from real API', async () => {
    const params = {
      budget_id: testBudgetId,
    };

    const result = await handleListTransactions(ynabAPI, params);
    const response = JSON.parse(result.content[0].text);

    // Handle large response case (preview_transactions instead of transactions)
    const transactions = response.transactions || response.preview_transactions;
    expect(transactions).toBeDefined();
    expect(Array.isArray(transactions)).toBe(true);

    const count = response.total_count || transactions.length;
    console.warn(`✅ Successfully listed ${count} transactions`);
  });

  it('should successfully list transactions with account filter', async () => {
    const params = {
      budget_id: testBudgetId,
      account_id: testAccountId,
    };

    const result = await handleListTransactions(ynabAPI, params);
    const response = JSON.parse(result.content[0].text);

    expect(response.transactions).toBeDefined();
    expect(Array.isArray(response.transactions)).toBe(true);

    // All transactions should be from the specified account
    response.transactions.forEach((transaction: any) => {
      expect(transaction.account_id).toBe(testAccountId);
    });

    console.warn(`✅ Successfully listed ${response.transactions.length} transactions for account`);
  });

  it('should successfully list transactions with date filter', async () => {
    const params = {
      budget_id: testBudgetId,
      since_date: '2024-01-01',
    };

    const result = await handleListTransactions(ynabAPI, params);
    const response = JSON.parse(result.content[0].text);

    // Handle large response case (preview_transactions instead of transactions)
    const transactions = response.transactions || response.preview_transactions;
    expect(transactions).toBeDefined();
    expect(Array.isArray(transactions)).toBe(true);

    const count = response.total_count || transactions.length;
    console.warn(`✅ Successfully listed ${count} transactions since 2024-01-01`);
  });

  it('should get transaction details if transactions exist', async () => {
    // First get a list of transactions to find one to test with
    const listParams = {
      budget_id: testBudgetId,
    };

    const listResult = await handleListTransactions(ynabAPI, listParams);
    const listResponse = JSON.parse(listResult.content[0].text);

    if (listResponse.transactions && listResponse.transactions.length > 0) {
      const testTransactionId = listResponse.transactions[0].id;

      const params = {
        budget_id: testBudgetId,
        transaction_id: testTransactionId,
      };

      const result = await handleGetTransaction(ynabAPI, params);
      const response = JSON.parse(result.content[0].text);

      expect(response.transaction).toBeDefined();
      expect(response.transaction.id).toBe(testTransactionId);

      console.warn(`✅ Successfully retrieved transaction: ${response.transaction.id}`);
    } else {
      console.warn('⚠️ No transactions found to test get transaction');
    }
  });

  it('should handle invalid budget ID gracefully', async () => {
    const params = {
      budget_id: 'invalid-budget-id',
    };

    const result = await handleListTransactions(ynabAPI, params);
    const response = JSON.parse(result.content[0].text);

    expect(response.error).toBeDefined();
    expect(response.error.message).toBeDefined();

    console.warn(`✅ Correctly handled invalid budget ID: ${response.error.message}`);
  });

  it('should handle invalid transaction ID gracefully', async () => {
    const params = {
      budget_id: testBudgetId,
      transaction_id: 'invalid-transaction-id',
    };

    const result = await handleGetTransaction(ynabAPI, params);
    const response = JSON.parse(result.content[0].text);

    expect(response.error).toBeDefined();
    expect(response.error.message).toBeDefined();

    console.warn(`✅ Correctly handled invalid transaction ID: ${response.error.message}`);
  });

  // Note: We're not testing create/update/delete operations in integration tests
  // to avoid modifying real budget data. These would be tested in a sandbox environment.
});
