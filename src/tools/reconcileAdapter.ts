import { toMoneyValue, toMoneyValueFromDecimal } from '../utils/money.js';
import type {
  ReconciliationAnalysis,
  TransactionMatch,
  BankTransaction,
  YNABTransaction,
  ReconciliationInsight,
} from './reconciliation/types.js';
import type { LegacyReconciliationResult, AccountSnapshot } from './reconciliation/executor.js';
import {
  formatHumanReadableReport,
  type ReportFormatterOptions,
} from './reconciliation/reportFormatter.js';

const OUTPUT_VERSION = '2.0';
const SCHEMA_URL =
  'https://raw.githubusercontent.com/dizzlkheinz/ynab-mcp-dxt/master/docs/schemas/reconciliation-v2.json';

interface AdapterOptions {
  accountName?: string;
  accountId?: string;
  currencyCode?: string;
  csvFormat?: CsvFormatPayload;
  auditMetadata?: Record<string, unknown>;
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
  discrepancy_analysis?:
    | {
        confidence_level: number;
        likely_causes: LegacyLikelyCause[];
        risk_assessment: string;
      }
    | undefined;
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

const convertSummary = (analysis: ReconciliationAnalysis) => ({
  statement_date_range: analysis.summary.statement_date_range,
  bank_transactions_count: analysis.summary.bank_transactions_count,
  ynab_transactions_count: analysis.summary.ynab_transactions_count,
  auto_matched: analysis.summary.auto_matched,
  suggested_matches: analysis.summary.suggested_matches,
  unmatched_bank: analysis.summary.unmatched_bank,
  unmatched_ynab: analysis.summary.unmatched_ynab,
  current_cleared_balance: analysis.summary.current_cleared_balance,
  target_statement_balance: analysis.summary.target_statement_balance,
  discrepancy: analysis.summary.discrepancy,
  discrepancy_explanation: analysis.summary.discrepancy_explanation,
});

const convertBalanceInfo = (analysis: ReconciliationAnalysis) => {
  const discrepancyMilli = analysis.balance_info.discrepancy.value_milliunits;
  const direction =
    discrepancyMilli === 0 ? 'balanced' : discrepancyMilli > 0 ? 'ynab_higher' : 'bank_higher';

  return {
    current_cleared: analysis.balance_info.current_cleared,
    current_uncleared: analysis.balance_info.current_uncleared,
    current_total: analysis.balance_info.current_total,
    target_statement: analysis.balance_info.target_statement,
    discrepancy: analysis.balance_info.discrepancy,
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
  precision: LegacyPrecisionCalculations,
  currency: string,
) => ({
  bank_statement_balance: toMoneyValue(precision.bank_statement_balance_milliunits, currency),
  ynab_calculated_balance: toMoneyValue(precision.ynab_calculated_balance_milliunits, currency),
  discrepancy: toMoneyValue(precision.discrepancy_milliunits, currency),
  discrepancy_decimal: toMoneyValueFromDecimal(precision.discrepancy_dollars, currency),
});

const convertLikelyCausesLegacy = (
  analysis: NonNullable<LegacyBalanceReconciliation['discrepancy_analysis']>,
  currency: string,
) => ({
  confidence_level: analysis.confidence_level,
  risk_assessment: analysis.risk_assessment,
  likely_causes: analysis.likely_causes.map((cause) => ({
    type: cause.cause_type.toLowerCase(),
    description: cause.description,
    confidence: cause.confidence,
    suggested_action: cause.suggested_resolution,
    amount: toMoneyValue(cause.amount_milliunits, currency),
    evidence: cause.evidence,
  })),
});

const convertBalanceReconciliationLegacy = (
  balance: LegacyBalanceReconciliation | undefined,
  currency: string,
) => {
  if (!balance) return undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {
    status: balance.status,
  };

  if (balance.precision_calculations) {
    result.precision_calculations = convertPrecisionCalculations(
      balance.precision_calculations,
      currency,
    );
  }

  if (balance.discrepancy_analysis) {
    result.discrepancy_analysis = convertLikelyCausesLegacy(balance.discrepancy_analysis, currency);
  }

  if (balance.final_verification) {
    result.final_verification = balance.final_verification;
  }

  return result;
};

const convertExecution = (execution: LegacyReconciliationResult, currency: string) => ({
  summary: execution.summary,
  account_balance: {
    before: convertAccountSnapshot(execution.account_balance.before, currency),
    after: convertAccountSnapshot(execution.account_balance.after, currency),
  },
  actions_taken: execution.actions_taken,
  recommendations: execution.recommendations,
  balance_reconciliation: convertBalanceReconciliationLegacy(
    execution.balance_reconciliation,
    currency,
  ),
});

// Helper functions for converting data structures (kept for structured output)

/**
 * Build human-readable narrative using the comprehensive report formatter
 */
const buildHumanNarrative = (
  analysis: ReconciliationAnalysis,
  options: AdapterOptions,
  execution?: LegacyReconciliationResult,
): string => {
  const formatterOptions: ReportFormatterOptions = {
    accountName: options.accountName,
    accountId: options.accountId,
    currencyCode: options.currencyCode,
    includeDetailedMatches: false,
    maxUnmatchedToShow: 5,
    maxInsightsToShow: 3,
  };

  return formatHumanReadableReport(analysis, formatterOptions, execution);
};

export const buildReconciliationPayload = (
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
    summary: convertSummary(analysis),
    balance: convertBalanceInfo(analysis),
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

  // Include recommendations if available
  if (analysis.recommendations && analysis.recommendations.length > 0) {
    structured['recommendations'] = analysis.recommendations;
  }

  if (options.csvFormat) {
    structured['csv_format'] = options.csvFormat;
  }

  if (executionView) {
    structured['execution'] = executionView;
  }

  if (options.auditMetadata) {
    structured['audit'] = options.auditMetadata;
  }

  return {
    human: buildHumanNarrative(analysis, options, execution),
    structured,
  };
};
