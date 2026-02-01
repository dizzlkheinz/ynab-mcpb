import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionDetail } from 'ynab';
import { analyzeReconciliation } from '../../analyzer.js';
import * as csvParser from '../../csvParser.js';

vi.mock('../../csvParser.js', () => ({
  parseCSV: vi.fn(),
}));

describe('scenario: repeat amount collisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prioritizes repeat-amount insight when multiple bank rows share totals', () => {
    vi.mocked(csvParser.parseCSV).mockReturnValue({
      transactions: [
        // Three -22.22 transactions in milliunits: one will match YNAB, two will remain unmatched
        {
          id: 'b1',
          date: '2025-10-20',
          amount: -22220,
          payee: 'RideShare',
          memo: '',
          sourceRow: 2,
          raw: { date: '2025-10-20', amount: '-22.22', description: 'RideShare' },
        },
        {
          id: 'b2',
          date: '2025-10-21',
          amount: -22220,
          payee: 'RideShare',
          memo: '',
          sourceRow: 3,
          raw: { date: '2025-10-21', amount: '-22.22', description: 'RideShare' },
        },
        {
          id: 'b3',
          date: '2025-10-25',
          amount: -22220,
          payee: 'RideShare',
          memo: '',
          sourceRow: 4,
          raw: { date: '2025-10-25', amount: '-22.22', description: 'RideShare' },
        },
        {
          id: 'b4',
          date: '2025-10-23',
          amount: -15000,
          payee: 'Cafe',
          memo: '',
          sourceRow: 5,
          raw: { date: '2025-10-23', amount: '-15.00', description: 'Cafe' },
        },
      ],
      errors: [],
      warnings: [],
      meta: {
        detectedDelimiter: ',',
        detectedColumns: ['Date', 'Description', 'Amount'],
        totalRows: 4,
        validRows: 4,
        skippedRows: 0,
      },
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

    const repeatInsight = result.insights.find((insight) => insight.id.startsWith('repeat--22220')); // amount in milliunits, double dash for negative
    expect(repeatInsight).toBeDefined();
    expect(repeatInsight?.severity).toBe('warning');
    expect(result.summary.unmatched_bank).toBeGreaterThan(0);
  });
});
