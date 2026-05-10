import {
	type MoneyValue,
	toMoneyValue,
	toMoneyValueFromDecimal,
} from "../../utils/money.js";
import type {
	AccountSnapshot,
	LegacyReconciliationResult,
} from "./executor.js";
import {
	formatHumanReadableReport,
	type ReportFormatterOptions,
} from "./reportFormatter.js";
import type {
	BankTransaction,
	MatchConfidence,
	ReconciliationAnalysis,
	ReconciliationInsight,
	TransactionMatch,
	YNABTransaction,
} from "./types.js";

const OUTPUT_VERSION = "2.0";
const SCHEMA_URL =
	"https://raw.githubusercontent.com/dizzlkheinz/ynab-mcp-mcpb/master/docs/schemas/reconciliation-v2.json";

interface AdapterOptions {
	accountName?: string;
	accountId?: string;
	accountIsLiability?: boolean;
	currencyCode?: string;
	csvFormat?: CsvFormatPayload;
	auditMetadata?: Record<string, unknown>;
	notes?: string[];
	maxSuggestionsInOutput?: number | undefined;
}

export interface StructuredBankTransactionView {
	[key: string]: unknown;
	id: string;
	date: string;
	amount: number;
	payee: string;
	memo?: string | undefined;
	sourceRow: number;
	raw: {
		date: string;
		amount: string;
		description: string;
	};
	warnings?: string[] | undefined;
	amount_money: MoneyValue;
}

export interface StructuredYNABTransactionView {
	[key: string]: unknown;
	id: string;
	date: string;
	amount: number;
	payee: string | null;
	memo: string | null;
	categoryName: string | null;
	cleared: "cleared" | "uncleared" | "reconciled";
	approved: boolean;
	amount_money: MoneyValue;
}

interface StructuredMatchCandidateView {
	[key: string]: unknown;
	ynab_transaction: StructuredYNABTransactionView;
	confidence: number;
	match_reason: string;
	explanation: string;
}

export interface StructuredTransactionMatchView {
	[key: string]: unknown;
	bank_transaction: StructuredBankTransactionView;
	ynab_transaction?: StructuredYNABTransactionView | undefined;
	candidates?: StructuredMatchCandidateView[] | undefined;
	confidence: MatchConfidence;
	confidence_score: number;
	match_reason: string;
	top_confidence?: number | undefined;
	action_hint?: string | undefined;
	recommendation?: string | undefined;
}

export interface StructuredReconciliationPayload {
	matches: {
		auto: StructuredTransactionMatchView[];
		suggested: StructuredTransactionMatchView[];
	};
	unmatched: {
		bank: StructuredBankTransactionView[];
		ynab: StructuredYNABTransactionView[];
		ynab_outside_date_range: StructuredYNABTransactionView[];
	};
	[key: string]: unknown;
}

export interface DualChannelPayload {
	human: string;
	structured: StructuredReconciliationPayload;
}

interface CsvFormatPayload {
	delimiter: string;
	decimal_separator: string;
	thousands_separator: string | null;
	date_format: string;
	header_row: boolean;
	date_column: string | null;
	amount_column: string | null;
	payee_column: string | null;
}

interface LegacyPrecisionCalculations {
	bank_statement_balance_milliunits: number;
	ynab_calculated_balance_milliunits: number;
	discrepancy_milliunits: number;
	discrepancy_dollars: number;
	currency_decimal_digits?: number;
}

interface LegacyLikelyCause {
	cause_type: string;
	description: string;
	confidence: number;
	amount_milliunits: number;
	suggested_resolution: string;
	evidence: unknown[];
}

interface LegacyBalanceReconciliation {
	status: string;
	precision_calculations?: LegacyPrecisionCalculations;
	discrepancy_analysis?:
		| {
				confidence_level: number;
				likely_causes: LegacyLikelyCause[];
				risk_assessment: string;
		  }
		| undefined;
	final_verification?: {
		balance_matches_exactly: boolean;
		all_transactions_accounted: boolean;
		audit_trail_complete: boolean;
		reconciliation_complete: boolean;
	};
}

type LegacyBalanceReconciliationView = {
	status: string;
	precision_calculations?: ReturnType<typeof convertPrecisionCalculations>;
	discrepancy_analysis?: ReturnType<typeof convertLikelyCausesLegacy>;
	final_verification?: LegacyBalanceReconciliation["final_verification"];
};

const toBankTransactionView = (txn: BankTransaction, currency: string) => ({
	...txn,
	amount_money: toMoneyValue(txn.amount, currency),
});

const toYNABTransactionView = (txn: YNABTransaction, currency: string) => ({
	...txn,
	amount_money: toMoneyValue(txn.amount, currency),
});

const convertMatch = (match: TransactionMatch, currency: string) => ({
	bank_transaction: toBankTransactionView(match.bankTransaction, currency),
	ynab_transaction: match.ynabTransaction
		? toYNABTransactionView(match.ynabTransaction, currency)
		: undefined,
	candidates: match.candidates?.map((candidate) => ({
		...candidate,
		ynab_transaction: toYNABTransactionView(
			candidate.ynab_transaction,
			currency,
		),
	})),
	confidence: match.confidence,
	confidence_score: match.confidenceScore,
	match_reason: match.matchReason,
	top_confidence: match.topConfidence,
	action_hint: match.actionHint,
	recommendation: match.recommendation,
});

const convertInsight = (insight: ReconciliationInsight) => ({
	id: insight.id,
	type: insight.type,
	severity: insight.severity,
	title: insight.title,
	description: insight.description,
	evidence: insight.evidence ?? {},
});

const convertSummary = (analysis: ReconciliationAnalysis) => ({
	statement_date_range: analysis.summary.statement_date_range,
	bank_transactions_count: analysis.summary.bank_transactions_count,
	ynab_transactions_count: analysis.summary.ynab_transactions_count,
	ynab_in_range_count:
		analysis.summary.ynab_in_range_count ??
		analysis.summary.ynab_transactions_count,
	ynab_outside_range_count: analysis.summary.ynab_outside_range_count ?? 0,
	auto_matched: analysis.summary.auto_matched,
	suggested_matches: analysis.summary.suggested_matches,
	unmatched_bank: analysis.summary.unmatched_bank,
	unmatched_ynab: analysis.summary.unmatched_ynab,
	current_cleared_balance: analysis.summary.current_cleared_balance,
	target_statement_balance: analysis.summary.target_statement_balance,
	discrepancy: analysis.summary.discrepancy,
	discrepancy_explanation: analysis.summary.discrepancy_explanation,
});

const convertBalanceInfo = (analysis: ReconciliationAnalysis) => {
	const discrepancyMilli = analysis.balance_info.discrepancy.value_milliunits;
	const direction =
		discrepancyMilli === 0
			? "balanced"
			: discrepancyMilli > 0
				? "ynab_higher"
				: "bank_higher";

	return {
		current_cleared: analysis.balance_info.current_cleared,
		current_uncleared: analysis.balance_info.current_uncleared,
		current_total: analysis.balance_info.current_total,
		target_statement: analysis.balance_info.target_statement,
		discrepancy: analysis.balance_info.discrepancy,
		discrepancy_direction: direction,
		on_track: analysis.balance_info.on_track,
	};
};

const convertAccountSnapshot = (
	snapshot: AccountSnapshot,
	currency: string,
) => ({
	balance: toMoneyValue(snapshot.balance, currency),
	cleared_balance: toMoneyValue(snapshot.cleared_balance, currency),
	uncleared_balance: toMoneyValue(snapshot.uncleared_balance, currency),
});

const convertPrecisionCalculations = (
	precision: LegacyPrecisionCalculations,
	currency: string,
) => {
	const decimalDigits = precision.currency_decimal_digits ?? 2;
	return {
		bank_statement_balance: toMoneyValue(
			precision.bank_statement_balance_milliunits,
			currency,
			decimalDigits,
		),
		ynab_calculated_balance: toMoneyValue(
			precision.ynab_calculated_balance_milliunits,
			currency,
			decimalDigits,
		),
		discrepancy: toMoneyValue(
			precision.discrepancy_milliunits,
			currency,
			decimalDigits,
		),
		discrepancy_decimal: toMoneyValueFromDecimal(
			precision.discrepancy_dollars,
			currency,
			decimalDigits,
		),
	};
};

const convertLikelyCausesLegacy = (
	analysis: NonNullable<LegacyBalanceReconciliation["discrepancy_analysis"]>,
	currency: string,
) => ({
	confidence_level: analysis.confidence_level,
	risk_assessment: analysis.risk_assessment,
	likely_causes: analysis.likely_causes.map((cause) => ({
		type: cause.cause_type.toLowerCase(),
		description: cause.description,
		confidence: cause.confidence,
		suggested_action: cause.suggested_resolution,
		amount: toMoneyValue(cause.amount_milliunits, currency),
		evidence: cause.evidence,
	})),
});

const convertBalanceReconciliationLegacy = (
	balance: LegacyBalanceReconciliation | undefined,
	currency: string,
) => {
	if (!balance) return undefined;

	const result: LegacyBalanceReconciliationView = {
		status: balance.status,
	};

	if (balance.precision_calculations) {
		result.precision_calculations = convertPrecisionCalculations(
			balance.precision_calculations,
			currency,
		);
	}

	if (balance.discrepancy_analysis) {
		result.discrepancy_analysis = convertLikelyCausesLegacy(
			balance.discrepancy_analysis,
			currency,
		);
	}

	if (balance.final_verification) {
		result.final_verification = balance.final_verification;
	}

	return result;
};

interface ConvertedExecutionResult {
	summary: LegacyReconciliationResult["summary"];
	account_balance: {
		before: ReturnType<typeof convertAccountSnapshot>;
		after: ReturnType<typeof convertAccountSnapshot>;
	};
	actions_taken: LegacyReconciliationResult["actions_taken"];
	recommendations: LegacyReconciliationResult["recommendations"];
	balance_reconciliation?: ReturnType<
		typeof convertBalanceReconciliationLegacy
	>;
	bulk_operation_details?: LegacyReconciliationResult["bulk_operation_details"];
}

const convertExecution = (
	execution: LegacyReconciliationResult,
	currency: string,
): ConvertedExecutionResult => {
	const result: ConvertedExecutionResult = {
		summary: execution.summary,
		account_balance: {
			before: convertAccountSnapshot(
				execution.account_balance.before,
				currency,
			),
			after: convertAccountSnapshot(execution.account_balance.after, currency),
		},
		actions_taken: execution.actions_taken,
		recommendations: execution.recommendations,
	};

	if (execution.balance_reconciliation) {
		result.balance_reconciliation = convertBalanceReconciliationLegacy(
			execution.balance_reconciliation,
			currency,
		);
	}

	if (execution.bulk_operation_details) {
		result.bulk_operation_details = execution.bulk_operation_details;
	}

	return result;
};

/**
 * Build human-readable narrative using the comprehensive report formatter
 */
const buildHumanNarrative = (
	analysis: ReconciliationAnalysis,
	options: AdapterOptions,
	execution?: LegacyReconciliationResult,
): string => {
	const formatterOptions: ReportFormatterOptions = {
		accountName: options.accountName,
		accountId: options.accountId,
		accountIsLiability: options.accountIsLiability,
		currencyCode: options.currencyCode,
		includeDetailedMatches: false,
		maxUnmatchedToShow: options.maxSuggestionsInOutput,
		maxInsightsToShow: 3,
		notes: options.notes,
	};

	return formatHumanReadableReport(analysis, formatterOptions, execution);
};

export const buildReconciliationPayload = (
	analysis: ReconciliationAnalysis,
	options: AdapterOptions = {},
	execution?: LegacyReconciliationResult,
): DualChannelPayload => {
	const currency = options.currencyCode ?? "USD";
	const executionView = execution
		? convertExecution(execution, currency)
		: undefined;

	const structured: StructuredReconciliationPayload = {
		version: OUTPUT_VERSION,
		schema_url: SCHEMA_URL,
		generated_at: new Date().toISOString(),
		account: {
			id: options.accountId,
			name: options.accountName,
		},
		summary: convertSummary(analysis),
		balance: convertBalanceInfo(analysis),
		insights: analysis.insights.map(convertInsight),
		next_steps: analysis.next_steps,
		matches: {
			auto: analysis.auto_matches.map((match) => convertMatch(match, currency)),
			suggested: analysis.suggested_matches.map((match) =>
				convertMatch(match, currency),
			),
		},
		unmatched: {
			bank: analysis.unmatched_bank.map((txn) =>
				toBankTransactionView(txn, currency),
			),
			ynab: analysis.unmatched_ynab.map((txn) =>
				toYNABTransactionView(txn, currency),
			),
			ynab_outside_date_range: (analysis.ynab_outside_date_range ?? []).map(
				(txn) => toYNABTransactionView(txn, currency),
			),
		},
	};

	// Include recommendations if available, enriching bank_transaction with amount_money
	if (analysis.recommendations && analysis.recommendations.length > 0) {
		structured["recommendations"] = analysis.recommendations.map((rec) => {
			if (
				rec.action_type === "review_duplicate" &&
				rec.parameters.bank_transaction
			) {
				return {
					...rec,
					parameters: {
						...rec.parameters,
						bank_transaction: toBankTransactionView(
							rec.parameters.bank_transaction,
							currency,
						),
					},
				};
			}
			return rec;
		});
	}

	if (options.csvFormat) {
		structured["csv_format"] = options.csvFormat;
	}

	if (executionView) {
		structured["execution"] = executionView;
	}

	if (options.auditMetadata) {
		structured["audit"] = options.auditMetadata;
	}

	return {
		human: buildHumanNarrative(analysis, options, execution),
		structured,
	};
};
