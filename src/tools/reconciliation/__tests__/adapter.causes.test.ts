import { describe, it, expect } from 'vitest';
import type { ReconciliationAnalysis } from '../types.js';
import { buildReconciliationV2Payload } from '../../reconcileV2Adapter.js';
import type { LegacyReconciliationResult } from '../executor.js';

const baseAnalysis: ReconciliationAnalysis = {
  success: true,
  phase: 'analysis',
  summary: {
    statement_date_range: '2025-10-01 to 2025-10-31',
    bank_transactions_count: 1,
    ynab_transactions_count: 1,
    auto_matched: 0,
    suggested_matches: 0,
    unmatched_bank: 0,
    unmatched_ynab: 0,
    current_cleared_balance: -899.02,
    target_statement_balance: -921.24,
    discrepancy: 22.22,
    discrepancy_explanation: 'Need to investigate discrepancy',
  },
  auto_matches: [],
  suggested_matches: [],
  unmatched_bank: [],
  unmatched_ynab: [],
  balance_info: {
    current_cleared: -899.02,
    current_uncleared: 0,
    current_total: -899.02,
    target_statement: -921.24,
    discrepancy: 22.22,
    on_track: false,
  },
  next_steps: [],
  insights: [],
};

const execution: LegacyReconciliationResult = {
  summary: {
    bank_transactions_count: 1,
    ynab_transactions_count: 1,
    matches_found: 0,
    missing_in_ynab: 0,
    missing_in_bank: 0,
    transactions_created: 0,
    transactions_updated: 0,
    dates_adjusted: 0,
    dry_run: false,
  },
  account_balance: {
    before: { balance: -899020, cleared_balance: -899020, uncleared_balance: 0 },
    after: { balance: -921240, cleared_balance: -921240, uncleared_balance: 0 },
  },
  actions_taken: [],
  recommendations: [],
  balance_reconciliation: {
    status: 'DISCREPANCY_FOUND',
    precision_calculations: {
      bank_statement_balance_milliunits: -921240,
      ynab_calculated_balance_milliunits: -899020,
      discrepancy_milliunits: -22220,
      discrepancy_dollars: -22.22,
    },
    discrepancy_analysis: {
      confidence_level: 0.8,
      risk_assessment: 'MEDIUM',
      likely_causes: [
        {
          cause_type: 'BANK_FEE',
          description: 'Monthly service fee detected',
          confidence: 0.7,
          amount_milliunits: -1500,
          suggested_resolution: 'Record bank fee',
          evidence: [],
        },
        {
          cause_type: 'INTEREST',
          description: 'Interest credit',
          confidence: 0.5,
          amount_milliunits: 500,
          suggested_resolution: 'Record interest income',
          evidence: [],
        },
      ],
    },
    final_verification: {
      balance_matches_exactly: false,
      all_transactions_accounted: false,
      audit_trail_complete: false,
      reconciliation_complete: false,
    },
  },
};

describe('buildReconciliationV2Payload discrepancy causes mapping', () => {
  it('maps legacy causes to MoneyValue entries with CAD currency', () => {
    const payload = buildReconciliationV2Payload(
      baseAnalysis,
      {
        accountId: 'acct-123',
        accountName: 'CAD Checking',
        currencyCode: 'CAD',
      },
      execution,
    );

    const structured = payload.structured as Record<string, any>;
    const discrepancyAnalysis = structured.execution?.balance_reconciliation?.discrepancy_analysis;
    expect(discrepancyAnalysis).toBeDefined();
    expect(discrepancyAnalysis.likely_causes).toHaveLength(2);

    for (const cause of discrepancyAnalysis.likely_causes as Record<string, any>[]) {
      expect(cause.amount).toMatchObject({ currency: 'CAD' });
      expect(typeof cause.suggested_action).toBe('string');
    }
    const [bankFee, interest] = discrepancyAnalysis.likely_causes;
    expect(bankFee.type).toBe('bank_fee');
    expect(interest.type).toBe('interest');
    expect(bankFee.suggested_action).toBe('Record bank fee');
    expect(interest.suggested_action).toBe('Record interest income');
  });
});
