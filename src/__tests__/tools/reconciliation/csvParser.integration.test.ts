import { describe, expect, it } from 'vitest';
import { parseCSV } from '../../../tools/reconciliation/csvParser.js';
import { findMatches } from '../../../tools/reconciliation/matcher.js';
import { normalizeYNABTransaction } from '../../../tools/reconciliation/ynabAdapter.js';

describe('CSV Parser Integration Tests', () => {
  describe('TD Bank CSV', () => {
    const tdCSV = `Date,Description,Amount
09/15/2025,SHELL STATION 1234 TORONTO ON,-45.23
09/16/2025,AMZN MKTP CA*1A2B3C4,-127.99
09/17/2025,PAYROLL DEPOSIT ABC CORP,2500.00`;

    it('should parse TD CSV correctly', () => {
      const result = parseCSV(tdCSV, { preset: 'td' });

      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(3);
      expect(result.transactions[0].amount).toBe(-45230); // Milliunits!
      expect(result.transactions[0].payee).toBe('SHELL STATION 1234 TORONTO ON');
      expect(result.transactions[0].date).toBe('2025-09-15');
    });
  });

  describe('RBC Debit/Credit CSV', () => {
    const rbcCSV = `Transaction Date,Description 1,Debit,Credit
2025-09-15,SHELL GAS,45.23,
2025-09-16,TRANSFER FROM SAVINGS,,500.00`;

    it('should parse RBC CSV with debit/credit columns', () => {
      const result = parseCSV(rbcCSV, { preset: 'rbc' });

      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].amount).toBe(-45230); // Debit = negative milliunits
      expect(result.transactions[1].amount).toBe(500000); // Credit = positive milliunits
    });
  });

  describe('Ambiguous Debit/Credit Warning', () => {
    const ambiguousCSV = `Transaction Date,Description,Debit,Credit
2025-09-15,WEIRD TXN,50.00,25.00`;

    it('should warn when both debit and credit have values', () => {
      const result = parseCSV(ambiguousCSV, { preset: 'rbc' });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain('Both Debit');
      expect(result.transactions[0].amount).toBe(-50000); // Uses debit
    });
  });

  describe('European Number Format', () => {
    const euroCSV = `Date,Amount,Description
15/09/2025,"1.234,56",Big Purchase`;

    it('should handle European number format', () => {
      const result = parseCSV(euroCSV);

      expect(result.transactions[0].amount).toBe(1234560); // 1234.56 in milliunits
    });
  });
});

describe('Matcher Integration Tests', () => {
  const mockYNABTransactions = [
    {
      id: 'y1',
      date: '2025-09-15',
      amount: -45230,
      payee_name: 'Shell',
      category_name: 'Gas',
      cleared: 'uncleared',
      approved: true,
    },
    {
      id: 'y2',
      date: '2025-09-17',
      amount: -127990,
      payee_name: 'Amazon',
      category_name: 'Shopping',
      cleared: 'uncleared',
      approved: true,
    },
  ].map((t) => normalizeYNABTransaction(t as any));

  it('should achieve high confidence matches with exact integer comparison', () => {
    const bankCSV = `Date,Description,Amount
09/15/2025,SHELL STATION 1234,-45.23
09/16/2025,AMZN MKTP CA*ABC123,-127.99`;

    const parsed = parseCSV(bankCSV);
    const matches = findMatches(parsed.transactions, mockYNABTransactions);

    // Shell: exact amount match (both -45230 milliunits)
    expect(matches[0].confidence).toBe('high');
    expect(matches[0].bestMatch?.scores.amount).toBe(100);

    // Amazon: exact amount match (both -127990 milliunits)
    expect(matches[1].confidence).toBe('high');
    expect(matches[1].bestMatch?.scores.amount).toBe(100);
  });

  it('should use exact integer comparison (no float precision issues)', () => {
    // Both are now integers - no floating point comparison needed!
    const bankTxn = {
      id: 'b1',
      date: '2025-09-15',
      amount: -45230, // Integer milliunits
      payee: 'Shell',
      sourceRow: 2,
      raw: { date: '09/15/2025', amount: '-45.23', description: 'Shell' },
    };

    const ynabTxn = {
      id: 'y1',
      date: '2025-09-15',
      amount: -45230, // Integer milliunits - direct from YNAB API
      payee: 'Shell',
      memo: null,
      categoryName: 'Gas',
      cleared: 'uncleared' as const,
      approved: true,
    };

    const matches = findMatches([bankTxn], [ynabTxn]);
    // Exact match because integers compare exactly: -45230 === -45230
    expect(matches[0].bestMatch?.scores.amount).toBe(100);
  });
});
