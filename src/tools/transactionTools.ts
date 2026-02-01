/**
 * Transaction Tools - Facade Module
 *
 * This module delegates to:
 * - transactionReadTools.ts  — read-only handlers (list, get, export)
 * - transactionWriteTools.ts — write handlers (create, update, delete)
 *
 * Schemas and types live in transactionSchemas.ts.
 * Utility functions live in transactionUtils.ts.
 */

import type { ToolFactory } from "../types/toolRegistration.js";
import {
	handleGetTransaction,
	handleListTransactions,
	registerTransactionReadTools,
} from "./transactionReadTools.js";
import {
	handleCreateReceiptSplitTransaction,
	handleCreateTransaction,
	handleCreateTransactions,
	handleDeleteTransaction,
	handleUpdateTransaction,
	handleUpdateTransactions,
	registerTransactionWriteTools,
} from "./transactionWriteTools.js";

// ============================================================================
// Registration facade — called by YNABMCPServer.setupToolRegistry()
// ============================================================================

/**
 * Registers all transaction-domain tools with the provided registry.
 */
export const registerTransactionTools: ToolFactory = (registry, context) => {
	registerTransactionReadTools(registry, context);
	registerTransactionWriteTools(registry, context);
};

// ============================================================================
// Re-export handler functions for consumers
// ============================================================================

export {
	handleListTransactions,
	handleGetTransaction,
	handleCreateTransaction,
	handleCreateReceiptSplitTransaction,
	handleUpdateTransaction,
	handleDeleteTransaction,
	handleCreateTransactions,
	handleUpdateTransactions,
};

// ============================================================================
// Re-exports for backward compatibility
// ============================================================================

/**
 * Re-export schemas and types from transactionSchemas.ts
 * These exports maintain backward compatibility for code that imports directly from transactionTools.ts
 */
export {
	ListTransactionsSchema,
	type ListTransactionsParams,
	GetTransactionSchema,
	type GetTransactionParams,
	CreateTransactionSchema,
	type CreateTransactionParams,
	CreateTransactionsSchema,
	type CreateTransactionsParams,
	CreateReceiptSplitTransactionSchema,
	type CreateReceiptSplitTransactionParams,
	UpdateTransactionSchema,
	type UpdateTransactionParams,
	UpdateTransactionsSchema,
	type UpdateTransactionsParams,
	type BulkUpdateTransactionInput,
	DeleteTransactionSchema,
	type DeleteTransactionParams,
	type BulkTransactionResult,
	type BulkCreateResponse,
	type BulkUpdateResult,
	type BulkUpdateResponse,
	type CorrelationPayload,
	type CorrelationPayloadInput,
	type CategorySource,
	type TransactionCacheInvalidationOptions,
	type ReceiptCategoryCalculation,
	type SubtransactionInput,
	type BulkTransactionInput,
} from "./transactionSchemas.js";

/**
 * Re-export utility functions from transactionUtils.ts
 * These exports maintain backward compatibility for code that imports directly from transactionTools.ts
 */
export {
	generateCorrelationKey,
	toCorrelationPayload,
	correlateResults,
	estimatePayloadSize,
	finalizeResponse,
	finalizeBulkUpdateResponse,
	handleTransactionError,
	toMonthKey,
	ensureTransaction,
	appendCategoryIds,
	collectCategoryIdsFromSources,
	setsEqual,
	invalidateTransactionCaches,
} from "./transactionUtils.js";
