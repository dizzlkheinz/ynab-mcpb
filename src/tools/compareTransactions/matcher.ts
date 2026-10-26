/** Compatibility view over the shared reconciliation matcher. */

import type {
	BankTransaction as CanonicalBank,
	NormalizedYNABTransaction,
} from "../../types/reconciliation.js";
import {
	DEFAULT_CONFIG,
	findBestMatch,
	findMatches as matchTransactions,
} from "../reconciliation/matcher.js";
import type {
	BankTransaction,
	TransactionMatch,
	YNABTransaction,
} from "./types.js";

const bankView = (
	transaction: BankTransaction,
	index: number,
): CanonicalBank => ({
	id: String(index),
	date: transaction.date.toISOString().slice(0, 10),
	amount: transaction.amount,
	payee: transaction.description,
	sourceRow: transaction.row_number,
	raw: {
		date: transaction.raw_date,
		amount: transaction.raw_amount,
		description: transaction.description,
	},
});
const ynabView = (transaction: YNABTransaction): NormalizedYNABTransaction => ({
	id: transaction.id,
	date: transaction.date.toISOString().slice(0, 10),
	amount: transaction.amount,
	payee: transaction.payee_name ?? null,
	memo: transaction.memo ?? null,
	categoryName: null,
	approved: transaction.original?.approved ?? false,
	cleared: transaction.cleared as NormalizedYNABTransaction["cleared"],
});
const config = (
	amountTolerance: number,
	dateTolerance: number,
	chronologyBonus = false,
) => ({
	...DEFAULT_CONFIG,
	amountTolerance,
	dateToleranceDays: dateTolerance,
	chronologyBonus,
	autoMatchThreshold: 60,
	suggestedMatchThreshold: 60,
});
export function calculateMatchScore(
	bank: BankTransaction,
	ynab: YNABTransaction,
	amountTolerance: number,
	dateTolerance: number,
): { score: number; reasons: string[] } {
	const result = findBestMatch(
		bankView(bank, 0),
		[ynabView(ynab)],
		new Set(),
		config(amountTolerance, dateTolerance),
	);
	return {
		score: result.confidenceScore,
		reasons: result.bestMatch?.matchReasons ?? [],
	};
}
export function groupTransactionsByAmount(
	transactions: (BankTransaction | YNABTransaction)[],
): Map<number, (BankTransaction | YNABTransaction)[]> {
	const groups = new Map<number, (BankTransaction | YNABTransaction)[]>();
	for (const transaction of transactions)
		groups.set(transaction.amount, [
			...(groups.get(transaction.amount) ?? []),
			transaction,
		]);
	return groups;
}
export function matchDuplicateAmounts(
	bank: BankTransaction[],
	ynab: YNABTransaction[],
	_amount: number,
	amountTolerance: number,
	dateTolerance: number,
	chronologyBonus = false,
): TransactionMatch[] {
	return findMatches(
		bank,
		ynab,
		amountTolerance,
		dateTolerance,
		chronologyBonus,
	).matches;
}
export function findMatches(
	bank: BankTransaction[],
	ynab: YNABTransaction[],
	amountTolerance: number,
	dateTolerance: number,
	chronologyBonus = false,
): {
	matches: TransactionMatch[];
	unmatched_bank: BankTransaction[];
	unmatched_ynab: YNABTransaction[];
} {
	const results = matchTransactions(
		bank.map(bankView),
		ynab.map(ynabView),
		config(amountTolerance, dateTolerance, chronologyBonus),
	);
	const byId = new Map(
		ynab.map((transaction) => [transaction.id, transaction]),
	);
	const usedBank = new Set<BankTransaction>(),
		usedYnab = new Set<string>();
	const matches: TransactionMatch[] = [];
	for (const result of results) {
		if (result.confidence !== "high" || !result.bestMatch) continue;
		const bankTransaction = bank[Number(result.bankTransaction.id)],
			ynabTransaction = byId.get(result.bestMatch.ynabTransaction.id);
		if (!bankTransaction || !ynabTransaction) continue;
		matches.push({
			bank_transaction: bankTransaction,
			ynab_transaction: ynabTransaction,
			match_score: result.confidenceScore,
			match_reasons: result.bestMatch.matchReasons,
		});
		usedBank.add(bankTransaction);
		usedYnab.add(ynabTransaction.id);
	}
	return {
		matches,
		unmatched_bank: bank.filter((transaction) => !usedBank.has(transaction)),
		unmatched_ynab: ynab.filter((transaction) => !usedYnab.has(transaction.id)),
	};
}
