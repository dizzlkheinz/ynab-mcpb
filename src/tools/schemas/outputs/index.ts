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
 * @example
 * ```typescript
 * import { GetUserOutputSchema, type GetUserOutput } from './schemas/outputs/index.js';
 * import { ListBudgetsOutputSchema, type ListBudgetsOutput } from './schemas/outputs/index.js';
 * import { CreateTransactionOutputSchema, type CreateTransactionOutput } from './schemas/outputs/index.js';
 * ```
 */

// ============================================================================
// UTILITY TOOL OUTPUT SCHEMAS
// ============================================================================

// Main output schemas
// Nested schemas that may be useful independently
export {
	BudgetDetailSchema,
	CacheInfoSchema,
	type ClearCacheOutput,
	ClearCacheOutputSchema,
	CurrencyFormatSchema,
	DateFormatSchema,
	DeltaInfoSchema,
	type DiagnosticInfoOutput,
	DiagnosticInfoOutputSchema,
	EnvironmentInfoSchema,
	type GetBudgetOutput,
	GetBudgetOutputSchema,
	type GetDefaultBudgetOutput,
	GetDefaultBudgetOutputSchema,
	type GetUserOutput,
	GetUserOutputSchema,
	MemoryInfoSchema,
	ServerInfoSchema,
	type SetDefaultBudgetOutput,
	SetDefaultBudgetOutputSchema,
	UserSchema,
} from "./utilityOutputs.js";

// ============================================================================
// BUDGET TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	type BudgetSummary,
	BudgetSummarySchema,
	type ListBudgetsOutput,
	ListBudgetsOutputSchema,
} from "./budgetOutputs.js";

// ============================================================================
// ACCOUNT TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	type Account,
	AccountSchema,
	type GetAccountOutput,
	GetAccountOutputSchema,
	type ListAccountsOutput,
	ListAccountsOutputSchema,
} from "./accountOutputs.js";

// ============================================================================
// TRANSACTION TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	type GetTransactionOutput,
	GetTransactionOutputSchema,
	type ListTransactionsOutput,
	ListTransactionsOutputSchema,
	type Transaction,
	type TransactionPreview,
	TransactionPreviewSchema,
	TransactionSchema,
} from "./transactionOutputs.js";

// ============================================================================
// CATEGORY TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	type Category,
	type CategoryGroup,
	CategoryGroupSchema,
	CategorySchema,
	type GetCategoryOutput,
	GetCategoryOutputSchema,
	type ListCategoriesOutput,
	ListCategoriesOutputSchema,
} from "./categoryOutputs.js";

// ============================================================================
// PAYEE TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	type GetPayeeOutput,
	GetPayeeOutputSchema,
	type ListPayeesOutput,
	ListPayeesOutputSchema,
	type Payee,
	PayeeSchema,
} from "./payeeOutputs.js";

// ============================================================================
// MONTH TOOL OUTPUT SCHEMAS
// ============================================================================

export {
	type GetMonthOutput,
	GetMonthOutputSchema,
	type ListMonthsOutput,
	ListMonthsOutputSchema,
	type MonthCategory,
	MonthCategorySchema,
	type MonthDetail,
	MonthDetailSchema,
	type MonthSummary,
	MonthSummarySchema,
} from "./monthOutputs.js";

// ============================================================================
// TRANSACTION MUTATION OUTPUT SCHEMAS
// ============================================================================

// Nested schemas for transaction mutations
export {
	type BulkOperationSummary,
	BulkOperationSummarySchema,
	type BulkResult,
	BulkResultSchema,
	type CreateAccountOutput,
	CreateAccountOutputSchema,
	type CreateReceiptSplitTransactionOutput,
	CreateReceiptSplitTransactionOutputSchema,
	type CreateTransactionOutput,
	CreateTransactionOutputSchema,
	type CreateTransactionsOutput,
	CreateTransactionsOutputSchema,
	type DeleteTransactionOutput,
	DeleteTransactionOutputSchema,
	type DryRunPreviewItem,
	DryRunPreviewItemSchema,
	type DryRunWarning,
	DryRunWarningSchema,
	type ReceiptCategoryBreakdown,
	ReceiptCategoryBreakdownSchema,
	type ReceiptItem,
	ReceiptItemSchema,
	type ReceiptSummary,
	ReceiptSummarySchema,
	type Subtransaction,
	type SubtransactionPreview,
	SubtransactionPreviewSchema,
	SubtransactionSchema,
	type TransactionDryRunPreview,
	TransactionDryRunPreviewSchema,
	type TransactionWithBalance,
	TransactionWithBalanceSchema,
	type UpdateCategoryOutput,
	UpdateCategoryOutputSchema,
	type UpdateTransactionOutput,
	UpdateTransactionOutputSchema,
	type UpdateTransactionsOutput,
	UpdateTransactionsOutputSchema,
} from "./transactionMutationOutputs.js";

// ============================================================================
// RECONCILIATION OUTPUT SCHEMAS
// ============================================================================

// Nested schemas for reconciliation
export {
	type ActionableRecommendation,
	ActionableRecommendationSchema,
	type AuditMetadata,
	AuditMetadataSchema,
	type BalanceInfo,
	BalanceInfoSchema,
	type BankTransaction,
	BankTransactionSchema,
	type ExecutionResult,
	ExecutionResultSchema,
	type MatchCandidate,
	MatchCandidateSchema,
	type MoneyValue,
	MoneyValueSchema,
	type ReconcileAccountOutput,
	ReconcileAccountOutputSchema,
	type ReconciliationInsight,
	ReconciliationInsightSchema,
	type ReconciliationSummary,
	ReconciliationSummarySchema,
	type TransactionMatch,
	TransactionMatchSchema,
	type YNABTransactionSimple,
	YNABTransactionSimpleSchema,
} from "./reconciliationOutputs.js";

// ============================================================================
// COMPARISON AND EXPORT OUTPUT SCHEMAS
// ============================================================================

/**
 * Nested schemas for comparison and export.
 *
 * @remarks
 * Some of these schemas are for internal processing and not guaranteed to be stable:
 * - **Internal-only (may change):** BankTransactionComparisonSchema, YNABTransactionComparisonSchema,
 *   TransactionMatchComparisonSchema - Used during matching algorithm, not in final output
 * - **Public contracts (stable):** ComparisonParametersSchema, DateRangeSchema, ExportInfoSchema,
 *   ExportedTransactionSchema - Part of durable tool output format
 *
 * Internal schemas are exported for testing and advanced use cases, but should not be relied upon
 * for backward compatibility. Use the main output schemas (CompareTransactionsOutputSchema,
 * ExportTransactionsOutputSchema) for stable contracts.
 */
export {
	type BankTransactionComparison,
	/** @internal - Used during matching algorithm, not part of public output */
	BankTransactionComparisonSchema,
	type CompareTransactionsOutput,
	CompareTransactionsOutputSchema,
	type ComparisonParameters,
	// Public contracts below - part of stable tool output
	ComparisonParametersSchema,
	type DateRange,
	DateRangeSchema,
	type ExportedTransaction,
	ExportedTransactionSchema,
	type ExportInfo,
	ExportInfoSchema,
	type ExportTransactionsOutput,
	ExportTransactionsOutputSchema,
	type TransactionMatchComparison,
	/** @internal - Used during matching algorithm, not part of public output */
	TransactionMatchComparisonSchema,
	type YNABTransactionComparison,
	/** @internal - Used during matching algorithm, not part of public output */
	YNABTransactionComparisonSchema,
} from "./comparisonOutputs.js";
