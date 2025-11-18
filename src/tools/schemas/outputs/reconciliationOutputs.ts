/**
 * @fileoverview Reconciliation analysis output schemas for YNAB MCP server.
 * Defines Zod validation schemas for account reconciliation including transaction matching,
 * balance verification, insights, actionable recommendations, and optional execution results.
 *
 * @see src/tools/reconciliation/index.ts - Main reconciliation handler (lines 147-362)
 * @see src/tools/reconciliation/types.ts - Type definitions for reconciliation entities
 * @see src/tools/reconciliation/executor.ts - Execution engine for auto-applying recommendations
 * @see src/tools/reconcileAdapter.ts - Adapter for building reconciliation payloads
 * @see src/utils/money.ts - Money value formatting utilities
 *
 * @example
 * // Human-readable narrative only (default)
 * {
 *   human: "Successfully matched 45 of 50 bank transactions. Found 3 suggested matches..."
 * }
 *
 * @example
 * // With structured data (include_structured_data=true)
 * {
 *   human: "Successfully matched 45 of 50 bank transactions...",
 *   structured: {
 *     success: true,
 *     phase: "analysis",
 *     summary: {
 *       statement_date_range: "2025-10-01 to 2025-10-31",
 *       bank_transactions_count: 50,
 *       ynab_transactions_count: 52,
 *       auto_matched: 45,
 *       suggested_matches: 3,
 *       unmatched_bank: 2,
 *       unmatched_ynab: 4,
 *       discrepancy: { amount: -25.50, currency: "USD", formatted: "-$25.50" }
 *     },
 *     balance_info: {
 *       current_cleared: { amount: 1250.00, currency: "USD", formatted: "$1,250.00" },
 *       target_statement: { amount: 1275.50, currency: "USD", formatted: "$1,275.50" },
 *       discrepancy: { amount: -25.50, currency: "USD", formatted: "-$25.50" },
 *       on_track: false
 *     },
 *     recommendations: [...],
 *     audit_metadata: { data_freshness: "real-time", ... }
 *   }
 * }
 */

import { z } from 'zod';

// ============================================================================
// NESTED SCHEMAS FOR COMPOSITION
// ============================================================================

/**
 * Structured monetary value with formatting.
 * Used throughout reconciliation for balances and discrepancies.
 *
 * @see src/utils/money.ts - MoneyValue type definition
 */
export const MoneyValueSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  formatted: z.string(),
  memo: z.string().optional(),
});

export type MoneyValue = z.infer<typeof MoneyValueSchema>;

/**
 * Bank transaction from CSV import.
 * Represents a single transaction from the user's bank statement.
 *
 * @see src/tools/reconciliation/types.ts - BankTransaction interface
 */
export const BankTransactionSchema = z.object({
  id: z.string().uuid(),
  date: z.string().date(),
  amount: z.number(),
  payee: z.string(),
  memo: z.string().optional(),
  original_csv_row: z.number(),
});

export type BankTransaction = z.infer<typeof BankTransactionSchema>;

/**
 * Simplified YNAB transaction for reconciliation matching.
 * Contains essential fields for transaction comparison.
 *
 * @see src/tools/reconciliation/types.ts - YNABTransaction interface
 */
export const YNABTransactionSimpleSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number(),
  payee_name: z.string().nullable(),
  category_name: z.string().nullable(),
  cleared: z.enum(['cleared', 'uncleared', 'reconciled']),
  approved: z.boolean(),
  memo: z.string().nullable().optional(),
});

export type YNABTransactionSimple = z.infer<typeof YNABTransactionSimpleSchema>;

/**
 * Potential match candidate with confidence scoring.
 * Represents a possible match between bank and YNAB transactions.
 *
 * @see src/tools/reconciliation/types.ts - MatchCandidate interface
 */
export const MatchCandidateSchema = z.object({
  ynab_transaction: YNABTransactionSimpleSchema,
  confidence: z.number().min(0).max(100),
  match_reason: z.string(),
  explanation: z.string(),
});

export type MatchCandidate = z.infer<typeof MatchCandidateSchema>;

/**
 * Derives the confidence enum value from a numeric confidence score.
 * Used to enforce consistency between confidence and confidence_score fields.
 *
 * @param score - Numeric confidence score (0-100)
 * @returns Corresponding confidence level enum value
 *
 * @remarks
 * Export this function to use in application logic when constructing
 * TransactionMatch objects to ensure consistency between the two fields.
 *
 * Thresholds:
 * - 'high': score >= 90
 * - 'medium': score >= 60
 * - 'low': score >= 1
 * - 'none': score === 0
 *
 * @example
 * ```typescript
 * const confidenceScore = 85;
 * const transactionMatch = {
 *   // ... other fields
 *   confidence: deriveConfidenceFromScore(confidenceScore),
 *   confidence_score: confidenceScore,
 * };
 * ```
 */
export function deriveConfidenceFromScore(score: number): 'high' | 'medium' | 'low' | 'none' {
  if (score >= 90) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 1) return 'low';
  return 'none';
}

/**
 * Transaction match result with confidence and candidates.
 * Links a bank transaction to a YNAB transaction or suggests candidates.
 *
 * @see src/tools/reconciliation/types.ts - TransactionMatch interface
 *
 * @remarks
 * This schema contains both `confidence` (enum) and `confidence_score` (0-100)
 * for backwards compatibility. A validation rule enforces consistency between
 * the two fields by deriving the expected enum value from the numeric score
 * and rejecting mismatches.
 *
 * Confidence thresholds:
 * - 'high': confidence_score >= 90
 * - 'medium': confidence_score >= 60
 * - 'low': confidence_score >= 1
 * - 'none': confidence_score === 0
 */
export const TransactionMatchSchema = z.object({
  bank_transaction: BankTransactionSchema,
  ynab_transaction: YNABTransactionSimpleSchema.optional(),
  candidates: z.array(MatchCandidateSchema).optional(),
  confidence: z.enum(['high', 'medium', 'low', 'none']),
  confidence_score: z.number().min(0).max(100),
  match_reason: z.string(),
  top_confidence: z.number().optional(),
  action_hint: z.string().optional(),
  recommendation: z.string().optional(),
}).refine(
  (data) => {
    const expectedConfidence = deriveConfidenceFromScore(data.confidence_score);
    return data.confidence === expectedConfidence;
  },
  {
    message: 'Confidence mismatch: confidence enum does not match confidence_score',
    path: ['confidence'],
  }
);

export type TransactionMatch = z.infer<typeof TransactionMatchSchema>;

/**
 * Balance reconciliation status.
 * Compares current account balances to target statement balance.
 *
 * @see src/tools/reconciliation/types.ts - BalanceInfo interface
 */
export const BalanceInfoSchema = z.object({
  current_cleared: MoneyValueSchema,
  current_uncleared: MoneyValueSchema,
  current_total: MoneyValueSchema,
  target_statement: MoneyValueSchema,
  discrepancy: MoneyValueSchema,
  on_track: z.boolean(),
});

export type BalanceInfo = z.infer<typeof BalanceInfoSchema>;

/**
 * Reconciliation summary statistics.
 * High-level overview of matching results and balance status.
 *
 * @see src/tools/reconciliation/types.ts - ReconciliationSummary interface
 */
export const ReconciliationSummarySchema = z.object({
  statement_date_range: z.string(),
  bank_transactions_count: z.number(),
  ynab_transactions_count: z.number(),
  auto_matched: z.number(),
  suggested_matches: z.number(),
  unmatched_bank: z.number(),
  unmatched_ynab: z.number(),
  current_cleared_balance: MoneyValueSchema,
  target_statement_balance: MoneyValueSchema,
  discrepancy: MoneyValueSchema,
  discrepancy_explanation: z.string(),
});

export type ReconciliationSummary = z.infer<typeof ReconciliationSummarySchema>;

/**
 * Reconciliation analysis insight.
 * Highlights patterns, anomalies, or issues discovered during analysis.
 *
 * @see src/tools/reconciliation/types.ts - ReconciliationInsight interface
 */
export const ReconciliationInsightSchema = z.object({
  id: z.string(),
  type: z.enum(['repeat_amount', 'near_match', 'anomaly']),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string(),
  description: z.string(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

export type ReconciliationInsight = z.infer<typeof ReconciliationInsightSchema>;

/**
 * Actionable recommendation discriminated union.
 * Suggests specific actions to resolve discrepancies (create, update, review).
 *
 * @see src/tools/reconciliation/types.ts - ActionableRecommendation union type
 */
export const ActionableRecommendationSchema = z.discriminatedUnion('action_type', [
  // Create transaction recommendation
  z.object({
    id: z.string(),
    action_type: z.literal('create_transaction'),
    priority: z.enum(['high', 'medium', 'low']),
    confidence: z.number().min(0).max(1),
    message: z.string(),
    reason: z.string(),
    estimated_impact: MoneyValueSchema,
    account_id: z.string(),
    source_insight_id: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    parameters: z.object({
      account_id: z.string(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amount: z.number(),
      payee_name: z.string(),
      memo: z.string().optional(),
      cleared: z.enum(['cleared', 'uncleared']),
      approved: z.boolean(),
      category_id: z.string().optional(),
    }),
  }),
  // Update cleared status recommendation
  z.object({
    id: z.string(),
    action_type: z.literal('update_cleared'),
    priority: z.enum(['high', 'medium', 'low']),
    confidence: z.number().min(0).max(1),
    message: z.string(),
    reason: z.string(),
    estimated_impact: MoneyValueSchema,
    account_id: z.string(),
    source_insight_id: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    parameters: z.object({
      transaction_id: z.string(),
      cleared: z.enum(['cleared', 'uncleared', 'reconciled']),
    }),
  }),
  // Review duplicate recommendation
  z.object({
    id: z.string(),
    action_type: z.literal('review_duplicate'),
    priority: z.enum(['high', 'medium', 'low']),
    confidence: z.number().min(0).max(1),
    message: z.string(),
    reason: z.string(),
    estimated_impact: MoneyValueSchema,
    account_id: z.string(),
    source_insight_id: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    parameters: z.object({
      candidate_ids: z.array(z.string()),
      bank_transaction: BankTransactionSchema,
      suggested_match_id: z.string().optional(),
    }),
  }),
  // Manual review recommendation
  z.object({
    id: z.string(),
    action_type: z.literal('manual_review'),
    priority: z.enum(['high', 'medium', 'low']),
    confidence: z.number().min(0).max(1),
    message: z.string(),
    reason: z.string(),
    estimated_impact: MoneyValueSchema,
    account_id: z.string(),
    source_insight_id: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    parameters: z.object({
      issue_type: z.string(),
      related_transactions: z.array(z.string()),
    }),
  }),
]);

export type ActionableRecommendation = z.infer<typeof ActionableRecommendationSchema>;

/**
 * Execution result (present if auto-execution enabled).
 * Documents actions taken and resulting balance changes.
 *
 * @see src/tools/reconciliation/executor.ts - LegacyReconciliationResult interface
 */
export const ExecutionResultSchema = z.object({
  executed: z.boolean(),
  actions_taken: z.array(
    z.object({
      action_type: z.string(),
      status: z.enum(['success', 'failed']),
      transaction_id: z.string().optional(),
      error: z.string().optional(),
    })
  ),
  balance_after_execution: z
    .object({
      cleared: MoneyValueSchema,
      uncleared: MoneyValueSchema,
      total: MoneyValueSchema,
    })
    .optional(),
  reconciliation_complete: z.boolean(),
  remaining_discrepancy: MoneyValueSchema.optional(),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

/**
 * Data freshness audit metadata.
 * Documents data sources, cache status, and staleness.
 *
 * @see src/tools/reconciliation/index.ts:272-284 - Audit metadata construction
 */
export const AuditMetadataSchema = z.object({
  data_freshness: z.string(),
  data_source: z.string(),
  server_knowledge: z.number().optional(),
  fetched_at: z.string(),
  accounts_count: z.number(),
  transactions_count: z.number(),
  cache_status: z.object({
    accounts_cached: z.boolean(),
    transactions_cached: z.boolean(),
    delta_merge_applied: z.boolean(),
  }),
});

export type AuditMetadata = z.infer<typeof AuditMetadataSchema>;

// ============================================================================
// MAIN OUTPUT SCHEMA
// ============================================================================

/**
 * Complete reconciliation analysis output.
 * Discriminated union for human-only vs human+structured response modes.
 *
 * @see src/tools/reconciliation/index.ts:147-362 - Main handler
 * @see src/tools/reconcileAdapter.ts - buildReconciliationPayload function
 *
 * @example
 * // Human-readable narrative only (default)
 * {
 *   human: "Successfully matched 45 of 50 bank transactions. Current cleared balance..."
 * }
 *
 * @example
 * // With structured data (include_structured_data=true)
 * {
 *   human: "Successfully matched 45 of 50 bank transactions...",
 *   structured: {
 *     success: true,
 *     phase: "analysis",
 *     summary: {
 *       statement_date_range: "2025-10-01 to 2025-10-31",
 *       bank_transactions_count: 50,
 *       auto_matched: 45,
 *       suggested_matches: 3,
 *       unmatched_bank: 2,
 *       discrepancy: { amount: -25.50, currency: "USD", formatted: "-$25.50" }
 *     },
 *     auto_matches: [...],
 *     suggested_matches: [...],
 *     unmatched_bank: [...],
 *     unmatched_ynab: [...],
 *     balance_info: {
 *       current_cleared: { amount: 1250.00, currency: "USD", formatted: "$1,250.00" },
 *       target_statement: { amount: 1275.50, currency: "USD", formatted: "$1,275.50" },
 *       on_track: false
 *     },
 *     insights: [
 *       { id: "ins-1", type: "repeat_amount", severity: "warning", title: "Duplicate amount detected" }
 *     ],
 *     recommendations: [
 *       {
 *         id: "rec-1",
 *         action_type: "create_transaction",
 *         priority: "high",
 *         confidence: 0.95,
 *         message: "Create missing transaction for bank entry",
 *         parameters: { account_id: "acct-1", date: "2025-10-15", amount: -25500, ... }
 *       }
 *     ],
 *     execution_result: {
 *       executed: true,
 *       actions_taken: [{ action_type: "create_transaction", status: "success", transaction_id: "txn-new" }],
 *       reconciliation_complete: false,
 *       remaining_discrepancy: { amount: 0, currency: "USD", formatted: "$0.00" }
 *     },
 *     audit_metadata: {
 *       data_freshness: "real-time",
 *       data_source: "YNAB API + CSV",
 *       fetched_at: "2025-11-18T10:30:00Z",
 *       cache_status: { accounts_cached: false, transactions_cached: false }
 *     }
 *   }
 * }
 */
/**
 * CSV format configuration metadata.
 * Documents the CSV format detected or specified by the user.
 *
 * @see src/tools/reconciliation/index.ts:364-402 - mapCsvFormatForPayload function
 */
export const CsvFormatMetadataSchema = z.object({
  delimiter: z.string(),
  decimal_separator: z.string(),
  thousands_separator: z.string().nullable(),
  date_format: z.string(),
  header_row: z.boolean(),
  date_column: z.string().nullable(),
  amount_column: z.string().nullable(),
  payee_column: z.string().nullable(),
});

export type CsvFormatMetadata = z.infer<typeof CsvFormatMetadataSchema>;

export const ReconcileAccountOutputSchema = z.union([
  // Human narrative only (default mode)
  z.object({
    human: z.string(),
  }),
  // Human + structured data (when include_structured_data=true)
  z.object({
    human: z.string(),
    structured: z.object({
      success: z.boolean(),
      phase: z.literal('analysis'),
      summary: ReconciliationSummarySchema,
      auto_matches: z.array(TransactionMatchSchema),
      suggested_matches: z.array(TransactionMatchSchema),
      unmatched_bank: z.array(BankTransactionSchema),
      unmatched_ynab: z.array(YNABTransactionSimpleSchema),
      balance_info: BalanceInfoSchema,
      next_steps: z.array(z.string()),
      insights: z.array(ReconciliationInsightSchema),
      recommendations: z.array(ActionableRecommendationSchema).optional(),
      execution_result: ExecutionResultSchema.optional(),
      audit_metadata: AuditMetadataSchema,
      account_name: z.string(),
      account_id: z.string(),
      currency_code: z.string(),
      csv_format: CsvFormatMetadataSchema.optional(),
    }),
  }),
]);

export type ReconcileAccountOutput = z.infer<typeof ReconcileAccountOutputSchema>;
