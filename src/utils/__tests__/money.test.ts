import { describe, it, expect } from 'vitest';
import type * as ynab from 'ynab';
import {
  toMilli,
  fromMilli,
  assertMilli,
  addMilli,
  inWindow,
  moneyDirection,
  formatMoney,
  toMoneyValue,
  toMoneyValueFromDecimal,
  getDecimalDigits,
  getCurrencyCode,
} from '../money.js';

describe('money utilities', () => {
  describe('toMilli', () => {
    it('converts dollars to milliunits correctly', () => {
      expect(toMilli(1.23)).toBe(1230);
      expect(toMilli(-5.67)).toBe(-5670);
      expect(toMilli('10.50')).toBe(10500);
    });

    it('throws for invalid amounts', () => {
      expect(() => toMilli(Number.MAX_SAFE_INTEGER)).toThrow('Invalid/unsafe amount');
      expect(() => toMilli('invalid')).toThrow('Invalid/unsafe amount');
    });
  });

  describe('fromMilli', () => {
    it('converts milliunits with 2 decimal digits (USD) by default', () => {
      expect(fromMilli(1230)).toBe(1.23);
      expect(fromMilli(-5670)).toBe(-5.67);
      expect(fromMilli(0)).toBe(0);
    });

    it('converts milliunits with 0 decimal digits (JPY)', () => {
      expect(fromMilli(123000, 0)).toBe(123);
      expect(fromMilli(1000, 0)).toBe(1);
    });

    it('converts milliunits with 3 decimal digits (BHD)', () => {
      expect(fromMilli(1234, 3)).toBe(1.234);
      expect(fromMilli(500, 3)).toBe(0.5);
    });

    it('converts milliunits with explicit 2 decimal digits', () => {
      expect(fromMilli(1230, 2)).toBe(1.23);
    });
  });

  describe('assertMilli', () => {
    it('passes for safe integers', () => {
      expect(() => assertMilli(1000)).not.toThrow();
      expect(() => assertMilli(-500)).not.toThrow();
      expect(() => assertMilli(0)).not.toThrow();
    });

    it('throws for non-safe integers', () => {
      expect(() => assertMilli(1.5)).toThrow('Expected safe integer milliunits');
      expect(() => assertMilli(Number.MAX_SAFE_INTEGER + 1)).toThrow(
        'Expected safe integer milliunits',
      );
    });
  });

  describe('addMilli', () => {
    it('adds milliunits correctly', () => {
      expect(addMilli(1000, 2000)).toBe(3000);
      expect(addMilli(-500, 300)).toBe(-200);
    });

    it('throws on overflow', () => {
      expect(() => addMilli(Number.MAX_SAFE_INTEGER, 1)).toThrow('Milliunit sum overflow');
    });
  });

  describe('inWindow', () => {
    it('checks date windows correctly', () => {
      expect(inWindow('2024-01-15', '2024-01-01', '2024-01-31')).toBe(true);
      expect(inWindow('2023-12-31', '2024-01-01', '2024-01-31')).toBe(false);
      expect(inWindow('2024-02-01', '2024-01-01', '2024-01-31')).toBe(false);
    });

    it('handles optional bounds', () => {
      expect(inWindow('2024-01-15', undefined, '2024-01-31')).toBe(true);
      expect(inWindow('2024-01-15', '2024-01-01', undefined)).toBe(true);
      expect(inWindow('2024-01-15', undefined, undefined)).toBe(true);
    });
  });

  describe('currency format helpers', () => {
    it('extracts decimal digits from currency format', () => {
      const usdFormat: ynab.CurrencyFormat = {
        iso_code: 'USD',
        example_format: '$1,234.56',
        decimal_digits: 2,
        decimal_separator: '.',
        symbol_first: true,
        group_separator: ',',
        currency_symbol: '$',
        display_symbol: true,
      };
      expect(getDecimalDigits(usdFormat)).toBe(2);

      const jpyFormat: ynab.CurrencyFormat = {
        iso_code: 'JPY',
        example_format: '¥1,234',
        decimal_digits: 0,
        decimal_separator: '.',
        symbol_first: true,
        group_separator: ',',
        currency_symbol: '¥',
        display_symbol: true,
      };
      expect(getDecimalDigits(jpyFormat)).toBe(0);
    });

    it('returns default decimal digits for null/undefined', () => {
      expect(getDecimalDigits(null)).toBe(2);
      expect(getDecimalDigits(undefined)).toBe(2);
    });

    it('extracts currency code from currency format', () => {
      const eurFormat: ynab.CurrencyFormat = {
        iso_code: 'EUR',
        example_format: '€1.234,56',
        decimal_digits: 2,
        decimal_separator: ',',
        symbol_first: false,
        group_separator: '.',
        currency_symbol: '€',
        display_symbol: true,
      };
      expect(getCurrencyCode(eurFormat)).toBe('EUR');
    });

    it('returns default currency for null/undefined', () => {
      expect(getCurrencyCode(null)).toBe('USD');
      expect(getCurrencyCode(undefined)).toBe('USD');
    });
  });

  describe('moneyValue helpers', () => {
    it('derives direction correctly', () => {
      expect(moneyDirection(0)).toBe('balanced');
      expect(moneyDirection(1500)).toBe('credit');
      expect(moneyDirection(-2500)).toBe('debit');
    });

    it('formats milliunits into currency strings with default 2 decimals', () => {
      expect(formatMoney(1234)).toBe('$1.23');
      expect(formatMoney(-9870)).toBe('-$9.87');
    });

    it('formats milliunits with custom currency format', () => {
      expect(formatMoney(123000, 'JPY', 0)).toBe('¥123');
      expect(formatMoney(1234, 'USD', 2)).toBe('$1.23');
      expect(formatMoney(1234, 'EUR', 3)).toBe('€1.234'); // 3 decimal digits requested
    });

    it('creates money values from milliunits with default 2 decimals', () => {
      const value = toMoneyValue(22220);
      expect(value.value).toBe(22.22);
      expect(value.value_display).toBe('$22.22');
      expect(value.direction).toBe('credit');
    });

    it('creates currency-aware money values with decimal digits', () => {
      const valueJPY = toMoneyValue(123000, 'JPY', 0);
      expect(valueJPY.value).toBe(123);
      expect(valueJPY.value_display).toBe('¥123');
      expect(valueJPY.currency).toBe('JPY');
      expect(valueJPY.direction).toBe('credit');

      const valueUSD = toMoneyValue(1234, 'USD', 2);
      expect(valueUSD.value).toBe(1.23);
      expect(valueUSD.value_display).toBe('$1.23');
    });

    it('creates money values from decimal amounts', () => {
      const value = toMoneyValueFromDecimal(-45.67);
      expect(value.value_milliunits).toBe(-45670);
      expect(value.value_display).toBe('-$45.67');
      expect(value.direction).toBe('debit');
    });
  });
});
