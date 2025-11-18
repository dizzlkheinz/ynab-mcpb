/**
 * @fileoverview Transaction comparison and export output schemas for YNAB MCP server.
 * Defines Zod validation schemas for comparing bank CSV transactions with YNAB transactions
 * and exporting transactions to JSON files with metadata.
 *
 * @see src/tools/compareTransactions/index.ts - Main comparison handler (lines 63-228)
 * @see src/tools/compareTransactions/types.ts - Type definitions for comparison entities
 * @see src/tools/compareTransactions/formatter.ts - Result formatting logic
 * @see src/tools/exportTransactions.ts - Transaction export handler (lines 147-274)
 *
 * @example
 * // Transaction comparison result
 * {
 *   summary: {
 *     total_bank_transactions: 50,
 *     total_ynab_transactions: 52,
 *     matched_count: 45,
 *     unmatched_bank_count: 5,
 *     unmatched_ynab_count: 7,
 *     match_rate_percentage: 90.0
 *   },
 *   matches: [
 *     {
 *       bank_transaction: { date: "2025-10-15", amount: -25500, description: "Grocery Store" },
 *       ynab_transaction: { id: "txn-1", date: "2025-10-15", amount: -25500, payee_name: "Grocery Store" },
 *       match_score: 95,
 *       match_reasons: ["exact_amount_match", "exact_date_match", "payee_similarity"]
 *     }
 *   ],
 *   unmatched_bank: [...],
 *   parameters: { amount_tolerance: 0, date_tolerance_days: 2 }
 * }
 *
 * @example
 * // Transaction export result
 * {
 *   message: "Successfully exported 150 transactions",
 *   filename: "ynab_transactions_2025-11-18.json",
 *   full_path: "/Users/username/Downloads/ynab_transactions_2025-11-18.json",
 *   export_mode: "full",
 *   preview_count: 5,
 *   total_count: 150,
 *   preview_transactions: [...]
 * }
 */

import { z } from 'zod';

// ============================================================================
// DATE VALIDATION HELPERS
// ============================================================================

/**
 * Validates that a string is both correctly formatted as YYYY-MM-DD and represents
 * a valid calendar date. Rejects invalid dates like "2024-02-31" or "2024-13-01".
 *
 * @param dateStr - ISO date string to validate
 * @returns true if the date is valid, false otherwise
 *
 * @remarks
 * This validation checks:
 * 1. Format: YYYY-MM-DD (via regex)
 * 2. Parseability: Date.parse() succeeds
 * 3. Calendar validity: Parsed components match original string
 * 4. Not NaN: The parsed date is a valid number
 *
 * @example
 * isValidISODate("2024-02-29") // true (leap year)
 * isValidISODate("2024-02-30") // false (February has max 29 days)
 * isValidISODate("2024-13-01") // false (invalid month)
 * isValidISODate("2024-02-31") // false (February doesn't have 31 days)
 */
function isValidISODate(dateStr: string): boolean {
  // First check format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }

  // Parse and validate
  const parsed = Date.parse(dateStr);
  if (isNaN(parsed)) {
    return false;
  }

  // Verify that the parsed date components match the original string
  // This catches cases like "2024-02-31" which Date.parse might coerce to "2024-03-03"
  const date = new Date(parsed);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const reconstructed = `${year}-${month}-${day}`;

  return reconstructed === dateStr;
}
/**
 * Reusable Zod schema for validating ISO date strings (YYYY-MM-DD).
 * Validates both format and calendar validity.
 *
 * @example
 * const schema = z.object({ date: ISODateStringSchema });
 * schema.parse({ date: "2024-02-29" }); // OK (leap year)
 * schema.parse({ date: "2024-02-31" }); // Error: Invalid calendar date
 */
export const ISODateStringSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(isValidISODate, {
    message: 'Invalid calendar date (e.g., month must be 01-12, day must be valid for the month)',
  });

// ============================================================================
// NESTED SCHEMAS FOR COMPOSITION
// ============================================================================

/**
 * Bank transaction for comparison analysis.
 * Represents a parsed transaction from CSV file.
 *
 * @see src/tools/compareTransactions/types.ts - BankTransaction interface
 */
export const BankTransactionComparisonSchema = z.object({
  date: ISODateStringSchema,
  amount: z.number(),
  description: z.string(),
  raw_amount: z.string(),
  raw_date: z.string(),
  row_number: z.number(),
});

export type BankTransactionComparison = z.infer<typeof BankTransactionComparisonSchema>;

/**
 * YNAB transaction for comparison analysis.
 * Contains essential fields for matching against bank transactions.
 *
 * @see src/tools/compareTransactions/types.ts - YNABTransaction interface
 */
export const YNABTransactionComparisonSchema = z.object({
  id: z.string(),
  date: ISODateStringSchema,
  amount: z.number(),
  payee_name: z.string().nullable(),
  memo: z.string().nullable(),
  cleared: z.string(),
  account_name: z.string().optional(),
  category_name: z.string().optional(),
});

export type YNABTransactionComparison = z.infer<typeof YNABTransactionComparisonSchema>;

/**
 * Matched transaction pair with scoring.
 * Links a bank transaction to a YNAB transaction with confidence metrics.
 *
 * @see src/tools/compareTransactions/types.ts - TransactionMatch interface
 */
export const TransactionMatchComparisonSchema = z.object({
  bank_transaction: BankTransactionComparisonSchema,
  ynab_transaction: YNABTransactionComparisonSchema,
  match_score: z.number().min(0).max(100),
  match_reasons: z.array(z.string()),
});

export type TransactionMatchComparison = z.infer<typeof TransactionMatchComparisonSchema>;

/**
 * Comparison configuration parameters.
 * Documents tolerance settings used for matching.
 */
export const ComparisonParametersSchema = z.object({
  amount_tolerance: z.number().optional(),
  date_tolerance_days: z.number().optional(),
});

export type ComparisonParameters = z.infer<typeof ComparisonParametersSchema>;

/**
 * Date range for comparison analysis.
 * Specifies the period covered by compared transactions.
 *
 * @remarks
 * Validates that:
 * 1. Both start and end are valid ISO dates (YYYY-MM-DD)
 * 2. Start date is before or equal to end date
 *
 * @example
 * DateRangeSchema.parse({ start: "2024-01-01", end: "2024-12-31" }) // OK
 * DateRangeSchema.parse({ start: "2024-12-31", end: "2024-01-01" }) // Error: start date must be before or equal to end date
 */
export const DateRangeSchema = z.object({
  start: ISODateStringSchema,
  end: ISODateStringSchema,
}).refine(
  (data) => {
    // Parse both dates - we know they're valid ISO dates due to ISODateStringSchema
    const startDate = Date.parse(data.start);
    const endDate = Date.parse(data.end);

    // Validate logical ordering: start must be <= end
    return startDate <= endDate;
  },
  {
    message: 'Start date must be before or equal to end date',
  }
);

export type DateRange = z.infer<typeof DateRangeSchema>;

/**
 * Export metadata and configuration.
 * Documents export settings and timestamp.
 *
 * @see src/tools/exportTransactions.ts:184-197 - Export info construction
 */
export const ExportInfoSchema = z.object({
  exported_at: z.string(),
  total_transactions: z.number(),
  minimal: z.boolean(),
  filters: z.object({
    budget_id: z.string().optional(),
    account_id: z.string().optional(),
    category_id: z.string().optional(),
    since_date: z.string().optional(),
    type: z.string().optional(),
    minimal: z.boolean().optional(),
  }),
});

export type ExportInfo = z.infer<typeof ExportInfoSchema>;

/**
 * Exported transaction schema (minimal or full).
 * Discriminated union based on export mode.
 *
 * @see src/tools/exportTransactions.ts:198-232 - Transaction export logic
 */
export const ExportedTransactionSchema = z.union([
  // Minimal mode (id, date, amount, payee_name, cleared only)
  z.object({
    export_mode: z.literal('minimal'),
    id: z.string(),
    date: z.string(),
    amount: z.number(),
    payee_name: z.string().nullable(),
    cleared: z.string(),
  }),
  // Full mode (all transaction fields)
  z.object({
    export_mode: z.literal('full'),
    id: z.string(),
    date: z.string(),
    amount: z.number(),
    payee_name: z.string().nullable(),
    cleared: z.string(),
    memo: z.string().nullable().optional(),
    approved: z.boolean().optional(),
    flag_color: z.string().nullable().optional(),
    account_id: z.string().optional(),
    payee_id: z.string().nullable().optional(),
    category_id: z.string().nullable().optional(),
    transfer_account_id: z.string().nullable().optional(),
    transfer_transaction_id: z.string().nullable().optional(),
    matched_transaction_id: z.string().nullable().optional(),
    import_id: z.string().nullable().optional(),
    deleted: z.boolean().optional(),
    account_name: z.string().optional(),
    category_name: z.string().nullable().optional(),
  }),
]);

export type ExportedTransaction = z.infer<typeof ExportedTransactionSchema>;
// ============================================================================
// MAIN OUTPUT SCHEMAS
// ============================================================================

/**
 * Transaction comparison analysis result.
 * Returns matched pairs, unmatched transactions, and summary statistics.
 *
 * @see src/tools/compareTransactions/formatter.ts - buildComparisonResult function
 * @see src/tools/compareTransactions/index.ts:216-223 - Handler response
 *
 * @example
 * {
 *   summary: {
 *     total_bank_transactions: 50,
 *     total_ynab_transactions: 52,
 *     matched_count: 45,
 *     unmatched_bank_count: 5,
 *     unmatched_ynab_count: 7,
 *     match_rate_percentage: 90.0
 *   },
 *   matches: [
 *     {
 *       bank_transaction: { date: "2025-10-15", amount: -25500, description: "Grocery Store", row_number: 5 },
 *       ynab_transaction: { id: "txn-1", date: "2025-10-15", amount: -25500, payee_name: "Grocery Store" },
 *       match_score: 95,
 *       match_reasons: ["exact_amount_match", "exact_date_match", "payee_similarity"]
 *     }
 *   ],
 *   unmatched_bank: [
 *     { date: "2025-10-20", amount: -15000, description: "Unknown Store", row_number: 12 }
 *   ],
 *   unmatched_ynab: [
 *     { id: "txn-99", date: "2025-10-22", amount: -20000, payee_name: "Coffee Shop" }
 *   ],
 *   parameters: { amount_tolerance: 0, date_tolerance_days: 2 },
 *   date_range: { start: "2025-10-01", end: "2025-10-31" },
 *   analysis: "High match rate (90%). Review 5 unmatched bank transactions for potential duplicates..."
 * }
 */
export const CompareTransactionsOutputSchema = z.object({
  summary: z.object({
    total_bank_transactions: z.number(),
    total_ynab_transactions: z.number(),
    matched_count: z.number(),
    unmatched_bank_count: z.number(),
    unmatched_ynab_count: z.number(),
    match_rate_percentage: z.number(),
  }),
  matches: z.array(TransactionMatchComparisonSchema),
  unmatched_bank: z.array(BankTransactionComparisonSchema),
  unmatched_ynab: z.array(YNABTransactionComparisonSchema),
  parameters: ComparisonParametersSchema,
  date_range: DateRangeSchema,
  analysis: z.string().optional(),
});

export type CompareTransactionsOutput = z.infer<typeof CompareTransactionsOutputSchema>;

/**
 * Transaction export result with file metadata.
 * Returns export location, mode, and preview of exported data.
 *
 * @see src/tools/exportTransactions.ts:242-269 - Handler response
 *
 * @example
 * // Minimal export mode
 * {
 *   message: "Successfully exported 150 transactions to JSON file",
 *   filename: "ynab_transactions_minimal_2025-11-18.json",
 *   full_path: "/Users/username/Downloads/ynab_transactions_minimal_2025-11-18.json",
 *   export_directory: "/Users/username/Downloads",
 *   export_mode: "minimal",
 *   minimal_fields: "id, date, amount, payee_name, cleared",
 *   filename_explanation: "Filename includes '_minimal' suffix and timestamp",
 *   preview_count: 5,
 *   total_count: 150,
 *   preview_transactions: [
 *     { id: "txn-1", date: "2025-11-15", amount: -25500, memo: "Groceries", payee_name: "Grocery Store", category_name: "Food" }
 *   ]
 * }
 *
 * @example
 * // Full export mode
 * {
 *   message: "Successfully exported 150 transactions to JSON file",
 *   filename: "ynab_transactions_2025-11-18.json",
 *   full_path: "/Users/username/Downloads/ynab_transactions_2025-11-18.json",
 *   export_directory: "/Users/username/Downloads",
 *   export_mode: "full",
 *   minimal_fields: null,
 *   filename_explanation: "Filename includes timestamp for easy identification",
 *   preview_count: 5,
 *   total_count: 150,
 *   preview_transactions: [...]
 * }
 */
export const ExportTransactionsOutputSchema = z.object({
  message: z.string(),
  filename: z.string(),
  full_path: z.string(),
  export_directory: z.string(),
  export_mode: z.enum(['minimal', 'full']),
  minimal_fields: z.string().nullable(),
  filename_explanation: z.string(),
  preview_count: z.number(),
  total_count: z.number(),
  preview_transactions: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      amount: z.number(),
      memo: z.string().nullable().optional(),
      payee_name: z.string().nullable().optional(),
      category_name: z.string().nullable().optional(),
    })
  ),
});

export type ExportTransactionsOutput = z.infer<typeof ExportTransactionsOutputSchema>;
