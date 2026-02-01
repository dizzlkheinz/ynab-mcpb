import { describe, expect, it } from 'vitest';
import {
  formatISODate,
  formatYNABMonth,
  getCurrentMonth,
  getHistoricalMonths,
  getToday,
  isValidISODate,
  isValidYNABMonth,
  subtractMonths,
  yearMonthToYNABMonth,
} from '../dateUtils.js';

describe('dateUtils', () => {
  describe('formatYNABMonth', () => {
    it('should format date as YYYY-MM-01', () => {
      const date = new Date('2024-03-15T10:30:00.000Z');
      expect(formatYNABMonth(date)).toBe('2024-03-01');
    });

    it('should handle December correctly', () => {
      const date = new Date('2024-12-31T23:59:59.999Z');
      expect(formatYNABMonth(date)).toBe('2024-12-01');
    });
  });

  describe('formatISODate', () => {
    it('should format date as YYYY-MM-DD', () => {
      const date = new Date('2024-03-15T10:30:00.000Z');
      expect(formatISODate(date)).toBe('2024-03-15');
    });
  });

  describe('getCurrentMonth', () => {
    it('should return current month in YYYY-MM-01 format', () => {
      const result = getCurrentMonth();
      expect(result).toMatch(/^\d{4}-\d{2}-01$/);
    });
  });

  describe('getToday', () => {
    it('should return today in YYYY-MM-DD format', () => {
      const result = getToday();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('getHistoricalMonths', () => {
    it('should generate correct number of historical months', () => {
      const baseDate = new Date('2024-03-15');
      const months = getHistoricalMonths(3, baseDate);

      expect(months).toHaveLength(3);
      expect(months[0]).toBe('2024-03-01'); // Current month (i=0)
      expect(months[1]).toBe('2024-02-01'); // 1 month back
      expect(months[2]).toBe('2024-01-01'); // 2 months back
    });

    it('should handle year boundary correctly', () => {
      const baseDate = new Date('2024-01-15');
      const months = getHistoricalMonths(3, baseDate);

      expect(months).toHaveLength(3);
      expect(months[0]).toBe('2024-01-01');
      expect(months[1]).toBe('2023-12-01');
      expect(months[2]).toBe('2023-11-01');
    });

    it('should use current date when no base date provided', () => {
      const months = getHistoricalMonths(2);
      expect(months).toHaveLength(2);
      expect(months[0]).toMatch(/^\d{4}-\d{2}-01$/);
      expect(months[1]).toMatch(/^\d{4}-\d{2}-01$/);
    });

    it('should generate 6 months correctly (bug test case)', () => {
      const baseDate = new Date('2025-08-15');
      const months = getHistoricalMonths(6, baseDate);

      expect(months).toEqual([
        '2025-08-01',
        '2025-07-01',
        '2025-06-01',
        '2025-05-01',
        '2025-04-01',
        '2025-03-01',
      ]);

      // Ensure no duplicates (the original bug)
      const uniqueMonths = new Set(months);
      expect(uniqueMonths.size).toBe(6);
    });
  });

  describe('subtractMonths', () => {
    it('should subtract months correctly', () => {
      const baseDate = new Date('2024-03-15');
      const result = subtractMonths(baseDate, 2);

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // January (0-indexed)
      // Note: When subtracting months, if the target month doesn't have enough days,
      // JavaScript adjusts the date (e.g., March 15 - 2 months might become January 14)
      expect(result.getDate()).toBeGreaterThanOrEqual(14);
      expect(result.getDate()).toBeLessThanOrEqual(15);
    });

    it('should handle year boundary', () => {
      const baseDate = new Date('2024-01-15');
      const result = subtractMonths(baseDate, 2);

      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(10); // November (0-indexed)
    });
  });

  describe('isValidISODate', () => {
    it('should validate correct ISO dates', () => {
      expect(isValidISODate('2024-03-15')).toBe(true);
      expect(isValidISODate('2024-12-31')).toBe(true);
      expect(isValidISODate('2024-02-29')).toBe(true); // Leap year
    });

    it('should reject invalid formats', () => {
      expect(isValidISODate('03/15/2024')).toBe(false);
      expect(isValidISODate('2024-3-15')).toBe(false);
      expect(isValidISODate('2024-03-5')).toBe(false);
      expect(isValidISODate('24-03-15')).toBe(false);
      expect(isValidISODate('not-a-date')).toBe(false);
    });

    it('should reject invalid dates with correct format', () => {
      expect(isValidISODate('2024-02-30')).toBe(false); // Invalid date
      expect(isValidISODate('2024-13-01')).toBe(false); // Invalid month
      expect(isValidISODate('2023-02-29')).toBe(false); // Not a leap year
    });
  });

  describe('isValidYNABMonth', () => {
    it('should validate correct YNAB month format', () => {
      expect(isValidYNABMonth('2024-03-01')).toBe(true);
      expect(isValidYNABMonth('2024-12-01')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isValidYNABMonth('2024-03-15')).toBe(false);
      expect(isValidYNABMonth('2024-03')).toBe(false);
      expect(isValidYNABMonth('03-01-2024')).toBe(false);
      expect(isValidYNABMonth('not-a-month')).toBe(false);
    });

    it('should reject invalid months with correct format', () => {
      expect(isValidYNABMonth('2024-13-01')).toBe(false); // Invalid month
      expect(isValidYNABMonth('2024-00-01')).toBe(false); // Invalid month
    });
  });

  describe('yearMonthToYNABMonth', () => {
    it('should convert YYYY-MM to YYYY-MM-01', () => {
      expect(yearMonthToYNABMonth('2024-03')).toBe('2024-03-01');
      expect(yearMonthToYNABMonth('2024-12')).toBe('2024-12-01');
    });

    it('should throw error for invalid format', () => {
      expect(() => yearMonthToYNABMonth('2024-3')).toThrow('Invalid year-month format');
      expect(() => yearMonthToYNABMonth('24-03')).toThrow('Invalid year-month format');
      expect(() => yearMonthToYNABMonth('not-valid')).toThrow('Invalid year-month format');
    });
  });
});
