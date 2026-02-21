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
import { buildReconciliationPayload } from "./outputBuilder.js";
import { detectSignInversion } from "./signDetector.js";
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
 * Helper function to determine audit data source based on fetch result
 */
function getAuditDataSource(
	transactionsResult: { usedDelta?: boolean; wasCached?: boolean },
	forceFullRefresh: boolean,
): string {
	if (forceFullRefresh) {
		return "full_api_fetch_no_delta";
	}
	if (transactionsResult.usedDelta) {
		return "delta_fetch_with_merge";
	}
	if (transactionsResult.wasCached) {
		return "delta_fetch_cache_hit";
	}
	return "delta_fetch_full_refresh";
}

/**
 * Helper function to determine data freshness based on fetch result
 */
function getDataFreshness(
	transactionsResult: { wasCached?: boolean },
	forceFullRefresh: boolean,
): string {
	if (forceFullRefresh) {
		return "guaranteed_fresh";
	}
	if (transactionsResult.wasCached) {
		return "cache_validated_via_server_knowledge";
	}
	return "fresh_via_delta_fetch";
}

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
		statement_start_date: z.string().optional(),
		statement_end_date: z.string().optional(),
		statement_date: z.string().optional(),
		expected_bank_balance: z.number().optional(),
		as_of_timezone: z.string().optional(),

		// Matching configuration (optional)
		date_tolerance_days: z.number().min(0).max(7).optional().default(7),
		auto_match_threshold: z.number().min(0).max(100).optional().default(85),
		suggestion_threshold: z.number().min(0).max(100).optional().default(60),

		auto_create_transactions: z.boolean().optional().default(false),
		auto_update_cleared_status: z.boolean().optional().default(false),
		auto_unclear_missing: z.boolean().optional().default(true),
		auto_adjust_dates: z.boolean().optional().default(false),
		invert_bank_amounts: z.boolean().optional(),
		dry_run: z.boolean().optional().default(true),
		// Response options
		include_structured_data: z.boolean().optional().default(false),
		force_full_refresh: z.boolean().optional().default(true),
	})
	.refine((data) => data.csv_file_path || data.csv_data, {
		message: "Either csv_file_path or csv_data must be provided",
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
	const forceFullRefresh = params.force_full_refresh ?? true;
	return await withToolErrorHandling(
		async () => {
			// Build matching configuration from parameters (V2 Format)
			const config: MatchingConfig = {
				weights: {
					date: 0.15,
					payee: 0.35,
				},
				dateToleranceDays: params.date_tolerance_days ?? 7,
				autoMatchThreshold: params.auto_match_threshold ?? 85,
				suggestedMatchThreshold: params.suggestion_threshold ?? 60,
				minimumCandidateScore: 40,
				exactDateBonus: 5,
				exactPayeeBonus: 10,
			};

			const accountResult = forceFullRefresh
				? await deltaFetcher.fetchAccountsFull(params.budget_id)
				: await deltaFetcher.fetchAccounts(params.budget_id);
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

			// Determine whether to invert bank amounts
			// If invert_bank_amounts is explicitly set, use that value
			// Otherwise, default to true for liability accounts (legacy behavior)
			// Note: Some banks (e.g., Wealthsimple) show charges as negative already, matching YNAB
			const shouldInvertBankAmounts =
				params.invert_bank_amounts !== undefined
					? params.invert_bank_amounts
					: accountIsLiability;

			// Negate statement balance for liability accounts
			const adjustedStatementBalance = accountIsLiability
				? -Math.abs(params.statement_balance)
				: params.statement_balance;

			const budgetResponse = await ynabAPI.budgets.getBudgetById(
				params.budget_id,
			);
			const currencyCode =
				budgetResponse.data.budget?.currency_format?.iso_code ?? "USD";

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
				try {
					csvContent = await fs.readFile(params.csv_file_path, "utf8");
				} catch (error) {
					const message =
						error instanceof Error && error.message
							? error.message
							: "Unknown error while reading CSV file";
					throw new Error(
						`Failed to read CSV file at path ${params.csv_file_path}: ${message}`,
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

			// Fetch YNAB transactions for the account using inferred date window
			let sinceDate: Date;
			let dateWindowSource:
				| "statement_start_date"
				| "csv_min_date_with_buffer"
				| "fallback_90_days";

			if (params.statement_start_date) {
				sinceDate = new Date(params.statement_start_date);
				dateWindowSource = "statement_start_date";
			} else if (rawCsvResult.transactions.length > 0) {
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
			const transactionsResult = forceFullRefresh
				? await deltaFetcher.fetchTransactionsByAccountFull(
						params.budget_id,
						params.account_id,
						sinceDateString,
					)
				: await deltaFetcher.fetchTransactionsByAccount(
						params.budget_id,
						params.account_id,
						sinceDateString,
					);

			const ynabTransactions = transactionsResult.data;
			const normalizedYNAB = normalizeYNABTransactions(ynabTransactions);

			// Smart sign detection: If invert_bank_amounts not explicitly set, auto-detect
			let finalInvertAmounts = shouldInvertBankAmounts;
			if (
				params.invert_bank_amounts === undefined &&
				rawCsvResult.transactions.length > 0 &&
				normalizedYNAB.length > 0
			) {
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
				data_freshness: getDataFreshness(transactionsResult, forceFullRefresh),
				data_source: getAuditDataSource(transactionsResult, forceFullRefresh),
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

			let executionData: LegacyReconciliationResult | undefined;
			const wantsBalanceVerification = Boolean(params.statement_date);
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
					params,
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
				currencyCode,
				auditMetadata,
			};
			if (csvFormatForPayload !== undefined) {
				adapterOptions.csvFormat = csvFormatForPayload;
			}
			if (narrativeNotes.length > 0) {
				adapterOptions.notes = narrativeNotes;
			}

			const payload = buildReconciliationPayload(
				analysis,
				adapterOptions,
				executionData,
			);

			// Build response payload matching ReconcileAccountOutputSchema
			// Schema expects: { human: string } OR { human: string, structured: object }
			const responseData: Record<string, unknown> = {
				human: payload.human,
			};

			// Only include structured data if requested (can be very large)
			if (params.include_structured_data) {
				responseData["structured"] = payload.structured;
			}

			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(responseData),
					},
				],
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
		name: "compare_transactions",
		description:
			"Compare bank transactions from CSV with YNAB transactions to find missing entries",
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
		name: "reconcile_account",
		description:
			"Guided reconciliation workflow with human narrative, insight detection, and optional execution (create/update/unclear). Set include_structured_data=true to also get full JSON output (large).",
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
