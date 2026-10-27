import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import type { SaveTransactionsResponseData } from "ynab/dist/models/SaveTransactionsResponseData.js";
import type { ErrorHandler } from "../server/errorHandler.js";
import { globalRequestLogger } from "../server/requestLogger.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type {
	BulkCreateResponse,
	BulkTransactionInput,
	BulkTransactionResult,
	BulkUpdateResponse,
	CorrelationPayload,
	CorrelationPayloadInput,
} from "./transactionSchemas.js";

/**
 * Transaction Utilities
 *
 * This module contains utility functions for transaction operations.
 * Extracted from transactionTools.ts for better code organization.
 */

// ============================================================================
// Response Size Constants
// ============================================================================

const FULL_RESPONSE_THRESHOLD = 64 * 1024;
const SUMMARY_RESPONSE_THRESHOLD = 96 * 1024;
const MAX_RESPONSE_BYTES = 100 * 1024;

// ============================================================================
// Transaction Helpers
// ============================================================================

/**
 * Utility function to ensure transaction is not null/undefined
 */
export function ensureTransaction<T>(
	transaction: T | undefined,
	errorMessage: string,
): T {
	if (!transaction) {
		throw new Error(errorMessage);
	}
	return transaction;
}

// ============================================================================
// Correlation Utilities
// ============================================================================

/**
 * Generates a correlation key for a transaction
 */
export function generateCorrelationKey(transaction: {
	account_id?: string;
	date?: string;
	amount?: number;
	payee_id?: string | null;
	payee_name?: string | null;
	category_id?: string | null;
	memo?: string | null;
	cleared?: ynab.TransactionClearedStatus;
	approved?: boolean;
	flag_color?: ynab.TransactionFlagColor | null;
	import_id?: string | null;
}): string {
	if (transaction.import_id) {
		return transaction.import_id;
	}

	const segments = [
		`account:${transaction.account_id ?? ""}`,
		`date:${transaction.date ?? ""}`,
		`amount:${transaction.amount ?? 0}`,
		`payee:${transaction.payee_id ?? transaction.payee_name ?? ""}`,
		`category:${transaction.category_id ?? ""}`,
		`memo:${transaction.memo ?? ""}`,
		`cleared:${transaction.cleared ?? ""}`,
		`approved:${transaction.approved ?? false}`,
		`flag:${transaction.flag_color ?? ""}`,
	];

	const normalized = segments.join("|");
	const hash = createHash("sha256")
		.update(normalized)
		.digest("hex")
		.slice(0, 16);
	return `hash:${hash}`;
}

/**
 * Converts a transaction input to a correlation payload
 */
export function toCorrelationPayload(
	transaction: CorrelationPayloadInput,
): CorrelationPayload {
	const payload: CorrelationPayload = {};
	if (transaction.account_id !== undefined) {
		payload.account_id = transaction.account_id;
	}
	if (transaction.date !== undefined) {
		payload.date = transaction.date;
	}
	if (transaction.amount !== undefined) {
		payload.amount = transaction.amount;
	}
	if (transaction.cleared !== undefined) {
		payload.cleared = transaction.cleared;
	}
	if (transaction.approved !== undefined) {
		payload.approved = transaction.approved;
	}
	if (transaction.flag_color !== undefined) {
		payload.flag_color = transaction.flag_color;
	}
	payload.payee_id = transaction.payee_id ?? null;
	payload.payee_name = transaction.payee_name ?? null;
	payload.category_id = transaction.category_id ?? null;
	payload.memo = transaction.memo ?? null;
	payload.import_id = transaction.import_id ?? null;
	return payload;
}

/**
 * Correlates bulk transaction requests with YNAB response data
 */
export function correlateResults(
	requests: BulkTransactionInput[],
	responseData: SaveTransactionsResponseData,
	duplicateImportIds: Set<string>,
): BulkTransactionResult[] {
	const createdByImportId = new Map<string, string[]>();
	const createdByHash = new Map<string, string[]>();
	const createdByPayeeAgnosticHash = new Map<string, string[]>();
	const claimedTransactionIds = new Set<string>();
	const responseTransactions = responseData.transactions ?? [];

	const register = (
		map: Map<string, string[]>,
		key: string,
		transactionId: string,
	): void => {
		const existing = map.get(key);
		if (existing) {
			existing.push(transactionId);
			return;
		}
		map.set(key, [transactionId]);
	};

	for (const transaction of responseTransactions) {
		if (!transaction.id) {
			continue;
		}
		const key = generateCorrelationKey(transaction);
		if (key.startsWith("hash:")) {
			register(createdByHash, key, transaction.id);
			const payeeAgnosticKey = generateCorrelationKey({
				...transaction,
				payee_id: null,
				payee_name: null,
			});
			register(createdByPayeeAgnosticHash, payeeAgnosticKey, transaction.id);
		} else {
			register(createdByImportId, key, transaction.id);
		}
	}

	const popId = (
		map: Map<string, string[]>,
		key: string,
	): string | undefined => {
		const bucket = map.get(key);
		if (!bucket || bucket.length === 0) {
			return undefined;
		}
		let transactionId: string | undefined;
		while (bucket.length > 0 && transactionId === undefined) {
			const [candidate] = bucket.splice(0, 1);
			if (candidate && !claimedTransactionIds.has(candidate)) {
				transactionId = candidate;
			}
		}
		if (bucket.length === 0) {
			map.delete(key);
		}
		if (transactionId) {
			claimedTransactionIds.add(transactionId);
		}
		return transactionId;
	};

	const popUniqueId = (
		map: Map<string, string[]>,
		key: string,
	): string | undefined => {
		const candidates = (map.get(key) ?? []).filter(
			(id) => !claimedTransactionIds.has(id),
		);
		if (candidates.length !== 1) {
			return undefined;
		}
		const [transactionId] = candidates;
		if (transactionId) {
			claimedTransactionIds.add(transactionId);
		}
		return transactionId;
	};

	const correlatedResults: BulkTransactionResult[] = [];

	for (const [index, transaction] of requests.entries()) {
		const normalizedRequest = toCorrelationPayload(transaction);
		const correlationKey = generateCorrelationKey(normalizedRequest);

		if (
			transaction.import_id &&
			duplicateImportIds.has(transaction.import_id)
		) {
			correlatedResults.push({
				request_index: index,
				status: "duplicate",
				correlation_key: correlationKey,
			});
			continue;
		}

		let transactionId: string | undefined;
		if (correlationKey.startsWith("hash:")) {
			transactionId = popId(createdByHash, correlationKey);
		} else {
			transactionId = popId(createdByImportId, correlationKey);
		}

		if (!transactionId && !correlationKey.startsWith("hash:")) {
			// Attempt hash-based fallback if import_id was not matched.
			const hashKey = generateCorrelationKey(
				toCorrelationPayload({ ...transaction, import_id: undefined }),
			);
			transactionId = popId(createdByHash, hashKey);
		}

		if (!transactionId) {
			// YNAB responses may contain only payee_id even when the request used
			// payee_name. Ignore payee only when the remaining fields identify one
			// unclaimed response; ambiguous matches are left failed rather than
			// assigning the wrong transaction ID.
			const payeeAgnosticKey = generateCorrelationKey(
				toCorrelationPayload({
					...transaction,
					payee_id: undefined,
					payee_name: undefined,
					import_id: undefined,
				}),
			);
			transactionId = popUniqueId(createdByPayeeAgnosticHash, payeeAgnosticKey);
		}

		if (transactionId) {
			const successResult: BulkTransactionResult = {
				request_index: index,
				status: "created",
				correlation_key: correlationKey,
			};
			successResult.transaction_id = transactionId;
			correlatedResults.push(successResult);
			continue;
		}

		globalRequestLogger.logError(
			"ynab:create_transactions",
			"correlate_results",
			{
				request_index: index,
				correlation_key: correlationKey,
				request: {
					account_id: transaction.account_id,
					date: transaction.date,
					amount: transaction.amount,
					import_id: transaction.import_id,
				},
			},
			"correlation_failed",
		);

		correlatedResults.push({
			request_index: index,
			status: "failed",
			correlation_key: correlationKey,
			error_code: "correlation_failed",
			error: "Unable to correlate request transaction with YNAB response",
		});
	}

	return correlatedResults;
}

// ============================================================================
// Response Utilities
// ============================================================================

/**
 * Estimates the size of a payload in bytes
 */
export function estimatePayloadSize(
	payload: BulkCreateResponse | BulkUpdateResponse,
): number {
	return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

/** Keep a truthful mutation receipt even when optional result details are too large. */
function finalizeBulkResponse<
	T extends BulkCreateResponse | BulkUpdateResponse,
>(response: T): T {
	const full = { ...response, mode: "full" as const };
	if (estimatePayloadSize(full) <= FULL_RESPONSE_THRESHOLD) return full;
	const { transactions: _transactions, ...fields } = response;
	const summary = {
		...fields,
		mode: "summary" as const,
		message: [
			response.message,
			"Response downgraded to summary to stay under size limits.",
		]
			.filter(Boolean)
			.join(" "),
	} as T;
	if (estimatePayloadSize(summary) <= SUMMARY_RESPONSE_THRESHOLD)
		return summary;
	const compact = {
		...summary,
		mode: "ids_only" as const,
		results: response.results.map((result) => ({
			request_index: result.request_index,
			status: result.status,
			correlation_key: result.correlation_key,
			...(result.transaction_id === undefined
				? {}
				: { transaction_id: result.transaction_id }),
			...(result.error ? { error: result.error } : {}),
			...(result.error_code ? { error_code: result.error_code } : {}),
		})),
		message: [
			response.message,
			"Response downgraded to ids_only to meet 100KB limit.",
		]
			.filter(Boolean)
			.join(" "),
	} as T;
	if (estimatePayloadSize(compact) <= MAX_RESPONSE_BYTES) return compact;
	// Execution already completed. An oversized report must never suggest retrying
	// the entire mutation by turning its successful API response into a tool error.
	return {
		success: response.success,
		summary: response.summary,
		results: [],
		results_omitted: true,
		mode: "summary",
		...(response.server_knowledge === undefined
			? {}
			: { server_knowledge: response.server_knowledge }),
		message:
			"Batch processed. Individual result details exceeded the response limit and were omitted. Check the summary and fetch transactions before retrying any failed items.",
	} as unknown as T;
}

export function finalizeResponse(
	response: BulkCreateResponse,
): BulkCreateResponse {
	return finalizeBulkResponse(response);
}

export function finalizeBulkUpdateResponse(
	response: BulkUpdateResponse,
): BulkUpdateResponse {
	return finalizeBulkResponse(response);
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Handles errors from transaction-related API calls
 */
export function handleTransactionError(
	error: unknown,
	defaultMessage: string,
	errorHandler?: ErrorHandler,
	context = defaultMessage,
): CallToolResult {
	if (errorHandler) {
		return errorHandler.handleError(error, context);
	}

	let errorMessage = defaultMessage;

	if (error instanceof Error) {
		if (
			error.message.includes("401") ||
			error.message.includes("Unauthorized")
		) {
			errorMessage = "Invalid or expired YNAB access token";
		} else if (
			error.message.includes("403") ||
			error.message.includes("Forbidden")
		) {
			errorMessage = "Insufficient permissions to access YNAB data";
		} else if (
			error.message.includes("404") ||
			error.message.includes("Not Found")
		) {
			errorMessage = "Budget, account, category, or transaction not found";
		} else if (
			error.message.includes("429") ||
			error.message.includes("Too Many Requests")
		) {
			errorMessage = "Rate limit exceeded. Please try again later";
		} else if (
			error.message.includes("500") ||
			error.message.includes("Internal Server Error")
		) {
			errorMessage = "YNAB service is currently unavailable";
		}
	}

	return {
		isError: true,
		content: [
			{
				type: "text",
				text: responseFormatter.format({
					error: {
						message: errorMessage,
					},
				}),
			},
		],
	};
}
