import { describe, expect, test } from 'vitest';
import {
  calculateMatchScore,
  findMatches,
  groupTransactionsByAmount,
  matchDuplicateAmounts,
} from '../../compareTransactions/matcher.js';
import { BankTransaction, YNABTransaction } from '../../compareTransactions/types.js';

// Helper functions to create test transactions
function createBankTransaction(
  date: string,
  amount: number,
  description: string,
  rowNumber: number = 1,
): BankTransaction {
  return {
    date: new Date(date),
    amount,
    description,
    raw_amount: (amount / 1000).toString(),
    raw_date: date,
    row_number: rowNumber,
  };
}

function createYNABTransaction(
  id: string,
  date: string,
  amount: number,
  payeeName?: string,
  memo?: string,
): YNABTransaction {
  return {
    id,
    date: new Date(date),
    amount,
    payee_name: payeeName || null,
    memo: memo || null,
    cleared: 'cleared',
    original: {} as any, // Mock original transaction
  };
}

describe('matcher', () => {
  describe('calculateMatchScore', () => {
    test('should give perfect score for exact matches', () => {
      const bankTxn = createBankTransaction('2023-09-15', 123450, 'Test Transaction');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-15', 123450, 'Test Transaction');

      const { score, reasons } = calculateMatchScore(bankTxn, ynabTxn, 0.01, 5);

      expect(score).toBe(100); // 40 (date) + 50 (amount) + 10 (description)
      expect(reasons).toContain('Exact date match');
      expect(reasons).toContain('Exact amount match');
      expect(reasons).toContain('Payee name similarity');
    });

    test('should score date differences correctly', () => {
      const bankTxn = createBankTransaction('2023-09-15', 123450, 'Test');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-16', 123450); // 1 day diff

      const { score, reasons } = calculateMatchScore(bankTxn, ynabTxn, 0.01, 5);

      expect(score).toBe(80); // 30 (reduced date score) + 50 (exact amount)
      expect(reasons).toContain('Date within 1.0 days');
      expect(reasons).toContain('Exact amount match');
    });

    test('should score amount differences correctly', () => {
      const bankTxn = createBankTransaction('2023-09-15', 100000, 'Test'); // $100.00
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-15', 101000); // $101.00 (1% diff)

      const { score, reasons } = calculateMatchScore(bankTxn, ynabTxn, 0.02, 5);

      expect(score).toBe(80); // 40 (exact date) + 40 (reduced amount score: 50 - 1% * 1000 = 40)
      expect(reasons).toContain('Exact date match');
      expect(reasons).toContain('Amount within 1.00% tolerance');
    });

    test('should not match when differences exceed tolerance', () => {
      const bankTxn = createBankTransaction('2023-09-15', 100000, 'Test');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-25', 100000); // 10 days diff

      const { score } = calculateMatchScore(bankTxn, ynabTxn, 0.01, 5);

      expect(score).toBe(50); // Only amount match, no date match (outside tolerance)
    });

    test('should handle memo similarity', () => {
      const bankTxn = createBankTransaction('2023-09-15', 123450, 'Coffee Shop');
      const ynabTxn = createYNABTransaction(
        'ynab1',
        '2023-09-15',
        123450,
        'Starbucks',
        'Coffee Shop Purchase',
      );

      const { score, reasons } = calculateMatchScore(bankTxn, ynabTxn, 0.01, 5);

      expect(score).toBe(95); // 40 + 50 + 5 (memo similarity, not payee)
      expect(reasons).toContain('Memo similarity');
    });

    test('should handle zero amounts', () => {
      const bankTxn = createBankTransaction('2023-09-15', 0, 'Test');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-15', 0);

      const { score, reasons } = calculateMatchScore(bankTxn, ynabTxn, 0.01, 5);

      expect(score).toBe(90); // 40 (date) + 50 (amount)
      expect(reasons).toContain('Exact amount match');
    });

    test('should handle empty descriptions gracefully', () => {
      const bankTxn = createBankTransaction('2023-09-15', 123450, '');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-15', 123450);

      const { score } = calculateMatchScore(bankTxn, ynabTxn, 0.01, 5);

      expect(score).toBe(90); // 40 + 50, no description bonus
    });
  });

  describe('groupTransactionsByAmount', () => {
    test('should group transactions by amount', () => {
      const transactions = [
        createBankTransaction('2023-09-15', 123450, 'Test 1'),
        createBankTransaction('2023-09-16', 123450, 'Test 2'), // Same amount
        createBankTransaction('2023-09-17', 67890, 'Test 3'), // Different amount
      ];

      const groups = groupTransactionsByAmount(transactions);

      expect(groups.size).toBe(2);
      expect(groups.get(123450)).toHaveLength(2);
      expect(groups.get(67890)).toHaveLength(1);
    });

    test('should handle mixed transaction types', () => {
      const transactions = [
        createBankTransaction('2023-09-15', 123450, 'Bank'),
        createYNABTransaction('ynab1', '2023-09-15', 123450, 'YNAB'),
      ];

      const groups = groupTransactionsByAmount(transactions);

      expect(groups.size).toBe(1);
      expect(groups.get(123450)).toHaveLength(2);
    });

    test('should handle empty transaction list', () => {
      const groups = groupTransactionsByAmount([]);

      expect(groups.size).toBe(0);
    });
  });

  describe('matchDuplicateAmounts', () => {
    test('should match duplicates chronologically', () => {
      const bankTxns = [
        createBankTransaction('2023-09-15', 123450, 'First'),
        createBankTransaction('2023-09-17', 123450, 'Second'),
      ];
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-09-14', 123450, 'First YNAB'), // Close to first
        createYNABTransaction('ynab2', '2023-09-18', 123450, 'Second YNAB'), // Close to second
      ];

      const matches = matchDuplicateAmounts(bankTxns, ynabTxns, 123450, 0.01, 5);

      expect(matches).toHaveLength(2);
      expect(matches[0].bank_transaction.description).toBe('First');
      expect(matches[0].ynab_transaction.id).toBe('ynab1');
      expect(matches[1].bank_transaction.description).toBe('Second');
      expect(matches[1].ynab_transaction.id).toBe('ynab2');
    });

    test('should give chronology bonus for close dates', () => {
      const bankTxns = [createBankTransaction('2023-09-15', 123450, 'Test')];
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-09-15', 123450), // Same day (15 point bonus)
        createYNABTransaction('ynab2', '2023-09-20', 123450), // 5 days later (no bonus)
      ];

      const matches = matchDuplicateAmounts(bankTxns, ynabTxns, 123450, 0.01, 5, true);

      expect(matches).toHaveLength(1);
      expect(matches[0].ynab_transaction.id).toBe('ynab1'); // Should pick the closer date
      expect(matches[0].match_reasons).toContain('Chronological order bonus (+15)');
    });

    test('should handle partial matches (more bank than YNAB)', () => {
      const bankTxns = [
        createBankTransaction('2023-09-15', 123450, 'First'),
        createBankTransaction('2023-09-16', 123450, 'Second'),
        createBankTransaction('2023-09-17', 123450, 'Third'),
      ];
      const ynabTxns = [createYNABTransaction('ynab1', '2023-09-15', 123450)];

      const matches = matchDuplicateAmounts(bankTxns, ynabTxns, 123450, 0.01, 5);

      expect(matches).toHaveLength(1); // Only one YNAB transaction available
    });

    test('should not reuse matched transactions', () => {
      const bankTxns = [
        createBankTransaction('2023-09-15', 123450, 'First'),
        createBankTransaction('2023-09-16', 123450, 'Second'),
      ];
      const ynabTxns = [createYNABTransaction('ynab1', '2023-09-15', 123450)];

      const matches = matchDuplicateAmounts(bankTxns, ynabTxns, 123450, 0.01, 5);

      expect(matches).toHaveLength(1);
      // Verify that the YNAB transaction is only used once
      const usedYnabIds = matches.map((m) => m.ynab_transaction.id);
      expect(new Set(usedYnabIds).size).toBe(usedYnabIds.length);
    });

    test('should respect minimum score threshold', () => {
      const bankTxns = [createBankTransaction('2023-09-15', 123450, 'Test')];
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-10-15', 123450), // 30 days later, low score
      ];

      const matches = matchDuplicateAmounts(bankTxns, ynabTxns, 123450, 0.01, 5);

      expect(matches).toHaveLength(1); // Matches due to exact amount (50 points) exceeding 30 threshold
    });
  });

  describe('findMatches', () => {
    test('should find simple one-to-one matches', () => {
      const bankTxns = [
        createBankTransaction('2023-09-15', 123450, 'Test 1'),
        createBankTransaction('2023-09-16', 67890, 'Test 2'),
      ];
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-09-15', 123450, 'Test 1'),
        createYNABTransaction('ynab2', '2023-09-16', 67890, 'Test 2'),
      ];

      const { matches, unmatched_bank, unmatched_ynab } = findMatches(bankTxns, ynabTxns, 0.01, 5);

      expect(matches).toHaveLength(2);
      expect(unmatched_bank).toHaveLength(0);
      expect(unmatched_ynab).toHaveLength(0);
    });

    test('should handle unmatched transactions', () => {
      const bankTxns = [
        createBankTransaction('2023-09-10', 123450, 'Bank Only'), // Moved further away from any YNAB dates
        createBankTransaction('2023-09-16', 67890, 'Matched'),
      ];
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-09-16', 67890, 'Matched'),
        createYNABTransaction('ynab2', '2023-09-25', 99999, 'YNAB Only'),
      ];

      const { matches, unmatched_bank, unmatched_ynab } = findMatches(bankTxns, ynabTxns, 0.01, 5);

      expect(matches).toHaveLength(1);
      expect(unmatched_bank).toHaveLength(1);
      expect(unmatched_ynab).toHaveLength(1);
      // The exact match may vary based on algorithm, but we should have proper separation
      expect(matches[0].bank_transaction.description).toBe('Matched');
      expect(matches[0].ynab_transaction.payee_name).toBe('Matched');
    });

    test('should handle duplicate amounts with special logic', () => {
      const bankTxns = [
        createBankTransaction('2023-09-15', 123450, 'Duplicate 1'),
        createBankTransaction('2023-09-17', 123450, 'Duplicate 2'),
        createBankTransaction('2023-09-18', 67890, 'Unique'),
      ];
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-09-14', 123450, 'YNAB Dup 1'),
        createYNABTransaction('ynab2', '2023-09-18', 123450, 'YNAB Dup 2'),
        createYNABTransaction('ynab3', '2023-09-18', 67890, 'YNAB Unique'),
      ];

      const { matches, unmatched_bank, unmatched_ynab } = findMatches(bankTxns, ynabTxns, 0.01, 5);

      expect(matches).toHaveLength(3);
      expect(unmatched_bank).toHaveLength(0);
      expect(unmatched_ynab).toHaveLength(0);

      // Verify that duplicates are handled with chronological matching
      const duplicateMatches = matches.filter((m) => m.bank_transaction.amount === 123450);
      expect(duplicateMatches).toHaveLength(2);
    });

    test('should respect minimum score threshold', () => {
      const bankTxns = [createBankTransaction('2023-09-15', 123450, 'Test')];
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-10-15', 67890), // Different amount and far date
      ];

      const { matches, unmatched_bank, unmatched_ynab } = findMatches(bankTxns, ynabTxns, 0.01, 5);

      expect(matches).toHaveLength(0);
      expect(unmatched_bank).toHaveLength(1);
      expect(unmatched_ynab).toHaveLength(1);
    });

    test('should not reuse transactions', () => {
      const bankTxns = [
        createBankTransaction('2023-09-15', 123450, 'Test 1'),
        createBankTransaction('2023-09-16', 123460, 'Test 2'), // Very close amount
      ];
      const ynabTxns = [createYNABTransaction('ynab1', '2023-09-15', 123450)];

      const { matches, unmatched_bank, unmatched_ynab } = findMatches(bankTxns, ynabTxns, 0.01, 5);

      expect(matches).toHaveLength(1); // Only one match possible
      expect(unmatched_bank).toHaveLength(1);
      expect(unmatched_ynab).toHaveLength(0);
    });

    test('should handle empty transaction lists', () => {
      const { matches, unmatched_bank, unmatched_ynab } = findMatches([], [], 0.01, 5);

      expect(matches).toHaveLength(0);
      expect(unmatched_bank).toHaveLength(0);
      expect(unmatched_ynab).toHaveLength(0);
    });

    test('should handle large datasets efficiently', () => {
      // Create larger datasets to test performance
      const bankTxns = Array.from({ length: 50 }, (_, i) =>
        createBankTransaction(`2023-09-${String(i + 1).padStart(2, '0')}`, i * 1000, `Bank ${i}`),
      );
      const ynabTxns = Array.from({ length: 50 }, (_, i) =>
        createYNABTransaction(
          `ynab${i}`,
          `2023-09-${String(i + 1).padStart(2, '0')}`,
          i * 1000,
          `YNAB ${i}`,
        ),
      );

      const start = Date.now();
      const { matches } = findMatches(bankTxns, ynabTxns, 0.01, 5);
      const duration = Date.now() - start;

      expect(matches).toHaveLength(50); // Should match all
      expect(duration).toBeLessThan(1000); // Should complete quickly
    });

    test('should handle negative amounts correctly', () => {
      const bankTxns = [createBankTransaction('2023-09-15', -123450, 'Debit Transaction')];
      const ynabTxns = [createYNABTransaction('ynab1', '2023-09-15', -123450, 'Credit Payment')];

      const { matches } = findMatches(bankTxns, ynabTxns, 0.01, 5);

      expect(matches).toHaveLength(1);
      expect(matches[0].bank_transaction.amount).toBe(-123450);
      expect(matches[0].ynab_transaction.amount).toBe(-123450);
    });

    test('should demonstrate parity mode (legacy behavior) vs enhanced mode with chronology bonus', () => {
      const bankTxns = [
        createBankTransaction('2023-09-15', 123450, 'Duplicate 1'),
        createBankTransaction('2023-09-17', 123450, 'Duplicate 2'),
      ];
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-09-20', 123450, 'Far YNAB 1'), // 5 days from first, 3 days from second
        createYNABTransaction('ynab2', '2023-09-14', 123450, 'Close YNAB 2'), // 1 day from first, 3 days from second
      ];

      // Legacy mode (parity mode) - no chronology bonus
      const legacyResults = findMatches(bankTxns, ynabTxns, 0.01, 5, false);

      // Enhanced mode - with chronology bonus
      const enhancedResults = findMatches(bankTxns, ynabTxns, 0.01, 5, true);

      expect(legacyResults.matches).toHaveLength(2);
      expect(enhancedResults.matches).toHaveLength(2);

      // In enhanced mode, chronology bonus should affect matching preferences
      const enhancedMatch1 = enhancedResults.matches.find(
        (m) => m.bank_transaction.description === 'Duplicate 1',
      );
      expect(enhancedMatch1?.match_reasons).toContain('Chronological order bonus (+15)');
    });

    test('should preserve legacy behavior when chronology bonus is disabled', () => {
      const bankTxns = [createBankTransaction('2023-09-15', 123450, 'Test')];
      const ynabTxns = [createYNABTransaction('ynab1', '2023-09-15', 123450, 'Close Match')];

      const { matches } = findMatches(bankTxns, ynabTxns, 0.01, 5, false);

      expect(matches).toHaveLength(1);
      expect(matches[0].match_reasons).not.toContain('Chronological order bonus');
    });

    test('should apply chronology bonus when enabled for duplicate amounts', () => {
      const bankTxns = [createBankTransaction('2023-09-15', 123450, 'Test')];
      const ynabTxns = [createYNABTransaction('ynab1', '2023-09-15', 123450, 'Same Day Match')];

      const { matches } = findMatches(bankTxns, ynabTxns, 0.01, 5, true);

      expect(matches).toHaveLength(1);
      // Note: chronology bonus is only applied to duplicate amounts, so this single transaction won't get the bonus
      expect(matches[0].match_reasons).not.toContain('Chronological order bonus');
    });
  });
});
