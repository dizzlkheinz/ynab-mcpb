import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as ynab from 'ynab';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { handleListAccounts } from '../accountTools.js';
import { handleListTransactions } from '../transactionTools.js';
import { CacheManager } from '../../server/cacheManager.js';
import { ServerKnowledgeStore } from '../../server/serverKnowledgeStore.js';
import { DeltaCache } from '../../server/deltaCache.js';
import { DeltaFetcher } from '../deltaFetcher.js';

const shouldSkip = ['true', '1', 'yes', 'y', 'on'].includes(
  (process.env['SKIP_E2E_TESTS'] || '').toLowerCase().trim(),
);
const describeIntegration = shouldSkip ? describe.skip : describe;

describeIntegration('Delta-backed account tool handlers', () => {
  let ynabAPI: ynab.API;
  let testBudgetId: string;
  let testAccountId: string;
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

    const accountsResponse = await ynabAPI.accounts.getAccounts(testBudgetId);
    const account = accountsResponse.data.accounts.find((acct) => !acct.closed);
    if (!account) {
      throw new Error('No open accounts available for delta integration tests.');
    }
    testAccountId = account.id;
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

  it('serves cached account results on the second invocation', { meta: { tier: 'domain', domain: 'delta' } }, async () => {
    const params = { budget_id: testBudgetId };
    const firstCall = await handleListAccounts(ynabAPI, deltaFetcher, params);
    const firstPayload = parseResponse(firstCall);
    expect(firstPayload.cached).toBe(false);

    const secondCall = await handleListAccounts(ynabAPI, deltaFetcher, params);
    const secondPayload = parseResponse(secondCall);
    expect(secondPayload.cached).toBe(true);
    expect(secondPayload.cache_info).toMatch(/cache/i);
  });

  it('reports delta usage for list_transactions after a change', { meta: { tier: 'domain', domain: 'delta' } }, async () => {
    const params = { budget_id: testBudgetId, account_id: testAccountId };
    const firstCall = await handleListTransactions(ynabAPI, deltaFetcher, params);
    const firstPayload = parseResponse(firstCall);
    expect(firstPayload.cached).toBe(false);

    const transactionDate = new Date().toISOString().split('T')[0];
    const memo = `delta-integration-${Date.now()}`;
    const transactionPayload: ynab.SaveTransaction = {
      account_id: testAccountId,
      date: transactionDate,
      amount: -1000,
      memo,
      payee_name: 'Delta Integration Test',
      approved: false,
      cleared: 'uncleared',
    };

    const createResponse = await ynabAPI.transactions.createTransaction(testBudgetId, {
      transaction: transactionPayload,
    });
    expect(createResponse.data.transaction).toBeDefined();
    const createdId = createResponse.data.transaction?.id;
    expect(createdId).toBeTruthy();

    try {
      const secondCall = await handleListTransactions(ynabAPI, deltaFetcher, params);
      const secondPayload = parseResponse(secondCall);
      expect(secondPayload.cached).toBe(true);
      // Check for delta-related keywords (flexible assertion)
      expect(secondPayload.cache_info).toMatch(/delta.*merge|merge.*delta/i);
    } finally {
      if (createdId) {
        await ynabAPI.transactions.deleteTransaction(testBudgetId, createdId);
      }
    }
  });
});
