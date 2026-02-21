/**
 * Smart sign detection for bank transaction imports
 *
 * Analyzes a sample of bank and YNAB transactions to determine if
 * bank amounts need to be inverted to match YNAB's sign convention.
 */

import type {
	BankTransaction,
	NormalizedYNABTransaction,
} from "../../types/reconciliation.js";

interface SignMatch {
	bankAmount: number;
	ynabAmount: number;
	oppositeSign: boolean;
}

/**
 * Detects whether bank transaction amounts need to be inverted
 * to match YNAB's sign convention.
 *
 * Algorithm:
 * 1. Find matching transactions based on date/amount proximity
 * 2. For each match, check if signs are opposite
 * 3. If >50% of matches have opposite signs, return true (needs inversion)
 *
 * @param bankTransactions - Raw bank transactions from CSV
 * @param ynabTransactions - Normalized YNAB transactions
 * @returns true if bank amounts should be inverted, false if not, null if insufficient evidence
 */
export function detectSignInversion(
	bankTransactions: BankTransaction[],
	ynabTransactions: NormalizedYNABTransaction[],
): boolean | null {
	// Edge cases: empty lists
	if (bankTransactions.length === 0 || ynabTransactions.length === 0) {
		return null; // Insufficient evidence
	}

	// Sample evenly across the array for representative coverage
	const maxSamples = 50;
	const stride = Math.max(1, Math.floor(bankTransactions.length / maxSamples));
	const sample: BankTransaction[] = [];
	for (
		let i = 0;
		i < bankTransactions.length && sample.length < maxSamples;
		i += stride
	) {
		const txn = bankTransactions[i];
		if (txn) sample.push(txn);
	}

	const matches: SignMatch[] = [];

	// Try to find matches for each bank transaction
	for (const bankTxn of sample) {
		const match = findClosestMatch(bankTxn, ynabTransactions);
		if (match) {
			matches.push(match);
		}
	}

	// Need at least 1 match to make a determination
	if (matches.length === 0) {
		return null; // Insufficient evidence
	}

	// Count how many matches have opposite signs
	const oppositeSignCount = matches.filter((m) => m.oppositeSign).length;
	const oppositeSignRatio = oppositeSignCount / matches.length;

	// If more than 50% have opposite signs, inversion is needed
	return oppositeSignRatio > 0.5;
}

/**
 * Find the closest matching YNAB transaction for a bank transaction
 */
function findClosestMatch(
	bankTxn: BankTransaction,
	ynabTransactions: NormalizedYNABTransaction[],
): SignMatch | null {
	const bankDate = new Date(bankTxn.date);
	const bankAbsAmount = Math.abs(bankTxn.amount);

	let bestMatch: SignMatch | null = null;
	let bestScore = 0;

	for (const ynabTxn of ynabTransactions) {
		const ynabDate = new Date(ynabTxn.date);
		const ynabAbsAmount = Math.abs(ynabTxn.amount);

		// Check if amounts match (within tolerance)
		const amountDiff = Math.abs(bankAbsAmount - ynabAbsAmount);
		const amountTolerance = 100; // 10 cents in milliunits
		if (amountDiff > amountTolerance) {
			continue; // Amounts too different
		}

		// Check date proximity
		const daysDiff =
			Math.abs(bankDate.getTime() - ynabDate.getTime()) / (1000 * 60 * 60 * 24);
		if (daysDiff > 7) {
			continue; // Dates too far apart
		}

		// Calculate match score (closer = higher score)
		const amountScore =
			amountDiff === 0 ? 100 : Math.max(0, 100 - amountDiff / 10);
		const dateScore = daysDiff === 0 ? 100 : Math.max(0, 100 - daysDiff * 10);
		const score = amountScore * 0.7 + dateScore * 0.3;

		if (score > bestScore) {
			bestScore = score;

			// Check if signs are opposite
			const bankSign = Math.sign(bankTxn.amount);
			const ynabSign = Math.sign(ynabTxn.amount);
			const oppositeSign =
				bankSign !== 0 && ynabSign !== 0 && bankSign !== ynabSign;

			bestMatch = {
				bankAmount: bankTxn.amount,
				ynabAmount: ynabTxn.amount,
				oppositeSign,
			};
		}
	}

	return bestMatch;
}
