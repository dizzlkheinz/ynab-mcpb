import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import * as ynab from 'ynab';
import { executeReconciliation, type AccountSnapshot } from '../executor.js';
import type { ReconciliationAnalysis } from '../types.js';
import type { ReconcileAccountRequest } from '../index.js';
import { getTestConfig, skipOnRateLimit } from '../../../__tests__/testUtils.js';

const config = getTestConfig();
const describeIntegration = config.skipE2ETests ? describe.skip : describe;

describeIntegration('Reconciliation Executor - Bulk Create Integration', () => {
  let ynabAPI: ynab.API;
  let budgetId: string;
  let accountId: string;
  let accountSnapshot: AccountSnapshot;
  const createdTransactionIds: string[] = [];

  beforeAll(async () => {
    if (!config.hasRealApiKey) {
      throw new Error('YNAB_ACCESS_TOKEN is required for reconciliation integration tests');
    }
    const accessToken = process.env['YNAB_ACCESS_TOKEN'];
    if (!accessToken) {
      throw new Error('YNAB_ACCESS_TOKEN must be set to run integration tests');
    }
    ynabAPI = new ynab.API(accessToken);
    budgetId = config.testBudgetId ?? (await resolveDefaultBudgetId(ynabAPI));
    accountId = config.testAccountId ?? (await resolveDefaultAccountId(ynabAPI, budgetId));
  });

  beforeEach(async () => {
    accountSnapshot = await fetchAccountSnapshot(ynabAPI, budgetId, accountId);
  });

  afterEach(async () => {
    while (createdTransactionIds.length > 0) {
      const transactionId = createdTransactionIds.pop();
      if (!transactionId) continue;
      await skipOnRateLimit(async () => {
        await ynabAPI.transactions.deleteTransaction(budgetId, transactionId);
      });
    }
  });

  it(
    'creates 10 transactions via bulk mode',
    async function () {
      const analysis = buildIntegrationAnalysis(accountSnapshot, 10, 7);
      const params = buildIntegrationParams(accountId, budgetId, analysis.summary.target_statement_balance);

      const result = await skipOnRateLimit(
        () =>
          executeReconciliation({
            ynabAPI,
            analysis,
            params,
            budgetId,
            accountId,
            initialAccount: accountSnapshot,
            currencyCode: 'USD',
          }),
        this,
      );
      if (!result) return;

      trackCreatedTransactions(result);
      expect(result.summary.transactions_created).toBe(10);
      expect(result.bulk_operation_details?.bulk_successes).toBeGreaterThanOrEqual(1);
      expect(result.bulk_operation_details?.chunks_processed).toBe(1);
    },
    60000,
  );

  it(
    'reports duplicates when import IDs already exist',
    async function () {
      const analysis = buildIntegrationAnalysis(accountSnapshot, 2, 9);
      const params = buildIntegrationParams(accountId, budgetId, analysis.summary.target_statement_balance);

      const firstRun = await skipOnRateLimit(
        () =>
          executeReconciliation({
            ynabAPI,
            analysis,
            params,
            budgetId,
            accountId,
            initialAccount: accountSnapshot,
            currencyCode: 'USD',
          }),
        this,
      );
      if (!firstRun) return;
      trackCreatedTransactions(firstRun);

      const duplicateAttempt = await skipOnRateLimit(
        () =>
          executeReconciliation({
            ynabAPI,
            analysis,
            params,
            budgetId,
            accountId,
            initialAccount: accountSnapshot,
            currencyCode: 'USD',
          }),
        this,
      );
      if (!duplicateAttempt) return;

      const duplicateActions = duplicateAttempt.actions_taken.filter(
        (action) => action.duplicate === true,
      );
      expect(duplicateActions.length).toBeGreaterThan(0);
      expect(duplicateAttempt.bulk_operation_details?.duplicates_detected).toBeGreaterThan(0);
      expect(duplicateAttempt.summary.transactions_created).toBe(0);
    },
    60000,
  );

  it(
    'processes 150 transactions across multiple chunks',
    async function () {
      const analysis = buildIntegrationAnalysis(accountSnapshot, 150, 3);
      const params = buildIntegrationParams(accountId, budgetId, analysis.summary.target_statement_balance);

      const result = await skipOnRateLimit(
        () =>
          executeReconciliation({
            ynabAPI,
            analysis,
            params,
            budgetId,
            accountId,
            initialAccount: accountSnapshot,
            currencyCode: 'USD',
          }),
        this,
      );
      if (!result) return;
      trackCreatedTransactions(result);

      expect(result.summary.transactions_created).toBe(150);
      expect(result.bulk_operation_details?.chunks_processed).toBeGreaterThanOrEqual(2);
    },
    90000,
  );

  it(
    'processes 20 transactions in under 8 seconds',
    async function () {
      const analysis = buildIntegrationAnalysis(accountSnapshot, 20, 4);
      const params = buildIntegrationParams(accountId, budgetId, analysis.summary.target_statement_balance);
      const start = Date.now();

      const result = await skipOnRateLimit(
        () =>
          executeReconciliation({
            ynabAPI,
            analysis,
            params,
            budgetId,
            accountId,
            initialAccount: accountSnapshot,
            currencyCode: 'USD',
          }),
        this,
      );
      if (!result) return;
      trackCreatedTransactions(result);

      const duration = Date.now() - start;
      console.warn(`Bulk mode (20 txns): ${duration}ms`);
      expect(duration).toBeLessThan(8000);
    },
    60000,
  );

  it(
    'propagates API errors for invalid account IDs',
    async function () {
      const analysis = buildIntegrationAnalysis(accountSnapshot, 2, 6);
      const params = buildIntegrationParams('invalid-account', budgetId, analysis.summary.target_statement_balance);

      await skipOnRateLimit(async () => {
        await expect(
          executeReconciliation({
            ynabAPI,
            analysis,
            params,
            budgetId,
            accountId: 'invalid-account',
            initialAccount: accountSnapshot,
            currencyCode: 'USD',
          }),
        ).rejects.toThrow();
      }, this);
    },
    60000,
  );

  it('skips work when a rate limit error is detected', async () => {
    const fakeContext = { skip: vi.fn() };
    const rateLimitError = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
    const result = await skipOnRateLimit(async () => {
      throw rateLimitError;
    }, fakeContext);
    expect(result).toBeUndefined();
    expect(fakeContext.skip).toHaveBeenCalled();
  });

  function trackCreatedTransactions(result: Awaited<ReturnType<typeof executeReconciliation>>): void {
    for (const action of result.actions_taken) {
      if (action.type !== 'create_transaction') continue;
      const transaction = action.transaction as { id?: string } | null;
      if (transaction?.id) {
        createdTransactionIds.push(transaction.id);
      }
    }
  }
});

async function resolveDefaultBudgetId(api: ynab.API): Promise<string> {
  const budgets = await api.budgets.getBudgets();
  const budget = budgets.data.budgets[0];
  if (!budget) {
    throw new Error('No budgets available for integration testing');
  }
  return budget.id;
}

async function resolveDefaultAccountId(api: ynab.API, budgetId: string): Promise<string> {
  const accounts = await api.accounts.getAccounts(budgetId);
  const account = accounts.data.accounts.find((acct) => !acct.closed);
  if (!account) {
    throw new Error('No open accounts available for integration testing');
  }
  return account.id;
}

async function fetchAccountSnapshot(
  api: ynab.API,
  budgetId: string,
  accountId: string,
): Promise<AccountSnapshot> {
  const response = await api.accounts.getAccountById(budgetId, accountId);
  const account = response.data.account;
  return {
    balance: account.balance,
    cleared_balance: account.cleared_balance ?? account.balance,
    uncleared_balance: account.uncleared_balance ?? 0,
  };
}

function buildIntegrationAnalysis(
  snapshot: AccountSnapshot,
  count: number,
  transactionAmount: number,
): ReconciliationAnalysis {
  const clearedDollars = snapshot.cleared_balance / 1000;
  const totalDelta = transactionAmount * count;
  const statementBalance = clearedDollars + totalDelta;
  const baseDate = Date.parse('2025-12-01');

  return {
    success: true,
    phase: 'analysis',
    summary: {
      statement_date_range: 'Integration test',
      bank_transactions_count: count,
      ynab_transactions_count: 0,
      auto_matched: 0,
      suggested_matches: 0,
      unmatched_bank: count,
      unmatched_ynab: 0,
      current_cleared_balance: clearedDollars,
      target_statement_balance: statementBalance,
      discrepancy: totalDelta,
      discrepancy_explanation: 'Synthetic integration delta',
    },
    auto_matches: [],
    suggested_matches: [],
    unmatched_bank: Array.from({ length: count }, (_, index) => {
      const date = new Date(baseDate + index * 24 * 60 * 60 * 1000);
      return {
        id: `integration-bank-${index}`,
        date: date.toISOString().slice(0, 10),
        amount: transactionAmount,
        payee: `Integration Payee ${index}`,
        memo: `Integration memo ${index}`,
        original_csv_row: index + 1,
      };
    }),
    unmatched_ynab: [],
    balance_info: {
      current_cleared: clearedDollars,
      current_uncleared: snapshot.uncleared_balance / 1000,
      current_total: snapshot.balance / 1000,
      target_statement: statementBalance,
      discrepancy: totalDelta,
      on_track: false,
    },
    next_steps: [],
    insights: [],
  };
}

function buildIntegrationParams(
  accountId: string,
  budgetId: string,
  statementBalance: number,
  overrides: Partial<ReconcileAccountRequest> = {},
): ReconcileAccountRequest {
  return {
    budget_id: budgetId,
    account_id: accountId,
    csv_data: 'Date,Description,Amount',
    statement_balance: statementBalance,
    statement_date: new Date().toISOString().slice(0, 10),
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
    include_structured_data: false,
    ...overrides,
  };
}
