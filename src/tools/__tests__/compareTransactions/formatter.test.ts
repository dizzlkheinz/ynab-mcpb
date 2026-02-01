import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as ynab from 'ynab';
import { responseFormatter } from '../../../server/responseFormatter.js';
import {
  buildComparisonResult,
  buildSummary,
  findSuggestedPayee,
  formatMatches,
  formatUnmatchedBank,
  formatUnmatchedYNAB,
} from '../../compareTransactions/formatter.js';
import {
  BankTransaction,
  TransactionMatch,
  YNABTransaction,
} from '../../compareTransactions/types.js';

// Mock responseFormatter
vi.mock('../../../server/responseFormatter.js', () => ({
  responseFormatter: {
    format: vi.fn((data) => JSON.stringify(data, null, 2)),
  },
}));

const mockResponseFormatter = vi.mocked(responseFormatter);

// Helper functions to create test data
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
    original: {} as any,
  };
}

function createTransactionMatch(
  bankTxn: BankTransaction,
  ynabTxn: YNABTransaction,
  score: number = 90,
  reasons: string[] = ['Test match'],
): TransactionMatch {
  return {
    bank_transaction: bankTxn,
    ynab_transaction: ynabTxn,
    match_score: score,
    match_reasons: reasons,
  };
}

function createPayee(id: string, name: string): ynab.Payee {
  return {
    id,
    name,
    transfer_account_id: null,
    deleted: false,
  };
}

describe('formatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findSuggestedPayee', () => {
    const payees = [
      createPayee('payee1', 'Starbucks'),
      createPayee('payee2', 'Amazon'),
      createPayee('payee3', 'Grocery Store'),
    ];

    test('should find exact payee name match', () => {
      const result = findSuggestedPayee('Starbucks Coffee', payees);

      expect(result.suggested_payee_id).toBe('payee1');
      expect(result.suggested_payee_name).toBe('Starbucks');
      expect(result.suggestion_reason).toBe("Matched payee 'Starbucks' in description.");
    });

    test('should find partial payee name match', () => {
      const result = findSuggestedPayee('Purchase from Amazon.com', payees);

      expect(result.suggested_payee_id).toBe('payee2');
      expect(result.suggested_payee_name).toBe('Amazon');
      expect(result.suggestion_reason).toBe("Matched payee 'Amazon' in description.");
    });

    test('should be case insensitive', () => {
      const result = findSuggestedPayee('STARBUCKS COFFEE', payees);

      expect(result.suggested_payee_id).toBe('payee1');
      expect(result.suggested_payee_name).toBe('Starbucks');
    });

    test('should suggest cleaned description when no payee matches', () => {
      const result = findSuggestedPayee('Local Coffee Shop 123', payees);

      expect(result.suggested_payee_id).toBeUndefined();
      expect(result.suggested_payee_name).toBe('Local Coffee Shop');
      expect(result.suggestion_reason).toBe(
        'No matching payee found. Suggested new payee name from description.',
      );
    });

    test('should handle empty description', () => {
      const result = findSuggestedPayee('', payees);

      expect(result).toEqual({});
    });

    test('should remove numbers and consolidate whitespace', () => {
      const result = findSuggestedPayee('Coffee   Shop    123   456', payees);

      expect(result.suggested_payee_name).toBe('Coffee Shop');
    });

    test('should handle description with only numbers', () => {
      const result = findSuggestedPayee('123456', payees);

      expect(result.suggested_payee_name).toBe('');
    });

    test('should find first matching payee when multiple matches', () => {
      const multiPayees = [createPayee('payee1', 'Coffee'), createPayee('payee2', 'Coffee Shop')];

      const result = findSuggestedPayee('Coffee Shop Purchase', multiPayees);

      expect(result.suggested_payee_id).toBe('payee1'); // First match wins
      expect(result.suggested_payee_name).toBe('Coffee');
    });
  });

  describe('buildSummary', () => {
    test('should build complete summary', () => {
      const bankTxns = [
        createBankTransaction('2023-09-15', 123450, 'Test 1'),
        createBankTransaction('2023-09-16', 67890, 'Test 2'),
      ];
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-09-15', 123450),
        createYNABTransaction('ynab2', '2023-09-16', 67890),
        createYNABTransaction('ynab3', '2023-09-17', 99999),
      ];
      const matches = [createTransactionMatch(bankTxns[0], ynabTxns[0])];
      const unmatchedBank = [bankTxns[1]];
      const unmatchedYnab = [ynabTxns[2]];
      const parameters = { amount_tolerance: 0.01, date_tolerance_days: 5 };
      const dateRange = { start: '2023-09-15', end: '2023-09-16' };

      const summary = buildSummary(
        bankTxns,
        ynabTxns,
        matches,
        unmatchedBank,
        unmatchedYnab,
        parameters,
        dateRange,
      );

      expect(summary.bank_transactions_count).toBe(2);
      expect(summary.ynab_transactions_count).toBe(3);
      expect(summary.matches_found).toBe(1);
      expect(summary.missing_in_ynab).toBe(1);
      expect(summary.missing_in_bank).toBe(1);
      expect(summary.date_range).toEqual(dateRange);
      expect(summary.parameters).toEqual(parameters);
    });

    test('should handle empty collections', () => {
      const summary = buildSummary([], [], [], [], [], {}, { start: '', end: '' });

      expect(summary.bank_transactions_count).toBe(0);
      expect(summary.ynab_transactions_count).toBe(0);
      expect(summary.matches_found).toBe(0);
      expect(summary.missing_in_ynab).toBe(0);
      expect(summary.missing_in_bank).toBe(0);
    });
  });

  describe('formatMatches', () => {
    test('should format matches correctly', () => {
      const bankTxn = createBankTransaction('2023-09-15', 123450, 'Test Transaction');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-15', 123450, 'Test Payee');
      const match = createTransactionMatch(bankTxn, ynabTxn, 95, ['Exact match', 'Perfect score']);

      const formatted = formatMatches([match]);

      expect(formatted).toHaveLength(1);
      expect(formatted[0]).toEqual({
        bank_date: '2023-09-15',
        bank_amount: '123.45',
        bank_description: 'Test Transaction',
        ynab_date: '2023-09-15',
        ynab_amount: '123.45',
        ynab_payee: 'Test Payee',
        ynab_transaction: {
          id: 'ynab1',
          cleared: 'cleared',
        },
        match_score: 95,
        match_reasons: ['Exact match', 'Perfect score'],
      });
    });

    test('should handle negative amounts', () => {
      const bankTxn = createBankTransaction('2023-09-15', -123450, 'Debit');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-15', -123450);
      const match = createTransactionMatch(bankTxn, ynabTxn);

      const formatted = formatMatches([match]);

      expect(formatted[0].bank_amount).toBe('-123.45');
      expect(formatted[0].ynab_amount).toBe('-123.45');
    });

    test('should handle null payee names', () => {
      const bankTxn = createBankTransaction('2023-09-15', 123450, 'Test');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-15', 123450);
      const match = createTransactionMatch(bankTxn, ynabTxn);

      const formatted = formatMatches([match]);

      expect(formatted[0].ynab_payee).toBeNull();
    });

    test('should handle large amounts', () => {
      const bankTxn = createBankTransaction('2023-09-15', 999999990, 'Large Transaction');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-15', 999999990);
      const match = createTransactionMatch(bankTxn, ynabTxn);

      const formatted = formatMatches([match]);

      expect(formatted[0].bank_amount).toBe('999999.99');
      expect(formatted[0].ynab_amount).toBe('999999.99');
    });

    test('should handle zero amounts', () => {
      const bankTxn = createBankTransaction('2023-09-15', 0, 'Zero Amount');
      const ynabTxn = createYNABTransaction('ynab1', '2023-09-15', 0);
      const match = createTransactionMatch(bankTxn, ynabTxn);

      const formatted = formatMatches([match]);

      expect(formatted[0].bank_amount).toBe('0.00');
      expect(formatted[0].ynab_amount).toBe('0.00');
    });

    test('should handle empty matches array', () => {
      const formatted = formatMatches([]);

      expect(formatted).toEqual([]);
    });
  });

  describe('formatUnmatchedBank', () => {
    const payees = [createPayee('payee1', 'Starbucks')];

    test('should format unmatched bank transactions with payee suggestions', () => {
      const bankTxns = [
        createBankTransaction('2023-09-15', 123450, 'Starbucks Coffee', 2),
        createBankTransaction('2023-09-16', 67890, 'Unknown Store', 3),
      ];

      const formatted = formatUnmatchedBank(bankTxns, payees);

      expect(formatted).toHaveLength(2);
      expect(formatted[0]).toEqual({
        date: '2023-09-15',
        amount: '123.45',
        description: 'Starbucks Coffee',
        row_number: 2,
        suggested_payee_id: 'payee1',
        suggested_payee_name: 'Starbucks',
        suggestion_reason: "Matched payee 'Starbucks' in description.",
      });
      expect(formatted[1]).toEqual({
        date: '2023-09-16',
        amount: '67.89',
        description: 'Unknown Store',
        row_number: 3,
        suggested_payee_name: 'Unknown Store',
        suggestion_reason: 'No matching payee found. Suggested new payee name from description.',
      });
    });

    test('should handle negative amounts', () => {
      const bankTxns = [createBankTransaction('2023-09-15', -123450, 'Refund', 1)];

      const formatted = formatUnmatchedBank(bankTxns, payees);

      expect(formatted[0].amount).toBe('-123.45');
    });

    test('should handle empty transactions array', () => {
      const formatted = formatUnmatchedBank([], payees);

      expect(formatted).toEqual([]);
    });
  });

  describe('formatUnmatchedYNAB', () => {
    test('should format unmatched YNAB transactions', () => {
      const ynabTxns = [
        createYNABTransaction('ynab1', '2023-09-15', 123450, 'Test Payee', 'Test Memo'),
        createYNABTransaction('ynab2', '2023-09-16', 67890, null, null),
      ];

      const formatted = formatUnmatchedYNAB(ynabTxns);

      expect(formatted).toHaveLength(2);
      expect(formatted[0]).toEqual({
        id: 'ynab1',
        date: '2023-09-15',
        amount: '123.45',
        payee_name: 'Test Payee',
        memo: 'Test Memo',
        cleared: 'cleared',
      });
      expect(formatted[1]).toEqual({
        id: 'ynab2',
        date: '2023-09-16',
        amount: '67.89',
        payee_name: null,
        memo: null,
        cleared: 'cleared',
      });
    });

    test('should handle negative amounts', () => {
      const ynabTxns = [createYNABTransaction('ynab1', '2023-09-15', -123450)];

      const formatted = formatUnmatchedYNAB(ynabTxns);

      expect(formatted[0].amount).toBe('-123.45');
    });

    test('should handle empty transactions array', () => {
      const formatted = formatUnmatchedYNAB([]);

      expect(formatted).toEqual([]);
    });
  });

  describe('buildComparisonResult', () => {
    test('should build complete comparison result', () => {
      const bankTxns = [createBankTransaction('2023-09-15', 123450, 'Test 1', 1)];
      const ynabTxns = [createYNABTransaction('ynab1', '2023-09-15', 123450, 'Test Payee')];
      const matches = [createTransactionMatch(bankTxns[0], ynabTxns[0])];
      const unmatchedBank = [createBankTransaction('2023-09-16', 67890, 'Unmatched', 2)];
      const unmatchedYnab = [createYNABTransaction('ynab2', '2023-09-17', 99999)];
      const payees = [createPayee('payee1', 'Test Payee')];
      const parameters = { amount_tolerance: 0.01, date_tolerance_days: 5 };
      const dateRange = { start: '2023-09-15', end: '2023-09-16' };

      const matchResults = {
        matches,
        unmatched_bank: unmatchedBank,
        unmatched_ynab: unmatchedYnab,
      };

      const result = buildComparisonResult(
        matchResults,
        bankTxns.concat(unmatchedBank),
        ynabTxns.concat(unmatchedYnab),
        payees,
        parameters,
        dateRange,
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(mockResponseFormatter.format).toHaveBeenCalledOnce();

      // Verify the structure passed to responseFormatter
      const formatterArg = mockResponseFormatter.format.mock.calls[0][0];
      expect(formatterArg).toHaveProperty('summary');
      expect(formatterArg).toHaveProperty('matches');
      expect(formatterArg).toHaveProperty('missing_in_ynab');
      expect(formatterArg).toHaveProperty('missing_in_bank');

      expect(formatterArg.summary.bank_transactions_count).toBe(2);
      expect(formatterArg.summary.ynab_transactions_count).toBe(2);
      expect(formatterArg.summary.matches_found).toBe(1);
      expect(formatterArg.matches).toHaveLength(1);
      expect(formatterArg.missing_in_ynab).toHaveLength(1);
      expect(formatterArg.missing_in_bank).toHaveLength(1);
    });

    test('should handle empty results', () => {
      const matchResults = {
        matches: [],
        unmatched_bank: [],
        unmatched_ynab: [],
      };

      const result = buildComparisonResult(matchResults, [], [], [], {}, { start: '', end: '' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const formatterArg = mockResponseFormatter.format.mock.calls[0][0];
      expect(formatterArg.summary.bank_transactions_count).toBe(0);
      expect(formatterArg.summary.ynab_transactions_count).toBe(0);
      expect(formatterArg.summary.matches_found).toBe(0);
      expect(formatterArg.matches).toEqual([]);
      expect(formatterArg.missing_in_ynab).toEqual([]);
      expect(formatterArg.missing_in_bank).toEqual([]);
    });

    test('should call responseFormatter.format with correct structure', () => {
      const bankTxns = [createBankTransaction('2023-09-15', 123450, 'Test', 1)];
      const ynabTxns = [createYNABTransaction('ynab1', '2023-09-15', 123450)];
      const matches = [createTransactionMatch(bankTxns[0], ynabTxns[0])];

      const matchResults = {
        matches,
        unmatched_bank: [],
        unmatched_ynab: [],
      };

      buildComparisonResult(matchResults, bankTxns, ynabTxns, [], {}, { start: '', end: '' });

      expect(mockResponseFormatter.format).toHaveBeenCalledWith({
        summary: expect.objectContaining({
          bank_transactions_count: 1,
          ynab_transactions_count: 1,
          matches_found: 1,
          missing_in_ynab: 0,
          missing_in_bank: 0,
        }),
        matches: expect.arrayContaining([
          expect.objectContaining({
            bank_date: '2023-09-15',
            bank_amount: '123.45',
            ynab_date: '2023-09-15',
            ynab_amount: '123.45',
          }),
        ]),
        missing_in_ynab: [],
        missing_in_bank: [],
      });
    });

    test('should return CallToolResult with correct format', () => {
      const mockFormattedText = 'Formatted comparison result';
      mockResponseFormatter.format.mockReturnValue(mockFormattedText);

      const matchResults = { matches: [], unmatched_bank: [], unmatched_ynab: [] };
      const result = buildComparisonResult(matchResults, [], [], [], {}, { start: '', end: '' });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: mockFormattedText,
          },
        ],
      });
    });
  });
});
