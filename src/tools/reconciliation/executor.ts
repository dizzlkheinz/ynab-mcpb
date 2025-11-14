import { createHash } from 'crypto';
import type * as ynab from 'ynab';
import { toMilli, toMoneyValue, toMoneyValueFromDecimal, addMilli } from '../../utils/money.js';
import type { ReconciliationAnalysis, TransactionMatch, BankTransaction } from './types.js';
import type { ReconcileAccountRequest } from './index.js';
import {
  generateCorrelationKey,
  correlateResults,
  toCorrelationPayload,
} from '../transactionTools.js';

export interface AccountSnapshot {
  balance: number; // milliunits
  cleared_balance: number; // milliunits
  uncleared_balance: number; // milliunits
}

export interface ExecutionOptions {
  ynabAPI: ynab.API;
  analysis: ReconciliationAnalysis;
  params: ReconcileAccountRequest;
  budgetId: string;
  accountId: string;
  initialAccount: AccountSnapshot;
  currencyCode: string;
}

export interface ExecutionActionRecord {
  type: string;
  transaction: Record<string, unknown> | null;
  reason: string;
  bulk_chunk_index?: number;
  correlation_key?: string;
  duplicate?: boolean;
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

/**
 * Bulk operation metrics for reconciliation transaction creation.
 *
 * Note on failure counters:
 * - `transaction_failures` is the canonical counter for per-transaction failures
 * - `failed_transactions` is maintained for backward compatibility and should always
 *   mirror `transaction_failures` rather than represent an independent count
 */
export interface BulkOperationDetails {
  chunks_processed: number;
  bulk_successes: number;
  sequential_fallbacks: number;
  duplicates_detected: number;
  failed_transactions: number; // Backward-compatible alias for transaction_failures
  bulk_chunk_failures: number; // API-level failures (entire chunk failed)
  transaction_failures: number; // Per-transaction failures (from correlation or sequential)
  sequential_attempts?: number; // Number of sequential creations attempted during fallback
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
  bulk_operation_details?: BulkOperationDetails;
}

interface UpdateFlags {
  needsClearedUpdate: boolean;
  needsDateUpdate: boolean;
}

const MONEY_EPSILON_MILLI = 100; // $0.10
const DEFAULT_TOLERANCE_CENTS = 1;
const CENTS_TO_MILLI = 10;
const MAX_BULK_CREATE_CHUNK = 100;

function chunkArray<T>(array: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('chunk size must be positive');
  }
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

interface PreparedBulkCreateEntry {
  bankTransaction: BankTransaction;
  saveTransaction: ynab.SaveTransaction;
  amountMilli: number;
  correlationKey: string;
}

/**
 * Generates a deterministic import_id for reconciliation-created transactions.
 *
 * Uses a dedicated `YNAB:bulk:` prefix to distinguish reconciliation-created transactions
 * from manual bulk creates. This namespace separation is intentional:
 * - Reconciliation operations are automated and system-generated
 * - Manual bulk creates via create_transactions tool can use custom import_id formats
 * - Both interact with YNAB's global duplicate detection via the same import_id mechanism
 *
 * The hash-based correlation in transactionTools.ts uses `hash:` prefix for correlation
 * (when no import_id provided), which is separate from this import_id generation.
 */
function generateBulkImportId(
  accountId: string,
  date: string,
  amountMilli: number,
  payee?: string | null,
): string {
  const normalizedPayee = (payee ?? '').trim().toLowerCase();
  const raw = `${accountId}|${date}|${amountMilli}|${normalizedPayee}`;
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return `YNAB:bulk:${digest}`;
}

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
  const statementTargetMilli = resolveStatementBalanceMilli(
    analysis.balance_info,
    params.statement_balance,
  );
  let clearedDeltaMilli = addMilli(initialAccount.cleared_balance ?? 0, -statementTargetMilli);
  const balanceToleranceMilli =
    Math.max(0, params.amount_tolerance_cents ?? DEFAULT_TOLERANCE_CENTS) * CENTS_TO_MILLI;
  let balanceAligned = false;

  const applyClearedDelta = (delta: number) => {
    if (delta === 0) return;
    clearedDeltaMilli = addMilli(clearedDeltaMilli, delta);
  };

  const recordAlignmentIfNeeded = (trigger: string, { log = true } = {}) => {
    if (balanceAligned) {
      return true;
    }
    if (Math.abs(clearedDeltaMilli) <= balanceToleranceMilli) {
      balanceAligned = true;
      if (log) {
        const deltaDisplay = toMoneyValue(clearedDeltaMilli, currencyCode).value_display;
        const toleranceDisplay = toMoneyValue(balanceToleranceMilli, currencyCode).value_display;
        actions_taken.push({
          type: 'balance_checkpoint',
          transaction: null,
          reason: `Cleared delta ${deltaDisplay} within ±${toleranceDisplay} after ${trigger} - halting newest-to-oldest pass`,
        });
      }
      return true;
    }
    return false;
  };

  recordAlignmentIfNeeded('initial balance check', { log: false });

  const orderedUnmatchedBank = params.auto_create_transactions
    ? sortByDateDescending(analysis.unmatched_bank)
    : [];
  const orderedAutoMatches = sortMatchesByBankDateDescending(analysis.auto_matches);
  const orderedUnmatchedYNAB = sortByDateDescending(analysis.unmatched_ynab);

  let bulkOperationDetails: BulkOperationDetails | undefined;

  // STEP 1: Auto-create missing transactions (bank -> YNAB)
  if (params.auto_create_transactions && !balanceAligned) {
    const buildPreparedEntry = (bankTxn: BankTransaction): PreparedBulkCreateEntry => {
      const amountMilli = toMilli(bankTxn.amount);
      const saveTransaction: ynab.SaveTransaction = {
        account_id: accountId,
        amount: amountMilli,
        date: bankTxn.date,
        payee_name: bankTxn.payee ?? undefined,
        memo: bankTxn.memo ?? 'Auto-reconciled from bank statement',
        cleared: 'cleared',
        approved: true,
        import_id: generateBulkImportId(accountId, bankTxn.date, amountMilli, bankTxn.payee),
      };
      const correlationKey = generateCorrelationKey(toCorrelationPayload(saveTransaction));
      return {
        bankTransaction: bankTxn,
        saveTransaction,
        amountMilli,
        correlationKey,
      };
    };

    const recordCreateAction = (args: {
      entry: PreparedBulkCreateEntry;
      createdTxn: ynab.TransactionDetail | null;
      chunkIndex?: number;
      prefix?: string;
    }) => {
      const { entry, createdTxn, chunkIndex, prefix } = args;
      summary.transactions_created += 1;
      actions_taken.push({
        type: 'create_transaction',
        transaction: createdTxn as unknown as Record<string, unknown> | null,
        reason: `${prefix ?? 'Created missing transaction'}: ${
          entry.bankTransaction.payee ?? 'Unknown'
        } (${formatDisplay(entry.bankTransaction.amount, currencyCode)})`,
        bulk_chunk_index: chunkIndex,
        correlation_key: entry.correlationKey,
      });
    };

    const processSequentialEntries = async (
      entries: PreparedBulkCreateEntry[],
      options: { chunkIndex?: number; fallbackError?: unknown } = {},
    ) => {
      let sequentialAttempts = 0;
      for (const entry of entries) {
        if (balanceAligned) break;
        if (options.fallbackError) {
          sequentialAttempts += 1;
        }
        try {
          const response = await ynabAPI.transactions.createTransaction(budgetId, {
            transaction: entry.saveTransaction,
          });
          const createdTransaction = response.data.transaction ?? null;
          recordCreateAction({
            entry,
            createdTxn: createdTransaction,
            chunkIndex: options.chunkIndex,
            prefix: options.fallbackError
              ? 'Created missing transaction after bulk fallback'
              : 'Created missing transaction',
          });
          accountSnapshotDirty = true;
          applyClearedDelta(entry.amountMilli);
          const trigger = options.chunkIndex
            ? `creating ${entry.bankTransaction.payee ?? 'missing transaction'} (chunk ${options.chunkIndex})`
            : `creating ${entry.bankTransaction.payee ?? 'missing transaction'}`;
          recordAlignmentIfNeeded(trigger);
        } catch (error) {
          if (bulkOperationDetails) {
            bulkOperationDetails.transaction_failures += 1; // Canonical counter for per-transaction failures
          }
          const failureReason =
            error instanceof Error ? error.message : 'Unknown error occurred';
          actions_taken.push({
            type: 'create_transaction_failed',
            transaction: entry.saveTransaction as unknown as Record<string, unknown>,
            reason: options.fallbackError
              ? `Bulk fallback failed for ${entry.bankTransaction.payee ?? 'Unknown'} (${failureReason})`
              : `Failed to create transaction ${entry.bankTransaction.payee ?? 'Unknown'} (${failureReason})`,
            bulk_chunk_index: options.chunkIndex,
            correlation_key: entry.correlationKey,
          });
        }
      }
      // Update sequential_attempts metric if this was a fallback operation
      if (bulkOperationDetails && options.fallbackError && sequentialAttempts > 0) {
        bulkOperationDetails.sequential_attempts = (bulkOperationDetails.sequential_attempts ?? 0) + sequentialAttempts;
      }
    };

    const processBulkChunk = async (chunk: PreparedBulkCreateEntry[], chunkIndex: number) => {
      // bulkOperationDetails is guaranteed to be defined when this function is called
      // (it's only called from within the bulk operation block where it's initialized)
      const bulkDetails = bulkOperationDetails!;

      const payload = chunk.map((entry) => entry.saveTransaction);
      const response = await ynabAPI.transactions.createTransactions(budgetId, {
        transactions: payload,
      });
      const responseData = response.data;
      const duplicateImportIds = new Set(responseData.duplicate_import_ids ?? []);
      const correlationRequests = chunk.map((entry) =>
        toCorrelationPayload(entry.saveTransaction)
      ) as Parameters<typeof correlateResults>[0];
      const correlated = correlateResults(correlationRequests, responseData, duplicateImportIds);
      const transactionMap = new Map<string, ynab.TransactionDetail>();
      for (const transaction of responseData.transactions ?? []) {
        if (transaction.id) {
          transactionMap.set(transaction.id, transaction);
        }
      }
      for (const result of correlated) {
        const entry = chunk[result.request_index];
        if (!entry) continue;
        if (result.status === 'created') {
          const createdTransaction = result.transaction_id
            ? transactionMap.get(result.transaction_id) ?? null
            : null;
          recordCreateAction({
            entry,
            createdTxn: createdTransaction,
            chunkIndex,
            prefix: 'Created missing transaction via bulk',
          });
          accountSnapshotDirty = true;
          applyClearedDelta(entry.amountMilli);
          recordAlignmentIfNeeded(
            `creating ${entry.bankTransaction.payee ?? 'missing transaction'} via bulk chunk ${chunkIndex}`,
          );
        } else if (result.status === 'duplicate') {
          bulkDetails.duplicates_detected += 1;
          actions_taken.push({
            type: 'create_transaction_duplicate',
            transaction: {
              transaction_id: result.transaction_id ?? null,
              import_id: entry.saveTransaction.import_id,
            },
            reason: `Duplicate import detected for ${
              entry.bankTransaction.payee ?? 'Unknown'
            } (import_id ${entry.saveTransaction.import_id})`,
            bulk_chunk_index: chunkIndex,
            correlation_key: result.correlation_key,
            duplicate: true,
          });
        } else {
          bulkDetails.transaction_failures += 1; // Canonical counter for per-transaction failures
          actions_taken.push({
            type: 'create_transaction_failed',
            transaction: entry.saveTransaction as unknown as Record<string, unknown>,
            reason:
              result.error ??
              `Bulk create failed for ${entry.bankTransaction.payee ?? 'Unknown'}`,
            bulk_chunk_index: chunkIndex,
            correlation_key: result.correlation_key,
          });
        }
      }
    };

    if (params.dry_run) {
      for (const bankTxn of orderedUnmatchedBank) {
        if (balanceAligned) break;
        const entry = buildPreparedEntry(bankTxn);
        summary.transactions_created += 1;
        actions_taken.push({
          type: 'create_transaction',
          transaction: entry.saveTransaction as unknown as Record<string, unknown>,
          reason: `Would create missing transaction: ${bankTxn.payee ?? 'Unknown'} (${formatDisplay(bankTxn.amount, currencyCode)})`,
          correlation_key: entry.correlationKey,
        });
        applyClearedDelta(entry.amountMilli);
        recordAlignmentIfNeeded(`creating ${bankTxn.payee ?? 'missing transaction'}`);
      }
    } else if (orderedUnmatchedBank.length >= 2) {
      bulkOperationDetails = {
        chunks_processed: 0,
        bulk_successes: 0,
        sequential_fallbacks: 0,
        duplicates_detected: 0,
        failed_transactions: 0,
        bulk_chunk_failures: 0,
        transaction_failures: 0,
      };

      let nextBankIndex = 0;
      while (nextBankIndex < orderedUnmatchedBank.length && !balanceAligned) {
        const batch: PreparedBulkCreateEntry[] = [];
        let projectedDelta = clearedDeltaMilli;
        while (nextBankIndex < orderedUnmatchedBank.length) {
          const bankTxn = orderedUnmatchedBank[nextBankIndex];
          const entry = buildPreparedEntry(bankTxn);
          batch.push(entry);
          nextBankIndex += 1;
          projectedDelta = addMilli(projectedDelta, entry.amountMilli);
          if (Math.abs(projectedDelta) <= balanceToleranceMilli) {
            break;
          }
        }

        if (batch.length === 0) {
          break;
        }

        const chunks = chunkArray(batch, MAX_BULK_CREATE_CHUNK);
        for (const chunk of chunks) {
          if (balanceAligned) break;
          bulkOperationDetails.chunks_processed += 1;
          const chunkIndex = bulkOperationDetails.chunks_processed;
          try {
            await processBulkChunk(chunk, chunkIndex);
            bulkOperationDetails.bulk_successes += 1;
          } catch (error) {
            bulkOperationDetails.sequential_fallbacks += 1;
            bulkOperationDetails.bulk_chunk_failures += 1; // API-level failure (entire chunk failed)
            actions_taken.push({
              type: 'bulk_create_fallback',
              transaction: null,
              reason: `Bulk chunk #${chunkIndex} failed (${
                error instanceof Error ? error.message : 'unknown error'
              }) - falling back to sequential creation`,
              bulk_chunk_index: chunkIndex,
            });
            await processSequentialEntries(chunk, { chunkIndex, fallbackError: error });
          }
        }
      }
    } else {
      const entries = orderedUnmatchedBank.map((bankTxn) => buildPreparedEntry(bankTxn));
      await processSequentialEntries(entries);
    }
  }

  // STEP 2: Update matched YNAB transactions (cleared status / date)
  // Collect all updates for batch processing
  if (!balanceAligned) {
    const transactionsToUpdate: ynab.SaveTransactionWithIdOrImportId[] = [];

    for (const match of orderedAutoMatches) {
      if (balanceAligned) break;
      const flags = computeUpdateFlags(match, params);
      if (!flags.needsClearedUpdate && !flags.needsDateUpdate) continue;
      if (!match.ynab_transaction) continue;

      const updatePayload: ynab.SaveTransactionWithIdOrImportId = {
        id: match.ynab_transaction.id,
        account_id: accountId,
        amount: match.ynab_transaction.amount,
        date: flags.needsDateUpdate ? match.bank_transaction.date : match.ynab_transaction.date,
        cleared: (flags.needsClearedUpdate ? 'cleared' : match.ynab_transaction.cleared) as ynab.TransactionClearedStatus,
        payee_name: match.ynab_transaction.payee_name ?? null,
        memo: match.ynab_transaction.memo ?? null,
        approved: match.ynab_transaction.approved,
      };

      if (params.dry_run) {
        summary.transactions_updated += 1;
        if (flags.needsDateUpdate) summary.dates_adjusted += 1;
        actions_taken.push({
          type: 'update_transaction',
          transaction: {
            transaction_id: match.ynab_transaction.id,
            new_date: flags.needsDateUpdate ? match.bank_transaction.date : undefined,
            cleared: flags.needsClearedUpdate ? 'cleared' : undefined,
          },
          reason: `Would update transaction: ${updateReason(match, flags, currencyCode)}`,
        });
        if (flags.needsClearedUpdate) {
          applyClearedDelta(match.ynab_transaction.amount);
          if (
            recordAlignmentIfNeeded(
              `clearing ${match.ynab_transaction.id ?? 'transaction'} (dry run)`,
            )
          ) {
            break;
          }
        }
      } else {
        transactionsToUpdate.push(updatePayload);
        if (flags.needsDateUpdate) summary.dates_adjusted += 1;
        if (flags.needsClearedUpdate) {
          applyClearedDelta(match.ynab_transaction.amount);
          if (recordAlignmentIfNeeded(`clearing ${match.ynab_transaction.id}`)) {
            break;
          }
        }
      }
    }

    // Batch update all transactions in a single API call
    if (!params.dry_run && transactionsToUpdate.length > 0) {
      const response = await ynabAPI.transactions.updateTransactions(budgetId, {
        transactions: transactionsToUpdate,
      });

      const updatedTransactions = response.data.transactions ?? [];
      summary.transactions_updated += updatedTransactions.length;

      for (const updatedTransaction of updatedTransactions) {
        const match = orderedAutoMatches.find(m => m.ynab_transaction?.id === updatedTransaction.id);
        const flags = match ? computeUpdateFlags(match, params) : { needsClearedUpdate: false, needsDateUpdate: false };
        actions_taken.push({
          type: 'update_transaction',
          transaction: updatedTransaction as unknown as Record<string, unknown> | null,
          reason: `Updated transaction: ${match ? updateReason(match, flags, currencyCode) : 'cleared'}`,
        });
      }
      accountSnapshotDirty = true;
    }
  }

  // STEP 3: Auto-unclear YNAB transactions missing from bank
  const shouldRunSanityPass = params.auto_unclear_missing && !balanceAligned;
  if (shouldRunSanityPass) {
    const transactionsToUnclear: ynab.SaveTransactionWithIdOrImportId[] = [];

    for (const ynabTxn of orderedUnmatchedYNAB) {
      if (ynabTxn.cleared !== 'cleared') continue;
      if (balanceAligned) break;

      if (params.dry_run) {
        summary.transactions_updated += 1;
        actions_taken.push({
          type: 'update_transaction',
          transaction: { transaction_id: ynabTxn.id, cleared: 'uncleared' },
          reason: `Would mark transaction ${ynabTxn.id} as uncleared - not present on statement`,
        });
        applyClearedDelta(-ynabTxn.amount);
        if (recordAlignmentIfNeeded(`unclearing ${ynabTxn.id} (dry run)`)) {
          break;
        }
      } else {
        transactionsToUnclear.push({
          id: ynabTxn.id,
          cleared: 'uncleared' as ynab.TransactionClearedStatus,
        });
        applyClearedDelta(-ynabTxn.amount);
        if (recordAlignmentIfNeeded(`unclearing ${ynabTxn.id}`)) {
          break;
        }
      }
    }

    // Batch update all unclear operations in a single API call
    if (!params.dry_run && transactionsToUnclear.length > 0) {
      const response = await ynabAPI.transactions.updateTransactions(budgetId, {
        transactions: transactionsToUnclear,
      });

      const updatedTransactions = response.data.transactions ?? [];
      summary.transactions_updated += updatedTransactions.length;

      for (const updatedTransaction of updatedTransactions) {
        actions_taken.push({
          type: 'update_transaction',
          transaction: updatedTransaction as unknown as Record<string, unknown> | null,
          reason: `Marked transaction ${updatedTransaction.id} as uncleared - not found on statement`,
        });
      }
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

  if (bulkOperationDetails) {
    // Ensure failed_transactions mirrors transaction_failures for backward compatibility
    bulkOperationDetails.failed_transactions = bulkOperationDetails.transaction_failures;
    result.bulk_operation_details = bulkOperationDetails;
  }

  return result;
}

function formatDisplay(amount: number, currency: string): string {
  return toMoneyValueFromDecimal(amount, currency).value_display;
}

function computeUpdateFlags(
  match: TransactionMatch,
  params: ReconcileAccountRequest,
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
  params: ReconcileAccountRequest;
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

function resolveStatementBalanceMilli(
  balanceInfo: ReconciliationAnalysis['balance_info'],
  provided?: number,
): number {
  if (typeof provided === 'number' && Number.isFinite(provided)) {
    return toMilli(provided);
  }

  return (
    extractMoneyValue(balanceInfo?.target_statement) ??
    extractMoneyValue(balanceInfo?.current_cleared) ??
    0
  );
}

function extractMoneyValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toMilli(value);
  }
  if (
    value &&
    typeof value === 'object' &&
    'value_milliunits' in value &&
    typeof (value as { value_milliunits: unknown }).value_milliunits === 'number'
  ) {
    return (value as { value_milliunits: number }).value_milliunits;
  }
  return undefined;
}

function sortByDateDescending<T extends { date: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareDates(b.date, a.date));
}

function sortMatchesByBankDateDescending(matches: TransactionMatch[]): TransactionMatch[] {
  return [...matches].sort((a, b) =>
    compareDates(b.bank_transaction.date, a.bank_transaction.date),
  );
}

function compareDates(dateA: string, dateB: string): number {
  return toChronoValue(dateA) - toChronoValue(dateB);
}

function toChronoValue(date: string): number {
  const parsed = Date.parse(date);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  const fallback = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(fallback) ? 0 : fallback;
}
