import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeReconciliation } from '../../analyzer.js';
import type { TransactionDetail } from 'ynab';
import * as parser from '../../../compareTransactions/parser.js';

vi.mock('../../../compareTransactions/parser.js', () => ({
  parseBankCSV: vi.fn(),
  readCSVFile: vi.fn(),
}));

describe('scenario: zero, negative, and large statements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles zero and negative statement balances with mixed unmatched items', () => {
    vi.mocked(parser.parseBankCSV).mockReturnValue({
      transactions: [
        { date: '2025-11-01', amount: 0, payee: 'Zero Adjustment', memo: '' },
        { date: '2025-11-02', amount: 2500, payee: 'Interest', memo: '' },
      ],
      format_detected: 'standard',
      delimiter: ',',
      total_rows: 2,
      valid_rows: 2,
      errors: [],
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
    expect(result.summary.unmatched_ynab).toBeGreaterThan(0);
    expect(result.balance_info.discrepancy).not.toBeNaN();
  });
});
