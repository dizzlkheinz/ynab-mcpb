import type * as ynab from "ynab";
import type { NewTransaction } from "ynab";
import type { ProgressCallback } from "../../server/toolRegistry.js";
import { addMilli, toMoneyValue } from "../../utils/money.js";
import {
	correlateResults,
	generateCorrelationKey,
	toCorrelationPayload,
} from "../transactionTools.js";
import {
	buildBalanceReconciliation,
	resolveStatementBalanceMilli,
} from "./balanceReconciliation.js";
import {
	attachStatusToError,
	normalizeYnabError,
	shouldPropagateYnabError,
} from "./executorErrors.js";
import {
	buildRecommendations,
	chunkArray,
	computeUpdateFlags,
	type ExecutionSummary,
	formatDisplay,
	sleep,
	sortByDateDescending,
	sortMatchesByBankDateDescending,
	truncateMemo,
	updateReason,
} from "./executorHelpers.js";
import type { ReconcileAccountRequest } from "./index.js";
import type { BankTransaction, ReconciliationAnalysis } from "./types.js";

// Re-export extracted types/functions for backward compatibility
export type { NormalizedYnabError } from "./executorErrors.js";
export {
	normalizeYnabError,
	shouldPropagateYnabError,
} from "./executorErrors.js";
export type { ExecutionSummary } from "./executorHelpers.js";

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
	/**
	 * Optional progress callback for emitting MCP progress notifications.
	 * When provided, progress updates are sent during bulk operations.
	 */
	sendProgress?: ProgressCallback;
}

export interface ExecutionActionRecord {
	type: string;
	transaction: Record<string, unknown> | null;
	reason: string;
	bulk_chunk_index?: number;
	correlation_key?: string;
	duplicate?: boolean;
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
	balance_reconciliation?: Awaited<
		ReturnType<typeof buildBalanceReconciliation>
	>;
	bulk_operation_details?: BulkOperationDetails;
}

const DEFAULT_TOLERANCE_CENTS = 1;
const CENTS_TO_MILLI = 10;
const MAX_BULK_CREATE_CHUNK = 100;
const MAX_BULK_UPDATE_CHUNK = 100; // YNAB API supports up to 100 transactions per batch for updates
const BATCH_DELAY_MS = 200; // Delay between batch chunks to avoid rate limiting

interface StatementWindow {
	start?: Date;
	end?: Date;
}

interface PreparedBulkCreateEntry {
	bankTransaction: BankTransaction;
	saveTransaction: NewTransaction;
	amountMilli: number;
	correlationKey: string;
}

function parseISODate(dateStr: string | undefined): Date | undefined {
	if (!dateStr) return undefined;
	const d = new Date(dateStr);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

function resolveStatementWindow(
	params: ReconcileAccountRequest,
	analysisDateRange?: string | undefined,
): StatementWindow | undefined {
	const start = parseISODate(params.statement_start_date);
	const end =
		parseISODate(params.statement_end_date ?? params.statement_date) ??
		// If only start provided, end stays undefined
		undefined;

	if (start || end) {
		const window: StatementWindow = {};
		if (start) window.start = start;
		if (end) window.end = end;
		return window;
	}

	if (analysisDateRange?.includes(" to ")) {
		const [rawStart, rawEnd] = analysisDateRange
			.split(" to ")
			.map((part) => part.trim());
		const parsedStart = parseISODate(rawStart);
		const parsedEnd = parseISODate(rawEnd);
		if (parsedStart || parsedEnd) {
			const window: StatementWindow = {};
			if (parsedStart) window.start = parsedStart;
			if (parsedEnd) window.end = parsedEnd;
			return window;
		}
	}

	return undefined;
}

function isWithinStatementWindow(
	dateStr: string,
	window: StatementWindow,
): boolean {
	const date = parseISODate(dateStr);
	if (!date) return false;

	if (window.start && date < window.start) return false;
	if (window.end && date > window.end) return false;
	return true;
}

export async function executeReconciliation(
	options: ExecutionOptions,
): Promise<ExecutionResult> {
	const {
		analysis,
		params,
		ynabAPI,
		budgetId,
		accountId,
		initialAccount,
		currencyCode,
		sendProgress,
	} = options;
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

	// Progress tracking for MCP notifications
	// Pre-filter matches to only count those that will actually be updated
	// This ensures accurate progress percentages (skipped matches don't inflate total)
	const matchesNeedingUpdate = analysis.auto_matches.filter((match) => {
		const flags = computeUpdateFlags(match, params);
		return flags.needsClearedUpdate || flags.needsDateUpdate;
	});
	const totalOperations =
		(params.auto_create_transactions ? analysis.unmatched_bank.length : 0) +
		matchesNeedingUpdate.length +
		(params.auto_unclear_missing ? analysis.unmatched_ynab.length : 0);
	let completedOperations = 0;

	const reportProgress = async (message: string): Promise<void> => {
		if (sendProgress && totalOperations > 0) {
			await sendProgress({
				progress: completedOperations,
				total: totalOperations,
				message,
			});
		}
	};

	let afterAccount: AccountSnapshot = { ...initialAccount };
	let accountSnapshotDirty = false;
	const statementTargetMilli = resolveStatementBalanceMilli(
		analysis.balance_info,
	);
	let clearedDeltaMilli = addMilli(
		initialAccount.cleared_balance ?? 0,
		-statementTargetMilli,
	);
	const balanceToleranceMilli = DEFAULT_TOLERANCE_CENTS * CENTS_TO_MILLI;
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
				const deltaDisplay = toMoneyValue(
					clearedDeltaMilli,
					currencyCode,
				).value_display;
				const toleranceDisplay = toMoneyValue(
					balanceToleranceMilli,
					currencyCode,
				).value_display;
				actions_taken.push({
					type: "balance_checkpoint",
					transaction: null,
					reason: `Cleared delta ${deltaDisplay} within ±${toleranceDisplay} after ${trigger} - halting newest-to-oldest pass`,
				});
			}
			return true;
		}
		return false;
	};

	recordAlignmentIfNeeded("initial balance check", { log: false });

	const orderedUnmatchedBank = params.auto_create_transactions
		? sortByDateDescending(analysis.unmatched_bank)
		: [];
	const orderedAutoMatches = sortMatchesByBankDateDescending(
		analysis.auto_matches,
	);
	const statementWindow = resolveStatementWindow(
		params,
		analysis.summary.statement_date_range,
	);
	const orderedUnmatchedYNAB = sortByDateDescending(
		statementWindow
			? analysis.unmatched_ynab.filter((txn) =>
					isWithinStatementWindow(txn.date, statementWindow),
				)
			: analysis.unmatched_ynab,
	);

	let bulkOperationDetails: BulkOperationDetails | undefined;

	// STEP 1: Auto-create missing transactions (bank -> YNAB)
	if (params.auto_create_transactions && !balanceAligned) {
		const buildPreparedEntry = (
			bankTxn: BankTransaction,
		): PreparedBulkCreateEntry => {
			const amountMilli = bankTxn.amount;
			const saveTransaction: NewTransaction = {
				account_id: accountId,
				amount: amountMilli,
				date: bankTxn.date,
				payee_name: bankTxn.payee ?? undefined,
				memo: truncateMemo(bankTxn.memo),
				cleared: "cleared",
				approved: true,
				// Note: import_id intentionally omitted so transactions can match with bank imports
			};
			const correlationKey = generateCorrelationKey(
				toCorrelationPayload(saveTransaction),
			);
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
			const action: ExecutionActionRecord = {
				type: "create_transaction",
				transaction: createdTxn as unknown as Record<string, unknown> | null,
				reason: `${prefix ?? "Created missing transaction"}: ${
					entry.bankTransaction.payee ?? "Unknown"
				} (${formatDisplay(entry.bankTransaction.amount, currencyCode)})`,
				correlation_key: entry.correlationKey,
			};
			if (chunkIndex !== undefined) {
				action.bulk_chunk_index = chunkIndex;
			}
			actions_taken.push(action);
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
					const response = await ynabAPI.transactions.createTransaction(
						budgetId,
						{
							transaction: entry.saveTransaction,
						},
					);
					const createdTransaction = response.data.transaction ?? null;
					const recordArgs: Parameters<typeof recordCreateAction>[0] = {
						entry,
						createdTxn: createdTransaction,
						prefix: options.fallbackError
							? "Created missing transaction after bulk fallback"
							: "Created missing transaction",
					};
					if (options.chunkIndex !== undefined) {
						recordArgs.chunkIndex = options.chunkIndex;
					}
					recordCreateAction(recordArgs);
					accountSnapshotDirty = true;
					applyClearedDelta(entry.amountMilli);
					// Report progress for sequential/fallback operations
					completedOperations += 1;
					await reportProgress(
						`Created ${completedOperations} of ${totalOperations} transactions`,
					);
					const trigger = options.chunkIndex
						? `creating ${entry.bankTransaction.payee ?? "missing transaction"} (chunk ${options.chunkIndex})`
						: `creating ${entry.bankTransaction.payee ?? "missing transaction"}`;
					recordAlignmentIfNeeded(trigger);
				} catch (error) {
					const ynabError = normalizeYnabError(error);
					if (bulkOperationDetails) {
						bulkOperationDetails.transaction_failures += 1; // Canonical counter for per-transaction failures
					}
					const failureReason = ynabError.message || "Unknown error occurred";
					const statusSuffix = ynabError.status
						? ` (HTTP ${ynabError.status})`
						: "";
					const failureAction: ExecutionActionRecord = {
						type: "create_transaction_failed",
						transaction: entry.saveTransaction as unknown as Record<
							string,
							unknown
						>,
						reason: options.fallbackError
							? `Bulk fallback failed for ${entry.bankTransaction.payee ?? "Unknown"} (${failureReason}${statusSuffix})`
							: `Failed to create transaction ${entry.bankTransaction.payee ?? "Unknown"} (${failureReason}${statusSuffix})`,
						correlation_key: entry.correlationKey,
					};
					if (options.chunkIndex !== undefined) {
						failureAction.bulk_chunk_index = options.chunkIndex;
					}
					actions_taken.push(failureAction);

					if (shouldPropagateYnabError(ynabError)) {
						throw attachStatusToError(ynabError, error);
					}
				}
			}
			// Update sequential_attempts metric if this was a fallback operation
			if (
				bulkOperationDetails &&
				options.fallbackError &&
				sequentialAttempts > 0
			) {
				bulkOperationDetails.sequential_attempts =
					(bulkOperationDetails.sequential_attempts ?? 0) + sequentialAttempts;
			}
		};

		const processBulkChunk = async (
			chunk: PreparedBulkCreateEntry[],
			chunkIndex: number,
		) => {
			// bulkOperationDetails is guaranteed to be defined when this function is called
			// (it's only called from within the bulk operation block where it's initialized)
			if (!bulkOperationDetails) {
				throw new Error("Bulk operation details not initialized");
			}
			const bulkDetails = bulkOperationDetails;

			const payload = chunk.map((entry) => entry.saveTransaction);
			const response = await ynabAPI.transactions.createTransactions(budgetId, {
				transactions: payload,
			});
			const responseData = response.data;
			const duplicateImportIds = new Set(
				responseData.duplicate_import_ids ?? [],
			);
			const correlationRequests = chunk.map((entry) =>
				toCorrelationPayload(entry.saveTransaction),
			) as Parameters<typeof correlateResults>[0];
			const correlated = correlateResults(
				correlationRequests,
				responseData,
				duplicateImportIds,
			);
			const transactionMap = new Map<string, ynab.TransactionDetail>();
			for (const transaction of responseData.transactions ?? []) {
				if (transaction.id) {
					transactionMap.set(transaction.id, transaction);
				}
			}
			for (const result of correlated) {
				const entry = chunk[result.request_index];
				if (!entry) continue;
				if (result.status === "created") {
					const createdTransaction = result.transaction_id
						? (transactionMap.get(result.transaction_id) ?? null)
						: null;
					recordCreateAction({
						entry,
						createdTxn: createdTransaction,
						chunkIndex,
						prefix: "Created missing transaction via bulk",
					});
					accountSnapshotDirty = true;
					applyClearedDelta(entry.amountMilli);
					recordAlignmentIfNeeded(
						`creating ${entry.bankTransaction.payee ?? "missing transaction"} via bulk chunk ${chunkIndex}`,
					);
				} else if (result.status === "duplicate") {
					bulkDetails.duplicates_detected += 1;
					actions_taken.push({
						type: "create_transaction_duplicate",
						transaction: {
							transaction_id: result.transaction_id ?? null,
							import_id: entry.saveTransaction.import_id,
						},
						reason: `Duplicate import detected for ${
							entry.bankTransaction.payee ?? "Unknown"
						} (import_id ${entry.saveTransaction.import_id})`,
						bulk_chunk_index: chunkIndex,
						correlation_key: result.correlation_key,
						duplicate: true,
					});
				} else {
					bulkDetails.transaction_failures += 1; // Canonical counter for per-transaction failures
					actions_taken.push({
						type: "create_transaction_failed",
						transaction: entry.saveTransaction as unknown as Record<
							string,
							unknown
						>,
						reason:
							result.error ??
							`Bulk create failed for ${entry.bankTransaction.payee ?? "Unknown"}`,
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
					type: "create_transaction",
					transaction: entry.saveTransaction as unknown as Record<
						string,
						unknown
					>,
					reason: `Would create missing transaction: ${bankTxn.payee ?? "Unknown"} (${formatDisplay(bankTxn.amount, currencyCode)})`,
					correlation_key: entry.correlationKey,
				});
				applyClearedDelta(entry.amountMilli);
				recordAlignmentIfNeeded(
					`creating ${bankTxn.payee ?? "missing transaction"}`,
				);
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
					if (!bankTxn) {
						nextBankIndex += 1;
						continue;
					}
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
						// Report progress after successful chunk processing
						completedOperations += chunk.length;
						await reportProgress(
							`Created ${completedOperations} of ${totalOperations} transactions`,
						);
					} catch (error) {
						const ynabError = normalizeYnabError(error);
						const failureReason = ynabError.message || "unknown error";
						bulkOperationDetails.bulk_chunk_failures += 1; // API-level failure (entire chunk failed)

						if (shouldPropagateYnabError(ynabError)) {
							bulkOperationDetails.transaction_failures += chunk.length;
							throw attachStatusToError(ynabError, error);
						}

						bulkOperationDetails.sequential_fallbacks += 1;
						actions_taken.push({
							type: "bulk_create_fallback",
							transaction: null,
							reason: `Bulk chunk #${chunkIndex} failed (${failureReason}${
								ynabError.status ? ` (HTTP ${ynabError.status})` : ""
							}) - falling back to sequential creation`,
							bulk_chunk_index: chunkIndex,
						});
						await processSequentialEntries(chunk, {
							chunkIndex,
							fallbackError: ynabError,
						});
					}
				}
			}
		} else {
			const entries = orderedUnmatchedBank.map((bankTxn) =>
				buildPreparedEntry(bankTxn),
			);
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
			if (!match.ynabTransaction) continue;

			// Build minimal update payload - only include ID and fields that are changing
			// Including unnecessary fields (like amount, payee_name) can cause unexpected behavior
			// BUT we must include memo to fix existing memos that exceed YNAB's 500 char limit
			const updatePayload: ynab.SaveTransactionWithIdOrImportId = {
				id: match.ynabTransaction.id,
			};

			// Truncate memo if it exists and is too long (YNAB validates on update even if not changed)
			if (match.ynabTransaction.memo) {
				updatePayload.memo = truncateMemo(match.ynabTransaction.memo);
			}

			// Only include fields that are actually changing
			if (flags.needsDateUpdate) {
				updatePayload.date = match.bankTransaction.date;
			}
			if (flags.needsClearedUpdate) {
				updatePayload.cleared = "cleared" as ynab.TransactionClearedStatus;
			}

			if (params.dry_run) {
				summary.transactions_updated += 1;
				if (flags.needsDateUpdate) summary.dates_adjusted += 1;
				actions_taken.push({
					type: "update_transaction",
					transaction: {
						transaction_id: match.ynabTransaction.id,
						new_date: flags.needsDateUpdate
							? match.bankTransaction.date
							: undefined,
						cleared: flags.needsClearedUpdate ? "cleared" : undefined,
					},
					reason: `Would update transaction: ${updateReason(match, flags, currencyCode)}`,
				});
				if (flags.needsClearedUpdate) {
					applyClearedDelta(match.ynabTransaction.amount);
					if (
						recordAlignmentIfNeeded(
							`clearing ${match.ynabTransaction.id ?? "transaction"} (dry run)`,
						)
					) {
						break;
					}
				}
			} else {
				transactionsToUpdate.push(updatePayload);
				if (flags.needsDateUpdate) summary.dates_adjusted += 1;
				if (flags.needsClearedUpdate) {
					applyClearedDelta(match.ynabTransaction.amount);
					if (recordAlignmentIfNeeded(`clearing ${match.ynabTransaction.id}`)) {
						break;
					}
				}
			}
		}

		// Batch update all transactions in a single API call
		// YNAB API has a limit of ~100 transactions per batch, so we chunk the updates
		if (!params.dry_run && transactionsToUpdate.length > 0) {
			const updateChunks = chunkArray(
				transactionsToUpdate,
				MAX_BULK_UPDATE_CHUNK,
			);

			for (let chunkIdx = 0; chunkIdx < updateChunks.length; chunkIdx++) {
				const chunk = updateChunks[chunkIdx];
				if (!chunk) continue;
				try {
					const response = await ynabAPI.transactions.updateTransactions(
						budgetId,
						{
							transactions: chunk,
						},
					);

					const updatedTransactions = response.data.transactions ?? [];
					summary.transactions_updated += updatedTransactions.length;

					for (const updatedTransaction of updatedTransactions) {
						const match = orderedAutoMatches.find(
							(m) => m.ynabTransaction?.id === updatedTransaction.id,
						);
						const flags = match
							? computeUpdateFlags(match, params)
							: { needsClearedUpdate: false, needsDateUpdate: false };
						actions_taken.push({
							type: "update_transaction",
							transaction: updatedTransaction as unknown as Record<
								string,
								unknown
							> | null,
							reason: `Updated transaction: ${match ? updateReason(match, flags, currencyCode) : "cleared"}`,
						});
					}
					accountSnapshotDirty = true;
					// Report progress after successful batch update
					completedOperations += updatedTransactions.length;
					await reportProgress(
						`Updated ${completedOperations} of ${totalOperations} transactions`,
					);
				} catch (error) {
					const ynabError = normalizeYnabError(error);
					const failureReason = ynabError.message || "Unknown error occurred";
					const statusSuffix = ynabError.status
						? ` (HTTP ${ynabError.status})`
						: "";
					actions_taken.push({
						type: "batch_update_failed",
						transaction: null,
						reason: `Failed to update chunk ${chunkIdx + 1}/${updateChunks.length} (${chunk.length} transaction(s)): ${failureReason}${statusSuffix}`,
					});

					if (shouldPropagateYnabError(ynabError)) {
						throw attachStatusToError(ynabError, error);
					}
				}

				// Add delay between chunks to avoid rate limiting (except after last chunk)
				if (chunkIdx < updateChunks.length - 1) {
					await sleep(BATCH_DELAY_MS);
				}
			}
		}
	}

	// STEP 3: Auto-unclear YNAB transactions missing from bank
	const shouldRunSanityPass = params.auto_unclear_missing && !balanceAligned;

	// Diagnostic logging for auto_unclear_missing debugging
	actions_taken.push({
		type: "diagnostic_step3_entry",
		transaction: null,
		reason: `STEP 3 diagnostics: auto_unclear_missing=${params.auto_unclear_missing}, balanceAligned=${balanceAligned}, shouldRunSanityPass=${shouldRunSanityPass}, orderedUnmatchedYNAB.length=${orderedUnmatchedYNAB.length}`,
	});

	if (orderedUnmatchedYNAB.length > 0) {
		const unmatchedDetails = orderedUnmatchedYNAB.slice(0, 10).map((t) => ({
			id: t.id,
			date: t.date,
			cleared: t.cleared,
			amount: formatDisplay(t.amount, currencyCode),
			payee: t.payee ?? "Unknown",
		}));
		actions_taken.push({
			type: "diagnostic_unmatched_ynab",
			transaction: {
				unmatched_transactions: unmatchedDetails,
			} as unknown as Record<string, unknown>,
			reason: `First ${Math.min(10, orderedUnmatchedYNAB.length)} unmatched YNAB transactions (cleared status and amounts)`,
		});
	}

	if (shouldRunSanityPass) {
		const transactionsToUnclear: ynab.SaveTransactionWithIdOrImportId[] = [];

		for (const ynabTxn of orderedUnmatchedYNAB) {
			if (ynabTxn.cleared !== "cleared") continue;
			if (balanceAligned) break;

			if (params.dry_run) {
				summary.transactions_updated += 1;
				actions_taken.push({
					type: "update_transaction",
					transaction: { transaction_id: ynabTxn.id, cleared: "uncleared" },
					reason: `Would mark transaction ${ynabTxn.id} as uncleared - not present on statement`,
				});
				applyClearedDelta(-ynabTxn.amount);
				if (recordAlignmentIfNeeded(`unclearing ${ynabTxn.id} (dry run)`)) {
					break;
				}
			} else {
				// Minimal update payload - only include ID and the field we're changing
				transactionsToUnclear.push({
					id: ynabTxn.id,
					cleared: "uncleared" as ynab.TransactionClearedStatus,
				});
				applyClearedDelta(-ynabTxn.amount);
				if (recordAlignmentIfNeeded(`unclearing ${ynabTxn.id}`)) {
					break;
				}
			}
		}

		// Batch update all unclear operations in a single API call
		// YNAB API has a limit of ~100 transactions per batch, so we chunk the updates
		if (!params.dry_run && transactionsToUnclear.length > 0) {
			const unclearChunks = chunkArray(
				transactionsToUnclear,
				MAX_BULK_UPDATE_CHUNK,
			);

			for (let chunkIdx = 0; chunkIdx < unclearChunks.length; chunkIdx++) {
				const chunk = unclearChunks[chunkIdx];
				if (!chunk) continue;
				try {
					const response = await ynabAPI.transactions.updateTransactions(
						budgetId,
						{
							transactions: chunk,
						},
					);

					const updatedTransactions = response.data.transactions ?? [];
					summary.transactions_updated += updatedTransactions.length;

					for (const updatedTransaction of updatedTransactions) {
						actions_taken.push({
							type: "update_transaction",
							transaction: updatedTransaction as unknown as Record<
								string,
								unknown
							> | null,
							reason: `Marked transaction ${updatedTransaction.id} as uncleared - not found on statement`,
						});
					}
					accountSnapshotDirty = true;
					// Report progress after successful unclear batch
					completedOperations += updatedTransactions.length;
					await reportProgress(
						`Marked ${completedOperations} of ${totalOperations} transactions uncleared`,
					);
				} catch (error) {
					const ynabError = normalizeYnabError(error);
					const failureReason = ynabError.message || "Unknown error occurred";
					const statusSuffix = ynabError.status
						? ` (HTTP ${ynabError.status})`
						: "";
					actions_taken.push({
						type: "batch_unclear_failed",
						transaction: null,
						reason: `Failed to unclear chunk ${chunkIdx + 1}/${unclearChunks.length} (${chunk.length} transaction(s)): ${failureReason}${statusSuffix}`,
					});

					if (shouldPropagateYnabError(ynabError)) {
						throw attachStatusToError(ynabError, error);
					}
				}

				// Add delay between chunks to avoid rate limiting (except after last chunk)
				if (chunkIdx < unclearChunks.length - 1) {
					await sleep(BATCH_DELAY_MS);
				}
			}
		}
	}

	// STEP 4: Mark all matched transactions as reconciled when balance aligns
	if (balanceAligned && !params.dry_run && params.auto_update_cleared_status) {
		const transactionsToReconcile: ynab.SaveTransactionWithIdOrImportId[] = [];

		for (const match of orderedAutoMatches) {
			if (!match.ynabTransaction) continue;
			// Only reconcile transactions that are not already reconciled
			if (match.ynabTransaction.cleared === "reconciled") continue;

			transactionsToReconcile.push({
				id: match.ynabTransaction.id,
				cleared: "reconciled" as ynab.TransactionClearedStatus,
			});
		}

		// Batch update all reconciliations in chunks
		if (transactionsToReconcile.length > 0) {
			const reconcileChunks = chunkArray(
				transactionsToReconcile,
				MAX_BULK_UPDATE_CHUNK,
			);

			for (let chunkIdx = 0; chunkIdx < reconcileChunks.length; chunkIdx++) {
				const chunk = reconcileChunks[chunkIdx];
				if (!chunk) continue;
				try {
					const response = await ynabAPI.transactions.updateTransactions(
						budgetId,
						{
							transactions: chunk,
						},
					);

					const reconciledTransactions = response.data.transactions ?? [];
					summary.transactions_updated += reconciledTransactions.length;

					for (const reconciledTransaction of reconciledTransactions) {
						const match = orderedAutoMatches.find(
							(m) => m.ynabTransaction?.id === reconciledTransaction.id,
						);
						actions_taken.push({
							type: "update_transaction",
							transaction: reconciledTransaction as unknown as Record<
								string,
								unknown
							> | null,
							reason: `Marked as reconciled: ${match?.bankTransaction.payee ?? "transaction"} (${formatDisplay(reconciledTransaction.amount, currencyCode)})`,
						});
					}
					accountSnapshotDirty = true;
				} catch (error) {
					const ynabError = normalizeYnabError(error);
					const failureReason = ynabError.message || "Unknown error occurred";
					const statusSuffix = ynabError.status
						? ` (HTTP ${ynabError.status})`
						: "";
					actions_taken.push({
						type: "batch_reconcile_failed",
						transaction: null,
						reason: `Failed to reconcile chunk ${chunkIdx + 1}/${reconcileChunks.length} (${chunk.length} transaction(s)): ${failureReason}${statusSuffix}`,
					});

					if (shouldPropagateYnabError(ynabError)) {
						throw attachStatusToError(ynabError, error);
					}
				}

				// Add delay between chunks to avoid rate limiting (except after last chunk)
				if (chunkIdx < reconcileChunks.length - 1) {
					await sleep(BATCH_DELAY_MS);
				}
			}

			actions_taken.push({
				type: "reconciliation_complete",
				transaction: null,
				reason: `Marked ${transactionsToReconcile.length} matched transaction(s) as reconciled - balance aligned within tolerance`,
			});
		}
	}

	// STEP 5: Balance reconciliation snapshot (only once per execution)
	let balance_reconciliation: ExecutionResult["balance_reconciliation"];
	if (params.statement_balance !== undefined && params.statement_date) {
		balance_reconciliation = await buildBalanceReconciliation({
			ynabAPI,
			budgetId,
			accountId,
			statementDate: params.statement_date,
			statementBalanceMilli: statementTargetMilli,
			analysis,
		});
	}

	// STEP 6: Recommendations and balance changes
	if (!params.dry_run && accountSnapshotDirty) {
		afterAccount = await refreshAccountSnapshot(ynabAPI, budgetId, accountId);
	}

	const balanceChangeMilli =
		params.dry_run || !accountSnapshotDirty
			? 0
			: afterAccount.balance - initialAccount.balance;

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
		bulkOperationDetails.failed_transactions =
			bulkOperationDetails.transaction_failures;
		result.bulk_operation_details = bulkOperationDetails;
	}

	return result;
}

async function refreshAccountSnapshot(
	api: ynab.API,
	budgetId: string,
	accountId: string,
): Promise<AccountSnapshot> {
	const accountsApi = api.accounts as typeof api.accounts & {
		getAccount?: (
			budgetId: string,
			accountId: string,
		) => Promise<ynab.AccountResponse>;
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

export type { ExecutionResult as LegacyReconciliationResult };
