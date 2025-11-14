import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import * as ynab from 'ynab';
import { z } from 'zod';
import {
  handleListTransactions,
  handleGetTransaction,
  handleCreateTransactions,
  CreateTransactionsSchema,
} from '../transactionTools.js';

const isSkip = ['true', '1', 'yes', 'y', 'on'].includes(
  (process.env['SKIP_E2E_TESTS'] || '').toLowerCase().trim(),
);
const runIntegrationTests = !isSkip;
const describeIntegration = runIntegrationTests ? describe : describe.skip;
type CreateTransactionsParams = z.infer<typeof CreateTransactionsSchema>;

describeIntegration('Transaction Tools Integration', () => {
  let ynabAPI: ynab.API;
  let testBudgetId: string;
  let testAccountId: string;
  let secondaryAccountId: string | undefined;

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
    const accounts = accountsResponse.data.accounts;
    testAccountId = accounts[0].id;
    secondaryAccountId = accounts[1]?.id;
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

  describe('handleCreateTransactions - Integration', () => {
    type BulkTransactionInput = CreateTransactionsParams['transactions'][number];
    const createdTransactionIds: string[] = [];

    const parseToolResult = (toolResult: { content?: { text?: string }[] }) => {
      const raw = toolResult.content?.[0]?.text ?? '{}';
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`Unable to parse tool output: ${raw}`);
      }
    };

    const today = () => new Date().toISOString().slice(0, 10);

    const buildTransaction = (overrides: Partial<BulkTransactionInput> = {}): BulkTransactionInput => {
      const base: BulkTransactionInput = {
        account_id: testAccountId,
        amount: -1234,
        date: today(),
        memo: `Bulk MCP Test ${randomUUID().slice(0, 8)}`,
        import_id: `MCP:${randomUUID()}`,
      };
      return { ...base, ...overrides };
    };

    const executeBulkCreate = async (
      params: CreateTransactionsParams,
      trackCreatedIds = true,
    ): Promise<{ response: any }> => {
      const result = await handleCreateTransactions(ynabAPI, params);
      const response = parseToolResult(result);

      if (trackCreatedIds && Array.isArray(response.results)) {
        const createdIds = response.results
          .filter(
            (res: { status?: string; transaction_id?: string }) =>
              res.status === 'created' && typeof res.transaction_id === 'string',
          )
          .map((res: { transaction_id: string }) => res.transaction_id);
        createdTransactionIds.push(...createdIds);
      }

      return { response };
    };

    const fetchBudgetTransactions = async () => {
      const listResult = await handleListTransactions(ynabAPI, { budget_id: testBudgetId });
      return parseToolResult(listResult);
    };

    afterEach(async () => {
      while (createdTransactionIds.length > 0) {
        const transactionId = createdTransactionIds.pop();
        if (!transactionId) continue;
        try {
          await ynabAPI.transactions.deleteTransaction(testBudgetId, transactionId);
        } catch (error) {
          console.warn(
            `?? Failed to clean up integration test transaction ${transactionId}: ${
              (error as Error).message
            }`,
          );
        }
      }
    });

    it('should create two transactions via the bulk handler', async () => {
      const importPrefix = randomUUID();
      const { response } = await executeBulkCreate({
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            amount: -1500,
            memo: `Bulk Pair A ${importPrefix}`,
            import_id: `MCP:${importPrefix}:A`,
          }),
          buildTransaction({
            amount: -2500,
            memo: `Bulk Pair B ${importPrefix}`,
            import_id: `MCP:${importPrefix}:B`,
          }),
        ],
      });

      expect(response.summary.created).toBe(2);
      expect(response.results).toHaveLength(2);
      expect(response.results.every((res: any) => res.status === 'created')).toBe(true);
    });

    it('should detect duplicates when reusing import IDs', async () => {
      const importId = `MCP:DUP:${randomUUID()}`;
      await executeBulkCreate({
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            import_id: importId,
            memo: `Duplicate seed ${importId}`,
          }),
        ],
      });

      const { response } = await executeBulkCreate({
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            import_id: importId,
            memo: `Duplicate attempt ${importId}`,
          }),
        ],
      });

      expect(response.summary.duplicates).toBe(1);
      expect(response.results[0].status).toBe('duplicate');
    });

    it('should invalidate caches so new transactions appear in list results', async () => {
      const memo = `Cache Invalidation ${randomUUID()}`;
      await fetchBudgetTransactions(); // warm cache to ensure invalidation path executes

      await executeBulkCreate({
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            memo,
            amount: -4321,
            import_id: `MCP:CACHE:${randomUUID()}`,
          }),
        ],
      });

      const afterList = await fetchBudgetTransactions();
      const transactions =
        afterList.transactions || afterList.preview_transactions || afterList.transaction_preview;
      expect(transactions).toBeDefined();
      expect(
        (transactions as any[]).some((transaction) => transaction.memo === memo),
      ).toBe(true);
    });

    it('should create transactions across multiple accounts within one batch', async () => {
      if (!secondaryAccountId || secondaryAccountId === testAccountId) {
        console.warn(
          '?? Skipping multi-account bulk test because only one account is available in this budget.',
        );
        return;
      }

      const { response } = await executeBulkCreate({
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            account_id: testAccountId,
            memo: 'Primary account bulk entry',
            import_id: `MCP:PRIMARY:${randomUUID()}`,
          }),
          buildTransaction({
            account_id: secondaryAccountId,
            memo: 'Secondary account bulk entry',
            import_id: `MCP:SECONDARY:${randomUUID()}`,
          }),
        ],
      });

      expect(response.summary.created).toBe(2);
      const accountIds = new Set(
        (response.transactions ?? []).map((txn: any) => txn.account_id),
      );
      expect(accountIds.has(testAccountId)).toBe(true);
      expect(accountIds.has(secondaryAccountId)).toBe(true);
    });

    it('should handle large batches and report response mode', async () => {
      const batch = Array.from({ length: 50 }, (_, index) =>
        buildTransaction({
          amount: -1000 - index,
          memo: `Bulk batch item ${index}`,
          import_id: `MCP:BATCH:${index}:${randomUUID()}`,
        }),
      );

      const { response } = await executeBulkCreate({
        budget_id: testBudgetId,
        transactions: batch,
      });

      expect(response.summary.total_requested).toBe(50);
      expect(response.results).toHaveLength(50);
      expect(['full', 'summary', 'ids_only']).toContain(response.mode);
    });

    it('should support dry run mode without creating transactions', async () => {
      const result = await handleCreateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        dry_run: true,
        transactions: [
          buildTransaction({
            memo: `Dry run ${randomUUID()}`,
          }),
        ],
      });
      const response = parseToolResult(result);
      expect(response.dry_run).toBe(true);
      expect(response.transactions_preview).toHaveLength(1);
      expect(response.summary.total_transactions).toBe(1);
    });

    it('should confirm dry run does not persist data', async () => {
      const memo = `DryRunNoPersist ${randomUUID()}`;
      await handleCreateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        dry_run: true,
        transactions: [
          buildTransaction({
            memo,
          }),
        ],
      });

      const afterList = await fetchBudgetTransactions();
      const transactions =
        afterList.transactions || afterList.preview_transactions || afterList.transaction_preview;
      const memoExists = Array.isArray(transactions)
        ? transactions.some((transaction) => transaction.memo === memo)
        : false;
      expect(memoExists).toBe(false);
    });

    it('should handle invalid budget IDs gracefully during bulk create', async () => {
      const result = await handleCreateTransactions(ynabAPI, {
        budget_id: 'invalid-budget-id',
        transactions: [buildTransaction()],
      });
      const response = parseToolResult(result);
      expect(response.error).toBeDefined();
      expect(response.error.message).toBeDefined();
    });

    it('should handle invalid account IDs during bulk create', async () => {
      const result = await handleCreateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            account_id: 'invalid-account-id',
            import_id: `MCP:INVALID:${randomUUID()}`,
          }),
        ],
      });
      const response = parseToolResult(result);
      expect(response.error).toBeDefined();
      expect(response.error.message).toBeDefined();
    });

    it.skip('documents rate limiting behavior for bulk requests', () => {
      // Intentionally skipped – provoking API rate limits is outside automated integration scope
    });
  });
});
