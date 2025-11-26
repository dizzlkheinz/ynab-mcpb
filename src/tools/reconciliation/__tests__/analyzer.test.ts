import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeReconciliation } from '../analyzer.js';
import type { Transaction as YNABAPITransaction } from 'ynab';
import * as csvParser from '../csvParser.js';

// Mock the parser module
vi.mock('../csvParser.js', () => ({
  parseCSV: vi.fn(),
}));

describe('analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeReconciliation', () => {
    it('should perform full analysis and return structured results', () => {
      // Mock CSV parsing
      vi.mocked(csvParser.parseCSV).mockReturnValue({
        transactions: [
          {
            id: 'b1',
            date: '2025-10-15',
            amount: -45230, // milliunits
            payee: 'Shell Gas',
            memo: '',
            sourceRow: 1,
            raw: { date: '10/15/2025', amount: '-45.23', description: 'Shell Gas' },
          },
          {
            id: 'b2',
            date: '2025-10-16',
            amount: -100000, // milliunits
            payee: 'Netflix',
            memo: '',
            sourceRow: 2,
            raw: { date: '10/16/2025', amount: '-100.00', description: 'Netflix' },
          },
        ],
        meta: {
          detectedDelimiter: ',',
          detectedColumns: ['Date', 'Amount', 'Description'],
          totalRows: 2,
          validRows: 2,
          skippedRows: 0,
        },
        errors: [],
        warnings: [],
      });

      const ynabTxns: YNABAPITransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -45230,
          payee_name: 'Shell',
          category_name: 'Auto: Gas',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
        {
          id: 'y2',
          date: '2025-10-16',
          amount: -100000,
          payee_name: 'Netflix',
          category_name: 'Entertainment',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
      ];

      const result = analyzeReconciliation(
        'csv content',
        undefined,
        ynabTxns,
        -145.23, // Target balance
      );

      expect(result.success).toBe(true);
      expect(result.phase).toBe('analysis');
      expect(result.summary).toBeDefined();
      expect(result.auto_matches).toBeDefined();
      expect(result.suggested_matches).toBeDefined();
      expect(result.unmatched_bank).toBeDefined();
      expect(result.unmatched_ynab).toBeDefined();
      expect(result.balance_info).toBeDefined();
      expect(result.next_steps).toBeDefined();

      // Verify auto-matches (exact matches)
      expect(result.auto_matches.length).toBe(2);
    });

    it('should categorize high-confidence matches as auto-matches', () => {
      vi.mocked(csvParser.parseCSV).mockReturnValue({
        transactions: [
          {
            id: 'b1',
            date: '2025-10-15',
            amount: -50000,
            payee: 'Coffee Shop',
            memo: '',
            sourceRow: 1,
            raw: {} as any,
          },
        ],
        meta: {
          detectedDelimiter: ',',
          detectedColumns: [],
          totalRows: 1,
          validRows: 1,
          skippedRows: 0,
        },
        errors: [],
        warnings: [],
      });

      const ynabTxns: YNABAPITransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -50000,
          payee_name: 'Coffee Shop',
          category_name: 'Dining',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
      ];

      const result = analyzeReconciliation('csv', undefined, ynabTxns, -50.0);

      expect(result.auto_matches.length).toBeGreaterThan(0);
      expect(result.auto_matches[0].confidence).toBe('high');
    });

    it('should categorize medium-confidence matches as suggested', () => {
      vi.mocked(csvParser.parseCSV).mockReturnValue({
        transactions: [
          {
            id: 'b1',
            date: '2025-10-15',
            amount: -50000,
            payee: 'Generic Store',
            memo: '',
            sourceRow: 1,
            raw: {} as any,
          },
        ],
        meta: {
          detectedDelimiter: ',',
          detectedColumns: [],
          totalRows: 1,
          validRows: 1,
          skippedRows: 0,
        },
        errors: [],
        warnings: [],
      });

      const ynabTxns: YNABAPITransaction[] = [
        {
          id: 'y1',
          date: '2025-10-18', // 3 days difference - date score drops
          amount: -50000,
          payee_name: 'Amazon Prime', // Fuzzy match
          category_name: 'Shopping',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
      ];

      const result = analyzeReconciliation('csv', undefined, ynabTxns, -50.0);

      // Should be suggested (medium)
      expect(result.suggested_matches.length).toBeGreaterThan(0);
      expect(result.suggested_matches[0].confidence).toBe('medium');
    });

    it('should identify unmatched bank transactions', () => {
      vi.mocked(csvParser.parseCSV).mockReturnValue({
        transactions: [
          {
            id: 'b1',
            date: '2025-10-15',
            amount: -15990,
            payee: 'New Store',
            memo: '',
            sourceRow: 1,
            raw: {} as any,
          },
        ],
        meta: {
          detectedDelimiter: ',',
          detectedColumns: [],
          totalRows: 1,
          validRows: 1,
          skippedRows: 0,
        },
        errors: [],
        warnings: [],
      });

      const ynabTxns: YNABAPITransaction[] = [];

      const result = analyzeReconciliation('csv', undefined, ynabTxns, 0);

      expect(result.unmatched_bank.length).toBe(1);
      expect(result.unmatched_bank[0].payee).toBe('New Store');
    });

    it('should identify unmatched YNAB transactions', () => {
      vi.mocked(csvParser.parseCSV).mockReturnValue({
        transactions: [],
        meta: {
          detectedDelimiter: ',',
          detectedColumns: [],
          totalRows: 0,
          validRows: 0,
          skippedRows: 0,
        },
        errors: [],
        warnings: [],
      });

      const ynabTxns: YNABAPITransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -50000,
          payee_name: 'Restaurant',
          category_name: 'Dining',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
      ];

      const result = analyzeReconciliation('csv', undefined, ynabTxns, 0);

      expect(result.unmatched_ynab.length).toBe(1);
      expect(result.unmatched_ynab[0].payee_name).toBe('Restaurant');
    });

    it('should calculate balance information correctly', () => {
      vi.mocked(csvParser.parseCSV).mockReturnValue({
        transactions: [],
        meta: {
          detectedDelimiter: ',',
          detectedColumns: [],
          totalRows: 0,
          validRows: 0,
          skippedRows: 0,
        },
        errors: [],
        warnings: [],
      });

      const ynabTxns: YNABAPITransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -50000, // -$50.00 cleared
          payee_name: 'Store',
          category_name: 'Shopping',
          cleared: 'cleared' as const,
          approved: true,
        } as YNABAPITransaction,
        {
          id: 'y2',
          date: '2025-10-16',
          amount: -30000, // -$30.00 uncleared
          payee_name: 'Restaurant',
          category_name: 'Dining',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
      ];

      const result = analyzeReconciliation('csv', undefined, ynabTxns, -50.0);

      expect(result.balance_info.current_cleared.value).toBe(-50.0);
      expect(result.balance_info.current_uncleared.value).toBe(-30.0);
      expect(result.balance_info.current_total.value).toBe(-80.0);
      expect(result.balance_info.target_statement.value).toBe(-50.0);
      expect(result.balance_info.discrepancy.value).toBe(0);
      expect(result.balance_info.on_track).toBe(true);
    });

    it('should generate appropriate summary', () => {
      vi.mocked(csvParser.parseCSV).mockReturnValue({
        transactions: [
          {
            id: 'b1',
            date: '2025-10-15',
            amount: -50000,
            payee: 'Store',
            memo: '',
            sourceRow: 1,
            raw: {} as any,
          },
          {
            id: 'b2',
            date: '2025-10-20',
            amount: -30000,
            payee: 'Restaurant',
            memo: '',
            sourceRow: 2,
            raw: {} as any,
          },
        ],
        meta: {
          detectedDelimiter: ',',
          detectedColumns: [],
          totalRows: 2,
          validRows: 2,
          skippedRows: 0,
        },
        errors: [],
        warnings: [],
      });

      const ynabTxns: YNABAPITransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -50000,
          payee_name: 'Store',
          category_name: 'Shopping',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
      ];

      const result = analyzeReconciliation('csv', undefined, ynabTxns, -80.0);

      expect(result.summary.bank_transactions_count).toBe(2);
      expect(result.summary.ynab_transactions_count).toBe(1);
      expect(result.summary.statement_date_range).toContain('2025-10-15');
      expect(result.summary.statement_date_range).toContain('2025-10-20');
    });
  });
});
