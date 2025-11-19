/**
 * Unit tests for category output schemas
 *
 * Tests schema validation for category tool outputs including:
 * - ListCategoriesOutputSchema
 * - GetCategoryOutputSchema
 * - CategorySchema
 * - CategoryGroupSchema
 */

import { describe, it, expect } from 'vitest';
import {
  ListCategoriesOutputSchema,
  GetCategoryOutputSchema,
  CategorySchema,
  CategoryGroupSchema,
} from '../categoryOutputs.js';

describe('CategorySchema', () => {
  it('should validate complete category with all fields including goals', () => {
    const validCategory = {
      id: 'category-123',
      category_group_id: 'group-456',
      category_group_name: 'Monthly Bills',
      name: 'Electricity',
      hidden: false,
      note: 'Electric utility bill',
      budgeted: 150.0,
      activity: -145.5,
      balance: 204.5,
      goal_type: 'TB',
      goal_creation_month: '2025-01-01',
      goal_target: 150.0,
      goal_target_month: '2025-12-01',
      goal_percentage_complete: 100,
      goal_months_to_budget: 0,
      goal_under_funded: 0.0,
      goal_overall_funded: 150.0,
      goal_overall_left: 0.0,
      deleted: false,
    };

    const result = CategorySchema.safeParse(validCategory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('category-123');
      expect(result.data.name).toBe('Electricity');
      expect(result.data.budgeted).toBe(150.0);
      expect(result.data.goal_type).toBe('TB');
      expect(result.data.goal_target).toBe(150.0);
    }
  });

  it('should validate minimal category with only required fields', () => {
    const validCategory = {
      id: 'category-456',
      category_group_id: 'group-789',
      name: 'Groceries',
      hidden: false,
      budgeted: 0.0,
      activity: 0.0,
      balance: 0.0,
      deleted: false,
    };

    const result = CategorySchema.safeParse(validCategory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBeUndefined();
      expect(result.data.goal_type).toBeUndefined();
      expect(result.data.category_group_name).toBeUndefined();
    }
  });

  it('should validate hidden category', () => {
    const validCategory = {
      id: 'category-hidden',
      category_group_id: 'group-123',
      name: 'Hidden Category',
      hidden: true,
      budgeted: 0.0,
      activity: 0.0,
      balance: 0.0,
      deleted: false,
    };

    const result = CategorySchema.safeParse(validCategory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hidden).toBe(true);
    }
  });

  it('should validate deleted category', () => {
    const validCategory = {
      id: 'category-deleted',
      category_group_id: 'group-123',
      name: 'Deleted Category',
      hidden: false,
      budgeted: 0.0,
      activity: 0.0,
      balance: 0.0,
      deleted: true,
    };

    const result = CategorySchema.safeParse(validCategory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
    }
  });

  it('should validate category with various goal types', () => {
    const goalTypes = ['TB', 'TBD', 'MF', 'NEED', 'DEBT'];

    for (const goalType of goalTypes) {
      const validCategory = {
        id: `category-${goalType}`,
        category_group_id: 'group-123',
        name: `Category with ${goalType} goal`,
        hidden: false,
        budgeted: 100.0,
        activity: -50.0,
        balance: 50.0,
        goal_type: goalType,
        goal_target: 100.0,
        deleted: false,
      };

      const result = CategorySchema.safeParse(validCategory);
      expect(result.success).toBe(true);
    }
  });

  it('should fail validation when missing required id field', () => {
    const invalidCategory = {
      category_group_id: 'group-456',
      name: 'Invalid Category',
      hidden: false,
      budgeted: 0.0,
      activity: 0.0,
      balance: 0.0,
      deleted: false,
    };

    const result = CategorySchema.safeParse(invalidCategory);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required name field', () => {
    const invalidCategory = {
      id: 'category-123',
      category_group_id: 'group-456',
      hidden: false,
      budgeted: 0.0,
      activity: 0.0,
      balance: 0.0,
      deleted: false,
    };

    const result = CategorySchema.safeParse(invalidCategory);
    expect(result.success).toBe(false);
  });

  it('should fail validation when budgeted is not a number', () => {
    const invalidCategory = {
      id: 'category-123',
      category_group_id: 'group-456',
      name: 'Invalid Category',
      hidden: false,
      budgeted: '150.00', // String instead of number
      activity: 0.0,
      balance: 0.0,
      deleted: false,
    };

    const result = CategorySchema.safeParse(invalidCategory);
    expect(result.success).toBe(false);
  });

  it('should fail validation when hidden is not a boolean', () => {
    const invalidCategory = {
      id: 'category-123',
      category_group_id: 'group-456',
      name: 'Invalid Category',
      hidden: 'false', // String instead of boolean
      budgeted: 0.0,
      activity: 0.0,
      balance: 0.0,
      deleted: false,
    };

    const result = CategorySchema.safeParse(invalidCategory);
    expect(result.success).toBe(false);
  });
});

describe('CategoryGroupSchema', () => {
  it('should validate complete category group with all fields', () => {
    const validGroup = {
      id: 'group-123',
      name: 'Monthly Bills',
      hidden: false,
      deleted: false,
    };

    const result = CategoryGroupSchema.safeParse(validGroup);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('group-123');
      expect(result.data.name).toBe('Monthly Bills');
      expect(result.data.hidden).toBe(false);
      expect(result.data.deleted).toBe(false);
    }
  });

  it('should validate hidden category group', () => {
    const validGroup = {
      id: 'group-hidden',
      name: 'Hidden Group',
      hidden: true,
      deleted: false,
    };

    const result = CategoryGroupSchema.safeParse(validGroup);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hidden).toBe(true);
    }
  });

  it('should fail validation when missing required id field', () => {
    const invalidGroup = {
      name: 'Invalid Group',
      hidden: false,
      deleted: false,
    };

    const result = CategoryGroupSchema.safeParse(invalidGroup);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required name field', () => {
    const invalidGroup = {
      id: 'group-123',
      hidden: false,
      deleted: false,
    };

    const result = CategoryGroupSchema.safeParse(invalidGroup);
    expect(result.success).toBe(false);
  });
});

describe('ListCategoriesOutputSchema', () => {
  it('should validate output with categories and category groups', () => {
    const validOutput = {
      categories: [
        {
          id: 'category-1',
          category_group_id: 'group-1',
          category_group_name: 'Monthly Bills',
          name: 'Electricity',
          hidden: false,
          budgeted: 150.0,
          activity: -145.5,
          balance: 204.5,
          deleted: false,
        },
        {
          id: 'category-2',
          category_group_id: 'group-1',
          category_group_name: 'Monthly Bills',
          name: 'Water',
          hidden: false,
          budgeted: 50.0,
          activity: -48.0,
          balance: 52.0,
          deleted: false,
        },
      ],
      category_groups: [
        {
          id: 'group-1',
          name: 'Monthly Bills',
          hidden: false,
          deleted: false,
        },
      ],
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance',
    };

    const result = ListCategoriesOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categories).toHaveLength(2);
      expect(result.data.category_groups).toHaveLength(1);
      expect(result.data.cached).toBe(true);
    }
  });

  it('should validate output with empty arrays', () => {
    const validOutput = {
      categories: [],
      category_groups: [],
      cached: false,
      cache_info: 'No categories found',
    };

    const result = ListCategoriesOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categories).toHaveLength(0);
      expect(result.data.category_groups).toHaveLength(0);
    }
  });

  it('should fail validation when categories is not an array', () => {
    const invalidOutput = {
      categories: 'not-an-array', // String instead of array
      category_groups: [],
      cached: false,
      cache_info: 'Invalid',
    };

    const result = ListCategoriesOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required categories field', () => {
    const invalidOutput = {
      category_groups: [],
      cached: false,
      cache_info: 'Missing categories',
    };

    const result = ListCategoriesOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required category_groups field', () => {
    const invalidOutput = {
      categories: [],
      cached: false,
      cache_info: 'Missing category_groups',
    };

    const result = ListCategoriesOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe('GetCategoryOutputSchema', () => {
  it('should validate output with complete category and cache metadata', () => {
    const validOutput = {
      category: {
        id: 'category-123',
        category_group_id: 'group-456',
        name: 'Electricity',
        hidden: false,
        note: 'Electric utility bill',
        budgeted: 150.0,
        activity: -145.5,
        balance: 204.5,
        goal_type: 'TB',
        goal_target: 150.0,
        goal_percentage_complete: 100,
        goal_under_funded: 0.0,
        goal_overall_funded: 150.0,
        goal_overall_left: 0.0,
        deleted: false,
      },
      cached: false,
      cache_info: 'Fresh data retrieved from YNAB API',
    };

    const result = GetCategoryOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category.id).toBe('category-123');
      expect(result.data.category.name).toBe('Electricity');
      expect(result.data.category.goal_type).toBe('TB');
      expect(result.data.cached).toBe(false);
    }
  });

  it('should validate output with minimal category', () => {
    const validOutput = {
      category: {
        id: 'category-456',
        category_group_id: 'group-789',
        name: 'Groceries',
        hidden: false,
        budgeted: 0.0,
        activity: 0.0,
        balance: 0.0,
        deleted: false,
      },
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance (delta merge applied)',
    };

    const result = GetCategoryOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category.note).toBeUndefined();
      expect(result.data.category.goal_type).toBeUndefined();
      expect(result.data.cached).toBe(true);
    }
  });

  it('should fail validation when category is not an object', () => {
    const invalidOutput = {
      category: 'not-an-object', // String instead of object
      cached: false,
      cache_info: 'Invalid',
    };

    const result = GetCategoryOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when category missing required fields', () => {
    const invalidOutput = {
      category: {
        id: 'category-123',
        name: 'Incomplete Category',
        // Missing: category_group_id, hidden, budgeted, activity, balance, deleted
      },
      cached: false,
      cache_info: 'Invalid',
    };

    const result = GetCategoryOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required category field', () => {
    const invalidOutput = {
      cached: false,
      cache_info: 'Missing category field',
    };

    const result = GetCategoryOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});
