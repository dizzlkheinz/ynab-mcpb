import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import { z } from 'zod/v4';
import { withToolErrorHandling } from '../types/index.js';
import { responseFormatter } from '../server/responseFormatter.js';
import { milliunitsToAmount } from '../utils/amountUtils.js';
import { cacheManager, CACHE_TTLS, CacheManager } from '../server/cacheManager.js';
import type { DeltaFetcher } from './deltaFetcher.js';
import type { DeltaCache } from '../server/deltaCache.js';
import type { ServerKnowledgeStore } from '../server/serverKnowledgeStore.js';
import { resolveDeltaFetcherArgs, resolveDeltaWriteArgs } from './deltaSupport.js';

/**
 * Schema for ynab:list_accounts tool parameters
 */
export const ListAccountsSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
  })
  .strict();

export type ListAccountsParams = z.infer<typeof ListAccountsSchema>;

/**
 * Schema for ynab:get_account tool parameters
 */
export const GetAccountSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    account_id: z.string().min(1, 'Account ID is required'),
  })
  .strict();

export type GetAccountParams = z.infer<typeof GetAccountSchema>;

/**
 * Schema for ynab:create_account tool parameters
 */
export const CreateAccountSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    name: z.string().min(1, 'Account name is required'),
    type: z.enum([
      'checking',
      'savings',
      'creditCard',
      'cash',
      'lineOfCredit',
      'otherAsset',
      'otherLiability',
    ]),
    balance: z.number().optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();

export type CreateAccountParams = z.infer<typeof CreateAccountSchema>;

/**
 * Handles the ynab:list_accounts tool call
 * Lists all accounts for a specific budget
 */
export async function handleListAccounts(
  ynabAPI: ynab.API,
  deltaFetcher: DeltaFetcher,
  params: ListAccountsParams,
): Promise<CallToolResult>;
export async function handleListAccounts(
  ynabAPI: ynab.API,
  params: ListAccountsParams,
): Promise<CallToolResult>;
export async function handleListAccounts(
  ynabAPI: ynab.API,
  deltaFetcherOrParams: DeltaFetcher | ListAccountsParams,
  maybeParams?: ListAccountsParams,
): Promise<CallToolResult> {
  const { deltaFetcher, params } = resolveDeltaFetcherArgs(
    ynabAPI,
    deltaFetcherOrParams,
    maybeParams,
  );
  return await withToolErrorHandling(
    async () => {
      const useCache = process.env['NODE_ENV'] !== 'test';

      if (!useCache) {
        // Bypass cache in test environment
        const response = await ynabAPI.accounts.getAccounts(params.budget_id);
        const accounts = response.data.accounts;

        return {
          content: [
            {
              type: 'text',
              text: responseFormatter.format({
                accounts: accounts.map((account) => ({
                  id: account.id,
                  name: account.name,
                  type: account.type,
                  on_budget: account.on_budget,
                  closed: account.closed,
                  note: account.note,
                  balance: milliunitsToAmount(account.balance),
                  cleared_balance: milliunitsToAmount(account.cleared_balance),
                  uncleared_balance: milliunitsToAmount(account.uncleared_balance),
                  transfer_payee_id: account.transfer_payee_id,
                  direct_import_linked: account.direct_import_linked,
                  direct_import_in_error: account.direct_import_in_error,
                })),
                cached: false,
                cache_info: 'Fresh data retrieved from YNAB API',
              }),
            },
          ],
        };
      }

      const result = await deltaFetcher.fetchAccounts(params.budget_id);
      const accounts = result.data;
      const wasCached = result.wasCached;

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              accounts: accounts.map((account) => ({
                id: account.id,
                name: account.name,
                type: account.type,
                on_budget: account.on_budget,
                closed: account.closed,
                note: account.note,
                balance: milliunitsToAmount(account.balance),
                cleared_balance: milliunitsToAmount(account.cleared_balance),
                uncleared_balance: milliunitsToAmount(account.uncleared_balance),
                transfer_payee_id: account.transfer_payee_id,
                direct_import_linked: account.direct_import_linked,
                direct_import_in_error: account.direct_import_in_error,
              })),
              cached: wasCached,
              cache_info: wasCached
                ? `Data retrieved from cache for improved performance${result.usedDelta ? ' (delta merge applied)' : ''}`
                : 'Fresh data retrieved from YNAB API',
            }),
          },
        ],
      };
    },
    'ynab:list_accounts',
    'listing accounts',
  );
}

/**
 * Handles the ynab:get_account tool call
 * Gets detailed information for a specific account
 */
export async function handleGetAccount(
  ynabAPI: ynab.API,
  params: GetAccountParams,
): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      const useCache = process.env['NODE_ENV'] !== 'test';

      if (!useCache) {
        // Bypass cache in test environment
        const response = await ynabAPI.accounts.getAccountById(params.budget_id, params.account_id);
        const account = response.data.account;

        return {
          content: [
            {
              type: 'text',
              text: responseFormatter.format({
                account: {
                  id: account.id,
                  name: account.name,
                  type: account.type,
                  on_budget: account.on_budget,
                  closed: account.closed,
                  note: account.note,
                  balance: milliunitsToAmount(account.balance),
                  cleared_balance: milliunitsToAmount(account.cleared_balance),
                  uncleared_balance: milliunitsToAmount(account.uncleared_balance),
                  transfer_payee_id: account.transfer_payee_id,
                  direct_import_linked: account.direct_import_linked,
                  direct_import_in_error: account.direct_import_in_error,
                },
                cached: false,
                cache_info: 'Fresh data retrieved from YNAB API',
              }),
            },
          ],
        };
      }

      // Use enhanced CacheManager wrap method
      const cacheKey = CacheManager.generateKey(
        'account',
        'get',
        params.budget_id,
        params.account_id,
      );
      const wasCached = cacheManager.has(cacheKey);
      const account = await cacheManager.wrap<ynab.Account>(cacheKey, {
        ttl: CACHE_TTLS.ACCOUNTS,
        loader: async () => {
          const response = await ynabAPI.accounts.getAccountById(
            params.budget_id,
            params.account_id,
          );
          return response.data.account;
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              account: {
                id: account.id,
                name: account.name,
                type: account.type,
                on_budget: account.on_budget,
                closed: account.closed,
                note: account.note,
                balance: milliunitsToAmount(account.balance),
                cleared_balance: milliunitsToAmount(account.cleared_balance),
                uncleared_balance: milliunitsToAmount(account.uncleared_balance),
                transfer_payee_id: account.transfer_payee_id,
                direct_import_linked: account.direct_import_linked,
                direct_import_in_error: account.direct_import_in_error,
              },
              cached: wasCached,
              cache_info: wasCached
                ? 'Data retrieved from cache for improved performance'
                : 'Fresh data retrieved from YNAB API',
            }),
          },
        ],
      };
    },
    'ynab:get_account',
    'getting account details',
  );
}

/**
 * Handles the ynab:create_account tool call
 * Creates a new account in the specified budget
 */
export async function handleCreateAccount(
  ynabAPI: ynab.API,
  deltaCache: DeltaCache,
  knowledgeStore: ServerKnowledgeStore,
  params: CreateAccountParams,
): Promise<CallToolResult>;
export async function handleCreateAccount(
  ynabAPI: ynab.API,
  params: CreateAccountParams,
): Promise<CallToolResult>;
export async function handleCreateAccount(
  ynabAPI: ynab.API,
  deltaCacheOrParams: DeltaCache | CreateAccountParams,
  knowledgeStoreOrParams?: ServerKnowledgeStore | CreateAccountParams,
  maybeParams?: CreateAccountParams,
): Promise<CallToolResult> {
  const { deltaCache, params } = resolveDeltaWriteArgs(
    deltaCacheOrParams,
    knowledgeStoreOrParams,
    maybeParams,
  );
  return await withToolErrorHandling(
    async () => {
      if (params.dry_run) {
        return {
          content: [
            {
              type: 'text',
              text: responseFormatter.format({
                dry_run: true,
                action: 'create_account',
                request: {
                  budget_id: params.budget_id,
                  name: params.name,
                  type: params.type,
                  balance: params.balance ?? 0,
                },
              }),
            },
          ],
        };
      }
      const accountData: ynab.SaveAccount = {
        name: params.name,
        type: params.type as ynab.Account['type'],
        balance: params.balance ? params.balance * 1000 : 0, // Convert to milliunits
      };

      const response = await ynabAPI.accounts.createAccount(params.budget_id, {
        account: accountData,
      });

      const account = response.data.account;

      // Invalidate accounts list cache after successful account creation
      const accountsListCacheKey = CacheManager.generateKey('accounts', 'list', params.budget_id);
      cacheManager.delete(accountsListCacheKey);

      deltaCache.invalidate(params.budget_id, 'accounts');

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              account: {
                id: account.id,
                name: account.name,
                type: account.type,
                on_budget: account.on_budget,
                closed: account.closed,
                note: account.note,
                balance: milliunitsToAmount(account.balance),
                cleared_balance: milliunitsToAmount(account.cleared_balance),
                uncleared_balance: milliunitsToAmount(account.uncleared_balance),
                transfer_payee_id: account.transfer_payee_id,
                direct_import_linked: account.direct_import_linked,
                direct_import_in_error: account.direct_import_in_error,
              },
            }),
          },
        ],
      };
    },
    'ynab:create_account',
    'creating account',
  );
}
