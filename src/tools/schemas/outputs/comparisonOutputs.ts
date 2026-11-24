import { z } from "zod/v4";
import { isValidISODate } from "../../../utils/dateUtils.js";
import { TransactionOutputSchema } from "../../transactionModel.js";

/**
 * Reusable Zod schema for validating ISO date strings (YYYY-MM-DD).
 * Validates both format and calendar validity.
 *
 * @example
 * const schema = z.object({ date: ISODateStringSchema });
 * schema.parse({ date: "2024-02-29" }); // OK (leap year)
 * schema.parse({ date: "2024-02-31" }); // Error: Invalid calendar date
 */
const ISODateStringSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
	.refine(isValidISODate, {
		message:
			"Invalid calendar date (e.g., month must be 01-12, day must be valid for the month)",
	});

const MissingInYNABItemSchema = z.object({
	date: ISODateStringSchema,
	amount: z
		.string()
		.regex(
			/^-?\d+\.\d{2}$/,
			"Amount must be a decimal string with exactly 2 decimal places",
		),
	description: z.string(),
	row_number: z.number(),
	suggested_payee_id: z.string().optional(),
	suggested_payee_name: z.string().optional(),
	suggestion_reason: z.string().optional(),
});

const MissingInBankItemSchema = z.object({
	id: z.string(),
	date: ISODateStringSchema,
	amount: z
		.string()
		.regex(
			/^-?\d+\.\d{2}$/,
			"Amount must be a decimal string with exactly 2 decimal places",
		),
	payee_name: z.string().nullable(),
	memo: z.string().nullish(),
	cleared: z.string(),
});

const MatchItemSchema = z.object({
	bank_date: ISODateStringSchema,
	bank_amount: z
		.string()
		.regex(
			/^-?\d+\.\d{2}$/,
			"Amount must be a decimal string with exactly 2 decimal places",
		),
	bank_description: z.string(),
	ynab_date: ISODateStringSchema,
	ynab_amount: z
		.string()
		.regex(
			/^-?\d+\.\d{2}$/,
			"Amount must be a decimal string with exactly 2 decimal places",
		),
	ynab_payee: z.string().nullable(),
	ynab_transaction: z.object({
		id: z.string(),
		cleared: z.string(),
	}),
	match_score: z.number(),
	match_reasons: z.array(z.string()),
});

const ComparisonParametersSchema = z.object({
	amount_tolerance: z.number().optional(),
	date_tolerance_days: z.number().optional(),
});

const DateRangeSchema = z
	.object({
		start: ISODateStringSchema,
		end: ISODateStringSchema,
	})
	.refine(
		(data) => {
			// Parse both dates - we know they're valid ISO dates due to ISODateStringSchema
			const startDate = Date.parse(data.start);
			const endDate = Date.parse(data.end);

			// Validate logical ordering: start must be <= end
			return startDate <= endDate;
		},
		{
			message: "Start date must be before or equal to end date",
		},
	);

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
 *     { id: "txn-1", date: "2025-11-15", amount: -25.5, memo: "Groceries", payee_name: "Grocery Store", category_name: "Food" }
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
 *     { id: "txn-2", date: "2025-11-16", amount: -15, memo: "Coffee", payee_name: "Cafe", category_name: "Dining" }
 *   ]
 * }
 */
export const ExportTransactionsOutputSchema = z.object({
	message: z.string(),
	filename: z.string(),
	full_path: z.string(),
	export_directory: z.string(),
	export_mode: z.enum(["minimal", "full"]),
	minimal_fields: z.string().nullable(),
	filename_explanation: z.string(),
	preview_count: z.number(),
	total_count: z.number(),
	preview_transactions: z.array(
		TransactionOutputSchema.partial().required({
			id: true,
			date: true,
			amount: true,
		}),
	),
});
