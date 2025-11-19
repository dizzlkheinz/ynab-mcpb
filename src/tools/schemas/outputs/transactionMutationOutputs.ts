/**
 * @fileoverview Transaction mutation output schemas for YNAB MCP server.
 * Defines Zod validation schemas for transaction, account, and category mutation operations
 * including single/bulk creates, updates, deletes with dry-run and balance tracking.
 *
 * @see src/tools/transactionTools.ts - Transaction mutation handlers (create, update, delete, bulk operations)
 * @see src/tools/accountTools.ts - Account creation handler (create_account)
 * @see src/tools/categoryTools.ts - Category update handler (update_category)
 *
 * @example
 * // Single transaction creation response
 * {
 *   transaction: {
 *     id: "txn-123",
 *     date: "2025-11-18",
 *     amount: -25500,
 *     account_balance: 1500000, // Raw milliunits: $1,500.00
 *     account_cleared_balance: 1000000 // Raw milliunits: $1,000.00
 *   }
 * }
 *
 * @example
 * // Bulk transaction creation response
 * {
 *   success: true,
 *   summary: {
 *     total_requested: 100,
 *     created: 95,
 *     duplicates: 3,
 *     failed: 2
 *   },
 *   results: [
 *     { request_index: 0, status: "created", transaction_id: "txn-1", correlation_key: "import-123" },
 *     { request_index: 1, status: "duplicate", correlation_key: "import-124" }
 *   ],
 *   mode: "summary"
 * }
 */

import { z } from 'zod';
import { TransactionSchema } from './transactionOutputs.js';
import { AccountSchema } from './accountOutputs.js';
import { CategorySchema } from './categoryOutputs.js';

// ============================================================================
// NESTED SCHEMAS FOR COMPOSITION
// ============================================================================

/**
 * Subtransaction schema for split transaction line items.
 * Used in create_transaction and create_receipt_split_transaction responses.
 *
 * @see src/tools/transactionTools.ts:950-1094 - create_transaction handler
 * @see src/tools/transactionTools.ts:1160-1335 - create_receipt_split_transaction handler
 */
export const SubtransactionSchema = z.object({
  id: z.string(),
  transaction_id: z.string(),
  amount: z.number(),
  memo: z.string().optional(),
  payee_id: z.string().optional(),
  payee_name: z.string().optional(),
  category_id: z.string().optional(),
  category_name: z.string().optional(),
  transfer_account_id: z.string().optional(),
  transfer_transaction_id: z.string().optional(),
  deleted: z.boolean(),
});

export type Subtransaction = z.infer<typeof SubtransactionSchema>;

/**
 * Transaction with account balance information.
 * Extends base transaction schema with balance tracking.
 *
 * @remarks
 * IMPORTANT: `account_balance` and `account_cleared_balance` are **raw YNAB milliunits** (not user-facing dollar amounts).
 * These values come directly from the YNAB API Account object and represent 1/1000th of the currency unit.
 * For example, $1,250.50 is represented as 1250500 milliunits.
 *
 * @see src/tools/transactionTools.ts:950-1094 - create_transaction handler
 * @see src/tools/transactionTools.ts:1336-1530 - update_transaction handler
 */
export const TransactionWithBalanceSchema = TransactionSchema.extend({
  account_balance: z.number().optional(), // Raw YNAB milliunits
  account_cleared_balance: z.number().optional(), // Raw YNAB milliunits
  subtransactions: z.array(SubtransactionSchema).optional(),
});

export type TransactionWithBalance = z.infer<typeof TransactionWithBalanceSchema>;

/**
 * Individual receipt line item.
 * Used in create_receipt_split_transaction for itemized receipt breakdown.
 *
 * @see src/tools/transactionTools.ts:1160-1335 - create_receipt_split_transaction handler
 */
export const ReceiptItemSchema = z.object({
  name: z.string(),
  quantity: z.number().optional(),
  amount: z.number(),
  memo: z.string().optional(),
});

export type ReceiptItem = z.infer<typeof ReceiptItemSchema>;

/**
 * Category-level receipt breakdown.
 * Groups receipt items by category with subtotals.
 *
 * @see src/tools/transactionTools.ts:1160-1335 - create_receipt_split_transaction handler
 */
export const ReceiptCategoryBreakdownSchema = z.object({
  category_id: z.string(),
  category_name: z.string().optional(),
  items: z.array(ReceiptItemSchema),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
});

export type ReceiptCategoryBreakdown = z.infer<typeof ReceiptCategoryBreakdownSchema>;

/**
 * Complete receipt breakdown summary.
 * Includes category-level breakdowns and totals.
 *
 * @see src/tools/transactionTools.ts:1160-1335 - create_receipt_split_transaction handler
 */
export const ReceiptSummarySchema = z.object({
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  categories: z.array(ReceiptCategoryBreakdownSchema),
});

export type ReceiptSummary = z.infer<typeof ReceiptSummarySchema>;

/**
 * Summary statistics for bulk operations.
 * Tracks success/duplicate/failure counts for bulk create/update operations.
 *
 * @see src/tools/transactionTools.ts:1636-1855 - create_transactions handler
 * @see src/tools/transactionTools.ts:2057-2462 - update_transactions handler
 */
export const BulkOperationSummarySchema = z.object({
  total_requested: z.number(),
  created: z.number().optional(),
  updated: z.number().optional(),
  duplicates: z.number().optional(),
  failed: z.number(),
});

export type BulkOperationSummary = z.infer<typeof BulkOperationSummarySchema>;

/**
 * Individual result in bulk operation.
 * Tracks status and correlation for each transaction in bulk create/update.
 *
 * @remarks
 * This schema uses `.passthrough()` to allow forward-compatible extension with additional
 * correlation metadata fields (e.g., `import_id`, `hash`, `batch_id`, `execution_id`)
 * that may be added in future versions without breaking existing validation.
 *
 * Core fields guaranteed to be present:
 * - request_index: Position in the original request array
 * - status: Operation outcome (created/duplicate/updated/failed)
 * - transaction_id: YNAB transaction ID (if operation succeeded)
 * - correlation_key: Key used to correlate request with response (import_id or hash)
 * - error_code: Machine-readable error code (if operation failed)
 * - error: Human-readable error message (if operation failed)
 *
 * @see src/tools/transactionTools.ts:1636-1855 - create_transactions handler
 * @see src/tools/transactionTools.ts:2057-2462 - update_transactions handler
 */
export const BulkResultSchema = z.object({
  request_index: z.number(),
  status: z.enum(['created', 'duplicate', 'updated', 'failed']),
  transaction_id: z.string().optional(),
  correlation_key: z.string(),
  error_code: z.string().optional(),
  error: z.string().optional(),
}).passthrough(); // Allow additional correlation metadata fields

export type BulkResult = z.infer<typeof BulkResultSchema>;

/**
 * Transaction diff fields for bulk update dry-run before/after comparison.
 * Contains only the fields that changed between current and updated state.
 *
 * @see src/tools/transactionTools.ts:2139-2192 - update_transactions dry-run diff building
 */
export const TransactionDiffFieldsSchema = z.object({
  amount: z.number().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  memo: z.string().optional(),
  payee_id: z.string().nullable().optional(),
  payee_name: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
  cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
  approved: z.boolean().optional(),
  flag_color: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple']).nullable().optional(),
});

export type TransactionDiffFields = z.infer<typeof TransactionDiffFieldsSchema>;

/**
 * Before/after preview for bulk update dry-run.
 * Shows changed fields for each transaction in dry-run mode.
 *
 * @see src/tools/transactionTools.ts:2057-2462 - update_transactions handler
 */
export const DryRunPreviewItemSchema = z.object({
  transaction_id: z.string(),
  before: z.union([
    z.literal('unavailable'),
    TransactionDiffFieldsSchema,
  ]),
  after: TransactionDiffFieldsSchema,
});

export type DryRunPreviewItem = z.infer<typeof DryRunPreviewItemSchema>;

/**
 * Warning in dry-run responses.
 * Alerts about potential issues before execution.
 *
 * @see src/tools/transactionTools.ts:2057-2462 - update_transactions handler
 */
export const DryRunWarningSchema = z.object({
  code: z.string(),
  count: z.number(),
  message: z.string(),
  sample_ids: z.array(z.string()).optional(),
});

export type DryRunWarning = z.infer<typeof DryRunWarningSchema>;

// ============================================================================
// MAIN OUTPUT SCHEMAS
// ============================================================================

/**
 * Single transaction creation output.
 * Returns created transaction with account balance information.
 *
 * @see src/tools/transactionTools.ts:950-1094 - create_transaction handler
 *
 * @example
 * // Normal execution
 * {
 *   transaction: {
 *     id: "txn-123",
 *     date: "2025-11-18",
 *     amount: -25500,
 *     account_balance: 1500000, // Raw milliunits: $1,500.00
 *     account_cleared_balance: 1000000 // Raw milliunits: $1,000.00
 *   }
 * }
 *
 * @example
 * // Dry-run mode
 * {
 *   dry_run: true,
 *   action: "create_transaction",
 *   request: { date: "2025-11-18", amount: -25.50, account_id: "acct-1" }
 * }
 */
export const CreateTransactionOutputSchema = z.union([
  z.object({
    dry_run: z.literal(true),
    action: z.literal('create_transaction'),
    request: z.record(z.string(), z.unknown()),
  }),
  z.object({
    transaction: TransactionWithBalanceSchema,
  }),
]);

export type CreateTransactionOutput = z.infer<typeof CreateTransactionOutputSchema>;

/**
 * Transaction preview item for bulk create dry-run.
 * Shows planned transaction details before execution.
 *
 * @see src/tools/transactionTools.ts:1742-1752 - create_transactions dry-run preview
 */
export const CreateTransactionPreviewSchema = z.object({
  request_index: z.number(),
  account_id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number(),
  memo: z.string().optional(),
  payee_id: z.string().optional(),
  payee_name: z.string().optional(),
  category_id: z.string().optional(),
  import_id: z.string().optional(),
});

export type CreateTransactionPreview = z.infer<typeof CreateTransactionPreviewSchema>;

/**
 * Bulk transaction creation output.
 * Returns summary, correlation results, and optional full transaction data.
 * Response mode (full/summary/ids_only) adapts to result size for MCP 100KB limit.
 *
 * @see src/tools/transactionTools.ts:1636-1855 - create_transactions handler
 *
 * @example
 * // Dry-run mode
 * {
 *   dry_run: true,
 *   action: "create_transactions",
 *   validation: "passed",
 *   summary: {
 *     total_transactions: 100,
 *     total_amount: 1500.00,
 *     accounts_affected: ["acct-1", "acct-2"],
 *     date_range: { earliest: "2025-01-01", latest: "2025-01-31" },
 *     categories_affected: ["cat-1", "cat-2"]
 *   },
 *   transactions_preview: [
 *     { request_index: 0, account_id: "acct-1", date: "2025-01-15", amount: 25.50, ... }
 *   ],
 *   note: "This is a dry run. No transactions were created."
 * }
 *
 * @example
 * // Execution mode (summary)
 * {
 *   success: true,
 *   summary: { total_requested: 100, created: 95, duplicates: 3, failed: 2 },
 *   results: [
 *     { request_index: 0, status: "created", transaction_id: "txn-1", correlation_key: "import-123" },
 *     { request_index: 1, status: "duplicate", correlation_key: "import-124" }
 *   ],
 *   mode: "summary"
 * }
 */
export const CreateTransactionsOutputSchema = z.union([
  // Dry-run mode: Strict schema for preview validation
  z.object({
    dry_run: z.literal(true),
    action: z.literal('create_transactions'),
    validation: z.literal('passed'),
    summary: z.object({
      total_transactions: z.number(),
      total_amount: z.number(),
      accounts_affected: z.array(z.string()),
      date_range: z.object({
        earliest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        latest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }).optional(),
      categories_affected: z.array(z.string()),
    }),
    transactions_preview: z.array(CreateTransactionPreviewSchema),
    note: z.string(),
  }).strict(), // Strict for dry-run to prevent malformed previews
  // Execution mode: Allow passthrough for correlation metadata extension
  z.object({
    success: z.boolean(),
    server_knowledge: z.number().optional(),
    summary: BulkOperationSummarySchema,
    results: z.array(BulkResultSchema),
    transactions: z.array(TransactionSchema).optional(),
    duplicate_import_ids: z.array(z.string()).optional(),
    message: z.string().optional(),
    mode: z.enum(['full', 'summary', 'ids_only']).optional(),
  }).passthrough(), // Allow top-level metadata like batch_id, execution_id
]);

export type CreateTransactionsOutput = z.infer<typeof CreateTransactionsOutputSchema>;

/**
 * Single transaction update output.
 * Returns updated transaction with new account balances.
 *
 * @see src/tools/transactionTools.ts:1336-1530 - update_transaction handler
 *
 * @example
 * // Normal execution
 * {
 *   transaction: { id: "txn-123", amount: -30000, ... },
 *   updated_balance: 1450000, // Raw milliunits: $1,450.00
 *   updated_cleared_balance: 950000 // Raw milliunits: $950.00
 * }
 *
 * @example
 * // Dry-run mode
 * {
 *   dry_run: true,
 *   action: "update_transaction",
 *   request: { transaction_id: "txn-123", amount: -30.00 }
 * }
 */
export const UpdateTransactionOutputSchema = z.union([
  z.object({
    dry_run: z.literal(true),
    action: z.literal('update_transaction'),
    request: z.record(z.string(), z.unknown()),
  }),
  z.object({
    transaction: TransactionWithBalanceSchema,
    updated_balance: z.number(), // Raw YNAB milliunits
    updated_cleared_balance: z.number(), // Raw YNAB milliunits
  }),
]);

export type UpdateTransactionOutput = z.infer<typeof UpdateTransactionOutputSchema>;

/**
 * Bulk transaction update output.
 * Returns summary, correlation results, and optional preview/full data.
 * Dry-run mode shows before/after preview for changed fields.
 *
 * @see src/tools/transactionTools.ts:2057-2462 - update_transactions handler
 *
 * @example
 * // Dry-run mode
 * {
 *   dry_run: true,
 *   action: "update_transactions",
 *   validation: "passed",
 *   summary: {
 *     total_transactions: 50,
 *     accounts_affected: 3,
 *     fields_to_update: ["cleared", "category_id"]
 *   },
 *   transactions_preview: [
 *     {
 *       transaction_id: "txn-1",
 *       before: { cleared: "uncleared", category_id: "cat-1" },
 *       after: { cleared: "cleared", category_id: "cat-2" }
 *     }
 *   ],
 *   warnings: [
 *     { code: "LARGE_BATCH", count: 50, message: "Large batch detected" }
 *   ],
 *   note: "This is a dry run. No transactions were updated."
 * }
 *
 * @example
 * // Execution mode (summary)
 * {
 *   success: true,
 *   summary: { total_requested: 50, updated: 48, failed: 2 },
 *   results: [
 *     { request_index: 0, status: "updated", transaction_id: "txn-1", correlation_key: "hash-abc123" }
 *   ],
 *   mode: "summary"
 * }
 */
export const UpdateTransactionsOutputSchema = z.union([
  // Dry-run mode: Strict schema for preview validation
  z.object({
    dry_run: z.literal(true),
    action: z.literal('update_transactions'),
    validation: z.literal('passed'),
    summary: z.object({
      total_transactions: z.number(),
      accounts_affected: z.number(),
      fields_to_update: z.array(z.string()),
    }),
    transactions_preview: z.array(DryRunPreviewItemSchema),
    warnings: z.array(DryRunWarningSchema).optional(),
    note: z.string(),
  }).strict(), // Strict for dry-run to prevent malformed previews
  // Execution mode: Allow passthrough for correlation metadata extension
  z.object({
    success: z.boolean(),
    server_knowledge: z.number().optional(),
    summary: BulkOperationSummarySchema,
    results: z.array(BulkResultSchema),
    transactions: z.array(TransactionSchema).optional(),
    message: z.string().optional(),
    mode: z.enum(['full', 'summary', 'ids_only']).optional(),
  }).passthrough(), // Allow top-level metadata like batch_id, execution_id
]);

export type UpdateTransactionsOutput = z.infer<typeof UpdateTransactionsOutputSchema>;

/**
 * Transaction deletion output.
 * Returns deletion confirmation with updated account balances.
 *
 * @see src/tools/transactionTools.ts:1536-1634 - delete_transaction handler
 *
 * @example
 * // Normal execution
 * {
 *   message: "Transaction deleted successfully",
 *   transaction: { id: "txn-123", deleted: true },
 *   updated_balance: 175500,
 *   updated_cleared_balance: 125500
 * }
 *
 * @example
 * // Dry-run mode
 * {
 *   dry_run: true,
 *   action: "delete_transaction",
 *   request: { transaction_id: "txn-123" }
 * }
 */
export const DeleteTransactionOutputSchema = z.union([
  z.object({
    dry_run: z.literal(true),
    action: z.literal('delete_transaction'),
    request: z.record(z.string(), z.unknown()),
  }),
  z.object({
    message: z.string(),
    transaction: z.object({
      id: z.string(),
      deleted: z.boolean(),
    }),
    updated_balance: z.number(), // Raw YNAB milliunits
    updated_cleared_balance: z.number(), // Raw YNAB milliunits
  }),
]);

export type DeleteTransactionOutput = z.infer<typeof DeleteTransactionOutputSchema>;

/**
 * Transaction preview schema for dry-run responses.
 * Contains essential transaction fields before the transaction is created.
 * Excludes server-generated fields like 'id' and balance information.
 *
 * @remarks
 * This schema is used in dry-run mode to preview what a transaction will look like
 * before it's actually created. It includes the fields that will be sent to the API
 * but excludes fields that are generated by the server (id, balances, timestamps, etc.).
 *
 * Note: This is distinct from TransactionPreviewSchema in transactionOutputs.ts, which is
 * used for large result set previews in list_transactions responses.
 *
 * @see CreateReceiptSplitTransactionOutputSchema - Used in dry-run branch for transaction preview
 */
export const TransactionDryRunPreviewSchema = z.object({
  account_id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number(),
  memo: z.string().optional().nullable(),
  cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
  approved: z.boolean().optional(),
  flag_color: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple']).optional().nullable(),
  payee_id: z.string().optional().nullable(),
  payee_name: z.string().optional().nullable(),
  category_id: z.string().optional().nullable(),
  import_id: z.string().optional().nullable(),
});

export type TransactionDryRunPreview = z.infer<typeof TransactionDryRunPreviewSchema>;

/**
 * Subtransaction preview schema for dry-run responses.
 * Contains subtransaction fields before they are created by the server.
 * Excludes server-generated fields like 'id', 'transaction_id', and 'deleted'.
 *
 * @remarks
 * This schema is derived from SubtransactionSchema but omits fields that are
 * generated by the server when the subtransaction is created.
 *
 * @see SubtransactionSchema - Full subtransaction schema with server-generated fields
 * @see CreateReceiptSplitTransactionOutputSchema - Used in dry-run branch for subtransactions preview
 */
export const SubtransactionPreviewSchema = SubtransactionSchema.omit({
  id: true,
  transaction_id: true,
  deleted: true,
});

export type SubtransactionPreview = z.infer<typeof SubtransactionPreviewSchema>;

/**
 * Receipt split transaction creation output.
 * Returns created split transaction with itemized receipt breakdown.
 *
 * @see src/tools/transactionTools.ts:1160-1335 - create_receipt_split_transaction handler
 *
 * @example
 * // Normal execution
 * {
 *   transaction: {
 *     id: "txn-456",
 *     subtransactions: [
 *       { id: "sub-1", category_id: "cat-groceries", amount: -50000 },
 *       { id: "sub-2", category_id: "cat-tax", amount: -3500 }
 *     ]
 *   },
 *   receipt_summary: {
 *     subtotal: 50.00,
 *     tax: 3.50,
 *     total: 53.50,
 *     categories: [
 *       { category_id: "cat-groceries", items: [...], subtotal: 50.00, tax: 3.50, total: 53.50 }
 *     ]
 *   }
 * }
 *
 * @example
 * // Dry-run mode
 * {
 *   dry_run: true,
 *   action: "create_receipt_split_transaction",
 *   transaction_preview: {
 *     account_id: "acct-1",
 *     date: "2025-11-18",
 *     amount: -53500,
 *     cleared: "cleared",
 *     approved: true
 *   },
 *   receipt_summary: { subtotal: 50.00, tax: 3.50, total: 53.50, categories: [...] },
 *   subtransactions: [
 *     { amount: -50000, category_id: "cat-groceries", memo: "Groceries" },
 *     { amount: -3500, category_id: "cat-tax", memo: "Tax" }
 *   ]
 * }
 */
export const CreateReceiptSplitTransactionOutputSchema = z.union([
  z.object({
    dry_run: z.literal(true),
    action: z.literal('create_receipt_split_transaction'),
    transaction_preview: TransactionDryRunPreviewSchema,
    receipt_summary: ReceiptSummarySchema,
    subtransactions: z.array(SubtransactionPreviewSchema),
  }),
  z.object({
    transaction: TransactionWithBalanceSchema,
    receipt_summary: ReceiptSummarySchema,
  }),
]);

export type CreateReceiptSplitTransactionOutput = z.infer<typeof CreateReceiptSplitTransactionOutputSchema>;

/**
 * Create account dry-run request schema.
 * Documents the planned account creation operation before execution.
 *
 * @see src/tools/accountTools.ts:218-233 - create_account dry-run response construction
 */
export const CreateAccountDryRunRequestSchema = z.object({
  budget_id: z.string(),
  name: z.string(),
  type: z.string(),
  balance: z.number(),
});

export type CreateAccountDryRunRequest = z.infer<typeof CreateAccountDryRunRequestSchema>;

/**
 * Account creation output.
 * Returns created account entity.
 *
 * @see src/tools/accountTools.ts:196-283 - create_account handler
 *
 * @example
 * // Normal execution
 * {
 *   account: {
 *     id: "acct-789",
 *     name: "Savings Account",
 *     type: "savings",
 *     balance: 0,
 *     cleared_balance: 0
 *   }
 * }
 *
 * @example
 * // Dry-run mode
 * {
 *   dry_run: true,
 *   action: "create_account",
 *   request: { budget_id: "budget-1", name: "Savings Account", type: "savings", balance: 0 }
 * }
 */
export const CreateAccountOutputSchema = z.union([
  z.object({
    dry_run: z.literal(true),
    action: z.literal('create_account'),
    request: CreateAccountDryRunRequestSchema,
  }),
  z.object({
    account: AccountSchema,
  }),
]);

export type CreateAccountOutput = z.infer<typeof CreateAccountOutputSchema>;

/**
 * Update category dry-run request schema.
 * Documents the planned category update operation before execution.
 *
 * @see src/tools/categoryTools.ts:237-256 - update_category dry-run response construction
 */
export const UpdateCategoryDryRunRequestSchema = z.object({
  budget_id: z.string(),
  category_id: z.string(),
  budgeted: z.number(),
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type UpdateCategoryDryRunRequest = z.infer<typeof UpdateCategoryDryRunRequestSchema>;

/**
 * Category budget update output.
 * Returns updated category with month context.
 *
 * @see src/tools/categoryTools.ts:194-309 - update_category handler
 *
 * @example
 * // Normal execution
 * {
 *   category: {
 *     id: "cat-123",
 *     name: "Groceries",
 *     budgeted: 50000,
 *     activity: -35000,
 *     balance: 15000
 *   },
 *   updated_month: "2025-11-01"
 * }
 *
 * @example
 * // Dry-run mode
 * {
 *   dry_run: true,
 *   action: "update_category",
 *   request: { budget_id: "budget-1", category_id: "cat-123", month: "2025-11-01", budgeted: 500.00 }
 * }
 */
export const UpdateCategoryOutputSchema = z.union([
  z.object({
    dry_run: z.literal(true),
    action: z.literal('update_category'),
    request: UpdateCategoryDryRunRequestSchema,
  }),
  z.object({
    category: CategorySchema,
    updated_month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);

export type UpdateCategoryOutput = z.infer<typeof UpdateCategoryOutputSchema>;
