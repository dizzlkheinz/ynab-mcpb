import { describe, it, expect } from 'vitest';
import { parseCSV } from '../../../tools/reconciliation/csvParser.js';

describe('Real World CSV Validation (Simulated)', () => {
  describe('Wealthsimple', () => {
    // Simulated content based on real structure
    const wsContent = `Date,Payee,Amount
2025-11-21,"Amazon.Ca*B03Vv2Ss0",-42.68
2025-11-21,"Amazon.Ca*B06I19Si0",-33.56
2025-11-21,"Amzn Mktp Ca*B07U50Um2",-37.79`;

    it('should parse Wealthsimple export correctly', () => {
      const result = parseCSV(wsContent);

      expect(result.errors).toHaveLength(0);
      expect(result.transactions.length).toBe(3);

      const first = result.transactions[0];
      expect(first.date).toBe('2025-11-21');
      expect(first.payee).toContain('Amazon');
      expect(first.amount).toBe(-42680); // -42.68
    });
  });

  describe('TD Canada Trust', () => {
    // Simulated content based on real structure (Headerless)
    // Date, Desc, Debit, Credit, Balance
    const tdContent = `11/21/2025,EvoCarShare,23.87,,132.91
11/19/2025,KOODO MOBILE PAC,43.68,,109.04
11/14/2025,PAYMENT - THANK YOU,,1378.31,0.00`;

    it('should parse TD export correctly using preset', () => {
      // TD export is headerless
      // We expect the 'td' preset to handle header: false and index mappings
      const result = parseCSV(tdContent, { preset: 'td' });

      expect(result.errors).toHaveLength(0);
      expect(result.transactions.length).toBe(3);

      const first = result.transactions[0];
      // 11/21/2025
      expect(first.date).toBe('2025-11-21');
      expect(first.payee).toBe('EvoCarShare');
      // 23.87 Debit = Outflow = Negative
      expect(first.amount).toBe(-23870);

      const third = result.transactions[2];
      // 1378.31 Credit = Inflow = Positive
      expect(third.payee).toBe('PAYMENT - THANK YOU');
      expect(third.amount).toBe(1378310);
    });
  });
});
