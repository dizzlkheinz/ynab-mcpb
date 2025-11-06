import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeReconciliation } from '../../analyzer.js';
import type { TransactionDetail } from 'ynab';
import * as parser from '../../../compareTransactions/parser.js';

vi.mock('../../../compareTransactions/parser.js', () => ({
  parseBankCSV: vi.fn(),
  readCSVFile: vi.fn(),
}));

describe('scenario: repeat amount collisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prioritizes repeat-amount insight when multiple bank rows share totals', () => {
    vi.mocked(parser.parseBankCSV).mockReturnValue({
      transactions: [
        // Three -22.22 transactions: one will match YNAB, two will remain unmatched
        { date: '2025-10-20', amount: -22.22, payee: 'RideShare', memo: '' },
        { date: '2025-10-21', amount: -22.22, payee: 'RideShare', memo: '' },
        { date: '2025-10-25', amount: -22.22, payee: 'RideShare', memo: '' },
        { date: '2025-10-23', amount: -15.0, payee: 'Cafe', memo: '' },
      ],
      format_detected: 'standard',
      delimiter: ',',
      total_rows: 4,
      valid_rows: 4,
      errors: [],
    });

    const ynabTxns: TransactionDetail[] = [
      {
        id: 'yn-1',
        date: '2025-10-19',
        amount: -22220,
        payee_name: 'RideShare',
        category_name: 'Transport',
        cleared: 'uncleared',
        approved: true,
      } as TransactionDetail,
      {
        id: 'yn-2',
        date: '2025-10-22',
        amount: -15000,
        payee_name: 'Cafe',
        category_name: 'Dining',
        cleared: 'uncleared',
        approved: true,
      } as TransactionDetail,
    ];

    // Statement balance now accounts for 3 x -22.22 + 1 x -15.00 = -81.66
    const result = analyzeReconciliation('csv', undefined, ynabTxns, -81.66);

    const repeatInsight = result.insights.find((insight) => insight.id.startsWith('repeat--22.22')); // Note: double dash for negative
    expect(repeatInsight).toBeDefined();
    expect(repeatInsight?.severity).toBe('warning');
    expect(result.summary.unmatched_bank).toBeGreaterThan(0);
  });
});
