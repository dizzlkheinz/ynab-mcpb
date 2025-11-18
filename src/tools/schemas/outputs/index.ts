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
export {
  GetUserOutputSchema,
  type GetUserOutput,
  ConvertAmountOutputSchema,
  type ConvertAmountOutput,
  GetDefaultBudgetOutputSchema,
  type GetDefaultBudgetOutput,
  SetDefaultBudgetOutputSchema,
  type SetDefaultBudgetOutput,
  ClearCacheOutputSchema,
  type ClearCacheOutput,
  SetOutputFormatOutputSchema,
  type SetOutputFormatOutput,
  DiagnosticInfoOutputSchema,
  type DiagnosticInfoOutput,
  GetBudgetOutputSchema,
  type GetBudgetOutput,
} from './utilityOutputs.js';

// Nested schemas that may be useful independently
export {
  UserSchema,
  ConversionSchema,
  DateFormatSchema,
  CurrencyFormatSchema,
  BudgetDetailSchema,
  ServerInfoSchema,
  MemoryInfoSchema,
  EnvironmentInfoSchema,
  CacheInfoSchema,
  DeltaInfoSchema,
} from './utilityOutputs.js';

// ============================================================================
// BUDGET TOOL OUTPUT SCHEMAS
// ============================================================================

export {
  ListBudgetsOutputSchema,
  type ListBudgetsOutput,
  BudgetSummarySchema,
  type BudgetSummary,
} from './budgetOutputs.js';

// ============================================================================
// ACCOUNT TOOL OUTPUT SCHEMAS
// ============================================================================

export {
  ListAccountsOutputSchema,
  type ListAccountsOutput,
  GetAccountOutputSchema,
  type GetAccountOutput,
  AccountSchema,
  type Account,
} from './accountOutputs.js';

// ============================================================================
// TRANSACTION TOOL OUTPUT SCHEMAS
// ============================================================================

export {
  ListTransactionsOutputSchema,
  type ListTransactionsOutput,
  GetTransactionOutputSchema,
  type GetTransactionOutput,
  TransactionSchema,
  type Transaction,
  TransactionPreviewSchema,
  type TransactionPreview,
} from './transactionOutputs.js';

// ============================================================================
// CATEGORY TOOL OUTPUT SCHEMAS
// ============================================================================

export {
  ListCategoriesOutputSchema,
  type ListCategoriesOutput,
  GetCategoryOutputSchema,
  type GetCategoryOutput,
  CategorySchema,
  type Category,
  CategoryGroupSchema,
  type CategoryGroup,
} from './categoryOutputs.js';

// ============================================================================
// PAYEE TOOL OUTPUT SCHEMAS
// ============================================================================

export {
  ListPayeesOutputSchema,
  type ListPayeesOutput,
  GetPayeeOutputSchema,
  type GetPayeeOutput,
  PayeeSchema,
  type Payee,
} from './payeeOutputs.js';

// ============================================================================
// MONTH TOOL OUTPUT SCHEMAS
// ============================================================================

export {
  GetMonthOutputSchema,
  type GetMonthOutput,
  ListMonthsOutputSchema,
  type ListMonthsOutput,
  MonthDetailSchema,
  type MonthDetail,
  MonthSummarySchema,
  type MonthSummary,
  MonthCategorySchema,
  type MonthCategory,
} from './monthOutputs.js';

// ============================================================================
// TRANSACTION MUTATION OUTPUT SCHEMAS
// ============================================================================

export {
  CreateTransactionOutputSchema,
  type CreateTransactionOutput,
  CreateTransactionsOutputSchema,
  type CreateTransactionsOutput,
  UpdateTransactionOutputSchema,
  type UpdateTransactionOutput,
  UpdateTransactionsOutputSchema,
  type UpdateTransactionsOutput,
  DeleteTransactionOutputSchema,
  type DeleteTransactionOutput,
  CreateReceiptSplitTransactionOutputSchema,
  type CreateReceiptSplitTransactionOutput,
  CreateAccountOutputSchema,
  type CreateAccountOutput,
  UpdateCategoryOutputSchema,
  type UpdateCategoryOutput,
} from './transactionMutationOutputs.js';

// Nested schemas for transaction mutations
export {
  SubtransactionSchema,
  type Subtransaction,
  TransactionWithBalanceSchema,
  type TransactionWithBalance,
  ReceiptItemSchema,
  type ReceiptItem,
  ReceiptCategoryBreakdownSchema,
  type ReceiptCategoryBreakdown,
  ReceiptSummarySchema,
  type ReceiptSummary,
  BulkOperationSummarySchema,
  type BulkOperationSummary,
  BulkResultSchema,
  type BulkResult,
  DryRunPreviewItemSchema,
  type DryRunPreviewItem,
  DryRunWarningSchema,
  type DryRunWarning,
} from './transactionMutationOutputs.js';

// ============================================================================
// RECONCILIATION OUTPUT SCHEMAS
// ============================================================================

export {
  ReconcileAccountOutputSchema,
  type ReconcileAccountOutput,
} from './reconciliationOutputs.js';

// Nested schemas for reconciliation
export {
  MoneyValueSchema,
  type MoneyValue,
  BankTransactionSchema,
  type BankTransaction,
  YNABTransactionSimpleSchema,
  type YNABTransactionSimple,
  MatchCandidateSchema,
  type MatchCandidate,
  TransactionMatchSchema,
  type TransactionMatch,
  BalanceInfoSchema,
  type BalanceInfo,
  ReconciliationSummarySchema,
  type ReconciliationSummary,
  ReconciliationInsightSchema,
  type ReconciliationInsight,
  ActionableRecommendationSchema,
  type ActionableRecommendation,
  ExecutionResultSchema,
  type ExecutionResult,
  AuditMetadataSchema,
  type AuditMetadata,
} from './reconciliationOutputs.js';

// ============================================================================
// COMPARISON AND EXPORT OUTPUT SCHEMAS
// ============================================================================

export {
  CompareTransactionsOutputSchema,
  type CompareTransactionsOutput,
  ExportTransactionsOutputSchema,
  type ExportTransactionsOutput,
} from './comparisonOutputs.js';

// Nested schemas for comparison and export
export {
  BankTransactionComparisonSchema,
  type BankTransactionComparison,
  YNABTransactionComparisonSchema,
  type YNABTransactionComparison,
  TransactionMatchComparisonSchema,
  type TransactionMatchComparison,
  ComparisonParametersSchema,
  type ComparisonParameters,
  DateRangeSchema,
  type DateRange,
  ExportInfoSchema,
  type ExportInfo,
  ExportedTransactionSchema,
  type ExportedTransaction,
} from './comparisonOutputs.js';
