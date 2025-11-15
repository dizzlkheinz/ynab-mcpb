import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import { z } from 'zod/v4';
import { withToolErrorHandling } from '../types/index.js';
import { responseFormatter } from '../server/responseFormatter.js';
import { cacheManager, CACHE_TTLS, CacheManager } from '../server/cacheManager.js';
import type { DeltaFetcher } from './deltaFetcher.js';
import { resolveDeltaFetcherArgs } from './deltaSupport.js';

/**
 * Schema for ynab:list_payees tool parameters
 */
export const ListPayeesSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
  })
  .strict();

export type ListPayeesParams = z.infer<typeof ListPayeesSchema>;

/**
 * Schema for ynab:get_payee tool parameters
 */
export const GetPayeeSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    payee_id: z.string().min(1, 'Payee ID is required'),
  })
  .strict();

export type GetPayeeParams = z.infer<typeof GetPayeeSchema>;

/**
 * Handles the ynab:list_payees tool call
 * Lists all payees for a specific budget
 */
export async function handleListPayees(
  ynabAPI: ynab.API,
  deltaFetcher: DeltaFetcher,
  params: ListPayeesParams,
): Promise<CallToolResult>;
export async function handleListPayees(
  ynabAPI: ynab.API,
  params: ListPayeesParams,
): Promise<CallToolResult>;
export async function handleListPayees(
  ynabAPI: ynab.API,
  deltaFetcherOrParams: DeltaFetcher | ListPayeesParams,
  maybeParams?: ListPayeesParams,
): Promise<CallToolResult> {
  const { deltaFetcher, params } = resolveDeltaFetcherArgs(
    ynabAPI,
    deltaFetcherOrParams,
    maybeParams,
  );
  return await withToolErrorHandling(
    async () => {
      const result = await deltaFetcher.fetchPayees(params.budget_id);
      const payees = result.data;
      const wasCached = result.wasCached;

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              payees: payees.map((payee) => ({
                id: payee.id,
                name: payee.name,
                transfer_account_id: payee.transfer_account_id,
                deleted: payee.deleted,
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
    'ynab:list_payees',
    'listing payees',
  );
}

/**
 * Handles the ynab:get_payee tool call
 * Gets detailed information for a specific payee
 */
export async function handleGetPayee(
  ynabAPI: ynab.API,
  params: GetPayeeParams,
): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      // Use enhanced CacheManager wrap method
      const cacheKey = CacheManager.generateKey('payee', 'get', params.budget_id, params.payee_id);
      const wasCached = cacheManager.has(cacheKey);
      const payee = await cacheManager.wrap<ynab.Payee>(cacheKey, {
        ttl: CACHE_TTLS.PAYEES,
        loader: async () => {
          const response = await ynabAPI.payees.getPayeeById(params.budget_id, params.payee_id);
          return response.data.payee;
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              payee: {
                id: payee.id,
                name: payee.name,
                transfer_account_id: payee.transfer_account_id,
                deleted: payee.deleted,
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
    'ynab:get_payee',
    'getting payee details',
  );
}
