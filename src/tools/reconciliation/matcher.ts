/**
 * Transaction matching algorithm for reconciliation
 * Implements confidence-based matching with auto-match and suggestion tiers
 */

import { normalizedMatch, payeeSimilarity } from './payeeNormalizer.js';
import { DEFAULT_MATCHING_CONFIG } from './types.js';
import type {
  BankTransaction,
  YNABTransaction,
  TransactionMatch,
  MatchCandidate,
  MatchingConfig,
} from './types.js';

/**
 * Check if two amounts match within tolerance
 */
function amountsMatch(bankAmount: number, ynabAmount: number, toleranceCents: number): boolean {
  // Convert YNAB milliunits to dollars
  const ynabDollars = ynabAmount / 1000;

  // Round to avoid floating point precision issues
  const difference = Math.round(Math.abs(bankAmount - ynabDollars) * 100) / 100;
  const toleranceDollars = toleranceCents / 100;

  return difference <= toleranceDollars;
}

/**
 * Check if two dates match within tolerance
 */
function datesMatch(date1: string, date2: string, toleranceDays: number): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);

  const diffMs = Math.abs(d1.getTime() - d2.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays <= toleranceDays;
}

/**
 * Calculate match confidence score between bank and YNAB transaction
 * Returns score 0-100 and match reasons
 */
function calculateMatchScore(
  bankTxn: BankTransaction,
  ynabTxn: YNABTransaction,
  config: MatchingConfig,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Amount match (40% weight) - REQUIRED
  const amountMatch = amountsMatch(bankTxn.amount, ynabTxn.amount, config.amountToleranceCents);
  if (!amountMatch) {
    return { score: 0, reasons: ['Amount does not match'] };
  }
  score += 40;
  reasons.push('Amount matches');

  // Date match (40% weight)
  const dateWithinTolerance = datesMatch(bankTxn.date, ynabTxn.date, config.dateToleranceDays);
  if (dateWithinTolerance) {
    score += 40;
    const daysDiff = Math.abs(
      (new Date(bankTxn.date).getTime() - new Date(ynabTxn.date).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysDiff === 0) {
      reasons.push('Exact date match');
    } else {
      reasons.push(`Date within ${Math.round(daysDiff)} days`);
    }
  }

  // Payee match (20% weight)
  const payeeScore = payeeSimilarity(bankTxn.payee, ynabTxn.payee_name);

  if (normalizedMatch(bankTxn.payee, ynabTxn.payee_name)) {
    score += 20;
    reasons.push('Payee exact match');
  } else if (payeeScore >= 95) {
    score += 15;
    reasons.push(`Payee highly similar (${Math.round(payeeScore)}%)`);
  } else if (payeeScore >= 80) {
    score += 10;
    reasons.push(`Payee similar (${Math.round(payeeScore)}%)`);
  } else if (payeeScore >= 60) {
    score += 6;
    reasons.push(`Payee somewhat similar (${Math.round(payeeScore)}%)`);
  }

  return { score: Math.round(score), reasons };
}

/**
 * Priority scoring for YNAB transactions
 * Uncleared transactions get higher priority than cleared ones
 */
function getPriority(ynabTxn: YNABTransaction): number {
  // Uncleared transactions are expecting bank confirmation
  if (ynabTxn.cleared === 'uncleared') return 10;
  if (ynabTxn.cleared === 'cleared') return 5;
  if (ynabTxn.cleared === 'reconciled') return 1;
  return 0;
}

/**
 * Find all matching candidates for a bank transaction
 */
function findMatchCandidates(
  bankTxn: BankTransaction,
  ynabTransactions: YNABTransaction[],
  usedIds: Set<string>,
  config: MatchingConfig,
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];

  for (const ynabTxn of ynabTransactions) {
    // Skip already matched transactions
    if (usedIds.has(ynabTxn.id)) continue;

    // Skip opposite-signed transactions (refunds vs purchases)
    if (bankTxn.amount > 0 !== ynabTxn.amount > 0) continue;

    // Calculate match score
    const { score, reasons } = calculateMatchScore(bankTxn, ynabTxn, config);

    // Only include candidates with minimum score
    if (score >= 30) {
      candidates.push({
        ynab_transaction: ynabTxn,
        confidence: score,
        match_reason: reasons.join(', '),
        explanation: buildExplanation(bankTxn, ynabTxn, score, reasons),
      });
    }
  }

  // Sort by confidence (desc), then priority (desc), then date proximity
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    const priorityDiff = getPriority(b.ynab_transaction) - getPriority(a.ynab_transaction);
    if (priorityDiff !== 0) return priorityDiff;

    // Date proximity as tiebreaker
    const dateProximityA = Math.abs(
      new Date(bankTxn.date).getTime() - new Date(a.ynab_transaction.date).getTime(),
    );
    const dateProximityB = Math.abs(
      new Date(bankTxn.date).getTime() - new Date(b.ynab_transaction.date).getTime(),
    );
    return dateProximityA - dateProximityB;
  });

  return candidates;
}

/**
 * Build human-readable explanation for a match
 */
function buildExplanation(
  _bankTxn: BankTransaction,
  ynabTxn: YNABTransaction,
  score: number,
  reasons: string[],
): string {
  const parts: string[] = [];

  parts.push(`Match confidence: ${score}%`);
  parts.push(reasons.join(', '));

  if (ynabTxn.cleared === 'uncleared') {
    parts.push('(Uncleared - awaiting confirmation)');
  }

  return parts.join(' | ');
}

/**
 * Find best match for a single bank transaction
 */
export function findBestMatch(
  bankTxn: BankTransaction,
  ynabTransactions: YNABTransaction[],
  usedIds: Set<string>,
  config: MatchingConfig,
): TransactionMatch {
  const candidates = findMatchCandidates(bankTxn, ynabTransactions, usedIds, config);

  if (candidates.length === 0) {
    // No match found
    return {
      bank_transaction: bankTxn,
      confidence: 'none',
      confidence_score: 0,
      match_reason: 'No matching transaction found in YNAB',
      action_hint: 'add_to_ynab',
      recommendation: 'This transaction appears on bank statement but not in YNAB',
    };
  }

  const bestCandidate = candidates[0]!; // Safe: we checked candidates.length > 0
  const bestScore = bestCandidate.confidence;

  // HIGH confidence: Auto-match candidate (≥90%)
  if (bestScore >= config.autoMatchThreshold) {
    return {
      bank_transaction: bankTxn,
      ynab_transaction: bestCandidate.ynab_transaction,
      confidence: 'high',
      confidence_score: bestScore,
      match_reason: bestCandidate.match_reason,
    };
  }

  // MEDIUM confidence: Suggested match (60-89%)
  if (bestScore >= config.suggestionThreshold) {
    return {
      bank_transaction: bankTxn,
      ynab_transaction: bestCandidate.ynab_transaction,
      candidates: candidates.slice(0, 3), // Top 3 candidates
      confidence: 'medium',
      confidence_score: bestScore,
      match_reason: bestCandidate.match_reason,
      top_confidence: bestScore,
      action_hint: 'review_and_choose',
    };
  }

  // LOW confidence: Show as possible match but don't auto-suggest (30-59%)
  return {
    bank_transaction: bankTxn,
    candidates: candidates.slice(0, 3),
    confidence: 'low',
    confidence_score: bestScore,
    match_reason: 'Low confidence match',
    top_confidence: bestScore,
    action_hint: 'review_or_add_new',
    recommendation: 'Consider reviewing candidates or adding as new transaction',
  };
}

/**
 * Find matches for all bank transactions
 */
export function findMatches(
  bankTransactions: BankTransaction[],
  ynabTransactions: YNABTransaction[],
  config: MatchingConfig = DEFAULT_MATCHING_CONFIG as MatchingConfig,
): TransactionMatch[] {
  const matches: TransactionMatch[] = [];
  const usedIds = new Set<string>();

  for (const bankTxn of bankTransactions) {
    const match = findBestMatch(bankTxn, ynabTransactions, usedIds, config);
    matches.push(match);

    // Mark high-confidence matches as used to prevent duplicate matching
    if (match.confidence === 'high' && match.ynab_transaction) {
      usedIds.add(match.ynab_transaction.id);
    }
  }

  return matches;
}
