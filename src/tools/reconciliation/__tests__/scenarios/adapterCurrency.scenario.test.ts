import { describe, it, expect } from 'vitest';
import type { ReconciliationAnalysis, TransactionMatch } from '../../types.js';
import { buildReconciliationV2Payload } from '../../../reconcileV2Adapter.js';

const makeMoney = (value: number, currency = 'USD') => ({
  value_milliunits: Math.round(value * 1000),
  value: value,
  value_display: value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`,
  currency,
  direction: value === 0 ? 'balanced' : value > 0 ? 'credit' : 'debit',
});

const buildAnalysis = (currency = 'USD'): ReconciliationAnalysis => ({
  success: true,
  phase: 'analysis',
  summary: {
    statement_date_range: '2025-10-01 to 2025-10-31',
    bank_transactions_count: 1,
    ynab_transactions_count: 1,
    auto_matched: 0,
    suggested_matches: 1,
    unmatched_bank: 0,
    unmatched_ynab: 0,
    current_cleared_balance: makeMoney(-899.02, currency),
    target_statement_balance: makeMoney(-899.02, currency),
    discrepancy: makeMoney(0, currency),
    discrepancy_explanation: 'Balanced',
  },
  auto_matches: [] as TransactionMatch[],
  suggested_matches: [] as TransactionMatch[],
  unmatched_bank: [],
  unmatched_ynab: [],
  balance_info: {
    current_cleared: makeMoney(-899.02, currency),
    current_uncleared: makeMoney(0, currency),
    current_total: makeMoney(-899.02, currency),
    target_statement: makeMoney(-899.02, currency),
    discrepancy: makeMoney(0, currency),
    on_track: true,
  },
  next_steps: ['Nothing to do'],
  insights: [],
});

describe('scenario: non-USD formatting in adapter payload', () => {
  it('emits CAD currency values and csv_format metadata when provided', () => {
    const payload = buildReconciliationV2Payload(buildAnalysis('CAD'), {
      accountName: 'CAD VISA',
      accountId: 'acct-123',
      currencyCode: 'CAD',
      csvFormat: {
        delimiter: ';',
        decimal_separator: ',',
        thousands_separator: ' ',
        date_format: 'DD/MM/YYYY',
        header_row: true,
        date_column: 'Date',
        amount_column: 'Montant',
        payee_column: 'Description',
      },
    });

    const structured = payload.structured as Record<string, any>;
    expect(structured.balance.current_cleared.currency).toBe('CAD');
    expect(structured.summary.current_cleared_balance.currency).toBe('CAD');
    expect(structured.csv_format).toEqual({
      delimiter: ';',
      decimal_separator: ',',
      thousands_separator: ' ',
      date_format: 'DD/MM/YYYY',
      header_row: true,
      date_column: 'Date',
      amount_column: 'Montant',
      payee_column: 'Description',
    });
    expect(payload.human).toContain('CAD');
  });
});
