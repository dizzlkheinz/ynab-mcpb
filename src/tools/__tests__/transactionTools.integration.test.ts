import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import * as ynab from 'ynab';
import { z } from 'zod';
import {
  handleListTransactions,
  handleGetTransaction,
  handleCreateTransactions,
  handleUpdateTransactions,
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

  it('should successfully list transactions from real API', { meta: { tier: 'core', domain: 'transactions' } }, async () => {
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

  it('should successfully list transactions with account filter', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
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

  it('should successfully list transactions with date filter', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
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

  it('should get transaction details if transactions exist', { meta: { tier: 'core', domain: 'transactions' } }, async () => {
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

  it('should handle invalid budget ID gracefully', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
    const params = {
      budget_id: 'invalid-budget-id',
    };

    const result = await handleListTransactions(ynabAPI, params);
    const response = JSON.parse(result.content[0].text);

    expect(response.error).toBeDefined();
    expect(response.error.message).toBeDefined();

    console.warn(`✅ Correctly handled invalid budget ID: ${response.error.message}`);
  });

  it('should handle invalid transaction ID gracefully', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
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
        // YNAB import_id max length is 36 characters: "MCP:" (4) + UUID first 32 chars = 36
        import_id: `MCP:${randomUUID().slice(0, 32)}`,
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
            `⚠️ Failed to clean up integration test transaction ${transactionId}: ${
              (error as Error).message
            }`,
          );
        }
      }
    });
    it('should create two transactions via the bulk handler', { meta: { tier: 'core', domain: 'transactions' } }, async () => {
      const importPrefix = randomUUID().slice(0, 30); // Keep short for import_id
      const { response } = await executeBulkCreate({
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            amount: -1500,
            memo: `Bulk Pair A ${importPrefix}`,
            // Max 36 chars: "MCP:" (4) + prefix (30) + ":A" (2) = 36
            import_id: `MCP:${importPrefix}:A`,
          }),
          buildTransaction({
            amount: -2500,
            memo: `Bulk Pair B ${importPrefix}`,
            // Max 36 chars: "MCP:" (4) + prefix (30) + ":B" (2) = 36
            import_id: `MCP:${importPrefix}:B`,
          }),
        ],
      });

      expect(response.summary.created).toBe(2);
      expect(response.results).toHaveLength(2);
      expect(response.results.every((res: any) => res.status === 'created')).toBe(true);
    });

    it('should detect duplicates when reusing import IDs', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
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

    it('should invalidate caches so new transactions appear in list results', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
      const memo = `Cache Invalidation ${randomUUID()}`;
      await fetchBudgetTransactions(); // warm cache to ensure invalidation path executes

      await executeBulkCreate({
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            memo,
            amount: -4321,
            // Max 36 chars: "MCP:CACHE:" (10) + 26 chars
            import_id: `MCP:CACHE:${randomUUID().slice(0, 26)}`,
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

    it('should create transactions across multiple accounts within one batch', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
      if (!secondaryAccountId || secondaryAccountId === testAccountId) {
        console.warn(
          'Skipping multi-account bulk test because only one account is available in this budget.',
        );
        return;
      }

      const { response } = await executeBulkCreate({
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            account_id: testAccountId,
            memo: 'Primary account bulk entry',
            // Max 36 chars: "MCP:PRIMARY:" (12) + 24 chars
            import_id: `MCP:PRIMARY:${randomUUID().slice(0, 24)}`,
          }),
          buildTransaction({
            account_id: secondaryAccountId,
            memo: 'Secondary account bulk entry',
            // Max 36 chars: "MCP:SECONDARY:" (14) + 22 chars
            import_id: `MCP:SECONDARY:${randomUUID().slice(0, 22)}`,
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

    it('should handle large batches and report response mode', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
      const batch = Array.from({ length: 50 }, (_, index) =>
        buildTransaction({
          amount: -1000 - index,
          memo: `Bulk batch item ${index}`,
          // Max 36 chars: "MCP:BATCH:" (10) + index (up to 2 chars) + ":" (1) + UUID
          // With index 0-99, max prefix is 13 chars, leaving 23 for UUID
          import_id: `MCP:BATCH:${index}:${randomUUID().slice(0, 23)}`,
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

    it('should support dry run mode without creating transactions', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
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

    it('should confirm dry run does not persist data', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
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

    it('should handle invalid budget IDs gracefully during bulk create', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
      const result = await handleCreateTransactions(ynabAPI, {
        budget_id: 'invalid-budget-id',
        transactions: [buildTransaction()],
      });
      const response = parseToolResult(result);
      expect(response.error).toBeDefined();
      expect(response.error.message).toBeDefined();
    });

    it('should handle invalid account IDs during bulk create', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
      const result = await handleCreateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          buildTransaction({
            account_id: 'invalid-account-id',
            // Max 36 chars: "MCP:INVALID:" (12) + 24 chars
            import_id: `MCP:INVALID:${randomUUID().slice(0, 24)}`,
          }),
        ],
      });
      const response = parseToolResult(result);
      expect(response.error).toBeDefined();
      expect(response.error.message).toBeDefined();
    });

    it.skip('documents rate limiting behavior for bulk requests', { meta: { tier: 'domain', domain: 'transactions' } }, () => {
      // Intentionally skipped – provoking API rate limits is outside automated integration scope
    });
  });

  describeIntegration('Bulk Update Transactions Integration', () => {
    const createdTransactionIds: string[] = [];

    const parseToolResult = (result: any) => {
      if (!result.content || !result.content[0]?.text) {
        throw new Error('Invalid tool result structure');
      }
      return JSON.parse(result.content[0].text);
    };

    afterEach(async () => {
      // Clean up created transactions
      while (createdTransactionIds.length > 0) {
        const transactionId = createdTransactionIds.pop();
        if (!transactionId) continue;
        try {
          await ynabAPI.transactions.deleteTransaction(testBudgetId, transactionId);
        } catch (error) {
          console.warn(
            `⚠️ Failed to clean up integration test transaction ${transactionId}: ${
              (error as Error).message
            }`,
          );
        }
      }
    });

    it('should successfully update multiple transactions with provided metadata', { meta: { tier: 'core', domain: 'transactions' } }, async () => {
      // First create test transactions
      const createResult = await handleCreateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          {
            account_id: testAccountId,
            amount: -5000,
            date: new Date().toISOString().slice(0, 10),
            memo: 'Original memo 1',
            // Max 36 chars: "MCP:UPDATE-TEST-1:" (18) + 18 chars
            import_id: `MCP:UPDATE-TEST-1:${randomUUID().slice(0, 18)}`,
          },
          {
            account_id: testAccountId,
            amount: -10000,
            date: new Date().toISOString().slice(0, 10),
            memo: 'Original memo 2',
            // Max 36 chars: "MCP:UPDATE-TEST-2:" (18) + 18 chars
            import_id: `MCP:UPDATE-TEST-2:${randomUUID().slice(0, 18)}`,
          },
        ],
      });

      const createResponse = parseToolResult(createResult);
      const transactionIds = createResponse.results
        .filter((r: any) => r.status === 'created')
        .map((r: any) => r.transaction_id);

      expect(transactionIds).toHaveLength(2);
      createdTransactionIds.push(...transactionIds);

      // Now update the transactions with metadata
      const updateResult = await handleUpdateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          {
            id: transactionIds[0],
            amount: -7500,
            memo: 'Updated memo 1',
            original_account_id: testAccountId,
            original_date: new Date().toISOString().slice(0, 10),
          },
          {
            id: transactionIds[1],
            memo: 'Updated memo 2',
            cleared: 'cleared' as const,
            original_account_id: testAccountId,
            original_date: new Date().toISOString().slice(0, 10),
          },
        ],
      });

      const updateResponse = parseToolResult(updateResult);
      expect(updateResponse.success).toBe(true);
      expect(updateResponse.summary.updated).toBe(2);
      expect(updateResponse.summary.failed).toBe(0);
      expect(updateResponse.results).toHaveLength(2);
      expect(updateResponse.results[0].status).toBe('updated');
      expect(updateResponse.results[0].correlation_key).toBe(transactionIds[0]);
      expect(updateResponse.results[1].status).toBe('updated');
      expect(updateResponse.results[1].correlation_key).toBe(transactionIds[1]);

      // Verify changes persisted
      const getResult1 = await handleGetTransaction(ynabAPI, {
        budget_id: testBudgetId,
        transaction_id: transactionIds[0],
      });
      const transaction1 = parseToolResult(getResult1).transaction;
      expect(transaction1.amount).toBe(-7.5);
      expect(transaction1.memo).toBe('Updated memo 1');

      const getResult2 = await handleGetTransaction(ynabAPI, {
        budget_id: testBudgetId,
        transaction_id: transactionIds[1],
      });
      const transaction2 = parseToolResult(getResult2).transaction;
      expect(transaction2.memo).toBe('Updated memo 2');
      expect(transaction2.cleared).toBe('cleared');

      console.warn('✅ Successfully updated 2 transactions with provided metadata');
    });

    it('should successfully update transactions without metadata (using cache/API)', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
      // Create a test transaction
      const createResult = await handleCreateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          {
            account_id: testAccountId,
            amount: -3000,
            date: new Date().toISOString().slice(0, 10),
            memo: 'Original',
            // Max 36 chars: "MCP:UPDATE-NO-META:" (19) + 17 chars
            import_id: `MCP:UPDATE-NO-META:${randomUUID().slice(0, 17)}`,
          },
        ],
      });

      const createResponse = parseToolResult(createResult);
      const transactionId = createResponse.results[0].transaction_id;
      createdTransactionIds.push(transactionId);

      // Update without providing original_account_id/original_date
      const updateResult = await handleUpdateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          {
            id: transactionId,
            memo: 'Updated without metadata',
          },
        ],
      });

      const updateResponse = parseToolResult(updateResult);
      expect(updateResponse.success).toBe(true);
      expect(updateResponse.summary.updated).toBe(1);

      // Verify change
      const getResult = await handleGetTransaction(ynabAPI, {
        budget_id: testBudgetId,
        transaction_id: transactionId,
      });
      const transaction = parseToolResult(getResult).transaction;
      expect(transaction.memo).toBe('Updated without metadata');

      console.warn('✅ Successfully updated transaction without metadata');
    });

    it('should provide before/after preview in dry_run mode', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
      // Create a test transaction
      const createResult = await handleCreateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          {
            account_id: testAccountId,
            amount: -2000,
            date: new Date().toISOString().slice(0, 10),
            memo: 'For dry run test',
            // Max 36 chars: "MCP:DRY-RUN:" (12) + 24 chars
            import_id: `MCP:DRY-RUN:${randomUUID().slice(0, 24)}`,
          },
        ],
      });

      const createResponse = parseToolResult(createResult);
      const transactionId = createResponse.results[0].transaction_id;
      createdTransactionIds.push(transactionId);

      // Run dry_run update
      const dryRunResult = await handleUpdateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          {
            id: transactionId,
            amount: -5000,
            memo: 'Dry run update',
          },
        ],
        dry_run: true,
      });

      const dryRunResponse = parseToolResult(dryRunResult);
      expect(dryRunResponse.dry_run).toBe(true);
      expect(dryRunResponse.transactions_preview).toHaveLength(1);

      const preview = dryRunResponse.transactions_preview[0];
      expect(preview.transaction_id).toBe(transactionId);
      expect(preview.before).toBeDefined();
      expect(preview.after).toBeDefined();

      if (typeof preview.before !== 'string') {
        expect(preview.before.amount).toBe(-2);
        expect(preview.before.memo).toBe('For dry run test');
        expect(preview.after.amount).toBe(-5);
        expect(preview.after.memo).toBe('Dry run update');
      }

      // Verify transaction was NOT actually updated
      const getResult = await handleGetTransaction(ynabAPI, {
        budget_id: testBudgetId,
        transaction_id: transactionId,
      });
      const transaction = parseToolResult(getResult).transaction;
      expect(transaction.amount).toBe(-2); // Should still be original amount
      expect(transaction.memo).toBe('For dry run test'); // Should still be original memo

      console.warn('✅ Dry run preview successful, no changes persisted');
    });

    it('should handle partial failures gracefully', { meta: { tier: 'domain', domain: 'transactions' } }, async () => {
      // Create one valid transaction
      const createResult = await handleCreateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          {
            account_id: testAccountId,
            amount: -1000,
            date: new Date().toISOString().slice(0, 10),
            // Max 36 chars: "MCP:PARTIAL-FAIL:" (17) + 19 chars
            import_id: `MCP:PARTIAL-FAIL:${randomUUID().slice(0, 19)}`,
          },
        ],
      });

      const createResponse = parseToolResult(createResult);
      const validTransactionId = createResponse.results[0].transaction_id;
      createdTransactionIds.push(validTransactionId);

      // Try to update with one valid and one invalid ID
      const updateResult = await handleUpdateTransactions(ynabAPI, {
        budget_id: testBudgetId,
        transactions: [
          {
            id: validTransactionId,
            memo: 'Valid update',
          },
          {
            id: 'invalid-transaction-id-12345',
            memo: 'This should fail',
          },
        ],
      });

      const updateResponse = parseToolResult(updateResult);
      expect(updateResponse.summary.total_requested).toBe(2);
      expect(updateResponse.summary.updated).toBe(1);      expect(updateResponse.summary.failed).toBeGreaterThan(0);

      console.warn(
        `✅ Partial failure handled: ${updateResponse.summary.updated} updated, ${updateResponse.summary.failed} failed`,
      );
    });
  });
});
