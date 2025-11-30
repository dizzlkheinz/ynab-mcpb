/**
 * Analysis phase orchestration for reconciliation
 * Coordinates CSV parsing, YNAB transaction fetching, and matching
 *
 * V2 UPDATE: Uses new parser and matcher (milliunits based)
 */

import type * as ynab from 'ynab';
import { parseCSV, type ParseCSVOptions, type CSVParseResult } from './csvParser.js';
import { findMatches, normalizeConfig, type MatchingConfig, DEFAULT_CONFIG } from './matcher.js';
import { normalizeYNABTransactions } from './ynabAdapter.js';

import type {
  BankTransaction,
  YNABTransaction,
  ReconciliationAnalysis,
  TransactionMatch,
  BalanceInfo,
  ReconciliationSummary,
  ReconciliationInsight,
} from './types.js';
import type { MatchResult } from './matcher.js'; // Import MatchResult
import { toMoneyValue } from '../../utils/money.js';
import { generateRecommendations } from './recommendationEngine.js';

// --- Helper Functions ---

function mapToTransactionMatch(result: MatchResult): TransactionMatch {
  const candidates = result.candidates.map((c) => ({
    ynab_transaction: c.ynabTransaction,
    confidence: c.scores.combined,
    match_reason: c.matchReasons.join(', '),
    explanation: c.matchReasons.join(', '),
  }));

  const match: TransactionMatch = {
    bankTransaction: result.bankTransaction,
    candidates,
    confidence: result.confidence,
    confidenceScore: result.confidenceScore,
    matchReason: result.bestMatch?.matchReasons.join(', ') ?? 'No match found',
    actionHint: result.confidence === 'high' ? 'approve' : 'review',
  };

  if (result.bestMatch) {
    match.ynabTransaction = result.bestMatch.ynabTransaction;
  }

  if (result.candidates[0]) {
    match.topConfidence = result.candidates[0].scores.combined;
  }

  if (result.confidence === 'none') {
    match.recommendation = 'This bank transaction is not in YNAB. Consider adding it.';
  }

  return match;
}

function calculateBalances(
  ynabTransactions: YNABTransaction[],
  statementBalanceDecimal: number,
  currency: string,
  accountSnapshot?: { balance?: number; cleared_balance?: number; uncleared_balance?: number },
): BalanceInfo {
  // Compute from the fetched transactions, but prefer the authoritative account snapshot
  // because we usually fetch a limited date window.
  let computedCleared = 0;
  let computedUncleared = 0;

  for (const txn of ynabTransactions) {
    const amount = txn.amount; // Milliunits

    if (txn.cleared === 'cleared' || txn.cleared === 'reconciled') {
      computedCleared += amount;
    } else {
      computedUncleared += amount;
    }
  }

  const clearedBalance = accountSnapshot?.cleared_balance ?? computedCleared;
  const unclearedBalance = accountSnapshot?.uncleared_balance ?? computedUncleared;
  const totalBalance = accountSnapshot?.balance ?? clearedBalance + unclearedBalance;

  const statementBalanceMilli = Math.round(statementBalanceDecimal * 1000);
  const discrepancy = clearedBalance - statementBalanceMilli;

  return {
    current_cleared: toMoneyValue(clearedBalance, currency),
    current_uncleared: toMoneyValue(unclearedBalance, currency),
    current_total: toMoneyValue(totalBalance, currency),
    target_statement: toMoneyValue(statementBalanceMilli, currency),
    discrepancy: toMoneyValue(discrepancy, currency),
    on_track: Math.abs(discrepancy) < 10, // Within 1 cent (10 milliunits)
  };
}

function generateSummary(
  bankTransactions: BankTransaction[],
  ynabTransactions: YNABTransaction[],
  autoMatches: TransactionMatch[],
  suggestedMatches: TransactionMatch[],
  unmatchedBank: BankTransaction[],
  unmatchedYNAB: YNABTransaction[],
  balances: BalanceInfo,
): ReconciliationSummary {
  // Determine date range from bank transactions
  const dates = bankTransactions.map((t) => t.date).sort();
  const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'Unknown';

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
      actionsNeeded.length > 0 ? `Need to ${actionsNeeded.join(', ')}` : 'Manual review required';
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
      `Decide what to do with ${summary.unmatched_ynab} unmatched YNAB transactions (unclear/delete/ignore)`,
    );
  }

  if (steps.length === 0) {
    steps.push('All transactions matched! Review and approve to complete reconciliation');
  }

  return steps;
}

function formatCurrency(amountMilli: number, currency: string = 'USD'): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(amountMilli / 1000);
}

// --- Insight Generation ---

function repeatAmountInsights(
  unmatchedBank: BankTransaction[],
  currency: string = 'USD',
): ReconciliationInsight[] {
  const insights: ReconciliationInsight[] = [];
  if (unmatchedBank.length === 0) {
    return insights;
  }

  // Group by milliunits amount
  const frequency = new Map<number, { amount: number; txns: BankTransaction[] }>();

  for (const txn of unmatchedBank) {
    const key = txn.amount;
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
    id: `repeat-${top.amount}`,
    type: 'repeat_amount',
    severity: top.txns.length >= 4 ? 'critical' : 'warning',
    title: `${top.txns.length} unmatched transactions at ${formatCurrency(top.amount, currency)}`,
    description:
      `The bank statement shows ${top.txns.length} unmatched transaction(s) at ${formatCurrency(top.amount, currency)}. ` +
      'Repeated amounts are usually the quickest wins — reconcile these first.',
    evidence: {
      amount: top.amount, // Milliunits
      occurrences: top.txns.length,
      dates: top.txns.map((txn) => txn.date),
      csv_rows: top.txns.map((txn) => txn.sourceRow),
    },
  });

  return insights;
}

function anomalyInsights(balances: BalanceInfo): ReconciliationInsight[] {
  const insights: ReconciliationInsight[] = [];
  const discrepancyAbs = Math.abs(balances.discrepancy.value_milliunits);

  if (discrepancyAbs >= 1000) {
    // 1 dollar
    insights.push({
      id: 'balance-gap',
      type: 'anomaly',
      severity: discrepancyAbs >= 100000 ? 'critical' : 'warning', // 100 dollars
      title: `Cleared balance off by ${balances.discrepancy.value_display}`,
      description:
        `YNAB cleared balance is ${balances.current_cleared.value_display} but the statement expects ` +
        `${balances.target_statement.value_display}. Focus on closing this gap.`,
      evidence: {
        cleared_balance: balances.current_cleared,
        statement_balance: balances.target_statement,
        discrepancy: balances.discrepancy,
      },
    });
  }

  return insights;
}

function detectInsights(
  unmatchedBank: BankTransaction[],
  _summary: ReconciliationSummary,
  balances: BalanceInfo,
  currency: string,
  csvErrors: { row: number; field: string; message: string }[] = [],
  csvWarnings: { row: number; message: string }[] = [],
): ReconciliationInsight[] {
  const insights: ReconciliationInsight[] = [];
  const seen = new Set<string>();

  const addUnique = (insight: ReconciliationInsight) => {
    if (seen.has(insight.id)) return;
    seen.add(insight.id);
    insights.push(insight);
  };

  // Surface CSV parsing errors
  if (csvErrors.length > 0) {
    addUnique({
      id: 'csv-parse-errors',
      type: 'anomaly',
      severity: csvErrors.length >= 5 ? 'critical' : 'warning',
      title: `${csvErrors.length} CSV parsing error(s)`,
      description:
        csvErrors
          .slice(0, 3)
          .map((e) => `Row ${e.row}: ${e.message}`)
          .join('; ') + (csvErrors.length > 3 ? ` (+${csvErrors.length - 3} more)` : ''),
      evidence: {
        error_count: csvErrors.length,
        errors: csvErrors.slice(0, 5),
      },
    });
  }

  // Surface CSV parsing warnings
  if (csvWarnings.length > 0) {
    addUnique({
      id: 'csv-parse-warnings',
      type: 'anomaly',
      severity: 'info',
      title: `${csvWarnings.length} CSV parsing warning(s)`,
      description:
        csvWarnings
          .slice(0, 3)
          .map((w) => `Row ${w.row}: ${w.message}`)
          .join('; ') + (csvWarnings.length > 3 ? ` (+${csvWarnings.length - 3} more)` : ''),
      evidence: {
        warning_count: csvWarnings.length,
        warnings: csvWarnings.slice(0, 5),
      },
    });
  }

  for (const insight of repeatAmountInsights(unmatchedBank, currency)) {
    addUnique(insight);
  }

  for (const insight of anomalyInsights(balances)) {
    addUnique(insight);
  }

  return insights.slice(0, 5);
}

// --- Main Analysis Function ---

/**
 * Perform reconciliation analysis
 *
 * @param csvContentOrParsed - CSV file content or pre-parsed result
 * @param csvFilePath - Optional file path (if csvContent is a path)
 * @param ynabTransactions - YNAB transactions from API
 * @param statementBalance - Expected cleared balance from statement
 * @param config - Matching configuration
 * @param currency - Currency code (default: USD)
 * @param accountId - Account ID for recommendation context
 * @param budgetId - Budget ID for recommendation context
 * @param invertBankAmounts - Whether to invert bank transaction amounts (for banks that show charges as positive)
 * @param csvOptions - Optional CSV parsing options (manual overrides)
 */
export function analyzeReconciliation(
  csvContentOrParsed: string | CSVParseResult,
  _csvFilePath: string | undefined,
  ynabTransactions: ynab.TransactionDetail[],
  statementBalance: number,
  config: MatchingConfig = DEFAULT_CONFIG,
  currency: string = 'USD',
  accountId?: string,
  budgetId?: string,
  invertBankAmounts: boolean = false,
  csvOptions?: ParseCSVOptions,
  accountSnapshot?: { balance?: number; cleared_balance?: number; uncleared_balance?: number },
): ReconciliationAnalysis {
  // Step 1: Parse bank CSV using new Parser (or use provided result)
  let parseResult: CSVParseResult;

  if (typeof csvContentOrParsed === 'string') {
    parseResult = parseCSV(csvContentOrParsed, {
      ...csvOptions,
      invertAmounts: invertBankAmounts,
    });
  } else {
    parseResult = csvContentOrParsed;
  }

  const newBankTransactions = parseResult.transactions;
  const csvParseErrors = parseResult.errors;
  const csvParseWarnings = parseResult.warnings;

  // Step 2: Normalize YNAB transactions
  const newYNABTransactions = normalizeYNABTransactions(ynabTransactions);

  // Step 3: Run new matching algorithm
  // Use normalizeConfig to convert legacy config to V2 format with defaults
  const normalizedConfig = normalizeConfig(config);

  const newMatches = findMatches(newBankTransactions, newYNABTransactions, normalizedConfig);
  const matches: TransactionMatch[] = newMatches.map(mapToTransactionMatch);

  // Categorize
  const autoMatches = matches.filter((m) => m.confidence === 'high');

  // Build set of YNAB transaction IDs that are already auto-matched
  const autoMatchedYnabIds = new Set<string>();
  autoMatches.forEach((m) => {
    if (m.ynabTransaction) autoMatchedYnabIds.add(m.ynabTransaction.id);
  });

  // Only suggest matches for YNAB transactions NOT already auto-matched
  const suggestedMatches = matches.filter(
    (m) =>
      m.confidence === 'medium' &&
      (!m.ynabTransaction || !autoMatchedYnabIds.has(m.ynabTransaction.id)),
  );

  const unmatchedBankMatches = matches.filter(
    (m) => m.confidence === 'low' || m.confidence === 'none',
  );
  const unmatchedBank = unmatchedBankMatches.map((m) => m.bankTransaction);

  // Find unmatched YNAB
  const matchedYnabIds = new Set<string>();
  matches.forEach((m) => {
    if (m.ynabTransaction) matchedYnabIds.add(m.ynabTransaction.id);
  });
  const unmatchedYNAB = newYNABTransactions.filter((t) => !matchedYnabIds.has(t.id));

  // Step 6: Calculate balances
  const balances = calculateBalances(
    newYNABTransactions,
    statementBalance,
    currency,
    accountSnapshot,
  );

  // Step 7: Generate summary
  const summary = generateSummary(
    matches.map((m) => m.bankTransaction),
    newYNABTransactions,
    autoMatches,
    suggestedMatches,
    unmatchedBank,
    unmatchedYNAB,
    balances,
  );

  // Step 8: Generate next steps
  const nextSteps = generateNextSteps(summary);

  // Step 9: Detect insights (including any CSV parsing issues)
  const insights = detectInsights(
    unmatchedBank,
    summary,
    balances,
    currency,
    csvParseErrors,
    csvParseWarnings,
  );

  // Step 10: Build the analysis result
  const analysis: ReconciliationAnalysis = {
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

  // Step 11: Generate recommendations
  if (accountId && budgetId) {
    const recommendations = generateRecommendations({
      account_id: accountId,
      budget_id: budgetId,
      analysis,
      matching_config: normalizedConfig,
    });
    analysis.recommendations = recommendations;
  }

  return analysis;
}
