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
import { buildReconciliationV2Payload } from '../reconcileV2Adapter.js';
import {
  executeReconciliation,
  type AccountSnapshot,
  type LegacyReconciliationResult,
} from './executor.js';

// Re-export types for external use
export type * from './types.js';
export { analyzeReconciliation } from './analyzer.js';
export { findMatches, findBestMatch } from './matcher.js';
export { normalizePayee, normalizedMatch, fuzzyMatch, payeeSimilarity } from './payeeNormalizer.js';

/**
 * Schema for reconcile_account_v2 tool (Phase 1: Analysis Only)
 */
export const ReconcileAccountV2Schema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    account_id: z.string().min(1, 'Account ID is required'),

    // CSV input (one required)
    csv_file_path: z.string().optional(),
    csv_data: z.string().optional(),

    csv_format: z
      .object({
        date_column: z.union([z.string(), z.number()]).optional().default('Date'),
        amount_column: z.union([z.string(), z.number()]).optional(),
        debit_column: z.union([z.string(), z.number()]).optional(),
        credit_column: z.union([z.string(), z.number()]).optional(),
        description_column: z.union([z.string(), z.number()]).optional().default('Description'),
        date_format: z.string().optional().default('MM/DD/YYYY'),
        has_header: z.boolean().optional().default(true),
        delimiter: z.string().optional().default(','),
      })
      .strict()
      .optional()
      .default(() => ({
        date_column: 'Date',
        amount_column: 'Amount',
        description_column: 'Description',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ',',
      })),

    // Statement information
    statement_balance: z.number({
      message: 'Statement balance is required and must be a number',
    }),
    statement_start_date: z.string().optional(),
    statement_end_date: z.string().optional(),
    statement_date: z.string().optional(),
    expected_bank_balance: z.number().optional(),
    as_of_timezone: z.string().optional(),

    // Matching configuration (optional)
    date_tolerance_days: z.number().min(0).max(7).optional().default(2),
    amount_tolerance_cents: z.number().min(0).max(100).optional().default(1),
    auto_match_threshold: z.number().min(0).max(100).optional().default(90),
    suggestion_threshold: z.number().min(0).max(100).optional().default(60),
    amount_tolerance: z.number().min(0).max(1).optional(),

    auto_create_transactions: z.boolean().optional().default(false),
    auto_update_cleared_status: z.boolean().optional().default(false),
    auto_unclear_missing: z.boolean().optional().default(true),
    auto_adjust_dates: z.boolean().optional().default(false),
    dry_run: z.boolean().optional().default(true),
    balance_verification_mode: z
      .enum(['ANALYSIS_ONLY', 'GUIDED_RESOLUTION', 'AUTO_RESOLVE'])
      .optional()
      .default('ANALYSIS_ONLY'),
    require_exact_match: z.boolean().optional().default(true),
    confidence_threshold: z.number().min(0).max(1).optional().default(0.8),
    max_resolution_attempts: z.number().int().min(1).max(10).optional().default(5),
  })
  .refine((data) => data.csv_file_path || data.csv_data, {
    message: 'Either csv_file_path or csv_data must be provided',
    path: ['csv_data'],
  });

export type ReconcileAccountV2Request = z.infer<typeof ReconcileAccountV2Schema>;

/**
 * Handle reconciliation analysis (Phase 1: Read-only analysis)
 *
 * This is the analysis-only implementation. No YNAB modifications are made.
 * Returns categorized matches for user review.
 */
export async function handleReconcileAccountV2(
  ynabAPI: ynab.API,
  params: ReconcileAccountV2Request,
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

      const accountsApi = ynabAPI.accounts as typeof ynabAPI.accounts & {
        getAccount?: (budgetId: string, accountId: string) => Promise<ynab.AccountResponse>;
      };
      const accountResponse = accountsApi.getAccount
        ? await accountsApi.getAccount(params.budget_id, params.account_id)
        : await accountsApi.getAccountById(params.budget_id, params.account_id);
      const accountData = accountResponse.data.account;
      const accountName = accountData?.name;

      const budgetResponse = await ynabAPI.budgets.getBudgetById(params.budget_id);
      const currencyCode = budgetResponse.data.budget?.currency_format?.iso_code ?? 'USD';

      // Fetch YNAB transactions for the account
      // Use date range if provided, otherwise get recent transactions
      const sinceDate = params.statement_start_date
        ? new Date(params.statement_start_date)
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

      const transactionsResponse = await ynabAPI.transactions.getTransactionsByAccount(
        params.budget_id,
        params.account_id,
        sinceDate.toISOString().split('T')[0],
      );

      const ynabTransactions = transactionsResponse.data.transactions;

      // Perform analysis
      const analysis = analyzeReconciliation(
        params.csv_data || params.csv_file_path || '',
        params.csv_file_path,
        ynabTransactions,
        params.statement_balance,
        config,
        currencyCode,
      );

      const initialAccount: AccountSnapshot = {
        balance: accountData?.balance ?? 0,
        cleared_balance: accountData?.cleared_balance ?? 0,
        uncleared_balance: accountData?.uncleared_balance ?? 0,
      };

      let executionData: LegacyReconciliationResult | undefined;
      const wantsBalanceVerification = Boolean(params.statement_date);
      const shouldExecute =
        params.auto_create_transactions ||
        params.auto_update_cleared_status ||
        params.auto_unclear_missing ||
        params.auto_adjust_dates ||
        params.balance_verification_mode !== 'ANALYSIS_ONLY' ||
        wantsBalanceVerification;

      if (shouldExecute) {
        executionData = await executeReconciliation({
          ynabAPI,
          analysis,
          params,
          budgetId: params.budget_id,
          accountId: params.account_id,
          initialAccount,
          currencyCode,
        });
      }

      const csvFormatForPayload = mapCsvFormatForPayload(params.csv_format);

      const adapterOptions: Parameters<typeof buildReconciliationV2Payload>[1] = {
        accountName,
        accountId: params.account_id,
        currencyCode,
      };
      if (csvFormatForPayload !== undefined) {
        adapterOptions.csvFormat = csvFormatForPayload;
      }

      const payload = buildReconciliationV2Payload(analysis, adapterOptions, executionData);

      return {
        content: [
          {
            type: 'text',
            text: payload.human,
          },
          {
            type: 'text',
            text: JSON.stringify(payload.structured, null, 2),
          },
        ],
      };
    },
    'ynab:reconcile_account_v2',
    'analyzing account reconciliation',
  );
}

function mapCsvFormatForPayload(format: ReconcileAccountV2Request['csv_format'] | undefined):
  | {
      delimiter: string;
      decimal_separator: string;
      thousands_separator: string | null;
      date_format: string;
      header_row: boolean;
      date_column: string | null;
      amount_column: string | null;
      payee_column: string | null;
    }
  | undefined {
  if (!format) {
    return undefined;
  }

  const coerceString = (value: string | number | undefined | null, fallback?: string) => {
    if (value === undefined || value === null) {
      return fallback ?? null;
    }
    return String(value);
  };

  const delimiter = coerceString(format.delimiter, ',');
  const decimalSeparator = '.'; // Default decimal separator
  const thousandsSeparator = ','; // Default thousands separator
  const dateFormat = coerceString(format.date_format, 'MM/DD/YYYY');

  return {
    delimiter: delimiter ?? ',',
    decimal_separator: decimalSeparator,
    thousands_separator: thousandsSeparator,
    date_format: dateFormat ?? 'MM/DD/YYYY',
    header_row: format.has_header ?? true,
    date_column: coerceString(format.date_column, '') ?? null,
    amount_column: coerceString(format.amount_column, '') ?? null,
    payee_column: coerceString(format.description_column, '') ?? null,
  };
}
