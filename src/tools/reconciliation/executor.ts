import type * as ynab from "ynab";
import type { NewTransaction } from "ynab";
import type { ProgressCallback } from "../../server/toolRegistry.js";
import { addMilli } from "../../utils/money.js";
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
	type NormalizedYnabError,
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
	type UpdateFlags,
	updateReason,
} from "./executorHelpers.js";
import type { ReconcileAccountRequest } from "./index.js";
import type {
	BankTransaction,
	ReconciliationAnalysis,
	TransactionMatch,
	YNABTransaction,
} from "./types.js";

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
	decimalDigits?: number;
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
/**
 * Progress reserved for assembling the result. MCP progress must increase with
 * every notification, so this final step guarantees the run can always end on
 * a fresh progress == total report, however early the other steps stopped.
 */
const FINAL_PROGRESS_STEP = 1;

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

/**
 * Mutable state shared by every step of a single reconciliation execution.
 */
interface ExecutionState {
	readonly options: ExecutionOptions;
	readonly summary: ExecutionSummary;
	readonly actions: ExecutionActionRecord[];
	readonly balanceToleranceMilli: number;
	/**
	 * Progress total: an upper bound while steps run (they may stop early once
	 * the balance aligns or skip work after failures), settled to the actual
	 * count by the final report.
	 */
	totalOperations: number;
	completedOperations: number;
	/** Last progress value sent; MCP requires each notification to increase it */
	lastReportedProgress: number;
	clearedDeltaMilli: number;
	balanceAligned: boolean;
	/**
	 * Set when a chunk of cleared-status updates failed. The remaining cleared
	 * delta then reflects failed writes rather than missing bank transactions,
	 * so the auto-unclear pass must not try to compensate for it.
	 */
	clearedUpdatesFailed: boolean;
	accountSnapshotDirty: boolean;
	bulkOperationDetails: BulkOperationDetails | undefined;
}

/** Upper-bound operation counts per step, used for MCP progress totals */
interface PlannedOperations {
	readonly create: number;
	readonly update: number;
	readonly unclear: number;
}

interface PlannedMatch {
	readonly match: TransactionMatch;
	readonly flags: UpdateFlags;
}

interface MatchPlan {
	/** Auto-matches newest-to-oldest by bank date, with their update flags */
	readonly ordered: PlannedMatch[];
	/** First planned match per YNAB transaction ID, for chunk-result lookups */
	readonly byTransactionId: Map<string, PlannedMatch>;
}

interface ChunkedUpdateConfig {
	failureType: string;
	failureVerb: string;
	onChunkSuccess: (
		transactions: ynab.TransactionDetail[],
	) => Promise<void> | void;
	/** Called for a failed chunk whose error is not propagated */
	onChunkFailure?: (chunk: ynab.SaveTransactionWithIdOrImportId[]) => void;
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
	const end = parseISODate(params.statement_end_date);

	if (end) {
		return { end };
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
	const { analysis, params, initialAccount } = options;
	const statementTargetMilli = resolveStatementBalanceMilli(
		analysis.balance_info,
	);
	const matchPlan = buildMatchPlan(analysis.auto_matches, params);
	const orderedUnmatchedYNAB = orderUnmatchedYnabInStatementWindow(
		analysis,
		params,
	);
	const plannedOperations = countPlannedOperations(
		analysis,
		params,
		matchPlan,
		orderedUnmatchedYNAB,
	);

	const state: ExecutionState = {
		options,
		summary: buildInitialSummary(analysis, params),
		actions: [],
		totalOperations:
			plannedOperations.create +
			plannedOperations.update +
			plannedOperations.unclear +
			FINAL_PROGRESS_STEP,
		balanceToleranceMilli: DEFAULT_TOLERANCE_CENTS * CENTS_TO_MILLI,
		completedOperations: 0,
		lastReportedProgress: 0,
		clearedDeltaMilli: addMilli(
			initialAccount.cleared_balance ?? 0,
			-statementTargetMilli,
		),
		balanceAligned: false,
		clearedUpdatesFailed: false,
		accountSnapshotDirty: false,
		bulkOperationDetails: undefined,
	};

	recordAlignmentIfNeeded(state, "initial balance check", { log: false });

	const reconcilableMatchedTransactionIds = new Set<string>();
	for (const { match } of matchPlan.ordered) {
		if (match.ynabTransaction?.cleared === "cleared") {
			reconcilableMatchedTransactionIds.add(match.ynabTransaction.id);
		}
	}

	// STEP 1: Auto-create missing transactions (bank -> YNAB)
	if (params.auto_create_transactions && !state.balanceAligned) {
		await createMissingTransactions(
			state,
			sortByDateDescending(analysis.unmatched_bank),
		);
	}

	// STEP 2: Update matched YNAB transactions (cleared status / date)
	if (!state.balanceAligned) {
		await updateMatchedTransactions(
			state,
			matchPlan,
			reconcilableMatchedTransactionIds,
		);
	}

	// STEP 3: Auto-unclear YNAB transactions missing from bank
	await unclearMissingTransactions(state, orderedUnmatchedYNAB);

	// STEP 4: Mark all matched transactions as reconciled when balance aligns
	if (
		state.balanceAligned &&
		!params.dry_run &&
		params.auto_update_cleared_status
	) {
		await reconcileMatchedTransactions(
			state,
			matchPlan,
			reconcilableMatchedTransactionIds,
		);
	}

	// STEPS 5-6: Balance snapshot, recommendations, and result assembly
	const result = await buildExecutionResult(state, statementTargetMilli);
	await reportFinalProgress(state);
	return result;
}

// ============================================================================
// Setup
// ============================================================================

function buildInitialSummary(
	analysis: ReconciliationAnalysis,
	params: ReconcileAccountRequest,
): ExecutionSummary {
	return {
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
}

/**
 * Sort auto-matches and compute their update flags once, so the progress
 * count, update collection, and chunk-result handling all share them.
 */
function buildMatchPlan(
	matches: TransactionMatch[],
	params: ReconcileAccountRequest,
): MatchPlan {
	const ordered = sortMatchesByBankDateDescending(matches).map((match) => ({
		match,
		flags: computeUpdateFlags(match, params),
	}));
	const byTransactionId = new Map<string, PlannedMatch>();
	for (const planned of ordered) {
		const id = planned.match.ynabTransaction?.id;
		if (id && !byTransactionId.has(id)) {
			byTransactionId.set(id, planned);
		}
	}
	return { ordered, byTransactionId };
}

/**
 * Count operations for MCP progress notifications. Only matches that will
 * actually be updated and cleared in-window transactions that could be
 * uncleared are counted, so skipped items don't inflate the total.
 */
function countPlannedOperations(
	analysis: ReconciliationAnalysis,
	params: ReconcileAccountRequest,
	matchPlan: MatchPlan,
	orderedUnmatchedYNAB: YNABTransaction[],
): PlannedOperations {
	const matchesNeedingUpdate = matchPlan.ordered.filter(
		({ flags }) => flags.needsClearedUpdate || flags.needsDateUpdate,
	);
	const unclearCandidates = orderedUnmatchedYNAB.filter(
		(txn) => txn.cleared === "cleared",
	);
	return {
		create: params.auto_create_transactions
			? analysis.unmatched_bank.length
			: 0,
		update: matchesNeedingUpdate.length,
		unclear: params.auto_unclear_missing ? unclearCandidates.length : 0,
	};
}

function orderUnmatchedYnabInStatementWindow(
	analysis: ReconciliationAnalysis,
	params: ReconcileAccountRequest,
): YNABTransaction[] {
	const statementWindow = resolveStatementWindow(
		params,
		analysis.summary.statement_date_range,
	);
	return sortByDateDescending(
		statementWindow
			? analysis.unmatched_ynab.filter((txn) =>
					isWithinStatementWindow(txn.date, statementWindow),
				)
			: analysis.unmatched_ynab,
	);
}

// ============================================================================
// Shared state helpers
// ============================================================================

/**
 * Send a progress notification. Progress is advisory, so a failing callback is
 * ignored rather than allowed to abort or misreport work YNAB already applied.
 */
async function reportProgress(
	state: ExecutionState,
	message: string,
): Promise<void> {
	const { sendProgress } = state.options;
	if (
		!sendProgress ||
		state.totalOperations <= 0 ||
		state.completedOperations <= state.lastReportedProgress
	) {
		return;
	}
	state.lastReportedProgress = state.completedOperations;
	try {
		await sendProgress({
			progress: state.completedOperations,
			total: state.totalOperations,
			message,
		});
	} catch {
		// Progress notifications are non-critical; keep reconciling.
	}
}

/**
 * Complete the reserved final step and settle the total to what actually ran,
 * so every exit path (early alignment, skipped steps, failed chunks) ends on
 * progress == total. Skipped when nothing was reported, as there is nothing
 * to finish on the client.
 */
async function reportFinalProgress(state: ExecutionState): Promise<void> {
	if (state.lastReportedProgress === 0) return;
	state.completedOperations += FINAL_PROGRESS_STEP;
	state.totalOperations = state.completedOperations;
	await reportProgress(state, "Reconciliation complete");
}

function operationsProgressMessage(
	state: ExecutionState,
	verb: string,
): string {
	return `${verb} (${state.completedOperations} of up to ${state.totalOperations} operations)`;
}

function applyClearedDelta(state: ExecutionState, delta: number): void {
	if (delta === 0) return;
	state.clearedDeltaMilli = addMilli(state.clearedDeltaMilli, delta);
}

/**
 * Undo the projected cleared delta for updates that never reached YNAB. If the
 * balance falls back outside tolerance, alignment is withdrawn so later steps
 * don't treat the account as reconciled.
 */
function revertClearedDelta(
	state: ExecutionState,
	delta: number,
	trigger: string,
): void {
	applyClearedDelta(state, delta);
	if (
		!state.balanceAligned ||
		Math.abs(state.clearedDeltaMilli) <= state.balanceToleranceMilli
	) {
		return;
	}
	state.balanceAligned = false;
	const { currencyCode } = state.options;
	state.actions.push({
		type: "balance_checkpoint",
		transaction: null,
		reason: `Cleared delta ${formatDisplay(state.clearedDeltaMilli, currencyCode)} outside ±${formatDisplay(state.balanceToleranceMilli, currencyCode)} after ${trigger} - balance no longer aligned`,
	});
}

function recordAlignmentIfNeeded(
	state: ExecutionState,
	trigger: string,
	{ log = true } = {},
): boolean {
	if (state.balanceAligned) {
		return true;
	}
	if (Math.abs(state.clearedDeltaMilli) <= state.balanceToleranceMilli) {
		state.balanceAligned = true;
		if (log) {
			recordBalanceCheckpoint(state, trigger);
		}
		return true;
	}
	return false;
}

function recordBalanceCheckpoint(state: ExecutionState, trigger: string): void {
	const { currencyCode } = state.options;
	state.actions.push({
		type: "balance_checkpoint",
		transaction: null,
		reason: `Cleared delta ${formatDisplay(state.clearedDeltaMilli, currencyCode)} within ±${formatDisplay(state.balanceToleranceMilli, currencyCode)} after ${trigger} - halting newest-to-oldest pass`,
	});
}

function httpStatusSuffix(ynabError: NormalizedYnabError): string {
	return ynabError.status ? ` (HTTP ${ynabError.status})` : "";
}

/**
 * Send updates in chunks of MAX_BULK_UPDATE_CHUNK, recording a failure action
 * per failed chunk and pausing between chunks to avoid rate limiting. Returns
 * how many payloads were in chunks that failed without propagating.
 */
async function runChunkedUpdates(
	state: ExecutionState,
	payloads: ynab.SaveTransactionWithIdOrImportId[],
	config: ChunkedUpdateConfig,
): Promise<number> {
	const { ynabAPI, budgetId } = state.options;
	const chunks = chunkArray(payloads, MAX_BULK_UPDATE_CHUNK);
	let failedPayloads = 0;

	for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
		const chunk = chunks[chunkIdx];
		if (!chunk) continue;
		// Only the API call is guarded: once YNAB has applied a chunk, nothing
		// that goes wrong while recording it may be treated as a failed chunk.
		let updatedTransactions: ynab.TransactionDetail[] | undefined;
		try {
			const response = await ynabAPI.transactions.updateTransactions(budgetId, {
				transactions: chunk,
			});
			updatedTransactions = response.data.transactions ?? [];
		} catch (error) {
			failedPayloads += chunk.length;
			const ynabError = normalizeYnabError(error);
			const failureReason = ynabError.message || "Unknown error occurred";
			state.actions.push({
				type: config.failureType,
				transaction: null,
				reason: `Failed to ${config.failureVerb} chunk ${chunkIdx + 1}/${chunks.length} (${chunk.length} transaction(s)): ${failureReason}${httpStatusSuffix(ynabError)}`,
			});

			if (shouldPropagateYnabError(ynabError)) {
				throw attachStatusToError(ynabError, error);
			}
			config.onChunkFailure?.(chunk);
		}
		if (updatedTransactions) {
			await config.onChunkSuccess(updatedTransactions);
		}

		// Add delay between chunks to avoid rate limiting (except after last chunk)
		if (chunkIdx < chunks.length - 1) {
			await sleep(BATCH_DELAY_MS);
		}
	}
	return failedPayloads;
}

// ============================================================================
// STEP 1: Auto-create missing transactions (bank -> YNAB)
// ============================================================================

async function createMissingTransactions(
	state: ExecutionState,
	orderedUnmatchedBank: BankTransaction[],
): Promise<void> {
	const { params, accountId } = state.options;
	if (params.dry_run) {
		previewMissingTransactions(state, orderedUnmatchedBank);
	} else if (orderedUnmatchedBank.length >= 2) {
		await bulkCreateMissingTransactions(state, orderedUnmatchedBank);
	} else {
		const entries = orderedUnmatchedBank.map((bankTxn) =>
			buildPreparedEntry(bankTxn, accountId),
		);
		await processSequentialEntries(state, entries);
	}
}

function buildPreparedEntry(
	bankTxn: BankTransaction,
	accountId: string,
): PreparedBulkCreateEntry {
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
}

function previewMissingTransactions(
	state: ExecutionState,
	orderedUnmatchedBank: BankTransaction[],
): void {
	const { accountId, currencyCode } = state.options;
	for (const bankTxn of orderedUnmatchedBank) {
		if (state.balanceAligned) break;
		const entry = buildPreparedEntry(bankTxn, accountId);
		state.summary.transactions_created += 1;
		state.actions.push({
			type: "create_transaction",
			transaction: entry.saveTransaction as unknown as Record<string, unknown>,
			reason: `Would create missing transaction: ${bankTxn.payee ?? "Unknown"} (${formatDisplay(bankTxn.amount, currencyCode)})`,
			correlation_key: entry.correlationKey,
		});
		applyClearedDelta(state, entry.amountMilli);
		recordAlignmentIfNeeded(
			state,
			`creating ${bankTxn.payee ?? "missing transaction"}`,
		);
	}
}

function recordCreateAction(
	state: ExecutionState,
	args: {
		entry: PreparedBulkCreateEntry;
		createdTxn: ynab.TransactionDetail | null;
		chunkIndex?: number;
		prefix?: string;
	},
): void {
	const { entry, createdTxn, chunkIndex, prefix } = args;
	state.summary.transactions_created += 1;
	const action: ExecutionActionRecord = {
		type: "create_transaction",
		transaction: createdTxn as unknown as Record<string, unknown> | null,
		reason: `${prefix ?? "Created missing transaction"}: ${
			entry.bankTransaction.payee ?? "Unknown"
		} (${formatDisplay(entry.bankTransaction.amount, state.options.currencyCode)})`,
		correlation_key: entry.correlationKey,
	};
	if (chunkIndex !== undefined) {
		action.bulk_chunk_index = chunkIndex;
	}
	state.actions.push(action);
}

async function processSequentialEntries(
	state: ExecutionState,
	entries: PreparedBulkCreateEntry[],
	options: { chunkIndex?: number; fallbackError?: unknown } = {},
): Promise<void> {
	let sequentialAttempts = 0;
	for (const entry of entries) {
		if (state.balanceAligned) break;
		if (options.fallbackError) {
			sequentialAttempts += 1;
		}
		// Only the API call is guarded: once YNAB has created the transaction,
		// nothing that goes wrong while recording it may be treated as a failure.
		let createdTransaction: ynab.TransactionDetail | null;
		try {
			createdTransaction = await sendSequentialCreate(state, entry);
		} catch (error) {
			recordSequentialFailure(state, entry, options, error);
			continue;
		}
		await recordSequentialCreate(state, entry, createdTransaction, options);
	}
	// Update sequential_attempts metric if this was a fallback operation
	const bulkDetails = state.bulkOperationDetails;
	if (bulkDetails && options.fallbackError && sequentialAttempts > 0) {
		bulkDetails.sequential_attempts =
			(bulkDetails.sequential_attempts ?? 0) + sequentialAttempts;
	}
}

async function sendSequentialCreate(
	state: ExecutionState,
	entry: PreparedBulkCreateEntry,
): Promise<ynab.TransactionDetail | null> {
	const { ynabAPI, budgetId } = state.options;
	const response = await ynabAPI.transactions.createTransaction(budgetId, {
		transaction: entry.saveTransaction,
	});
	return response.data.transaction ?? null;
}

async function recordSequentialCreate(
	state: ExecutionState,
	entry: PreparedBulkCreateEntry,
	createdTransaction: ynab.TransactionDetail | null,
	options: { chunkIndex?: number; fallbackError?: unknown },
): Promise<void> {
	const recordArgs: Parameters<typeof recordCreateAction>[1] = {
		entry,
		createdTxn: createdTransaction,
		prefix: options.fallbackError
			? "Created missing transaction after bulk fallback"
			: "Created missing transaction",
	};
	if (options.chunkIndex !== undefined) {
		recordArgs.chunkIndex = options.chunkIndex;
	}
	recordCreateAction(state, recordArgs);
	state.accountSnapshotDirty = true;
	applyClearedDelta(state, entry.amountMilli);
	const trigger = options.chunkIndex
		? `creating ${entry.bankTransaction.payee ?? "missing transaction"} (chunk ${options.chunkIndex})`
		: `creating ${entry.bankTransaction.payee ?? "missing transaction"}`;
	recordAlignmentIfNeeded(state, trigger);
	// Report progress for sequential/fallback operations
	state.completedOperations += 1;
	await reportProgress(
		state,
		operationsProgressMessage(state, "Creating missing transactions"),
	);
}

function recordSequentialFailure(
	state: ExecutionState,
	entry: PreparedBulkCreateEntry,
	options: { chunkIndex?: number; fallbackError?: unknown },
	error: unknown,
): void {
	const ynabError = normalizeYnabError(error);
	if (state.bulkOperationDetails) {
		state.bulkOperationDetails.transaction_failures += 1; // Canonical counter for per-transaction failures
	}
	const failureReason = ynabError.message || "Unknown error occurred";
	const statusSuffix = httpStatusSuffix(ynabError);
	const failureAction: ExecutionActionRecord = {
		type: "create_transaction_failed",
		transaction: entry.saveTransaction as unknown as Record<string, unknown>,
		reason: options.fallbackError
			? `Bulk fallback failed for ${entry.bankTransaction.payee ?? "Unknown"} (${failureReason}${statusSuffix})`
			: `Failed to create transaction ${entry.bankTransaction.payee ?? "Unknown"} (${failureReason}${statusSuffix})`,
		correlation_key: entry.correlationKey,
	};
	if (options.chunkIndex !== undefined) {
		failureAction.bulk_chunk_index = options.chunkIndex;
	}
	state.actions.push(failureAction);

	if (shouldPropagateYnabError(ynabError)) {
		throw attachStatusToError(ynabError, error);
	}
}

async function bulkCreateMissingTransactions(
	state: ExecutionState,
	orderedUnmatchedBank: BankTransaction[],
): Promise<void> {
	const bulkDetails: BulkOperationDetails = {
		chunks_processed: 0,
		bulk_successes: 0,
		sequential_fallbacks: 0,
		duplicates_detected: 0,
		failed_transactions: 0,
		bulk_chunk_failures: 0,
		transaction_failures: 0,
	};
	state.bulkOperationDetails = bulkDetails;

	let nextBankIndex = 0;
	while (nextBankIndex < orderedUnmatchedBank.length && !state.balanceAligned) {
		const { batch, nextIndex } = collectBulkBatch(
			state,
			orderedUnmatchedBank,
			nextBankIndex,
		);
		nextBankIndex = nextIndex;

		if (batch.length === 0) {
			break;
		}

		const chunks = chunkArray(batch, MAX_BULK_CREATE_CHUNK);
		for (const chunk of chunks) {
			if (state.balanceAligned) break;
			bulkDetails.chunks_processed += 1;
			const chunkIndex = bulkDetails.chunks_processed;
			// Only the API call falls back to sequential creation: once YNAB has
			// created the chunk, retrying it would create every entry twice.
			let responseData: ynab.SaveTransactionsResponseData;
			try {
				responseData = await sendBulkChunk(state, chunk);
			} catch (error) {
				await fallBackToSequential(
					state,
					bulkDetails,
					chunk,
					chunkIndex,
					error,
				);
				continue;
			}
			recordBulkChunkResults(
				state,
				bulkDetails,
				chunk,
				chunkIndex,
				responseData,
			);
			bulkDetails.bulk_successes += 1;
			// Report progress after successful chunk processing
			state.completedOperations += chunk.length;
			await reportProgress(
				state,
				operationsProgressMessage(state, "Creating missing transactions"),
			);
		}
	}
}

/**
 * Take bank transactions from startIndex until the projected cleared delta
 * falls within tolerance, so bulk creation stops once the balance would align.
 */
function collectBulkBatch(
	state: ExecutionState,
	orderedUnmatchedBank: BankTransaction[],
	startIndex: number,
): { batch: PreparedBulkCreateEntry[]; nextIndex: number } {
	const batch: PreparedBulkCreateEntry[] = [];
	let nextIndex = startIndex;
	let projectedDelta = state.clearedDeltaMilli;
	while (nextIndex < orderedUnmatchedBank.length) {
		const bankTxn = orderedUnmatchedBank[nextIndex];
		if (!bankTxn) {
			nextIndex += 1;
			continue;
		}
		const entry = buildPreparedEntry(bankTxn, state.options.accountId);
		batch.push(entry);
		nextIndex += 1;
		projectedDelta = addMilli(projectedDelta, entry.amountMilli);
		if (Math.abs(projectedDelta) <= state.balanceToleranceMilli) {
			break;
		}
	}
	return { batch, nextIndex };
}

async function sendBulkChunk(
	state: ExecutionState,
	chunk: PreparedBulkCreateEntry[],
): Promise<ynab.SaveTransactionsResponseData> {
	const { ynabAPI, budgetId } = state.options;
	const response = await ynabAPI.transactions.createTransactions(budgetId, {
		transactions: chunk.map((entry) => entry.saveTransaction),
	});
	return response.data;
}

function recordBulkChunkResults(
	state: ExecutionState,
	bulkDetails: BulkOperationDetails,
	chunk: PreparedBulkCreateEntry[],
	chunkIndex: number,
	responseData: ynab.SaveTransactionsResponseData,
): void {
	let correlated: ReturnType<typeof correlateResults>;
	const transactionMap = new Map<string, ynab.TransactionDetail>();
	try {
		const duplicateImportIds = new Set(responseData.duplicate_import_ids ?? []);
		const correlationRequests = chunk.map((entry) =>
			toCorrelationPayload(entry.saveTransaction),
		) as Parameters<typeof correlateResults>[0];
		correlated = correlateResults(
			correlationRequests,
			responseData,
			duplicateImportIds,
		);
		for (const transaction of responseData.transactions ?? []) {
			if (transaction.id) {
				transactionMap.set(transaction.id, transaction);
			}
		}
	} catch (error) {
		recordUncorrelatedBulkChunk(state, chunk, chunkIndex, error);
		return;
	}
	for (const result of correlated) {
		const entry = chunk[result.request_index];
		if (!entry) continue;
		if (result.status === "created") {
			const createdTransaction = result.transaction_id
				? (transactionMap.get(result.transaction_id) ?? null)
				: null;
			recordCreateAction(state, {
				entry,
				createdTxn: createdTransaction,
				chunkIndex,
				prefix: "Created missing transaction via bulk",
			});
			state.accountSnapshotDirty = true;
			applyClearedDelta(state, entry.amountMilli);
			recordAlignmentIfNeeded(
				state,
				`creating ${entry.bankTransaction.payee ?? "missing transaction"} via bulk chunk ${chunkIndex}`,
			);
		} else if (result.status === "duplicate") {
			bulkDetails.duplicates_detected += 1;
			state.actions.push({
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
			state.actions.push({
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
}

/**
 * YNAB accepted the chunk but its response couldn't be matched back to the
 * requests. Entries carry no import_id, so none can be duplicates: record each
 * as created (without the YNAB transaction) rather than losing the chunk, so
 * the cleared delta stays right and a re-run doesn't create them again.
 */
function recordUncorrelatedBulkChunk(
	state: ExecutionState,
	chunk: PreparedBulkCreateEntry[],
	chunkIndex: number,
	error: unknown,
): void {
	const reason = error instanceof Error ? error.message : String(error);
	state.accountSnapshotDirty = true;
	for (const entry of chunk) {
		recordCreateAction(state, {
			entry,
			createdTxn: null,
			chunkIndex,
			prefix: `Created missing transaction via bulk (response could not be matched: ${reason})`,
		});
		applyClearedDelta(state, entry.amountMilli);
	}
	recordAlignmentIfNeeded(state, `creating bulk chunk ${chunkIndex}`);
}

async function fallBackToSequential(
	state: ExecutionState,
	bulkDetails: BulkOperationDetails,
	chunk: PreparedBulkCreateEntry[],
	chunkIndex: number,
	error: unknown,
): Promise<void> {
	const ynabError = normalizeYnabError(error);
	const failureReason = ynabError.message || "unknown error";
	bulkDetails.bulk_chunk_failures += 1; // API-level failure (entire chunk failed)

	if (shouldPropagateYnabError(ynabError)) {
		bulkDetails.transaction_failures += chunk.length;
		throw attachStatusToError(ynabError, error);
	}

	bulkDetails.sequential_fallbacks += 1;
	state.actions.push({
		type: "bulk_create_fallback",
		transaction: null,
		reason: `Bulk chunk #${chunkIndex} failed (${failureReason}${httpStatusSuffix(
			ynabError,
		)}) - falling back to sequential creation`,
		bulk_chunk_index: chunkIndex,
	});
	await processSequentialEntries(state, chunk, {
		chunkIndex,
		fallbackError: ynabError,
	});
}

// ============================================================================
// STEP 2: Update matched YNAB transactions (cleared status / date)
// ============================================================================

async function updateMatchedTransactions(
	state: ExecutionState,
	matchPlan: MatchPlan,
	reconcilableMatchedTransactionIds: Set<string>,
): Promise<void> {
	const { params, currencyCode } = state.options;
	const transactionsToUpdate = collectMatchUpdates(state, matchPlan);

	if (params.dry_run || transactionsToUpdate.length === 0) {
		return;
	}

	// YNAB API has a limit of ~100 transactions per batch, so we chunk the updates
	await runChunkedUpdates(state, transactionsToUpdate, {
		failureType: "batch_update_failed",
		failureVerb: "update",
		onChunkSuccess: async (updatedTransactions) => {
			state.summary.transactions_updated += updatedTransactions.length;

			for (const updatedTransaction of updatedTransactions) {
				const planned = matchPlan.byTransactionId.get(updatedTransaction.id);
				if (planned?.flags.needsClearedUpdate) {
					reconcilableMatchedTransactionIds.add(updatedTransaction.id);
				}
				state.actions.push({
					type: "update_transaction",
					transaction: updatedTransaction as unknown as Record<
						string,
						unknown
					> | null,
					reason: `Updated transaction: ${planned ? updateReason(planned.match, planned.flags, currencyCode) : "cleared"}`,
				});
			}
			state.accountSnapshotDirty = true;
			// Report progress after successful batch update
			state.completedOperations += updatedTransactions.length;
			await reportProgress(
				state,
				operationsProgressMessage(state, "Updating matched transactions"),
			);
		},
		onChunkFailure: (failedChunk) => {
			let clearedDelta = 0;
			for (const payload of failedChunk) {
				const planned = payload.id
					? matchPlan.byTransactionId.get(payload.id)
					: undefined;
				const ynabTransaction = planned?.match.ynabTransaction;
				if (!planned || !ynabTransaction) continue;
				if (planned.flags.needsDateUpdate) state.summary.dates_adjusted -= 1;
				if (planned.flags.needsClearedUpdate) {
					clearedDelta = addMilli(clearedDelta, -ynabTransaction.amount);
					state.clearedUpdatesFailed = true;
				}
			}
			revertClearedDelta(state, clearedDelta, "failed update chunk");
		},
	});
}

/**
 * Walk matches newest-to-oldest, building update payloads (or dry-run actions)
 * until the cleared balance aligns with the statement.
 */
function collectMatchUpdates(
	state: ExecutionState,
	matchPlan: MatchPlan,
): ynab.SaveTransactionWithIdOrImportId[] {
	const { params, currencyCode } = state.options;
	const transactionsToUpdate: ynab.SaveTransactionWithIdOrImportId[] = [];

	for (const { match, flags } of matchPlan.ordered) {
		if (state.balanceAligned) break;
		if (!flags.needsClearedUpdate && !flags.needsDateUpdate) continue;
		if (!match.ynabTransaction) continue;

		if (params.dry_run) {
			state.summary.transactions_updated += 1;
			if (flags.needsDateUpdate) state.summary.dates_adjusted += 1;
			state.actions.push({
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
		} else {
			transactionsToUpdate.push(
				buildMatchUpdatePayload(
					match.ynabTransaction,
					match.bankTransaction.date,
					flags,
				),
			);
			if (flags.needsDateUpdate) state.summary.dates_adjusted += 1;
		}

		if (flags.needsClearedUpdate) {
			applyClearedDelta(state, match.ynabTransaction.amount);
			const trigger = params.dry_run
				? `clearing ${match.ynabTransaction.id ?? "transaction"} (dry run)`
				: `clearing ${match.ynabTransaction.id}`;
			if (recordAlignmentIfNeeded(state, trigger)) {
				break;
			}
		}
	}

	return transactionsToUpdate;
}

function buildMatchUpdatePayload(
	ynabTransaction: YNABTransaction,
	bankDate: string,
	flags: UpdateFlags,
): ynab.SaveTransactionWithIdOrImportId {
	// Build minimal update payload - only include ID and fields that are changing
	// Including unnecessary fields (like amount, payee_name) can cause unexpected behavior
	// BUT we must include memo to fix existing memos that exceed YNAB's 500 char limit
	const updatePayload: ynab.SaveTransactionWithIdOrImportId = {
		id: ynabTransaction.id,
	};

	// Truncate memo if it exists and is too long (YNAB validates on update even if not changed)
	if (ynabTransaction.memo) {
		updatePayload.memo = truncateMemo(ynabTransaction.memo);
	}

	// Only include fields that are actually changing
	if (flags.needsDateUpdate) {
		updatePayload.date = bankDate;
	}
	if (flags.needsClearedUpdate) {
		updatePayload.cleared = "cleared" as ynab.TransactionClearedStatus;
	}

	return updatePayload;
}

// ============================================================================
// STEP 3: Auto-unclear YNAB transactions missing from bank
// ============================================================================

async function unclearMissingTransactions(
	state: ExecutionState,
	orderedUnmatchedYNAB: YNABTransaction[],
): Promise<void> {
	const { params } = state.options;
	const shouldRunSanityPass =
		params.auto_unclear_missing &&
		!state.balanceAligned &&
		!state.clearedUpdatesFailed;

	recordUnclearDiagnostics(state, orderedUnmatchedYNAB, shouldRunSanityPass);

	if (params.auto_unclear_missing && state.clearedUpdatesFailed) {
		state.actions.push({
			type: "balance_checkpoint",
			transaction: null,
			reason:
				"Skipped marking missing transactions uncleared - some cleared-status updates failed, so the remaining balance gap is not evidence of missing bank transactions. Re-run reconciliation after resolving the failures.",
		});
	}

	if (!shouldRunSanityPass) {
		return;
	}

	const transactionsToUnclear = collectUnclearUpdates(
		state,
		orderedUnmatchedYNAB,
	);

	if (params.dry_run || transactionsToUnclear.length === 0) {
		return;
	}
	const amountsById = new Map(
		orderedUnmatchedYNAB.map((txn) => [txn.id, txn.amount]),
	);

	// YNAB API has a limit of ~100 transactions per batch, so we chunk the updates
	await runChunkedUpdates(state, transactionsToUnclear, {
		failureType: "batch_unclear_failed",
		failureVerb: "unclear",
		onChunkSuccess: async (updatedTransactions) => {
			state.summary.transactions_updated += updatedTransactions.length;

			for (const updatedTransaction of updatedTransactions) {
				state.actions.push({
					type: "update_transaction",
					transaction: updatedTransaction as unknown as Record<
						string,
						unknown
					> | null,
					reason: `Marked transaction ${updatedTransaction.id} as uncleared - not found on statement`,
				});
			}
			state.accountSnapshotDirty = true;
			// Report progress after successful unclear batch
			state.completedOperations += updatedTransactions.length;
			await reportProgress(
				state,
				operationsProgressMessage(
					state,
					"Marking missing transactions uncleared",
				),
			);
		},
		onChunkFailure: (failedChunk) => {
			let clearedDelta = 0;
			for (const payload of failedChunk) {
				const amount = payload.id ? amountsById.get(payload.id) : undefined;
				if (amount !== undefined) {
					clearedDelta = addMilli(clearedDelta, amount);
				}
			}
			revertClearedDelta(state, clearedDelta, "failed unclear chunk");
		},
	});
}

// Diagnostic logging for auto_unclear_missing debugging
function recordUnclearDiagnostics(
	state: ExecutionState,
	orderedUnmatchedYNAB: YNABTransaction[],
	shouldRunSanityPass: boolean,
): void {
	const { params, currencyCode } = state.options;
	state.actions.push({
		type: "diagnostic_step3_entry",
		transaction: null,
		reason: `STEP 3 diagnostics: auto_unclear_missing=${params.auto_unclear_missing}, balanceAligned=${state.balanceAligned}, clearedUpdatesFailed=${state.clearedUpdatesFailed}, shouldRunSanityPass=${shouldRunSanityPass}, orderedUnmatchedYNAB.length=${orderedUnmatchedYNAB.length}`,
	});

	if (orderedUnmatchedYNAB.length === 0) {
		return;
	}

	const unmatchedDetails = orderedUnmatchedYNAB.slice(0, 10).map((t) => ({
		id: t.id,
		date: t.date,
		cleared: t.cleared,
		amount: formatDisplay(t.amount, currencyCode),
		payee: t.payee ?? "Unknown",
	}));
	state.actions.push({
		type: "diagnostic_unmatched_ynab",
		transaction: {
			unmatched_transactions: unmatchedDetails,
		} as unknown as Record<string, unknown>,
		reason: `First ${Math.min(10, orderedUnmatchedYNAB.length)} unmatched YNAB transactions (cleared status and amounts)`,
	});
}

/**
 * Walk cleared unmatched YNAB transactions newest-to-oldest, building unclear
 * payloads (or dry-run actions) until the cleared balance aligns.
 */
function collectUnclearUpdates(
	state: ExecutionState,
	orderedUnmatchedYNAB: YNABTransaction[],
): ynab.SaveTransactionWithIdOrImportId[] {
	const { params } = state.options;
	const transactionsToUnclear: ynab.SaveTransactionWithIdOrImportId[] = [];

	for (const ynabTxn of orderedUnmatchedYNAB) {
		if (ynabTxn.cleared !== "cleared") continue;
		if (state.balanceAligned) break;

		if (params.dry_run) {
			state.summary.transactions_updated += 1;
			state.actions.push({
				type: "update_transaction",
				transaction: { transaction_id: ynabTxn.id, cleared: "uncleared" },
				reason: `Would mark transaction ${ynabTxn.id} as uncleared - not present on statement`,
			});
		} else {
			// Minimal update payload - only include ID and the field we're changing
			transactionsToUnclear.push({
				id: ynabTxn.id,
				cleared: "uncleared" as ynab.TransactionClearedStatus,
			});
		}

		applyClearedDelta(state, -ynabTxn.amount);
		const trigger = params.dry_run
			? `unclearing ${ynabTxn.id} (dry run)`
			: `unclearing ${ynabTxn.id}`;
		if (recordAlignmentIfNeeded(state, trigger)) {
			break;
		}
	}

	return transactionsToUnclear;
}

// ============================================================================
// STEP 4: Mark all matched transactions as reconciled when balance aligns
// ============================================================================

async function reconcileMatchedTransactions(
	state: ExecutionState,
	matchPlan: MatchPlan,
	reconcilableMatchedTransactionIds: Set<string>,
): Promise<void> {
	const { currencyCode } = state.options;
	const transactionsToReconcile: ynab.SaveTransactionWithIdOrImportId[] = [];

	for (const { match } of matchPlan.ordered) {
		if (!match.ynabTransaction) continue;
		// Only reconcile transactions that are not already reconciled
		if (match.ynabTransaction.cleared === "reconciled") continue;
		if (!reconcilableMatchedTransactionIds.has(match.ynabTransaction.id)) {
			continue;
		}

		transactionsToReconcile.push({
			id: match.ynabTransaction.id,
			cleared: "reconciled" as ynab.TransactionClearedStatus,
		});
	}

	if (transactionsToReconcile.length === 0) {
		return;
	}
	// Not planned up front: STEP 4 only runs once the balance has aligned
	state.totalOperations += transactionsToReconcile.length;

	const failedCount = await runChunkedUpdates(state, transactionsToReconcile, {
		failureType: "batch_reconcile_failed",
		failureVerb: "reconcile",
		onChunkSuccess: async (reconciledTransactions) => {
			state.summary.transactions_updated += reconciledTransactions.length;

			for (const reconciledTransaction of reconciledTransactions) {
				const match = matchPlan.byTransactionId.get(
					reconciledTransaction.id,
				)?.match;
				state.actions.push({
					type: "update_transaction",
					transaction: reconciledTransaction as unknown as Record<
						string,
						unknown
					> | null,
					reason: `Marked as reconciled: ${match?.bankTransaction.payee ?? "transaction"} (${formatDisplay(reconciledTransaction.amount, currencyCode)})`,
				});
			}
			state.accountSnapshotDirty = true;
			state.completedOperations += reconciledTransactions.length;
			await reportProgress(
				state,
				operationsProgressMessage(
					state,
					"Marking matched transactions reconciled",
				),
			);
		},
	});

	const reconciledCount = transactionsToReconcile.length - failedCount;
	if (reconciledCount === 0) {
		return;
	}
	const failureNote =
		failedCount > 0
			? ` (${failedCount} could not be reconciled - see batch_reconcile_failed)`
			: "";
	state.actions.push({
		type: "reconciliation_complete",
		transaction: null,
		reason: `Marked ${reconciledCount} of ${transactionsToReconcile.length} matched transaction(s) as reconciled - balance aligned within tolerance${failureNote}`,
	});
}

// ============================================================================
// STEPS 5-6: Balance snapshot, recommendations, and result assembly
// ============================================================================

async function buildExecutionResult(
	state: ExecutionState,
	statementTargetMilli: number,
): Promise<ExecutionResult> {
	const {
		analysis,
		params,
		ynabAPI,
		budgetId,
		accountId,
		initialAccount,
		currencyCode,
		decimalDigits,
	} = state.options;

	// STEP 5: Balance reconciliation snapshot (only once per execution)
	let balanceReconciliation: ExecutionResult["balance_reconciliation"];
	if (params.statement_balance !== undefined && params.statement_end_date) {
		balanceReconciliation = await buildBalanceReconciliation({
			ynabAPI,
			budgetId,
			accountId,
			statementDate: params.statement_end_date,
			statementBalanceMilli: statementTargetMilli,
			...(decimalDigits !== undefined && { decimalDigits }),
			analysis,
		});
	}

	// STEP 6: Recommendations and balance changes
	let afterAccount: AccountSnapshot = { ...initialAccount };
	if (!params.dry_run && state.accountSnapshotDirty) {
		afterAccount = await refreshAccountSnapshot(ynabAPI, budgetId, accountId);
	}

	const balanceChangeMilli =
		params.dry_run || !state.accountSnapshotDirty
			? 0
			: afterAccount.balance - initialAccount.balance;

	const recommendations = buildRecommendations({
		summary: state.summary,
		params,
		analysis,
		balanceChangeMilli,
		currencyCode,
	});

	const result: ExecutionResult = {
		summary: state.summary,
		account_balance: {
			before: initialAccount,
			after: afterAccount,
		},
		actions_taken: state.actions,
		recommendations,
	};

	if (balanceReconciliation !== undefined) {
		result.balance_reconciliation = balanceReconciliation;
	}

	const bulkDetails = state.bulkOperationDetails;
	if (bulkDetails) {
		// Ensure failed_transactions mirrors transaction_failures for backward compatibility
		bulkDetails.failed_transactions = bulkDetails.transaction_failures;
		result.bulk_operation_details = bulkDetails;
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
