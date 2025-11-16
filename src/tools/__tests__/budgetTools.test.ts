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
      expect(parsedContent.budget.accounts_count).toBe(1);
      expect(parsedContent.budget.categories_count).toBe(1);
      expect(parsedContent.budget.payees_count).toBe(1);
      expect(parsedContent.budget.months_count).toBe(1);
      // Ensure arrays are not included in response
      expect(parsedContent.budget.accounts).toBeUndefined();
      expect(parsedContent.budget.categories).toBeUndefined();
      expect(parsedContent.budget.payees).toBeUndefined();
      expect(parsedContent.budget.months).toBeUndefined();
    });

    it('should return zero counts for empty collections and exclude arrays', async () => {
      const mockBudget = {
        id: 'budget-2',
        name: 'Empty Budget',
        last_modified_on: '2024-01-01T00:00:00Z',
        first_month: '2024-01-01',
        last_month: '2024-12-01',
        date_format: { format: 'MM/DD/YYYY' },
        currency_format: { iso_code: 'USD', example_format: '$123.45' },
        accounts: [],
        categories: [],
        payees: [],
        months: [],
      };

      (mockYnabAPI.budgets.getBudgetById as any).mockResolvedValue({
        data: { budget: mockBudget },
      });

      const result = await handleGetBudget(mockYnabAPI, { budget_id: 'budget-2' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.budget.id).toBe('budget-2');
      expect(parsedContent.budget.name).toBe('Empty Budget');
      // Assert all counts are 0
      expect(parsedContent.budget.accounts_count).toBe(0);
      expect(parsedContent.budget.categories_count).toBe(0);
      expect(parsedContent.budget.payees_count).toBe(0);
      expect(parsedContent.budget.months_count).toBe(0);
      // Ensure arrays are not included in response
      expect(parsedContent.budget.accounts).toBeUndefined();
      expect(parsedContent.budget.categories).toBeUndefined();
      expect(parsedContent.budget.payees).toBeUndefined();
      expect(parsedContent.budget.months).toBeUndefined();
    });

    it('should return correct counts for multiple items and exclude arrays', async () => {
      const mockBudget = {
        id: 'budget-3',
        name: 'Multi-Item Budget',
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
          {
            id: 'account-2',
            name: 'Savings',
            type: 'savings',
            on_budget: true,
            closed: false,
            balance: 200000,
            cleared_balance: 200000,
            uncleared_balance: 0,
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
          {
            id: 'category-2',
            category_group_id: 'group-1',
            name: 'Dining',
            hidden: false,
            budgeted: 30000,
            activity: -20000,
            balance: 10000,
          },
          {
            id: 'category-3',
            category_group_id: 'group-2',
            name: 'Entertainment',
            hidden: false,
            budgeted: 40000,
            activity: -25000,
            balance: 15000,
          },
        ],
        payees: [
          {
            id: 'payee-1',
            name: 'Grocery Store',
            transfer_account_id: null,
          },
          {
            id: 'payee-2',
            name: 'Restaurant',
            transfer_account_id: null,
          },
          {
            id: 'payee-3',
            name: 'Cinema',
            transfer_account_id: null,
          },
          {
            id: 'payee-4',
            name: 'Transfer: Savings',
            transfer_account_id: 'account-2',
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
          {
            month: '2024-02-01',
            note: 'February budget',
            income: 520000,
            budgeted: 460000,
            activity: -410000,
            to_be_budgeted: 60000,
          },
        ],
      };

      (mockYnabAPI.budgets.getBudgetById as any).mockResolvedValue({
        data: { budget: mockBudget },
      });

      const result = await handleGetBudget(mockYnabAPI, { budget_id: 'budget-3' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.budget.id).toBe('budget-3');
      expect(parsedContent.budget.name).toBe('Multi-Item Budget');
      // Assert counts reflect multiple items
      expect(parsedContent.budget.accounts_count).toBe(2);
      expect(parsedContent.budget.categories_count).toBe(3);
      expect(parsedContent.budget.payees_count).toBe(4);
      expect(parsedContent.budget.months_count).toBe(2);
      // Ensure arrays are not included in response
      expect(parsedContent.budget.accounts).toBeUndefined();
      expect(parsedContent.budget.categories).toBeUndefined();
      expect(parsedContent.budget.payees).toBeUndefined();
      expect(parsedContent.budget.months).toBeUndefined();
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
