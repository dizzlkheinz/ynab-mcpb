import { describe, it, expect } from 'vitest';
import type { ReconciliationAnalysis } from '../types.js';
import { buildReconciliationV2Payload } from '../../reconcileV2Adapter.js';

const minimalAnalysis: ReconciliationAnalysis = {
  success: true,
  phase: 'analysis',
  summary: {
    statement_date_range: '2025-10-01 to 2025-10-31',
    bank_transactions_count: 0,
    ynab_transactions_count: 0,
    auto_matched: 0,
    suggested_matches: 0,
    unmatched_bank: 0,
    unmatched_ynab: 0,
    current_cleared_balance: 0,
    target_statement_balance: 0,
    discrepancy: 0,
    discrepancy_explanation: 'Balanced',
  },
  auto_matches: [],
  suggested_matches: [],
  unmatched_bank: [],
  unmatched_ynab: [],
  balance_info: {
    current_cleared: 0,
    current_uncleared: 0,
    current_total: 0,
    target_statement: 0,
    discrepancy: 0,
    on_track: true,
  },
  next_steps: [],
  insights: [],
};

describe('buildReconciliationV2Payload schema reference', () => {
  it('points to the master branch schema file on raw.githubusercontent.com', () => {
    const { structured } = buildReconciliationV2Payload(minimalAnalysis, {
      accountId: 'acct-id',
      accountName: 'Checking',
      currencyCode: 'USD',
    });

    const schemaUrl = (structured as Record<string, unknown>).schema_url;
    expect(schemaUrl).toContain('raw.githubusercontent.com');
    expect(schemaUrl).toContain('/docs/schemas/reconciliation-v2.json');
  });
});
