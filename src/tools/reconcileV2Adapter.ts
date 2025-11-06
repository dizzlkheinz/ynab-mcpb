import { toMoneyValue, toMoneyValueFromDecimal, toMilli } from '../utils/money.js';
import type {
  ReconciliationAnalysis,
  TransactionMatch,
  BankTransaction,
  YNABTransaction,
  ReconciliationInsight,
} from './reconciliation/types.js';
import type { LegacyReconciliationResult, AccountSnapshot } from './reconciliation/executor.js';

const OUTPUT_VERSION = '2.0';
const SCHEMA_URL = 'https://raw.githubusercontent.com/dizzlkheinz/ynab-mcp-dxt/master/docs/schemas/reconciliation-v2.json';

interface AdapterOptions {
  accountName?: string;
  accountId?: string;
  currencyCode?: string;
  csvFormat?: CsvFormatPayload;
}

interface DualChannelPayload {
  human: string;
  structured: Record<string, unknown>;
}

interface CsvFormatPayload {
  delimiter: string;
  decimal_separator: string;
  thousands_separator: string | null;
  date_format: string;
  header_row: boolean;
  date_column: string | null;
  amount_column: string | null;
  payee_column: string | null;
}

interface LegacyPrecisionCalculations {
  bank_statement_balance_milliunits: number;
  ynab_calculated_balance_milliunits: number;
  discrepancy_milliunits: number;
  discrepancy_dollars: number;
}

interface LegacyLikelyCause {
  cause_type: string;
  description: string;
  confidence: number;
  amount_milliunits: number;
  suggested_resolution: string;
  evidence: unknown[];
}

interface LegacyBalanceReconciliation {
  status: string;
  precision_calculations?: LegacyPrecisionCalculations;
  discrepancy_analysis?: {
    confidence_level: number;
    likely_causes: LegacyLikelyCause[];
    risk_assessment: string;
  };
  final_verification?: {
    balance_matches_exactly: boolean;
    all_transactions_accounted: boolean;
    audit_trail_complete: boolean;
    reconciliation_complete: boolean;
  };
}

const toBankTransactionView = (txn: BankTransaction, currency: string) => ({
  ...txn,
  amount_money: toMoneyValueFromDecimal(txn.amount, currency),
});

const toYNABTransactionView = (txn: YNABTransaction, currency: string) => ({
  ...txn,
  amount_money: toMoneyValue(txn.amount, currency),
});

const mapCauseType = (causeType: string): string => {
  switch (causeType) {
    case 'BANK_FEE':
      return 'bank_fee';
    case 'MISSING_TRANSACTION':
      return 'missing_transaction';
    default:
      return (causeType ?? '').toLowerCase();
  }
};

const convertMatch = (match: TransactionMatch, currency: string) => ({
  ...match,
  bank_transaction: toBankTransactionView(match.bank_transaction, currency),
  ynab_transaction: match.ynab_transaction
    ? toYNABTransactionView(match.ynab_transaction, currency)
    : undefined,
  candidates: match.candidates?.map((candidate) => ({
    ...candidate,
    ynab_transaction: toYNABTransactionView(candidate.ynab_transaction, currency),
  })),
});

const convertInsight = (insight: ReconciliationInsight) => ({
  id: insight.id,
  type: insight.type,
  severity: insight.severity,
  title: insight.title,
  description: insight.description,
  evidence: insight.evidence ?? {},
});

const convertSummary = (analysis: ReconciliationAnalysis, currency: string) => ({
  statement_date_range: analysis.summary.statement_date_range,
  bank_transactions_count: analysis.summary.bank_transactions_count,
  ynab_transactions_count: analysis.summary.ynab_transactions_count,
  auto_matched: analysis.summary.auto_matched,
  suggested_matches: analysis.summary.suggested_matches,
  unmatched_bank: analysis.summary.unmatched_bank,
  unmatched_ynab: analysis.summary.unmatched_ynab,
  current_cleared_balance: toMoneyValueFromDecimal(analysis.summary.current_cleared_balance, currency),
  target_statement_balance: toMoneyValueFromDecimal(analysis.summary.target_statement_balance, currency),
  discrepancy: toMoneyValueFromDecimal(analysis.summary.discrepancy, currency),
  discrepancy_explanation: analysis.summary.discrepancy_explanation,
});

const convertBalanceInfo = (analysis: ReconciliationAnalysis, currency: string) => {
  const cleared = toMoneyValueFromDecimal(analysis.balance_info.current_cleared, currency);
  const uncleared = toMoneyValueFromDecimal(analysis.balance_info.current_uncleared, currency);
  const total = toMoneyValueFromDecimal(analysis.balance_info.current_total, currency);
  const target = toMoneyValueFromDecimal(analysis.balance_info.target_statement, currency);
  const discrepancyMoney = toMoneyValueFromDecimal(analysis.balance_info.discrepancy, currency);
  const discrepancyMilli = toMilli(analysis.balance_info.discrepancy);
  const direction =
    discrepancyMilli === 0 ? 'balanced' : discrepancyMilli > 0 ? 'ynab_higher' : 'bank_higher';

  return {
    current_cleared: cleared,
    current_uncleared: uncleared,
    current_total: total,
    target_statement: target,
    discrepancy: discrepancyMoney,
    discrepancy_direction: direction,
    on_track: analysis.balance_info.on_track,
  };
};

const convertAccountSnapshot = (snapshot: AccountSnapshot, currency: string) => ({
  balance: toMoneyValue(snapshot.balance, currency),
  cleared_balance: toMoneyValue(snapshot.cleared_balance, currency),
  uncleared_balance: toMoneyValue(snapshot.uncleared_balance, currency),
});

const convertPrecisionCalculations = (
  precision: LegacyPrecisionCalculations | undefined,
  currency: string,
) => {
  if (!precision) return undefined;
  return {
    bank_statement_balance: toMoneyValue(precision.bank_statement_balance_milliunits, currency),
    ynab_calculated_balance: toMoneyValue(precision.ynab_calculated_balance_milliunits, currency),
    discrepancy: toMoneyValue(precision.discrepancy_milliunits, currency),
    discrepancy_decimal: toMoneyValueFromDecimal(precision.discrepancy_dollars, currency),
  };
};

const convertLikelyCausesLegacy = (
  analysis: LegacyBalanceReconciliation['discrepancy_analysis'] | undefined,
  currency: string,
) => {
  if (!analysis) return undefined;
  return {
    confidence_level: analysis.confidence_level ?? 0,
    risk_assessment: analysis.risk_assessment,
    likely_causes: (analysis.likely_causes ?? []).map((cause) => ({
      type: mapCauseType(cause.cause_type),
      description: cause.description,
      confidence: cause.confidence,
      suggested_action: cause.suggested_resolution,
      amount: toMoneyValue(cause.amount_milliunits ?? 0, currency),
      evidence: Array.isArray(cause.evidence) ? cause.evidence : [],
    })),
  };
};

const convertBalanceReconciliationLegacy = (
  balance: LegacyBalanceReconciliation | undefined,
  currency: string,
) => {
  if (!balance) return undefined;
  return {
    status: balance.status,
    precision_calculations: convertPrecisionCalculations(balance.precision_calculations, currency),
    discrepancy_analysis: convertLikelyCausesLegacy(balance.discrepancy_analysis, currency),
    final_verification: balance.final_verification,
  };
};

const convertExecution = (execution: LegacyReconciliationResult, currency: string) => ({
  summary: execution.summary,
  account_balance: {
    before: convertAccountSnapshot(execution.account_balance.before, currency),
    after: convertAccountSnapshot(execution.account_balance.after, currency),
  },
  actions_taken: execution.actions_taken,
  recommendations: execution.recommendations,
  balance_reconciliation: convertBalanceReconciliationLegacy(execution.balance_reconciliation, currency),
});

const selectTopInsights = (insights: ReconciliationInsight[], limit = 3) =>
  insights.slice(0, limit).map((insight) => convertInsight(insight));

const formatDiscrepancyLine = (balance: ReturnType<typeof convertBalanceInfo>) => {
  if (balance.discrepancy.value_milliunits === 0) {
    return '✅ Balances match the statement.';
  }

  const directionLabel =
    balance.discrepancy_direction === 'ynab_higher'
      ? 'YNAB cleared balance exceeds statement'
      : 'Statement shows more owed than YNAB';

  return `❌ Discrepancy: ${balance.discrepancy.value_display} (${directionLabel})`;
};

const buildHumanNarrative = (
  analysis: ReconciliationAnalysis,
  options: AdapterOptions,
  execution?: LegacyReconciliationResult,
): string => {
  const accountLabel = options.accountName ?? 'Account';
  const currency = options.currencyCode ?? 'USD';
  const balance = convertBalanceInfo(analysis, currency);
  const summary = convertSummary(analysis, currency);
  const topInsights = selectTopInsights(analysis.insights);

  const lines: string[] = [];
  lines.push(`📊 ${accountLabel} Reconciliation Report`);
  lines.push(`Statement Range: ${summary.statement_date_range}`);
  lines.push('');
  lines.push(`• YNAB Cleared Balance: ${summary.current_cleared_balance.value_display}`);
  lines.push(`• Statement Balance: ${summary.target_statement_balance.value_display}`);
  lines.push(formatDiscrepancyLine(balance));
  lines.push('');
  lines.push(
    `Matches: ${summary.auto_matched} auto, ${summary.suggested_matches} suggested, ` +
      `${summary.unmatched_bank} unmatched bank, ${summary.unmatched_ynab} unmatched YNAB`,
  );

  if (topInsights.length > 0) {
    lines.push('', 'Insights:');
    for (const insight of topInsights) {
      lines.push(`• [${insight.severity.toUpperCase()}] ${insight.title}`);
    }
  }

  if (analysis.next_steps.length > 0) {
    lines.push('', 'Next Steps:');
    for (const step of analysis.next_steps) {
      lines.push(`• ${step}`);
    }
  }

  if (execution) {
    lines.push('', 'Execution Summary:');
    lines.push(
      `• Transactions created: ${execution.summary.transactions_created}`,
    );
    lines.push(`• Transactions updated: ${execution.summary.transactions_updated}`);
    lines.push(`• Date adjustments: ${execution.summary.dates_adjusted}`);

    if (execution.recommendations.length > 0) {
      lines.push('', 'Recommendations:');
      for (const recommendation of execution.recommendations.slice(0, 3)) {
      lines.push(`• ${recommendation}`);
      }
      if (execution.recommendations.length > 3) {
        lines.push(`( +${execution.recommendations.length - 3} more recommendations )`);
      }
    }

    lines.push(
      '',
      execution.summary.dry_run
        ? 'Dry run only — no YNAB changes were applied.'
        : '✅ Changes applied to YNAB. Review structured output for action details.',
    );
  } else {
    lines.push('', 'Analysis only — no YNAB changes were applied.');
  }

  return lines.join('\n');
};

export const buildReconciliationV2Payload = (
  analysis: ReconciliationAnalysis,
  options: AdapterOptions = {},
  execution?: LegacyReconciliationResult,
): DualChannelPayload => {
  const currency = options.currencyCode ?? 'USD';
  const executionView = execution ? convertExecution(execution, currency) : undefined;

  const structured: Record<string, unknown> = {
    version: OUTPUT_VERSION,
    schema_url: SCHEMA_URL,
    generated_at: new Date().toISOString(),
    account: {
      id: options.accountId,
      name: options.accountName,
    },
    summary: convertSummary(analysis, currency),
    balance: convertBalanceInfo(analysis, currency),
    insights: analysis.insights.map(convertInsight),
    next_steps: analysis.next_steps,
    matches: {
      auto: analysis.auto_matches.map((match) => convertMatch(match, currency)),
      suggested: analysis.suggested_matches.map((match) => convertMatch(match, currency)),
    },
    unmatched: {
      bank: analysis.unmatched_bank.map((txn) => toBankTransactionView(txn, currency)),
      ynab: analysis.unmatched_ynab.map((txn) => toYNABTransactionView(txn, currency)),
    },
  };

  if (options.csvFormat) {
    structured.csv_format = options.csvFormat;
  }

  if (executionView) {
    structured.execution = executionView;
  }

  return {
    human: buildHumanNarrative(analysis, options, execution),
    structured,
  };
};
