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
import { toMoneyValueFromDecimal } from '../../utils/money.js';

const RECOMMENDATION_VERSION = '1.0';

/**
 * Generate actionable recommendations from reconciliation analysis
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
 * Create recommendation for suggested match
 */
function createSuggestedMatchRecommendation(
  match: TransactionMatch,
  context: RecommendationContext,
): CreateTransactionRecommendation | ReviewDuplicateRecommendation {
  const bankTxn = match.bank_transaction;

  // If there's a suggested YNAB transaction, review as possible duplicate
  if (match.ynab_transaction && match.confidence !== 'none') {
    return {
      id: randomUUID(),
      action_type: 'review_duplicate',
      priority: 'high',
      confidence: match.confidence_score / 100,
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

  // Otherwise suggest creating new transaction
  const parameters: CreateTransactionRecommendation['parameters'] = {
    account_id: context.account_id,
    date: bankTxn.date,
    amount: Math.abs(bankTxn.amount),
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
    confidence: 0.95,
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
    confidence: 0.7,
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
      confidence: 0.75,
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
    confidence: 0.5,
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

function createUnmatchedBankRecommendation(
  txn: BankTransaction,
  context: RecommendationContext,
): CreateTransactionRecommendation {
  const parameters: CreateTransactionRecommendation['parameters'] = {
    account_id: context.account_id,
    date: txn.date,
    amount: Math.abs(txn.amount),
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
    confidence: 0.8,
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

function createUpdateClearedRecommendation(
  txn: YNABTransaction,
  context: RecommendationContext,
): UpdateClearedRecommendation {
  return {
    id: randomUUID(),
    action_type: 'update_cleared',
    priority: 'low',
    confidence: 0.6,
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
  const priorityOrder = { high: 3, medium: 2, low: 1 };

  return recommendations.sort((a, b) => {
    // Sort by priority first
    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Then by confidence
    return b.confidence - a.confidence;
  });
}
