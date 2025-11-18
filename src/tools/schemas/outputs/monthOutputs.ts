/**
 * @fileoverview Output schemas for month-related tools.
 *
 * Defines Zod schemas and TypeScript types for responses from month tools:
 * - `get_month`: Returns detailed month data including categories with cache metadata
 * - `list_months`: Returns summary of all months without category details
 *
 * Note: The schemas distinguish between detailed month data (with categories array)
 * and summary data (without categories array).
 *
 * @see src/tools/monthTools.ts:38-104 for get_month handler
 * @see src/tools/monthTools.ts:110-164 for list_months handler
 *
 * @example
 * ```typescript
 * const getOutput: GetMonthOutput = {
 *   month: {
 *     month: '2025-11-01',
 *     note: 'November budget',
 *     income: 5000.00,
 *     budgeted: 4500.00,
 *     activity: -4200.00,
 *     to_be_budgeted: 300.00,
 *     age_of_money: 45,
 *     deleted: false,
 *     categories: [
 *       {
 *         id: 'category-123',
 *         category_group_id: 'group-456',
 *         category_group_name: 'Monthly Bills',
 *         name: 'Electricity',
 *         hidden: false,
 *         budgeted: 150.00,
 *         activity: -145.50,
 *         balance: 204.50,
 *         goal_type: 'TB',
 *         goal_target: 150000,
 *         deleted: false
 *       }
 *     ]
 *   },
 *   cached: true,
 *   cache_info: {
 *     cache_key: 'month:budget-123:2025-11-01',
 *     age_ms: 2000,
 *     stale: false
 *   }
 * };
 *
 * const listOutput: ListMonthsOutput = {
 *   months: [
 *     {
 *       month: '2025-11-01',
 *       note: 'November budget',
 *       income: 5000.00,
 *       budgeted: 4500.00,
 *       activity: -4200.00,
 *       to_be_budgeted: 300.00,
 *       age_of_money: 45,
 *       deleted: false
 *     },
 *     {
 *       month: '2025-10-01',
 *       income: 5000.00,
 *       budgeted: 4800.00,
 *       activity: -4750.00,
 *       to_be_budgeted: 50.00,
 *       age_of_money: 42,
 *       deleted: false
 *     }
 *   ],
 *   cached: true,
 *   cache_info: {
 *     cache_key: 'months:budget-123',
 *     age_ms: 5000,
 *     stale: false
 *   }
 * };
 * ```
 */

import { z } from 'zod/v4';
import { CacheMetadataSchema } from '../shared/commonOutputs.js';

/**
 * Schema for a category within month data.
 *
 * Similar to CategorySchema but includes additional goal-related fields
 * specific to month budget data.
 */
export const MonthCategorySchema = z.object({
  /** Unique identifier for the category */
  id: z.string().describe('Category ID'),

  /** Category group ID this category belongs to */
  category_group_id: z.string().describe('Category group ID'),

  /** Category group name (optional) */
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

  /** Goal target amount in milliunits (optional) */
  goal_target: z.number().optional().describe('Goal target in milliunits'),

  /** Goal target month (YYYY-MM-DD, optional) */
  goal_target_month: z.string().optional().describe('Goal target month'),

  /** Goal percentage complete (optional) */
  goal_percentage_complete: z.number().optional().describe('Goal percentage complete'),

  /** Goal months to budget (optional) */
  goal_months_to_budget: z.number().optional().describe('Goal months to budget'),

  /** Goal under funded amount (optional) */
  goal_under_funded: z.number().optional().describe('Goal under funded amount'),

  /** Goal overall funded amount (optional) */
  goal_overall_funded: z.number().optional().describe('Goal overall funded amount'),

  /** Goal overall left amount (optional) */
  goal_overall_left: z.number().optional().describe('Goal overall left amount'),

  /** Whether category is deleted */
  deleted: z.boolean().describe('Deleted flag'),
});

/**
 * Schema for detailed month data (includes categories array).
 *
 * Used by get_month to return complete month details.
 */
export const MonthDetailSchema = z.object({
  /** Month identifier (YYYY-MM-DD format, first day of month) */
  month: z.string().describe('Month identifier'),

  /** Optional month note */
  note: z.string().optional().describe('Month note'),

  /** Total income for the month in dollars */
  income: z.number().describe('Income in dollars'),

  /** Total budgeted for the month in dollars */
  budgeted: z.number().describe('Budgeted amount in dollars'),

  /** Total activity (spending) for the month in dollars */
  activity: z.number().describe('Activity in dollars'),

  /** Amount to be budgeted in dollars */
  to_be_budgeted: z.number().describe('To be budgeted in dollars'),

  /** Age of money in days (optional) */
  age_of_money: z.number().optional().describe('Age of money in days'),

  /** Whether month is deleted */
  deleted: z.boolean().describe('Deleted flag'),

  /** Array of category data for this month (optional) */
  categories: z.array(MonthCategorySchema).optional().describe('Categories for this month'),
});

/**
 * Schema for summary month data (excludes categories array).
 *
 * Used by list_months to return month summaries without category details.
 */
export const MonthSummarySchema = z.object({
  /** Month identifier (YYYY-MM-DD format, first day of month) */
  month: z.string().describe('Month identifier'),

  /** Optional month note */
  note: z.string().optional().describe('Month note'),

  /** Total income for the month in dollars */
  income: z.number().describe('Income in dollars'),

  /** Total budgeted for the month in dollars */
  budgeted: z.number().describe('Budgeted amount in dollars'),

  /** Total activity (spending) for the month in dollars */
  activity: z.number().describe('Activity in dollars'),

  /** Amount to be budgeted in dollars */
  to_be_budgeted: z.number().describe('To be budgeted in dollars'),

  /** Age of money in days (optional) */
  age_of_money: z.number().optional().describe('Age of money in days'),

  /** Whether month is deleted */
  deleted: z.boolean().describe('Deleted flag'),
});

/**
 * Schema for `get_month` tool output.
 *
 * Returns detailed month data including categories with cache metadata.
 */
export const GetMonthOutputSchema = CacheMetadataSchema.extend({
  /** Detailed month object including categories */
  month: MonthDetailSchema.describe('Month details'),
});

/**
 * Schema for `list_months` tool output.
 *
 * Returns summary of all months without category details.
 */
export const ListMonthsOutputSchema = CacheMetadataSchema.extend({
  /** Array of month summary objects */
  months: z.array(MonthSummarySchema).describe('List of months'),
});

// Export inferred TypeScript types
export type MonthCategory = z.infer<typeof MonthCategorySchema>;
export type MonthDetail = z.infer<typeof MonthDetailSchema>;
export type MonthSummary = z.infer<typeof MonthSummarySchema>;
export type GetMonthOutput = z.infer<typeof GetMonthOutputSchema>;
export type ListMonthsOutput = z.infer<typeof ListMonthsOutputSchema>;
