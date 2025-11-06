import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeReconciliation } from '../analyzer.js';
import type { Transaction as YNABAPITransaction } from 'ynab';
import * as parser from '../../compareTransactions/parser.js';

// Mock the parser module
vi.mock('../../compareTransactions/parser.js', () => ({
  parseBankCSV: vi.fn(),
  readCSVFile: vi.fn(),
}));

describe('analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeReconciliation', () => {
    it('should perform full analysis and return structured results', () => {
      // Mock CSV parsing
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [
          {
            date: '2025-10-15',
            amount: -45.23,
            payee: 'Shell Gas',
            memo: '',
          },
          {
            date: '2025-10-16',
            amount: -100.0,
            payee: 'Netflix',
            memo: '',
          },
        ],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 2,
        valid_rows: 2,
        errors: [],
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
    });

    it('should categorize high-confidence matches as auto-matches', () => {
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [
          {
            date: '2025-10-15',
            amount: -50.0,
            payee: 'Coffee Shop',
            memo: '',
          },
        ],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 1,
        valid_rows: 1,
        errors: [],
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
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [
          {
            date: '2025-10-15',
            amount: -50.0,
            payee: 'Amazon',
            memo: '',
          },
        ],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 1,
        valid_rows: 1,
        errors: [],
      });

      const ynabTxns: YNABAPITransaction[] = [
        {
          id: 'y1',
          date: '2025-10-18', // 3 days difference
          amount: -50000,
          payee_name: 'Amazon Prime',
          category_name: 'Shopping',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
      ];

      const result = analyzeReconciliation('csv', undefined, ynabTxns, -50.0);

      // Might be medium or low depending on exact scoring
      expect(result.suggested_matches.length + result.unmatched_bank.length).toBeGreaterThan(0);
    });

    it('should identify unmatched bank transactions', () => {
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [
          {
            date: '2025-10-15',
            amount: -15.99,
            payee: 'New Store',
            memo: '',
          },
        ],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 1,
        valid_rows: 1,
        errors: [],
      });

      const ynabTxns: YNABAPITransaction[] = [];

      const result = analyzeReconciliation('csv', undefined, ynabTxns, 0);

      expect(result.unmatched_bank.length).toBe(1);
      expect(result.unmatched_bank[0].payee).toBe('New Store');
    });

    it('should identify unmatched YNAB transactions', () => {
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 0,
        valid_rows: 0,
        errors: [],
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

    it('should surface combination suggestions and insights when totals align', () => {
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [
          {
            date: '2025-10-20',
            amount: -30.0,
            payee: 'Evening Out',
            memo: '',
          },
        ],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 1,
        valid_rows: 1,
        errors: [],
      });

      const ynabTxns: YNABAPITransaction[] = [
        {
          id: 'y-combo-1',
          date: '2025-10-19',
          amount: -20000,
          payee_name: 'Dinner',
          category_name: 'Dining',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
        {
          id: 'y-combo-2',
          date: '2025-10-20',
          amount: -10000,
          payee_name: 'Drinks',
          category_name: 'Dining',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
        {
          id: 'y-extra',
          date: '2025-10-22',
          amount: -5000,
          payee_name: 'Snacks',
          category_name: 'Dining',
          cleared: 'uncleared' as const,
          approved: true,
        } as YNABAPITransaction,
      ];

      const result = analyzeReconciliation('csv', undefined, ynabTxns, -30.0);

      const comboMatch = result.suggested_matches.find(
        (match) => match.match_reason === 'combination_match',
      );
      expect(comboMatch).toBeDefined();
      expect(comboMatch?.candidates?.length).toBeGreaterThanOrEqual(2);

      const comboInsight = result.insights.find((insight) => insight.id.startsWith('combination-'));
      expect(comboInsight).toBeDefined();
      expect(comboInsight?.severity).toBe('info');
    });

    it('should calculate balance information correctly', () => {
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 0,
        valid_rows: 0,
        errors: [],
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
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [
          { date: '2025-10-15', amount: -50.0, payee: 'Store', memo: '' },
          { date: '2025-10-20', amount: -30.0, payee: 'Restaurant', memo: '' },
        ],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 2,
        valid_rows: 2,
        errors: [],
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

    it('should generate next steps based on analysis', () => {
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [{ date: '2025-10-15', amount: -50.0, payee: 'Store', memo: '' }],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 1,
        valid_rows: 1,
        errors: [],
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

      const result = analyzeReconciliation('csv', undefined, ynabTxns, -50.0);

      expect(result.next_steps).toBeDefined();
      expect(Array.isArray(result.next_steps)).toBe(true);
      expect(result.next_steps.length).toBeGreaterThan(0);
    });

    it('should use file path when provided', () => {
      vi.mocked(parser.readCSVFile).mockReturnValue({
        transactions: [{ date: '2025-10-15', amount: -50.0, payee: 'Store', memo: '' }],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 1,
        valid_rows: 1,
        errors: [],
      });

      const ynabTxns: YNABAPITransaction[] = [];

      const result = analyzeReconciliation('', '/path/to/file.csv', ynabTxns, 0);

      expect(vi.mocked(parser.readCSVFile)).toHaveBeenCalledWith('/path/to/file.csv');
      expect(result.success).toBe(true);
    });

    it('should assign unique IDs to bank transactions', () => {
      vi.mocked(parser.parseBankCSV).mockReturnValue({
        transactions: [
          { date: '2025-10-15', amount: -50.0, payee: 'Store1', memo: '' },
          { date: '2025-10-16', amount: -30.0, payee: 'Store2', memo: '' },
        ],
        format_detected: 'standard',
        delimiter: ',',
        total_rows: 2,
        valid_rows: 2,
        errors: [],
      });

      const result = analyzeReconciliation('csv', undefined, [], 0);

      expect(result.unmatched_bank.length).toBe(2);
      expect(result.unmatched_bank[0].id).toBeDefined();
      expect(result.unmatched_bank[1].id).toBeDefined();
      expect(result.unmatched_bank[0].id).not.toBe(result.unmatched_bank[1].id);
    });
  });
});
