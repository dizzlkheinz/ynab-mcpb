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
	handleCreateReceiptSplitTransaction,
	handleCreateTransaction,
	handleCreateTransactions,
	handleDeleteTransaction,
	handleGetTransaction,
	handleListTransactions,
	handleUpdateTransaction,
	handleUpdateTransactions,
};

// ============================================================================
// Schema re-exports
// ============================================================================

/**
 * Re-export schemas and types from transactionSchemas.ts so the transaction tests
 * can import them alongside the handlers. knip flags any name nothing imports.
 */
export {
	type BulkTransactionInput,
	type CreateReceiptSplitTransactionParams,
	CreateReceiptSplitTransactionSchema,
	CreateTransactionSchema,
	type CreateTransactionsParams,
	CreateTransactionsSchema,
	DeleteTransactionSchema,
	GetTransactionSchema,
	ListTransactionsSchema,
	UpdateTransactionSchema,
	UpdateTransactionsSchema,
} from "./transactionSchemas.js";
