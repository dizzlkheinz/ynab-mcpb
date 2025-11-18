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
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');  const reconstructed = `${year}-${month}-${day}`;

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
 * Bank transaction for comparison analysis (formatted output).
 * Represents missing transactions in YNAB with payee suggestions.
 *
 * @remarks
 * The formatter uses `.toFixed(2)` to format amounts as decimal strings with exactly 2 decimal places.
 * Dates are formatted as ISO strings (YYYY-MM-DD) via `.toISOString().split('T')[0]`.
 *
 * @see src/tools/compareTransactions/formatter.ts:92-102 - formatUnmatchedBank function
 */
export const MissingInYNABItemSchema = z.object({
  date: ISODateStringSchema,
  amount: z.string().regex(/^-?\d+\.\d{2}$/, 'Amount must be a decimal string with exactly 2 decimal places'),
  description: z.string(),
  row_number: z.number(),
  suggested_payee_id: z.string().optional(),
  suggested_payee_name: z.string().optional(),
  suggestion_reason: z.string().optional(),
});

export type MissingInYNABItem = z.infer<typeof MissingInYNABItemSchema>;

/**
 * YNAB transaction missing from bank CSV (formatted output).
 * Represents transactions that exist in YNAB but not in the bank file.
 *
 * @remarks
 * The formatter uses `.toFixed(2)` to format amounts as decimal strings with exactly 2 decimal places.
 * Dates are formatted as ISO strings (YYYY-MM-DD) via `.toISOString().split('T')[0]`.
 *
 * @see src/tools/compareTransactions/formatter.ts:108-116 - formatUnmatchedYNAB function
 */
export const MissingInBankItemSchema = z.object({
  id: z.string(),
  date: ISODateStringSchema,
  amount: z.string().regex(/^-?\d+\.\d{2}$/, 'Amount must be a decimal string with exactly 2 decimal places'),
  payee_name: z.string().nullable(),
  memo: z.string().nullable(),
  cleared: z.string(),
});

export type MissingInBankItem = z.infer<typeof MissingInBankItemSchema>;

/**
 * Matched transaction pair (formatted output).
 * Links a bank transaction to a YNAB transaction with confidence metrics.
 *
 * @remarks
 * The formatter uses `.toFixed(2)` to format amounts as decimal strings with exactly 2 decimal places.
 * Dates are formatted as ISO strings (YYYY-MM-DD) via `.toISOString().split('T')[0]`.
 *
 * @see src/tools/compareTransactions/formatter.ts:72-86 - formatMatches function
 */
export const MatchItemSchema = z.object({
  bank_date: ISODateStringSchema,
  bank_amount: z.string().regex(/^-?\d+\.\d{2}$/, 'Amount must be a decimal string with exactly 2 decimal places'),
  bank_description: z.string(),
  ynab_date: ISODateStringSchema,
  ynab_amount: z.string().regex(/^-?\d+\.\d{2}$/, 'Amount must be a decimal string with exactly 2 decimal places'),
  ynab_payee: z.string().nullable(),
  ynab_transaction: z.object({
    id: z.string(),
    cleared: z.string(),
  }),
  match_score: z.number(),
  match_reasons: z.array(z.string()),
});

export type MatchItem = z.infer<typeof MatchItemSchema>;

// ============================================================================
// INTERNAL SCHEMAS (for reference, not used in main output validation)
// ============================================================================

/**
 * Bank transaction (internal type, used during matching).
 * Not part of the formatted output; see MissingInYNABItemSchema for output format.
 *
 * @see src/tools/compareTransactions/types.ts - BankTransaction interface
 * @internal
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
 * YNAB transaction (internal type, used during matching).
 * Not part of the formatted output; see MissingInBankItemSchema for output format.
 *
 * @see src/tools/compareTransactions/types.ts - YNABTransaction interface
 * @internal
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
 * Matched transaction pair (internal type, used during matching).
 * Not part of the formatted output; see MatchItemSchema for output format.
 *
 * @see src/tools/compareTransactions/types.ts - TransactionMatch interface
 * @internal
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
 * Export metadata and configuration (written to disk).
 * Documents export settings and timestamp.
 *
 * @remarks
 * This schema represents the export_info object written to the JSON file.
 * Note: The tool response does NOT include this object - see ExportTransactionsOutputSchema for the tool response format.
 *
 * @see src/tools/exportTransactions.ts:184-197 - Export info construction
 */
export const ExportInfoSchema = z.object({
  exported_at: z.string(),
  total_transactions: z.number(),
  minimal: z.boolean(),
  filters: z.object({
    budget_id: z.string().optional(),
    account_id: z.string().nullable(),
    category_id: z.string().nullable(),
    since_date: z.string().nullable(),
    type: z.string().nullable(),
    minimal: z.boolean(),
  }),
});

export type ExportInfo = z.infer<typeof ExportInfoSchema>;

/**
 * Exported transaction schema (written to disk, no export_mode discriminator).
 * The actual JSON file does not include an export_mode field on each transaction.
 *
 * @remarks
 * Minimal mode includes: id, date, amount, payee_name, cleared
 * Full mode includes: all transaction fields
 *
 * @see src/tools/exportTransactions.ts:198-232 - Transaction export logic
 */
export const ExportedTransactionMinimalSchema = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number(),
  payee_name: z.string().nullable(),
  cleared: z.string(),
});

export const ExportedTransactionFullSchema = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number(),
  memo: z.string().nullable(),
  cleared: z.string(),
  approved: z.boolean(),
  flag_color: z.string().nullable(),
  account_id: z.string(),
  payee_id: z.string().nullable(),
  category_id: z.string().nullable(),
  transfer_account_id: z.string().nullable(),
  transfer_transaction_id: z.string().nullable(),
  matched_transaction_id: z.string().nullable(),
  import_id: z.string().nullable(),
  deleted: z.boolean(),
  account_name: z.string().optional(),
  payee_name: z.string().nullable(),
  category_name: z.string().nullable(),
});

export const ExportedTransactionSchema = z.union([
  ExportedTransactionMinimalSchema,
  ExportedTransactionFullSchema,
]);

export type ExportedTransaction = z.infer<typeof ExportedTransactionSchema>;

/**
 * Complete exported file structure (written to disk).
 * Represents the full JSON file structure created by export_transactions tool.
 *
 * @remarks
 * This is the structure of the file written to disk, NOT the tool response.
 * For the tool response format, see ExportTransactionsOutputSchema.
 *
 * @see src/tools/exportTransactions.ts:184-233 - Export data construction and file writing
 *
 * @example
 * // Minimal export file
 * {
 *   export_info: {
 *     exported_at: "2025-11-18T10:30:00Z",
 *     total_transactions: 150,
 *     minimal: true,
 *     filters: {
 *       budget_id: "budget-123",
 *       account_id: "account-456",
 *       category_id: null,
 *       since_date: "2025-01-01",
 *       type: null,
 *       minimal: true
 *     }
 *   },
 *   transactions: [
 *     { id: "txn-1", date: "2025-11-15", amount: -25500, payee_name: "Grocery Store", cleared: "cleared" },
 *     ...
 *   ]
 * }
 *
 * @example
 * // Full export file
 * {
 *   export_info: {
 *     exported_at: "2025-11-18T10:30:00Z",
 *     total_transactions: 150,
 *     minimal: false,
 *     filters: { ... }
 *   },
 *   transactions: [
 *     {
 *       id: "txn-1",
 *       date: "2025-11-15",
 *       amount: -25500,
 *       memo: "Weekly groceries",
 *       cleared: "cleared",
 *       approved: true,
 *       flag_color: null,
 *       account_id: "account-456",
 *       payee_id: "payee-789",
 *       payee_name: "Grocery Store",
 *       category_id: "category-123",
 *       category_name: "Food",
 *       ...
 *     },
 *     ...
 *   ]
 * }
 */
export const ExportFileSchema = z.object({
  export_info: ExportInfoSchema,
  transactions: z.array(ExportedTransactionSchema),
});

export type ExportFile = z.infer<typeof ExportFileSchema>;

// ============================================================================
// MAIN OUTPUT SCHEMAS
// ============================================================================

/**
 * Transaction comparison analysis result.
 * Returns matched pairs, unmatched transactions, and summary statistics.
 *
 * @see src/tools/compareTransactions/formatter.ts - buildComparisonResult function (lines 122-163)
 * @see src/tools/compareTransactions/formatter.ts - buildSummary function (lines 46-67)
 *
 * @example
 * {
 *   summary: {
 *     bank_transactions_count: 50,
 *     ynab_transactions_count: 52,
 *     matches_found: 45,
 *     missing_in_ynab: 5,
 *     missing_in_bank: 7,
 *     date_range: { start: "2025-10-01", end: "2025-10-31" },
 *     parameters: { amount_tolerance: 0, date_tolerance_days: 2 }
 *   },
 *   matches: [
 *     {
 *       bank_date: "2025-10-15",
 *       bank_amount: "25.50",
 *       bank_description: "Grocery Store",
 *       ynab_date: "2025-10-15",
 *       ynab_amount: "25.50",
 *       ynab_payee: "Grocery Store",
 *       ynab_transaction: { id: "txn-1", cleared: "cleared" },
 *       match_score: 95,
 *       match_reasons: ["exact_amount_match", "exact_date_match", "payee_similarity"]
 *     }
 *   ],
 *   missing_in_ynab: [
 *     {
 *       date: "2025-10-20",
 *       amount: "15.00",
 *       description: "Unknown Store",
 *       row_number: 12,
 *       suggested_payee_name: "Unknown Store",
 *       suggestion_reason: "No matching payee found. Suggested new payee name from description."
 *     }
 *   ],
 *   missing_in_bank: [
 *     {
 *       id: "txn-99",
 *       date: "2025-10-22",
 *       amount: "20.00",
 *       payee_name: "Coffee Shop",
 *       memo: null,
 *       cleared: "cleared"
 *     }
 *   ]
 * }
 */
export const CompareTransactionsOutputSchema = z.object({
  summary: z.object({
    bank_transactions_count: z.number(),
    ynab_transactions_count: z.number(),
    matches_found: z.number(),
    missing_in_ynab: z.number(),
    missing_in_bank: z.number(),
    date_range: DateRangeSchema,
    parameters: ComparisonParametersSchema,
  }),
  matches: z.array(MatchItemSchema),
  missing_in_ynab: z.array(MissingInYNABItemSchema),
  missing_in_bank: z.array(MissingInBankItemSchema),
});

export type CompareTransactionsOutput = z.infer<typeof CompareTransactionsOutputSchema>;

/**
 * Transaction export tool response (MCP tool result).
 * Returns export location, mode, and preview of exported data.
 *
 * @remarks
 * IMPORTANT: This schema represents the tool's response payload, NOT the file contents.
 * The tool response does NOT include `export_info` or the full `transactions` array.
 * For the file structure written to disk, see ExportFileSchema.
 *
 * @see src/tools/exportTransactions.ts:242-269 - Handler response construction
 * @see ExportFileSchema - For the JSON file structure written to disk
 *
 * @example
 * // Tool response (minimal export mode)
 * {
 *   message: "Successfully exported 150 transactions (minimal fields)",
 *   filename: "ynab_transactions_minimal_2025-11-18.json",
 *   full_path: "/Users/username/Downloads/ynab_transactions_minimal_2025-11-18.json",
 *   export_directory: "/Users/username/Downloads",
 *   export_mode: "minimal",
 *   minimal_fields: "id, date, amount, payee_name, cleared",
 *   filename_explanation: "Filename format: ynab_{filters}_{count}items_{timestamp}.json...",
 *   preview_count: 10,
 *   total_count: 150,
 *   preview_transactions: [
 *     { id: "txn-1", date: "2025-11-15", amount: -25500, memo: "Groceries", payee_name: "Grocery Store", category_name: "Food" }
 *   ]
 * }
 *
 * @example
 * // Tool response (full export mode)
 * {
 *   message: "Successfully exported 150 transactions (full fields)",
 *   filename: "ynab_transactions_2025-11-18.json",
 *   full_path: "/Users/username/Downloads/ynab_transactions_2025-11-18.json",
 *   export_directory: "/Users/username/Downloads",
 *   export_mode: "full",
 *   minimal_fields: null,
 *   filename_explanation: "Filename format: ynab_{filters}_{count}items_{timestamp}.json...",
 *   preview_count: 10,
 *   total_count: 150,
 *   preview_transactions: [
 *     { id: "txn-2", date: "2025-11-16", amount: -15000, memo: "Coffee", payee_name: "Cafe", category_name: "Dining" }
 *   ]
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
