import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as ynab from 'ynab';
import { performance } from 'node:perf_hooks';
import { CacheManager } from '../server/cacheManager.js';
import { ServerKnowledgeStore } from '../server/serverKnowledgeStore.js';
import { DeltaCache } from '../server/deltaCache.js';
import { DeltaFetcher } from '../tools/deltaFetcher.js';

const skipPerfFlag = (process.env['SKIP_PERFORMANCE_TESTS'] ?? 'true').toLowerCase().trim();
const shouldSkipPerformance = ['true', '1', 'yes', 'y', 'on'].includes(skipPerfFlag);
const describePerformance = shouldSkipPerformance ? describe.skip : describe;

describePerformance('Delta performance characteristics', () => {
  let ynabAPI: ynab.API;
  let testBudgetId: string;
  let testAccountId: string;
  let deltaFetcher: DeltaFetcher;

  beforeAll(async () => {
    const accessToken = process.env['YNAB_ACCESS_TOKEN'];
    if (!accessToken) {
      throw new Error('YNAB_ACCESS_TOKEN is required to run performance tests.');
    }
    ynabAPI = new ynab.API(accessToken);
    const budgetsResponse = await ynabAPI.budgets.getBudgets();
    const budget = budgetsResponse.data.budgets[0];
    if (!budget) {
      throw new Error('No budgets available for performance tests.');
    }
    testBudgetId = budget.id;

    const accountsResponse = await ynabAPI.accounts.getAccounts(testBudgetId);
    const account = accountsResponse.data.accounts.find((acct) => !acct.closed);
    if (!account) {
      throw new Error('No open accounts available for performance tests.');
    }
    testAccountId = account.id;
  });

  beforeEach(() => {
    const cacheManager = new CacheManager();
    const knowledgeStore = new ServerKnowledgeStore();
    const deltaCache = new DeltaCache(cacheManager, knowledgeStore);
    deltaFetcher = new DeltaFetcher(ynabAPI, deltaCache);
    process.env['YNAB_MCP_ENABLE_DELTA'] = 'true';
  });

  afterEach(() => {
    delete process.env['YNAB_MCP_ENABLE_DELTA'];
  });

  const measure = async <T>(loader: () => Promise<T>) => {
    const start = performance.now();
    const result = await loader();
    const duration = performance.now() - start;
    return { result, duration };
  };

  it('reuses cache and avoids repeated full refreshes', async () => {
    const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const first = await measure(() =>
      deltaFetcher.fetchTransactionsByAccount(testBudgetId, testAccountId, sinceDate, {
        forceFullRefresh: true,
      }),
    );

    const second = await measure(() =>
      deltaFetcher.fetchTransactionsByAccount(testBudgetId, testAccountId, sinceDate),
    );

    expect(first.result.wasCached).toBe(false);
    expect(second.result.wasCached).toBe(true);
    expect(second.duration).toBeLessThan(first.duration + 250);
  });
});
