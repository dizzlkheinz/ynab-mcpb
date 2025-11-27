/**
 * Transaction matching algorithm for reconciliation
 *
 * V2 matcher works natively in milliunits using canonical BankTransaction
 * and NormalizedYNABTransaction types.
 */

import * as fuzz from 'fuzzball';
import type {
  BankTransaction as CanonicalBankTransaction,
  NormalizedYNABTransaction,
} from '../../types/reconciliation.js';
import { type MatchingConfig } from './types.js';

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
  confidence: 'high' | 'medium' | 'low' | 'none';
  confidenceScore: number;
}

export const DEFAULT_CONFIG: MatchingConfig = {
  weights: {
    amount: 0.5,
    date: 0.15,
    payee: 0.35,
  },
  amountToleranceMilliunits: 10, // 1 cent
  dateToleranceDays: 7,
  autoMatchThreshold: 85,
  suggestedMatchThreshold: 60,
  minimumCandidateScore: 40,
  exactAmountBonus: 10,
  exactDateBonus: 5,
  exactPayeeBonus: 10,
};

export function normalizeConfig(config?: MatchingConfig): MatchingConfig {
  if (!config) {
    return { ...DEFAULT_CONFIG };
  }

  return {
    weights: config.weights ?? DEFAULT_CONFIG.weights,
    amountToleranceMilliunits:
      config.amountToleranceMilliunits ?? DEFAULT_CONFIG.amountToleranceMilliunits,
    dateToleranceDays: config.dateToleranceDays ?? DEFAULT_CONFIG.dateToleranceDays,
    autoMatchThreshold: config.autoMatchThreshold ?? DEFAULT_CONFIG.autoMatchThreshold,
    suggestedMatchThreshold:
      config.suggestedMatchThreshold ?? DEFAULT_CONFIG.suggestedMatchThreshold,
    minimumCandidateScore: config.minimumCandidateScore ?? DEFAULT_CONFIG.minimumCandidateScore,
    exactAmountBonus: config.exactAmountBonus ?? DEFAULT_CONFIG.exactAmountBonus,
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

  const bestMatch = candidates.length > 0 ? candidates[0]! : null;
  const confidenceScore = bestMatch?.scores.combined ?? 0;

  let confidence: MatchResult['confidence'];
  if (confidenceScore >= config.autoMatchThreshold) {
    confidence = 'high';
    if (bestMatch) usedIds.add(bestMatch.ynabTransaction.id);
  } else if (confidenceScore >= config.suggestedMatchThreshold) {
    confidence = 'medium';
  } else if (confidenceScore >= config.minimumCandidateScore) {
    confidence = 'low';
  } else {
    confidence = 'none';
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

    const amountDiff = Math.abs(bankTxn.amount - ynabTxn.amount);
    if (amountDiff > config.amountToleranceMilliunits) {
      // Outside configured amount tolerance - treat as no candidate
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

    const aUncleared = a.ynabTransaction.cleared === 'uncleared' ? 1 : 0;
    const bUncleared = b.ynabTransaction.cleared === 'uncleared' ? 1 : 0;
    if (aUncleared !== bUncleared) {
      return bUncleared - aUncleared;
    }

    const bankTime = new Date(bankTxn.date).getTime();
    const aDiff = Math.abs(bankTime - new Date(a.ynabTransaction.date).getTime());
    const bDiff = Math.abs(bankTime - new Date(b.ynabTransaction.date).getTime());
    if (aDiff !== bDiff) {
      return aDiff - bDiff;
    }

    return 0;
  });
  return candidates;
}

function calculateScores(
  bankTxn: CanonicalBankTransaction,
  ynabTxn: NormalizedYNABTransaction,
  config: MatchingConfig,
): MatchCandidate['scores'] {
  // Amount score - now using INTEGER comparison (milliunits)
  const amountDiff = Math.abs(bankTxn.amount - ynabTxn.amount);
  let amountScore: number;

  if (amountDiff === 0) {
    // Exact integer match - no floating point issues!
    amountScore = 100;
  } else if (amountDiff <= config.amountToleranceMilliunits) {
    amountScore = 95;
  } else if (amountDiff <= 1000) {
    // Within $1
    amountScore = 80 - (amountDiff / 1000) * 20;
  } else {
    amountScore = Math.max(0, 60 - (amountDiff / 1000) * 5);
  }

  // Date score
  const bankDate = new Date(bankTxn.date);
  const ynabDate = new Date(ynabTxn.date);
  const daysDiff = Math.abs(bankDate.getTime() - ynabDate.getTime()) / (1000 * 60 * 60 * 24);
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

  // Combined score with weights
  let combined =
    amountScore * config.weights.amount +
    dateScore * config.weights.date +
    payeeScore * config.weights.payee;

  // Apply bonuses
  if (amountScore === 100) combined += config.exactAmountBonus;
  if (dateScore === 100) combined += config.exactDateBonus;
  if (payeeScore >= 95) combined += config.exactPayeeBonus;

  combined = Math.min(100, combined);

  return {
    amount: Math.round(amountScore),
    date: Math.round(dateScore),
    payee: Math.round(payeeScore),
    combined: Math.round(combined),
  };
}

function calculatePayeeScore(bankPayee: string, ynabPayee: string | null): number {
  if (!ynabPayee) return 30;

  const scores = [
    fuzz.token_set_ratio(bankPayee, ynabPayee),
    fuzz.token_sort_ratio(bankPayee, ynabPayee),
    fuzz.partial_ratio(bankPayee, ynabPayee),
    fuzz.WRatio(bankPayee, ynabPayee),
  ];

  return Math.max(...scores);
}

function buildMatchReasons(scores: MatchCandidate['scores'], config: MatchingConfig): string[] {
  const reasons: string[] = [];

  if (scores.amount === 100) {
    reasons.push('Exact amount match');
  } else if (scores.amount >= 95) {
    reasons.push('Amount within tolerance');
  }

  if (scores.date === 100) {
    reasons.push('Same date');
  } else if (scores.date >= 90) {
    reasons.push('Date within 1-2 days');
  } else if (scores.date >= 50) {
    reasons.push(`Date within ${config.dateToleranceDays} days`);
  }

  if (scores.payee >= 95) {
    reasons.push('Payee exact match');
  } else if (scores.payee >= 80) {
    reasons.push('Payee highly similar');
  } else if (scores.payee >= 60) {
    reasons.push('Payee somewhat similar');
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
