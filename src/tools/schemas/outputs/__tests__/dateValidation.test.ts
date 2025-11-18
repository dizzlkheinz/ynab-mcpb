import { describe, it, expect } from 'vitest';
import { ISODateStringSchema, BankTransactionComparisonSchema, DateRangeSchema } from '../comparisonOutputs.js';

describe('Date Validation in comparisonOutputs', () => {
  describe('ISODateStringSchema', () => {
    it('should accept valid dates', () => {
      expect(() => ISODateStringSchema.parse('2024-01-15')).not.toThrow();
      expect(() => ISODateStringSchema.parse('2024-12-31')).not.toThrow();
      expect(() => ISODateStringSchema.parse('2024-02-29')).not.toThrow(); // Leap year
      expect(() => ISODateStringSchema.parse('2000-02-29')).not.toThrow(); // Leap year
    });

    it('should reject invalid months', () => {
      expect(() => ISODateStringSchema.parse('2024-00-15')).toThrow('Invalid calendar date');
      expect(() => ISODateStringSchema.parse('2024-13-15')).toThrow('Invalid calendar date');
    });

    it('should reject invalid days', () => {
      expect(() => ISODateStringSchema.parse('2024-01-00')).toThrow('Invalid calendar date');
      expect(() => ISODateStringSchema.parse('2024-01-32')).toThrow('Invalid calendar date');
      expect(() => ISODateStringSchema.parse('2024-02-30')).toThrow('Invalid calendar date');
      expect(() => ISODateStringSchema.parse('2024-02-31')).toThrow('Invalid calendar date');
      expect(() => ISODateStringSchema.parse('2024-04-31')).toThrow('Invalid calendar date'); // April has 30 days
      expect(() => ISODateStringSchema.parse('2024-11-31')).toThrow('Invalid calendar date'); // November has 30 days
    });

    it('should reject non-leap year February 29', () => {
      expect(() => ISODateStringSchema.parse('2023-02-29')).toThrow('Invalid calendar date');
      expect(() => ISODateStringSchema.parse('2025-02-29')).toThrow('Invalid calendar date');
    });

    it('should reject invalid format', () => {
      expect(() => ISODateStringSchema.parse('24-01-15')).toThrow('Date must be in YYYY-MM-DD format');
      expect(() => ISODateStringSchema.parse('2024/01/15')).toThrow('Date must be in YYYY-MM-DD format');
      expect(() => ISODateStringSchema.parse('01-15-2024')).toThrow('Date must be in YYYY-MM-DD format');
      expect(() => ISODateStringSchema.parse('2024-1-15')).toThrow('Date must be in YYYY-MM-DD format');
      expect(() => ISODateStringSchema.parse('2024-01-5')).toThrow('Date must be in YYYY-MM-DD format');
    });
  });

  describe('BankTransactionComparisonSchema', () => {
    it('should accept valid bank transaction with valid date', () => {
      const validTransaction = {
        date: '2024-01-15',
        amount: -2500,
        description: 'Grocery Store',
        raw_amount: '-25.00',
        raw_date: '01/15/2024',
        row_number: 1,
      };

      expect(() => BankTransactionComparisonSchema.parse(validTransaction)).not.toThrow();
    });

    it('should reject bank transaction with invalid date', () => {
      const invalidTransaction = {
        date: '2024-02-31', // Invalid: February doesn't have 31 days
        amount: -2500,
        description: 'Grocery Store',
        raw_amount: '-25.00',
        raw_date: '02/31/2024',
        row_number: 1,
      };

      expect(() => BankTransactionComparisonSchema.parse(invalidTransaction)).toThrow('Invalid calendar date');
    });
  });

  describe('DateRangeSchema', () => {
    it('should accept valid date range', () => {
      const validRange = {
        start: '2024-01-01',
        end: '2024-12-31',
      };

      expect(() => DateRangeSchema.parse(validRange)).not.toThrow();
    });

    it('should accept date range where start equals end', () => {
      const validRange = {
        start: '2024-06-15',
        end: '2024-06-15',
      };

      expect(() => DateRangeSchema.parse(validRange)).not.toThrow();
    });

    it('should reject date range with invalid start date', () => {
      const invalidRange = {
        start: '2024-13-01', // Invalid month
        end: '2024-12-31',
      };

      expect(() => DateRangeSchema.parse(invalidRange)).toThrow('Invalid calendar date');
    });

    it('should reject date range with invalid end date', () => {
      const invalidRange = {
        start: '2024-01-01',
        end: '2024-02-30', // Invalid: February doesn't have 30 days
      };

      expect(() => DateRangeSchema.parse(invalidRange)).toThrow('Invalid calendar date');
    });

    it('should reject date range where start is after end', () => {
      const invalidRange = {
        start: '2024-12-31',
        end: '2024-01-01',
      };

      expect(() => DateRangeSchema.parse(invalidRange)).toThrow('Start date must be before or equal to end date');
    });

    it('should reject date range where start is after end (same month)', () => {
      const invalidRange = {
        start: '2024-06-20',
        end: '2024-06-15',
      };

      expect(() => DateRangeSchema.parse(invalidRange)).toThrow('Start date must be before or equal to end date');
    });

    it('should reject date range where start is after end (consecutive days)', () => {
      const invalidRange = {
        start: '2024-06-16',
        end: '2024-06-15',
      };

      expect(() => DateRangeSchema.parse(invalidRange)).toThrow('Start date must be before or equal to end date');
    });
  });
});
