/**
 * @fileoverview Output schemas for budget-related tools.
 *
 * Defines Zod schemas and TypeScript types for responses from budget tools:
 * - `list_budgets`: Returns all budgets with metadata
 *
 * @see src/tools/budgetTools.ts:24-67 for handler implementation
 *
 * @example
 * ```typescript
 * const output: ListBudgetsOutput = {
 *   budgets: [
 *     {
 *       id: 'budget-123',
 *       name: 'My Budget',
 *       last_modified_on: '2025-11-17T10:30:00Z',
 *       first_month: '2024-01-01',
 *       last_month: '2025-11-01',
 *       date_format: { format: 'MM/DD/YYYY' },
 *       currency_format: {
 *         iso_code: 'USD',
 *         example_format: '$1,234.56',
 *         decimal_digits: 2,
 *         decimal_separator: '.',
 *         symbol_first: true,
 *         group_separator: ',',
 *         currency_symbol: '$',
 *         display_symbol: true
 *       }
 *     }
 *   ],
 *   cached: true,
 *   cache_info: {
 *     cache_key: 'budgets:all',
 *     age_ms: 1200,
 *     stale: false
 *   }
 * };
 * ```
 */

import { z } from 'zod/v4';
import { CacheMetadataSchema } from '../shared/commonOutputs.js';
import { DateFormatSchema, CurrencyFormatSchema } from './utilityOutputs.js';

/**
 * Schema for a budget summary object.
 *
 * Represents basic budget metadata returned by YNAB API.
 */
export const BudgetSummarySchema = z.object({
  /** Unique identifier for the budget */
  id: z.string().describe('Budget ID'),

  /** Human-readable budget name */
  name: z.string().describe('Budget name'),

  /** ISO 8601 timestamp of last modification (optional) */
  last_modified_on: z.string().optional().describe('Last modification timestamp'),

  /** First month in budget (YYYY-MM-DD format, optional) */
  first_month: z.string().optional().describe('First month in budget'),

  /** Last month in budget (YYYY-MM-DD format, optional) */
  last_month: z.string().optional().describe('Last month in budget'),

  /** Date format settings for this budget (optional) */
  date_format: DateFormatSchema.optional().describe('Date format settings'),

  /** Currency format settings for this budget (optional) */
  currency_format: CurrencyFormatSchema.optional().describe('Currency format settings'),
});

/**
 * Schema for `list_budgets` tool output.
 *
 * Returns all budgets accessible to the user with cache metadata.
 */
export const ListBudgetsOutputSchema = CacheMetadataSchema.extend({
  /** Array of budget summaries */
  budgets: z.array(BudgetSummarySchema).describe('List of budgets'),
});

// Export inferred TypeScript types
export type BudgetSummary = z.infer<typeof BudgetSummarySchema>;
export type ListBudgetsOutput = z.infer<typeof ListBudgetsOutputSchema>;
