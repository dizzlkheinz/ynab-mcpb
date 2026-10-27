import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import type { ErrorHandler } from "../../server/errorHandler.js";
import { withToolErrorHandling } from "../../types/index.js";
import { formatUTCISODate, isDateInRange } from "../../utils/dateUtils.js";
import { requireResolvedBudgetId } from "../adapters.js";
import { optionalDateSchema } from "../schemas/common.js";
import { buildComparisonResult } from "./formatter.js";
import { findMatches } from "./matcher.js";
import { autoDetectCSVFormat, parseBankCSV, readCSVFile } from "./parser.js";
import type { YNABTransaction } from "./types.js";

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
		statement_start_date: optionalDateSchema,
		statement_date: optionalDateSchema,
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

function parseDateOnly(date: string): Date {
	const match = DATE_ONLY_PATTERN.exec(date);
	if (!match) {
		return new Date(date);
	}
	const [, year, month, day] = match;
	return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/**
 * Earliest and latest of a non-empty list of dates
 */
function dateBounds(dates: Date[]): { min: Date; max: Date } {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const date of dates) {
		const time = date.getTime();
		if (time < min) min = time;
		if (time > max) max = time;
	}
	return { min: new Date(min), max: new Date(max) };
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
			const { min: minDate, max: maxDate } = dateBounds(
				bankTransactions.map((t) => t.date),
			);

			// Add tolerance to date range
			const dateToleranceDays = parsed.date_tolerance_days ?? 0;
			const startDate = new Date(minDate);
			startDate.setUTCDate(startDate.getUTCDate() - dateToleranceDays);
			const endDate = new Date(maxDate);
			endDate.setUTCDate(endDate.getUTCDate() + dateToleranceDays);

			// Get YNAB transactions for the account in the date range
			const sinceDate = formatUTCISODate(startDate);
			const endDateString = formatUTCISODate(endDate);
			const response = await ynabAPI.transactions.getTransactionsByAccount(
				budgetId,
				parsed.account_id,
				sinceDate,
			);

			// Filter YNAB transactions to the extended date range and convert for comparison
			const ynabTransactions: YNABTransaction[] = response.data.transactions
				.filter((txn) => !txn.deleted)
				.map((txn) => ({
					id: txn.id,
					date: parseDateOnly(txn.date),
					amount: txn.amount,
					payee_name: txn.payee_name,
					memo: txn.memo,
					cleared: txn.cleared,
					original: txn,
				}))
				.filter((t) =>
					isDateInRange(formatUTCISODate(t.date), sinceDate, endDateString),
				);

			// Filter candidates to statement window if provided
			let filteredBankTransactions = bankTransactions;
			let filteredYnabTransactions = ynabTransactions;

			if (parsed.statement_start_date || parsed.statement_date) {
				const inStatementWindow = (t: { date: Date }) =>
					isDateInRange(
						formatUTCISODate(t.date),
						parsed.statement_start_date,
						parsed.statement_date,
					);
				filteredBankTransactions = bankTransactions.filter(inStatementWindow);
				filteredYnabTransactions = ynabTransactions.filter(inStatementWindow);
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
				if (filteredBankTransactions.length > 0) {
					const { min: filteredMinDate, max: filteredMaxDate } = dateBounds(
						filteredBankTransactions.map((t) => t.date),
					);
					dateRange = {
						start: formatUTCISODate(filteredMinDate),
						end: formatUTCISODate(filteredMaxDate),
					};
				} else {
					// Fallback to statement window if no filtered transactions
					dateRange = {
						start:
							parsed.statement_start_date ||
							parsed.statement_date ||
							formatUTCISODate(minDate),
						end:
							parsed.statement_date ||
							parsed.statement_start_date ||
							formatUTCISODate(maxDate),
					};
				}
			} else {
				// Use original unfiltered date range when no statement window filtering
				dateRange = {
					start: formatUTCISODate(minDate),
					end: formatUTCISODate(maxDate),
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
