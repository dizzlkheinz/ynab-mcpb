/**
 * Unit tests for budget output schemas
 *
 * Tests schema validation for budget tool outputs including:
 * - ListBudgetsOutputSchema
 * - BudgetSummarySchema
 */

import { describe, it, expect } from 'vitest';
import { ListBudgetsOutputSchema, BudgetSummarySchema } from '../budgetOutputs.js';

describe('BudgetSummarySchema', () => {
  it('should validate complete budget with all fields', () => {
    const validBudget = {
      id: 'budget-123',
      name: 'My Budget',
      last_modified_on: '2025-11-17T10:30:00Z',
      first_month: '2024-01-01',
      last_month: '2025-11-01',
      date_format: {
        format: 'MM/DD/YYYY',
      },
      currency_format: {
        iso_code: 'USD',
        example_format: '$1,234.56',
        decimal_digits: 2,
        decimal_separator: '.',
        symbol_first: true,
        group_separator: ',',
        currency_symbol: '$',
        display_symbol: true,
      },
    };

    const result = BudgetSummarySchema.safeParse(validBudget);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validBudget);
      expect(result.data.id).toBe('budget-123');
      expect(result.data.name).toBe('My Budget');
      expect(result.data.date_format?.format).toBe('MM/DD/YYYY');
      expect(result.data.currency_format?.iso_code).toBe('USD');
    }
  });

  it('should validate minimal budget with only required fields', () => {
    const validBudget = {
      id: 'budget-456',
      name: 'Minimal Budget',
    };

    const result = BudgetSummarySchema.safeParse(validBudget);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('budget-456');
      expect(result.data.name).toBe('Minimal Budget');
      expect(result.data.last_modified_on).toBeUndefined();
      expect(result.data.first_month).toBeUndefined();
      expect(result.data.last_month).toBeUndefined();
      expect(result.data.date_format).toBeUndefined();
      expect(result.data.currency_format).toBeUndefined();
    }
  });

  it('should validate budget with date_format but no currency_format', () => {
    const validBudget = {
      id: 'budget-789',
      name: 'Partial Budget',
      date_format: {
        format: 'DD/MM/YYYY',
      },
    };

    const result = BudgetSummarySchema.safeParse(validBudget);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date_format?.format).toBe('DD/MM/YYYY');
      expect(result.data.currency_format).toBeUndefined();
    }
  });

  it('should fail validation when missing required id field', () => {
    const invalidBudget = {
      name: 'Invalid Budget',
      last_modified_on: '2025-11-17T10:30:00Z',
    };

    const result = BudgetSummarySchema.safeParse(invalidBudget);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required name field', () => {
    const invalidBudget = {
      id: 'budget-123',
      last_modified_on: '2025-11-17T10:30:00Z',
    };

    const result = BudgetSummarySchema.safeParse(invalidBudget);
    expect(result.success).toBe(false);
  });

  it('should fail validation when id is not a string', () => {
    const invalidBudget = {
      id: 123, // Number instead of string
      name: 'Invalid Budget',
    };

    const result = BudgetSummarySchema.safeParse(invalidBudget);
    expect(result.success).toBe(false);
  });

  it('should fail validation when name is not a string', () => {
    const invalidBudget = {
      id: 'budget-123',
      name: null, // Null instead of string
    };

    const result = BudgetSummarySchema.safeParse(invalidBudget);
    expect(result.success).toBe(false);
  });
});

describe('ListBudgetsOutputSchema', () => {
  it('should validate output with multiple budgets and cache metadata', () => {
    const validOutput = {
      budgets: [
        {
          id: 'budget-1',
          name: 'Budget One',
          last_modified_on: '2025-11-17T10:30:00Z',
          first_month: '2024-01-01',
          last_month: '2025-11-01',
        },
        {
          id: 'budget-2',
          name: 'Budget Two',
          first_month: '2023-06-01',
          last_month: '2025-11-01',
        },
      ],
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance',
    };

    const result = ListBudgetsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgets).toHaveLength(2);
      expect(result.data.budgets[0].id).toBe('budget-1');
      expect(result.data.budgets[1].id).toBe('budget-2');
      expect(result.data.cached).toBe(true);
      expect(result.data.cache_info).toBe('Data retrieved from cache for improved performance');
    }
  });

  it('should validate output with single budget', () => {
    const validOutput = {
      budgets: [
        {
          id: 'budget-solo',
          name: 'Solo Budget',
        },
      ],
      cached: false,
      cache_info: 'Fresh data retrieved from YNAB API',
    };

    const result = ListBudgetsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgets).toHaveLength(1);
      expect(result.data.budgets[0].name).toBe('Solo Budget');
      expect(result.data.cached).toBe(false);
    }
  });

  it('should validate output with empty budgets array', () => {
    const validOutput = {
      budgets: [],
      cached: false,
      cache_info: 'No budgets found',
    };

    const result = ListBudgetsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgets).toHaveLength(0);
    }
  });

  it('should validate output with complete budget including formats', () => {
    const validOutput = {
      budgets: [
        {
          id: 'budget-complete',
          name: 'Complete Budget',
          last_modified_on: '2025-11-17T10:30:00Z',
          first_month: '2024-01-01',
          last_month: '2025-11-01',
          date_format: {
            format: 'MM/DD/YYYY',
          },
          currency_format: {
            iso_code: 'EUR',
            example_format: '€1.234,56',
            decimal_digits: 2,
            decimal_separator: ',',
            symbol_first: false,
            group_separator: '.',
            currency_symbol: '€',
            display_symbol: true,
          },
        },
      ],
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance (delta merge applied)',
    };

    const result = ListBudgetsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      const budget = result.data.budgets[0];
      expect(budget.currency_format?.iso_code).toBe('EUR');
      expect(budget.currency_format?.symbol_first).toBe(false);
    }
  });

  it('should fail validation when budgets is not an array', () => {
    const invalidOutput = {
      budgets: 'not-an-array', // String instead of array
      cached: false,
      cache_info: 'Invalid',
    };

    const result = ListBudgetsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when budgets array contains invalid budget', () => {
    const invalidOutput = {
      budgets: [
        {
          id: 'budget-1',
          name: 'Valid Budget',
        },
        {
          id: 'budget-2',
          // Missing required 'name' field
        },
      ],
      cached: false,
      cache_info: 'Invalid',
    };

    const result = ListBudgetsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required budgets field', () => {
    const invalidOutput = {
      cached: true,
      cache_info: 'Missing budgets array',
    };

    const result = ListBudgetsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when cached is not a boolean', () => {
    const invalidOutput = {
      budgets: [],
      cached: 'true', // String instead of boolean
      cache_info: 'Invalid',
    };

    const result = ListBudgetsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});
