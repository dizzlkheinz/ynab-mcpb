import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import { z } from 'zod/v4';
import { withToolErrorHandling } from '../types/index.js';
import { responseFormatter } from '../server/responseFormatter.js';
import {
  handleCompareTransactions,
  CompareTransactionsParams,
} from './compareTransactions/index.js';
import { handleCreateTransaction, CreateTransactionParams } from './transactionTools.js';
import { handleUpdateTransaction, UpdateTransactionParams } from './transactionTools.js';
import { handleGetAccount } from './accountTools.js';
import type { MoneyValue } from '../utils/money.js';

// In-memory session lock to prevent parallel reconciliation runs
const locks = new Set<string>();

function acquireLock(key: string) {
  if (locks.has(key)) throw new Error(`Reconciliation already running for ${key}`);
  locks.add(key);
}
function releaseLock(key: string) {
  locks.delete(key);
}

/**
 * Schema for ynab:reconcile_account tool parameters
 */
export const ReconcileAccountSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    account_id: z.string().min(1, 'Account ID is required'),
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
    auto_create_transactions: z.boolean().optional().default(false),
    auto_update_cleared_status: z.boolean().optional().default(false),
    auto_unclear_missing: z.boolean().optional().default(true),
    auto_adjust_dates: z.boolean().optional().default(false),
    dry_run: z.boolean().optional().default(true),
    amount_tolerance: z.number().min(0).max(1).optional().default(0.01),
    date_tolerance_days: z.number().min(0).max(7).optional().default(5),
    expected_bank_balance: z.number().optional(),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    bank_statement_balance: z.number().optional(),
    statement_date: z.string().optional(),
    statement_start_date: z.string().optional(),
    as_of_timezone: z.string().optional(),
    balance_verification_mode: z
      .enum(['ANALYSIS_ONLY', 'GUIDED_RESOLUTION', 'AUTO_RESOLVE'])
      .optional()
      .default('ANALYSIS_ONLY'),
    require_exact_match: z.boolean().optional().default(true),
    confidence_threshold: z.number().min(0).max(1).optional().default(0.8),
    max_resolution_attempts: z.number().int().min(1).max(10).optional().default(5),
  })
  .strict()
  .refine((data) => data.csv_file_path || data.csv_data, {
    message: 'Either csv_file_path or csv_data must be provided',
  });

export type ReconcileAccountParams = z.infer<typeof ReconcileAccountSchema>;

/**
 * Represents the result of a reconciliation operation
 */
interface ReconciliationResult {
  summary: {
    bank_transactions_count: number;
    ynab_transactions_count: number;
    matches_found: number;
    missing_in_ynab: number;
    missing_in_bank: number;
    transactions_created: number;
    transactions_updated: number;
    dates_adjusted: number;
    dry_run: boolean;
  };
  date_range: {
    start_date: string;
    end_date: string;
    bank_statement_range: {
      earliest_transaction: string;
      latest_transaction: string;
    };
    ynab_data_range: {
      earliest_transaction: string;
      latest_transaction: string;
    };
  };
  account_balance: {
    before: {
      balance: MoneyValue;
      cleared_balance: MoneyValue;
      uncleared_balance: MoneyValue;
    };
    after: {
      balance: MoneyValue;
      cleared_balance: MoneyValue;
      uncleared_balance: MoneyValue;
    };
  };
  actions_taken: {
    type: 'create_transaction' | 'update_transaction';
    transaction: Record<string, unknown>;
    reason: string;
  }[];
  matches: Record<string, unknown>[];
  missing_in_ynab: Record<string, unknown>[];
  missing_in_bank: Record<string, unknown>[];
  recommendations: string[];
  balance_reconciliation?: {
    status: string;
    precision_calculations?: {
      bank_statement_balance: MoneyValue;
      ynab_calculated_balance: MoneyValue;
      discrepancy: MoneyValue;
    };
    discrepancy_analysis?: {
      confidence_level: number;
      likely_causes: {
        cause_type: string;
        description: string;
        confidence: number;
        amount: MoneyValue;
        suggested_resolution: string;
        evidence: unknown[];
      }[];
      risk_assessment: string;
    };
    final_verification?: {
      balance_matches_exactly: boolean;
      all_transactions_accounted: boolean;
      audit_trail_complete: boolean;
      reconciliation_complete: boolean;
    };
  };
}

/**
 * Calculate cleared balance as of a specific date
 */
async function clearedBalanceAsOf(
  api: ynab.API,
  budgetId: string,
  accountId: string,
  dateISO: string,
): Promise<number> {
  const { assertMilli } = await import('../utils/money.js');

  const res = await api.transactions.getTransactionsByAccount(budgetId, accountId);
  const asOf = new Date(dateISO);
  const cleared = res.data.transactions.filter(
    (t) => t.cleared === 'cleared' && new Date(t.date) <= asOf,
  );
  const sum = cleared.reduce((acc, t) => acc + (t.amount ?? 0), 0);
  assertMilli(sum, 'YNAB returned non-integer milliunits');
  return sum;
}

/**
 * Handles the ynab:reconcile_account tool call
 * Performs comprehensive account reconciliation with bank statement data
 */
export async function handleReconcileAccount(
  ynabAPI: ynab.API,
  params: ReconcileAccountParams,
): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      const { toMoneyValue, toMilli, fromMilli } = await import('../utils/money.js');
      const parsed = ReconcileAccountSchema.parse(params);

      const lockKey = `${parsed.budget_id}:${parsed.account_id}`;
      acquireLock(lockKey);
      try {
        // Get initial account balance
        const initialAccountResult = await handleGetAccount(ynabAPI, {
          budget_id: parsed.budget_id,
          account_id: parsed.account_id,
        });
        const initialAccount = JSON.parse(
          (initialAccountResult.content[0]?.text as string) ?? '{"account":{}}',
        ).account;

        // Step 1: Compare transactions to identify discrepancies
        const compareParams: CompareTransactionsParams = {
          budget_id: parsed.budget_id,
          account_id: parsed.account_id,
          csv_file_path: parsed.csv_file_path,
          csv_data: parsed.csv_data,
          csv_format: parsed.csv_format,
          amount_tolerance: parsed.amount_tolerance,
          date_tolerance_days: parsed.date_tolerance_days,
          statement_start_date: parsed.statement_start_date,
          statement_date: parsed.statement_date,
          date_range_days: 30, // Use default value
          auto_detect_format: false, // Use default value
          enable_chronology_bonus: false, // Use default value
          debug: false, // Use default value
        };

        const comparisonResult = await handleCompareTransactions(ynabAPI, compareParams);
        const comparison = JSON.parse((comparisonResult.content[0]?.text as string) ?? '{}');

        // Determine actual date range from the data
        const bankTransactions = comparison.bank_transactions || [];
        const ynabTransactions = comparison.ynab_transactions || [];

        const bankDates = bankTransactions
          .map((t: { date: string }) => t.date)
          .filter(Boolean)
          .sort();
        const ynabDates = ynabTransactions
          .map((t: { date: string }) => t.date)
          .filter(Boolean)
          .sort();

        const bankEarliest = bankDates.length > 0 ? bankDates[0] : 'N/A';
        const bankLatest = bankDates.length > 0 ? bankDates[bankDates.length - 1] : 'N/A';
        const ynabEarliest = ynabDates.length > 0 ? ynabDates[0] : 'N/A';
        const ynabLatest = ynabDates.length > 0 ? ynabDates[ynabDates.length - 1] : 'N/A';

        // Use provided date range or determine from data
        const startDate = parsed.start_date || bankEarliest;
        const endDate = parsed.end_date || bankLatest;

        // Initialize result object
        const result: ReconciliationResult = {
          summary: {
            bank_transactions_count: comparison.summary.bank_transactions_count,
            ynab_transactions_count: comparison.summary.ynab_transactions_count,
            matches_found: comparison.summary.matches_found,
            missing_in_ynab: comparison.summary.missing_in_ynab,
            missing_in_bank: comparison.summary.missing_in_bank,
            transactions_created: 0,
            transactions_updated: 0,
            dates_adjusted: 0,
            dry_run: parsed.dry_run,
          },
          date_range: {
            start_date: startDate,
            end_date: endDate,
            bank_statement_range: {
              earliest_transaction: bankEarliest,
              latest_transaction: bankLatest,
            },
            ynab_data_range: {
              earliest_transaction: ynabEarliest,
              latest_transaction: ynabLatest,
            },
          },
          account_balance: {
            before: {
              balance: toMoneyValue(initialAccount.balance),
              cleared_balance: toMoneyValue(initialAccount.cleared_balance),
              uncleared_balance: toMoneyValue(initialAccount.uncleared_balance),
            },
            after: {
              balance: toMoneyValue(initialAccount.balance),
              cleared_balance: toMoneyValue(initialAccount.cleared_balance),
              uncleared_balance: toMoneyValue(initialAccount.uncleared_balance),
            },
          },
          actions_taken: [],
          matches: comparison.matches,
          missing_in_ynab: comparison.missing_in_ynab,
          missing_in_bank: comparison.missing_in_bank,
          recommendations: [],
        };

        // Step 1.5: Balance verification (if bank statement balance provided)
        let balance_reconciliation: ReconciliationResult['balance_reconciliation'];

        if (parsed.bank_statement_balance != null && parsed.statement_date) {
          const bankMilli = toMilli(parsed.bank_statement_balance);
          const ynabMilli = await clearedBalanceAsOf(
            ynabAPI,
            parsed.budget_id,
            parsed.account_id,
            parsed.statement_date,
          );
          const discrepancy = bankMilli - ynabMilli;
          const exact = discrepancy === 0;

          if (exact) {
            balance_reconciliation = {
              status: 'PERFECTLY_RECONCILED',
              precision_calculations: {
                bank_statement_balance: toMoneyValue(bankMilli),
                ynab_calculated_balance: toMoneyValue(ynabMilli),
                discrepancy: toMoneyValue(0),
              },
              discrepancy_analysis: {
                confidence_level: 1,
                likely_causes: [],
                risk_assessment: 'LOW',
              },
              final_verification: {
                balance_matches_exactly: true,
                all_transactions_accounted:
                  comparison?.summary?.missing_in_ynab === 0 &&
                  comparison?.summary?.missing_in_bank === 0,
                audit_trail_complete: true,
                reconciliation_complete: true,
              },
            };
          } else {
            // Minimal seed analysis; you can expand later
            const abs = Math.abs(discrepancy);
            const likely = [];
            if (abs % 1000 === 0 || abs % 500 === 0) {
              likely.push({
                cause_type: 'BANK_FEE',
                description: 'Round amount suggests bank fee or interest',
                confidence: 0.82,
                amount: toMoneyValue(discrepancy),
                suggested_resolution:
                  discrepancy < 0
                    ? 'Create Bank Fee transaction (cleared)'
                    : 'Create Interest Earned transaction (cleared)',
                evidence: [],
              });
            }
            balance_reconciliation = {
              status: 'DISCREPANCY_FOUND',
              precision_calculations: {
                bank_statement_balance: toMoneyValue(bankMilli),
                ynab_calculated_balance: toMoneyValue(ynabMilli),
                discrepancy: toMoneyValue(discrepancy),
              },
              discrepancy_analysis: {
                confidence_level: Math.max(0, ...likely.map((l) => l.confidence)),
                likely_causes: likely,
                risk_assessment: 'LOW',
              },
              final_verification: {
                balance_matches_exactly: false,
                all_transactions_accounted: false,
                audit_trail_complete: false,
                reconciliation_complete: false,
              },
            };

            if (parsed.balance_verification_mode === 'GUIDED_RESOLUTION') {
              // TODO (later): preview → approve → execute loop with audit/rollback
            }
          }
        }

        // Step 2: Create missing transactions in YNAB (if enabled and not dry run)
        if (parsed.auto_create_transactions && !parsed.dry_run) {
          for (const missingTxn of comparison.missing_in_ynab) {
            try {
              const createParams: CreateTransactionParams = {
                budget_id: parsed.budget_id,
                account_id: parsed.account_id,
                amount: Math.round(parseFloat(missingTxn.amount) * 1000), // Convert to milliunits
                date: missingTxn.date,
                payee_name: missingTxn.suggested_payee_name || missingTxn.description,
                memo: `Auto-reconciled from bank statement`,
                cleared: 'cleared',
                approved: true,
              };

              const createResult = await handleCreateTransaction(ynabAPI, createParams);
              const createdTransaction = JSON.parse(
                (createResult.content[0]?.text as string) ?? '{}',
              );

              result.actions_taken.push({
                type: 'create_transaction',
                transaction: createdTransaction.transaction,
                reason: `Created missing transaction: ${missingTxn.description}`,
              });
              result.summary.transactions_created++;

              // Update final account balance from the last transaction creation
              if (createdTransaction.account_balance !== undefined) {
                result.account_balance.after.balance = toMoneyValue(
                  createdTransaction.account_balance,
                );
                result.account_balance.after.cleared_balance = toMoneyValue(
                  createdTransaction.account_cleared_balance,
                );
                result.account_balance.after.uncleared_balance = toMoneyValue(
                  createdTransaction.account_balance - createdTransaction.account_cleared_balance,
                );
              }
            } catch (error) {
              result.recommendations.push(
                `Failed to create transaction "${missingTxn.description}": ${error instanceof Error ? error.message : 'Unknown error'}`,
              );
            }
          }
        }

        // Step 3: Update transaction statuses and dates (if enabled and not dry run)
        if ((parsed.auto_update_cleared_status || parsed.auto_adjust_dates) && !parsed.dry_run) {
          for (const match of comparison.matches) {
            if (match.ynab_transaction && match.bank_transaction) {
              const needsClearedUpdate = match.ynab_transaction.cleared !== 'cleared';
              const needsDateUpdate =
                parsed.auto_adjust_dates &&
                match.ynab_transaction.date !== match.bank_transaction.date;

              if (needsClearedUpdate || needsDateUpdate) {
                try {
                  const updateParams: UpdateTransactionParams = {
                    budget_id: parsed.budget_id,
                    transaction_id: match.ynab_transaction.id,
                  };

                  if (needsClearedUpdate && parsed.auto_update_cleared_status) {
                    updateParams.cleared = 'cleared';
                  }

                  if (needsDateUpdate) {
                    updateParams.date = match.bank_transaction.date;
                  }

                  const updateResult = await handleUpdateTransaction(ynabAPI, updateParams);
                  const updatedTransaction = JSON.parse(
                    (updateResult.content[0]?.text as string) ?? '{}',
                  );

                  const reasons = [];
                  if (needsClearedUpdate && parsed.auto_update_cleared_status) {
                    reasons.push('marked as cleared');
                  }
                  if (needsDateUpdate) {
                    reasons.push(
                      `date adjusted from ${match.ynab_transaction.date} to ${match.bank_transaction.date}`,
                    );
                    result.summary.dates_adjusted++;
                  }

                  result.actions_taken.push({
                    type: 'update_transaction',
                    transaction: updatedTransaction.transaction,
                    reason: `Updated transaction: ${reasons.join(', ')}`,
                  });
                  result.summary.transactions_updated++;

                  // Update final account balance from the last transaction update
                  if (updatedTransaction.updated_balance !== undefined) {
                    result.account_balance.after.balance = toMoneyValue(
                      updatedTransaction.updated_balance,
                    );
                    result.account_balance.after.cleared_balance = toMoneyValue(
                      updatedTransaction.updated_cleared_balance,
                    );
                    result.account_balance.after.uncleared_balance = toMoneyValue(
                      updatedTransaction.updated_balance -
                        updatedTransaction.updated_cleared_balance,
                    );
                  }
                } catch (error) {
                  result.recommendations.push(
                    `Failed to update transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  );
                }
              }
            }
          }
        }

        // Step 4: Balance reconciliation is now handled in Step 1.5 above

        // Step 5: Handle cleared YNAB transactions missing from bank (if enabled and not dry run)
        if (parsed.auto_unclear_missing && !parsed.dry_run) {
          for (const missingTxn of comparison.missing_in_bank) {
            // Only unclear transactions that are currently cleared (not reconciled)
            if (missingTxn.cleared === 'cleared') {
              try {
                const updateParams: UpdateTransactionParams = {
                  budget_id: parsed.budget_id,
                  transaction_id: missingTxn.id,
                  cleared: 'uncleared',
                };

                const updateResult = await handleUpdateTransaction(ynabAPI, updateParams);
                const updatedTransaction = JSON.parse(
                  (updateResult.content[0]?.text as string) ?? '{}',
                );

                result.actions_taken.push({
                  type: 'update_transaction',
                  transaction: updatedTransaction.transaction,
                  reason: `Marked as uncleared - cleared transaction not found in bank statement`,
                });
                result.summary.transactions_updated++;
              } catch (error) {
                result.recommendations.push(
                  `Failed to unclear transaction "${missingTxn.payee_name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
              }
            }
          }
        }

        // Step 6: Generate recommendations
        if (result.summary.dates_adjusted > 0) {
          result.recommendations.push(
            `✅ Adjusted ${result.summary.dates_adjusted} transaction date(s) to match bank statement dates`,
          );
        }

        if (result.summary.missing_in_ynab > 0 && !parsed.auto_create_transactions) {
          result.recommendations.push(
            `Consider setting auto_create_transactions=true to automatically create ${result.summary.missing_in_ynab} missing transactions`,
          );
        }

        if (!parsed.auto_adjust_dates && comparison.matches?.length > 0) {
          result.recommendations.push(
            `Consider setting auto_adjust_dates=true to automatically align YNAB dates with bank statement dates`,
          );
        }

        if (result.summary.missing_in_bank > 0) {
          result.recommendations.push(
            `${result.summary.missing_in_bank} transactions exist in YNAB but not in bank statement - review for duplicates or bank processing delays`,
          );
        }

        if (parsed.dry_run) {
          result.recommendations.push(
            'This was a dry run. Set dry_run=false to actually perform the reconciliation actions',
          );
        }

        const balanceChange =
          result.account_balance.after.balance.value_milliunits -
          result.account_balance.before.balance.value_milliunits;
        if (Math.abs(balanceChange) > 100) {
          // More than $0.10 change
          result.recommendations.push(
            `Account balance changed by ${(balanceChange / 1000).toFixed(2)} during reconciliation`,
          );
        }

        const resultPayload = {
          ...result,
          balance_reconciliation: balance_reconciliation ?? { status: 'ANALYSIS_COMPLETE' },
        };

        return {
          content: [
            {
              type: 'text',
              text: responseFormatter.format(resultPayload),
            },
          ],
        };
      } finally {
        releaseLock(lockKey);
      }
    },
    'ynab:reconcile_account',
    'reconciling account with bank statement',
  );
}
