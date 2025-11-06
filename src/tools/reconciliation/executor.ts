import type * as ynab from 'ynab';
import { toMilli, toMoneyValue, toMoneyValueFromDecimal, addMilli } from '../../utils/money.js';
import type { ReconciliationAnalysis, TransactionMatch } from './types.js';
import type { ReconcileAccountV2Request } from './index.js';

export interface AccountSnapshot {
  balance: number; // milliunits
  cleared_balance: number; // milliunits
  uncleared_balance: number; // milliunits
}

export interface ExecutionOptions {
  ynabAPI: ynab.API;
  analysis: ReconciliationAnalysis;
  params: ReconcileAccountV2Request;
  budgetId: string;
  accountId: string;
  initialAccount: AccountSnapshot;
  currencyCode: string;
}

export interface ExecutionActionRecord {
  type: string;
  transaction: Record<string, unknown> | null;
  reason: string;
}

export interface ExecutionSummary {
  bank_transactions_count: number;
  ynab_transactions_count: number;
  matches_found: number;
  missing_in_ynab: number;
  missing_in_bank: number;
  transactions_created: number;
  transactions_updated: number;
  dates_adjusted: number;
  dry_run: boolean;
}

export interface ExecutionResult {
  summary: ExecutionSummary;
  account_balance: {
    before: AccountSnapshot;
    after: AccountSnapshot;
  };
  actions_taken: ExecutionActionRecord[];
  recommendations: string[];
  balance_reconciliation?: Awaited<ReturnType<typeof buildBalanceReconciliation>>;
}

interface UpdateFlags {
  needsClearedUpdate: boolean;
  needsDateUpdate: boolean;
}

const MONEY_EPSILON_MILLI = 100; // $0.10

export async function executeReconciliation(options: ExecutionOptions): Promise<ExecutionResult> {
  const { analysis, params, ynabAPI, budgetId, accountId, initialAccount, currencyCode } = options;
  const actions_taken: ExecutionActionRecord[] = [];

  const summary: ExecutionSummary = {
    bank_transactions_count: analysis.summary.bank_transactions_count,
    ynab_transactions_count: analysis.summary.ynab_transactions_count,
    matches_found: analysis.auto_matches.length,
    missing_in_ynab: analysis.summary.unmatched_bank,
    missing_in_bank: analysis.summary.unmatched_ynab,
    transactions_created: 0,
    transactions_updated: 0,
    dates_adjusted: 0,
    dry_run: params.dry_run,
  };

  let afterAccount: AccountSnapshot = { ...initialAccount };
  let accountSnapshotDirty = false;

  // STEP 1: Auto-create missing transactions (bank -> YNAB)
  if (params.auto_create_transactions) {
    for (const bankTxn of analysis.unmatched_bank) {
      if (params.dry_run) {
        summary.transactions_created += 1;
        actions_taken.push({
          type: 'create_transaction',
          transaction: {
            date: bankTxn.date,
            amount_milliunits: toMilli(bankTxn.amount),
            payee_name: bankTxn.payee ?? undefined,
          },
          reason: `Would create missing transaction: ${bankTxn.payee ?? 'Unknown'} (${formatDisplay(bankTxn.amount, currencyCode)})`,
        });
        continue;
      }

      const response = await ynabAPI.transactions.createTransaction(budgetId, {
        transaction: {
          account_id: accountId,
          amount: toMilli(bankTxn.amount),
          date: bankTxn.date,
          payee_name: bankTxn.payee ?? undefined,
          memo: bankTxn.memo ?? 'Auto-reconciled from bank statement',
          cleared: 'cleared',
          approved: true,
        },
      });

      const createdTransaction = response.data.transaction ?? null;
      summary.transactions_created += 1;
      actions_taken.push({
        type: 'create_transaction',
        transaction: createdTransaction as unknown as Record<string, unknown> | null,
        reason: `Created missing transaction: ${bankTxn.payee ?? 'Unknown'} (${formatDisplay(bankTxn.amount, currencyCode)})`,
      });
      accountSnapshotDirty = true;
    }
  }

  // STEP 2: Update matched YNAB transactions (cleared status / date)
  for (const match of analysis.auto_matches) {
    const flags = computeUpdateFlags(match, params);
    if (!flags.needsClearedUpdate && !flags.needsDateUpdate) continue;

    if (params.dry_run) {
      summary.transactions_updated += 1;
      if (flags.needsDateUpdate) summary.dates_adjusted += 1;
      actions_taken.push({
        type: 'update_transaction',
        transaction: {
          transaction_id: match.ynab_transaction?.id,
          new_date: flags.needsDateUpdate ? match.bank_transaction.date : undefined,
          cleared: flags.needsClearedUpdate ? 'cleared' : undefined,
        },
        reason: `Would update transaction: ${updateReason(match, flags, currencyCode)}`,
      });
      continue;
    }

    if (!match.ynab_transaction) continue;
    const updatePayload: Record<string, unknown> = {
      account_id: accountId,
      amount: match.ynab_transaction.amount,
      date: flags.needsDateUpdate ? match.bank_transaction.date : match.ynab_transaction.date,
      cleared: flags.needsClearedUpdate ? 'cleared' : match.ynab_transaction.cleared,
      payee_name: match.ynab_transaction.payee_name ?? undefined,
      memo: match.ynab_transaction.memo ?? undefined,
      approved: match.ynab_transaction.approved,
    };

    const response = await ynabAPI.transactions.updateTransaction(
      budgetId,
      match.ynab_transaction.id,
      {
        transaction: updatePayload as ynab.ExistingTransaction,
      },
    );
    const updatedTransaction = response.data.transaction ?? null;
    summary.transactions_updated += 1;
    if (flags.needsDateUpdate) summary.dates_adjusted += 1;
    actions_taken.push({
      type: 'update_transaction',
      transaction: updatedTransaction as unknown as Record<string, unknown> | null,
      reason: `Updated transaction: ${updateReason(match, flags, currencyCode)}`,
    });
    accountSnapshotDirty = true;
  }

  // STEP 3: Auto-unclear YNAB transactions missing from bank
  if (params.auto_unclear_missing) {
    for (const ynabTxn of analysis.unmatched_ynab) {
      if (ynabTxn.cleared !== 'cleared') continue;

      if (params.dry_run) {
        summary.transactions_updated += 1;
        actions_taken.push({
          type: 'update_transaction',
          transaction: { transaction_id: ynabTxn.id, cleared: 'uncleared' },
          reason: `Would mark transaction ${ynabTxn.id} as uncleared - not present on statement`,
        });
        continue;
      }

      const response = await ynabAPI.transactions.updateTransaction(budgetId, ynabTxn.id, {
        transaction: {
          cleared: 'uncleared',
        },
      });
      const updatedTransaction = response.data.transaction ?? null;
      summary.transactions_updated += 1;
      actions_taken.push({
        type: 'update_transaction',
        transaction: updatedTransaction as unknown as Record<string, unknown> | null,
        reason: `Marked transaction ${ynabTxn.id} as uncleared - not found on statement`,
      });
      accountSnapshotDirty = true;
    }
  }

  // STEP 4: Balance reconciliation snapshot (only once per execution)
  let balance_reconciliation: ExecutionResult['balance_reconciliation'];
  if (params.statement_balance !== undefined && params.statement_date) {
    balance_reconciliation = await buildBalanceReconciliation({
      ynabAPI,
      budgetId,
      accountId,
      statementDate: params.statement_date,
      statementBalance: params.statement_balance,
      analysis,
    });
  }

  // STEP 5: Recommendations and balance changes
  if (!params.dry_run && accountSnapshotDirty) {
    afterAccount = await refreshAccountSnapshot(ynabAPI, budgetId, accountId);
  }

  const balanceChangeMilli =
    params.dry_run || !accountSnapshotDirty ? 0 : afterAccount.balance - initialAccount.balance;

  const recommendations = buildRecommendations({
    summary,
    params,
    analysis,
    balanceChangeMilli,
    currencyCode,
  });

  const result: ExecutionResult = {
    summary,
    account_balance: {
      before: initialAccount,
      after: afterAccount,
    },
    actions_taken,
    recommendations,
  };

  if (balance_reconciliation !== undefined) {
    result.balance_reconciliation = balance_reconciliation;
  }

  return result;
}

function formatDisplay(amount: number, currency: string): string {
  return toMoneyValueFromDecimal(amount, currency).value_display;
}

function computeUpdateFlags(
  match: TransactionMatch,
  params: ReconcileAccountV2Request,
): UpdateFlags {
  const ynabTxn = match.ynab_transaction;
  const bankTxn = match.bank_transaction;
  if (!ynabTxn) {
    return { needsClearedUpdate: false, needsDateUpdate: false };
  }
  const needsClearedUpdate = Boolean(
    params.auto_update_cleared_status && ynabTxn.cleared !== 'cleared',
  );
  const needsDateUpdate = Boolean(params.auto_adjust_dates && ynabTxn.date !== bankTxn.date);
  return { needsClearedUpdate, needsDateUpdate };
}

function updateReason(match: TransactionMatch, flags: UpdateFlags, _currency: string): string {
  const parts: string[] = [];
  if (flags.needsClearedUpdate) {
    parts.push('marked as cleared');
  }
  if (flags.needsDateUpdate) {
    parts.push(`date adjusted to ${match.bank_transaction.date}`);
  }
  return parts.join(', ');
}

async function buildBalanceReconciliation(args: {
  ynabAPI: ynab.API;
  budgetId: string;
  accountId: string;
  statementDate: string;
  statementBalance: number;
  analysis: ReconciliationAnalysis;
}) {
  const { ynabAPI, budgetId, accountId, statementDate, statementBalance } = args;
  const ynabMilli = await clearedBalanceAsOf(ynabAPI, budgetId, accountId, statementDate);
  const bankMilli = toMilli(statementBalance);
  const discrepancy = bankMilli - ynabMilli;
  const status = discrepancy === 0 ? 'PERFECTLY_RECONCILED' : 'DISCREPANCY_FOUND';

  const precision_calculations = {
    bank_statement_balance_milliunits: bankMilli,
    ynab_calculated_balance_milliunits: ynabMilli,
    discrepancy_milliunits: discrepancy,
    discrepancy_dollars: discrepancy / 1000,
  };

  const discrepancy_analysis = discrepancy === 0 ? undefined : buildLikelyCauses(discrepancy);

  const result: {
    status: string;
    precision_calculations: typeof precision_calculations;
    discrepancy_analysis?: ReturnType<typeof buildLikelyCauses>;
    final_verification: {
      balance_matches_exactly: boolean;
      all_transactions_accounted: boolean;
      audit_trail_complete: boolean;
      reconciliation_complete: boolean;
    };
  } = {
    status,
    precision_calculations,
    final_verification: {
      balance_matches_exactly: discrepancy === 0,
      all_transactions_accounted: discrepancy === 0,
      audit_trail_complete: discrepancy === 0,
      reconciliation_complete: discrepancy === 0,
    },
  };

  if (discrepancy_analysis !== undefined) {
    result.discrepancy_analysis = discrepancy_analysis;
  }

  return result;
}

async function clearedBalanceAsOf(
  api: ynab.API,
  budgetId: string,
  accountId: string,
  dateISO: string,
): Promise<number> {
  const response = await api.transactions.getTransactionsByAccount(budgetId, accountId);
  const asOf = new Date(dateISO);
  const cleared = response.data.transactions.filter(
    (txn) => txn.cleared === 'cleared' && new Date(txn.date) <= asOf,
  );
  const sum = cleared.reduce((acc, txn) => addMilli(acc, txn.amount ?? 0), 0);
  return sum;
}

async function refreshAccountSnapshot(
  api: ynab.API,
  budgetId: string,
  accountId: string,
): Promise<AccountSnapshot> {
  const accountsApi = api.accounts as typeof api.accounts & {
    getAccount?: (budgetId: string, accountId: string) => Promise<ynab.AccountResponse>;
  };
  const response = accountsApi.getAccount
    ? await accountsApi.getAccount(budgetId, accountId)
    : await accountsApi.getAccountById(budgetId, accountId);
  const account = response.data.account;
  return {
    balance: account.balance,
    cleared_balance: account.cleared_balance,
    uncleared_balance: account.uncleared_balance,
  };
}

function buildLikelyCauses(discrepancyMilli: number) {
  const causes = [] as {
    cause_type: string;
    description: string;
    confidence: number;
    amount_milliunits: number;
    suggested_resolution: string;
    evidence: unknown[];
  }[];

  const abs = Math.abs(discrepancyMilli);
  if (abs % 1000 === 0 || abs % 500 === 0) {
    causes.push({
      cause_type: 'bank_fee',
      description: 'Round amount suggests a bank fee or interest adjustment.',
      confidence: 0.8,
      amount_milliunits: discrepancyMilli,
      suggested_resolution:
        discrepancyMilli < 0
          ? 'Create bank fee transaction and mark cleared'
          : 'Record interest income',
      evidence: [],
    });
  }

  return causes.length > 0
    ? {
        confidence_level: Math.max(...causes.map((cause) => cause.confidence)),
        likely_causes: causes,
        risk_assessment: 'LOW',
      }
    : undefined;
}

function buildRecommendations(args: {
  summary: ExecutionSummary;
  params: ReconcileAccountV2Request;
  analysis: ReconciliationAnalysis;
  balanceChangeMilli: number;
  currencyCode: string;
}): string[] {
  const { summary, params, analysis, balanceChangeMilli, currencyCode } = args;
  const recommendations: string[] = [];

  if (summary.dates_adjusted > 0) {
    recommendations.push(
      `✅ Adjusted ${summary.dates_adjusted} transaction date(s) to match bank statement dates`,
    );
  }

  if (analysis.summary.unmatched_bank > 0 && !params.auto_create_transactions) {
    recommendations.push(
      `Consider enabling auto_create_transactions to automatically create ${analysis.summary.unmatched_bank} missing transaction(s)`,
    );
  }

  if (!params.auto_adjust_dates && analysis.auto_matches.length > 0) {
    recommendations.push(
      'Consider enabling auto_adjust_dates to align YNAB dates with bank statement dates',
    );
  }

  if (analysis.summary.unmatched_ynab > 0) {
    recommendations.push(
      `${analysis.summary.unmatched_ynab} transaction(s) exist in YNAB but not on the bank statement — review for duplicates or pending items`,
    );
  }

  if (params.dry_run) {
    recommendations.push('Dry run only — re-run with dry_run=false to apply these changes');
  }

  if (Math.abs(balanceChangeMilli) > MONEY_EPSILON_MILLI) {
    recommendations.push(
      `Account balance changed by ${toMoneyValue(balanceChangeMilli, currencyCode).value_display} during reconciliation`,
    );
  }

  return recommendations;
}

export type { ExecutionResult as LegacyReconciliationResult };
