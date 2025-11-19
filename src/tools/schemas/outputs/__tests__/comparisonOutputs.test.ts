/**
 * Unit tests for comparison and export output schemas
 *
 * Tests schema validation for comparison and export tool outputs including:
 * - CompareTransactionsOutputSchema
 * - ExportTransactionsOutputSchema
 * - ISODateStringSchema
 * - DateRangeSchema
 */

import { describe, it, expect } from 'vitest';
import {
  CompareTransactionsOutputSchema,
  ExportTransactionsOutputSchema,
  ISODateStringSchema,
  DateRangeSchema,
  MatchItemSchema,
  MissingInYNABItemSchema,
  MissingInBankItemSchema,
} from '../comparisonOutputs.js';

describe('ISODateStringSchema', () => {
  it('should validate correct ISO date format', () => {
    const validDates = ['2025-01-01', '2025-12-31', '2024-02-29']; // 2024 is leap year

    for (const date of validDates) {
      const result = ISODateStringSchema.safeParse(date);
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid date formats', () => {
    const invalidDates = ['2025/01/01', '01-01-2025', '2025-1-1', 'not-a-date'];

    for (const date of invalidDates) {
      const result = ISODateStringSchema.safeParse(date);
      expect(result.success).toBe(false);
    }
  });

  it('should reject invalid calendar dates', () => {
    const invalidDates = ['2025-02-30', '2025-13-01', '2025-02-31', '2025-00-01'];

    for (const date of invalidDates) {
      const result = ISODateStringSchema.safeParse(date);
      expect(result.success).toBe(false);
    }
  });

  it('should validate leap year dates correctly', () => {
    const result1 = ISODateStringSchema.safeParse('2024-02-29'); // Leap year
    expect(result1.success).toBe(true);

    const result2 = ISODateStringSchema.safeParse('2025-02-29'); // Not a leap year
    expect(result2.success).toBe(false);
  });
});

describe('DateRangeSchema', () => {
  it('should validate valid date range', () => {
    const validRange = {
      start: '2025-01-01',
      end: '2025-12-31',
    };

    const result = DateRangeSchema.safeParse(validRange);
    expect(result.success).toBe(true);
  });

  it('should validate date range where start equals end', () => {
    const validRange = {
      start: '2025-10-15',
      end: '2025-10-15',
    };

    const result = DateRangeSchema.safeParse(validRange);
    expect(result.success).toBe(true);
  });

  it('should reject date range where start is after end', () => {
    const invalidRange = {
      start: '2025-12-31',
      end: '2025-01-01',
    };

    const result = DateRangeSchema.safeParse(invalidRange);
    expect(result.success).toBe(false);
  });

  it('should reject invalid date formats in range', () => {
    const invalidRange = {
      start: '2025/01/01', // Wrong format
      end: '2025-12-31',
    };

    const result = DateRangeSchema.safeParse(invalidRange);
    expect(result.success).toBe(false);
  });
});

describe('MatchItemSchema', () => {
  it('should validate complete match item', () => {
    const validMatch = {
      bank_date: '2025-10-15',
      bank_amount: '25.50',
      bank_description: 'Grocery Store',
      ynab_date: '2025-10-15',
      ynab_amount: '25.50',
      ynab_payee: 'Grocery Store',
      ynab_transaction: {
        id: 'txn-1',
        cleared: 'cleared',
      },
      match_score: 95,
      match_reasons: ['exact_amount_match', 'exact_date_match', 'payee_similarity'],
    };

    const result = MatchItemSchema.safeParse(validMatch);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.match_score).toBe(95);
      expect(result.data.match_reasons).toHaveLength(3);
    }
  });

  it('should validate match with negative amounts', () => {
    const validMatch = {
      bank_date: '2025-10-15',
      bank_amount: '-125.00',
      bank_description: 'Payment',
      ynab_date: '2025-10-15',
      ynab_amount: '-125.00',
      ynab_payee: null,
      ynab_transaction: { id: 'txn-2', cleared: 'uncleared' },
      match_score: 100,
      match_reasons: ['exact_match'],
    };

    const result = MatchItemSchema.safeParse(validMatch);
    expect(result.success).toBe(true);
  });

  it('should fail validation when amount format is incorrect', () => {
    const invalidMatch = {
      bank_date: '2025-10-15',
      bank_amount: '25.5', // Should be '25.50' (2 decimal places)
      bank_description: 'Grocery Store',
      ynab_date: '2025-10-15',
      ynab_amount: '25.50',
      ynab_payee: 'Grocery Store',
      ynab_transaction: { id: 'txn-1', cleared: 'cleared' },
      match_score: 95,
      match_reasons: ['exact_amount_match'],
    };

    const result = MatchItemSchema.safeParse(invalidMatch);
    expect(result.success).toBe(false);
  });
});

describe('MissingInYNABItemSchema', () => {
  it('should validate complete missing in YNAB item with suggestions', () => {
    const validItem = {
      date: '2025-10-20',
      amount: '15.00',
      description: 'Unknown Store',
      row_number: 12,
      suggested_payee_id: 'payee-123',
      suggested_payee_name: 'Unknown Store',
      suggestion_reason: 'Matched by description similarity',
    };

    const result = MissingInYNABItemSchema.safeParse(validItem);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggested_payee_id).toBe('payee-123');
      expect(result.data.row_number).toBe(12);
    }
  });

  it('should validate minimal missing in YNAB item without suggestions', () => {
    const validItem = {
      date: '2025-10-21',
      amount: '-50.00',
      description: 'Cash Withdrawal',
      row_number: 15,
    };

    const result = MissingInYNABItemSchema.safeParse(validItem);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggested_payee_id).toBeUndefined();
    }
  });

  it('should fail validation when amount format is incorrect', () => {
    const invalidItem = {
      date: '2025-10-20',
      amount: '15', // Should have 2 decimal places
      description: 'Unknown Store',
      row_number: 12,
    };

    const result = MissingInYNABItemSchema.safeParse(invalidItem);
    expect(result.success).toBe(false);
  });
});

describe('MissingInBankItemSchema', () => {
  it('should validate complete missing in bank item', () => {
    const validItem = {
      id: 'txn-99',
      date: '2025-10-22',
      amount: '20.00',
      payee_name: 'Coffee Shop',
      memo: 'Morning coffee',
      cleared: 'cleared',
    };

    const result = MissingInBankItemSchema.safeParse(validItem);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('txn-99');
      expect(result.data.payee_name).toBe('Coffee Shop');
    }
  });

  it('should validate missing in bank item with null fields', () => {
    const validItem = {
      id: 'txn-100',
      date: '2025-10-23',
      amount: '-30.50',
      payee_name: null,
      memo: null,
      cleared: 'uncleared',
    };

    const result = MissingInBankItemSchema.safeParse(validItem);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payee_name).toBeNull();
      expect(result.data.memo).toBeNull();
    }
  });

  it('should fail validation when missing required fields', () => {
    const invalidItem = {
      id: 'txn-99',
      date: '2025-10-22',
      // Missing: amount, payee_name, memo, cleared
    };

    const result = MissingInBankItemSchema.safeParse(invalidItem);
    expect(result.success).toBe(false);
  });
});

describe('CompareTransactionsOutputSchema', () => {
  it('should validate complete comparison result with all sections', () => {
    const validOutput = {
      summary: {
        bank_transactions_count: 50,
        ynab_transactions_count: 52,
        matches_found: 45,
        missing_in_ynab: 5,
        missing_in_bank: 7,
        date_range: {
          start: '2025-10-01',
          end: '2025-10-31',
        },
        parameters: {
          amount_tolerance: 0,
          date_tolerance_days: 2,
        },
      },
      matches: [
        {
          bank_date: '2025-10-15',
          bank_amount: '25.50',
          bank_description: 'Grocery Store',
          ynab_date: '2025-10-15',
          ynab_amount: '25.50',
          ynab_payee: 'Grocery Store',
          ynab_transaction: { id: 'txn-1', cleared: 'cleared' },
          match_score: 95,
          match_reasons: ['exact_amount_match', 'exact_date_match'],
        },
      ],
      missing_in_ynab: [
        {
          date: '2025-10-20',
          amount: '15.00',
          description: 'Unknown Store',
          row_number: 12,
          suggested_payee_name: 'Unknown Store',
          suggestion_reason: 'No matching payee found',
        },
      ],
      missing_in_bank: [
        {
          id: 'txn-99',
          date: '2025-10-22',
          amount: '20.00',
          payee_name: 'Coffee Shop',
          memo: null,
          cleared: 'cleared',
        },
      ],
    };

    const result = CompareTransactionsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary.matches_found).toBe(45);
      expect(result.data.matches).toHaveLength(1);
      expect(result.data.missing_in_ynab).toHaveLength(1);
      expect(result.data.missing_in_bank).toHaveLength(1);
    }
  });

  it('should validate comparison result with empty match arrays', () => {
    const validOutput = {
      summary: {
        bank_transactions_count: 10,
        ynab_transactions_count: 10,
        matches_found: 0,
        missing_in_ynab: 10,
        missing_in_bank: 10,
        date_range: {
          start: '2025-11-01',
          end: '2025-11-30',
        },
        parameters: {},
      },
      matches: [],
      missing_in_ynab: [],
      missing_in_bank: [],
    };

    const result = CompareTransactionsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary.matches_found).toBe(0);
      expect(result.data.matches).toHaveLength(0);
    }
  });

  it('should fail validation when missing required summary fields', () => {
    const invalidOutput = {
      summary: {
        bank_transactions_count: 50,
        // Missing: ynab_transactions_count, matches_found, etc.
      },
      matches: [],
      missing_in_ynab: [],
      missing_in_bank: [],
    };

    const result = CompareTransactionsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when date range is invalid', () => {
    const invalidOutput = {
      summary: {
        bank_transactions_count: 50,
        ynab_transactions_count: 52,
        matches_found: 45,
        missing_in_ynab: 5,
        missing_in_bank: 7,
        date_range: {
          start: '2025-10-31',
          end: '2025-10-01', // End before start
        },
        parameters: {},
      },
      matches: [],
      missing_in_ynab: [],
      missing_in_bank: [],
    };

    const result = CompareTransactionsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe('ExportTransactionsOutputSchema', () => {
  it('should validate minimal export mode output', () => {
    const validOutput = {
      message: 'Successfully exported 150 transactions (minimal fields)',
      filename: 'ynab_transactions_minimal_2025-11-18.json',
      full_path: '/Users/username/Downloads/ynab_transactions_minimal_2025-11-18.json',
      export_directory: '/Users/username/Downloads',
      export_mode: 'minimal',
      minimal_fields: 'id, date, amount, payee_name, cleared',
      filename_explanation: 'Filename format: ynab_{filters}_{count}items_{timestamp}.json',
      preview_count: 10,
      total_count: 150,
      preview_transactions: [
        {
          id: 'txn-1',
          date: '2025-11-15',
          amount: -25500, // Milliunits
          memo: 'Groceries',
          payee_name: 'Grocery Store',
          category_name: 'Food',
        },
      ],
    };

    const result = ExportTransactionsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.export_mode).toBe('minimal');
      expect(result.data.minimal_fields).toBe('id, date, amount, payee_name, cleared');
      expect(result.data.preview_transactions).toHaveLength(1);
      expect(result.data.total_count).toBe(150);
    }
  });

  it('should validate full export mode output', () => {
    const validOutput = {
      message: 'Successfully exported 150 transactions (full fields)',
      filename: 'ynab_transactions_2025-11-18.json',
      full_path: '/Users/username/Downloads/ynab_transactions_2025-11-18.json',
      export_directory: '/Users/username/Downloads',
      export_mode: 'full',
      minimal_fields: null,
      filename_explanation: 'Filename format: ynab_{filters}_{count}items_{timestamp}.json',
      preview_count: 10,
      total_count: 150,
      preview_transactions: [
        {
          id: 'txn-2',
          date: '2025-11-16',
          amount: -15000, // Milliunits: -$15.00
          payee_name: 'Cafe',
          category_name: 'Dining',
        },
      ],
    };

    const result = ExportTransactionsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.export_mode).toBe('full');
      expect(result.data.minimal_fields).toBeNull();
    }
  });

  it('should validate export output with empty preview', () => {
    const validOutput = {
      message: 'Successfully exported 0 transactions',
      filename: 'ynab_transactions_empty_2025-11-18.json',
      full_path: '/Users/username/Downloads/ynab_transactions_empty_2025-11-18.json',
      export_directory: '/Users/username/Downloads',
      export_mode: 'full',
      minimal_fields: null,
      filename_explanation: 'No transactions to export',
      preview_count: 0,
      total_count: 0,
      preview_transactions: [],
    };

    const result = ExportTransactionsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preview_transactions).toHaveLength(0);
      expect(result.data.total_count).toBe(0);
    }
  });

  it('should fail validation when export_mode is invalid', () => {
    const invalidOutput = {
      message: 'Export complete',
      filename: 'export.json',
      full_path: '/path/to/export.json',
      export_directory: '/path/to',
      export_mode: 'invalid', // Should be 'minimal' or 'full'
      minimal_fields: null,
      filename_explanation: 'Filename',
      preview_count: 0,
      total_count: 0,
      preview_transactions: [],
    };

    const result = ExportTransactionsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required fields', () => {
    const invalidOutput = {
      message: 'Export complete',
      filename: 'export.json',
      // Missing: full_path, export_directory, export_mode, etc.
    };

    const result = ExportTransactionsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when preview_count is not a number', () => {
    const invalidOutput = {
      message: 'Export complete',
      filename: 'export.json',
      full_path: '/path/to/export.json',
      export_directory: '/path/to',
      export_mode: 'full',
      minimal_fields: null,
      filename_explanation: 'Filename',
      preview_count: '10', // Should be number
      total_count: 100,
      preview_transactions: [],
    };

    const result = ExportTransactionsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});
