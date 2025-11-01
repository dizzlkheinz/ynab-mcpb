/**
 * Reconciliation tool - Phase 1: Analysis Only
 * Implements guided reconciliation workflow with conservative matching
 */

import { z } from 'zod/v4';
import type * as ynab from 'ynab';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { withToolErrorHandling } from '../../types/index.js';
import { analyzeReconciliation } from './analyzer.js';
import type { MatchingConfig } from './types.js';
import { responseFormatter } from '../../server/responseFormatter.js';

// Re-export types for external use
export type * from './types.js';
export { analyzeReconciliation } from './analyzer.js';
export { findMatches, findBestMatch } from './matcher.js';
export {
  normalizePayee,
  normalizedMatch,
  fuzzyMatch,
  payeeSimilarity,
} from './payeeNormalizer.js';

/**
 * Schema for reconcile_account_v2 tool (Phase 1: Analysis Only)
 */
export const ReconcileAccountV2Schema = z.object({
  budget_id: z.string().min(1, 'Budget ID is required'),
  account_id: z.string().min(1, 'Account ID is required'),

  // CSV input (one required)
  csv_file_path: z.string().optional(),
  csv_data: z.string().optional(),

  // Statement information
  statement_balance: z.number({
    message: 'Statement balance is required and must be a number',
  }),
  statement_start_date: z.string().optional(),
  statement_end_date: z.string().optional(),

  // Matching configuration (optional)
  date_tolerance_days: z.number().min(0).max(7).optional().default(2),
  amount_tolerance_cents: z.number().min(0).max(100).optional().default(1),
  auto_match_threshold: z.number().min(0).max(100).optional().default(90),
  suggestion_threshold: z.number().min(0).max(100).optional().default(60),
}).refine(
  (data) => data.csv_file_path || data.csv_data,
  {
    message: 'Either csv_file_path or csv_data must be provided',
    path: ['csv_data'],
  }
);

export type ReconcileAccountV2Request = z.infer<typeof ReconcileAccountV2Schema>;

/**
 * Handle reconciliation analysis (Phase 1: Read-only analysis)
 *
 * This is the analysis-only implementation. No YNAB modifications are made.
 * Returns categorized matches for user review.
 */
export async function handleReconcileAccountV2(
  ynabAPI: ynab.API,
  params: ReconcileAccountV2Request
): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      // Build matching configuration from parameters
      const config: MatchingConfig = {
        dateToleranceDays: params.date_tolerance_days,
        amountToleranceCents: params.amount_tolerance_cents,
        descriptionSimilarityThreshold: 0.8, // Fixed for Phase 1
        autoMatchThreshold: params.auto_match_threshold,
        suggestionThreshold: params.suggestion_threshold,
      };

      // Fetch YNAB transactions for the account
      // Use date range if provided, otherwise get recent transactions
      const sinceDate = params.statement_start_date
        ? new Date(params.statement_start_date)
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

      const transactionsResponse = await ynabAPI.transactions.getTransactionsByAccount(
        params.budget_id,
        params.account_id,
        sinceDate.toISOString().split('T')[0]
      );

      const ynabTransactions = transactionsResponse.data.transactions;

      // Perform analysis
      const analysis = analyzeReconciliation(
        params.csv_data || params.csv_file_path || '',
        params.csv_file_path,
        ynabTransactions,
        params.statement_balance,
        config
      );

      // Format response
      const responseText = responseFormatter.format(analysis);

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    },
    'ynab:reconcile_account_v2',
    'analyzing account reconciliation'
  );
}
