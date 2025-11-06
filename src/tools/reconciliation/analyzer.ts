/**
 * Analysis phase orchestration for reconciliation
 * Coordinates CSV parsing, YNAB transaction fetching, and matching
 */

import { randomUUID } from 'crypto';
import type * as ynab from 'ynab';
import * as bankParser from '../compareTransactions/parser.js';
import type { CSVFormat as ParserCSVFormat } from '../compareTransactions/types.js';
import { findMatches } from './matcher.js';
import {
  DEFAULT_MATCHING_CONFIG,
} from './types.js';
import type {
  BankTransaction,
  YNABTransaction,
  ReconciliationAnalysis,
  TransactionMatch,
  MatchingConfig,
  BalanceInfo,
  ReconciliationSummary,
  ReconciliationInsight,
} from './types.js';

/**
 * Convert YNAB API transaction to simplified format
 */
function convertYNABTransaction(apiTxn: ynab.TransactionDetail): YNABTransaction {
  return {
    id: apiTxn.id,
    date: apiTxn.date,
    amount: apiTxn.amount,
    payee_name: apiTxn.payee_name || null,
    category_name: apiTxn.category_name || null,
    cleared: apiTxn.cleared,
    approved: apiTxn.approved,
    memo: apiTxn.memo || null,
  };
}

/**
 * Parse CSV bank statement and generate unique IDs for tracking
 */
const FALLBACK_CSV_FORMAT: ParserCSVFormat = {
  date_column: 'Date',
  amount_column: 'Amount',
  description_column: 'Description',
  date_format: 'MM/DD/YYYY',
  has_header: true,
  delimiter: ',',
};

const ENABLE_COMBINATION_MATCHING = true;

const DAYS_IN_MS = 24 * 60 * 60 * 1000;

function toDollars(milliunits: number): number {
  return milliunits / 1000;
}

function amountTolerance(config: MatchingConfig): number {
  const toleranceCents =
    config.amountToleranceCents ?? DEFAULT_MATCHING_CONFIG.amountToleranceCents ?? 1;
  return Math.max(0, toleranceCents) / 100;
}

function dateTolerance(config: MatchingConfig): number {
  return config.dateToleranceDays ?? DEFAULT_MATCHING_CONFIG.dateToleranceDays ?? 2;
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(`${dateA}T00:00:00Z`).getTime();
  const b = new Date(`${dateB}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / DAYS_IN_MS;
}

function withinDateTolerance(
  bankDate: string,
  ynabTxns: YNABTransaction[],
  toleranceDays: number
): boolean {
  return ynabTxns.every((txn) => daysBetween(bankDate, txn.date) <= toleranceDays);
}

function hasMatchingSign(bankAmount: number, ynabTxns: YNABTransaction[]): boolean {
  const bankSign = Math.sign(bankAmount);
  const sumSign = Math.sign(
    ynabTxns.reduce((sum, txn) => sum + toDollars(txn.amount), 0)
  );
  return bankSign === sumSign || Math.abs(bankAmount) === 0;
}

function computeCombinationConfidence(
  diff: number,
  tolerance: number,
  legCount: number
): number {
  const safeTolerance = tolerance > 0 ? tolerance : 0.01;
  const ratio = diff / safeTolerance;
  let base = legCount === 2 ? 75 : 70;
  if (ratio <= 0.25) {
    base += 5;
  } else if (ratio <= 0.5) {
    base += 3;
  } else if (ratio >= 0.9) {
    base -= 5;
  }
  return Math.max(65, Math.min(80, Math.round(base)));
}

function formatDifference(diff: number): string {
  return formatCurrency(diff); // diff already absolute; formatCurrency handles sign
}

interface CombinationResult {
  matches: TransactionMatch[];
  insights: ReconciliationInsight[];
}

function findCombinationMatches(
  unmatchedBank: BankTransaction[],
  unmatchedYNAB: YNABTransaction[],
  config: MatchingConfig
): CombinationResult {
  if (!ENABLE_COMBINATION_MATCHING || unmatchedBank.length === 0 || unmatchedYNAB.length === 0) {
    return { matches: [], insights: [] };
  }

  const tolerance = amountTolerance(config);
  const toleranceDays = dateTolerance(config);

  const matches: TransactionMatch[] = [];
  const insights: ReconciliationInsight[] = [];
  const seenCombinations = new Set<string>();

  for (const bankTxn of unmatchedBank) {
    const viableYnab = unmatchedYNAB.filter((txn) => hasMatchingSign(bankTxn.amount, [txn]));
    if (viableYnab.length < 2) continue;

    const evaluated: { txns: YNABTransaction[]; diff: number; sum: number }[] = [];

    const addIfValid = (combo: YNABTransaction[]) => {
      const sum = combo.reduce((acc, txn) => acc + toDollars(txn.amount), 0);
      const diff = Math.abs(sum - bankTxn.amount);
      if (diff > tolerance) return;
      if (!withinDateTolerance(bankTxn.date, combo, toleranceDays)) return;
      if (!hasMatchingSign(bankTxn.amount, combo)) return;
      evaluated.push({ txns: combo, diff, sum });
    };

    const n = viableYnab.length;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        addIfValid([viableYnab[i]!, viableYnab[j]!]);
      }
    }

    if (n >= 3) {
      for (let i = 0; i < n - 2; i++) {
        for (let j = i + 1; j < n - 1; j++) {
          for (let k = j + 1; k < n; k++) {
            addIfValid([viableYnab[i]!, viableYnab[j]!, viableYnab[k]!]);
          }
        }
      }
    }

    if (evaluated.length === 0) continue;

    evaluated.sort((a, b) => a.diff - b.diff);
    const recordedSizes = new Set<number>();

    for (const combo of evaluated) {
      if (recordedSizes.has(combo.txns.length)) continue; // surface best per size
      const comboIds = combo.txns.map((txn) => txn.id).sort();
      const key = `${bankTxn.id}|${comboIds.join('+')}`;
      if (seenCombinations.has(key)) continue;
      seenCombinations.add(key);
      recordedSizes.add(combo.txns.length);

      const score = computeCombinationConfidence(combo.diff, tolerance, combo.txns.length);
      const candidateConfidence = Math.max(60, score - 5);
      const descriptionTotal = formatCurrency(combo.sum);
      const diffLabel = formatDifference(combo.diff);

      matches.push({
        bank_transaction: bankTxn,
        confidence: 'medium',
        confidence_score: score,
        match_reason: 'combination_match',
        top_confidence: score,
        candidates: combo.txns.map((txn) => ({
          ynab_transaction: txn,
          confidence: candidateConfidence,
          match_reason: 'combination_component',
          explanation: `Part of combination totaling ${descriptionTotal} (difference ${diffLabel}).`,
        })),
        action_hint: 'review_combination',
        recommendation:
          `Combination of ${combo.txns.length} YNAB transactions totals ${descriptionTotal} versus ` +
          `${formatCurrency(bankTxn.amount)} on the bank statement.`,
      });

      const insightId = `combination-${bankTxn.id}-${comboIds.join('+')}`;
      insights.push({
        id: insightId,
        type: 'combination_match' as unknown as ReconciliationInsight['type'],
        severity: 'info',
        title: `Combination of ${combo.txns.length} transactions matches ${formatCurrency(
          bankTxn.amount
        )}`,
        description:
          `${combo.txns.length} YNAB transactions totaling ${descriptionTotal} align with ` +
          `${formatCurrency(bankTxn.amount)} from ${bankTxn.payee}. Difference ${diffLabel}.`,
        evidence: {
          bank_transaction_id: bankTxn.id,
          bank_amount: bankTxn.amount,
          ynab_transaction_ids: comboIds,
          ynab_amounts_milliunits: combo.txns.map((txn) => txn.amount),
          combination_size: combo.txns.length,
          difference: combo.diff,
        },
      });
    }
  }

  return { matches, insights };
}

type ParserResult =
  | {
      transactions: unknown[];
      format_detected?: string;
      delimiter?: string;
      total_rows?: number;
      valid_rows?: number;
      errors?: string[];
    }
  | unknown[];

function isParsedCSVData(result: ParserResult): result is Extract<ParserResult, { transactions: unknown[] }> {
  return typeof result === 'object' && result !== null && !Array.isArray(result) && 'transactions' in result;
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split('T')[0]!;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0]!;
    }

    return trimmed;
  }

  return new Date().toISOString().split('T')[0]!;
}

function normalizeAmount(record: Record<string, unknown>): number {
  const raw = record['amount'];

  if (typeof raw === 'number') {
    if (record['date'] instanceof Date || 'raw_amount' in record || 'raw_date' in record) {
      return Math.round(raw) / 1000;
    }
    return raw;
  }

  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[$,\s]/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizePayee(record: Record<string, unknown>): string {
  const candidates = [record['payee'], record['description'], record['memo']];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return 'Unknown Payee';
}

function determineRow(record: Record<string, unknown>, index: number): number {
  if (typeof record['original_csv_row'] === 'number') {
    return record['original_csv_row'];
  }
  if (typeof record['row_number'] === 'number') {
    return record['row_number'];
  }
  return index + 1;
}

function convertParserRecord(record: unknown, index: number): BankTransaction {
  const data = typeof record === 'object' && record !== null ? (record as Record<string, unknown>) : {};

  const dateValue = normalizeDate(data['date']);
  const amountValue = normalizeAmount(data);
  const payeeValue = normalizePayee(data);
  const memoValue = typeof data['memo'] === 'string' && data['memo'].trim() ? data['memo'].trim() : undefined;
  const originalRow = determineRow(data, index);

  const transaction: BankTransaction = {
    id: randomUUID(),
    date: dateValue,
    amount: amountValue,
    payee: payeeValue,
    original_csv_row: originalRow,
  };

  if (memoValue !== undefined) {
    transaction.memo = memoValue;
  }

  return transaction;
}

function parseBankStatement(csvContent: string, csvFilePath?: string): BankTransaction[] {
  const content = csvFilePath ? bankParser.readCSVFile(csvFilePath) : csvContent;

  let format: ParserCSVFormat = FALLBACK_CSV_FORMAT;
  let autoDetect: ((content: string) => ParserCSVFormat) | undefined;
  try {
    autoDetect = (bankParser as { autoDetectCSVFormat?: (content: string) => ParserCSVFormat })
      .autoDetectCSVFormat;
  } catch {
    autoDetect = undefined;
  }

  if (typeof autoDetect === 'function') {
    try {
      format = autoDetect(content);
    } catch {
      format = FALLBACK_CSV_FORMAT;
    }
  }

  const rawResult = bankParser.parseBankCSV(content, format) as unknown as ParserResult;
  const records = isParsedCSVData(rawResult) ? rawResult.transactions : rawResult;

  return records.map(convertParserRecord);
}

/**
 * Categorize matches by confidence level
 */
function categorizeMatches(matches: TransactionMatch[]): {
  autoMatches: TransactionMatch[];
  suggestedMatches: TransactionMatch[];
  unmatchedBank: BankTransaction[];
} {
  const autoMatches: TransactionMatch[] = [];
  const suggestedMatches: TransactionMatch[] = [];
  const unmatchedBank: BankTransaction[] = [];

  for (const match of matches) {
    if (match.confidence === 'high') {
      autoMatches.push(match);
    } else if (match.confidence === 'medium') {
      suggestedMatches.push(match);
    } else {
      // low or none confidence
      unmatchedBank.push(match.bank_transaction);
    }
  }

  return { autoMatches, suggestedMatches, unmatchedBank };
}

/**
 * Find unmatched YNAB transactions
 * These are transactions in YNAB that don't appear on the bank statement
 */
function findUnmatchedYNAB(
  ynabTransactions: YNABTransaction[],
  matches: TransactionMatch[]
): YNABTransaction[] {
  const matchedIds = new Set<string>();

  for (const match of matches) {
    if (match.ynab_transaction) {
      matchedIds.add(match.ynab_transaction.id);
    }
  }

  return ynabTransactions.filter((txn) => !matchedIds.has(txn.id));
}

/**
 * Calculate balance information
 */
function calculateBalances(
  ynabTransactions: YNABTransaction[],
  statementBalance: number
): BalanceInfo {
  let clearedBalance = 0;
  let unclearedBalance = 0;

  for (const txn of ynabTransactions) {
    const amount = txn.amount / 1000; // Convert from milliunits to dollars

    if (txn.cleared === 'cleared' || txn.cleared === 'reconciled') {
      clearedBalance += amount;
    } else {
      unclearedBalance += amount;
    }
  }

  const totalBalance = clearedBalance + unclearedBalance;
  const discrepancy = clearedBalance - statementBalance;

  return {
    current_cleared: clearedBalance,
    current_uncleared: unclearedBalance,
    current_total: totalBalance,
    target_statement: statementBalance,
    discrepancy: discrepancy,
    on_track: Math.abs(discrepancy) < 0.01, // Within 1 cent
  };
}

/**
 * Generate reconciliation summary
 */
function generateSummary(
  bankTransactions: BankTransaction[],
  ynabTransactions: YNABTransaction[],
  autoMatches: TransactionMatch[],
  suggestedMatches: TransactionMatch[],
  unmatchedBank: BankTransaction[],
  unmatchedYNAB: YNABTransaction[],
  balances: BalanceInfo
): ReconciliationSummary {
  // Determine date range from bank transactions
  const dates = bankTransactions.map((t) => t.date).sort();
  const dateRange =
    dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'Unknown';

  // Build discrepancy explanation
  let discrepancyExplanation = '';
  if (balances.on_track) {
    discrepancyExplanation = 'Cleared balance matches statement';
  } else {
    const actionsNeeded: string[] = [];
    if (autoMatches.length > 0) {
      actionsNeeded.push(`clear ${autoMatches.length} transactions`);
    }
    if (unmatchedBank.length > 0) {
      actionsNeeded.push(`add ${unmatchedBank.length} missing`);
    }
    if (unmatchedYNAB.length > 0) {
      actionsNeeded.push(`review ${unmatchedYNAB.length} unmatched YNAB`);
    }

    discrepancyExplanation =
      actionsNeeded.length > 0
        ? `Need to ${actionsNeeded.join(', ')}`
        : 'Manual review required';
  }

  return {
    statement_date_range: dateRange,
    bank_transactions_count: bankTransactions.length,
    ynab_transactions_count: ynabTransactions.length,
    auto_matched: autoMatches.length,
    suggested_matches: suggestedMatches.length,
    unmatched_bank: unmatchedBank.length,
    unmatched_ynab: unmatchedYNAB.length,
    current_cleared_balance: balances.current_cleared,
    target_statement_balance: balances.target_statement,
    discrepancy: balances.discrepancy,
    discrepancy_explanation: discrepancyExplanation,
  };
}

/**
 * Generate next steps for user
 */
function generateNextSteps(summary: ReconciliationSummary): string[] {
  const steps: string[] = [];

  if (summary.auto_matched > 0) {
    steps.push(`Review ${summary.auto_matched} auto-matched transactions for approval`);
  }

  if (summary.suggested_matches > 0) {
    steps.push(`Review ${summary.suggested_matches} suggested matches and choose best match`);
  }

  if (summary.unmatched_bank > 0) {
    steps.push(`Decide whether to add ${summary.unmatched_bank} missing bank transactions to YNAB`);
  }

  if (summary.unmatched_ynab > 0) {
    steps.push(
      `Decide what to do with ${summary.unmatched_ynab} unmatched YNAB transactions (unclear/delete/ignore)`
    );
  }

  if (steps.length === 0) {
    steps.push('All transactions matched! Review and approve to complete reconciliation');
  }

  return steps;
}

function formatCurrency(amount: number): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(amount);
}

function repeatAmountInsights(unmatchedBank: BankTransaction[]): ReconciliationInsight[] {
  const insights: ReconciliationInsight[] = [];
  if (unmatchedBank.length === 0) {
    return insights;
  }

  const frequency = new Map<string, { amount: number; txns: BankTransaction[] }>();

  for (const txn of unmatchedBank) {
    const key = txn.amount.toFixed(2);
    const entry = frequency.get(key) ?? { amount: txn.amount, txns: [] };
    entry.txns.push(txn);
    frequency.set(key, entry);
  }

  const repeated = Array.from(frequency.values())
    .filter((entry) => entry.txns.length >= 2)
    .sort((a, b) => b.txns.length - a.txns.length);

  if (repeated.length === 0) {
    return insights;
  }

  const top = repeated[0]!;
  insights.push({
    id: `repeat-${top.amount.toFixed(2)}`,
    type: 'repeat_amount',
    severity: top.txns.length >= 4 ? 'critical' : 'warning',
    title: `${top.txns.length} unmatched transactions at ${formatCurrency(top.amount)}`,
    description:
      `The bank statement shows ${top.txns.length} unmatched transaction(s) at ${formatCurrency(top.amount)}. ` +
      'Repeated amounts are usually the quickest wins — reconcile these first.',
    evidence: {
      amount: top.amount,
      occurrences: top.txns.length,
      dates: top.txns.map((txn) => txn.date),
      csv_rows: top.txns.map((txn) => txn.original_csv_row),
    },
  });

  return insights;
}

function nearMatchInsights(
  matches: TransactionMatch[],
  config: MatchingConfig
): ReconciliationInsight[] {
  const insights: ReconciliationInsight[] = [];

  for (const match of matches) {
    if (!match.candidates || match.candidates.length === 0) continue;
    if (match.confidence === 'high') continue;

    const topCandidate = match.candidates[0]!;
    const score = topCandidate.confidence;
    const highSignal =
      (match.confidence === 'medium' && score >= config.autoMatchThreshold - 5) ||
      (match.confidence === 'low' && score >= config.suggestionThreshold) ||
      (match.confidence === 'none' && score >= config.suggestionThreshold);

    if (!highSignal) continue;

    const bankTxn = match.bank_transaction;
    const ynabTxn = topCandidate.ynab_transaction;

    insights.push({
      id: `near-${bankTxn.id}`,
      type: 'near_match',
      severity: score >= config.autoMatchThreshold ? 'warning' : 'info',
      title: `${formatCurrency(bankTxn.amount)} nearly matches ${formatCurrency(ynabTxn.amount / 1000)}`,
      description:
        `Bank transaction on ${bankTxn.date} (${formatCurrency(bankTxn.amount)}) nearly matches ` +
        `${ynabTxn.payee_name ?? 'unknown payee'} on ${ynabTxn.date}. Confidence ${score}% — review and confirm.`,
      evidence: {
        bank_transaction: {
          id: bankTxn.id,
          date: bankTxn.date,
          amount: bankTxn.amount,
          payee: bankTxn.payee,
        },
        candidate: {
          id: ynabTxn.id,
          date: ynabTxn.date,
          amount_milliunits: ynabTxn.amount,
          payee_name: ynabTxn.payee_name,
          confidence: score,
          reasons: topCandidate.match_reason,
        },
      },
    });
  }

  return insights.slice(0, 3);
}

function anomalyInsights(
  summary: ReconciliationSummary,
  balances: BalanceInfo
): ReconciliationInsight[] {
  const insights: ReconciliationInsight[] = [];
  const discrepancyAbs = Math.abs(balances.discrepancy);

  if (discrepancyAbs >= 1) {
    insights.push({
      id: 'balance-gap',
      type: 'anomaly',
      severity: discrepancyAbs >= 100 ? 'critical' : 'warning',
      title: `Cleared balance off by ${formatCurrency(balances.discrepancy)}`,
      description:
        `YNAB cleared balance is ${formatCurrency(balances.current_cleared)} but the statement expects ` +
        `${formatCurrency(balances.target_statement)}. Focus on closing this gap.`,
      evidence: {
        cleared_balance: balances.current_cleared,
        statement_balance: balances.target_statement,
        discrepancy: balances.discrepancy,
      },
    });
  }

  if (summary.unmatched_bank >= 5) {
    insights.push({
      id: 'bulk-missing-bank',
      type: 'anomaly',
      severity: summary.unmatched_bank >= 10 ? 'critical' : 'warning',
      title: `${summary.unmatched_bank} bank transactions still unmatched`,
      description:
        `There are ${summary.unmatched_bank} bank transactions without a match. ` +
        'Consider bulk importing or reviewing by date sequence.',
      evidence: {
        unmatched_bank: summary.unmatched_bank,
      },
    });
  }

  return insights;
}

function detectInsights(
  matches: TransactionMatch[],
  unmatchedBank: BankTransaction[],
  summary: ReconciliationSummary,
  balances: BalanceInfo,
  config: MatchingConfig
): ReconciliationInsight[] {
  const insights: ReconciliationInsight[] = [];
  const seen = new Set<string>();

  const addUnique = (insight: ReconciliationInsight) => {
    if (seen.has(insight.id)) return;
    seen.add(insight.id);
    insights.push(insight);
  };

  for (const insight of repeatAmountInsights(unmatchedBank)) {
    addUnique(insight);
  }

  for (const insight of nearMatchInsights(matches, config)) {
    addUnique(insight);
  }

  for (const insight of anomalyInsights(summary, balances)) {
    addUnique(insight);
  }

  return insights.slice(0, 5);
}

function mergeInsights(
  base: ReconciliationInsight[],
  additional: ReconciliationInsight[]
): ReconciliationInsight[] {
  if (additional.length === 0) {
    return base;
  }

  const seen = new Set(base.map((insight) => insight.id));
  const merged = [...base];

  for (const insight of additional) {
    if (seen.has(insight.id)) continue;
    seen.add(insight.id);
    merged.push(insight);
  }

  return merged.slice(0, 5);
}

/**
 * Perform reconciliation analysis
 *
 * @param csvContent - CSV file content or file path
 * @param csvFilePath - Optional file path (if csvContent is a path)
 * @param ynabTransactions - YNAB transactions from API
 * @param statementBalance - Expected cleared balance from statement
 * @param config - Matching configuration
 */
export function analyzeReconciliation(
  csvContent: string,
  csvFilePath: string | undefined,
  ynabTransactions: ynab.TransactionDetail[],
  statementBalance: number,
  config: MatchingConfig = DEFAULT_MATCHING_CONFIG as MatchingConfig
): ReconciliationAnalysis {
  // Step 1: Parse bank CSV
  const bankTransactions = parseBankStatement(csvContent, csvFilePath);

  // Step 2: Convert YNAB transactions
  const convertedYNABTxns = ynabTransactions.map(convertYNABTransaction);

  // Step 3: Run matching algorithm
  const matches = findMatches(bankTransactions, convertedYNABTxns, config);

  // Step 4: Categorize matches
  const { autoMatches, suggestedMatches, unmatchedBank } = categorizeMatches(matches);

  // Step 5: Find unmatched YNAB transactions
  const unmatchedYNAB = findUnmatchedYNAB(convertedYNABTxns, matches);

  let combinationMatches: TransactionMatch[] = [];
  let combinationInsights: ReconciliationInsight[] = [];

  if (ENABLE_COMBINATION_MATCHING) {
    const combinationResult = findCombinationMatches(unmatchedBank, unmatchedYNAB, config);
    combinationMatches = combinationResult.matches;
    combinationInsights = combinationResult.insights;
  }

  const enrichedSuggestedMatches = [...suggestedMatches, ...combinationMatches];

  // Step 6: Calculate balances
  const balances = calculateBalances(convertedYNABTxns, statementBalance);

  // Step 7: Generate summary
  const summary = generateSummary(
    bankTransactions,
    convertedYNABTxns,
    autoMatches,
    enrichedSuggestedMatches,
    unmatchedBank,
    unmatchedYNAB,
    balances
  );

  // Step 8: Generate next steps
  const nextSteps = generateNextSteps(summary);

  // Step 9: Detect insights and patterns
  const baseInsights = detectInsights(matches, unmatchedBank, summary, balances, config);
  const insights = mergeInsights(baseInsights, combinationInsights);

  return {
    success: true,
    phase: 'analysis',
    summary,
    auto_matches: autoMatches,
    suggested_matches: enrichedSuggestedMatches,
    unmatched_bank: unmatchedBank,
    unmatched_ynab: unmatchedYNAB,
    balance_info: balances,
    next_steps: nextSteps,
    insights,
  };
}
