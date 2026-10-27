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
import type {
	ProgressCallback,
	ToolExecutionContext,
} from "../../server/toolRegistry.js";
import { withToolErrorHandling } from "../../types/index.js";
import type { ReadDeps, ToolFactory } from "../../types/toolRegistration.js";
import { getBudgetByIdCompat } from "../../utils/ynabApiCompat.js";
import {
	createAdapters,
	createBudgetResolver,
	requireResolvedBudgetId,
} from "../adapters.js";
import {
	CompareTransactionsSchema,
	handleCompareTransactions,
} from "../compareTransactions/index.js";
import { resolveCsvPathCandidates } from "../csvFilePath.js";
import { optionalDateSchema } from "../schemas/common.js";
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
	type ExecutionOptions,
	type ExecutionResult,
	executeReconciliationPlan,
} from "./executor.js";
import type { MatchingConfig } from "./matcher.js";
import { buildReconciliationPayload } from "./outputBuilder.js";
import { buildReconciliationPlan, freezeSnapshot } from "./plan.js";
import { detectSignInversion } from "./signDetector.js";
import {
	clampCSVToStatementWindow,
	formatStatementWindow,
} from "./statementWindow.js";
import type { BankTransaction } from "./types.js";
import { normalizeYNABTransactions } from "./ynabAdapter.js";

/**
 * Schema for reconcile_account tool
 */
export const ReconcileAccountSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
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
		statement_end_date: optionalDateSchema,

		// Matching configuration (optional)
		date_tolerance_days: z.number().min(0).max(7).optional().default(7),
		match_strictness: z
			.enum(["loose", "normal", "strict"])
			.optional()
			.default("normal"),

		auto_create_transactions: z.boolean().optional().default(false),
		auto_update_cleared_status: z.boolean().optional().default(false),
		auto_unclear_missing: z.boolean().optional().default(false),
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
	.strict()
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
	params: ReconcileAccountRequest,
	deps: ReadDeps,
	sendProgress?: ProgressCallback,
	errorHandler?: ErrorHandler,
	prepareExecution?: ToolExecutionContext["prepareExecution"],
): Promise<CallToolResult> {
	const deltaFetcher = deps.deltaFetcher;
	return await withToolErrorHandling(
		async () => {
			const budgetId = requireResolvedBudgetId(params.budget_id);
			const config = buildMatchingConfig(params);

			const accountResult = await deltaFetcher.fetchAccountsFull(budgetId);
			const accountData = accountResult.data.find(
				(account) => account.id === params.account_id,
			);
			if (!accountData) {
				throw new Error(
					`Account ${params.account_id} not found in budget ${budgetId}`,
				);
			}
			const accountName = accountData.name;
			const accountIsLiability = LIABILITY_ACCOUNT_TYPES.has(accountData.type);

			// Default inversion assumption: liability accounts typically show charges as positive
			const shouldInvertBankAmounts = accountIsLiability;

			// Preserve the caller-provided statement balance sign. Liability accounts
			// usually use negative balances in YNAB, but credit-balance statements can be positive.
			const adjustedStatementBalance = params.statement_balance;

			const { currencyCode, decimalDigits } = await getCurrencySettings(
				ynabAPI,
				budgetId,
			);

			const narrativeNotes: string[] = [];
			const csvOptions = buildCsvParseOptions(params.csv_format);
			const csvContent = await loadCsvContent(params, narrativeNotes);

			// Initial parse without inversion for date window + sign detection
			const parsedCsv = parseCsvOrThrow(csvContent, csvOptions);
			const statementWindowEnd = params.statement_end_date || undefined;
			const rawCsvResult = applyStatementWindow(
				parsedCsv,
				statementWindowEnd,
				narrativeNotes,
			);

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

			// Fetch the full account once so statement balances and snapshot checks agree.
			const transactionsResult =
				await deltaFetcher.fetchTransactionsByAccountFull(
					budgetId,
					params.account_id,
				);

			const ynabTransactions = transactionsResult.data;
			const normalizedYNAB = normalizeYNABTransactions(ynabTransactions);

			// Determine sign inversion: explicit override or auto-detect
			const finalInvertAmounts = resolveSignInversion(
				params.sign_convention ?? "auto",
				shouldInvertBankAmounts,
				rawCsvResult.transactions,
				normalizedYNAB,
				narrativeNotes,
			);

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

			const initialAccount: AccountSnapshot = {
				balance: accountData.balance,
				cleared_balance: accountData.cleared_balance,
				uncleared_balance: accountData.uncleared_balance,
			};

			const statementTransactions = ynabTransactions.filter(
				(transaction) =>
					!transaction.deleted &&
					(!effectiveStatementEndDate ||
						transaction.date <= effectiveStatementEndDate),
			);
			const statementClearedBalanceMilli = statementTransactions
				.filter((transaction) => transaction.cleared !== "uncleared")
				.reduce((total, transaction) => total + transaction.amount, 0);
			const statementUnclearedBalanceMilli = statementTransactions
				.filter((transaction) => transaction.cleared === "uncleared")
				.reduce((total, transaction) => total + transaction.amount, 0);
			const statementAccount = {
				balance: statementClearedBalanceMilli + statementUnclearedBalanceMilli,
				cleared_balance: statementClearedBalanceMilli,
				uncleared_balance: statementUnclearedBalanceMilli,
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
				budgetId,
				finalInvertAmounts, // Use smart-detected value
				csvOptions,
				statementAccount,
				effectiveStatementEndDate,
			);

			const effectiveParams =
				effectiveStatementEndDate !== params.statement_end_date
					? {
							...params,
							statement_end_date: effectiveStatementEndDate,
						}
					: params;

			const captured = freezeSnapshot(
				structuredClone({ analysis, params: effectiveParams, initialAccount }),
			);
			const executionOptions: ExecutionOptions = {
				ynabAPI,
				...captured,
				budgetId,
				accountId: params.account_id,
				currencyCode,
				decimalDigits,
				sourceTransactions: ynabTransactions,
				statementClearedBalanceMilli,
			};
			const plan = buildReconciliationPlan(executionOptions);

			const adapterOptions: Parameters<typeof buildReconciliationPayload>[1] = {
				accountName,
				accountId: params.account_id,
				accountIsLiability,
				currencyCode,
				maxSuggestionsInOutput: params.max_suggestions_in_output,
			};
			if (narrativeNotes.length > 0) {
				adapterOptions.notes = narrativeNotes;
			}

			const renderExecution = async (
				dryRun: boolean,
				progress?: ProgressCallback,
			) => {
				const execution = await executeReconciliationPlan(plan, {
					...executionOptions,
					params: { ...captured.params, dry_run: dryRun },
					...(progress ? { sendProgress: progress } : {}),
				});
				return renderReconciliationResult(
					captured.analysis,
					adapterOptions,
					execution,
				);
			};
			prepareExecution?.((executionContext) =>
				withToolErrorHandling(
					() => renderExecution(false, executionContext.sendProgress),
					"ynab:reconcile_account",
					"executing prepared reconciliation",
					errorHandler,
				),
			);
			return renderExecution(params.dry_run, sendProgress);
		},
		"ynab:reconcile_account",
		"analyzing account reconciliation",
		errorHandler,
	);
}

function renderReconciliationResult(
	analysis: Parameters<typeof buildReconciliationPayload>[0],
	adapterOptions: Parameters<typeof buildReconciliationPayload>[1],
	executionData: ExecutionResult,
): CallToolResult {
	const responseData = buildReconciliationPayload(
		analysis,
		adapterOptions,
		executionData,
	);
	return {
		...(executionData.errors?.length ? { isError: true } : {}),
		content: [{ type: "text", text: responseFormatter.format(responseData) }],
		structuredContent: responseData,
	};
}

/**
 * Registers reconciliation-domain tools (compare + reconcile) with the registry.
 */
export const registerReconciliationTools: ToolFactory = (registry, context) => {
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
  - auto_unclear_missing (boolean, optional): Auto-mark statement-missing cleared transactions as uncleared when reconciliation remains unbalanced. Default: false.
  - max_suggestions_in_output (number, optional): Limit unmatched items and suggestions shown in the human report. Default: 20.

Returns: human-readable reconciliation narrative + structured JSON (unmatched_bank, unmatched_ynab, suggestions, execution_summary when actions are performed).

Examples:
  - Preview reconciliation: set dry_run=true (default)
  - Execute: set dry_run=false and explicitly enable the write flags you want, e.g. auto_update_cleared_status=true`,
		inputSchema: ReconcileAccountSchema,
		outputSchema: ReconcileAccountOutputSchema,
		handler: ({ input, context: executionContext }) =>
			handleReconcileAccount(
				context.ynabAPI,
				input,
				{
					deltaFetcher: context.deltaFetcher,
					cacheManager: context.cacheManager,
				},
				executionContext.sendProgress,
				context.errorHandler,
				executionContext.prepareExecution,
			),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof ReconcileAccountSchema>>(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run", prepared: true },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
				title: "YNAB: Reconcile Account",
			},
		},
	});
};

// Derive matching thresholds from match_strictness
const STRICTNESS_THRESHOLDS = {
	loose: { autoMatch: 70, suggested: 55 },
	normal: { autoMatch: 85, suggested: 60 },
	strict: { autoMatch: 93, suggested: 75 },
} as const;

const LIABILITY_ACCOUNT_TYPES: ReadonlySet<ynab.AccountType> =
	new Set<ynab.AccountType>([
		"creditCard",
		"lineOfCredit",
		"mortgage",
		"autoLoan",
		"studentLoan",
		"personalLoan",
		"medicalDebt",
		"otherDebt",
		"otherLiability",
	]);

type SignConvention = "auto" | "invert" | "as_is";

/**
 * Build matching configuration from parameters (V2 Format)
 */
function buildMatchingConfig(params: ReconcileAccountRequest): MatchingConfig {
	const strictness = params.match_strictness ?? "normal";
	const { autoMatch: autoMatchThreshold, suggested: suggestionThreshold } =
		STRICTNESS_THRESHOLDS[strictness];

	return {
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
}

async function getCurrencySettings(
	ynabAPI: ynab.API,
	budgetId: string,
): Promise<{ currencyCode: string; decimalDigits: number }> {
	const budget = await getBudgetByIdCompat(ynabAPI, budgetId);
	const currencyFormat = budget.currency_format as
		| { iso_code?: string; decimal_digits?: number }
		| undefined;
	return {
		currencyCode: currencyFormat?.iso_code ?? "USD",
		decimalDigits: currencyFormat?.decimal_digits ?? 2,
	};
}

/**
 * Prepare CSV parsing options from request
 */
function buildCsvParseOptions(
	csvFormat: ReconcileAccountRequest["csv_format"],
): ParseCSVOptions {
	const dateFormat = mapCsvDateFormatToHint(csvFormat?.date_format);
	return {
		columns: {
			...(csvFormat?.date_column !== undefined && {
				date: String(csvFormat.date_column),
			}),
			...(csvFormat?.amount_column !== undefined && {
				amount: String(csvFormat.amount_column),
			}),
			...(csvFormat?.debit_column !== undefined && {
				debit: String(csvFormat.debit_column),
			}),
			...(csvFormat?.credit_column !== undefined && {
				credit: String(csvFormat.credit_column),
			}),
			...(csvFormat?.description_column !== undefined && {
				description: String(csvFormat.description_column),
			}),
		},
		...(dateFormat && { dateFormat }),
		...(csvFormat?.has_header !== undefined && {
			header: csvFormat.has_header,
		}),
		...(csvFormat?.delimiter !== undefined && {
			delimiter: csvFormat.delimiter,
		}),
	};
}

/**
 * Load CSV content from either inline data or filesystem path
 */
async function loadCsvContent(
	params: ReconcileAccountRequest,
	narrativeNotes: string[],
): Promise<string> {
	let csvContent = params.csv_data ?? "";
	if (!csvContent && params.csv_file_path) {
		csvContent = await readCsvFromPath(params.csv_file_path, narrativeNotes);
	}

	if (!csvContent.trim()) {
		throw new Error("CSV content is empty after reading the provided source.");
	}

	return csvContent;
}

/**
 * Read errors meaning nothing usable exists at a path. Translated candidate
 * paths (sandbox or WSL forms) often fail this way on the host, and those
 * failures must not hide the real error for the path the user gave.
 */
const MISSING_PATH_ERROR_CODES = new Set([
	"ENOENT",
	"ENOTDIR",
	"EINVAL",
	"ENAMETOOLONG",
]);

async function readCsvFromPath(
	csvFilePath: string,
	narrativeNotes: string[],
): Promise<string> {
	const pathCandidates = resolveCsvPathCandidates(csvFilePath);
	// The user's own path is the first candidate, so its error is the one to
	// report when nothing exists at any candidate.
	let firstReadError: unknown;
	// A candidate that exists but can't be read (EACCES, EISDIR, ...) matters
	// more than an empty candidate, so it must not be masked by one.
	let lastAccessError: unknown;
	let foundEmptyFile = false;

	for (const candidatePath of pathCandidates) {
		try {
			const csvContent = await fs.readFile(candidatePath, "utf8");
			if (!csvContent.trim()) {
				// Keep looking: another candidate may hold the real CSV
				foundEmptyFile = true;
				continue;
			}
			if (candidatePath !== csvFilePath) {
				narrativeNotes.push(
					`Read CSV using normalized path "${candidatePath}" from "${csvFilePath}".`,
				);
			}
			return csvContent;
		} catch (error) {
			firstReadError ??= error;
			const code = (error as NodeJS.ErrnoException).code;
			if (code === undefined || !MISSING_PATH_ERROR_CODES.has(code)) {
				lastAccessError = error;
			}
		}
	}

	if (foundEmptyFile && lastAccessError === undefined) {
		// The caller reports empty CSV content
		return "";
	}

	const reportedError = lastAccessError ?? firstReadError;
	const attemptedPaths =
		pathCandidates.length > 0 ? pathCandidates.join(", ") : csvFilePath;
	const message =
		reportedError instanceof Error && reportedError.message
			? reportedError.message
			: "Unknown error while reading CSV file";
	const emptyNote = foundEmptyFile
		? " Other candidate path(s) were empty."
		: "";
	throw new Error(
		`Failed to read CSV file. Tried path(s): ${attemptedPaths}. ${message}.${emptyNote} If this path is from another runtime (for example an uploaded sandbox file), pass the CSV via csv_data instead.`,
	);
}

function parseCsvOrThrow(
	csvContent: string,
	csvOptions: ParseCSVOptions,
): CSVParseResult {
	try {
		const result = parseCSV(csvContent, {
			...csvOptions,
			invertAmounts: false,
		});
		if (result.errors.length) {
			throw new Error(
				result.errors
					.map((error) => `Row ${error.row}: ${error.message}`)
					.join("; "),
			);
		}
		return result;
	} catch (error) {
		const message =
			error instanceof Error && error.message
				? error.message
				: "Unknown error while parsing CSV";
		throw new Error(`Failed to parse CSV data: ${message}`);
	}
}

/**
 * Drop CSV transactions outside the statement window, failing when none remain
 */
function applyStatementWindow(
	parseResult: CSVParseResult,
	statementWindowEnd: string | undefined,
	narrativeNotes: string[],
): CSVParseResult {
	const statementWindowBounds = {
		...(statementWindowEnd !== undefined && {
			endDate: statementWindowEnd,
		}),
	};
	const clampedCsv = clampCSVToStatementWindow(
		parseResult,
		statementWindowBounds,
	);
	if (clampedCsv.excludedCount > 0) {
		narrativeNotes.push(
			`Filtered ${clampedCsv.excludedCount} CSV transaction(s) outside statement window ${formatStatementWindow(statementWindowBounds)}.`,
		);
	}

	if (
		clampedCsv.windowApplied &&
		clampedCsv.parseResult.transactions.length === 0
	) {
		throw new Error(
			`No CSV transactions remain after applying statement window ${formatStatementWindow(clampedCsv.windowApplied)}.`,
		);
	}

	return clampedCsv.parseResult;
}

/**
 * Decide whether bank amounts must be negated: explicit sign_convention wins;
 * "auto" detects from data and falls back to the account-type default.
 */
function resolveSignInversion(
	signConvention: SignConvention,
	defaultInvert: boolean,
	bankTransactions: BankTransaction[],
	normalizedYNAB: ReturnType<typeof normalizeYNABTransactions>,
	narrativeNotes: string[],
): boolean {
	if (signConvention === "invert") {
		narrativeNotes.push(
			"Using explicit sign_convention=invert; bank amounts will be negated.",
		);
		return true;
	}
	if (signConvention === "as_is") {
		narrativeNotes.push(
			"Using explicit sign_convention=as_is; bank amounts used as-is.",
		);
		return false;
	}

	if (bankTransactions.length === 0 || normalizedYNAB.length === 0) {
		return defaultInvert;
	}

	const needsInversion = detectSignInversion(bankTransactions, normalizedYNAB);
	if (needsInversion === null) {
		return defaultInvert;
	}

	if (needsInversion !== defaultInvert) {
		narrativeNotes.push(
			needsInversion
				? "Detected bank CSV amounts opposite YNAB; inverting bank amounts for matching."
				: "Detected bank CSV amounts already align with YNAB; using CSV amounts as-is.",
		);
	}
	return needsInversion;
}

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
