/**
 * Human-readable report formatting for reconciliation results
 * Implements Phase 3 of dual-channel output improvements
 */

import type { MoneyValue } from '../../utils/money.js';
import type { LegacyReconciliationResult } from './executor.js';
import type {
  BalanceInfo,
  BankTransaction,
  ReconciliationAnalysis,
  ReconciliationInsight,
  TransactionMatch,
  YNABTransaction,
} from './types.js';

const SECTION_DIVIDER = '-'.repeat(60);

/**
 * Options for report formatting
 */
export interface ReportFormatterOptions {
  accountName?: string | undefined;
  accountId?: string | undefined;
  currencyCode?: string | undefined;
  includeDetailedMatches?: boolean | undefined;
  maxUnmatchedToShow?: number | undefined;
  maxInsightsToShow?: number | undefined;
  notes?: string[] | undefined;
}

/**
 * Format the main human-readable reconciliation report
 */
export function formatHumanReadableReport(
  analysis: ReconciliationAnalysis,
  options: ReportFormatterOptions = {},
  execution?: LegacyReconciliationResult,
): string {
  const accountLabel = options.accountName ?? 'Account';
  const sections: string[] = [];

  // Header
  sections.push(formatHeader(accountLabel, analysis));

  // Contextual notes (if provided)
  if (options.notes && options.notes.length > 0) {
    sections.push(formatNotesSection(options.notes));
  }

  // Balance check section
  sections.push(formatBalanceSection(analysis.balance_info, analysis.summary));

  // Transaction analysis section
  sections.push(formatTransactionAnalysisSection(analysis, options));

  // Insights section (if any)
  if (analysis.insights.length > 0) {
    sections.push(formatInsightsSection(analysis.insights, options.maxInsightsToShow));
  }

  // Execution summary (if any)
  if (execution) {
    sections.push(formatExecutionSection(execution));
  }

  // Recommendations/Next steps
  sections.push(formatRecommendationsSection(analysis, execution));

  return sections.join('\n\n');
}

/**
 * Format the report header
 */
function formatHeader(accountName: string, analysis: ReconciliationAnalysis): string {
  const lines: string[] = [];
  lines.push(`${accountName} Reconciliation Report`);
  lines.push(SECTION_DIVIDER);
  lines.push(`Statement Period: ${analysis.summary.statement_date_range}`);
  return lines.join('\n');
}

function formatNotesSection(notes: string[]): string {
  const lines: string[] = [];
  lines.push('Notes');
  lines.push(SECTION_DIVIDER);
  for (const note of notes) {
    lines.push(`- ${note}`);
  }
  return lines.join('\n');
}

/**
 * Format the balance check section
 */
function formatBalanceSection(
  balanceInfo: BalanceInfo,
  summary: ReconciliationAnalysis['summary'],
): string {
  const lines: string[] = [];
  lines.push('Balance Check');
  lines.push(SECTION_DIVIDER);

  // Current balances
  lines.push(`- YNAB Cleared Balance:  ${summary.current_cleared_balance.value_display}`);
  lines.push(`- Statement Balance:     ${summary.target_statement_balance.value_display}`);
  lines.push('');

  // Discrepancy status
  const discrepancyMilli = balanceInfo.discrepancy.value_milliunits;
  if (discrepancyMilli === 0) {
    lines.push('Balances match perfectly.');
  } else {
    const direction = discrepancyMilli > 0 ? 'ynab_higher' : 'bank_higher';
    const directionLabel =
      direction === 'ynab_higher'
        ? 'YNAB shows MORE than statement'
        : 'Statement shows MORE than YNAB';

    lines.push(`Discrepancy: ${balanceInfo.discrepancy.value_display}`);
    lines.push(`Direction: ${directionLabel}`);
  }

  return lines.join('\n');
}

/**
 * Format the transaction analysis section
 */
function formatTransactionAnalysisSection(
  analysis: ReconciliationAnalysis,
  options: ReportFormatterOptions,
): string {
  const lines: string[] = [];
  lines.push('Transaction Analysis');
  lines.push(SECTION_DIVIDER);

  const summary = analysis.summary;

  // Show date range context if transactions were filtered
  const outsideRangeCount = summary.ynab_outside_range_count ?? 0;
  if (outsideRangeCount > 0) {
    const inRangeCount = summary.ynab_in_range_count ?? summary.ynab_transactions_count;
    lines.push(
      `Comparing ${summary.bank_transactions_count} bank transactions with ${inRangeCount} YNAB transactions within statement period.`,
    );
    lines.push(`(${outsideRangeCount} YNAB transactions outside statement period - not compared)`);
    lines.push('');
  }

  lines.push(
    `- Automatically matched:  ${summary.auto_matched} of ${summary.bank_transactions_count} transactions`,
  );
  lines.push(`- Suggested matches:      ${summary.suggested_matches}`);
  lines.push(`- Unmatched bank:         ${summary.unmatched_bank}`);
  lines.push(`- Unmatched YNAB:         ${summary.unmatched_ynab}`);

  // Show unmatched bank transactions (if any)
  if (analysis.unmatched_bank.length > 0) {
    lines.push('');
    lines.push('Missing from YNAB (bank transactions without matches):');
    const maxToShow = options.maxUnmatchedToShow ?? 5;
    const toShow = analysis.unmatched_bank.slice(0, maxToShow);

    for (const txn of toShow) {
      lines.push(formatBankTransactionLine(txn));
    }

    if (analysis.unmatched_bank.length > maxToShow) {
      lines.push(`   ... and ${analysis.unmatched_bank.length - maxToShow} more`);
    }
  }

  // Show unmatched YNAB transactions within date range (if any)
  if (analysis.unmatched_ynab.length > 0) {
    lines.push('');
    lines.push('Missing from bank statement (YNAB transactions without matches):');
    const maxToShow = options.maxUnmatchedToShow ?? 5;
    const toShow = analysis.unmatched_ynab.slice(0, maxToShow);

    for (const txn of toShow) {
      lines.push(formatYnabTransactionLine(txn));
    }

    if (analysis.unmatched_ynab.length > maxToShow) {
      lines.push(`   ... and ${analysis.unmatched_ynab.length - maxToShow} more`);
    }
  }

  // Show suggested matches (if any)
  if (analysis.suggested_matches.length > 0) {
    lines.push('');
    lines.push('Suggested matches (review manually):');
    const maxToShow = options.maxUnmatchedToShow ?? 3;
    const toShow = analysis.suggested_matches.slice(0, maxToShow);

    for (const match of toShow) {
      lines.push(formatSuggestedMatchLine(match));
    }

    if (analysis.suggested_matches.length > maxToShow) {
      lines.push(`   ... and ${analysis.suggested_matches.length - maxToShow} more suggestions`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a YNAB transaction line
 */
function formatYnabTransactionLine(txn: YNABTransaction): string {
  const amountStr = formatAmount(txn.amount);
  const payee = txn.payee ?? 'Unknown';
  return `   ${txn.date} - ${payee.substring(0, 40).padEnd(40)} ${amountStr}`;
}

/**
 * Format a bank transaction line
 */
function formatBankTransactionLine(txn: BankTransaction): string {
  const amountStr = formatAmount(txn.amount);
  return `   ${txn.date} - ${txn.payee.substring(0, 40).padEnd(40)} ${amountStr}`;
}

/**
 * Format a suggested match line
 */
function formatSuggestedMatchLine(match: TransactionMatch): string {
  const bankTxn = match.bankTransaction;
  const amountStr = formatAmount(bankTxn.amount);
  const confidenceStr = `${match.confidenceScore}%`;
  return `   ${bankTxn.date} - ${bankTxn.payee.substring(0, 35).padEnd(35)} ${amountStr} (${confidenceStr} confidence)`;
}

/**
 * Format an amount for display (input in milliunits)
 */
function formatAmount(amountMilli: number): string {
  const amount = amountMilli / 1000;
  const sign = amount >= 0 ? '+' : '-';
  const absAmount = Math.abs(amount);
  return `${sign}$${absAmount.toFixed(2)}`.padStart(10);
}

/**
 * Format the insights section
 */
function formatInsightsSection(insights: ReconciliationInsight[], maxToShow = 3): string {
  const lines: string[] = [];
  lines.push('Key Insights');
  lines.push(SECTION_DIVIDER);

  const toShow = insights.slice(0, maxToShow);
  for (const insight of toShow) {
    const severityIcon = getSeverityIcon(insight.severity);
    lines.push(`${severityIcon} ${insight.title}`);
    lines.push(`   ${insight.description}`);

    // Show evidence summary if available
    if (insight.evidence && Object.keys(insight.evidence).length > 0) {
      const evidenceSummary = formatEvidenceSummary(insight.evidence);
      if (evidenceSummary) {
        lines.push(`   Evidence: ${evidenceSummary}`);
      }
    }

    lines.push('');
  }

  if (insights.length > maxToShow) {
    lines.push(`... and ${insights.length - maxToShow} more insights (see structured output)`);
  }

  return lines.join('\n').trimEnd();
}

/**
 * Get text icon for severity level
 */
function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'critical':
      return '[CRITICAL]';
    case 'warning':
      return '[WARN]';
    case 'info':
      return '[INFO]';
    default:
      return '[NOTE]';
  }
}

/**
 * Format evidence summary from insight evidence object
 */
function formatEvidenceSummary(evidence: Record<string, unknown>): string | null {
  // Handle common evidence patterns
  if ('transaction_count' in evidence) {
    return `${evidence['transaction_count']} transactions`;
  }
  if ('amount' in evidence && typeof evidence['amount'] === 'object') {
    const amount = evidence['amount'] as MoneyValue;
    return amount.value_display;
  }
  if ('transaction_ids' in evidence && Array.isArray(evidence['transaction_ids'])) {
    return `${evidence['transaction_ids'].length} transactions involved`;
  }
  return null;
}

/**
 * Format the execution section
 */
function formatExecutionSection(execution: LegacyReconciliationResult): string {
  const lines: string[] = [];
  lines.push('Execution Summary');
  lines.push(SECTION_DIVIDER);

  const summary = execution.summary;
  lines.push(`Transactions created:  ${summary.transactions_created}`);
  lines.push(`Transactions updated:  ${summary.transactions_updated}`);
  lines.push(`Date adjustments:      ${summary.dates_adjusted}`);

  // Show top recommendations if any
  if (execution.recommendations.length > 0) {
    lines.push('');
    lines.push('Recommendations:');
    const maxRecs = 3;
    const toShow = execution.recommendations.slice(0, maxRecs);
    for (const rec of toShow) {
      lines.push(`  - ${rec}`);
    }
    if (execution.recommendations.length > maxRecs) {
      lines.push(`  ... and ${execution.recommendations.length - maxRecs} more`);
    }
  }

  lines.push('');
  if (summary.dry_run) {
    lines.push('NOTE: Dry run only - no YNAB changes were applied.');
  } else {
    lines.push('Changes applied to YNAB. Review structured output for action details.');
  }

  return lines.join('\n');
}

/**
 * Format the recommendations/next steps section
 */
function formatRecommendationsSection(
  analysis: ReconciliationAnalysis,
  execution?: LegacyReconciliationResult,
): string {
  const lines: string[] = [];
  lines.push('Recommended Actions');
  lines.push(SECTION_DIVIDER);

  // If we have execution results, recommendations are already shown
  if (execution && !execution.summary.dry_run) {
    lines.push('All recommended actions have been applied.');
    return lines.join('\n');
  }

  // Show next steps from analysis
  if (analysis.next_steps.length > 0) {
    for (const step of analysis.next_steps) {
      lines.push(`- ${step}`);
    }
  } else {
    lines.push('No specific actions recommended.');
    lines.push('Review the structured output for detailed match information.');
  }

  return lines.join('\n');
}

/**
 * Format a balance section (helper for backward compatibility)
 */
export function formatBalanceInfo(balance: BalanceInfo): string {
  const lines: string[] = [];
  lines.push(`Current Cleared:  ${balance.current_cleared.value_display}`);
  lines.push(`Current Total:    ${balance.current_total.value_display}`);
  lines.push(`Target Statement: ${balance.target_statement.value_display}`);
  lines.push(`Discrepancy:      ${balance.discrepancy.value_display}`);
  return lines.join('\n');
}

/**
 * Format transaction list (helper for detailed reports)
 */
type FormattableYnabTransaction = YNABTransaction & { payee_name?: string | null };

export function formatTransactionList(
  transactions: BankTransaction[] | YNABTransaction[],
  maxItems = 10,
): string {
  const lines: string[] = [];
  const toShow = transactions.slice(0, maxItems);

  for (const txn of toShow) {
    if ('cleared' in txn) {
      // YNAB transaction (normalized)
      const ynabTxn = txn as FormattableYnabTransaction;
      const payee = ynabTxn.payee_name ?? ynabTxn.payee ?? 'Unknown';
      lines.push(
        `   ${ynabTxn.date} - ${payee.substring(0, 40).padEnd(40)} ${formatAmount(ynabTxn.amount)}`,
      );
    } else {
      // Bank transaction
      lines.push(formatBankTransactionLine(txn as BankTransaction));
    }
  }

  if (transactions.length > maxItems) {
    lines.push(`   ... and ${transactions.length - maxItems} more`);
  }

  return lines.join('\n');
}
