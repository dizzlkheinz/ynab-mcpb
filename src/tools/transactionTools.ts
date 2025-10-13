import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import { SaveTransaction } from 'ynab/dist/models/SaveTransaction.js';
import { SaveSubTransaction } from 'ynab/dist/models/SaveSubTransaction.js';
import { z } from 'zod/v4';
import { withToolErrorHandling } from '../types/index.js';
import { responseFormatter } from '../server/responseFormatter.js';
import { milliunitsToAmount } from '../utils/amountUtils.js';
import { cacheManager, CACHE_TTLS, CacheManager } from '../server/cacheManager.js';

/**
 * Utility function to ensure transaction is not null/undefined
 */
function ensureTransaction<T>(transaction: T | undefined, errorMessage: string): T {
  if (!transaction) {
    throw new Error(errorMessage);
  }
  return transaction;
}

/**
 * Schema for ynab:list_transactions tool parameters
 */
export const ListTransactionsSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    account_id: z.string().optional(),
    category_id: z.string().optional(),
    since_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in ISO format (YYYY-MM-DD)')
      .optional(),
    type: z.enum(['uncategorized', 'unapproved']).optional(),
  })
  .strict();

export type ListTransactionsParams = z.infer<typeof ListTransactionsSchema>;

/**
 * Schema for ynab:get_transaction tool parameters
 */
export const GetTransactionSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    transaction_id: z.string().min(1, 'Transaction ID is required'),
  })
  .strict();

export type GetTransactionParams = z.infer<typeof GetTransactionSchema>;

/**
 * Schema for ynab:create_transaction tool parameters
 */
export const CreateTransactionSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    account_id: z.string().min(1, 'Account ID is required'),
    amount: z.number().int('Amount must be an integer in milliunits'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in ISO format (YYYY-MM-DD)'),
    payee_name: z.string().optional(),
    payee_id: z.string().optional(),
    category_id: z.string().optional(),
    memo: z.string().optional(),
    cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
    approved: z.boolean().optional(),
    flag_color: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple']).optional(),
    dry_run: z.boolean().optional(),
    subtransactions: z
      .array(
        z
          .object({
            amount: z.number().int('Subtransaction amount must be an integer in milliunits'),
            payee_name: z.string().optional(),
            payee_id: z.string().optional(),
            category_id: z.string().optional(),
            memo: z.string().optional(),
          })
          .strict(),
      )
      .min(1, 'At least one subtransaction is required when provided')
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.subtransactions && data.subtransactions.length > 0) {
      const total = data.subtransactions.reduce((sum, sub) => sum + sub.amount, 0);
      if (total !== data.amount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Amount must equal the sum of subtransaction amounts',
          path: ['amount'],
        });
      }
    }
  });

export type CreateTransactionParams = z.infer<typeof CreateTransactionSchema>;

/**
 * Schema for ynab:update_transaction tool parameters
 */
export const UpdateTransactionSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    transaction_id: z.string().min(1, 'Transaction ID is required'),
    account_id: z.string().optional(),
    amount: z.number().int('Amount must be an integer in milliunits').optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in ISO format (YYYY-MM-DD)')
      .optional(),
    payee_name: z.string().optional(),
    payee_id: z.string().optional(),
    category_id: z.string().optional(),
    memo: z.string().optional(),
    cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
    approved: z.boolean().optional(),
    flag_color: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple']).optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();

export type UpdateTransactionParams = z.infer<typeof UpdateTransactionSchema>;

/**
 * Schema for ynab:delete_transaction tool parameters
 */
export const DeleteTransactionSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    transaction_id: z.string().min(1, 'Transaction ID is required'),
    dry_run: z.boolean().optional(),
  })
  .strict();

export type DeleteTransactionParams = z.infer<typeof DeleteTransactionSchema>;

/**
 * Handles the ynab:list_transactions tool call
 * Lists transactions for a budget with optional filtering
 */
export async function handleListTransactions(
  ynabAPI: ynab.API,
  params: ListTransactionsParams,
): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      const useCache = process.env['NODE_ENV'] !== 'test';

      // Only cache when no filters are used (only budget_id is provided)
      const shouldCache =
        useCache && !params.account_id && !params.category_id && !params.since_date && !params.type;

      let transactions: (ynab.TransactionDetail | ynab.HybridTransaction)[];
      let cacheHit = false;

      if (shouldCache) {
        // Use enhanced CacheManager wrap method
        const cacheKey = CacheManager.generateKey('transactions', 'list', params.budget_id);
        cacheHit = cacheManager.has(cacheKey);
        transactions = await cacheManager.wrap<(ynab.TransactionDetail | ynab.HybridTransaction)[]>(
          cacheKey,
          {
            ttl: CACHE_TTLS.TRANSACTIONS,
            loader: async () => {
              const response = await ynabAPI.transactions.getTransactions(params.budget_id);
              return response.data.transactions;
            },
          },
        );
      } else {
        // Use conditional API calls based on filter parameters (no caching for filtered requests)
        let response;

        if (params.account_id) {
          // Get transactions for specific account
          response = await ynabAPI.transactions.getTransactionsByAccount(
            params.budget_id,
            params.account_id,
            params.since_date,
          );
        } else if (params.category_id) {
          // Get transactions for specific category
          response = await ynabAPI.transactions.getTransactionsByCategory(
            params.budget_id,
            params.category_id,
            params.since_date,
          );
        } else {
          // Get all transactions for budget
          response = await ynabAPI.transactions.getTransactions(
            params.budget_id,
            params.since_date,
            params.type,
          );
        }

        transactions = response.data.transactions;
      }

      // Check if response might be too large for MCP
      const estimatedSize = JSON.stringify(transactions).length;
      const sizeLimit = 90000; // Conservative limit under 100KB

      if (estimatedSize > sizeLimit) {
        // Return summary and suggest export
        const preview = transactions.slice(0, 50);
        return {
          content: [
            {
              type: 'text',
              text: responseFormatter.format({
                message: `Found ${transactions.length} transactions (${Math.round(estimatedSize / 1024)}KB). Too large to display all.`,
                suggestion: "Use 'export_transactions' tool to save all transactions to a file.",
                showing: `First ${preview.length} transactions:`,
                total_count: transactions.length,
                estimated_size_kb: Math.round(estimatedSize / 1024),
                preview_transactions: preview.map((transaction) => ({
                  id: transaction.id,
                  date: transaction.date,
                  amount: milliunitsToAmount(transaction.amount),
                  memo: transaction.memo,
                  payee_name: transaction.payee_name,
                  category_name: transaction.category_name,
                })),
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              total_count: transactions.length,
              cached: cacheHit,
              cache_info: cacheHit
                ? 'Data retrieved from cache for improved performance'
                : 'Fresh data retrieved from YNAB API',
              transactions: transactions.map((transaction) => ({
                id: transaction.id,
                date: transaction.date,
                amount: milliunitsToAmount(transaction.amount),
                memo: transaction.memo,
                cleared: transaction.cleared,
                approved: transaction.approved,
                flag_color: transaction.flag_color,
                account_id: transaction.account_id,
                payee_id: transaction.payee_id,
                category_id: transaction.category_id,
                transfer_account_id: transaction.transfer_account_id,
                transfer_transaction_id: transaction.transfer_transaction_id,
                matched_transaction_id: transaction.matched_transaction_id,
                import_id: transaction.import_id,
                deleted: transaction.deleted,
              })),
            }),
          },
        ],
      };
    },
    'ynab:list_transactions',
    'listing transactions',
  );
}

/**
 * Handles the ynab:get_transaction tool call
 * Gets detailed information for a specific transaction
 */
export async function handleGetTransaction(
  ynabAPI: ynab.API,
  params: GetTransactionParams,
): Promise<CallToolResult> {
  try {
    const useCache = process.env['NODE_ENV'] !== 'test';

    let transaction: ynab.TransactionDetail;
    let cacheHit = false;

    if (useCache) {
      // Use enhanced CacheManager wrap method
      const cacheKey = CacheManager.generateKey(
        'transaction',
        'get',
        params.budget_id,
        params.transaction_id,
      );
      cacheHit = cacheManager.has(cacheKey);
      transaction = await cacheManager.wrap<ynab.TransactionDetail>(cacheKey, {
        ttl: CACHE_TTLS.TRANSACTIONS,
        loader: async () => {
          const response = await ynabAPI.transactions.getTransactionById(
            params.budget_id,
            params.transaction_id,
          );
          return ensureTransaction(response.data.transaction, 'Transaction not found');
        },
      });
    } else {
      // Bypass cache in test environment
      const response = await ynabAPI.transactions.getTransactionById(
        params.budget_id,
        params.transaction_id,
      );
      transaction = ensureTransaction(response.data.transaction, 'Transaction not found');
    }

    return {
      content: [
        {
          type: 'text',
          text: responseFormatter.format({
            transaction: {
              id: transaction.id,
              date: transaction.date,
              amount: milliunitsToAmount(transaction.amount),
              memo: transaction.memo,
              cleared: transaction.cleared,
              approved: transaction.approved,
              flag_color: transaction.flag_color,
              account_id: transaction.account_id,
              payee_id: transaction.payee_id,
              category_id: transaction.category_id,
              transfer_account_id: transaction.transfer_account_id,
              transfer_transaction_id: transaction.transfer_transaction_id,
              matched_transaction_id: transaction.matched_transaction_id,
              import_id: transaction.import_id,
              deleted: transaction.deleted,
              account_name: transaction.account_name,
              payee_name: transaction.payee_name,
              category_name: transaction.category_name,
            },
            cached: cacheHit,
            cache_info: cacheHit
              ? 'Data retrieved from cache for improved performance'
              : 'Fresh data retrieved from YNAB API',
          }),
        },
      ],
    };
  } catch (error) {
    return handleTransactionError(error, 'Failed to get transaction');
  }
}

/**
 * Handles the ynab:create_transaction tool call
 * Creates a new transaction in the specified budget and account
 */
export async function handleCreateTransaction(
  ynabAPI: ynab.API,
  params: CreateTransactionParams,
): Promise<CallToolResult> {
  try {
    if (params.dry_run) {
      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              dry_run: true,
              action: 'create_transaction',
              request: params,
            }),
          },
        ],
      };
    }
    // Prepare transaction data
    const transactionData: SaveTransaction = {
      account_id: params.account_id,
      amount: params.amount, // Already validated as integer milliunits
      date: params.date,
      cleared: params.cleared as ynab.TransactionClearedStatus,
      flag_color: params.flag_color as ynab.TransactionFlagColor,
    };
    if (params.payee_name !== undefined) transactionData.payee_name = params.payee_name;
    if (params.payee_id !== undefined) transactionData.payee_id = params.payee_id;
    if (params.category_id !== undefined) transactionData.category_id = params.category_id;
    if (params.memo !== undefined) transactionData.memo = params.memo;
    if (params.approved !== undefined) transactionData.approved = params.approved;
    if (params.subtransactions && params.subtransactions.length > 0) {
      const subtransactions: SaveSubTransaction[] = params.subtransactions.map((subtransaction) => {
        const mapped: SaveSubTransaction = {
          amount: subtransaction.amount,
        };

        if (subtransaction.payee_name !== undefined) mapped.payee_name = subtransaction.payee_name;
        if (subtransaction.payee_id !== undefined) mapped.payee_id = subtransaction.payee_id;
        if (subtransaction.category_id !== undefined) {
          mapped.category_id = subtransaction.category_id;
        }
        if (subtransaction.memo !== undefined) mapped.memo = subtransaction.memo;

        return mapped;
      });

      transactionData.subtransactions = subtransactions;
    }

    const response = await ynabAPI.transactions.createTransaction(params.budget_id, {
      transaction: transactionData,
    });

    const transaction = ensureTransaction(response.data.transaction, 'Transaction creation failed');

    // Invalidate transaction-related caches after successful creation
    const transactionsListCacheKey = CacheManager.generateKey(
      'transactions',
      'list',
      params.budget_id,
    );
    cacheManager.delete(transactionsListCacheKey);

    // Invalidate account-related caches as the account balance has changed
    const accountsListCacheKey = CacheManager.generateKey('accounts', 'list', params.budget_id);
    const specificAccountCacheKey = CacheManager.generateKey(
      'account',
      'get',
      params.budget_id,
      transaction.account_id,
    );
    cacheManager.delete(accountsListCacheKey);
    cacheManager.delete(specificAccountCacheKey);

    // Invalidate month-related caches as transaction affects month summaries
    const formatMonthKey = (date: string) => `${date.slice(0, 7)}-01`;
    const monthKeys = new Set<string>([formatMonthKey(transaction.date)]);
    cacheManager.delete(CacheManager.generateKey('months', 'list', params.budget_id));
    for (const monthKey of monthKeys) {
      cacheManager.delete(CacheManager.generateKey('month', 'get', params.budget_id, monthKey));
    }

    // Invalidate categories cache as transaction affects category activity
    cacheManager.delete(CacheManager.generateKey('categories', 'list', params.budget_id));

    // Get the updated account balance
    const accountResponse = await ynabAPI.accounts.getAccountById(
      params.budget_id,
      transaction.account_id,
    );
    const account = accountResponse.data.account;

    return {
      content: [
        {
          type: 'text',
          text: responseFormatter.format({
            transaction: {
              id: transaction.id,
              date: transaction.date,
              amount: milliunitsToAmount(transaction.amount),
              memo: transaction.memo,
              cleared: transaction.cleared,
              approved: transaction.approved,
              flag_color: transaction.flag_color,
              account_id: transaction.account_id,
              payee_id: transaction.payee_id,
              category_id: transaction.category_id,
              transfer_account_id: transaction.transfer_account_id,
              transfer_transaction_id: transaction.transfer_transaction_id,
              matched_transaction_id: transaction.matched_transaction_id,
              import_id: transaction.import_id,
              deleted: transaction.deleted,
              // New fields for account balance
              account_balance: account.balance,
              account_cleared_balance: account.cleared_balance,
              subtransactions: transaction.subtransactions?.map((subtransaction) => ({
                id: subtransaction.id,
                transaction_id: subtransaction.transaction_id,
                amount: milliunitsToAmount(subtransaction.amount),
                memo: subtransaction.memo,
                payee_id: subtransaction.payee_id,
                payee_name: subtransaction.payee_name,
                category_id: subtransaction.category_id,
                category_name: subtransaction.category_name,
                transfer_account_id: subtransaction.transfer_account_id,
                transfer_transaction_id: subtransaction.transfer_transaction_id,
                deleted: subtransaction.deleted,
              })),
            },
          }),
        },
      ],
    };
  } catch (error) {
    return handleTransactionError(error, 'Failed to create transaction');
  }
}

/**
 * Handles the ynab:update_transaction tool call
 * Updates an existing transaction with the provided fields
 */
export async function handleUpdateTransaction(
  ynabAPI: ynab.API,
  params: UpdateTransactionParams,
): Promise<CallToolResult> {
  try {
    if (params.dry_run) {
      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              dry_run: true,
              action: 'update_transaction',
              request: params,
            }),
          },
        ],
      };
    }

    // Get the original transaction before updating to capture the original account_id
    const originalTransactionResponse = await ynabAPI.transactions.getTransactionById(
      params.budget_id,
      params.transaction_id,
    );
    const originalTransaction = ensureTransaction(
      originalTransactionResponse.data.transaction,
      'Original transaction not found',
    );

    // Prepare transaction update data - only include fields that are provided
    const transactionData: SaveTransaction = {};

    // Only include fields that are provided in the update
    if (params.account_id !== undefined) {
      transactionData.account_id = params.account_id;
    }
    if (params.amount !== undefined) {
      transactionData.amount = params.amount;
    }
    if (params.date !== undefined) {
      transactionData.date = params.date;
    }
    if (params.payee_name !== undefined) {
      transactionData.payee_name = params.payee_name;
    }
    if (params.payee_id !== undefined) {
      transactionData.payee_id = params.payee_id;
    }
    if (params.category_id !== undefined) {
      transactionData.category_id = params.category_id;
    }
    if (params.memo !== undefined) {
      transactionData.memo = params.memo;
    }
    if (params.cleared !== undefined) {
      transactionData.cleared = params.cleared as ynab.TransactionClearedStatus;
    }
    if (params.approved !== undefined) {
      transactionData.approved = params.approved;
    }
    if (params.flag_color !== undefined) {
      transactionData.flag_color = params.flag_color as ynab.TransactionFlagColor;
    }

    const response = await ynabAPI.transactions.updateTransaction(
      params.budget_id,
      params.transaction_id,
      {
        transaction: transactionData,
      },
    );

    const transaction = ensureTransaction(response.data.transaction, 'Transaction update failed');

    // Invalidate transaction-related caches after successful update
    const transactionsListCacheKey = CacheManager.generateKey(
      'transactions',
      'list',
      params.budget_id,
    );
    const specificTransactionCacheKey = CacheManager.generateKey(
      'transaction',
      'get',
      params.budget_id,
      params.transaction_id,
    );
    cacheManager.delete(transactionsListCacheKey);
    cacheManager.delete(specificTransactionCacheKey);

    // Invalidate account-related caches for all affected accounts
    const accountsListCacheKey = CacheManager.generateKey('accounts', 'list', params.budget_id);
    cacheManager.delete(accountsListCacheKey);

    // Collect all affected account IDs (original and new, if different)
    const affectedAccountIds = new Set([originalTransaction.account_id, transaction.account_id]);

    if (originalTransaction.transfer_account_id) {
      affectedAccountIds.add(originalTransaction.transfer_account_id);
    }
    if (transaction.transfer_account_id) {
      affectedAccountIds.add(transaction.transfer_account_id);
    }

    // Invalidate caches for all affected accounts
    for (const accountId of affectedAccountIds) {
      const specificAccountCacheKey = CacheManager.generateKey(
        'account',
        'get',
        params.budget_id,
        accountId,
      );
      cacheManager.delete(specificAccountCacheKey);
    }

    // Invalidate month-related caches as transaction affects month summaries
    const d = new Date();
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    cacheManager.delete(CacheManager.generateKey('months', 'list', params.budget_id));
    cacheManager.delete(CacheManager.generateKey('month', 'get', params.budget_id, monthKey));

    // Invalidate categories cache as transaction affects category activity
    cacheManager.delete(CacheManager.generateKey('categories', 'list', params.budget_id));

    // Get the updated account balance
    const accountResponse = await ynabAPI.accounts.getAccountById(
      params.budget_id,
      transaction.account_id,
    );
    const account = accountResponse.data.account;

    return {
      content: [
        {
          type: 'text',
          text: responseFormatter.format({
            transaction: {
              id: transaction.id,
              date: transaction.date,
              amount: milliunitsToAmount(transaction.amount),
              memo: transaction.memo,
              cleared: transaction.cleared,
              approved: transaction.approved,
              flag_color: transaction.flag_color,
              account_id: transaction.account_id,
              payee_id: transaction.payee_id,
              category_id: transaction.category_id,
              transfer_account_id: transaction.transfer_account_id,
              transfer_transaction_id: transaction.transfer_transaction_id,
              matched_transaction_id: transaction.matched_transaction_id,
              import_id: transaction.import_id,
              deleted: transaction.deleted,
            },
            updated_balance: account.balance,
            updated_cleared_balance: account.cleared_balance,
          }),
        },
      ],
    };
  } catch (error) {
    return handleTransactionError(error, 'Failed to update transaction');
  }
}

/**
 * Handles the ynab:delete_transaction tool call
 * Deletes a transaction from the specified budget
 */
export async function handleDeleteTransaction(
  ynabAPI: ynab.API,
  params: DeleteTransactionParams,
): Promise<CallToolResult> {
  try {
    if (params.dry_run) {
      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              dry_run: true,
              action: 'delete_transaction',
              request: params,
            }),
          },
        ],
      };
    }
    const response = await ynabAPI.transactions.deleteTransaction(
      params.budget_id,
      params.transaction_id,
    );

    const transaction = ensureTransaction(response.data.transaction, 'Transaction deletion failed');

    // Invalidate transaction-related caches after successful deletion
    const transactionsListCacheKey = CacheManager.generateKey(
      'transactions',
      'list',
      params.budget_id,
    );
    const specificTransactionCacheKey = CacheManager.generateKey(
      'transaction',
      'get',
      params.budget_id,
      params.transaction_id,
    );
    cacheManager.delete(transactionsListCacheKey);
    cacheManager.delete(specificTransactionCacheKey);

    // Invalidate account-related caches as the account balance has changed
    const accountsListCacheKey = CacheManager.generateKey('accounts', 'list', params.budget_id);
    const specificAccountCacheKey = CacheManager.generateKey(
      'account',
      'get',
      params.budget_id,
      transaction.account_id,
    );
    cacheManager.delete(accountsListCacheKey);
    cacheManager.delete(specificAccountCacheKey);

    // Invalidate month-related caches as transaction affects month summaries
    const d = new Date();
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    cacheManager.delete(CacheManager.generateKey('months', 'list', params.budget_id));
    cacheManager.delete(CacheManager.generateKey('month', 'get', params.budget_id, monthKey));

    // Invalidate categories cache as transaction affects category activity
    cacheManager.delete(CacheManager.generateKey('categories', 'list', params.budget_id));

    // Get the updated account balance
    const accountResponse = await ynabAPI.accounts.getAccountById(
      params.budget_id,
      transaction.account_id,
    );
    const account = accountResponse.data.account;

    return {
      content: [
        {
          type: 'text',
          text: responseFormatter.format({
            message: 'Transaction deleted successfully',
            transaction: {
              id: transaction.id,
              deleted: transaction.deleted,
            },
            updated_balance: account.balance,
            updated_cleared_balance: account.cleared_balance,
          }),
        },
      ],
    };
  } catch (error) {
    return handleTransactionError(error, 'Failed to delete transaction');
  }
}

/**
 * Handles errors from transaction-related API calls
 */
function handleTransactionError(error: unknown, defaultMessage: string): CallToolResult {
  let errorMessage = defaultMessage;

  if (error instanceof Error) {
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      errorMessage = 'Invalid or expired YNAB access token';
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      errorMessage = 'Insufficient permissions to access YNAB data';
    } else if (error.message.includes('404') || error.message.includes('Not Found')) {
      errorMessage = 'Budget, account, category, or transaction not found';
    } else if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
      errorMessage = 'Rate limit exceeded. Please try again later';
    } else if (error.message.includes('500') || error.message.includes('Internal Server Error')) {
      errorMessage = 'YNAB service is currently unavailable';
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: responseFormatter.format({
          error: {
            message: errorMessage,
          },
        }),
      },
    ],
  };
}
