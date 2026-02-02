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
	type BulkCreateResponse,
	type BulkTransactionInput,
	type BulkTransactionResult,
	type BulkUpdateResponse,
	type BulkUpdateResult,
	type BulkUpdateTransactionInput,
	type CategorySource,
	type CorrelationPayload,
	type CorrelationPayloadInput,
	type CreateReceiptSplitTransactionParams,
	CreateReceiptSplitTransactionSchema,
	type CreateTransactionParams,
	CreateTransactionSchema,
	type CreateTransactionsParams,
	CreateTransactionsSchema,
	type DeleteTransactionParams,
	DeleteTransactionSchema,
	type GetTransactionParams,
	GetTransactionSchema,
	type ListTransactionsParams,
	ListTransactionsSchema,
	type ReceiptCategoryCalculation,
	type SubtransactionInput,
	type TransactionCacheInvalidationOptions,
	type UpdateTransactionParams,
	UpdateTransactionSchema,
	type UpdateTransactionsParams,
	UpdateTransactionsSchema,
} from "./transactionSchemas.js";

/**
 * Re-export utility functions from transactionUtils.ts
 * These exports maintain backward compatibility for code that imports directly from transactionTools.ts
 */
export {
	appendCategoryIds,
	collectCategoryIdsFromSources,
	correlateResults,
	ensureTransaction,
	estimatePayloadSize,
	finalizeBulkUpdateResponse,
	finalizeResponse,
	generateCorrelationKey,
	handleTransactionError,
	invalidateTransactionCaches,
	setsEqual,
	toCorrelationPayload,
	toMonthKey,
} from "./transactionUtils.js";
