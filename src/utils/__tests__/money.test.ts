import { describe, it, expect } from 'vitest';
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
    it('converts milliunits to dollars correctly', () => {
      expect(fromMilli(1230)).toBe(1.23);
      expect(fromMilli(-5670)).toBe(-5.67);
      expect(fromMilli(0)).toBe(0);
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

  describe('moneyValue helpers', () => {
    it('derives direction correctly', () => {
      expect(moneyDirection(0)).toBe('balanced');
      expect(moneyDirection(1500)).toBe('credit');
      expect(moneyDirection(-2500)).toBe('debit');
    });

    it('formats milliunits into currency strings', () => {
      expect(formatMoney(1234)).toBe('$1.23');
      expect(formatMoney(-9870)).toBe('-$9.87');
    });

    it('creates money values from milliunits', () => {
      const value = toMoneyValue(22220);
      expect(value.value).toBe(22.22);
      expect(value.value_display).toBe('$22.22');
      expect(value.direction).toBe('credit');
    });

    it('creates money values from decimal amounts', () => {
      const value = toMoneyValueFromDecimal(-45.67);
      expect(value.value_milliunits).toBe(-45670);
      expect(value.value_display).toBe('-$45.67');
      expect(value.direction).toBe('debit');
    });
  });
});
