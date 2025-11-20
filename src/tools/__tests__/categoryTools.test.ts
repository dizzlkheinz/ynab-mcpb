import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as ynab from 'ynab';
import {
  handleListCategories,
  handleGetCategory,
  handleUpdateCategory,
  ListCategoriesSchema,
  GetCategorySchema,
  UpdateCategorySchema,
} from '../categoryTools.js';
import { createDeltaFetcherMock, createRejectingDeltaFetcherMock } from './deltaTestUtils.js';
import { CacheKeys } from '../../server/cacheKeys.js';

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
    CATEGORIES: 300000,
  },
}));

// Mock the YNAB API
const mockYnabAPI = {
  categories: {
    getCategories: vi.fn(),
    getCategoryById: vi.fn(),
    updateMonthCategory: vi.fn(),
  },
} as unknown as ynab.API;

// Import mocked cache manager
const { cacheManager, CacheManager } = await import('../../server/cacheManager.js');

// Capture original NODE_ENV for restoration
const originalNodeEnv = process.env.NODE_ENV;

describe('Category Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset NODE_ENV to test to ensure cache bypassing in tests
    process.env['NODE_ENV'] = 'test';
    (cacheManager.wrap as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _key: string,
        options: {
          loader: () => Promise<unknown>;
        },
      ) => {
        return await options.loader();
      },
    );
    (cacheManager.has as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (CacheManager.generateKey as any).mockImplementation(
      (prefix: string, type: string, budgetId: string, id?: string) => {
        if (prefix === CacheKeys.CATEGORIES && type === 'list') {
          return `categories:list:${budgetId}`;
        }
        if (prefix === CacheKeys.CATEGORIES && type === 'get' && id) {
          return `categories:get:${budgetId}:${id}`;
        }
        if (prefix === CacheKeys.MONTHS && type === 'list') {
          return `months:list:${budgetId}`;
        }
        if (prefix === CacheKeys.MONTHS && type === 'get' && id) {
          return `months:get:${budgetId}:${id}`;
        }
        return `${prefix}:${type}:${budgetId}:${id || ''}`;
      }
    );
  });

  afterAll(() => {
    // Restore original NODE_ENV value
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  describe('handleListCategories', () => {
    it('should include cache metadata from delta fetcher results', async () => {
      const mockCategoryGroups = [
        {
          id: 'group-1',
          name: 'Immediate Obligations',
          hidden: false,
          deleted: false,
          categories: [
            {
              id: 'category-1',
              category_group_id: 'group-1',
              name: 'Rent/Mortgage',
              hidden: false,
              original_category_group_id: null,
              note: 'Monthly housing payment',
              budgeted: 150000,
              activity: -150000,
              balance: 0,
              goal_type: null,
              goal_creation_month: null,
              goal_target: null,
              goal_target_month: null,
              goal_percentage_complete: null,
            },
          ],
        },
      ];
      const { fetcher, resolved } = createDeltaFetcherMock('fetchCategories', {
        data: mockCategoryGroups,
        wasCached: true,
        usedDelta: true,
      });

      const result = await handleListCategories(mockYnabAPI, fetcher, {
        budget_id: 'budget-1',
      });

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.cached).toBe(resolved.wasCached);
      expect(parsedContent.cache_info).toContain('delta merge applied');
      expect(parsedContent.categories).toHaveLength(1);
    });

    it('should return formatted category list on success', async () => {
      const mockCategoryGroups = [
        {
          id: 'group-1',
          name: 'Immediate Obligations',
          hidden: false,
          deleted: false,
          categories: [
            {
              id: 'category-1',
              category_group_id: 'group-1',
              name: 'Rent/Mortgage',
              hidden: false,
              original_category_group_id: null,
              note: 'Monthly housing payment',
              budgeted: 150000,
              activity: -150000,
              balance: 0,
              goal_type: null,
              goal_creation_month: null,
              goal_target: null,
              goal_target_month: null,
              goal_percentage_complete: null,
            },
            {
              id: 'category-2',
              category_group_id: 'group-1',
              name: 'Utilities',
              hidden: false,
              original_category_group_id: null,
              note: null,
              budgeted: 20000,
              activity: -18000,
              balance: 2000,
              goal_type: null,
              goal_creation_month: null,
              goal_target: null,
              goal_target_month: null,
              goal_percentage_complete: null,
            },
          ],
        },
        {
          id: 'group-2',
          name: 'True Expenses',
          hidden: false,
          deleted: false,
          categories: [
            {
              id: 'category-3',
              category_group_id: 'group-2',
              name: 'Car Maintenance',
              hidden: false,
              original_category_group_id: null,
              note: null,
              budgeted: 5000,
              activity: 0,
              balance: 5000,
              goal_type: 'TBD',
              goal_creation_month: '2024-01-01',
              goal_target: 100000,
              goal_target_month: '2024-12-01',
              goal_percentage_complete: 5,
            },
          ],
        },
      ];
      const { fetcher, resolved } = createDeltaFetcherMock('fetchCategories', {
        data: mockCategoryGroups,
        wasCached: false,
      });

      const result = await handleListCategories(mockYnabAPI, fetcher, {
        budget_id: 'budget-1',
      });

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.categories).toHaveLength(3);
      expect(parsedContent.category_groups).toHaveLength(2);
      expect(parsedContent.cached).toBe(resolved.wasCached);
      expect(parsedContent.cache_info).toBe('Fresh data retrieved from YNAB API');
      expect(parsedContent.categories[0]).toEqual({
        id: 'category-1',
        category_group_id: 'group-1',
        category_group_name: 'Immediate Obligations',
        name: 'Rent/Mortgage',
        hidden: false,
        original_category_group_id: null,
        note: 'Monthly housing payment',
        budgeted: 150,
        activity: -150,
        balance: 0,
        goal_type: null,
        goal_creation_month: null,
        goal_target_month: null,
        goal_percentage_complete: null,
      });
      // Verify goal_target conversion for category-3 (100000 cents -> 100 dollars)
      expect(parsedContent.categories[2]).toMatchObject({
        id: 'category-3',
        name: 'Car Maintenance',
        goal_target: 100,
      });
    });

    it('should handle authentication errors', async () => {
      const { fetcher } = createRejectingDeltaFetcherMock(
        'fetchCategories',
        new Error('401 Unauthorized'),
      );

      const result = await handleListCategories(mockYnabAPI, fetcher, {
        budget_id: 'budget-1',
      });

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error.message).toBe('Invalid or expired YNAB access token');
    });

    it('should handle not found errors', async () => {
      const { fetcher } = createRejectingDeltaFetcherMock(
        'fetchCategories',
        new Error('404 Not Found'),
      );

      const result = await handleListCategories(mockYnabAPI, fetcher, {
        budget_id: 'invalid-budget',
      });

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error.message).toBe('Budget or category not found');
    });
  });
  describe('handleGetCategory', () => {
    it('should return detailed category information on success', async () => {
      const mockCategory = {
        id: 'category-1',
        category_group_id: 'group-1',
        name: 'Groceries',
        hidden: false,
        original_category_group_id: null,
        note: 'Food and household items',
        budgeted: 50000,
        activity: -45000,
        balance: 5000,
        goal_type: 'TBD',
        goal_creation_month: '2024-01-01',
        goal_target: 60000,
        goal_target_month: '2024-12-01',
        goal_percentage_complete: 83,
      };

      (mockYnabAPI.categories.getCategoryById as any).mockResolvedValue({
        data: { category: mockCategory },
      });

      const result = await handleGetCategory(mockYnabAPI, {
        budget_id: 'budget-1',
        category_id: 'category-1',
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.category).toEqual({
        id: 'category-1',
        category_group_id: 'group-1',
        name: 'Groceries',
        hidden: false,
        original_category_group_id: null,
        note: 'Food and household items',
        budgeted: 50,
        activity: -45,
        balance: 5,
        goal_type: 'TBD',
        goal_creation_month: '2024-01-01',
        goal_target: 60,
        goal_target_month: '2024-12-01',
        goal_percentage_complete: 83,
      });
      expect(parsedContent.cached).toBe(false);
      expect(parsedContent.cache_info).toBe('Fresh data retrieved from YNAB API');
    });

    it('should reflect cached responses when data exists in cache', async () => {
      const mockCategory = {
        id: 'category-1',
        category_group_id: 'group-1',
        name: 'Groceries',
        hidden: false,
        original_category_group_id: null,
        note: 'Food and household items',
        budgeted: 50000,
        activity: -45000,
        balance: 5000,
        goal_type: 'TBD',
        goal_creation_month: '2024-01-01',
        goal_target: 60000,
        goal_target_month: '2024-12-01',
        goal_percentage_complete: 83,
      };

      (mockYnabAPI.categories.getCategoryById as any).mockResolvedValue({
        data: { category: mockCategory },
      });
      (cacheManager.has as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

      const result = await handleGetCategory(mockYnabAPI, {
        budget_id: 'budget-1',
        category_id: 'category-1',
      });

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.cached).toBe(true);
      expect(parsedContent.cache_info).toBe('Data retrieved from cache for improved performance');
    });

    it('should handle 404 not found errors', async () => {
      (mockYnabAPI.categories.getCategoryById as any).mockRejectedValue(new Error('404 Not Found'));

      const result = await handleGetCategory(mockYnabAPI, {
        budget_id: 'budget-1',
        category_id: 'invalid-category',
      });

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error.message).toBe('Budget or category not found');
    });
  });

  describe('handleUpdateCategory', () => {
    it('should update category budget for current month on success', async () => {
      const mockUpdatedCategory = {
        id: 'category-1',
        category_group_id: 'group-1',
        name: 'Groceries',
        hidden: false,
        original_category_group_id: null,
        note: 'Food and household items',
        budgeted: 60000, // Updated amount
        activity: -45000,
        balance: 15000,
        goal_type: 'TBD',
        goal_creation_month: '2024-01-01',
        goal_target: 60000,
        goal_target_month: '2024-12-01',
        goal_percentage_complete: 100,
      };

      (mockYnabAPI.categories.updateMonthCategory as any).mockResolvedValue({
        data: { category: mockUpdatedCategory },
      });

      const result = await handleUpdateCategory(mockYnabAPI, {
        budget_id: 'budget-1',
        category_id: 'category-1',
        budgeted: 60000,
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.category.budgeted).toBe(60);
      expect(parsedContent.updated_month).toMatch(/^\d{4}-\d{2}-01$/);

      // Verify the API was called with correct parameters
      expect(mockYnabAPI.categories.updateMonthCategory).toHaveBeenCalledWith(
        'budget-1',
        expect.stringMatching(/^\d{4}-\d{2}-01$/),
        'category-1',
        { category: { budgeted: 60000 } },
      );
    });

    it('should handle 404 not found errors', async () => {
      (mockYnabAPI.categories.updateMonthCategory as any).mockRejectedValue(
        new Error('404 Not Found'),
      );

      const result = await handleUpdateCategory(mockYnabAPI, {
        budget_id: 'budget-1',
        category_id: 'invalid-category',
        budgeted: 50000,
      });

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error.message).toBe('Budget or category not found');
    });

    it('should handle 403 forbidden errors', async () => {
      (mockYnabAPI.categories.updateMonthCategory as any).mockRejectedValue(
        new Error('403 Forbidden'),
      );

      const result = await handleUpdateCategory(mockYnabAPI, {
        budget_id: 'budget-1',
        category_id: 'category-1',
        budgeted: 50000,
      });

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.error.message).toBe('Insufficient permissions to access YNAB data');
    });

    it('should invalidate category caches on successful category update', async () => {
      const mockUpdatedCategory = {
        id: 'category-1',
        category_group_id: 'group-1',
        name: 'Groceries',
        hidden: false,
        original_category_group_id: null,
        note: 'Food and household items',
        budgeted: 60000, // Updated amount
        activity: -45000,
        balance: 15000,
        goal_type: 'TBD',
        goal_creation_month: '2024-01-01',
        goal_target: 60000,
        goal_target_month: '2024-12-01',
        goal_percentage_complete: 100,
      };

      (mockYnabAPI.categories.updateMonthCategory as any).mockResolvedValue({
        data: { category: mockUpdatedCategory },
      });

      const result = await handleUpdateCategory(mockYnabAPI, {
        budget_id: 'budget-1',
        category_id: 'category-1',
        budgeted: 60000,
      });

      // Verify cache was invalidated for both category list and specific category
      expect(CacheManager.generateKey).toHaveBeenCalledWith(CacheKeys.CATEGORIES, 'list', 'budget-1');
      expect(CacheManager.generateKey).toHaveBeenCalledWith(
        CacheKeys.CATEGORIES,
        'get',
        'budget-1',
        'category-1',
      );
      expect(cacheManager.delete).toHaveBeenCalledWith(`categories:list:budget-1`);
      expect(cacheManager.delete).toHaveBeenCalledWith(`categories:get:budget-1:category-1`);

      // Verify month-related caches were invalidated
      expect(CacheManager.generateKey).toHaveBeenCalledWith(CacheKeys.MONTHS, 'list', 'budget-1');
      expect(CacheManager.generateKey).toHaveBeenCalledWith(
        CacheKeys.MONTHS,
        'get',
        'budget-1',
        expect.stringMatching(/^\d{4}-\d{2}-01$/),
      );
      const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
      expect(cacheManager.delete).toHaveBeenCalledWith(`months:list:budget-1`);
      expect(cacheManager.delete).toHaveBeenCalledWith(`months:get:budget-1:${currentMonth}`);
    });

    it('should not invalidate cache on dry_run category update', async () => {
      const mockUpdatedCategory = {
        id: 'category-1',
        category_group_id: 'group-1',
        name: 'Groceries',
        hidden: false,
        original_category_group_id: null,
        note: 'Food and household items',
        budgeted: 60000,
        activity: -45000,
        balance: 15000,
        goal_type: 'TBD',
        goal_creation_month: '2024-01-01',
        goal_target: 60000,
        goal_target_month: '2024-12-01',
        goal_percentage_complete: 100,
      };

      (mockYnabAPI.categories.updateMonthCategory as any).mockResolvedValue({
        data: { category: mockUpdatedCategory },
      });

      const result = await handleUpdateCategory(mockYnabAPI, {
        budget_id: 'budget-1',
        category_id: 'category-1',
        budgeted: 60000,
        dry_run: true,
      });

      // Verify the live API method was NOT called for dry run
      expect(mockYnabAPI.categories.updateMonthCategory).not.toHaveBeenCalled();

      // Verify cache was NOT invalidated for dry run
      expect(cacheManager.delete).not.toHaveBeenCalled();
      expect(CacheManager.generateKey).not.toHaveBeenCalled();

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.dry_run).toBe(true);
      expect(parsedContent.action).toBe('update_category');
      expect(parsedContent.request).toMatchObject({
        budget_id: 'budget-1',
        category_id: 'category-1',
        budgeted: 60,
      });
      expect(parsedContent.request.month).toMatch(/^\d{4}-\d{2}-01$/);
    });
  });

  describe('Schema Validation', () => {
    describe('ListCategoriesSchema', () => {
      it('should validate valid budget_id', () => {
        const result = ListCategoriesSchema.parse({ budget_id: 'valid-budget-id' });
        expect(result.budget_id).toBe('valid-budget-id');
      });

      it('should reject empty budget_id', () => {
        expect(() => ListCategoriesSchema.parse({ budget_id: '' })).toThrow();
      });

      it('should reject missing budget_id', () => {
        expect(() => ListCategoriesSchema.parse({})).toThrow();
      });
    });

    describe('GetCategorySchema', () => {
      it('should validate valid parameters', () => {
        const result = GetCategorySchema.parse({
          budget_id: 'budget-1',
          category_id: 'category-1',
        });
        expect(result.budget_id).toBe('budget-1');
        expect(result.category_id).toBe('category-1');
      });

      it('should reject empty category_id', () => {
        expect(() =>
          GetCategorySchema.parse({
            budget_id: 'budget-1',
            category_id: '',
          }),
        ).toThrow();
      });

      it('should reject missing category_id', () => {
        expect(() => GetCategorySchema.parse({ budget_id: 'budget-1' })).toThrow();
      });
    });

    describe('UpdateCategorySchema', () => {
      it('should validate valid parameters', () => {
        const result = UpdateCategorySchema.parse({
          budget_id: 'budget-1',
          category_id: 'category-1',
          budgeted: 50000,
        });
        expect(result.budget_id).toBe('budget-1');
        expect(result.category_id).toBe('category-1');
        expect(result.budgeted).toBe(50000);
      });

      it('should reject non-integer budgeted amount', () => {
        expect(() =>
          UpdateCategorySchema.parse({
            budget_id: 'budget-1',
            category_id: 'category-1',
            budgeted: 50.5,
          }),
        ).toThrow();
      });

      it('should reject missing budgeted amount', () => {
        expect(() =>
          UpdateCategorySchema.parse({
            budget_id: 'budget-1',
            category_id: 'category-1',
          }),
        ).toThrow();
      });

      it('should accept negative budgeted amounts', () => {
        const result = UpdateCategorySchema.parse({
          budget_id: 'budget-1',
          category_id: 'category-1',
          budgeted: -10000,
        });
        expect(result.budgeted).toBe(-10000);
      });

      it('should accept zero budgeted amount', () => {
        const result = UpdateCategorySchema.parse({
          budget_id: 'budget-1',
          category_id: 'category-1',
          budgeted: 0,
        });
        expect(result.budgeted).toBe(0);
      });
    });
  });
});