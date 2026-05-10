import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import type { ErrorHandler } from "../../server/errorHandler.js";
import { withToolErrorHandling } from "../../types/index.js";
import { requireResolvedBudgetId } from "../adapters.js";
import { buildComparisonResult } from "./formatter.js";
import { findMatches } from "./matcher.js";
import { autoDetectCSVFormat, parseBankCSV, readCSVFile } from "./parser.js";
import type { YNABTransaction } from "./types.js";

// Re-export core types for consumers
export type {
	BankTransaction,
	TransactionMatch,
	YNABTransaction,
} from "./types.js";

/**
 * Schema for ynab:compare_transactions tool parameters
 */
export const CompareTransactionsSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		account_id: z.string().min(1, "Account ID is required"),
		csv_file_path: z.string().optional(),
		csv_data: z.string().optional(),
		amount_tolerance: z.number().min(0).max(1).optional().default(0.01),
		date_tolerance_days: z.number().min(0).max(7).optional().default(5),
		enable_chronology_bonus: z.boolean().optional().default(false),
		statement_start_date: z.string().optional(),
		statement_date: z.string().optional(),
		auto_detect_format: z.boolean().optional().default(false),
		debug: z.boolean().optional().default(false),
		csv_format: z
			.object({
				date_column: z
					.union([z.string(), z.number()])
					.optional()
					.default("Date"),
				amount_column: z.union([z.string(), z.number()]).optional(),
				debit_column: z.union([z.string(), z.number()]).optional(),
				credit_column: z.union([z.string(), z.number()]).optional(),
				description_column: z
					.union([z.string(), z.number()])
					.optional()
					.default("Description"),
				date_format: z.string().optional().default("MM/DD/YYYY"),
				has_header: z.boolean().optional().default(true),
				delimiter: z.string().optional().default(","),
			})
			.strict()
			.optional()
			.default(() => ({
				date_column: "Date",
				amount_column: "Amount",
				description_column: "Description",
				date_format: "MM/DD/YYYY",
				has_header: true,
				delimiter: ",",
			})),
	})
	.strict()
	.refine((data) => data.csv_file_path || data.csv_data, {
		message: "Either csv_file_path or csv_data must be provided",
	});

export type CompareTransactionsParams = z.infer<
	typeof CompareTransactionsSchema
>;

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDateOnly(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function parseDateOnly(date: string): Date {
	const match = DATE_ONLY_PATTERN.exec(date);
	if (!match) {
		return new Date(date);
	}
	const [, year, month, day] = match;
	return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * Handles the ynab:compare_transactions tool call
 */
export async function handleCompareTransactions(
	ynabAPI: ynab.API,
	params: CompareTransactionsParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	return await withToolErrorHandling(
		async () => {
			// Parse and apply defaults/validation
			const parsed = CompareTransactionsSchema.parse(params);
			const budgetId = requireResolvedBudgetId(parsed.budget_id);

			const payeesResponse = await ynabAPI.payees.getPayees(budgetId);
			const payees = payeesResponse.data.payees;

			// Get CSV data
			let csvContent: string;
			if (parsed.csv_file_path) {
				csvContent = readCSVFile(parsed.csv_file_path);
			} else if (parsed.csv_data) {
				csvContent = parsed.csv_data;
			} else {
				throw new Error("Missing CSV data: csv_data is required");
			}

			// Auto-detect format if requested
			let csvFormat = parsed.csv_format;
			if (parsed.auto_detect_format) {
				try {
					csvFormat = autoDetectCSVFormat(csvContent);
					if (parsed.debug) {
						console.warn("Auto-detected CSV format:", csvFormat);
					}
				} catch (error) {
					if (parsed.debug) {
						console.warn(
							"Auto-detection failed, using provided format:",
							error,
						);
					}
				}
			}

			// Parse bank transactions from CSV
			const bankTransactions = parseBankCSV(csvContent, csvFormat, {
				debug: parsed.debug,
			});

			if (bankTransactions.length === 0) {
				throw new Error(
					`No valid transactions found in CSV data. Check your csv_format parameters or try auto_detect_format: true. CSV has ${csvContent.split("\n").length} lines.`,
				);
			}

			// Calculate date range for YNAB query
			const bankDates = bankTransactions.map((t) => t.date);
			const minDate = new Date(Math.min(...bankDates.map((d) => d.getTime())));
			const maxDate = new Date(Math.max(...bankDates.map((d) => d.getTime())));

			// Add tolerance to date range
			const dateToleranceDays = parsed.date_tolerance_days ?? 0;
			const startDate = new Date(minDate);
			startDate.setDate(startDate.getDate() - dateToleranceDays);
			const endDate = new Date(maxDate);
			endDate.setDate(endDate.getDate() + dateToleranceDays);

			// Get YNAB transactions for the account in the date range
			const sinceDate = formatDateOnly(startDate);
			const endDateString = formatDateOnly(endDate);
			const response = await ynabAPI.transactions.getTransactionsByAccount(
				budgetId,
				parsed.account_id,
				sinceDate,
			);

			// Filter YNAB transactions to the extended date range and convert for comparison
			const ynabTransactions: YNABTransaction[] = response.data.transactions
				.filter((txn) => {
					const txnDateString = formatDateOnly(parseDateOnly(txn.date));
					return (
						txnDateString >= sinceDate &&
						txnDateString <= endDateString &&
						!txn.deleted
					);
				})
				.map((txn) => ({
					id: txn.id,
					date: parseDateOnly(txn.date),
					amount: txn.amount,
					payee_name: txn.payee_name,
					memo: txn.memo,
					cleared: txn.cleared,
					original: txn,
				}));

			// Filter candidates to statement window if provided
			let filteredBankTransactions = bankTransactions;
			let filteredYnabTransactions = ynabTransactions;

			if (parsed.statement_start_date || parsed.statement_date) {
				filteredBankTransactions = bankTransactions.filter((t) => {
					const dateStr = formatDateOnly(t.date);
					if (
						parsed.statement_start_date &&
						dateStr < parsed.statement_start_date
					) {
						return false;
					}
					if (parsed.statement_date && dateStr > parsed.statement_date) {
						return false;
					}
					return true;
				});
				filteredYnabTransactions = ynabTransactions.filter((t) => {
					const dateStr = formatDateOnly(t.date);
					if (
						parsed.statement_start_date &&
						dateStr < parsed.statement_start_date
					) {
						return false;
					}
					if (parsed.statement_date && dateStr > parsed.statement_date) {
						return false;
					}
					return true;
				});
			}

			// Find matches
			const amountTolerance = parsed.amount_tolerance ?? 0.01;
			const chronologyBonus = parsed.enable_chronology_bonus ?? false;
			const matchResults = findMatches(
				filteredBankTransactions,
				filteredYnabTransactions,
				amountTolerance,
				dateToleranceDays,
				chronologyBonus,
			);

			// Build comparison result - compute date range from filtered transactions when statement window is applied
			let dateRange: { start: string; end: string };
			if (parsed.statement_start_date || parsed.statement_date) {
				// Use filtered bank transactions for date range when statement window filtering is applied
				const filteredBankDates = filteredBankTransactions.map((t) => t.date);
				if (filteredBankDates.length > 0) {
					const filteredMinDate = new Date(
						Math.min(...filteredBankDates.map((d) => d.getTime())),
					);
					const filteredMaxDate = new Date(
						Math.max(...filteredBankDates.map((d) => d.getTime())),
					);
					dateRange = {
						start: formatDateOnly(filteredMinDate),
						end: formatDateOnly(filteredMaxDate),
					};
				} else {
					// Fallback to statement window if no filtered transactions
					dateRange = {
						start:
							parsed.statement_start_date ||
							parsed.statement_date ||
							formatDateOnly(minDate),
						end:
							parsed.statement_date ||
							parsed.statement_start_date ||
							formatDateOnly(maxDate),
					};
				}
			} else {
				// Use original unfiltered date range when no statement window filtering
				dateRange = {
					start: formatDateOnly(minDate),
					end: formatDateOnly(maxDate),
				};
			}

			const parameters = {
				amount_tolerance: parsed.amount_tolerance,
				date_tolerance_days: parsed.date_tolerance_days,
			};

			return buildComparisonResult(
				matchResults,
				filteredBankTransactions,
				filteredYnabTransactions,
				payees,
				parameters,
				dateRange,
			);
		},
		"ynab:compare_transactions",
		"comparing bank and YNAB transactions",
		errorHandler,
	);
}
