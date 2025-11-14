import { describe, it, expect, vi } from 'vitest';
import type * as ynab from 'ynab';
import type { ReconciliationAnalysis } from '../types.js';
import { executeReconciliation, type AccountSnapshot } from '../executor.js';
import type { ReconcileAccountRequest } from '../index.js';

const buildAnalysis = (): ReconciliationAnalysis => ({
  success: true,
  phase: 'analysis',
  summary: {
    statement_date_range: '2025-10-01 to 2025-10-31',
    bank_transactions_count: 3,
    ynab_transactions_count: 3,
    auto_matched: 1,
    suggested_matches: 0,
    unmatched_bank: 1,
    unmatched_ynab: 1,
    current_cleared_balance: -899.02,
    target_statement_balance: -921.24,
    discrepancy: 22.22,
    discrepancy_explanation: 'Need to add 1 missing transaction',
  },
  auto_matches: [
    {
      bank_transaction: {
        id: 'bank-1',
        date: '2025-10-15',
        amount: -45.23,
        payee: 'Shell Gas',
        original_csv_row: 2,
      },
      ynab_transaction: {
        id: 'ynab-1',
        date: '2025-10-14',
        amount: -45230,
        payee_name: 'Shell',
        category_name: 'Auto',
        cleared: 'uncleared',
        approved: true,
        memo: null,
      },
      candidates: [],
      confidence: 'high',
      confidence_score: 97,
      match_reason: 'exact_amount_and_date',
    },
  ],
  suggested_matches: [],
  unmatched_bank: [
    {
      id: 'bank-2',
      date: '2025-10-25',
      amount: 22.22,
      payee: 'EvoCarShare',
      original_csv_row: 7,
    },
  ],
  unmatched_ynab: [
    {
      id: 'ynab-2',
      date: '2025-10-10',
      amount: -15000,
      payee_name: 'Coffee Shop',
      category_name: 'Dining',
      cleared: 'cleared',
      approved: true,
      memo: null,
    },
  ],
  balance_info: {
    current_cleared: -899.02,
    current_uncleared: -45.23,
    current_total: -944.25,
    target_statement: -921.24,
    discrepancy: 22.22,
    on_track: false,
  },
  next_steps: ['Review auto matches'],
  insights: [],
});

const defaultAccountSnapshot: AccountSnapshot = {
  balance: 0,
  cleared_balance: 0,
  uncleared_balance: 0,
};

const buildBulkAnalysis = (
  count: number,
  amount = 10,
  statementMultiplier = count,
): ReconciliationAnalysis => {
  const analysis = buildAnalysis();
  const baseDate = Date.parse('2025-10-01');
  analysis.auto_matches = [];
  analysis.summary.auto_matched = 0;
  analysis.suggested_matches = [];
  analysis.summary.suggested_matches = 0;
  analysis.unmatched_ynab = [];
  analysis.summary.unmatched_ynab = 0;
  analysis.summary.ynab_transactions_count = 0;
  analysis.summary.bank_transactions_count = count;
  analysis.unmatched_bank = Array.from({ length: count }, (_, index) => {
    const date = new Date(baseDate + index * 24 * 60 * 60 * 1000);
    return {
      id: `bank-bulk-${index}`,
      date: date.toISOString().slice(0, 10),
      amount,
      payee: `Bulk Payee ${index}`,
      memo: `Bulk memo ${index}`,
      original_csv_row: index + 1,
    };
  });
  analysis.summary.unmatched_bank = analysis.unmatched_bank.length;
  const statementBalance = amount * statementMultiplier;
  analysis.summary.current_cleared_balance = 0;
  analysis.summary.target_statement_balance = statementBalance;
  analysis.summary.discrepancy = statementBalance;
  analysis.summary.discrepancy_explanation = 'Bulk test discrepancy';
  analysis.balance_info = {
    current_cleared: 0,
    current_uncleared: 0,
    current_total: 0,
    target_statement: statementBalance,
    discrepancy: statementBalance,
    on_track: false,
  };
  analysis.next_steps = [];
  analysis.insights = [];
  return analysis;
};

const buildBulkParams = (
  statementBalance: number,
  overrides: Partial<ReconcileAccountRequest> = {},
): ReconcileAccountRequest => ({
  budget_id: 'budget-bulk',
  account_id: 'account-bulk',
  csv_data: 'Date,Payee,Amount',
  statement_balance: statementBalance,
  statement_date: '2025-10-31',
  date_tolerance_days: 1,
  amount_tolerance_cents: 1,
  auto_match_threshold: 90,
  suggestion_threshold: 60,
  auto_create_transactions: true,
  auto_update_cleared_status: false,
  auto_unclear_missing: false,
  auto_adjust_dates: false,
  dry_run: false,
  require_exact_match: true,
  confidence_threshold: 0.8,
  max_resolution_attempts: 3,
  ...overrides,
});

const createMockYnabAPI = (snapshot: AccountSnapshot = defaultAccountSnapshot) => {
  const createTransactions = vi.fn();
  const createTransaction = vi.fn();
  const updateTransactions = vi.fn().mockResolvedValue({ data: { transactions: [] } });
  const getTransactionsByAccount = vi.fn().mockResolvedValue({ data: { transactions: [] } });
  const getAccountById = vi.fn().mockResolvedValue({
    data: {
      account: {
        id: 'account-bulk',
        balance: snapshot.balance,
        cleared_balance: snapshot.cleared_balance,
        uncleared_balance: snapshot.uncleared_balance,
      },
    },
  });

  const api = {
    transactions: {
      createTransactions,
      createTransaction,
      updateTransactions,
      getTransactionsByAccount,
    },
    accounts: {
      getAccountById,
    },
  } as unknown as ynab.API;

  return {
    api,
    mocks: {
      createTransactions,
      createTransaction,
      updateTransactions,
      getTransactionsByAccount,
      getAccountById,
    },
  };
};

describe('executeReconciliation (dry run)', () => {
  it('produces action plan without calling YNAB APIs when dry_run=true', async () => {
    const analysis = buildAnalysis();
    const params = {
      budget_id: 'budget-1',
      account_id: 'account-1',
      csv_data: 'Date,Description,Amount',
      statement_balance: -921.24,
      date_tolerance_days: 2,
      amount_tolerance_cents: 1,
      auto_match_threshold: 90,
      suggestion_threshold: 60,
      auto_create_transactions: true,
      auto_update_cleared_status: true,
      auto_unclear_missing: true,
      auto_adjust_dates: true,
      dry_run: true,
      require_exact_match: true,
      confidence_threshold: 0.8,
      max_resolution_attempts: 5,
    } satisfies any;

    const initialAccount: AccountSnapshot = {
      balance: -899020,
      cleared_balance: -899020,
      uncleared_balance: 0,
    };

    const result = await executeReconciliation({
      ynabAPI: {} as ynab.API,
      analysis,
      params,
      budgetId: 'budget-1',
      accountId: 'account-1',
      initialAccount,
      currencyCode: 'USD',
    });

    expect(result.summary.transactions_created).toBe(1);
    expect(result.summary.transactions_updated).toBe(2);
    expect(result.summary.dates_adjusted).toBe(1);
    expect(result.actions_taken).toHaveLength(3);
    expect(result.recommendations).toContain(
      'Dry run only — re-run with dry_run=false to apply these changes',
    );
  });
});

describe('executeReconciliation (apply mode)', () => {
  it('creates, updates, and adjusts when dry_run=false', async () => {
    const analysis = buildAnalysis();
    const params = {
      budget_id: 'budget-apply',
      account_id: 'account-apply',
      csv_data: 'Date,Description,Amount',
      statement_balance: -921.24,
      statement_date: '2025-10-31',
      date_tolerance_days: 2,
      amount_tolerance_cents: 1,
      auto_match_threshold: 90,
      suggestion_threshold: 60,
      auto_create_transactions: true,
      auto_update_cleared_status: true,
      auto_unclear_missing: true,
      auto_adjust_dates: true,
      dry_run: false,
      require_exact_match: true,
      confidence_threshold: 0.8,
      max_resolution_attempts: 5,
    } satisfies any;

    const initialAccount: AccountSnapshot = {
      balance: -899020,
      cleared_balance: -899020,
      uncleared_balance: 0,
    };

    const mockCreate = vi.fn().mockResolvedValue({ data: { transaction: { id: 'created-1' } } });
    const mockUpdate = vi.fn().mockResolvedValue({ data: { transaction: { id: 'updated-1' } } });
    const mockBatchUpdate = vi.fn().mockResolvedValue({
      data: { transactions: [{ id: 'updated-1' }, { id: 'updated-2' }] }
    });
    const mockGetAccount = vi.fn().mockResolvedValue({
      data: { account: { balance: -921240, cleared_balance: -921240, uncleared_balance: 0 } },
    });

    const mockTransactionsApi = {
      createTransaction: mockCreate,
      updateTransaction: mockUpdate,
      updateTransactions: mockBatchUpdate,
      getTransactionsByAccount: vi.fn().mockResolvedValue({ data: { transactions: [] } }),
    } satisfies Partial<ynab.TransactionsApi>;

    const mockAccountsApi = {
      getAccountById: mockGetAccount,
    } satisfies Partial<ynab.AccountsApi>;

    const ynabAPI = {
      transactions: mockTransactionsApi,
      accounts: mockAccountsApi,
    } as unknown as ynab.API;

    const result = await executeReconciliation({
      ynabAPI,
      analysis,
      params,
      budgetId: 'budget-apply',
      accountId: 'account-apply',
      initialAccount,
      currencyCode: 'USD',
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalled();
    expect(mockGetAccount).toHaveBeenCalled();
    expect(result.summary.transactions_created).toBe(1);
    expect(result.summary.transactions_updated).toBeGreaterThanOrEqual(2);
    expect(result.summary.dates_adjusted).toBe(1);
    expect(result.actions_taken.length).toBeGreaterThanOrEqual(3);
    expect(result.summary.dry_run).toBe(false);
  });
});

describe('executeReconciliation (ordered halting)', () => {
  it('processes newest auto matches first and stops once balances align', async () => {
    const analysis: ReconciliationAnalysis = {
      success: true,
      phase: 'analysis',
      summary: {
        statement_date_range: '2025-09-01 to 2025-10-31',
        bank_transactions_count: 2,
        ynab_transactions_count: 2,
        auto_matched: 2,
        suggested_matches: 0,
        unmatched_bank: 0,
        unmatched_ynab: 0,
        current_cleared_balance: 90,
        target_statement_balance: 100,
        discrepancy: -10,
        discrepancy_explanation: 'Awaiting cleared transactions',
      },
      auto_matches: [
        {
          bank_transaction: {
            id: 'bank-older',
            date: '2025-09-15',
            amount: 5,
            payee: 'Older',
            original_csv_row: 2,
          },
          ynab_transaction: {
            id: 'ynab-older',
            date: '2025-09-14',
            amount: 5000,
            payee_name: 'Older',
            category_name: null,
            cleared: 'uncleared',
            approved: true,
            memo: null,
          },
          candidates: [],
          confidence: 'high',
          confidence_score: 95,
          match_reason: 'Exact match',
        },
        {
          bank_transaction: {
            id: 'bank-newer',
            date: '2025-10-25',
            amount: 10,
            payee: 'Newer',
            original_csv_row: 1,
          },
          ynab_transaction: {
            id: 'ynab-newer',
            date: '2025-10-24',
            amount: 10000,
            payee_name: 'Newer',
            category_name: null,
            cleared: 'uncleared',
            approved: true,
            memo: null,
          },
          candidates: [],
          confidence: 'high',
          confidence_score: 99,
          match_reason: 'Exact match',
        },
      ],
      suggested_matches: [],
      unmatched_bank: [],
      unmatched_ynab: [],
      balance_info: {
        current_cleared: 90,
        current_uncleared: 0,
        current_total: 90,
        target_statement: 100,
        discrepancy: -10,
        on_track: false,
      },
      next_steps: [],
      insights: [],
    };

    const params = {
      budget_id: 'budget-ordered',
      account_id: 'account-ordered',
      csv_data: 'Date,Description,Amount',
      statement_balance: 100,
      date_tolerance_days: 2,
      amount_tolerance_cents: 1,
      auto_match_threshold: 90,
      suggestion_threshold: 60,
      auto_create_transactions: false,
      auto_update_cleared_status: true,
      auto_unclear_missing: false,
      auto_adjust_dates: false,
      dry_run: true,
      require_exact_match: true,
      confidence_threshold: 0.8,
      max_resolution_attempts: 5,
    } satisfies any;

    const initialAccount: AccountSnapshot = {
      balance: 90000,
      cleared_balance: 90000,
      uncleared_balance: 0,
    };

    const result = await executeReconciliation({
      ynabAPI: {} as ynab.API,
      analysis,
      params,
      budgetId: 'budget-ordered',
      accountId: 'account-ordered',
      initialAccount,
      currencyCode: 'USD',
    });

    const updateActions = result.actions_taken.filter(
      (action) => action.type === 'update_transaction',
    );
    expect(updateActions).toHaveLength(1);
    expect((updateActions[0]?.transaction as any)?.transaction_id).toBe('ynab-newer');
    expect(result.actions_taken.some((action) => action.type === 'balance_checkpoint')).toBe(true);
    expect(result.summary.transactions_updated).toBe(1);
    expect(result.summary.dates_adjusted).toBe(0);
  });
});

describe('executeReconciliation - bulk create mode', () => {
  it('uses bulk create API for batches with multiple transactions', async () => {
    const analysis = buildBulkAnalysis(5, 12);
    const params = buildBulkParams(analysis.summary.target_statement_balance);
    const initialAccount = { ...defaultAccountSnapshot };
    const { api, mocks } = createMockYnabAPI(initialAccount);

    mocks.createTransactions.mockImplementation(async (_budgetId, body: any) => {
      const transactions = (body.transactions ?? []).map((txn: any, index: number) => ({
        id: `bulk-${index}`,
        account_id: txn.account_id,
        amount: txn.amount,
        date: txn.date,
        cleared: 'cleared',
        approved: true,
        import_id: txn.import_id, // Include import_id for correlation
      }));
      return { data: { transactions, duplicate_import_ids: [] } };
    });

    const result = await executeReconciliation({
      ynabAPI: api,
      analysis,
      params,
      budgetId: params.budget_id,
      accountId: params.account_id,
      initialAccount,
      currencyCode: 'USD',
    });

    expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
    const payload = mocks.createTransactions.mock.calls[0]?.[1];
    expect(payload?.transactions).toHaveLength(5);
    const createActions = result.actions_taken.filter(
      (action) => action.type === 'create_transaction',
    );
    expect(createActions).toHaveLength(5);
    expect(createActions.every((action) => action.correlation_key)).toBe(true);
    expect(result.summary.transactions_created).toBe(5);
    expect(result.bulk_operation_details).toEqual(
      expect.objectContaining({
        chunks_processed: 1,
        bulk_successes: 1,
        sequential_fallbacks: 0,
        bulk_chunk_failures: 0,
        transaction_failures: 0,
      }),
    );
  });

  it('falls back to sequential mode for single transaction scenarios', async () => {
    const analysis = buildBulkAnalysis(1, 15);
    const params = buildBulkParams(analysis.summary.target_statement_balance);
    const initialAccount = { ...defaultAccountSnapshot };
    const { api, mocks } = createMockYnabAPI(initialAccount);

    mocks.createTransaction.mockResolvedValue({
      data: {
        transaction: {
          id: 'single-txn',
          amount: 15000,
          date: analysis.unmatched_bank[0]?.date ?? '2025-10-01',
        },
      },
    });

    const result = await executeReconciliation({
      ynabAPI: api,
      analysis,
      params,
      budgetId: params.budget_id,
      accountId: params.account_id,
      initialAccount,
      currencyCode: 'USD',
    });

    expect(mocks.createTransactions).not.toHaveBeenCalled();
    expect(mocks.createTransaction).toHaveBeenCalledTimes(1);
    expect(result.summary.transactions_created).toBe(1);
    expect(result.bulk_operation_details).toBeUndefined();
  });

  it('falls back to sequential creation when bulk request fails', async () => {
    const analysis = buildBulkAnalysis(3, 8);
    const params = buildBulkParams(analysis.summary.target_statement_balance);
    const initialAccount = { ...defaultAccountSnapshot };
    const { api, mocks } = createMockYnabAPI(initialAccount);

    mocks.createTransactions.mockRejectedValue(new Error('500 error'));
    mocks.createTransaction.mockImplementation(async (_budgetId, body: any) => {
      return {
        data: {
          transaction: {
            id: `seq-${body.transaction?.date}`,
            amount: body.transaction?.amount ?? 0,
            date: body.transaction?.date ?? '2025-11-01',
            cleared: 'cleared',
            approved: true,
          },
        },
      };
    });

    const result = await executeReconciliation({
      ynabAPI: api,
      analysis,
      params,
      budgetId: params.budget_id,
      accountId: params.account_id,
      initialAccount,
      currencyCode: 'USD',
    });

    expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
    expect(mocks.createTransaction).toHaveBeenCalledTimes(3);
    expect(
      result.actions_taken.some((action) => action.type === 'bulk_create_fallback'),
    ).toBe(true);
    expect(result.summary.transactions_created).toBe(3);
    expect(result.bulk_operation_details).toEqual(
      expect.objectContaining({
        chunks_processed: 1,
        bulk_successes: 0,
        sequential_fallbacks: 1,
        bulk_chunk_failures: 1,
        transaction_failures: 0,
      }),
    );
  });

  it('splits large batches into 100-transaction chunks', async () => {
    const analysis = buildBulkAnalysis(150, 5);
    const params = buildBulkParams(analysis.summary.target_statement_balance);
    const initialAccount = { ...defaultAccountSnapshot };
    const { api, mocks } = createMockYnabAPI(initialAccount);

    let chunkCall = 0;
    mocks.createTransactions.mockImplementation(async (_budgetId, body: any) => {
      chunkCall += 1;
      const transactions = (body.transactions ?? []).map((txn: any, index: number) => ({
        id: `chunk-${chunkCall}-${index}`,
        account_id: txn.account_id,
        amount: txn.amount,
        date: txn.date,
        cleared: 'cleared',
        approved: true,
        import_id: txn.import_id, // Include import_id for correlation
      }));
      return { data: { transactions } };
    });

    const result = await executeReconciliation({
      ynabAPI: api,
      analysis,
      params,
      budgetId: params.budget_id,
      accountId: params.account_id,
      initialAccount,
      currencyCode: 'USD',
    });

    expect(mocks.createTransactions).toHaveBeenCalledTimes(2);
    expect(result.summary.transactions_created).toBe(150);
    expect(result.bulk_operation_details).toEqual(
      expect.objectContaining({
        chunks_processed: 2,
        bulk_successes: 2,
        bulk_chunk_failures: 0,
        transaction_failures: 0,
      }),
    );
  });

  it('flags duplicate transactions returned by YNAB API', async () => {
    const analysis = buildBulkAnalysis(3, 7);
    const params = buildBulkParams(analysis.summary.target_statement_balance);
    const initialAccount = { ...defaultAccountSnapshot };
    const { api, mocks } = createMockYnabAPI(initialAccount);

    mocks.createTransactions.mockImplementation(async (_budgetId, body: any) => {
      const transactions = (body.transactions ?? []).map((txn: any, index: number) => {
        if (index === 1) {
          return undefined;
        }
        return {
          id: `created-${index}`,
          account_id: txn.account_id,
          amount: txn.amount,
          date: txn.date,
          cleared: 'cleared',
          approved: true,
          import_id: txn.import_id, // Include import_id for correlation
        };
      });
      const filtered = transactions.filter(Boolean);
      const duplicateImportId = body.transactions?.[1]?.import_id;
      return {
        data: {
          transactions: filtered,
          duplicate_import_ids: duplicateImportId ? [duplicateImportId] : [],
        },
      };
    });

    const result = await executeReconciliation({
      ynabAPI: api,
      analysis,
      params,
      budgetId: params.budget_id,
      accountId: params.account_id,
      initialAccount,
      currencyCode: 'USD',
    });

    const duplicateActions = result.actions_taken.filter(
      (action) => action.duplicate === true,
    );
    expect(duplicateActions).toHaveLength(1);
    expect(result.bulk_operation_details?.duplicates_detected).toBe(1);
    expect(result.summary.transactions_created).toBe(2);
  });

  it('honors halting logic when balance aligns mid-batch', async () => {
    const analysis = buildBulkAnalysis(10, 10, 5);
    const params = buildBulkParams(analysis.summary.target_statement_balance);
    const initialAccount = { ...defaultAccountSnapshot };
    const { api, mocks } = createMockYnabAPI(initialAccount);

    mocks.createTransactions.mockImplementation(async (_budgetId, body: any) => {
      const transactions = (body.transactions ?? []).map((txn: any, index: number) => ({
        id: `halt-${index}`,
        account_id: txn.account_id,
        amount: txn.amount,
        date: txn.date,
        cleared: 'cleared',
        approved: true,
        import_id: txn.import_id, // Include import_id for correlation
      }));
      return { data: { transactions } };
    });

    const result = await executeReconciliation({
      ynabAPI: api,
      analysis,
      params,
      budgetId: params.budget_id,
      accountId: params.account_id,
      initialAccount,
      currencyCode: 'USD',
    });

    expect(result.summary.transactions_created).toBe(5);
    expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
    const payload = mocks.createTransactions.mock.calls[0]?.[1];
    expect(payload?.transactions).toHaveLength(5);
    expect(
      result.actions_taken.some((action) => action.type === 'balance_checkpoint'),
    ).toBe(true);
  });

  it('processes multiple chunks and halts at chunk boundaries when balance aligns', async () => {
    // Create 120 unmatched bank transactions of $10 each = $1200 total available
    // Set target balance to $500 (50 transactions worth)
    // This verifies that when >100 transactions exist but balance aligns after ~50,
    // the batch-building loop stops early and only processes one chunk (not two)
    const count = 120;
    const amountPerTxn = 10;
    const analysis = buildBulkAnalysis(count, amountPerTxn, 50); // statement multiplier = 50
    // This sets target to $500 (50 transactions * $10)
    const initialAccount = { ...defaultAccountSnapshot };
    const params = buildBulkParams(analysis.summary.target_statement_balance);
    const { api, mocks } = createMockYnabAPI(initialAccount);

    let chunkCallCount = 0;
    mocks.createTransactions.mockImplementation(async (_budgetId, body: any) => {
      chunkCallCount += 1;
      const transactions = (body.transactions ?? []).map((txn: any, index: number) => ({
        id: `multi-chunk-halt-${chunkCallCount}-${index}`,
        account_id: txn.account_id,
        amount: txn.amount,
        date: txn.date,
        cleared: 'cleared',
        approved: true,
        import_id: txn.import_id,
      }));
      return { data: { transactions } };
    });

    const result = await executeReconciliation({
      ynabAPI: api,
      analysis,
      params,
      budgetId: params.budget_id,
      accountId: params.account_id,
      initialAccount,
      currencyCode: 'USD',
    });

    // Verify that only ~50 transactions were created (not all 120)
    expect(result.summary.transactions_created).toBeLessThan(count);
    expect(result.summary.transactions_created).toBeGreaterThan(0);
    // Only 1 chunk should be processed (not 2), since balance aligns before second chunk
    expect(chunkCallCount).toBe(1);
    expect(
      result.actions_taken.some((action) => action.type === 'balance_checkpoint'),
    ).toBe(true);
    expect(result.bulk_operation_details).toEqual(
      expect.objectContaining({
        chunks_processed: 1,
        bulk_successes: 1,
      }),
    );
  });

  it('simulates bulk preview during dry-run mode', async () => {
    const analysis = buildBulkAnalysis(5, 9);
    const params = buildBulkParams(analysis.summary.target_statement_balance, { dry_run: true });
    const initialAccount = { ...defaultAccountSnapshot };
    const { api, mocks } = createMockYnabAPI(initialAccount);

    const result = await executeReconciliation({
      ynabAPI: api,
      analysis,
      params,
      budgetId: params.budget_id,
      accountId: params.account_id,
      initialAccount,
      currencyCode: 'USD',
    });

    expect(mocks.createTransactions).not.toHaveBeenCalled();
    const createActions = result.actions_taken.filter(
      (action) => action.type === 'create_transaction',
    );
    expect(createActions).toHaveLength(5);
    expect(result.summary.transactions_created).toBe(5);
    expect(result.bulk_operation_details).toBeUndefined();
  });
});
