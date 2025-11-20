import { describe, it, expect, beforeAll } from 'vitest';
import * as ynab from 'ynab';
import { handleListBudgets, handleGetBudget } from '../budgetTools.js';
import { skipOnRateLimit } from '../../__tests__/testUtils.js';

/**
 * Integration tests for budget tools using real YNAB API
 * Skips if YNAB_ACCESS_TOKEN is not set or if SKIP_E2E_TESTS is true
 */
const isSkip = ['true', '1', 'yes', 'y', 'on'].includes(
  (process.env['SKIP_E2E_TESTS'] || '').toLowerCase().trim(),
);
const hasToken = !!process.env['YNAB_ACCESS_TOKEN'];
const shouldSkip = isSkip || !hasToken;
const describeIntegration = shouldSkip ? describe.skip : describe;

describeIntegration('Budget Tools Integration', () => {
  let ynabAPI: ynab.API;
  let testBudgetId: string;

  beforeAll(() => {
    const accessToken = process.env['YNAB_ACCESS_TOKEN']!;
    ynabAPI = new ynab.API(accessToken);
  });

  describe('handleListBudgets', () => {
    it(
      'should successfully list budgets from real API',
      { meta: { tier: 'core', domain: 'budgets' } },
      async (ctx) => {
        await skipOnRateLimit(async () => {
          const result = await handleListBudgets(ynabAPI);

          expect(result.content).toHaveLength(1);
          expect(result.content[0].type).toBe('text');

          const parsedContent = JSON.parse(result.content[0].text);

          // If response contains an error, throw it so skipOnRateLimit can catch it
          if (parsedContent.error) {
            throw new Error(JSON.stringify(parsedContent.error));
          }

          expect(parsedContent.budgets).toBeDefined();
          expect(Array.isArray(parsedContent.budgets)).toBe(true);
          expect(parsedContent.budgets.length).toBeGreaterThan(0);

          // Store first budget ID for next test
          testBudgetId = parsedContent.budgets[0].id;

          // Verify budget structure
          const firstBudget = parsedContent.budgets[0];
          expect(firstBudget.id).toBeDefined();
          expect(firstBudget.name).toBeDefined();
          expect(firstBudget.last_modified_on).toBeDefined();
          expect(firstBudget.first_month).toBeDefined();
          expect(firstBudget.last_month).toBeDefined();

          console.warn(`✅ Successfully listed ${parsedContent.budgets.length} budgets`);
        }, ctx);
      },
    );
  });

  describe('handleGetBudget', () => {
    it(
      'should successfully get budget details from real API',
      { meta: { tier: 'core', domain: 'budgets' } },
      async (ctx) => {
        await skipOnRateLimit(async () => {
          // Get a budget ID if not set by previous test
          let budgetId = testBudgetId;
          if (!budgetId) {
            const listResult = await handleListBudgets(ynabAPI);
            const listContent = JSON.parse(listResult.content[0].text);
            if (listContent.error) {
              throw new Error(JSON.stringify(listContent.error));
            }
            budgetId = listContent.budgets[0]?.id;
            if (!budgetId) {
              throw new Error('No budgets available for testing');
            }
          }

          // Use the budget ID
          const result = await handleGetBudget(ynabAPI, { budget_id: budgetId });

          expect(result.content).toHaveLength(1);
          expect(result.content[0].type).toBe('text');

          const parsedContent = JSON.parse(result.content[0].text);

          // If response contains an error, throw it so skipOnRateLimit can catch it
          if (parsedContent.error) {
            throw new Error(JSON.stringify(parsedContent.error));
          }

          expect(parsedContent.budget).toBeDefined();

          const budget = parsedContent.budget;
          expect(budget.id).toBe(budgetId);
          expect(budget.name).toBeDefined();
          expect(budget.accounts_count).toBeDefined();
          expect(typeof budget.accounts_count).toBe('number');
          expect(budget.categories_count).toBeDefined();
          expect(typeof budget.categories_count).toBe('number');

          console.warn(`✅ Successfully retrieved budget: ${budget.name}`);
          console.warn(`   - ${budget.accounts_count} accounts`);
          console.warn(`   - ${budget.categories_count} categories`);
        }, ctx);
      },
    );

    it(
      'should handle invalid budget ID gracefully',
      { meta: { tier: 'domain', domain: 'budgets' } },
      async (ctx) => {
        await skipOnRateLimit(async () => {
          const result = await handleGetBudget(ynabAPI, { budget_id: 'invalid-budget-id' });

          expect(result.content).toHaveLength(1);
          expect(result.content[0].type).toBe('text');

          const parsedContent = JSON.parse(result.content[0].text);
          expect(parsedContent.error).toBeDefined();
          expect(parsedContent.error.message).toBeDefined();

          console.warn(`✅ Correctly handled invalid budget ID: ${parsedContent.error.message}`);
        }, ctx);
      },
    );
  });
});
