import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { responseFormatter } from "../../server/responseFormatter.js";
import { formatUTCISODate } from "../../utils/dateUtils.js";
import type {
	BankTransaction,
	TransactionMatch,
	YNABTransaction,
} from "./types.js";

/**
 * Find suggested payee for unmatched bank transaction
 */
export function findSuggestedPayee(
	description: string,
	payees: ynab.Payee[],
): {
	suggested_payee_id?: string;
	suggested_payee_name?: string;
	suggestion_reason?: string;
} {
	if (!description) {
		return {};
	}

	const lowerDescription = description.toLowerCase();

	// Simple search: check if payee name is contained in the description
	for (const payee of payees) {
		const lowerPayeeName = payee.name.toLowerCase();
		if (lowerDescription.includes(lowerPayeeName)) {
			return {
				suggested_payee_id: payee.id,
				suggested_payee_name: payee.name,
				suggestion_reason: `Matched payee '${payee.name}' in description.`,
			};
		}
	}

	// If no match, suggest the original description as the new payee name (cleaned up a bit)
	const suggestedName = description
		.replace(/\d+/g, "") // Remove numbers
		.replace(/\s+/g, " ") // Consolidate whitespace
		.trim();

	return {
		suggested_payee_name: suggestedName,
		suggestion_reason:
			"No matching payee found. Suggested new payee name from description.",
	};
}

/**
 * Build summary statistics for the comparison
 */
export function buildSummary(
	bankTransactions: BankTransaction[],
	ynabTransactions: YNABTransaction[],
	matches: TransactionMatch[],
	unmatchedBank: BankTransaction[],
	unmatchedYnab: YNABTransaction[],
	parameters: { amount_tolerance?: number; date_tolerance_days?: number },
	dateRange: { start: string; end: string },
) {
	return {
		bank_transactions_count: bankTransactions.length,
		ynab_transactions_count: ynabTransactions.length,
		matches_found: matches.length,
		missing_in_ynab: unmatchedBank.length,
		missing_in_bank: unmatchedYnab.length,
		date_range: dateRange,
		parameters: {
			amount_tolerance: parameters.amount_tolerance,
			date_tolerance_days: parameters.date_tolerance_days,
		},
	};
}

/**
 * Format matched transaction pairs
 */
export function formatMatches(matches: TransactionMatch[]) {
	return matches.map((match) => ({
		bank_date: formatUTCISODate(match.bank_transaction.date),
		bank_amount: (match.bank_transaction.amount / 1000).toFixed(2),
		bank_description: match.bank_transaction.description,
		ynab_date: formatUTCISODate(match.ynab_transaction.date),
		ynab_amount: (match.ynab_transaction.amount / 1000).toFixed(2),
		ynab_payee: match.ynab_transaction.payee_name,
		ynab_transaction: {
			id: match.ynab_transaction.id,
			cleared: match.ynab_transaction.cleared,
		},
		match_score: match.match_score,
		match_reasons: match.match_reasons,
	}));
}

/**
 * Format unmatched bank transactions with payee suggestions
 */
export function formatUnmatchedBank(
	unmatchedBank: BankTransaction[],
	payees: ynab.Payee[],
) {
	return unmatchedBank.map((txn) => {
		const payeeSuggestion = findSuggestedPayee(txn.description, payees);
		return {
			date: formatUTCISODate(txn.date),
			amount: (txn.amount / 1000).toFixed(2),
			description: txn.description,
			row_number: txn.row_number,
			...payeeSuggestion,
		};
	});
}

/**
 * Format unmatched YNAB transactions
 */
export function formatUnmatchedYNAB(unmatchedYnab: YNABTransaction[]) {
	return unmatchedYnab.map((txn) => ({
		id: txn.id,
		date: formatUTCISODate(txn.date),
		amount: (txn.amount / 1000).toFixed(2),
		payee_name: txn.payee_name,
		memo: txn.memo,
		cleared: txn.cleared,
	}));
}

/**
 * Build the complete comparison result
 */
export function buildComparisonResult(
	matchResults: {
		matches: TransactionMatch[];
		unmatched_bank: BankTransaction[];
		unmatched_ynab: YNABTransaction[];
	},
	bankTransactions: BankTransaction[],
	ynabTransactions: YNABTransaction[],
	payees: ynab.Payee[],
	parameters: { amount_tolerance?: number; date_tolerance_days?: number },
	dateRange: { start: string; end: string },
): CallToolResult {
	const {
		matches,
		unmatched_bank: unmatchedBank,
		unmatched_ynab: unmatchedYnab,
	} = matchResults;

	const summary = buildSummary(
		bankTransactions,
		ynabTransactions,
		matches,
		unmatchedBank,
		unmatchedYnab,
		parameters,
		dateRange,
	);

	const formattedMatches = formatMatches(matches);
	const formattedUnmatchedBank = formatUnmatchedBank(unmatchedBank, payees);
	const formattedUnmatchedYnab = formatUnmatchedYNAB(unmatchedYnab);

	const comparisonData = {
		summary,
		matches: formattedMatches,
		missing_in_ynab: formattedUnmatchedBank,
		missing_in_bank: formattedUnmatchedYnab,
	};
	return {
		content: [
			{
				type: "text",
				text: responseFormatter.format(comparisonData),
			},
		],
		structuredContent: comparisonData,
	};
}
