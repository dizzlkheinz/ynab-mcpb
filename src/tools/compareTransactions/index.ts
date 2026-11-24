import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import {
	type ErrorHandler,
	withToolErrorHandling,
} from "../../server/errorHandler.js";
import type { ToolFactory } from "../../types/toolRegistration.js";
import { formatUTCISODate, isDateInRange } from "../../utils/dateUtils.js";
import {
	createAdapters,
	createBudgetResolver,
	requireResolvedBudgetId,
} from "../adapters.js";
import { optionalDateSchema } from "../schemas/common.js";
import { CompareTransactionsOutputSchema } from "../schemas/outputs/index.js";
import { ToolAnnotationPresets } from "../toolCategories.js";
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
	})
	.refine(
		(data) =>
			data.statement_start_date === undefined ||
			data.statement_date === undefined ||
			data.statement_start_date <= data.statement_date,
		{ message: "statement_start_date must be on or before statement_date" },
	);

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

/** The parsing, matching and formatting steps; tests substitute their own. */
const defaultCompareSteps = {
	readCSVFile,
	autoDetectCSVFormat,
	parseBankCSV,
	findMatches,
	buildComparisonResult,
};

function loadCsvContent(
	parsed: CompareTransactionsParams,
	steps: typeof defaultCompareSteps,
): string {
	if (parsed.csv_file_path) {
		return steps.readCSVFile(parsed.csv_file_path);
	}
	if (parsed.csv_data) {
		return parsed.csv_data;
	}
	throw new Error("Missing CSV data: csv_data is required");
}

function resolveCsvFormat(
	parsed: CompareTransactionsParams,
	csvContent: string,
	steps: typeof defaultCompareSteps,
): CompareTransactionsParams["csv_format"] {
	if (!parsed.auto_detect_format) {
		return parsed.csv_format;
	}
	try {
		const detected = steps.autoDetectCSVFormat(csvContent);
		if (parsed.debug) {
			console.warn("Auto-detected CSV format:", detected);
		}
		return detected;
	} catch (error) {
		if (parsed.debug) {
			console.warn("Auto-detection failed, using provided format:", error);
		}
		return parsed.csv_format;
	}
}

function computeComparisonDateRange(
	parsed: CompareTransactionsParams,
	filteredBankTransactions: { date: Date }[],
	minDate: Date,
	maxDate: Date,
): { start: string; end: string } {
	if (!parsed.statement_start_date && !parsed.statement_date) {
		return {
			start: formatUTCISODate(minDate),
			end: formatUTCISODate(maxDate),
		};
	}

	if (filteredBankTransactions.length > 0) {
		const { min: filteredMinDate, max: filteredMaxDate } = dateBounds(
			filteredBankTransactions.map((t) => t.date),
		);
		return {
			start: formatUTCISODate(filteredMinDate),
			end: formatUTCISODate(filteredMaxDate),
		};
	}

	return {
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

/**
 * Handles the ynab:compare_transactions tool call
 */
export async function handleCompareTransactions(
	ynabAPI: ynab.API,
	params: CompareTransactionsParams,
	errorHandler?: ErrorHandler,
	steps: typeof defaultCompareSteps = defaultCompareSteps,
): Promise<CallToolResult> {
	return await withToolErrorHandling(
		async () => {
			// Parse and apply defaults/validation
			const parsed = CompareTransactionsSchema.parse(params);
			const budgetId = requireResolvedBudgetId(parsed.budget_id);

			const payeesResponse = await ynabAPI.payees.getPayees(budgetId);
			const payees = payeesResponse.data.payees;

			const csvContent = loadCsvContent(parsed, steps);
			const csvFormat = resolveCsvFormat(parsed, csvContent, steps);

			// Parse bank transactions from CSV
			const bankTransactions = steps.parseBankCSV(csvContent, csvFormat, {
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
			const matchResults = steps.findMatches(
				filteredBankTransactions,
				filteredYnabTransactions,
				amountTolerance,
				dateToleranceDays,
				chronologyBonus,
			);

			const dateRange = computeComparisonDateRange(
				parsed,
				filteredBankTransactions,
				minDate,
				maxDate,
			);

			const parameters = {
				amount_tolerance: parsed.amount_tolerance,
				date_tolerance_days: parsed.date_tolerance_days,
			};

			return steps.buildComparisonResult(
				matchResults,
				filteredBankTransactions,
				filteredYnabTransactions,
				payees,
				parameters,
				dateRange,
			);
		},
		"ynab_compare_transactions",
		"comparing bank and YNAB transactions",
		errorHandler,
	);
}

/**
 * Registers the read-only bank CSV comparison tool with the registry.
 */
export const registerCompareTransactionTools: ToolFactory = (
	registry,
	context,
) => {
	const { adapt } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);

	registry.register({
		name: "ynab_compare_transactions",
		description: `Compare bank CSV transactions with YNAB transactions to find missing or mismatched entries.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - account_id (string, required): Account UUID to compare against.
  - csv_file_path or csv_data (string, required): Bank export file path or inline CSV text.
  - statement_start_date (string, optional): Filter comparison window start date (YYYY-MM-DD).
  - statement_date (string, optional): Filter comparison window end date (YYYY-MM-DD).
  - amount_tolerance (number, optional): Amount match tolerance in dollars, 0-1. Default: 0.01.
  - date_tolerance_days (number, optional): Date match tolerance, 0-7 days. Default: 5.
  - enable_chronology_bonus (boolean, optional): Prefer matches in chronological order. Default: false.
  - auto_detect_format (boolean, optional): Detect CSV columns automatically. Default: false.
  - csv_format (object, optional): CSV layout (date_column, amount_column, debit_column, credit_column, description_column, date_format, has_header, delimiter).
  - debug (boolean, optional): Include extra diagnostics. Default: false.

Returns: summary (counts, date_range, parameters), matches, missing_in_ynab (bank rows with no YNAB match), missing_in_bank (YNAB transactions with no bank row).`,
		inputSchema: CompareTransactionsSchema,
		outputSchema: CompareTransactionsOutputSchema,
		handler: adapt(handleCompareTransactions),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof CompareTransactionsSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Compare Transactions",
			},
		},
	});
};
