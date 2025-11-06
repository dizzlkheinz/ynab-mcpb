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
        { date: '2025-10-20', amount: -22.22, payee: 'RideShare', memo: '' },
        { date: '2025-10-21', amount: -22.22, payee: 'RideShare', memo: '' },
        { date: '2025-10-23', amount: -15.0, payee: 'Cafe', memo: '' },
      ],
      format_detected: 'standard',
      delimiter: ',',
      total_rows: 3,
      valid_rows: 3,
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

    const result = analyzeReconciliation('csv', undefined, ynabTxns, -59.44);

    const repeatInsight = result.insights.find((insight) => insight.id.startsWith('repeat-22.22'));
    expect(repeatInsight).toBeDefined();
    expect(repeatInsight?.severity).toBe('warning');
    expect(result.summary.unmatched_bank).toBeGreaterThan(0);
  });
});
