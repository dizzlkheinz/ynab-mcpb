import { randomUUID } from 'crypto';
import type {
  ActionableRecommendation,
  CreateTransactionRecommendation,
  UpdateClearedRecommendation,
  ReviewDuplicateRecommendation,
  ManualReviewRecommendation,
  RecommendationContext,
  ReconciliationInsight,
  TransactionMatch,
  BankTransaction,
  YNABTransaction,
} from './types.js';
import { toMoneyValueFromDecimal, fromMilli, toMilli } from '../../utils/money.js';

const RECOMMENDATION_VERSION = '1.0';

/**
 * Confidence scores for different recommendation types
 */
const CONFIDENCE = {
  CREATE_EXACT_MATCH: 0.95,
  NEAR_MATCH_REVIEW: 0.7,
  REPEAT_AMOUNT: 0.75,
  ANOMALY_REVIEW: 0.5,
  UNMATCHED_BANK: 0.8,
  UPDATE_CLEARED: 0.6,
} as const;

/**
 * Priority order for sorting recommendations
 */
const PRIORITY_ORDER = { high: 3, medium: 2, low: 1 } as const;

/**
 * Generate actionable recommendations from reconciliation analysis.
 *
 * This function processes reconciliation analysis results and generates specific,
 * executable recommendations for resolving discrepancies. It analyzes insights,
 * unmatched transactions, and suggested matches to create prioritized actions.
 *
 * @param context - The recommendation context containing analysis results, IDs, and config
 * @param context.account_id - The YNAB account ID for transaction operations
 * @param context.budget_id - The YNAB budget ID (reserved for future category suggestions)
 * @param context.analysis - The complete reconciliation analysis results
 * @param context.matching_config - The matching configuration used during analysis
 * @returns Array of actionable recommendations sorted by priority and confidence
 *
 * @example
 * const recommendations = generateRecommendations({
 *   account_id: 'abc123',
 *   budget_id: 'budget-456',
 *   analysis: reconciliationAnalysis,
 *   matching_config: defaultConfig
 * });
 * // Returns recommendations like create_transaction, update_cleared, etc.
 */
export function generateRecommendations(
  context: RecommendationContext,
): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  // Process insights from analyzer
  for (const insight of context.analysis.insights) {
    const recs = processInsight(insight, context);
    recommendations.push(...recs);
  }

  // Process unmatched transactions
  const unmatchedRecs = processUnmatchedTransactions(context);
  recommendations.push(...unmatchedRecs);

  // Sort by priority and confidence
  return sortRecommendations(recommendations);
}

/**
 * Process a single insight into recommendations
 */
function processInsight(
  insight: ReconciliationInsight,
  context: RecommendationContext,
): ActionableRecommendation[] {
  switch (insight.type) {
    case 'near_match':
      return [createNearMatchRecommendation(insight, context)];

    case 'repeat_amount':
      return createRepeatAmountRecommendations(insight, context);

    case 'anomaly':
      return [createManualReviewRecommendation(insight, context)];

    default:
      return [];
  }
}

/**
 * Create recommendation for suggested match with intelligent routing.
 *
 * This function handles three distinct scenarios based on the match characteristics:
 *
 * 1. **Potential Duplicate** (has YNAB transaction + confidence score):
 *    Returns review_duplicate recommendation for manual verification
 *
 * 2. **Combination Match** (multiple YNAB transactions matching one bank transaction):
 *    Returns manual_review recommendation to investigate complex matching scenario
 *
 * 3. **Missing Transaction** (no matching YNAB transaction):
 *    Returns create_transaction recommendation with complete parameters
 *
 * @param match - The transaction match containing bank transaction and optional YNAB candidates
 * @param context - The recommendation context for account/budget IDs and analysis data
 * @returns Appropriate recommendation type based on match characteristics
 *
 * @example
 * // Scenario 1: Potential duplicate detected
 * const dupRec = createSuggestedMatchRecommendation(
 *   { bank_transaction, ynab_transaction, confidence: 'high', confidence_score: 85 },
 *   context
 * ); // Returns: review_duplicate
 *
 * @example
 * // Scenario 2: Combination match (2+ YNAB transactions)
 * const combRec = createSuggestedMatchRecommendation(
 *   { bank_transaction, candidates: [txn1, txn2], match_reason: 'combination_match' },
 *   context
 * ); // Returns: manual_review
 *
 * @example
 * // Scenario 3: Create missing transaction
 * const createRec = createSuggestedMatchRecommendation(
 *   { bank_transaction, confidence: 'none' },
 *   context
 * ); // Returns: create_transaction
 */
function createSuggestedMatchRecommendation(
  match: TransactionMatch,
  context: RecommendationContext,
): CreateTransactionRecommendation | ReviewDuplicateRecommendation | ManualReviewRecommendation {
  const bankTxn = match.bank_transaction;

  // If there's a suggested YNAB transaction, review as possible duplicate
  if (match.ynab_transaction && match.confidence !== 'none') {
    return {
      id: randomUUID(),
      action_type: 'review_duplicate',
      priority: 'high',
      confidence: Math.max(0, Math.min(1, match.confidence_score / 100)),
      message: `Review possible match: ${bankTxn.payee}`,
      reason: match.match_reason,
      estimated_impact: toMoneyValueFromDecimal(
        0,
        context.analysis.balance_info.current_cleared.currency
      ),
      account_id: context.account_id,
      metadata: {
        version: RECOMMENDATION_VERSION,
        created_at: new Date().toISOString(),
      },
      parameters: {
        candidate_ids: [match.ynab_transaction.id],
        bank_transaction: bankTxn,
        suggested_match_id: match.ynab_transaction.id,
      },
    };
  }

  // Check for combination matches (multiple YNAB transactions that together match the bank transaction)
  const isCombinationMatch =
    match.match_reason === 'combination_match' || (match.candidates?.length ?? 0) > 1;

  if (isCombinationMatch) {
    return createCombinationReviewRecommendation(match, context);
  }

  // Otherwise suggest creating new transaction
  const parameters: CreateTransactionRecommendation['parameters'] = {
    account_id: context.account_id,
    date: bankTxn.date,
    amount: toMilli(bankTxn.amount), // Convert dollars to milliunits for create_transaction
    payee_name: bankTxn.payee,
    cleared: 'cleared',
    approved: true,
  };

  if (bankTxn.memo) {
    parameters.memo = bankTxn.memo;
  }

  return {
    id: randomUUID(),
    action_type: 'create_transaction',
    priority: 'high',
    confidence: CONFIDENCE.CREATE_EXACT_MATCH,
    message: `Create transaction for ${bankTxn.payee}`,
    reason: `This transaction exactly matches your discrepancy`,
    estimated_impact: toMoneyValueFromDecimal(
      bankTxn.amount,
      context.analysis.balance_info.current_cleared.currency
    ),
    account_id: context.account_id,
    metadata: {
      version: RECOMMENDATION_VERSION,
      created_at: new Date().toISOString(),
    },
    parameters,
  };
}

/**
 * Create recommendation for combination match (multiple YNAB transactions matching one bank transaction)
 */
function createCombinationReviewRecommendation(
  match: TransactionMatch,
  context: RecommendationContext,
): ManualReviewRecommendation {
  const bankTxn = match.bank_transaction;
  const candidateIds = match.candidates?.map((candidate) => candidate.ynab_transaction.id) ?? [];

  // Calculate total amount from candidates for context (convert from milliunits to decimal)
  const candidateTotalAmount = match.candidates?.reduce(
    (sum, candidate) => {
      const amount = candidate.ynab_transaction.amount;
      if (!Number.isFinite(amount)) {
        console.warn(`Invalid candidate amount: ${amount}`);
        return sum;
      }
      return sum + fromMilli(amount);
    },
    0
  ) ?? 0;

  return {
    id: randomUUID(),
    action_type: 'manual_review',
    priority: 'medium',
    confidence: CONFIDENCE.NEAR_MATCH_REVIEW,
    message: `Review combination match: ${bankTxn.payee}`,
    reason:
      match.recommendation ??
      'Multiple YNAB transactions appear to match this bank transaction. Review before creating anything new.',
    estimated_impact: toMoneyValueFromDecimal(
      0,
      context.analysis.balance_info.current_cleared.currency,
    ),
    account_id: context.account_id,
    metadata: {
      version: RECOMMENDATION_VERSION,
      created_at: new Date().toISOString(),
      bank_transaction_amount: toMoneyValueFromDecimal(
        bankTxn.amount,
        context.analysis.balance_info.current_cleared.currency
      ),
      candidate_total_amount: toMoneyValueFromDecimal(
        candidateTotalAmount,
        context.analysis.balance_info.current_cleared.currency
      ),
      candidate_count: match.candidates?.length ?? 0,
    },
    parameters: {
      issue_type: 'complex_match',
      related_transactions: [
        {
          source: 'bank',
          id: bankTxn.id,
          description: bankTxn.payee,
        },
        ...candidateIds.map((id) => ({
          source: 'ynab' as const,
          id,
          description: match.candidates?.find((c) => c.ynab_transaction.id === id)?.ynab_transaction.payee_name ?? 'Unknown',
        })),
      ],
    },
  };
}

/**
 * Create recommendation for near match insight (possible duplicate)
 */
function createNearMatchRecommendation(
  insight: ReconciliationInsight,
  context: RecommendationContext,
): ManualReviewRecommendation {
  return {
    id: randomUUID(),
    action_type: 'manual_review',
    priority: 'medium',
    confidence: CONFIDENCE.NEAR_MATCH_REVIEW,
    message: `Review: ${insight.title}`,
    reason: insight.description,
    estimated_impact: toMoneyValueFromDecimal(
      0,
      context.analysis.balance_info.current_cleared.currency
    ),
    account_id: context.account_id,
    source_insight_id: insight.id,
    metadata: {
      version: RECOMMENDATION_VERSION,
      created_at: new Date().toISOString(),
      current_discrepancy: context.analysis.balance_info.discrepancy,
      insight_severity: insight.severity,
    },
    parameters: {
      issue_type: 'complex_match',
    },
  };
}

/**
 * Create recommendations for repeat amount pattern
 */
function createRepeatAmountRecommendations(
  insight: ReconciliationInsight,
  context: RecommendationContext,
): ManualReviewRecommendation[] {
  // For repeat amounts, suggest manual review since we need to identify the specific transactions
  return [
    {
      id: randomUUID(),
      action_type: 'manual_review',
      priority: 'medium',
      confidence: CONFIDENCE.REPEAT_AMOUNT,
      message: `Review recurring pattern: ${insight.title}`,
      reason: insight.description,
      estimated_impact: toMoneyValueFromDecimal(
        0,
        context.analysis.balance_info.current_cleared.currency
      ),
      account_id: context.account_id,
      source_insight_id: insight.id,
      metadata: {
        version: RECOMMENDATION_VERSION,
        created_at: new Date().toISOString(),
        current_discrepancy: context.analysis.balance_info.discrepancy,
        insight_severity: insight.severity,
      },
      parameters: {
        issue_type: 'complex_match',
      },
    },
  ];
}

/**
 * Create manual review recommendation (fallback)
 */
function createManualReviewRecommendation(
  insight: ReconciliationInsight,
  context: RecommendationContext,
): ManualReviewRecommendation {
  return {
    id: randomUUID(),
    action_type: 'manual_review',
    priority: 'low',
    confidence: CONFIDENCE.ANOMALY_REVIEW,
    message: `Review: ${insight.title}`,
    reason: insight.description,
    estimated_impact: toMoneyValueFromDecimal(
      0,
      context.analysis.balance_info.current_cleared.currency
    ),
    account_id: context.account_id,
    source_insight_id: insight.id,
    metadata: {
      version: RECOMMENDATION_VERSION,
      created_at: new Date().toISOString(),
      current_discrepancy: context.analysis.balance_info.discrepancy,
      insight_severity: insight.severity,
    },
    parameters: {
      issue_type: insight.severity === 'critical' ? 'large_discrepancy' : 'unknown',
    },
  };
}

/**
 * Process unmatched transactions into recommendations
 */
function processUnmatchedTransactions(
  context: RecommendationContext,
): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  // Unmatched bank transactions → create_transaction
  for (const bankTxn of context.analysis.unmatched_bank) {
    recommendations.push(createUnmatchedBankRecommendation(bankTxn, context));
  }

  // Suggested matches → review as potential duplicates or auto-match
  for (const match of context.analysis.suggested_matches) {
    recommendations.push(createSuggestedMatchRecommendation(match, context));
  }

  // Unmatched YNAB uncleared → update_cleared (lower priority)
  for (const ynabTxn of context.analysis.unmatched_ynab) {
    if (ynabTxn.cleared === 'uncleared') {
      recommendations.push(createUpdateClearedRecommendation(ynabTxn, context));
    }
  }

  return recommendations;
}

/**
 * Create a create_transaction recommendation for an unmatched bank transaction.
 *
 * Generates a recommendation to create a new YNAB transaction for a bank statement
 * entry that has no corresponding transaction in YNAB. The recommendation includes
 * complete parameters ready for execution via the create_transaction MCP tool.
 *
 * @param txn - The unmatched bank transaction
 * @param context - The recommendation context for account ID and currency
 * @returns create_transaction recommendation with medium priority and 0.8 confidence
 */
function createUnmatchedBankRecommendation(
  txn: BankTransaction,
  context: RecommendationContext,
): CreateTransactionRecommendation {
  const parameters: CreateTransactionRecommendation['parameters'] = {
    account_id: context.account_id,
    date: txn.date,
    amount: toMilli(txn.amount), // Convert dollars to milliunits for create_transaction
    payee_name: txn.payee,
    cleared: 'cleared',
    approved: true,
  };

  if (txn.memo) {
    parameters.memo = txn.memo;
  }

  return {
    id: randomUUID(),
    action_type: 'create_transaction',
    priority: 'medium',
    confidence: CONFIDENCE.UNMATCHED_BANK,
    message: `Create missing transaction: ${txn.payee}`,
    reason: 'Transaction appears on bank statement but not in YNAB',
    estimated_impact: toMoneyValueFromDecimal(
      txn.amount,
      context.analysis.balance_info.current_cleared.currency
    ),
    account_id: context.account_id,
    metadata: {
      version: RECOMMENDATION_VERSION,
      created_at: new Date().toISOString(),
    },
    parameters,
  };
}

/**
 * Create an update_cleared recommendation for an unmatched uncleared YNAB transaction.
 *
 * Generates a recommendation to mark an existing YNAB transaction as cleared. This is
 * used when a transaction exists in YNAB but is still marked as "uncleared" and may
 * correspond to a bank statement entry. This is a low-priority suggestion since the
 * transaction already exists and only needs status update.
 *
 * @param txn - The unmatched YNAB transaction (must have cleared status of 'uncleared')
 * @param context - The recommendation context for account ID and currency
 * @returns update_cleared recommendation with low priority and 0.6 confidence
 */
function createUpdateClearedRecommendation(
  txn: YNABTransaction,
  context: RecommendationContext,
): UpdateClearedRecommendation {
  return {
    id: randomUUID(),
    action_type: 'update_cleared',
    priority: 'low',
    confidence: CONFIDENCE.UPDATE_CLEARED,
    message: `Mark transaction as cleared: ${txn.payee_name || 'Unknown'}`,
    reason: 'Transaction exists in YNAB but not yet cleared',
    estimated_impact: toMoneyValueFromDecimal(
      0,
      context.analysis.balance_info.current_cleared.currency
    ),
    account_id: context.account_id,
    metadata: {
      version: RECOMMENDATION_VERSION,
      created_at: new Date().toISOString(),
    },
    parameters: {
      transaction_id: txn.id,
      cleared: 'cleared',
    },
  };
}

/**
 * Sort recommendations by priority and confidence
 */
function sortRecommendations(recommendations: ActionableRecommendation[]): ActionableRecommendation[] {
  return recommendations.sort((a, b) => {
    // Sort by priority first
    const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Then by confidence
    return b.confidence - a.confidence;
  });
}
