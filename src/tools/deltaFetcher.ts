import * as ynab from 'ynab';
import { DeltaCache, type DeltaFetchResult } from '../server/deltaCache.js';
import {
  mergeFlatEntities,
  mergeCategories,
  mergeTransactions,
  mergeMonths,
} from '../server/deltaCache.merge.js';
import { CacheManager, CACHE_TTLS } from '../server/cacheManager.js';

export interface DeltaFetchOptions {
  forceFullRefresh?: boolean;
  ttl?: number;
}

export class DeltaFetcher {
  constructor(
    private readonly ynabAPI: ynab.API,
    private readonly deltaCache: DeltaCache,
  ) {}

  async fetchAccounts(
    budgetId: string,
    options?: DeltaFetchOptions,
  ): Promise<DeltaFetchResult<ynab.Account>> {
    const cacheKey = CacheManager.generateKey('accounts', 'list', budgetId);
    return await this.deltaCache.fetchWithDelta<ynab.Account>(
      cacheKey,
      budgetId,
      async (lastKnowledge?: number) => {
        const response =
          lastKnowledge !== undefined
            ? await this.ynabAPI.accounts.getAccounts(budgetId, lastKnowledge)
            : await this.ynabAPI.accounts.getAccounts(budgetId);
        return {
          data: response.data.accounts,
          serverKnowledge: response.data.server_knowledge ?? 0,
        };
      },
      mergeFlatEntities,
      this.buildDeltaOptions(CACHE_TTLS.ACCOUNTS, options),
    );
  }

  async fetchCategories(
    budgetId: string,
    options?: DeltaFetchOptions,
  ): Promise<DeltaFetchResult<ynab.CategoryGroupWithCategories>> {
    const cacheKey = CacheManager.generateKey('categories', 'list', budgetId);
    return await this.deltaCache.fetchWithDelta<ynab.CategoryGroupWithCategories>(
      cacheKey,
      budgetId,
      async (lastKnowledge?: number) => {
        const response =
          lastKnowledge !== undefined
            ? await this.ynabAPI.categories.getCategories(budgetId, lastKnowledge)
            : await this.ynabAPI.categories.getCategories(budgetId);
        return {
          data: response.data.category_groups,
          serverKnowledge: response.data.server_knowledge ?? 0,
        };
      },
      mergeCategories,
      this.buildDeltaOptions(CACHE_TTLS.CATEGORIES, options),
    );
  }

  async fetchTransactions(
    budgetId: string,
    sinceDate?: string,
    type?: ynab.GetTransactionsTypeEnum,
    options?: DeltaFetchOptions,
  ): Promise<DeltaFetchResult<ynab.TransactionDetail>> {
    const normalizedSince = sinceDate ?? 'all';
    const normalizedType = type ?? 'all';
    const cacheKey = CacheManager.generateKey(
      'transactions',
      'list',
      budgetId,
      normalizedSince,
      normalizedType,
    );
    return await this.deltaCache.fetchWithDelta<ynab.TransactionDetail>(
      cacheKey,
      budgetId,
      async (lastKnowledge?: number) => {
        const response = await this.ynabAPI.transactions.getTransactions(
          budgetId,
          sinceDate,
          type,
          lastKnowledge,
        );
        return {
          data: response.data.transactions,
          serverKnowledge: response.data.server_knowledge ?? 0,
        };
      },
      mergeTransactions,
      this.buildDeltaOptions(CACHE_TTLS.TRANSACTIONS, options),
    );
  }

  async fetchTransactionsByAccount(
    budgetId: string,
    accountId: string,
    sinceDate?: string,
    options?: DeltaFetchOptions,
  ): Promise<DeltaFetchResult<ynab.TransactionDetail>> {
    const normalizedSince = sinceDate ?? 'all';
    const cacheKey = CacheManager.generateKey(
      'transactions',
      'account',
      budgetId,
      accountId,
      normalizedSince,
    );
    return await this.deltaCache.fetchWithDelta<ynab.TransactionDetail>(
      cacheKey,
      budgetId,
      async (lastKnowledge?: number) => {
        const response = await this.ynabAPI.transactions.getTransactionsByAccount(
          budgetId,
          accountId,
          sinceDate,
          undefined,
          lastKnowledge,
        );
        return {
          data: response.data.transactions,
          serverKnowledge: response.data.server_knowledge ?? 0,
        };
      },
      mergeTransactions,
      this.buildDeltaOptions(CACHE_TTLS.TRANSACTIONS, options),
    );
  }

  async fetchAccountsFull(budgetId: string): Promise<DeltaFetchResult<ynab.Account>> {
    const response = await this.ynabAPI.accounts.getAccounts(budgetId);
    const accounts = response.data.accounts.filter((account) => !account.deleted);
    return {
      data: accounts,
      wasCached: false,
      usedDelta: false,
      serverKnowledge: response.data.server_knowledge ?? 0,
    };
  }

  async fetchTransactionsByAccountFull(
    budgetId: string,
    accountId: string,
    sinceDate?: string,
  ): Promise<DeltaFetchResult<ynab.TransactionDetail>> {
    const response = await this.ynabAPI.transactions.getTransactionsByAccount(
      budgetId,
      accountId,
      sinceDate,
    );
    const transactions = response.data.transactions.filter((transaction) => !transaction.deleted);
    return {
      data: transactions,
      wasCached: false,
      usedDelta: false,
      serverKnowledge: response.data.server_knowledge ?? 0,
    };
  }

  async fetchScheduledTransactions(
    budgetId: string,
    options?: DeltaFetchOptions,
  ): Promise<DeltaFetchResult<ynab.ScheduledTransactionDetail>> {
    const cacheKey = CacheManager.generateKey('scheduled_transactions', 'list', budgetId);
    return await this.deltaCache.fetchWithDelta<ynab.ScheduledTransactionDetail>(
      cacheKey,
      budgetId,
      async (lastKnowledge?: number) => {
        const response =
          lastKnowledge !== undefined
            ? await this.ynabAPI.scheduledTransactions.getScheduledTransactions(
                budgetId,
                lastKnowledge,
              )
            : await this.ynabAPI.scheduledTransactions.getScheduledTransactions(budgetId);
        return {
          data: response.data.scheduled_transactions,
          serverKnowledge: response.data.server_knowledge ?? 0,
        };
      },
      mergeFlatEntities,
      this.buildDeltaOptions(CACHE_TTLS.SCHEDULED_TRANSACTIONS, options),
    );
  }

  async fetchPayees(
    budgetId: string,
    options?: DeltaFetchOptions,
  ): Promise<DeltaFetchResult<ynab.Payee>> {
    const cacheKey = CacheManager.generateKey('payees', 'list', budgetId);
    return await this.deltaCache.fetchWithDelta<ynab.Payee>(
      cacheKey,
      budgetId,
      async (lastKnowledge?: number) => {
        const response =
          lastKnowledge !== undefined
            ? await this.ynabAPI.payees.getPayees(budgetId, lastKnowledge)
            : await this.ynabAPI.payees.getPayees(budgetId);
        return {
          data: response.data.payees,
          serverKnowledge: response.data.server_knowledge ?? 0,
        };
      },
      mergeFlatEntities,
      this.buildDeltaOptions(CACHE_TTLS.PAYEES, options),
    );
  }

  async fetchMonths(
    budgetId: string,
    options?: DeltaFetchOptions,
  ): Promise<DeltaFetchResult<ynab.MonthSummary>> {
    const cacheKey = CacheManager.generateKey('months', 'list', budgetId);
    return await this.deltaCache.fetchWithDelta<ynab.MonthSummary>(
      cacheKey,
      budgetId,
      async (lastKnowledge?: number) => {
        const response =
          lastKnowledge !== undefined
            ? await this.ynabAPI.months.getBudgetMonths(budgetId, lastKnowledge)
            : await this.ynabAPI.months.getBudgetMonths(budgetId);
        return {
          data: response.data.months,
          serverKnowledge: response.data.server_knowledge ?? 0,
        };
      },
      mergeMonths,
      this.buildDeltaOptions(CACHE_TTLS.MONTHS, options),
    );
  }

  async fetchBudgets(options?: DeltaFetchOptions): Promise<DeltaFetchResult<ynab.BudgetSummary>> {
    const cacheKey = CacheManager.generateKey('budgets', 'list');
    const result = await this.deltaCache.fetchWithDelta<
      ynab.BudgetSummary & { deleted?: boolean }
    >(
      cacheKey,
      'global',
      async () => {
        const response = await this.ynabAPI.budgets.getBudgets();
        const serverKnowledge = (response.data as { server_knowledge?: number }).server_knowledge ?? 0;
        return {
          data: response.data.budgets,
          serverKnowledge,
        };
      },
      mergeFlatEntities,
      {
        ttl: options?.ttl ?? CACHE_TTLS.BUDGETS,
        // TODO: Support delta responses when merge logic can handle nested objects safely.
        forceFullRefresh: true,
      },
    );
    return {
      ...result,
      data: result.data as ynab.BudgetSummary[],
    };
  }

  private buildDeltaOptions(
    defaultTtl: number,
    options?: DeltaFetchOptions,
  ): { ttl: number; forceFullRefresh?: boolean } {
    return {
      ttl: options?.ttl ?? defaultTtl,
      ...(options?.forceFullRefresh !== undefined && { forceFullRefresh: options.forceFullRefresh }),
    };
  }
}
