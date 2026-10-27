/**
 * @fileoverview Central export point for all output schemas
 *
 * This file provides a single import location for all output validation schemas
 * used throughout the YNAB MCP server. Import from this file rather than
 * individual schema files for convenience and consistency.
 *
 * Includes schemas for: utilities, budgets, accounts, transactions (list/get),
 * categories, payees, months, transaction mutations (create/update/delete),
 * reconciliation analysis, and comparison/export operations.
 *
 * Only the tool output schemas registered with the ToolRegistry are exported here;
 * nested schemas and inferred types stay in their domain files.
 *
 * @example
 * ```typescript
 * import { GetUserOutputSchema } from './schemas/outputs/index.js';
 * ```
 */

// ============================================================================
// UTILITY TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	ClearCacheOutputSchema,
	DiagnosticInfoOutputSchema,
	GetBudgetOutputSchema,
	GetDefaultBudgetOutputSchema,
	GetUserOutputSchema,
	SetDefaultBudgetOutputSchema,
} from "./utilityOutputs.js";

// ============================================================================
// BUDGET TOOL OUTPUT SCHEMAS
// ============================================================================

export { ListBudgetsOutputSchema } from "./budgetOutputs.js";

// ============================================================================
// ACCOUNT TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	GetAccountOutputSchema,
	ListAccountsOutputSchema,
} from "./accountOutputs.js";

// ============================================================================
// TRANSACTION TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	GetTransactionOutputSchema,
	ListTransactionsOutputSchema,
} from "./transactionOutputs.js";

// ============================================================================
// CATEGORY TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	GetCategoryOutputSchema,
	ListCategoriesOutputSchema,
} from "./categoryOutputs.js";

// ============================================================================
// PAYEE TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	GetPayeeOutputSchema,
	ListPayeesOutputSchema,
} from "./payeeOutputs.js";

// ============================================================================
// MONTH TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	GetMonthOutputSchema,
	ListMonthsOutputSchema,
} from "./monthOutputs.js";

// ============================================================================
// TRANSACTION MUTATION OUTPUT SCHEMAS
// ============================================================================

export {
	CreateAccountOutputSchema,
	CreateReceiptSplitTransactionOutputSchema,
	CreateTransactionOutputSchema,
	CreateTransactionsOutputSchema,
	DeleteTransactionOutputSchema,
	UpdateCategoryOutputSchema,
	UpdateTransactionOutputSchema,
	UpdateTransactionsOutputSchema,
} from "./transactionMutationOutputs.js";

// ============================================================================
// RECONCILIATION OUTPUT SCHEMAS
// ============================================================================

export { ReconcileAccountOutputSchema } from "./reconciliationOutputs.js";

// ============================================================================
// COMPARISON AND EXPORT OUTPUT SCHEMAS
// ============================================================================

export {
	CompareTransactionsOutputSchema,
	ExportTransactionsOutputSchema,
} from "./comparisonOutputs.js";
