import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ynab from 'ynab';
import { handleListBudgets, handleGetBudget, GetBudgetSchema } from '../budgetTools.js';
import { createDeltaFetcherMock, createRejectingDeltaFetcherMock } from './deltaTestUtils.js';

// Mock the cache manager
vi.mock('../../server/cacheManager.js', () => ({
  cacheManager: {
    wrap: vi.fn(),
    has: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    deleteByPrefix: vi.fn(),
    deleteByBudgetId: vi.fn(),
    clear: vi.fn(),
  },
  CacheManager: {
    generateKey: vi.fn(),
  },
  CACHE_TTLS: {
    BUDGETS: 300000,
  },
}));

// Mock the YNAB API
const mockYnabAPI = {
  budgets: {
    getBudgets: vi.fn(),
    getBudgetById: vi.fn(),
  },
} as unknown as ynab.API;

// Import mocked cache manager
const { cacheManager } = await import('../../server/cacheManager.js');

describe('Budget Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset NODE_ENV to test to ensure cache bypassing in tests
    process.env['NODE_ENV'] = 'test';
  });

  describe('handleListBudgets', () => {
    it('should include cache metadata from delta fetcher results', async () => {
      const mockBudgets = [
        {
          id: 'budget-1',
          name: 'My Budget',
          last_modified_on: '2024-01-01T00:00:00Z',
          first_month: '2024-01-01',
          last_month: '2024-12-01',
          date_format: { format: 'MM/DD/YYYY' },
          currency_format: { iso_code: 'USD', example_format: '$123.45' },
        },
      ];
      const { fetcher, resolved } = createDeltaFetcherMock('fetchBudgets', {
        data: mockBudgets,
        wasCached: true,
        usedDelta: true,
      });

      const result = await handleListBudgets(mockYnabAPI, fetcher, {});

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.cached).toBe(resolved.wasCached);
      expect(parsedContent.cache_info).toContain('delta merge applied');
    });

    it('should return formatted budget list on success', async () => {
      const mockBudgets = [
        {
          id: 'budget-1',
          name: 'My Budget',
          last_modified_on: '2024-01-01T00:00:00Z',
          first_month: '2024-01-01',
          last_month: '2024-12-01',
          date_format: { format: 'MM/DD/YYYY' },
          currency_format: { iso_code: 'USD', example_format: '$123.45' },
        },
        {
          id: 'budget-2',
          name: 'Shared Budget',
          last_modified_on: '2024-02-01T00:00:00Z',
          first_month: '2024-02-01',
          last_month: '2024-12-01',
          date_format: { format: 'YYYY-MM-DD' },
          currency_format: { iso_code: 'EUR', example_format: 'EUR 123.45' },
        },
      ];
      const { fetcher, resolved } = createDeltaFetcherMock('fetchBudgets', {
        data: mockBudgets,
        wasCached: false,
      });

      const result = await handleListBudgets(mockYnabAPI, fetcher, {});

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.budgets).toHaveLength(2);
      expect(parsedContent.cached).toBe(resolved.wasCached);
      expect(parsedContent.cache_info).toBe('Fresh data retrieved from YNAB API');
    });

    it('should handle errors reported by the delta fetcher', async () => {
      const { fetcher } = createRejectingDeltaFetcherMock(
        'fetchBudgets',
        new Error('401 Unauthorized'),
      );

      const result = await handleListBudgets(mockYnabAPI, fetcher, {});

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error.message).toBe('Invalid or expired YNAB access token');
    });
  });
  describe('handleGetBudget', () => {
    it('should not use cache (as per design - individual budgets change less frequently)', async () => {
      const mockBudget = {
        id: 'budget-1',
        name: 'My Budget',
        last_modified_on: '2024-01-01T00:00:00Z',
        first_month: '2024-01-01',
        last_month: '2024-12-01',
        date_format: { format: 'MM/DD/YYYY' },
        currency_format: { iso_code: 'USD', example_format: '$123.45' },
      };

      (mockYnabAPI.budgets.getBudgetById as any).mockResolvedValue({
        data: { budget: mockBudget },
      });

      const result = await handleGetBudget(mockYnabAPI, { budget_id: 'budget-1' });

      // handleGetBudget should not use cache (direct API call)
      expect(cacheManager.wrap).not.toHaveBeenCalled();
      expect(mockYnabAPI.budgets.getBudgetById).toHaveBeenCalledTimes(1);

      // Verify result structure
      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.budget.id).toBe('budget-1');
    });

    it('should return detailed budget information on success', async () => {
      const mockBudget = {
        id: 'budget-1',
        name: 'My Budget',
        last_modified_on: '2024-01-01T00:00:00Z',
        first_month: '2024-01-01',
        last_month: '2024-12-01',
        date_format: { format: 'MM/DD/YYYY' },
        currency_format: { iso_code: 'USD', example_format: '$123.45' },
        accounts: [
          {
            id: 'account-1',
            name: 'Checking',
            type: 'checking',
            on_budget: true,
            closed: false,
            balance: 100000,
            cleared_balance: 95000,
            uncleared_balance: 5000,
          },
        ],
        categories: [
          {
            id: 'category-1',
            category_group_id: 'group-1',
            name: 'Groceries',
            hidden: false,
            budgeted: 50000,
            activity: -30000,
            balance: 20000,
          },
        ],
        payees: [
          {
            id: 'payee-1',
            name: 'Grocery Store',
            transfer_account_id: null,
          },
        ],
        months: [
          {
            month: '2024-01-01',
            note: 'January budget',
            income: 500000,
            budgeted: 450000,
            activity: -400000,
            to_be_budgeted: 50000,
          },
        ],
      };

      (mockYnabAPI.budgets.getBudgetById as any).mockResolvedValue({
        data: { budget: mockBudget },
      });

      const result = await handleGetBudget(mockYnabAPI, { budget_id: 'budget-1' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.budget.id).toBe('budget-1');
      expect(parsedContent.budget.name).toBe('My Budget');
      expect(parsedContent.budget.accounts).toHaveLength(1);
      expect(parsedContent.budget.categories).toHaveLength(1);
      expect(parsedContent.budget.payees).toHaveLength(1);
      expect(parsedContent.budget.months).toHaveLength(1);
    });

    it('should handle 404 not found errors', async () => {
      (mockYnabAPI.budgets.getBudgetById as any).mockRejectedValue(new Error('404 Not Found'));

      const result = await handleGetBudget(mockYnabAPI, { budget_id: 'invalid-budget' });

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error.message).toBe('Budget not found');
    });

    it('should handle authentication errors', async () => {
      (mockYnabAPI.budgets.getBudgetById as any).mockRejectedValue(new Error('401 Unauthorized'));

      const result = await handleGetBudget(mockYnabAPI, { budget_id: 'budget-1' });

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error.message).toBe('Invalid or expired YNAB access token');
    });
  });

  describe('GetBudgetSchema', () => {
    it('should validate valid budget_id', () => {
      const result = GetBudgetSchema.parse({ budget_id: 'valid-budget-id' });
      expect(result.budget_id).toBe('valid-budget-id');
    });

    it('should reject empty budget_id', () => {
      expect(() => GetBudgetSchema.parse({ budget_id: '' })).toThrow();
    });

    it('should reject missing budget_id', () => {
      expect(() => GetBudgetSchema.parse({})).toThrow();
    });

    it('should reject non-string budget_id', () => {
      expect(() => GetBudgetSchema.parse({ budget_id: 123 })).toThrow();
    });
  });
});
