/**
 * Transaction matching engine for bank CSV comparison.
 * Operates in integer milliunits.
 */

import * as fuzz from "fuzzball";
import { formatUTCISODate } from "../../utils/dateUtils.js";
import type {
	BankTransaction,
	TransactionMatch,
	YNABTransaction,
} from "./types.js";

const DATE_WEIGHT = 0.15;
const PAYEE_WEIGHT = 0.35;
const BASE_SCORE = 50;
const EXACT_DATE_BONUS = 5;
const EXACT_PAYEE_BONUS = 10;
const MINIMUM_CANDIDATE_SCORE = 40;
const MATCH_THRESHOLD = 60;

interface MatchScores {
	amount: number;
	date: number;
	payee: number;
	combined: number;
}

interface MatchCandidate {
	ynabTransaction: YNABTransaction;
	scores: MatchScores;
	matchReasons: string[];
}

interface MatchConfig {
	amountTolerance: number;
	dateToleranceDays: number;
	chronologyBonus: boolean;
}

function daysBetween(a: Date, b: Date): number {
	return Math.abs(a.getTime() - b.getTime()) / 86400000;
}

function isEligibleCandidate(
	bankTxn: BankTransaction,
	ynabTxn: YNABTransaction,
	usedIds: Set<string>,
	config: MatchConfig,
): number | null {
	if (usedIds.has(ynabTxn.id)) return null;

	const bankSign = Math.sign(bankTxn.amount);
	const ynabSign = Math.sign(ynabTxn.amount);
	if (bankSign !== ynabSign && bankSign !== 0 && ynabSign !== 0) {
		return null;
	}

	const amountDifference = Math.abs(bankTxn.amount - ynabTxn.amount);
	if (amountDifference > Math.abs(bankTxn.amount) * config.amountTolerance) {
		return null;
	}

	const daysDiff = daysBetween(bankTxn.date, ynabTxn.date);
	return daysDiff > config.dateToleranceDays ? null : daysDiff;
}

function calculatePayeeScore(
	bankPayee: string,
	ynabPayee: string | null | undefined,
): number {
	if (!ynabPayee) return 30;
	return Math.max(
		fuzz.token_set_ratio(bankPayee, ynabPayee),
		fuzz.token_sort_ratio(bankPayee, ynabPayee),
		fuzz.partial_ratio(bankPayee, ynabPayee),
		fuzz.WRatio(bankPayee, ynabPayee),
	);
}

function calculateDateScore(
	daysDiff: number,
	dateToleranceDays: number,
): number {
	if (daysDiff < 0.5) return 100;
	if (daysDiff <= 1) return 95;
	if (daysDiff <= dateToleranceDays) {
		return 90 - (daysDiff - 1) * (40 / dateToleranceDays);
	}
	return Math.max(0, 50 - (daysDiff - dateToleranceDays) * 5);
}

function chronologyPoints(daysDiff: number, enabled: boolean): number {
	if (!enabled || daysDiff > 3) return 0;
	return daysDiff <= 1 ? 15 : 10;
}

function calculateScores(
	bankTxn: BankTransaction,
	ynabTxn: YNABTransaction,
	daysDiff: number,
	config: MatchConfig,
): MatchScores {
	const dateScore = calculateDateScore(daysDiff, config.dateToleranceDays);
	const payeeScore = Math.max(
		calculatePayeeScore(bankTxn.description, ynabTxn.payee_name),
		ynabTxn.memo ? calculatePayeeScore(bankTxn.description, ynabTxn.memo) : 0,
	);

	let combined =
		BASE_SCORE +
		dateScore * DATE_WEIGHT +
		payeeScore * PAYEE_WEIGHT +
		(dateScore === 100 ? EXACT_DATE_BONUS : 0) +
		(payeeScore >= 95 ? EXACT_PAYEE_BONUS : 0) +
		chronologyPoints(daysDiff, config.chronologyBonus);
	combined = Math.min(100, combined);

	return {
		amount: bankTxn.amount === ynabTxn.amount ? 100 : 90,
		date: Math.round(dateScore),
		payee: Math.round(payeeScore),
		combined: Math.round(combined),
	};
}

function buildMatchReasons(
	bankTxn: BankTransaction,
	ynabTxn: YNABTransaction,
	scores: MatchScores,
	daysDiff: number,
	config: MatchConfig,
): string[] {
	const reasons = [
		scores.amount === 100
			? "Exact amount match"
			: "Amount within configured tolerance",
	];

	if (scores.date === 100) {
		reasons.push("Same date");
	} else if (scores.date >= 90) {
		reasons.push("Date within 1-2 days");
	} else if (scores.date >= 50) {
		reasons.push(`Date within ${config.dateToleranceDays} days`);
	}

	if (scores.payee >= 95) {
		reasons.push("Payee exact match");
	} else if (scores.payee >= 80) {
		reasons.push("Payee highly similar");
	} else if (scores.payee >= 60) {
		reasons.push("Payee somewhat similar");
	}

	const bonus = chronologyPoints(daysDiff, config.chronologyBonus);
	if (bonus > 0) {
		reasons.push(`Chronological order bonus (+${bonus})`);
	}

	if (
		ynabTxn.memo &&
		calculatePayeeScore(bankTxn.description, ynabTxn.memo) >
			calculatePayeeScore(bankTxn.description, ynabTxn.payee_name)
	) {
		reasons.push("Memo similarity");
	}

	return reasons;
}

function compareCandidates(
	bankTime: number,
	a: MatchCandidate,
	b: MatchCandidate,
): number {
	const scoreDiff = b.scores.combined - a.scores.combined;
	if (scoreDiff !== 0) return scoreDiff;

	const aUncleared = a.ynabTransaction.cleared === "uncleared" ? 1 : 0;
	const bUncleared = b.ynabTransaction.cleared === "uncleared" ? 1 : 0;
	if (aUncleared !== bUncleared) return bUncleared - aUncleared;

	const aDiff = Math.abs(
		bankTime -
			new Date(
				`${formatUTCISODate(a.ynabTransaction.date)}T00:00:00Z`,
			).getTime(),
	);
	const bDiff = Math.abs(
		bankTime -
			new Date(
				`${formatUTCISODate(b.ynabTransaction.date)}T00:00:00Z`,
			).getTime(),
	);
	return aDiff - bDiff;
}

function findBestCandidate(
	bankTxn: BankTransaction,
	ynabTransactions: YNABTransaction[],
	usedIds: Set<string>,
	config: MatchConfig,
): MatchCandidate | null {
	const candidates: MatchCandidate[] = [];

	for (const ynabTxn of ynabTransactions) {
		const daysDiff = isEligibleCandidate(bankTxn, ynabTxn, usedIds, config);
		if (daysDiff === null) continue;

		const scores = calculateScores(bankTxn, ynabTxn, daysDiff, config);
		if (scores.combined >= MINIMUM_CANDIDATE_SCORE) {
			candidates.push({
				ynabTransaction: ynabTxn,
				scores,
				matchReasons: buildMatchReasons(
					bankTxn,
					ynabTxn,
					scores,
					daysDiff,
					config,
				),
			});
		}
	}

	const bankTime = new Date(
		`${formatUTCISODate(bankTxn.date)}T00:00:00Z`,
	).getTime();
	candidates.sort((a, b) => compareCandidates(bankTime, a, b));
	const best = candidates[0] ?? null;
	return best && best.scores.combined >= MATCH_THRESHOLD ? best : null;
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
	const config: MatchConfig = {
		amountTolerance,
		dateToleranceDays: dateTolerance,
		chronologyBonus,
	};
	const usedBank = new Set<BankTransaction>();
	const usedYnab = new Set<string>();
	const matches: TransactionMatch[] = [];

	for (const bankTransaction of bank) {
		const best = findBestCandidate(bankTransaction, ynab, usedYnab, config);
		if (!best) continue;
		matches.push({
			bank_transaction: bankTransaction,
			ynab_transaction: best.ynabTransaction,
			match_score: best.scores.combined,
			match_reasons: best.matchReasons,
		});
		usedBank.add(bankTransaction);
		usedYnab.add(best.ynabTransaction.id);
	}

	return {
		matches,
		unmatched_bank: bank.filter((transaction) => !usedBank.has(transaction)),
		unmatched_ynab: ynab.filter((transaction) => !usedYnab.has(transaction.id)),
	};
}
