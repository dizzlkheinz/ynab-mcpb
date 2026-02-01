import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionDetail } from 'ynab';
import { analyzeReconciliation } from '../../analyzer.js';
import * as csvParser from '../../csvParser.js';

vi.mock('../../csvParser.js', () => ({
  parseCSV: vi.fn(),
}));

describe('scenario: zero, negative, and large statements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles zero and negative statement balances with mixed unmatched items', () => {
    vi.mocked(csvParser.parseCSV).mockReturnValue({
      transactions: [
        {
          id: 'b1',
          date: '2025-11-01',
          amount: 0,
          payee: 'Zero Adjustment',
          memo: '',
          sourceRow: 2,
          raw: { date: '2025-11-01', amount: '0', description: 'Zero Adjustment' },
        },
        {
          id: 'b2',
          date: '2025-11-02',
          amount: 2500000,
          payee: 'Interest',
          memo: '',
          sourceRow: 3,
          raw: { date: '2025-11-02', amount: '2500.00', description: 'Interest' },
        },
      ],
      errors: [],
      warnings: [],
      meta: {
        detectedDelimiter: ',',
        detectedColumns: ['Date', 'Description', 'Amount'],
        totalRows: 2,
        validRows: 2,
        skippedRows: 0,
      },
    });

    const ynabTxns: TransactionDetail[] = [
      {
        id: 'yn-neg',
        date: '2025-10-31',
        amount: -1000000,
        payee_name: 'Mortgage',
        category_name: 'Housing',
        cleared: 'cleared',
        approved: true,
      } as TransactionDetail,
    ];

    const result = analyzeReconciliation('csv', undefined, ynabTxns, 0);

    expect(result.summary.unmatched_bank).toBeGreaterThan(0);
    // The YNAB transaction from Oct 31 is within the 7-day tolerance buffer
    // of the statement period (Nov 1-2), so it's included for matching.
    // Since it doesn't match any bank transactions, it goes to unmatched_ynab.
    expect(result.summary.ynab_in_range_count).toBe(1);
    expect(result.summary.unmatched_ynab).toBe(1);
    expect(result.balance_info.discrepancy).not.toBeNaN();
  });
});
