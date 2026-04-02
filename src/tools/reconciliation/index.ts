/**
 * Reconciliation tool - Phase 1: Analysis Only
 * Implements guided reconciliation workflow with conservative matching
 */

import { promises as fs } from "node:fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import type { ErrorHandler } from "../../server/errorHandler.js";
import { responseFormatter } from "../../server/responseFormatter.js";
import type { ProgressCallback } from "../../server/toolRegistry.js";
import { withToolErrorHandling } from "../../types/index.js";
import type { ToolFactory } from "../../types/toolRegistration.js";
import { createAdapters, createBudgetResolver } from "../adapters.js";
import {
	CompareTransactionsSchema,
	handleCompareTransactions,
} from "../compareTransactions/index.js";
import { resolveCsvPathCandidates } from "../csvFilePath.js";
import type { DeltaFetcher } from "../deltaFetcher.js";
import { resolveDeltaFetcherArgs } from "../deltaSupport.js";
import {
	CompareTransactionsOutputSchema,
	ReconcileAccountOutputSchema,
} from "../schemas/outputs/index.js";
import { ToolAnnotationPresets } from "../toolCategories.js";
import { analyzeReconciliation } from "./analyzer.js";
import {
	type CSVParseResult,
	type ParseCSVOptions,
	parseCSV,
} from "./csvParser.js";
import {
	type AccountSnapshot,
	executeReconciliation,
	type LegacyReconciliationResult,
} from "./executor.js";
import type { MatchingConfig } from "./matcher.js";
import {
	buildReconciliationPayload,
	type DualChannelPayload,
} from "./outputBuilder.js";
import { detectSignInversion } from "./signDetector.js";
import {
	clampCSVToStatementWindow,
	formatStatementWindow,
	normalizeStatementDate,
} from "./statementWindow.js";
import type { BankTransaction } from "./types.js";
import { normalizeYNABTransactions } from "./ynabAdapter.js";

export { analyzeReconciliation } from "./analyzer.js";
export { findBestMatch, findMatches } from "./matcher.js";
export {
	fuzzyMatch,
	normalizedMatch,
	normalizePayee,
	payeeSimilarity,
} from "./payeeNormalizer.js";
// Re-export types for external use
export type * from "./types.js";

/**
 * Schema for reconcile_account tool
 */
export const ReconcileAccountSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required"),
		account_id: z.string().min(1, "Account ID is required"),

		// CSV input (one required)
		csv_file_path: z.string().optional(),
		csv_data: z.string().optional(),

		csv_format: z
			.object({
				date_column: z.union([z.string(), z.number()]).optional(),
				amount_column: z.union([z.string(), z.number()]).optional(),
				debit_column: z.union([z.string(), z.number()]).optional(),
				credit_column: z.union([z.string(), z.number()]).optional(),
				description_column: z.union([z.string(), z.number()]).optional(),
				date_format: z.string().optional(),
				has_header: z.boolean().optional(),
				delimiter: z.string().optional(),
			})
			.strict()
			.optional(),

		// Statement information
		statement_balance: z.number({
			message: "Statement balance is required and must be a number",
		}),
		statement_end_date: z.string().optional(),

		// Matching configuration (optional)
		date_tolerance_days: z.number().min(0).max(7).optional().default(7),
		match_strictness: z
			.enum(["loose", "normal", "strict"])
			.optional()
			.default("normal"),

		auto_create_transactions: z.boolean().optional().default(false),
		auto_update_cleared_status: z.boolean().optional().default(false),
		auto_unclear_missing: z.boolean().optional().default(true),
		auto_adjust_dates: z.boolean().optional().default(false),
		dry_run: z.boolean().optional().default(true),
		// Sign convention override for bank CSV amounts
		sign_convention: z
			.enum(["auto", "invert", "as_is"])
			.optional()
			.default("auto"),

		// Response options
		max_suggestions_in_output: z.number().int().min(1).optional().default(20),
	})
	.refine((data) => data.csv_file_path || data.csv_data, {
		message:
			"csv_data or csv_file_path is required. " +
			"Provide the CSV content as a string (csv_data) or a file path (csv_file_path). " +
			"For balance-only verification without transaction matching, this tool does not yet " +
			"support that mode — use ynab_list_transactions with a cleared filter instead.",
		path: ["csv_data"],
	});

export type ReconcileAccountRequest = z.infer<typeof ReconcileAccountSchema>;

/**
 * Handle reconciliation analysis and optional execution
 *
 * Provides intelligent transaction matching, insight detection, and optional
 * execution of reconciliation actions. Returns human-readable narrative and
 * structured JSON data.
 */
export async function handleReconcileAccount(
	ynabAPI: ynab.API,
	deltaFetcher: DeltaFetcher,
	params: ReconcileAccountRequest,
	sendProgress?: ProgressCallback,
): Promise<CallToolResult>;
export async function handleReconcileAccount(
	ynabAPI: ynab.API,
	params: ReconcileAccountRequest,
): Promise<CallToolResult>;
export async function handleReconcileAccount(
	ynabAPI: ynab.API,
	deltaFetcherOrParams: DeltaFetcher | ReconcileAccountRequest,
	maybeParams?: ReconcileAccountRequest,
	sendProgress?: ProgressCallback,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaFetcher, params } = resolveDeltaFetcherArgs(
		ynabAPI,
		deltaFetcherOrParams,
		maybeParams,
	);
	return await withToolErrorHandling(
		async () => {
			// Derive matching thresholds from match_strictness
			const STRICTNESS_THRESHOLDS = {
				loose: { autoMatch: 70, suggested: 55 },
				normal: { autoMatch: 85, suggested: 60 },
				strict: { autoMatch: 93, suggested: 75 },
			} as const;
			const strictness = params.match_strictness ?? "normal";
			const { autoMatch: autoMatchThreshold, suggested: suggestionThreshold } =
				STRICTNESS_THRESHOLDS[strictness];

			// Build matching configuration from parameters (V2 Format)
			const config: MatchingConfig = {
				weights: {
					date: 0.15,
					payee: 0.35,
				},
				dateToleranceDays: params.date_tolerance_days ?? 7,
				autoMatchThreshold,
				suggestedMatchThreshold: suggestionThreshold,
				minimumCandidateScore: 40,
				exactDateBonus: 5,
				exactPayeeBonus: 10,
			};

			const accountResult = await deltaFetcher.fetchAccountsFull(
				params.budget_id,
			);
			const accountData = accountResult.data.find(
				(account) => account.id === params.account_id,
			);
			if (!accountData) {
				throw new Error(
					`Account ${params.account_id} not found in budget ${params.budget_id}`,
				);
			}
			const accountName = accountData.name;
			const accountType = accountData.type;

			// For liability accounts (credit cards, loans, debts), statement balance should be negative
			// A positive balance on a credit card statement means you OWE that amount
			const accountIsLiability =
				accountType === "creditCard" ||
				accountType === "lineOfCredit" ||
				accountType === "mortgage" ||
				accountType === "autoLoan" ||
				accountType === "studentLoan" ||
				accountType === "personalLoan" ||
				accountType === "medicalDebt" ||
				accountType === "otherDebt" ||
				accountType === "otherLiability";

			// Default inversion assumption: liability accounts typically show charges as positive
			const shouldInvertBankAmounts = accountIsLiability;

			// Negate statement balance for liability accounts
			const adjustedStatementBalance = accountIsLiability
				? -Math.abs(params.statement_balance)
				: params.statement_balance;

			const budgetResponse = await ynabAPI.plans.getPlanById(params.budget_id);
			const currencyCode =
				budgetResponse.data.plan?.currency_format?.iso_code ?? "USD";

			const narrativeNotes: string[] = [];

			// Prepare CSV parsing options from request
			const dateFormat = mapCsvDateFormatToHint(params.csv_format?.date_format);
			const csvOptions: ParseCSVOptions = {
				columns: {
					...(params.csv_format?.date_column !== undefined && {
						date: String(params.csv_format.date_column),
					}),
					...(params.csv_format?.amount_column !== undefined && {
						amount: String(params.csv_format.amount_column),
					}),
					...(params.csv_format?.debit_column !== undefined && {
						debit: String(params.csv_format.debit_column),
					}),
					...(params.csv_format?.credit_column !== undefined && {
						credit: String(params.csv_format.credit_column),
					}),
					...(params.csv_format?.description_column !== undefined && {
						description: String(params.csv_format.description_column),
					}),
				},
				...(dateFormat && { dateFormat }),
				...(params.csv_format?.has_header !== undefined && {
					header: params.csv_format.has_header,
				}),
				...(params.csv_format?.delimiter !== undefined && {
					delimiter: params.csv_format.delimiter,
				}),
			};

			// Load CSV content from either inline data or filesystem path
			let csvContent = params.csv_data ?? "";
			if (!csvContent && params.csv_file_path) {
				const pathCandidates = resolveCsvPathCandidates(params.csv_file_path);
				let lastReadError: unknown;

				for (const candidatePath of pathCandidates) {
					try {
						csvContent = await fs.readFile(candidatePath, "utf8");
						if (candidatePath !== params.csv_file_path) {
							narrativeNotes.push(
								`Read CSV using normalized path "${candidatePath}" from "${params.csv_file_path}".`,
							);
						}
						break;
					} catch (error) {
						lastReadError = error;
					}
				}

				if (!csvContent) {
					const attemptedPaths =
						pathCandidates.length > 0
							? pathCandidates.join(", ")
							: params.csv_file_path;
					const message =
						lastReadError instanceof Error && lastReadError.message
							? lastReadError.message
							: "Unknown error while reading CSV file";
					throw new Error(
						`Failed to read CSV file. Tried path(s): ${attemptedPaths}. ${message}. If this path is from another runtime (for example an uploaded sandbox file), pass the CSV via csv_data instead.`,
					);
				}
			}

			if (!csvContent.trim()) {
				throw new Error(
					"CSV content is empty after reading the provided source.",
				);
			}

			// Initial parse without inversion for date window + sign detection
			let rawCsvResult: CSVParseResult;
			try {
				rawCsvResult = parseCSV(csvContent, {
					...csvOptions,
					invertAmounts: false,
				});
			} catch (error) {
				const message =
					error instanceof Error && error.message
						? error.message
						: "Unknown error while parsing CSV";
				throw new Error(`Failed to parse CSV data: ${message}`);
			}

			const statementWindowEnd = normalizeStatementDate(
				params.statement_end_date,
			);
			const statementWindowBounds = {
				...(statementWindowEnd !== undefined && {
					endDate: statementWindowEnd,
				}),
			};
			const clampedCsv = clampCSVToStatementWindow(rawCsvResult, {
				...statementWindowBounds,
			});
			rawCsvResult = clampedCsv.parseResult;
			if (clampedCsv.excludedCount > 0) {
				narrativeNotes.push(
					`Filtered ${clampedCsv.excludedCount} CSV transaction(s) outside statement window ${formatStatementWindow(statementWindowBounds)}.`,
				);
			}

			if (clampedCsv.windowApplied && rawCsvResult.transactions.length === 0) {
				throw new Error(
					`No CSV transactions remain after applying statement window ${formatStatementWindow(clampedCsv.windowApplied)}.`,
				);
			}

			const effectiveStatementEndDate =
				statementWindowEnd ??
				inferLatestTransactionDate(rawCsvResult.transactions);
			if (
				statementWindowEnd === undefined &&
				effectiveStatementEndDate !== undefined
			) {
				narrativeNotes.push(
					`Auto-detected statement_end_date=${effectiveStatementEndDate} from the latest CSV transaction for balance verification.`,
				);
			}

			// Fetch YNAB transactions for the account using inferred date window
			let sinceDate: Date;
			let dateWindowSource: "csv_min_date_with_buffer" | "fallback_90_days";

			if (rawCsvResult.transactions.length > 0) {
				sinceDate = inferSinceDateFromTransactions(rawCsvResult.transactions);
				dateWindowSource = "csv_min_date_with_buffer";
			} else {
				sinceDate = fallbackSinceDate();
				dateWindowSource = "fallback_90_days";
				narrativeNotes.push(
					"CSV contained no parsable transactions for date detection; fetched the last 90 days from YNAB.",
				);
			}

			const sinceDateString = sinceDate.toISOString().split("T")[0];
			const transactionsResult =
				await deltaFetcher.fetchTransactionsByAccountFull(
					params.budget_id,
					params.account_id,
					sinceDateString,
				);

			const ynabTransactions = transactionsResult.data;
			const normalizedYNAB = normalizeYNABTransactions(ynabTransactions);

			// Determine sign inversion: explicit override or auto-detect
			const signConvention = params.sign_convention ?? "auto";
			let finalInvertAmounts: boolean;
			if (signConvention === "invert") {
				finalInvertAmounts = true;
				narrativeNotes.push(
					"Using explicit sign_convention=invert; bank amounts will be negated.",
				);
			} else if (signConvention === "as_is") {
				finalInvertAmounts = false;
				narrativeNotes.push(
					"Using explicit sign_convention=as_is; bank amounts used as-is.",
				);
			} else {
				// Auto-detect sign convention; fall back to account-type default
				finalInvertAmounts = shouldInvertBankAmounts;
				if (rawCsvResult.transactions.length > 0 && normalizedYNAB.length > 0) {
					const needsInversion = detectSignInversion(
						rawCsvResult.transactions,
						normalizedYNAB,
					);

					if (needsInversion !== null) {
						if (needsInversion !== finalInvertAmounts) {
							narrativeNotes.push(
								needsInversion
									? "Detected bank CSV amounts opposite YNAB; inverting bank amounts for matching."
									: "Detected bank CSV amounts already align with YNAB; using CSV amounts as-is.",
							);
						}

						finalInvertAmounts = needsInversion;
					}
				}
			}

			// If inversion is needed, negate amounts in-place instead of re-parsing
			const parseResult: CSVParseResult = finalInvertAmounts
				? {
						...rawCsvResult,
						transactions: rawCsvResult.transactions.map((txn) => ({
							...txn,
							amount: -txn.amount,
						})),
					}
				: rawCsvResult;

			const auditMetadata = {
				data_freshness: "guaranteed_fresh",
				data_source: "full_api_fetch_no_delta",
				server_knowledge: transactionsResult.serverKnowledge,
				fetched_at: new Date().toISOString(),
				accounts_count: accountResult.data.length,
				transactions_count: transactionsResult.data.length,
				cache_status: {
					accounts_cached: accountResult.wasCached,
					transactions_cached: transactionsResult.wasCached,
					delta_merge_applied: transactionsResult.usedDelta,
				},
				csv: {
					rows: parseResult.meta.totalRows,
					transactions: parseResult.transactions.length,
					errors: parseResult.errors.length,
					warnings: parseResult.warnings.length,
					delimiter: parseResult.meta.detectedDelimiter,
				},
				date_window: {
					since_date: sinceDateString,
					source: dateWindowSource,
				},
				sign_detection: {
					default_invert: shouldInvertBankAmounts,
					final_invert: finalInvertAmounts,
				},
			};

			const initialAccount: AccountSnapshot = {
				balance: accountData.balance,
				cleared_balance: accountData.cleared_balance,
				uncleared_balance: accountData.uncleared_balance,
			};

			// Perform analysis
			const analysis = analyzeReconciliation(
				parseResult,
				params.csv_file_path,
				ynabTransactions,
				adjustedStatementBalance,
				config,
				currencyCode,
				params.account_id,
				params.budget_id,
				finalInvertAmounts, // Use smart-detected value
				csvOptions,
				initialAccount,
			);

			const effectiveParams =
				effectiveStatementEndDate !== params.statement_end_date
					? {
							...params,
							statement_end_date: effectiveStatementEndDate,
						}
					: params;

			let executionData: LegacyReconciliationResult | undefined;
			const wantsBalanceVerification = Boolean(
				effectiveParams.statement_end_date,
			);
			const shouldExecute =
				params.auto_create_transactions ||
				params.auto_update_cleared_status ||
				params.auto_unclear_missing ||
				params.auto_adjust_dates ||
				wantsBalanceVerification;

			if (shouldExecute) {
				executionData = await executeReconciliation({
					ynabAPI,
					analysis,
					params: effectiveParams,
					budgetId: params.budget_id,
					accountId: params.account_id,
					initialAccount,
					currencyCode,
					...(sendProgress !== undefined && { sendProgress }),
				});
			}

			const csvFormatForPayload = mapCsvFormatForPayload(params.csv_format);

			const adapterOptions: Parameters<typeof buildReconciliationPayload>[1] = {
				accountName,
				accountId: params.account_id,
				accountIsLiability,
				currencyCode,
				auditMetadata,
				maxSuggestionsInOutput: params.max_suggestions_in_output,
			};
			if (csvFormatForPayload !== undefined) {
				adapterOptions.csvFormat = csvFormatForPayload;
			}
			if (narrativeNotes.length > 0) {
				adapterOptions.notes = narrativeNotes;
			}

			const payload: DualChannelPayload = buildReconciliationPayload(
				analysis,
				adapterOptions,
				executionData,
			);

			// Build response payload matching ReconcileAccountOutputSchema
			// Always includes unmatched_only structured data for agent consumption.
			// Include execution summary when reconciliation actions were performed.
			let executionSummary:
				| {
						transactions_created: number;
						transactions_updated: number;
						dates_adjusted: number;
						dry_run: boolean;
						balance_status: "balanced" | "unbalanced" | "not_verified";
						recommendations: string[];
				  }
				| undefined;
			if (executionData) {
				const balanceRecon = executionData.balance_reconciliation;
				const balanceStatus: "balanced" | "unbalanced" | "not_verified" =
					!wantsBalanceVerification
						? "not_verified"
						: balanceRecon?.status === "balanced"
							? "balanced"
							: "unbalanced";

				executionSummary = {
					transactions_created: executionData.summary.transactions_created,
					transactions_updated: executionData.summary.transactions_updated,
					dates_adjusted: executionData.summary.dates_adjusted,
					dry_run: executionData.summary.dry_run,
					balance_status: balanceStatus,
					recommendations: executionData.recommendations,
				};
			}
			const structured = {
				unmatched_bank: payload.structured.unmatched.bank,
				unmatched_ynab: payload.structured.unmatched.ynab,
				suggestions: payload.structured.matches.suggested,
				...(executionSummary !== undefined && {
					execution_summary: executionSummary,
				}),
			};
			const responseData = {
				human: payload.human,
				structured,
			};

			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(responseData),
					},
				],
				structuredContent: responseData,
			};
		},
		"ynab:reconcile_account",
		"analyzing account reconciliation",
		errorHandler,
	);
}

/**
 * Registers reconciliation-domain tools (compare + reconcile) with the registry.
 */
export const registerReconciliationTools: ToolFactory = (registry, context) => {
	const { adapt, adaptWithDeltaAndProgress } = createAdapters(context);
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

Returns: comparison report with matched, unmatched_bank, unmatched_ynab transactions.`,
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

	registry.register({
		name: "ynab_reconcile_account",
		description: `Guided account reconciliation: match bank CSV transactions to YNAB, detect discrepancies, and optionally execute bulk create/update/unclear operations.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - account_id (string, required): Account UUID to reconcile.
  - csv_file_path or csv_data (string, required): Bank export file path or inline CSV text.
  - statement_balance (number, required): Ending balance from the bank statement (dollars).
      For credit cards and other liability accounts, pass a negative value (e.g. -6143.27 means you owe $6,143.27).
  - statement_end_date (string, optional): Statement closing date (YYYY-MM-DD). Filters CSV and triggers balance verification. Auto-detected from CSV if omitted.
  - match_strictness (string, optional): Matching sensitivity — "loose" (more matches), "normal" (default), or "strict" (fewer false positives).
  - sign_convention (string, optional): How to treat CSV amount signs — "auto" (default, detects from data), "invert" (negate all amounts), "as_is" (use amounts unchanged). Useful when auto-detection fails for liability accounts.
  - dry_run (boolean, optional): Preview actions without executing. Default: true.
  - auto_create_transactions (boolean, optional): Auto-create missing transactions. Default: false.
  - auto_update_cleared_status (boolean, optional): Auto-mark matched transactions as cleared. Default: false.
  - max_suggestions_in_output (number, optional): Limit unmatched items and suggestions shown in the human report. Default: 20.

Returns: human-readable reconciliation narrative + structured JSON (unmatched_bank, unmatched_ynab, suggestions, execution_summary when actions are performed).

Examples:
  - Preview reconciliation: set dry_run=true (default)
  - Execute: set dry_run=false, auto_update_cleared_status=true`,
		inputSchema: ReconcileAccountSchema,
		outputSchema: ReconcileAccountOutputSchema,
		handler: adaptWithDeltaAndProgress(handleReconcileAccount),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof ReconcileAccountSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
				title: "YNAB: Reconcile Account",
			},
		},
	});
};

function mapCsvDateFormatToHint(
	format: string | undefined,
): ParseCSVOptions["dateFormat"] | undefined {
	if (!format) {
		return undefined;
	}

	const normalized = format.toUpperCase().replace(/[^YMD]/g, "");

	if (
		normalized === "YYYYMMDD" ||
		normalized === "YYMMDD" ||
		normalized === "YMD"
	) {
		return "YMD";
	}
	if (normalized === "MMDDYYYY" || normalized === "MDY") {
		return "MDY";
	}
	if (normalized === "DDMMYYYY" || normalized === "DMY") {
		return "DMY";
	}

	return undefined;
}

function inferLatestTransactionDate(
	transactions: Array<{ date: string }>,
): string | undefined {
	let latestDate: string | undefined;

	for (const transaction of transactions) {
		if (latestDate === undefined || transaction.date > latestDate) {
			latestDate = transaction.date;
		}
	}

	return latestDate;
}

function mapCsvFormatForPayload(
	format: ReconcileAccountRequest["csv_format"] | undefined,
):
	| {
			delimiter: string;
			decimal_separator: string;
			thousands_separator: string | null;
			date_format: string;
			header_row: boolean;
			date_column: string | null;
			amount_column: string | null;
			payee_column: string | null;
	  }
	| undefined {
	if (!format) {
		return undefined;
	}

	const coerceString = (
		value: string | number | undefined | null,
		fallback?: string,
	) => {
		if (value === undefined || value === null) {
			return fallback ?? null;
		}
		return String(value);
	};

	const delimiter = coerceString(format.delimiter, ",");
	const decimalSeparator = "."; // Default decimal separator
	const thousandsSeparator = ","; // Default thousands separator
	const dateFormat = coerceString(format.date_format, "MM/DD/YYYY");

	return {
		delimiter: delimiter ?? ",",
		decimal_separator: decimalSeparator,
		thousands_separator: thousandsSeparator,
		date_format: dateFormat ?? "MM/DD/YYYY",
		header_row: format.has_header ?? true,
		date_column: coerceString(format.date_column, "") ?? null,
		amount_column: coerceString(format.amount_column, "") ?? null,
		payee_column: coerceString(format.description_column, "") ?? null,
	};
}

function fallbackSinceDate(): Date {
	const date = new Date();
	date.setDate(date.getDate() - 90);
	return date;
}

function inferSinceDateFromTransactions(transactions: BankTransaction[]): Date {
	if (transactions.length === 0) {
		return fallbackSinceDate();
	}

	const timestamps = transactions
		.map((t) => new Date(t.date).getTime())
		.filter((time) => !Number.isNaN(time));

	if (timestamps.length === 0) {
		return fallbackSinceDate();
	}

	const minDate = new Date(Math.min(...timestamps));
	minDate.setDate(minDate.getDate() - 7); // Add a small buffer
	return minDate;
}
