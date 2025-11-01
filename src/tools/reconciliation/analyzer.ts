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
  };
}
