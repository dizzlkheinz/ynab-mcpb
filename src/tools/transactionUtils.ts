import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import type { SaveTransactionsResponseData } from "ynab/dist/models/SaveTransactionsResponseData.js";
import { CacheManager, cacheManager } from "../server/cacheManager.js";
import type { DeltaCache } from "../server/deltaCache.js";
import { globalRequestLogger } from "../server/requestLogger.js";
import { invalidateBudgetResourceCaches } from "../server/resourceCacheInvalidation.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ServerKnowledgeStore } from "../server/serverKnowledgeStore.js";
import { ValidationError } from "../types/index.js";
import type {
	BulkCreateResponse,
	BulkTransactionInput,
	BulkTransactionResult,
	BulkUpdateResponse,
	CategorySource,
	CorrelationPayload,
	CorrelationPayloadInput,
	TransactionCacheInvalidationOptions,
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
// Category Helpers
// ============================================================================

/**
 * Appends category IDs from a source to a target set
 */
export function appendCategoryIds(
	source: CategorySource | undefined,
	target: Set<string>,
): void {
	if (!source) {
		return;
	}
	if (source.category_id) {
		target.add(source.category_id);
	}
	if (Array.isArray(source.subtransactions)) {
		for (const sub of source.subtransactions) {
			if (sub?.category_id) {
				target.add(sub.category_id);
			}
		}
	}
}

/**
 * Collects category IDs from multiple sources
 */
export function collectCategoryIdsFromSources(
	...sources: (CategorySource | undefined)[]
): Set<string> {
	const result = new Set<string>();
	for (const source of sources) {
		appendCategoryIds(source, result);
	}
	return result;
}

/**
 * Checks if two sets are equal
 */
export function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
	if (a.size !== b.size) {
		return false;
	}
	for (const value of a) {
		if (!b.has(value)) {
			return false;
		}
	}
	return true;
}

// ============================================================================
// Cache Invalidation
// ============================================================================

/**
 * Converts a date string to a month key
 */
export const toMonthKey = (date: string): string => `${date.slice(0, 7)}-01`;

/**
 * Invalidates transaction-related caches after write operations
 */
export function invalidateTransactionCaches(
	deltaCache: DeltaCache,
	knowledgeStore: ServerKnowledgeStore,
	budgetId: string,
	serverKnowledge: number | undefined,
	affectedAccountIds: Set<string>,
	affectedMonths: Set<string>,
	options: TransactionCacheInvalidationOptions = {},
): void {
	deltaCache.invalidate(budgetId, "transactions");
	cacheManager.delete(
		CacheManager.generateKey("transactions", "list", budgetId),
	);

	for (const accountId of affectedAccountIds) {
		const accountPrefix = CacheManager.generateKey(
			"transactions",
			"account",
			budgetId,
			accountId,
		);
		cacheManager.deleteByPrefix(accountPrefix);
	}

	const invalidateAccountsList = options.accountTotalsChanged ?? true;
	if (invalidateAccountsList) {
		cacheManager.delete(CacheManager.generateKey("accounts", "list", budgetId));
	}
	for (const accountId of affectedAccountIds) {
		cacheManager.delete(
			CacheManager.generateKey("account", "get", budgetId, accountId),
		);
	}

	const affectedCategoryIds = options.affectedCategoryIds ?? new Set<string>();
	const shouldInvalidateCategories =
		options.invalidateAllCategories || affectedCategoryIds.size > 0;
	if (shouldInvalidateCategories) {
		cacheManager.delete(
			CacheManager.generateKey("categories", "list", budgetId),
		);
		for (const categoryId of affectedCategoryIds) {
			cacheManager.delete(
				CacheManager.generateKey("category", "get", budgetId, categoryId),
			);
		}
	}

	const shouldInvalidateMonths =
		options.invalidateMonths ?? affectedMonths.size > 0;
	if (shouldInvalidateMonths) {
		cacheManager.delete(CacheManager.generateKey("months", "list", budgetId));
		deltaCache.invalidate(budgetId, "months");
		for (const month of affectedMonths) {
			cacheManager.delete(
				CacheManager.generateKey("month", "get", budgetId, month),
			);
		}
	}
	invalidateBudgetResourceCaches(budgetId, {
		accountIds: affectedAccountIds,
		invalidateAccountsList,
		invalidateCategoriesList: shouldInvalidateCategories,
		invalidateMonthsList: shouldInvalidateMonths,
		...(shouldInvalidateMonths ? { monthKeys: affectedMonths } : {}),
	});

	if (serverKnowledge !== undefined) {
		const transactionCacheKey = CacheManager.generateKey(
			"transactions",
			"list",
			budgetId,
		);
		knowledgeStore.update(transactionCacheKey, serverKnowledge);
		if (invalidateAccountsList) {
			const accountsCacheKey = CacheManager.generateKey(
				"accounts",
				"list",
				budgetId,
			);
			knowledgeStore.update(accountsCacheKey, serverKnowledge);
		}
		if (shouldInvalidateMonths && affectedMonths.size > 0) {
			const monthsCacheKey = CacheManager.generateKey(
				"months",
				"list",
				budgetId,
			);
			knowledgeStore.update(monthsCacheKey, serverKnowledge);
		}
	}
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
			// YNAB populates payee_id on responses even when the request only sent payee_name.
			// Register a secondary hash using payee_name only so requests that omitted payee_id
			// (e.g. reconciliation bulk creates) can still find their created transaction.
			if (transaction.payee_id) {
				const nameOnlyKey = generateCorrelationKey({
					...transaction,
					payee_id: null,
				});
				if (nameOnlyKey !== key) {
					register(createdByHash, nameOnlyKey, transaction.id);
				}
			}
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
		const [transactionId] = bucket.splice(0, 1);
		if (bucket.length === 0) {
			map.delete(key);
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

/**
 * Finalizes bulk create response based on size constraints
 */
export function finalizeResponse(
	response: BulkCreateResponse,
): BulkCreateResponse {
	const appendMessage = (
		message: string | undefined,
		addition: string,
	): string => {
		if (!message) {
			return addition;
		}
		if (message.includes(addition)) {
			return message;
		}
		return `${message} ${addition}`;
	};

	const fullSize = estimatePayloadSize({ ...response, mode: "full" });
	if (fullSize <= FULL_RESPONSE_THRESHOLD) {
		return { ...response, mode: "full" };
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { transactions, ...summaryResponse } = response;
	const summaryPayload: BulkCreateResponse = {
		...summaryResponse,
		message: appendMessage(
			response.message,
			"Response downgraded to summary to stay under size limits.",
		),
		mode: "summary",
	};

	if (estimatePayloadSize(summaryPayload) <= SUMMARY_RESPONSE_THRESHOLD) {
		return summaryPayload;
	}

	const idsOnlyPayload: BulkCreateResponse = {
		...summaryPayload,
		results: summaryResponse.results.map((result) => ({
			request_index: result.request_index,
			status: result.status,
			transaction_id: result.transaction_id,
			correlation_key: result.correlation_key,
			error: result.error,
		})),
		message: appendMessage(
			summaryResponse.message,
			"Response downgraded to ids_only to meet 100KB limit.",
		),
		mode: "ids_only",
	};

	if (estimatePayloadSize(idsOnlyPayload) <= MAX_RESPONSE_BYTES) {
		return idsOnlyPayload;
	}

	throw new ValidationError(
		"RESPONSE_TOO_LARGE: Unable to format bulk create response within 100KB limit",
		`Batch size: ${response.summary.total_requested} transactions`,
		[
			"Reduce the batch size and retry",
			"Consider splitting into multiple smaller batches",
		],
	);
}

/**
 * Finalizes bulk update response based on size constraints
 */
export function finalizeBulkUpdateResponse(
	response: BulkUpdateResponse,
): BulkUpdateResponse {
	const appendMessage = (
		message: string | undefined,
		addition: string,
	): string => {
		if (!message) {
			return addition;
		}
		if (message.includes(addition)) {
			return message;
		}
		return `${message} ${addition}`;
	};

	const fullSize = estimatePayloadSize(response);
	if (fullSize <= FULL_RESPONSE_THRESHOLD) {
		return { ...response, mode: "full" };
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { transactions, ...summaryResponse } = response;
	const summaryPayload: BulkUpdateResponse = {
		...summaryResponse,
		message: appendMessage(
			response.message,
			"Response downgraded to summary to stay under size limits.",
		),
		mode: "summary",
	};

	if (estimatePayloadSize(summaryPayload) <= SUMMARY_RESPONSE_THRESHOLD) {
		return summaryPayload;
	}

	const idsOnlyPayload: BulkUpdateResponse = {
		...summaryPayload,
		results: summaryResponse.results.map((result) => {
			const simplified: BulkUpdateResponse["results"][number] = {
				request_index: result.request_index,
				status: result.status,
				transaction_id: result.transaction_id,
				correlation_key: result.correlation_key,
			};
			if (result.error) {
				simplified.error = result.error;
			}
			if (result.error_code) {
				simplified.error_code = result.error_code;
			}
			return simplified;
		}),
		message: appendMessage(
			summaryResponse.message,
			"Response downgraded to ids_only to meet 100KB limit.",
		),
		mode: "ids_only",
	};

	if (estimatePayloadSize(idsOnlyPayload) <= MAX_RESPONSE_BYTES) {
		return idsOnlyPayload;
	}

	throw new ValidationError(
		"RESPONSE_TOO_LARGE: Unable to format bulk update response within 100KB limit",
		`Batch size: ${response.summary.total_requested} transactions`,
		[
			"Reduce the batch size and retry",
			"Consider splitting into multiple smaller batches",
		],
	);
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
): CallToolResult {
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
