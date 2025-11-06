import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import { z } from 'zod/v4';
import { withToolErrorHandling } from '../types/index.js';
import { responseFormatter } from '../server/responseFormatter.js';
import { cacheManager, CACHE_TTLS, CacheManager } from '../server/cacheManager.js';

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
  params: ListPayeesParams,
): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      const useCache = process.env['NODE_ENV'] !== 'test';

      if (!useCache) {
        // Bypass cache in test environment
        const response = await ynabAPI.payees.getPayees(params.budget_id);
        const payees = response.data.payees;

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
                cached: false,
                cache_info: 'Fresh data retrieved from YNAB API',
              }),
            },
          ],
        };
      }

      // Use enhanced CacheManager wrap method
      const cacheKey = CacheManager.generateKey('payees', 'list', params.budget_id);
      const wasCached = cacheManager.has(cacheKey);
      const payees = await cacheManager.wrap<ynab.Payee[]>(cacheKey, {
        ttl: CACHE_TTLS.PAYEES,
        loader: async () => {
          const response = await ynabAPI.payees.getPayees(params.budget_id);
          return response.data.payees;
        },
      });

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
                ? 'Data retrieved from cache for improved performance'
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
      const useCache = process.env['NODE_ENV'] !== 'test';

      if (!useCache) {
        // Bypass cache in test environment
        const response = await ynabAPI.payees.getPayeeById(params.budget_id, params.payee_id);
        const payee = response.data.payee;

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
                cached: false,
                cache_info: 'Fresh data retrieved from YNAB API',
              }),
            },
          ],
        };
      }

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
