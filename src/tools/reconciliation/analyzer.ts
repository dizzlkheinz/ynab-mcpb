/**
 * Analysis phase orchestration for reconciliation
 * Coordinates CSV parsing, YNAB transaction fetching, and matching
 */

import { randomUUID } from 'crypto';
import type * as ynab from 'ynab';
import { parseBankCSV, autoDetectCSVFormat } from '../compareTransactions/parser.js';
import { readFileSync } from 'fs';
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
function parseBankStatement(csvContent: string, csvFilePath?: string): BankTransaction[] {
  // Read file if path provided
  const content = csvFilePath ? readFileSync(csvFilePath, 'utf-8') : csvContent;

  // Auto-detect CSV format
  const format = autoDetectCSVFormat(content);

  // Parse bank transactions
  const transactions = parseBankCSV(content, format);

  // Generate UUIDs for bank transactions and map fields
  return transactions.map((txn, index) => ({
    id: randomUUID(),
    date: txn.date.toISOString().split('T')[0]!, // Convert Date to YYYY-MM-DD
    amount: txn.amount,
    payee: txn.description, // Map description to payee
    memo: '',
    original_csv_row: index + 2, // +2 for header and 0-indexed
  }));
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

  // Step 6: Calculate balances
  const balances = calculateBalances(convertedYNABTxns, statementBalance);

  // Step 7: Generate summary
  const summary = generateSummary(
    bankTransactions,
    convertedYNABTxns,
    autoMatches,
    suggestedMatches,
    unmatchedBank,
    unmatchedYNAB,
    balances
  );

  // Step 8: Generate next steps
  const nextSteps = generateNextSteps(summary);

  // Step 9: Detect insights and patterns
  const insights = detectInsights(matches, unmatchedBank, summary, balances, config);

  return {
    success: true,
    phase: 'analysis',
    summary,
    auto_matches: autoMatches,
    suggested_matches: suggestedMatches,
    unmatched_bank: unmatchedBank,
    unmatched_ynab: unmatchedYNAB,
    balance_info: balances,
    next_steps: nextSteps,
    insights,
  };
}
