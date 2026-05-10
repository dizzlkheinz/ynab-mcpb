import { toMoneyValue } from "../../utils/money.js";
import type { ReconcileAccountRequest } from "./index.js";
import type { ReconciliationAnalysis, TransactionMatch } from "./types.js";

export interface ExecutionSummary {
	bank_transactions_count: number;
	ynab_transactions_count: number;
	matches_found: number;
	missing_in_ynab: number;
	missing_in_bank: number;
	transactions_created: number;
	transactions_updated: number;
	dates_adjusted: number;
	dry_run: boolean;
}

interface UpdateFlags {
	needsClearedUpdate: boolean;
	needsDateUpdate: boolean;
}

const MONEY_EPSILON_MILLI = 100; // $0.10

export function chunkArray<T>(array: T[], size: number): T[][] {
	if (size <= 0) {
		throw new Error("chunk size must be positive");
	}
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncateMemo(memo: string | null | undefined): string {
	const MAX_MEMO_LENGTH = 500;
	if (!memo) return "Auto-reconciled from bank statement";
	if (memo.length <= MAX_MEMO_LENGTH) return memo;
	return `${memo.substring(0, MAX_MEMO_LENGTH - 3)}...`;
}

export function formatDisplay(amount: number, currency: string): string {
	return toMoneyValue(amount, currency).value_display;
}

export function computeUpdateFlags(
	match: TransactionMatch,
	params: ReconcileAccountRequest,
): UpdateFlags {
	const ynabTxn = match.ynabTransaction;
	const bankTxn = match.bankTransaction;
	if (!ynabTxn) {
		return { needsClearedUpdate: false, needsDateUpdate: false };
	}
	const needsClearedUpdate = Boolean(
		params.auto_update_cleared_status && ynabTxn.cleared === "uncleared",
	);
	const needsDateUpdate = Boolean(
		params.auto_adjust_dates && ynabTxn.date !== bankTxn.date,
	);
	return { needsClearedUpdate, needsDateUpdate };
}

export function updateReason(
	match: TransactionMatch,
	flags: UpdateFlags,
	_currency: string,
): string {
	const parts: string[] = [];
	if (flags.needsClearedUpdate) {
		parts.push("marked as cleared");
	}
	if (flags.needsDateUpdate) {
		parts.push(`date adjusted to ${match.bankTransaction.date}`);
	}
	return parts.join(", ");
}

export function buildRecommendations(args: {
	summary: ExecutionSummary;
	params: ReconcileAccountRequest;
	analysis: ReconciliationAnalysis;
	balanceChangeMilli: number;
	currencyCode: string;
}): string[] {
	const { summary, params, analysis, balanceChangeMilli, currencyCode } = args;
	const recommendations: string[] = [];

	if (summary.dates_adjusted > 0) {
		recommendations.push(
			`✅ Adjusted ${summary.dates_adjusted} transaction date(s) to match bank statement dates`,
		);
	}

	if (analysis.summary.unmatched_bank > 0 && !params.auto_create_transactions) {
		recommendations.push(
			`Consider enabling auto_create_transactions to automatically create ${analysis.summary.unmatched_bank} missing transaction(s)`,
		);
	}

	if (!params.auto_adjust_dates && analysis.auto_matches.length > 0) {
		recommendations.push(
			"Consider enabling auto_adjust_dates to align YNAB dates with bank statement dates",
		);
	}

	if (analysis.summary.unmatched_ynab > 0) {
		recommendations.push(
			`${analysis.summary.unmatched_ynab} transaction(s) exist in YNAB but not on the bank statement — review for duplicates or pending items`,
		);
	}

	if (params.dry_run) {
		recommendations.push(
			"Dry run only — re-run with dry_run=false to apply these changes",
		);
	}

	if (Math.abs(balanceChangeMilli) > MONEY_EPSILON_MILLI) {
		recommendations.push(
			`Account balance changed by ${toMoneyValue(balanceChangeMilli, currencyCode).value_display} during reconciliation`,
		);
	}

	return recommendations;
}

export function sortByDateDescending<T extends { date: string }>(
	items: T[],
): T[] {
	return [...items].sort((a, b) => compareDates(b.date, a.date));
}

export function sortMatchesByBankDateDescending(
	matches: TransactionMatch[],
): TransactionMatch[] {
	return [...matches].sort((a, b) =>
		compareDates(b.bankTransaction.date, a.bankTransaction.date),
	);
}

function compareDates(dateA: string, dateB: string): number {
	return toChronoValue(dateA) - toChronoValue(dateB);
}

function toChronoValue(date: string): number {
	const parsed = Date.parse(date);
	if (!Number.isNaN(parsed)) {
		return parsed;
	}
	const fallback = Date.parse(`${date}T00:00:00Z`);
	return Number.isNaN(fallback) ? 0 : fallback;
}
