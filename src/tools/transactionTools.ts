import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import { SaveTransaction } from 'ynab/dist/models/SaveTransaction.js';
import { SaveSubTransaction } from 'ynab/dist/models/SaveSubTransaction.js';
import { z } from 'zod/v4';
import { withToolErrorHandling } from '../types/index.js';
import { responseFormatter } from '../server/responseFormatter.js';
import { amountToMilliunits, milliunitsToAmount } from '../utils/amountUtils.js';
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

const ReceiptSplitItemSchema = z
  .object({
    name: z.string().min(1, 'Item name is required'),
    amount: z
      .number()
      .finite('Item amount must be a finite number')
      .refine((value) => value >= 0, 'Item amount must be zero or greater'),
    quantity: z
      .number()
      .finite('Quantity must be a finite number')
      .positive('Quantity must be greater than zero')
      .optional(),
    memo: z.string().optional(),
  })
  .strict();

const ReceiptSplitCategorySchema = z
  .object({
    category_id: z.string().min(1, 'Category ID is required'),
    category_name: z.string().optional(),
    items: z.array(ReceiptSplitItemSchema).min(1, 'Each category must include at least one item'),
  })
  .strict();

export const CreateReceiptSplitTransactionSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    account_id: z.string().min(1, 'Account ID is required'),
    payee_name: z.string().min(1, 'Payee name is required'),
    date: z
      .string()
      .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'Date must be in ISO format (YYYY-MM-DD)')
      .optional(),
    memo: z.string().optional(),
    receipt_subtotal: z
      .number()
      .finite('Receipt subtotal must be a finite number')
      .refine((value) => value >= 0, 'Receipt subtotal must be zero or greater')
      .optional(),
    receipt_tax: z
      .number()
      .finite('Receipt tax must be a finite number')
      .refine((value) => value >= 0, 'Receipt tax must be zero or greater'),
    receipt_total: z
      .number()
      .finite('Receipt total must be a finite number')
      .refine((value) => value > 0, 'Receipt total must be greater than zero'),
    categories: z
      .array(ReceiptSplitCategorySchema)
      .min(1, 'At least one categorized group is required to create a split transaction'),
    cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
    approved: z.boolean().optional(),
    flag_color: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple']).optional(),
    dry_run: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const itemsSubtotal = data.categories
      .flatMap((category) => category.items)
      .reduce((sum, item) => sum + item.amount, 0);

    if (data.receipt_subtotal !== undefined) {
      const delta = Math.abs(data.receipt_subtotal - itemsSubtotal);
      if (delta > 0.01) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Receipt subtotal (${data.receipt_subtotal.toFixed(2)}) does not match categorized items total (${itemsSubtotal.toFixed(2)})`,
          path: ['receipt_subtotal'],
        });
      }
    }

    const expectedTotal = itemsSubtotal + data.receipt_tax;
    const deltaTotal = Math.abs(expectedTotal - data.receipt_total);
    if (deltaTotal > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Receipt total (${data.receipt_total.toFixed(2)}) does not match subtotal plus tax (${expectedTotal.toFixed(2)})`,
        path: ['receipt_total'],
      });
    }
  });

export type CreateReceiptSplitTransactionParams = z.infer<
  typeof CreateReceiptSplitTransactionSchema
>;

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

interface ReceiptCategoryCalculation {
  category_id: string;
  category_name: string | undefined;
  subtotal_milliunits: number;
  tax_milliunits: number;
  items: {
    name: string;
    amount_milliunits: number;
    quantity: number | undefined;
    memo: string | undefined;
  }[];
}

interface SubtransactionInput {
  amount: number;
  payee_name?: string;
  payee_id?: string;
  category_id?: string;
  memo?: string;
}

function buildItemMemo(item: {
  name: string;
  quantity: number | undefined;
  memo: string | undefined;
}): string | undefined {
  const quantitySuffix = item.quantity ? ` (x${item.quantity})` : '';
  if (item.memo && item.memo.trim().length > 0) {
    return `${item.name}${quantitySuffix} - ${item.memo}`;
  }
  if (quantitySuffix) {
    return `${item.name}${quantitySuffix}`;
  }
  return item.name;
}

function distributeTaxProportionally(
  subtotalMilliunits: number,
  totalTaxMilliunits: number,
  categories: ReceiptCategoryCalculation[],
): void {
  if (totalTaxMilliunits === 0) {
    for (const category of categories) category.tax_milliunits = 0;
    return;
  }

  if (subtotalMilliunits <= 0) {
    throw new Error('Receipt subtotal must be greater than zero to distribute tax');
  }

  let allocated = 0;
  categories.forEach((category, index) => {
    if (index === categories.length - 1) {
      category.tax_milliunits = totalTaxMilliunits - allocated;
    } else {
      const proportionalTax = Math.round(
        (totalTaxMilliunits * category.subtotal_milliunits) / subtotalMilliunits,
      );
      category.tax_milliunits = proportionalTax;
      allocated += proportionalTax;
    }
  });
}

export async function handleCreateReceiptSplitTransaction(
  ynabAPI: ynab.API,
  params: CreateReceiptSplitTransactionParams,
): Promise<CallToolResult> {
  const date = params.date ?? new Date().toISOString().slice(0, 10);

  const categoryCalculations: ReceiptCategoryCalculation[] = params.categories.map((category) => {
    const items = category.items.map((item) => ({
      name: item.name,
      amount_milliunits: amountToMilliunits(item.amount),
      quantity: item.quantity,
      memo: item.memo,
    }));
    const subtotalMilliunits = items.reduce((sum, item) => sum + item.amount_milliunits, 0);
    return {
      category_id: category.category_id,
      category_name: category.category_name,
      subtotal_milliunits: subtotalMilliunits,
      tax_milliunits: 0,
      items,
    };
  });

  const subtotalMilliunits = categoryCalculations.reduce(
    (sum, category) => sum + category.subtotal_milliunits,
    0,
  );

  const declaredSubtotalMilliunits =
    params.receipt_subtotal !== undefined ? amountToMilliunits(params.receipt_subtotal) : undefined;
  if (
    declaredSubtotalMilliunits !== undefined &&
    Math.abs(declaredSubtotalMilliunits - subtotalMilliunits) > 1
  ) {
    throw new Error(
      `Categorized items subtotal (${milliunitsToAmount(subtotalMilliunits)}) does not match receipt subtotal (${milliunitsToAmount(declaredSubtotalMilliunits)})`,
    );
  }

  const taxMilliunits = amountToMilliunits(params.receipt_tax);
  const totalMilliunits = amountToMilliunits(params.receipt_total);
  const computedTotal = subtotalMilliunits + taxMilliunits;
  if (Math.abs(computedTotal - totalMilliunits) > 1) {
    throw new Error(
      `Receipt total (${milliunitsToAmount(totalMilliunits)}) does not equal subtotal plus tax (${milliunitsToAmount(computedTotal)})`,
    );
  }

  distributeTaxProportionally(subtotalMilliunits, taxMilliunits, categoryCalculations);

  const subtransactions: SubtransactionInput[] = categoryCalculations.flatMap((category) => {
    const itemSubtransactions: SubtransactionInput[] = category.items.map((item) => {
      const memo = buildItemMemo({ name: item.name, quantity: item.quantity, memo: item.memo });
      const payload: SubtransactionInput = {
        amount: -item.amount_milliunits,
        category_id: category.category_id,
      };
      if (memo) payload.memo = memo;
      return payload;
    });

    const taxSubtransaction: SubtransactionInput[] =
      category.tax_milliunits > 0
        ? [
            {
              amount: -category.tax_milliunits,
              category_id: category.category_id,
              memo: `Tax - ${category.category_name ?? 'Uncategorized'}`,
            },
          ]
        : [];

    return [...itemSubtransactions, ...taxSubtransaction];
  });

  const receiptSummary = {
    subtotal: milliunitsToAmount(subtotalMilliunits),
    tax: milliunitsToAmount(taxMilliunits),
    total: milliunitsToAmount(totalMilliunits),
    categories: categoryCalculations.map((category) => ({
      category_id: category.category_id,
      category_name: category.category_name,
      items: category.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        amount: milliunitsToAmount(item.amount_milliunits),
        memo: item.memo,
      })),
      subtotal: milliunitsToAmount(category.subtotal_milliunits),
      tax: milliunitsToAmount(category.tax_milliunits),
      total: milliunitsToAmount(category.subtotal_milliunits + category.tax_milliunits),
    })),
  };

  if (params.dry_run) {
    return {
      content: [
        {
          type: 'text',
          text: responseFormatter.format({
            dry_run: true,
            action: 'create_receipt_split_transaction',
            transaction_preview: {
              account_id: params.account_id,
              payee_name: params.payee_name,
              date,
              amount: milliunitsToAmount(totalMilliunits),
              cleared: params.cleared ?? 'uncleared',
            },
            receipt_summary: receiptSummary,
            subtransactions: subtransactions.map((subtransaction) => ({
              amount: milliunitsToAmount(-subtransaction.amount),
              category_id: subtransaction.category_id,
              memo: subtransaction.memo,
            })),
          }),
        },
      ],
    };
  }

  const createTransactionParams: CreateTransactionParams = {
    budget_id: params.budget_id,
    account_id: params.account_id,
    amount: -totalMilliunits,
    date,
    payee_name: params.payee_name,
    memo: params.memo,
    cleared: params.cleared ?? 'uncleared',
    flag_color: params.flag_color,
    subtransactions: subtransactions,
  };

  if (params.approved !== undefined) {
    createTransactionParams.approved = params.approved;
  }

  const baseResult = await handleCreateTransaction(ynabAPI, createTransactionParams);

  const firstContent = baseResult.content?.[0];
  if (!firstContent || typeof firstContent.text !== 'string') {
    return baseResult;
  }

  try {
    const parsed = JSON.parse(firstContent.text) as Record<string, unknown>;
    parsed['receipt_summary'] = receiptSummary;
    firstContent.text = responseFormatter.format(parsed);
  } catch {
    // If parsing fails, return the original result without augmentation.
  }

  return baseResult;
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
