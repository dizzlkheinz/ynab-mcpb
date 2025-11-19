/**
 * Unit tests for month output schemas
 *
 * Tests schema validation for month tool outputs including:
 * - GetMonthOutputSchema
 * - ListMonthsOutputSchema
 * - MonthDetailSchema
 * - MonthSummarySchema
 * - MonthCategorySchema
 */

import { describe, it, expect } from 'vitest';
import {
  GetMonthOutputSchema,
  ListMonthsOutputSchema,
  MonthDetailSchema,
  MonthSummarySchema,
  MonthCategorySchema,
} from '../monthOutputs.js';

describe('MonthCategorySchema', () => {
  it('should validate complete month category with all fields including goals', () => {
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
      goal_target: 150000,
      goal_target_month: '2025-12-01',
      goal_percentage_complete: 100,
      goal_months_to_budget: 0,
      goal_under_funded: 0.0,
      goal_overall_funded: 150.0,
      goal_overall_left: 0.0,
      deleted: false,
    };

    const result = MonthCategorySchema.safeParse(validCategory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('category-123');
      expect(result.data.budgeted).toBe(150.0);
      expect(result.data.goal_target).toBe(150000);
    }
  });

  it('should validate minimal month category with only required fields', () => {
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

    const result = MonthCategorySchema.safeParse(validCategory);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBeUndefined();
      expect(result.data.goal_type).toBeUndefined();
    }
  });

  it('should fail validation when missing required fields', () => {
    const invalidCategory = {
      id: 'category-123',
      name: 'Incomplete Category',
      // Missing: category_group_id, hidden, budgeted, activity, balance, deleted
    };

    const result = MonthCategorySchema.safeParse(invalidCategory);
    expect(result.success).toBe(false);
  });
});

describe('MonthDetailSchema', () => {
  it('should validate complete month detail with all fields including categories', () => {
    const validMonth = {
      month: '2025-11-01',
      note: 'November budget',
      income: 5000.0,
      budgeted: 4500.0,
      activity: -4200.0,
      to_be_budgeted: 300.0,
      age_of_money: 45,
      deleted: false,
      categories: [
        {
          id: 'category-123',
          category_group_id: 'group-456',
          category_group_name: 'Monthly Bills',
          name: 'Electricity',
          hidden: false,
          budgeted: 150.0,
          activity: -145.5,
          balance: 204.5,
          goal_type: 'TB',
          goal_target: 150000,
          deleted: false,
        },
      ],
    };

    const result = MonthDetailSchema.safeParse(validMonth);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.month).toBe('2025-11-01');
      expect(result.data.income).toBe(5000.0);
      expect(result.data.age_of_money).toBe(45);
      expect(result.data.categories).toHaveLength(1);
    }
  });

  it('should validate minimal month detail with only required fields', () => {
    const validMonth = {
      month: '2025-11-01',
      income: 5000.0,
      budgeted: 4500.0,
      activity: -4200.0,
      to_be_budgeted: 300.0,
      deleted: false,
    };

    const result = MonthDetailSchema.safeParse(validMonth);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBeUndefined();
      expect(result.data.age_of_money).toBeUndefined();
      expect(result.data.categories).toBeUndefined();
    }
  });

  it('should validate month detail with empty categories array', () => {
    const validMonth = {
      month: '2025-11-01',
      income: 5000.0,
      budgeted: 4500.0,
      activity: -4200.0,
      to_be_budgeted: 300.0,
      deleted: false,
      categories: [],
    };

    const result = MonthDetailSchema.safeParse(validMonth);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categories).toHaveLength(0);
    }
  });

  it('should validate month with proper date format YYYY-MM-01', () => {
    const validMonth = {
      month: '2025-11-01',
      income: 5000.0,
      budgeted: 4500.0,
      activity: -4200.0,
      to_be_budgeted: 300.0,
      deleted: false,
    };

    const result = MonthDetailSchema.safeParse(validMonth);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.month).toMatch(/^\d{4}-\d{2}-01$/);
    }
  });

  it('should fail validation when missing required month field', () => {
    const invalidMonth = {
      income: 5000.0,
      budgeted: 4500.0,
      activity: -4200.0,
      to_be_budgeted: 300.0,
      deleted: false,
    };

    const result = MonthDetailSchema.safeParse(invalidMonth);
    expect(result.success).toBe(false);
  });

  it('should fail validation when income is not a number', () => {
    const invalidMonth = {
      month: '2025-11-01',
      income: '5000.00', // String instead of number
      budgeted: 4500.0,
      activity: -4200.0,
      to_be_budgeted: 300.0,
      deleted: false,
    };

    const result = MonthDetailSchema.safeParse(invalidMonth);
    expect(result.success).toBe(false);
  });
});

describe('MonthSummarySchema', () => {
  it('should validate complete month summary with all fields', () => {
    const validSummary = {
      month: '2025-11-01',
      note: 'November budget',
      income: 5000.0,
      budgeted: 4500.0,
      activity: -4200.0,
      to_be_budgeted: 300.0,
      age_of_money: 45,
      deleted: false,
    };

    const result = MonthSummarySchema.safeParse(validSummary);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.month).toBe('2025-11-01');
      expect(result.data.income).toBe(5000.0);
      expect(result.data.age_of_money).toBe(45);
    }
  });

  it('should validate minimal month summary with only required fields', () => {
    const validSummary = {
      month: '2025-10-01',
      income: 5000.0,
      budgeted: 4800.0,
      activity: -4750.0,
      to_be_budgeted: 50.0,
      deleted: false,
    };

    const result = MonthSummarySchema.safeParse(validSummary);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBeUndefined();
      expect(result.data.age_of_money).toBeUndefined();
    }
  });

  it('should validate month summary with null age_of_money', () => {
    const validSummary = {
      month: '2025-11-01',
      income: 5000.0,
      budgeted: 4500.0,
      activity: -4200.0,
      to_be_budgeted: 300.0,
      age_of_money: undefined,
      deleted: false,
    };

    const result = MonthSummarySchema.safeParse(validSummary);
    expect(result.success).toBe(true);
  });

  it('should fail validation when missing required fields', () => {
    const invalidSummary = {
      month: '2025-11-01',
      income: 5000.0,
      // Missing: budgeted, activity, to_be_budgeted, deleted
    };

    const result = MonthSummarySchema.safeParse(invalidSummary);
    expect(result.success).toBe(false);
  });
});

describe('GetMonthOutputSchema', () => {
  it('should validate output with complete month detail and cache metadata', () => {
    const validOutput = {
      month: {
        month: '2025-11-01',
        note: 'November budget',
        income: 5000.0,
        budgeted: 4500.0,
        activity: -4200.0,
        to_be_budgeted: 300.0,
        age_of_money: 45,
        deleted: false,
        categories: [
          {
            id: 'category-123',
            category_group_id: 'group-456',
            category_group_name: 'Monthly Bills',
            name: 'Electricity',
            hidden: false,
            budgeted: 150.0,
            activity: -145.5,
            balance: 204.5,
            goal_type: 'TB',
            goal_target: 150000,
            deleted: false,
          },
        ],
      },
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance',
    };

    const result = GetMonthOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.month.month).toBe('2025-11-01');
      expect(result.data.month.categories).toHaveLength(1);
      expect(result.data.cached).toBe(true);
    }
  });

  it('should validate output with minimal month detail', () => {
    const validOutput = {
      month: {
        month: '2025-11-01',
        income: 5000.0,
        budgeted: 4500.0,
        activity: -4200.0,
        to_be_budgeted: 300.0,
        deleted: false,
      },
      cached: false,
      cache_info: 'Fresh data retrieved from YNAB API',
    };

    const result = GetMonthOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.month.note).toBeUndefined();
      expect(result.data.month.categories).toBeUndefined();
      expect(result.data.cached).toBe(false);
    }
  });

  it('should fail validation when month is not an object', () => {
    const invalidOutput = {
      month: 'not-an-object', // String instead of object
      cached: false,
      cache_info: 'Invalid',
    };

    const result = GetMonthOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required month field', () => {
    const invalidOutput = {
      cached: false,
      cache_info: 'Missing month field',
    };

    const result = GetMonthOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe('ListMonthsOutputSchema', () => {
  it('should validate output with multiple month summaries', () => {
    const validOutput = {
      months: [
        {
          month: '2025-11-01',
          note: 'November budget',
          income: 5000.0,
          budgeted: 4500.0,
          activity: -4200.0,
          to_be_budgeted: 300.0,
          age_of_money: 45,
          deleted: false,
        },
        {
          month: '2025-10-01',
          income: 5000.0,
          budgeted: 4800.0,
          activity: -4750.0,
          to_be_budgeted: 50.0,
          age_of_money: 42,
          deleted: false,
        },
      ],
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance',
    };

    const result = ListMonthsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.months).toHaveLength(2);
      expect(result.data.months[0].month).toBe('2025-11-01');
      expect(result.data.months[1].month).toBe('2025-10-01');
      expect(result.data.cached).toBe(true);
    }
  });

  it('should validate output with single month summary', () => {
    const validOutput = {
      months: [
        {
          month: '2025-11-01',
          income: 5000.0,
          budgeted: 4500.0,
          activity: -4200.0,
          to_be_budgeted: 300.0,
          deleted: false,
        },
      ],
      cached: false,
      cache_info: 'Fresh data retrieved from YNAB API',
    };

    const result = ListMonthsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.months).toHaveLength(1);
      expect(result.data.cached).toBe(false);
    }
  });

  it('should validate output with empty months array', () => {
    const validOutput = {
      months: [],
      cached: false,
      cache_info: 'No months found',
    };

    const result = ListMonthsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.months).toHaveLength(0);
    }
  });

  it('should fail validation when months is not an array', () => {
    const invalidOutput = {
      months: 'not-an-array', // String instead of array
      cached: false,
      cache_info: 'Invalid',
    };

    const result = ListMonthsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when months array contains invalid month', () => {
    const invalidOutput = {
      months: [
        {
          month: '2025-11-01',
          income: 5000.0,
          budgeted: 4500.0,
          activity: -4200.0,
          to_be_budgeted: 300.0,
          deleted: false,
        },
        {
          month: '2025-10-01',
          // Missing required fields: income, budgeted, activity, to_be_budgeted, deleted
        },
      ],
      cached: false,
      cache_info: 'Invalid',
    };

    const result = ListMonthsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required months field', () => {
    const invalidOutput = {
      cached: false,
      cache_info: 'Missing months field',
    };

    const result = ListMonthsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});
