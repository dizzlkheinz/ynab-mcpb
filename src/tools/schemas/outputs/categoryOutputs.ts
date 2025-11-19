/**
 * @fileoverview Output schemas for category-related tools.
 *
 * Defines Zod schemas and TypeScript types for responses from category tools:
 * - `list_categories`: Returns all categories and category groups with cache metadata
 * - `get_category`: Returns a single category with cache metadata
 *
 * All financial amounts (budgeted, activity, balance, goal_target, goal_under_funded,
 * goal_overall_funded, goal_overall_left) are converted from YNAB API milliunits to
 * dollars for consistency.
 *
 * @see src/tools/categoryTools.ts:54-124 for list_categories handler
 * @see src/tools/categoryTools.ts:130-188 for get_category handler
 *
 * @example
 * ```typescript
 * const listOutput: ListCategoriesOutput = {
 *   categories: [
 *     {
 *       id: 'category-123',
 *       category_group_id: 'group-456',
 *       category_group_name: 'Monthly Bills',
 *       name: 'Electricity',
 *       hidden: false,
 *       note: 'Electric utility bill',
 *       budgeted: 150.00,
 *       activity: -145.50,
 *       balance: 204.50,
 *       goal_type: 'TB',
 *       goal_target: 150.00,
 *       goal_percentage_complete: 100,
 *       goal_under_funded: 0.00,
 *       goal_overall_funded: 150.00,
 *       goal_overall_left: 0.00
 *     }
 *   ],
 *   category_groups: [
 *     {
 *       id: 'group-456',
 *       name: 'Monthly Bills',
 *       hidden: false,
 *       deleted: false
 *     }
 *   ],
 *   cached: true,
 *   cache_info: {
 *     cache_key: 'categories:budget-123:2025-11-01',
 *     age_ms: 5000,
 *     stale: false
 *   }
 * };
 *
 * const getOutput: GetCategoryOutput = {
 *   category: {
 *     id: 'category-123',
 *     category_group_id: 'group-456',
 *     name: 'Electricity',
 *     hidden: false,
 *     budgeted: 150.00,
 *     activity: -145.50,
 *     balance: 204.50,
 *     goal_type: 'TB',
 *     goal_target: 150.00,
 *     goal_under_funded: 0.00,
 *     goal_overall_funded: 150.00,
 *     goal_overall_left: 0.00
 *   },
 *   cached: false,
 *   cache_info: {
 *     cache_key: 'category:budget-123:category-123:2025-11-01',
 *     age_ms: 0,
 *     stale: false
 *   }
 * };
 * ```
 */

import { z } from 'zod/v4';
import { CacheMetadataSchema } from '../shared/commonOutputs.js';

/**
 * Schema for a category object.
 *
 * Represents category data with budgeted/activity/balance amounts in dollars.
 */
export const CategorySchema = z.object({
  /** Unique identifier for the category */
  id: z.string().describe('Category ID'),

  /** Category group ID this category belongs to */
  category_group_id: z.string().describe('Category group ID'),

  /** Category group name (only present in list_categories) */
  category_group_name: z.string().optional().describe('Category group name'),

  /** Human-readable category name */
  name: z.string().describe('Category name'),

  /** Whether category is hidden */
  hidden: z.boolean().describe('Hidden flag'),

  /** Original category group ID if moved (optional) */
  original_category_group_id: z.string().optional().describe('Original category group ID'),

  /** Optional category note */
  note: z.string().optional().describe('Category note'),

  /** Budgeted amount in dollars */
  budgeted: z.number().describe('Budgeted amount in dollars'),

  /** Activity (spending) in dollars */
  activity: z.number().describe('Activity in dollars'),

  /** Current balance in dollars */
  balance: z.number().describe('Balance in dollars'),

  /** Goal type (TB, TBD, MF, NEED, DEBT, optional) */
  goal_type: z.string().optional().describe('Goal type'),

  /** Goal creation month (YYYY-MM-DD, optional) */
  goal_creation_month: z.string().optional().describe('Goal creation month'),

  /** Goal target amount in dollars (converted from YNAB API milliunits, optional) */
  goal_target: z.number().optional().describe('Goal target amount in dollars'),

  /** Goal target month (YYYY-MM-DD, optional) */
  goal_target_month: z.string().optional().describe('Goal target month'),

  /** Goal percentage complete (optional) */
  goal_percentage_complete: z.number().optional().describe('Goal percentage complete'),

  /** Number of months to budget for goal (optional) */
  goal_months_to_budget: z.number().optional().describe('Goal months to budget'),

  /** Amount still needed in current month to stay on track with goal (dollars, optional) */
  goal_under_funded: z.number().optional().describe('Goal underfunded amount in dollars'),

  /** Total amount funded towards goal across entire goal period since creation (dollars, optional) */
  goal_overall_funded: z.number().optional().describe('Goal overall funded amount in dollars'),

  /** Amount still needed to complete goal across entire goal period (dollars, optional) */
  goal_overall_left: z.number().optional().describe('Goal overall left amount in dollars'),

  /** Whether category is deleted (optional, may not be present in API responses) */
  deleted: z.boolean().optional().describe('Deleted flag'),
});

/**
 * Schema for a category group object.
 *
 * Represents category group metadata.
 */
export const CategoryGroupSchema = z.object({
  /** Unique identifier for the category group */
  id: z.string().describe('Category group ID'),

  /** Human-readable category group name */
  name: z.string().describe('Category group name'),

  /** Whether category group is hidden */
  hidden: z.boolean().describe('Hidden flag'),

  /** Whether category group is deleted */
  deleted: z.boolean().describe('Deleted flag'),
});

/**
 * Schema for `list_categories` tool output.
 *
 * Returns all categories and category groups for a budget month with cache metadata.
 */
export const ListCategoriesOutputSchema = CacheMetadataSchema.extend({
  /** Array of category objects */
  categories: z.array(CategorySchema).describe('List of categories'),

  /** Array of category group objects */
  category_groups: z.array(CategoryGroupSchema).describe('List of category groups'),
});

/**
 * Schema for `get_category` tool output.
 *
 * Returns a single category by ID with cache metadata.
 */
export const GetCategoryOutputSchema = CacheMetadataSchema.extend({
  /** Single category object */
  category: CategorySchema.describe('Category details'),
});

// Export inferred TypeScript types
export type Category = z.infer<typeof CategorySchema>;
export type CategoryGroup = z.infer<typeof CategoryGroupSchema>;
export type ListCategoriesOutput = z.infer<typeof ListCategoriesOutputSchema>;
export type GetCategoryOutput = z.infer<typeof GetCategoryOutputSchema>;
