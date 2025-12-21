/**
 * @fileoverview MCP Completions Manager
 * Provides autocomplete suggestions for prompts and resource templates.
 * @module server/completions
 */

import type * as ynab from 'ynab';
import type { CacheManager } from './cacheManager.js';
import { CACHE_TTLS } from './cacheManager.js';

/**
 * Completion result structure following MCP spec
 */
export interface CompletionResult {
  completion: {
    values: string[];
    total?: number;
    hasMore?: boolean;
  };
}

/**
 * Arguments that can be completed
 */
type CompletableArgument =
  | 'budget_id'
  | 'account_id'
  | 'account_name'
  | 'category'
  | 'category_id'
  | 'payee'
  | 'payee_id';

/**
 * Context for completions - previously resolved arguments
 * The arguments property may be undefined when no prior context exists
 */
interface CompletionContext {
  arguments?: Record<string, string> | undefined;
}

/**
 * Maximum number of completion values to return (per MCP spec)
 */
const MAX_COMPLETIONS = 100;

/**
 * CompletionsManager handles autocomplete requests for YNAB entities.
 * Provides completions for budgets, accounts, categories, and payees.
 */
export class CompletionsManager {
  constructor(
    private readonly ynabAPI: ynab.API,
    private readonly cacheManager: CacheManager,
    private readonly getDefaultBudgetId: () => string | undefined,
  ) {}

  /**
   * Get completions for an argument based on the current value
   */
  async getCompletions(
    argumentName: string,
    value: string,
    context?: CompletionContext,
  ): Promise<CompletionResult> {
    const normalizedName = argumentName.toLowerCase() as CompletableArgument;

    switch (normalizedName) {
      case 'budget_id':
        return this.completeBudgets(value);

      case 'account_id':
      case 'account_name':
        return this.completeAccounts(value, context);

      case 'category':
      case 'category_id':
        return this.completeCategories(value, context);

      case 'payee':
      case 'payee_id':
        return this.completePayees(value, context);

      default:
        return { completion: { values: [], total: 0, hasMore: false } };
    }
  }

  /**
   * Complete budget names/IDs
   */
  private async completeBudgets(value: string): Promise<CompletionResult> {
    const budgets = await this.cacheManager.wrap('completions:budgets', {
      ttl: CACHE_TTLS.BUDGETS,
      loader: async () => {
        const response = await this.ynabAPI.budgets.getBudgets();
        return response.data.budgets.map((b) => ({
          id: b.id,
          name: b.name,
        }));
      },
    });

    return this.filterAndFormat(budgets, value, (b) => [b.name, b.id]);
  }

  /**
   * Complete account names/IDs within a budget
   */
  private async completeAccounts(
    value: string,
    context?: CompletionContext,
  ): Promise<CompletionResult> {
    const budgetId = context?.arguments?.['budget_id'] ?? this.getDefaultBudgetId();
    if (!budgetId) {
      return { completion: { values: [], total: 0, hasMore: false } };
    }

    const accounts = await this.cacheManager.wrap(`completions:accounts:${budgetId}`, {
      ttl: CACHE_TTLS.ACCOUNTS,
      loader: async () => {
        const response = await this.ynabAPI.accounts.getAccounts(budgetId);
        return response.data.accounts
          .filter((a) => !a.deleted && !a.closed)
          .map((a) => ({
            id: a.id,
            name: a.name,
          }));
      },
    });

    return this.filterAndFormat(accounts, value, (a) => [a.name, a.id]);
  }

  /**
   * Complete category names/IDs within a budget
   */
  private async completeCategories(
    value: string,
    context?: CompletionContext,
  ): Promise<CompletionResult> {
    const budgetId = context?.arguments?.['budget_id'] ?? this.getDefaultBudgetId();
    if (!budgetId) {
      return { completion: { values: [], total: 0, hasMore: false } };
    }

    const categories = await this.cacheManager.wrap(`completions:categories:${budgetId}`, {
      ttl: CACHE_TTLS.CATEGORIES,
      loader: async () => {
        const response = await this.ynabAPI.categories.getCategories(budgetId);
        const result: { id: string; name: string; group: string }[] = [];
        for (const group of response.data.category_groups) {
          if (group.hidden || group.deleted) continue;
          for (const cat of group.categories) {
            if (cat.hidden || cat.deleted) continue;
            result.push({
              id: cat.id,
              name: cat.name,
              group: group.name,
            });
          }
        }
        return result;
      },
    });

    // For categories, include group name in display for clarity
    return this.filterAndFormat(categories, value, (c) => [c.name, `${c.group}: ${c.name}`, c.id]);
  }

  /**
   * Complete payee names/IDs within a budget
   */
  private async completePayees(
    value: string,
    context?: CompletionContext,
  ): Promise<CompletionResult> {
    const budgetId = context?.arguments?.['budget_id'] ?? this.getDefaultBudgetId();
    if (!budgetId) {
      return { completion: { values: [], total: 0, hasMore: false } };
    }

    const payees = await this.cacheManager.wrap(`completions:payees:${budgetId}`, {
      ttl: CACHE_TTLS.PAYEES,
      loader: async () => {
        const response = await this.ynabAPI.payees.getPayees(budgetId);
        return response.data.payees
          .filter((p) => !p.deleted)
          .map((p) => ({
            id: p.id,
            name: p.name,
          }));
      },
    });

    return this.filterAndFormat(payees, value, (p) => [p.name, p.id]);
  }

  /**
   * Filter items by value match and format as completion result.
   * Searches case-insensitively across all searchable fields.
   */
  private filterAndFormat<T>(
    items: T[],
    value: string,
    getSearchableValues: (item: T) => string[],
  ): CompletionResult {
    const lowerValue = value.toLowerCase();

    // Filter items that match the search value
    const matches = items.filter((item) =>
      getSearchableValues(item).some((v) => v.toLowerCase().includes(lowerValue)),
    );

    // Sort by relevance (exact prefix matches first, then contains)
    matches.sort((a, b) => {
      const aValues = getSearchableValues(a);
      const bValues = getSearchableValues(b);

      const aStartsWith = aValues.some((v) => v.toLowerCase().startsWith(lowerValue));
      const bStartsWith = bValues.some((v) => v.toLowerCase().startsWith(lowerValue));

      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      // Secondary sort by first value (name)
      return (aValues[0] ?? '').localeCompare(bValues[0] ?? '');
    });

    // Get unique display values (prefer names over IDs)
    const uniqueValues = new Set<string>();
    for (const item of matches) {
      const values = getSearchableValues(item);
      // Add the first matching value (usually the name)
      const matchingValue = values.find((v) => v.toLowerCase().includes(lowerValue));
      if (matchingValue) {
        uniqueValues.add(matchingValue);
      }
      if (uniqueValues.size >= MAX_COMPLETIONS) break;
    }

    const values = Array.from(uniqueValues).slice(0, MAX_COMPLETIONS);

    return {
      completion: {
        values,
        total: matches.length,
        hasMore: matches.length > MAX_COMPLETIONS,
      },
    };
  }
}
