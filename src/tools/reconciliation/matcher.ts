/**
 * Transaction matching algorithm for reconciliation
 *
 * V2 matcher works natively in milliunits using canonical BankTransaction
 * and NormalizedYNABTransaction types.
 */

import * as fuzz from "fuzzball";
import type {
	BankTransaction as CanonicalBankTransaction,
	NormalizedYNABTransaction,
} from "../../types/reconciliation.js";
import type { MatchingConfig } from "./types.js";

export type { MatchingConfig };

export interface MatchCandidate {
	ynabTransaction: NormalizedYNABTransaction;
	scores: {
		amount: number; // 0-100
		date: number; // 0-100
		payee: number; // 0-100
		combined: number; // Weighted combination
	};
	matchReasons: string[];
}

export interface MatchResult {
	bankTransaction: CanonicalBankTransaction;
	bestMatch: MatchCandidate | null;
	candidates: MatchCandidate[]; // Top 3
	confidence: "high" | "medium" | "low" | "none";
	confidenceScore: number;
}

export const DEFAULT_CONFIG: MatchingConfig = {
	weights: {
		date: 0.15,
		payee: 0.35,
	},
	dateToleranceDays: 7,
	autoMatchThreshold: 85,
	suggestedMatchThreshold: 60,
	minimumCandidateScore: 40,
	exactDateBonus: 5,
	exactPayeeBonus: 10,
};

export function normalizeConfig(config?: MatchingConfig): MatchingConfig {
	if (!config) {
		return { ...DEFAULT_CONFIG };
	}

	return {
		weights: config.weights ?? DEFAULT_CONFIG.weights,
		dateToleranceDays:
			config.dateToleranceDays ?? DEFAULT_CONFIG.dateToleranceDays,
		autoMatchThreshold:
			config.autoMatchThreshold ?? DEFAULT_CONFIG.autoMatchThreshold,
		suggestedMatchThreshold:
			config.suggestedMatchThreshold ?? DEFAULT_CONFIG.suggestedMatchThreshold,
		minimumCandidateScore:
			config.minimumCandidateScore ?? DEFAULT_CONFIG.minimumCandidateScore,
		exactDateBonus: config.exactDateBonus ?? DEFAULT_CONFIG.exactDateBonus,
		exactPayeeBonus: config.exactPayeeBonus ?? DEFAULT_CONFIG.exactPayeeBonus,
	};
}

function matchSingle(
	bankTxn: CanonicalBankTransaction,
	ynabTransactions: NormalizedYNABTransaction[],
	usedIds: Set<string>,
	configInput: MatchingConfig | undefined,
): MatchResult {
	const config = normalizeConfig(configInput);

	const candidates = findCandidates(bankTxn, ynabTransactions, usedIds, config);

	const bestMatch = candidates[0] ?? null;
	const confidenceScore = bestMatch?.scores.combined ?? 0;

	let confidence: MatchResult["confidence"];
	if (confidenceScore >= config.autoMatchThreshold) {
		confidence = "high";
		if (bestMatch) usedIds.add(bestMatch.ynabTransaction.id);
	} else if (confidenceScore >= config.suggestedMatchThreshold) {
		confidence = "medium";
	} else if (confidenceScore >= config.minimumCandidateScore) {
		confidence = "low";
	} else {
		confidence = "none";
	}

	return {
		bankTransaction: bankTxn,
		bestMatch,
		candidates: candidates.slice(0, 3),
		confidence,
		confidenceScore,
	};
}

export function findMatches(
	bankTransactions: CanonicalBankTransaction[],
	ynabTransactions: NormalizedYNABTransaction[],
	config?: MatchingConfig,
): MatchResult[] {
	const usedYnabIds = new Set<string>();
	const results: MatchResult[] = [];

	for (const bankTxn of bankTransactions) {
		results.push(matchSingle(bankTxn, ynabTransactions, usedYnabIds, config));
	}

	return results;
}

function findCandidates(
	bankTxn: CanonicalBankTransaction,
	ynabTransactions: NormalizedYNABTransaction[],
	usedIds: Set<string>,
	config: MatchingConfig,
): MatchCandidate[] {
	const candidates: MatchCandidate[] = [];

	for (const ynabTxn of ynabTransactions) {
		if (usedIds.has(ynabTxn.id)) continue;

		// Sign check - both must be same sign (or both zero)
		const bankSign = Math.sign(bankTxn.amount);
		const ynabSign = Math.sign(ynabTxn.amount);
		if (bankSign !== ynabSign && bankSign !== 0 && ynabSign !== 0) {
			continue;
		}

		// Amounts must match exactly (milliunits)
		if (bankTxn.amount !== ynabTxn.amount) {
			continue;
		}

		const scores = calculateScores(bankTxn, ynabTxn, config);

		if (scores.combined >= config.minimumCandidateScore) {
			candidates.push({
				ynabTransaction: ynabTxn,
				scores,
				matchReasons: buildMatchReasons(scores, config),
			});
		}
	}

	candidates.sort((a, b) => {
		const scoreDiff = b.scores.combined - a.scores.combined;
		if (scoreDiff !== 0) {
			return scoreDiff;
		}

		const aUncleared = a.ynabTransaction.cleared === "uncleared" ? 1 : 0;
		const bUncleared = b.ynabTransaction.cleared === "uncleared" ? 1 : 0;
		if (aUncleared !== bUncleared) {
			return bUncleared - aUncleared;
		}

		const bankTime = new Date(bankTxn.date).getTime();
		const aDiff = Math.abs(
			bankTime - new Date(a.ynabTransaction.date).getTime(),
		);
		const bDiff = Math.abs(
			bankTime - new Date(b.ynabTransaction.date).getTime(),
		);
		if (aDiff !== bDiff) {
			return aDiff - bDiff;
		}

		return 0;
	});
	return candidates;
}

// Fixed base score for exact amount match (amounts must match exactly, so this is always awarded)
const BASE_SCORE = 50;

function calculateScores(
	bankTxn: CanonicalBankTransaction,
	ynabTxn: NormalizedYNABTransaction,
	config: MatchingConfig,
): MatchCandidate["scores"] {
	// Date score
	const bankDate = new Date(bankTxn.date);
	const ynabDate = new Date(ynabTxn.date);
	const daysDiff =
		Math.abs(bankDate.getTime() - ynabDate.getTime()) / (1000 * 60 * 60 * 24);
	let dateScore: number;

	if (daysDiff < 0.5) {
		dateScore = 100;
	} else if (daysDiff <= 1) {
		dateScore = 95;
	} else if (daysDiff <= config.dateToleranceDays) {
		dateScore = 90 - (daysDiff - 1) * (40 / config.dateToleranceDays);
	} else {
		dateScore = Math.max(0, 50 - (daysDiff - config.dateToleranceDays) * 5);
	}

	// Payee score using fuzzball
	const payeeScore = calculatePayeeScore(bankTxn.payee, ynabTxn.payee);

	// Combined score: fixed base from exact amount match + weighted date/payee
	let combined =
		BASE_SCORE +
		dateScore * config.weights.date +
		payeeScore * config.weights.payee;

	// Apply bonuses
	if (dateScore === 100) combined += config.exactDateBonus;
	if (payeeScore >= 95) combined += config.exactPayeeBonus;

	combined = Math.min(100, combined);

	return {
		amount: 100, // Always 100 (candidates with different amounts are filtered out)
		date: Math.round(dateScore),
		payee: Math.round(payeeScore),
		combined: Math.round(combined),
	};
}

function calculatePayeeScore(
	bankPayee: string,
	ynabPayee: string | null,
): number {
	if (!ynabPayee) return 30;

	const scores = [
		fuzz.token_set_ratio(bankPayee, ynabPayee),
		fuzz.token_sort_ratio(bankPayee, ynabPayee),
		fuzz.partial_ratio(bankPayee, ynabPayee),
		fuzz.WRatio(bankPayee, ynabPayee),
	];

	return Math.max(...scores);
}

function buildMatchReasons(
	scores: MatchCandidate["scores"],
	config: MatchingConfig,
): string[] {
	const reasons: string[] = [];

	reasons.push("Exact amount match");

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

	return reasons;
}

export function findBestMatch(
	bankTransaction: CanonicalBankTransaction,
	ynabTransactions: NormalizedYNABTransaction[],
	usedYnabIds: Set<string> = new Set<string>(),
	config?: MatchingConfig,
): MatchResult {
	return matchSingle(bankTransaction, ynabTransactions, usedYnabIds, config);
}
