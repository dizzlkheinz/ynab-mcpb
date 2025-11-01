import { describe, it, expect, beforeEach } from 'vitest';
import { findBestMatch, findMatches } from '../matcher.js';
import type {
  BankTransaction,
  YNABTransaction,
  MatchingConfig,
} from '../types.js';

describe('matcher', () => {
  let config: MatchingConfig;

  beforeEach(() => {
    config = {
      dateToleranceDays: 2,
      amountToleranceCents: 1,
      descriptionSimilarityThreshold: 0.8,
      autoMatchThreshold: 90,
      suggestionThreshold: 60,
    };
  });

  describe('findBestMatch', () => {
    describe('high confidence matches (≥90%)', () => {
      it('should return high confidence for exact match', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -45.23,
          payee: 'Shell Gas Station',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-15',
            amount: -45230, // milliunits
            payee_name: 'Shell Gas Station',
            category_name: 'Auto: Gas',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        expect(match.confidence).toBe('high');
        expect(match.confidence_score).toBeGreaterThanOrEqual(90);
        expect(match.ynab_transaction).toEqual(ynabTxns[0]);
      });

      it('should return high confidence for normalized payee match', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -100.00,
          payee: 'NETFLIX.COM',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-15',
            amount: -100000,
            payee_name: 'Netflix Com',
            category_name: 'Entertainment',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        expect(match.confidence).toBe('high');
        expect(match.confidence_score).toBeGreaterThanOrEqual(90);
      });

      it('should handle date within tolerance', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -50.00,
          payee: 'Restaurant',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-14', // 1 day difference
            amount: -50000,
            payee_name: 'Restaurant',
            category_name: 'Dining',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        expect(match.confidence).toBe('high');
        expect(match.confidence_score).toBeGreaterThanOrEqual(90);
      });
    });

    describe('medium confidence matches (60-89%)', () => {
      it('should return medium confidence for fuzzy payee match', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-20',
          amount: -127.43,
          payee: 'AMAZON.COM',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-20',
            amount: -127430,
            payee_name: 'Amazon Prime',
            category_name: 'Shopping',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        expect(match.confidence).toBe('medium');
        expect(match.confidence_score).toBeGreaterThanOrEqual(60);
        expect(match.confidence_score).toBeLessThan(90);
        expect(match.candidates).toBeDefined();
        expect(match.candidates!.length).toBeGreaterThan(0);
      });

      it('should provide multiple candidates for medium confidence', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -50.00,
          payee: 'Restaurant',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-15',
            amount: -50000,
            payee_name: 'Italian Restaurant',
            category_name: 'Dining',
            cleared: 'uncleared',
            approved: true,
          },
          {
            id: 'y2',
            date: '2025-10-16',
            amount: -50000,
            payee_name: 'Chinese Restaurant',
            category_name: 'Dining',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        expect(match.candidates).toBeDefined();
        expect(match.candidates!.length).toBeGreaterThan(0);
        expect(match.candidates!.length).toBeLessThanOrEqual(3); // Top 3
      });
    });

    describe('low/no confidence matches', () => {
      it('should return no match when amount differs', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -45.23,
          payee: 'Shell',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-15',
            amount: -100000, // Different amount
            payee_name: 'Shell',
            category_name: 'Auto: Gas',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        expect(match.confidence).toBe('none');
        expect(match.confidence_score).toBe(0);
        expect(match.action_hint).toBe('add_to_ynab');
      });

      it('should not match opposite-signed transactions', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: 50.00, // Positive (refund)
          payee: 'Amazon',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-15',
            amount: -50000, // Negative (purchase)
            payee_name: 'Amazon',
            category_name: 'Shopping',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        expect(match.confidence).toBe('none');
        expect(match.ynab_transaction).toBeUndefined();
      });
    });

    describe('prioritization', () => {
      it('should prioritize uncleared transactions over cleared', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -50.00,
          payee: 'Coffee Shop',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-15',
            amount: -50000,
            payee_name: 'Coffee Shop',
            category_name: 'Dining',
            cleared: 'cleared',
            approved: true,
          },
          {
            id: 'y2',
            date: '2025-10-15',
            amount: -50000,
            payee_name: 'Coffee Shop',
            category_name: 'Dining',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        // Should prefer uncleared transaction
        expect(match.ynab_transaction?.id).toBe('y2');
      });

      it('should use date proximity as tiebreaker', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -50.00,
          payee: 'Store',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-13', // 2 days away
            amount: -50000,
            payee_name: 'Store',
            category_name: 'Shopping',
            cleared: 'uncleared',
            approved: true,
          },
          {
            id: 'y2',
            date: '2025-10-14', // 1 day away
            amount: -50000,
            payee_name: 'Store',
            category_name: 'Shopping',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        // Should prefer closer date
        expect(match.ynab_transaction?.id).toBe('y2');
      });
    });

    describe('amount tolerance', () => {
      it('should match within amount tolerance', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -45.23,
          payee: 'Shell',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-15',
            amount: -45240, // $45.24 - within 1 cent tolerance
            payee_name: 'Shell',
            category_name: 'Auto: Gas',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        expect(match.confidence).not.toBe('none');
        expect(match.ynab_transaction).toBeDefined();
      });

      it('should not match outside amount tolerance', () => {
        config.amountToleranceCents = 1;

        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -45.00,
          payee: 'Shell',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-15',
            amount: -45050, // $45.05 - outside 1 cent tolerance
            payee_name: 'Shell',
            category_name: 'Auto: Gas',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

        expect(match.confidence).toBe('none');
      });
    });

    describe('used IDs', () => {
      it('should skip already-used YNAB transaction IDs', () => {
        const bankTxn: BankTransaction = {
          id: 'b1',
          date: '2025-10-15',
          amount: -50.00,
          payee: 'Store',
          original_csv_row: 2,
        };

        const ynabTxns: YNABTransaction[] = [
          {
            id: 'y1',
            date: '2025-10-15',
            amount: -50000,
            payee_name: 'Store',
            category_name: 'Shopping',
            cleared: 'uncleared',
            approved: true,
          },
        ];

        const usedIds = new Set(['y1']);
        const match = findBestMatch(bankTxn, ynabTxns, usedIds, config);

        expect(match.confidence).toBe('none');
        expect(match.ynab_transaction).toBeUndefined();
      });
    });
  });

  describe('findMatches', () => {
    it('should match multiple bank transactions', () => {
      const bankTxns: BankTransaction[] = [
        {
          id: 'b1',
          date: '2025-10-15',
          amount: -45.23,
          payee: 'Shell',
          original_csv_row: 2,
        },
        {
          id: 'b2',
          date: '2025-10-16',
          amount: -100.00,
          payee: 'Netflix',
          original_csv_row: 3,
        },
      ];

      const ynabTxns: YNABTransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -45230,
          payee_name: 'Shell Gas',
          category_name: 'Auto: Gas',
          cleared: 'uncleared',
          approved: true,
        },
        {
          id: 'y2',
          date: '2025-10-16',
          amount: -100000,
          payee_name: 'Netflix',
          category_name: 'Entertainment',
          cleared: 'uncleared',
          approved: true,
        },
      ];

      const matches = findMatches(bankTxns, ynabTxns, config);

      expect(matches).toHaveLength(2);
      expect(matches[0].bank_transaction.id).toBe('b1');
      expect(matches[1].bank_transaction.id).toBe('b2');
    });

    it('should prevent duplicate matching of YNAB transactions', () => {
      const bankTxns: BankTransaction[] = [
        {
          id: 'b1',
          date: '2025-10-15',
          amount: -50.00,
          payee: 'Store',
          original_csv_row: 2,
        },
        {
          id: 'b2',
          date: '2025-10-15',
          amount: -50.00,
          payee: 'Store',
          original_csv_row: 3,
        },
      ];

      const ynabTxns: YNABTransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -50000,
          payee_name: 'Store',
          category_name: 'Shopping',
          cleared: 'uncleared',
          approved: true,
        },
      ];

      const matches = findMatches(bankTxns, ynabTxns, config);

      expect(matches).toHaveLength(2);

      // First should match
      expect(matches[0].confidence).toBe('high');
      expect(matches[0].ynab_transaction?.id).toBe('y1');

      // Second should not match (y1 already used)
      expect(matches[1].confidence).toBe('none');
    });

    it('should handle mix of matched and unmatched transactions', () => {
      const bankTxns: BankTransaction[] = [
        {
          id: 'b1',
          date: '2025-10-15',
          amount: -45.23,
          payee: 'Shell',
          original_csv_row: 2,
        },
        {
          id: 'b2',
          date: '2025-10-16',
          amount: -15.99,
          payee: 'NewStore',
          original_csv_row: 3,
        },
      ];

      const ynabTxns: YNABTransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -45230,
          payee_name: 'Shell',
          category_name: 'Auto: Gas',
          cleared: 'uncleared',
          approved: true,
        },
      ];

      const matches = findMatches(bankTxns, ynabTxns, config);

      expect(matches).toHaveLength(2);
      expect(matches[0].confidence).toBe('high');
      expect(matches[1].confidence).toBe('none');
      expect(matches[1].action_hint).toBe('add_to_ynab');
    });

    it('should use custom configuration', () => {
      const customConfig: MatchingConfig = {
        dateToleranceDays: 5,
        amountToleranceCents: 10,
        descriptionSimilarityThreshold: 0.6,
        autoMatchThreshold: 85,
        suggestionThreshold: 50,
      };

      const bankTxns: BankTransaction[] = [
        {
          id: 'b1',
          date: '2025-10-15',
          amount: -50.00,
          payee: 'Store',
          original_csv_row: 2,
        },
      ];

      const ynabTxns: YNABTransaction[] = [
        {
          id: 'y1',
          date: '2025-10-11', // 4 days difference (within custom tolerance)
          amount: -50090, // $50.09 (within custom tolerance)
          payee_name: 'Store',
          category_name: 'Shopping',
          cleared: 'uncleared',
          approved: true,
        },
      ];

      const matches = findMatches(bankTxns, ynabTxns, customConfig);

      expect(matches[0].confidence).not.toBe('none');
    });
  });

  describe('edge cases', () => {
    it('should handle empty YNAB transactions list', () => {
      const bankTxn: BankTransaction = {
        id: 'b1',
        date: '2025-10-15',
        amount: -50.00,
        payee: 'Store',
        original_csv_row: 2,
      };

      const match = findBestMatch(bankTxn, [], new Set(), config);

      expect(match.confidence).toBe('none');
      expect(match.recommendation).toContain('not in YNAB');
    });

    it('should handle null payee names', () => {
      const bankTxn: BankTransaction = {
        id: 'b1',
        date: '2025-10-15',
        amount: -50.00,
        payee: 'Store',
        original_csv_row: 2,
      };

      const ynabTxns: YNABTransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -50000,
          payee_name: null,
          category_name: 'Shopping',
          cleared: 'uncleared',
          approved: true,
        },
      ];

      const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

      // Should still match based on amount and date
      expect(match.confidence).not.toBe('none');
    });

    it('should handle very small amounts', () => {
      const bankTxn: BankTransaction = {
        id: 'b1',
        date: '2025-10-15',
        amount: -0.01,
        payee: 'Micro Transaction',
        original_csv_row: 2,
      };

      const ynabTxns: YNABTransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -10, // 1 cent in milliunits
          payee_name: 'Micro Transaction',
          category_name: 'Misc',
          cleared: 'uncleared',
          approved: true,
        },
      ];

      const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

      expect(match.confidence).toBe('high');
    });

    it('should handle large amounts', () => {
      const bankTxn: BankTransaction = {
        id: 'b1',
        date: '2025-10-15',
        amount: -10000.00,
        payee: 'Large Purchase',
        original_csv_row: 2,
      };

      const ynabTxns: YNABTransaction[] = [
        {
          id: 'y1',
          date: '2025-10-15',
          amount: -10000000, // $10,000 in milliunits
          payee_name: 'Large Purchase',
          category_name: 'Shopping',
          cleared: 'uncleared',
          approved: true,
        },
      ];

      const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

      expect(match.confidence).toBe('high');
    });
  });
});
