import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as ynab from 'ynab';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { handleListPayees } from '../payeeTools.js';
import { CacheManager } from '../../server/cacheManager.js';
import { ServerKnowledgeStore } from '../../server/serverKnowledgeStore.js';
import { DeltaCache } from '../../server/deltaCache.js';
import { DeltaFetcher } from '../deltaFetcher.js';

const shouldSkip = ['true', '1', 'yes', 'y', 'on'].includes(
  (process.env['SKIP_E2E_TESTS'] || '').toLowerCase().trim(),
);
const describeIntegration = shouldSkip ? describe.skip : describe;

describeIntegration('Delta-backed payee tool handler', () => {
  let ynabAPI: ynab.API;
  let testBudgetId: string;
  let deltaFetcher: DeltaFetcher;
  let previousNodeEnv: string | undefined;

  beforeAll(async () => {
    const accessToken = process.env['YNAB_ACCESS_TOKEN'];
    if (!accessToken) {
      throw new Error(
        'YNAB_ACCESS_TOKEN is required. Set it in your environment to run integration tests.',
      );
    }

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

  const parseResponse = (result: CallToolResult) => {
    const content = result.content?.[0];
    if (!content || content.type !== 'text') {
      throw new Error('Unexpected tool response format');
    }
    return JSON.parse(content.text);
  };
  const expectCacheHit = (payload: { cached: boolean; cache_info: string }) => {
    expect(payload.cached).toBe(true);
    expect(payload.cache_info).toMatch(/cache/i);
  };

  it('serves cached payee results on the second invocation', { meta: { tier: 'domain', domain: 'delta' } }, async () => {
    const params = { budget_id: testBudgetId };
    const firstCall = await handleListPayees(ynabAPI, deltaFetcher, params);
    const firstPayload = parseResponse(firstCall);
    expect(firstPayload.cached).toBe(false);

    const secondCall = await handleListPayees(ynabAPI, deltaFetcher, params);
    const secondPayload = parseResponse(secondCall);
    expectCacheHit(secondPayload);
  });
});
