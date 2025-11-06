import { describe, it, expect } from 'vitest';
import type * as ynab from 'ynab';
import type { ReconciliationAnalysis } from '../types.js';
import { executeReconciliation, type AccountSnapshot } from '../executor.js';

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
    const mockGetAccount = vi.fn().mockResolvedValue({
      data: { account: { balance: -921240, cleared_balance: -921240, uncleared_balance: 0 } },
    });

    const mockTransactionsApi = {
      createTransaction: mockCreate,
      updateTransaction: mockUpdate,
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
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockGetAccount).toHaveBeenCalled();
    expect(result.summary.transactions_created).toBe(1);
    expect(result.summary.transactions_updated).toBeGreaterThanOrEqual(2);
    expect(result.summary.dates_adjusted).toBe(1);
    expect(result.actions_taken.length).toBeGreaterThanOrEqual(3);
    expect(result.summary.dry_run).toBe(false);
  });
});
