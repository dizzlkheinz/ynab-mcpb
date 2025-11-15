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
 * Schema for ynab:list_categories tool parameters
 */
export const ListCategoriesSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
  })
  .strict();

export type ListCategoriesParams = z.infer<typeof ListCategoriesSchema>;

/**
 * Schema for ynab:get_category tool parameters
 */
export const GetCategorySchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    category_id: z.string().min(1, 'Category ID is required'),
  })
  .strict();

export type GetCategoryParams = z.infer<typeof GetCategorySchema>;

/**
 * Schema for ynab:update_category tool parameters
 */
export const UpdateCategorySchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    category_id: z.string().min(1, 'Category ID is required'),
    budgeted: z.number().int('Budgeted amount must be an integer in milliunits'),
    dry_run: z.boolean().optional(),
  })
  .strict();

export type UpdateCategoryParams = z.infer<typeof UpdateCategorySchema>;

/**
 * Handles the ynab:list_categories tool call
 * Lists all categories for a specific budget
 */
export async function handleListCategories(
  ynabAPI: ynab.API,
  deltaFetcher: DeltaFetcher,
  params: ListCategoriesParams,
): Promise<CallToolResult>;
export async function handleListCategories(
  ynabAPI: ynab.API,
  params: ListCategoriesParams,
): Promise<CallToolResult>;
export async function handleListCategories(
  ynabAPI: ynab.API,
  deltaFetcherOrParams: DeltaFetcher | ListCategoriesParams,
  maybeParams?: ListCategoriesParams,
): Promise<CallToolResult> {
  const { deltaFetcher, params } = resolveDeltaFetcherArgs(
    ynabAPI,
    deltaFetcherOrParams,
    maybeParams,
  );
  return await withToolErrorHandling(
    async () => {
        );

        return {
          content: [
            {
              type: 'text',
              text: responseFormatter.format({
                categories: allCategories,
                category_groups: categoryGroups.map((group) => ({
                  id: group.id,
                  name: group.name,
                  hidden: group.hidden,
                  deleted: group.deleted,
                })),
                cached: false,
                cache_info: 'Fresh data retrieved from YNAB API',
              }),
            },
          ],
        };
      const result = await deltaFetcher.fetchCategories(params.budget_id);
      const categoryGroups = result.data;
      const wasCached = result.wasCached;

      // Flatten categories from all category groups
      const allCategories = categoryGroups.flatMap((group) =>
        group.categories.map((category) => ({
          id: category.id,
          category_group_id: category.category_group_id,
          category_group_name: group.name,
          name: category.name,
          hidden: category.hidden,
          original_category_group_id: category.original_category_group_id,
          note: category.note,
          budgeted: milliunitsToAmount(category.budgeted),
          activity: milliunitsToAmount(category.activity),
          balance: milliunitsToAmount(category.balance),
          goal_type: category.goal_type,
          goal_creation_month: category.goal_creation_month,
          goal_target: category.goal_target,
          goal_target_month: category.goal_target_month,
          goal_percentage_complete: category.goal_percentage_complete,
        })),
      );

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              categories: allCategories,
              category_groups: categoryGroups.map((group) => ({
                id: group.id,
                name: group.name,
                hidden: group.hidden,
                deleted: group.deleted,
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
    'ynab:list_categories',
    'listing categories',
  );
}

/**
 * Handles the ynab:get_category tool call
 * Gets detailed information for a specific category
 */
export async function handleGetCategory(
  ynabAPI: ynab.API,
  params: GetCategoryParams,
): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      // Use enhanced CacheManager wrap method
      const cacheKey = CacheManager.generateKey(
        'category',
        'get',
        params.budget_id,
        params.category_id,
      );
      const wasCached = cacheManager.has(cacheKey);
      const category = await cacheManager.wrap<ynab.Category>(cacheKey, {
        ttl: CACHE_TTLS.CATEGORIES,
        loader: async () => {
          const response = await ynabAPI.categories.getCategoryById(
            params.budget_id,
            params.category_id,
          );
          return response.data.category;
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              category: {
                id: category.id,
                category_group_id: category.category_group_id,
                name: category.name,
                hidden: category.hidden,
                original_category_group_id: category.original_category_group_id,
                note: category.note,
                budgeted: milliunitsToAmount(category.budgeted),
                activity: milliunitsToAmount(category.activity),
                balance: milliunitsToAmount(category.balance),
                goal_type: category.goal_type,
                goal_creation_month: category.goal_creation_month,
                goal_target: category.goal_target,
                goal_target_month: category.goal_target_month,
                goal_percentage_complete: category.goal_percentage_complete,
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
    'ynab:get_category',
    'getting category',
  );
}

/**
 * Handles the ynab:update_category tool call
 * Updates the budgeted amount for a category in the current month
 */
export async function handleUpdateCategory(
  ynabAPI: ynab.API,
  deltaCache: DeltaCache,
  knowledgeStore: ServerKnowledgeStore,
  params: UpdateCategoryParams,
): Promise<CallToolResult>;
export async function handleUpdateCategory(
  ynabAPI: ynab.API,
  params: UpdateCategoryParams,
): Promise<CallToolResult>;
export async function handleUpdateCategory(
  ynabAPI: ynab.API,
  deltaCacheOrParams: DeltaCache | UpdateCategoryParams,
  knowledgeStoreOrParams?: ServerKnowledgeStore | UpdateCategoryParams,
  maybeParams?: UpdateCategoryParams,
): Promise<CallToolResult> {
  const { deltaCache, knowledgeStore, params } = resolveDeltaWriteArgs(
    deltaCacheOrParams,
    knowledgeStoreOrParams,
    maybeParams,
  );
  try {
    if (params.dry_run) {
      const currentDate = new Date();
      const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-01`;
      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              dry_run: true,
              action: 'update_category',
              request: {
                budget_id: params.budget_id,
                category_id: params.category_id,
                budgeted: milliunitsToAmount(params.budgeted),
                month: currentMonth,
              },
            }),
          },
        ],
      };
    }
    // Get current month in YNAB format (YYYY-MM-01)
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-01`;

    const response = await ynabAPI.categories.updateMonthCategory(
      params.budget_id,
      currentMonth,
      params.category_id,
      { category: { budgeted: params.budgeted } },
    );

    const category = response.data.category;

    // Invalidate category-related caches after successful update
    const categoriesListCacheKey = CacheManager.generateKey('categories', 'list', params.budget_id);
    const specificCategoryCacheKey = CacheManager.generateKey(
      'category',
      'get',
      params.budget_id,
      params.category_id,
    );
    cacheManager.delete(categoriesListCacheKey);
    cacheManager.delete(specificCategoryCacheKey);

    // Invalidate month-related caches as category budget changes affect month data
    const monthsListCacheKey = CacheManager.generateKey('months', 'list', params.budget_id);
    const currentMonthCacheKey = CacheManager.generateKey(
      'month',
      'get',
      params.budget_id,
      currentMonth,
    );
    cacheManager.delete(monthsListCacheKey);
    cacheManager.delete(currentMonthCacheKey);

    deltaCache.invalidate(params.budget_id, 'categories');
    deltaCache.invalidate(params.budget_id, 'months');
    const serverKnowledge = response.data.server_knowledge;
    if (typeof serverKnowledge === 'number') {
      knowledgeStore.update(categoriesListCacheKey, serverKnowledge);
      knowledgeStore.update(monthsListCacheKey, serverKnowledge);
    }

    return {
      content: [
        {
          type: 'text',
          text: responseFormatter.format({
            category: {
              id: category.id,
              category_group_id: category.category_group_id,
              name: category.name,
              hidden: category.hidden,
              original_category_group_id: category.original_category_group_id,
              note: category.note,
              budgeted: milliunitsToAmount(category.budgeted),
              activity: milliunitsToAmount(category.activity),
              balance: milliunitsToAmount(category.balance),
              goal_type: category.goal_type,
              goal_creation_month: category.goal_creation_month,
              goal_target: category.goal_target,
              goal_target_month: category.goal_target_month,
              goal_percentage_complete: category.goal_percentage_complete,
            },
            updated_month: currentMonth,
          }),
        },
      ],
    };
  } catch (error) {
    return handleCategoryError(error, 'Failed to update category');
  }
}

/**
 * Handles errors from category-related API calls
 */
function handleCategoryError(error: unknown, defaultMessage: string): CallToolResult {
  let errorMessage = defaultMessage;

  if (error instanceof Error) {
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      errorMessage = 'Invalid or expired YNAB access token';
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      errorMessage = 'Insufficient permissions to access YNAB data';
    } else if (error.message.includes('404') || error.message.includes('Not Found')) {
      errorMessage = 'Budget or category not found';
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
