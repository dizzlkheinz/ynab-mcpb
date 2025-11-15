import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as ynab from 'ynab';
import { CacheManager } from '../../server/cacheManager.js';
import { ServerKnowledgeStore } from '../../server/serverKnowledgeStore.js';
import { DeltaCache } from '../../server/deltaCache.js';
import { DeltaFetcher } from '../deltaFetcher.js';

const shouldSkip = ['true', '1', 'yes', 'y', 'on'].includes(
  (process.env['SKIP_E2E_TESTS'] || '').toLowerCase().trim(),
);
const hasToken = !!process.env['YNAB_ACCESS_TOKEN'];
const skipTests = shouldSkip || !hasToken;
const describeIntegration = skipTests ? describe.skip : describe;

describeIntegration('Delta fetcher scheduled transactions integration', () => {
  let ynabAPI: ynab.API;
  let testBudgetId: string;
  let deltaFetcher: DeltaFetcher;
  let previousNodeEnv: string | undefined;

  beforeAll(async () => {
    const accessToken = process.env['YNAB_ACCESS_TOKEN']!;
    ynabAPI = new ynab.API(accessToken);
    const budgetsResponse = await ynabAPI.budgets.getBudgets();
    const budget = budgetsResponse.data.budgets[0];
    if (!budget) {
      throw new Error('No budgets available for delta integration tests.');
    }
    testBudgetId = budget.id;
  });

  beforeEach(() => {
    previousNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'integration';
    const cacheManager = new CacheManager();
    const knowledgeStore = new ServerKnowledgeStore();
    const deltaCache = new DeltaCache(cacheManager, knowledgeStore);
    deltaFetcher = new DeltaFetcher(ynabAPI, deltaCache);
    process.env['YNAB_MCP_ENABLE_DELTA'] = 'true';
  });

  afterEach(() => {
    delete process.env['YNAB_MCP_ENABLE_DELTA'];
    if (previousNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = previousNodeEnv;
    }
    previousNodeEnv = undefined;
  });

  it('caches scheduled transactions on repeated fetches', { meta: { tier: 'domain', domain: 'delta' } }, async () => {
    const firstResult = await deltaFetcher.fetchScheduledTransactions(testBudgetId);
    expect(firstResult.wasCached).toBe(false);
    expect(firstResult.serverKnowledge).toBeGreaterThanOrEqual(0);
    // Validate data structure
    expect(Array.isArray(firstResult.data)).toBe(true);
    if (firstResult.data.length > 0) {
      const sample = firstResult.data[0];
      expect(sample).toHaveProperty('id');
      expect(sample).toHaveProperty('date_first');
      expect(sample).toHaveProperty('frequency');
    }

    const secondResult = await deltaFetcher.fetchScheduledTransactions(testBudgetId);
    expect(secondResult.wasCached).toBe(true);
    expect(secondResult.serverKnowledge).toBeGreaterThanOrEqual(firstResult.serverKnowledge);
    // Validate cached data structure matches
    expect(Array.isArray(secondResult.data)).toBe(true);
    expect(secondResult.data.length).toBe(firstResult.data.length);
  });
});
