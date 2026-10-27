import { toMoneyValue } from "../../utils/money.js";
import { toTransactionOutput } from "../transactionModel.js";
import type { ExecutionResult } from "./executor.js";
import {
	formatHumanReadableReport,
	type ReportFormatterOptions,
} from "./reportFormatter.js";
import type { ReconciliationAnalysis, TransactionMatch } from "./types.js";

export interface AdapterOptions extends ReportFormatterOptions {
	csvFormat?: Record<string, unknown>;
	auditMetadata?: Record<string, unknown>;
	maxSuggestionsInOutput?: number;
}

/** One public result, shared by the human report and the structured response. */
export function buildReconciliationPayload(
	analysis: ReconciliationAnalysis,
	options: AdapterOptions = {},
	execution?: ExecutionResult,
) {
	const currency = options.currencyCode ?? "USD";
	const bankView = (
		transaction: ReconciliationAnalysis["unmatched_bank"][number],
	) => ({
		...transaction,
		amount_money: toMoneyValue(transaction.amount, currency),
	});
	const ynabView = (
		transaction: ReconciliationAnalysis["unmatched_ynab"][number],
	) => ({
		...transaction,
		amount_money: toMoneyValue(transaction.amount, currency),
	});
	const matchView = (match: TransactionMatch) => ({
		bank_transaction: bankView(match.bankTransaction),
		...(match.ynabTransaction
			? { ynab_transaction: ynabView(match.ynabTransaction) }
			: {}),
		...(match.candidates
			? {
					candidates: match.candidates.map((candidate) => ({
						...candidate,
						ynab_transaction: ynabView(candidate.ynab_transaction),
					})),
				}
			: {}),
		confidence: match.confidence,
		confidence_score: match.confidenceScore,
		match_reason: match.matchReason,
		...(match.topConfidence !== undefined
			? { top_confidence: match.topConfidence }
			: {}),
		...(match.actionHint ? { action_hint: match.actionHint } : {}),
		...(match.recommendation ? { recommendation: match.recommendation } : {}),
	});
	const executionSummary = execution
		? {
				transactions_created: execution.summary.transactions_created,
				transactions_updated: execution.summary.transactions_updated,
				dates_adjusted: execution.summary.dates_adjusted,
				dry_run: execution.summary.dry_run,
				balance_status:
					execution.balance_reconciliation?.status ?? ("not_verified" as const),
				recommendations: execution.recommendations,
			}
		: undefined;
	return {
		human: formatHumanReadableReport(
			analysis,
			{
				...options,
				maxUnmatchedToShow: options.maxSuggestionsInOutput,
				includeDetailedMatches: false,
			},
			execution,
		),
		structured: {
			unmatched_bank: analysis.unmatched_bank.map(bankView),
			unmatched_ynab: analysis.unmatched_ynab.map(ynabView),
			suggestions: analysis.suggested_matches.map(matchView),
			...(executionSummary
				? {
						execution_summary: executionSummary,
						operations: (execution?.operation_results ?? []).map((result) => ({
							...result,
							operation: {
								...result.operation,
								payload: toTransactionOutput(result.operation.payload),
							},
						})),
						errors: execution?.errors ?? [],
					}
				: {}),
		},
	};
}
