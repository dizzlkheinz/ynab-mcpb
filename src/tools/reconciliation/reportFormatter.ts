/**
 * Human-readable report formatting for reconciliation results
 * Implements Phase 3 of dual-channel output improvements
 */

import type {
  ReconciliationAnalysis,
  TransactionMatch,
  BankTransaction,
  YNABTransaction,
  ReconciliationInsight,
  BalanceInfo,
} from './types.js';
import type { LegacyReconciliationResult } from './executor.js';
import type { MoneyValue } from '../../utils/money.js';

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
  lines.push(`📊 ${accountName} Reconciliation Report`);
  lines.push('═'.repeat(60));
  lines.push(`Statement Period: ${analysis.summary.statement_date_range}`);
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
  lines.push('BALANCE CHECK');
  lines.push('═'.repeat(60));

  // Current balances
  lines.push(`✓ YNAB Cleared Balance:  ${summary.current_cleared_balance.value_display}`);
  lines.push(`✓ Statement Balance:     ${summary.target_statement_balance.value_display}`);
  lines.push('');

  // Discrepancy status
  const discrepancyMilli = balanceInfo.discrepancy.value_milliunits;
  if (discrepancyMilli === 0) {
    lines.push('✅ BALANCES MATCH PERFECTLY');
  } else {
    const direction = discrepancyMilli > 0 ? 'ynab_higher' : 'bank_higher';
    const directionLabel =
      direction === 'ynab_higher'
        ? 'YNAB shows MORE than statement'
        : 'Statement shows MORE than YNAB';

    lines.push(`❌ DISCREPANCY: ${balanceInfo.discrepancy.value_display}`);
    lines.push(`   Direction: ${directionLabel}`);
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
  lines.push('TRANSACTION ANALYSIS');
  lines.push('═'.repeat(60));

  const summary = analysis.summary;
  lines.push(
    `✓ Automatically matched:  ${summary.auto_matched} of ${summary.bank_transactions_count} transactions`,
  );
  lines.push(`✓ Suggested matches:      ${summary.suggested_matches}`);
  lines.push(`✓ Unmatched bank:         ${summary.unmatched_bank}`);
  lines.push(`✓ Unmatched YNAB:         ${summary.unmatched_ynab}`);

  // Show unmatched bank transactions (if any)
  if (analysis.unmatched_bank.length > 0) {
    lines.push('');
    lines.push('❌ UNMATCHED BANK TRANSACTIONS:');
    const maxToShow = options.maxUnmatchedToShow ?? 5;
    const toShow = analysis.unmatched_bank.slice(0, maxToShow);

    for (const txn of toShow) {
      lines.push(formatBankTransactionLine(txn));
    }

    if (analysis.unmatched_bank.length > maxToShow) {
      lines.push(`   ... and ${analysis.unmatched_bank.length - maxToShow} more`);
    }
  }

  // Show suggested matches (if any)
  if (analysis.suggested_matches.length > 0) {
    lines.push('');
    lines.push('💡 SUGGESTED MATCHES:');
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
  const bankTxn = match.bank_transaction;
  const amountStr = formatAmount(bankTxn.amount);
  const confidenceStr = `${match.confidence_score}%`;
  return `   ${bankTxn.date} - ${bankTxn.payee.substring(0, 35).padEnd(35)} ${amountStr} (${confidenceStr} confidence)`;
}

/**
 * Format an amount for display
 */
function formatAmount(amount: number): string {
  const sign = amount >= 0 ? '+' : '-';
  const absAmount = Math.abs(amount);
  return `${sign}$${absAmount.toFixed(2)}`.padStart(10);
}

/**
 * Format the insights section
 */
function formatInsightsSection(insights: ReconciliationInsight[], maxToShow: number = 3): string {
  const lines: string[] = [];
  lines.push('KEY INSIGHTS');
  lines.push('═'.repeat(60));

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
 * Get emoji icon for severity level
 */
function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'critical':
      return '🚨';
    case 'warning':
      return '⚠️';
    case 'info':
      return 'ℹ️';
    default:
      return '•';
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
  lines.push('EXECUTION SUMMARY');
  lines.push('═'.repeat(60));

  const summary = execution.summary;
  lines.push(`• Transactions created:  ${summary.transactions_created}`);
  lines.push(`• Transactions updated:  ${summary.transactions_updated}`);
  lines.push(`• Date adjustments:      ${summary.dates_adjusted}`);

  // Show top recommendations if any
  if (execution.recommendations.length > 0) {
    lines.push('');
    lines.push('Recommendations:');
    const maxRecs = 3;
    const toShow = execution.recommendations.slice(0, maxRecs);
    for (const rec of toShow) {
      lines.push(`  • ${rec}`);
    }
    if (execution.recommendations.length > maxRecs) {
      lines.push(`  ... and ${execution.recommendations.length - maxRecs} more`);
    }
  }

  lines.push('');
  if (summary.dry_run) {
    lines.push('⚠️  Dry run only — no YNAB changes were applied.');
  } else {
    lines.push('✅ Changes applied to YNAB. Review structured output for action details.');
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
  lines.push('RECOMMENDED ACTIONS');
  lines.push('═'.repeat(60));

  // If we have execution results, recommendations are already shown
  if (execution && !execution.summary.dry_run) {
    lines.push('All recommended actions have been applied.');
    return lines.join('\n');
  }

  // Show next steps from analysis
  if (analysis.next_steps.length > 0) {
    for (const step of analysis.next_steps) {
      lines.push(`• ${step}`);
    }
  } else {
    lines.push('• No specific actions recommended.');
    lines.push('• Review the structured output for detailed match information.');
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
export function formatTransactionList(
  transactions: BankTransaction[] | YNABTransaction[],
  maxItems: number = 10,
): string {
  const lines: string[] = [];
  const toShow = transactions.slice(0, maxItems);

  for (const txn of toShow) {
    if ('payee' in txn) {
      // Bank transaction
      lines.push(formatBankTransactionLine(txn));
    } else {
      // YNAB transaction
      const amount = txn.amount / 1000; // Convert milliunits to dollars
      const payee = txn.payee_name ?? 'Unknown';
      lines.push(`   ${txn.date} - ${payee.substring(0, 40).padEnd(40)} ${formatAmount(amount)}`);
    }
  }

  if (transactions.length > maxItems) {
    lines.push(`   ... and ${transactions.length - maxItems} more`);
  }

  return lines.join('\n');
}
