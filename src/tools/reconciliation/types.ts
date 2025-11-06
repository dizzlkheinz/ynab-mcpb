/**
 * Type definitions for the reconciliation tool
 * Based on the 2025-10-31 reconciliation redesign specification
 */

import type { MoneyValue } from '../../utils/money.js';

/**
 * Matching confidence levels
 */
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

/**
 * Bank transaction parsed from CSV
 */
export interface BankTransaction {
  /** Generated UUID for tracking */
  id: string;
  /** Transaction date in YYYY-MM-DD format */
  date: string;
  /** Amount in dollars */
  amount: number;
  /** Payee/merchant name */
  payee: string;
  /** Optional memo/description */
  memo?: string;
  /** Original CSV row number for debugging */
  original_csv_row: number;
}

/**
 * YNAB transaction (simplified from API)
 */
export interface YNABTransaction {
  id: string;
  date: string;
  /** Amount in milliunits */
  amount: number;
  payee_name: string | null;
  category_name: string | null;
  cleared: 'cleared' | 'uncleared' | 'reconciled';
  approved: boolean;
  memo?: string | null;
}

/**
 * Match candidate with confidence score
 */
export interface MatchCandidate {
  ynab_transaction: YNABTransaction;
  confidence: number;
  match_reason: string;
  explanation: string;
}

/**
 * Transaction match result
 */
export interface TransactionMatch {
  bank_transaction: BankTransaction;
  /** Best matched YNAB transaction (if any) */
  ynab_transaction?: YNABTransaction;
  /** Alternative candidates for suggested matches */
  candidates?: MatchCandidate[];
  /** Confidence level */
  confidence: MatchConfidence;
  /** Confidence score 0-100 */
  confidence_score: number;
  /** Reason for the match */
  match_reason: string;
  /** Top confidence from candidates */
  top_confidence?: number;
  /** Action hint for user */
  action_hint?: string;
  /** Recommendation text */
  recommendation?: string;
}

/**
 * Balance information with structured monetary values
 */
export interface BalanceInfo {
  current_cleared: MoneyValue;
  current_uncleared: MoneyValue;
  current_total: MoneyValue;
  target_statement: MoneyValue;
  discrepancy: MoneyValue;
  on_track: boolean;
}

/**
 * Reconciliation summary statistics with structured monetary values
 */
export interface ReconciliationSummary {
  statement_date_range: string;
  bank_transactions_count: number;
  ynab_transactions_count: number;
  auto_matched: number;
  suggested_matches: number;
  unmatched_bank: number;
  unmatched_ynab: number;
  current_cleared_balance: MoneyValue;
  target_statement_balance: MoneyValue;
  discrepancy: MoneyValue;
  discrepancy_explanation: string;
}

/**
 * Insight severity levels
 */
export type InsightSeverity = 'info' | 'warning' | 'critical';

/**
 * Insight types for reconciliation analysis
 */
export type InsightKind = 'repeat_amount' | 'near_match' | 'anomaly';

/**
 * Reconciliation insight - highlights important findings that help explain discrepancies
 */
export interface ReconciliationInsight {
  id: string;
  type: InsightKind;
  severity: InsightSeverity;
  title: string;
  description: string;
  evidence?: Record<string, unknown>;
}

/**
 * Analysis phase result
 */
export interface ReconciliationAnalysis {
  success: true;
  phase: 'analysis';
  summary: ReconciliationSummary;
  auto_matches: TransactionMatch[];
  suggested_matches: TransactionMatch[];
  unmatched_bank: BankTransaction[];
  unmatched_ynab: YNABTransaction[];
  balance_info: BalanceInfo;
  next_steps: string[];
  insights: ReconciliationInsight[];
  recommendations?: ActionableRecommendation[];
}

/**
 * Reconciliation action types
 */
export type ReconciliationActionType = 'match' | 'add' | 'unclear' | 'delete' | 'ignore';

/**
 * Reconciliation action
 */
export interface ReconciliationAction {
  type: ReconciliationActionType;
  bank_txn_id?: string;
  ynab_txn_id?: string;
  mark_cleared?: boolean;
  create_as_cleared?: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Matching algorithm configuration
 */
export interface MatchingConfig {
  /** Date tolerance in days */
  dateToleranceDays: number;
  /** Amount tolerance in cents */
  amountToleranceCents: number;
  /** Description similarity threshold (0-1) */
  descriptionSimilarityThreshold: number;
  /** Confidence threshold for auto-matching (0-100) */
  autoMatchThreshold: number;
  /** Confidence threshold for suggestions (0-100) */
  suggestionThreshold: number;
}

/**
 * Default matching configuration (not type-only for use in code)
 */
export const DEFAULT_MATCHING_CONFIG = {
  dateToleranceDays: 2,
  amountToleranceCents: 1,
  descriptionSimilarityThreshold: 0.8,
  autoMatchThreshold: 90,
  suggestionThreshold: 60,
};

/**
 * Parsed CSV data from compareTransactions
 */
export interface ParsedCSVData {
  transactions: BankTransaction[];
  format_detected: string;
  delimiter: string;
  total_rows: number;
  valid_rows: number;
  errors: string[];
}
