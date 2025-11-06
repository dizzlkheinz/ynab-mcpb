import { describe, it, expect } from 'vitest';
import {
  buildReconciliationV2Payload,
  type LegacyReconciliationResult,
} from '../../reconcileV2Adapter.js';
import type { ReconciliationAnalysis } from '../types.js';

const makeMoney = (value: number, currency = 'USD') => ({
  value_milliunits: Math.round(value * 1000),
  value,
  value_display: value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`,
  currency,
  direction: (value === 0 ? 'balanced' : value > 0 ? 'credit' : 'debit') as
    | 'balanced'
    | 'credit'
    | 'debit',
});

const buildAnalysis = (): ReconciliationAnalysis => ({
  success: true,
  phase: 'analysis',
  summary: {
    statement_date_range: '2025-10-01 to 2025-10-31',
    bank_transactions_count: 3,
    ynab_transactions_count: 4,
    auto_matched: 2,
    suggested_matches: 1,
    unmatched_bank: 1,
    unmatched_ynab: 1,
    current_cleared_balance: makeMoney(-899.02),
    target_statement_balance: makeMoney(-921.24),
    discrepancy: makeMoney(22.22),
    discrepancy_explanation: 'Need to add 1 missing transaction',
  },
  auto_matches: [
    {
      bank_transaction: {
        id: 'bank-1',
        date: '2025-10-15',
        amount: -45.23,
        payee: 'Shell Gas',
        original_csv_row: 2,
      },
      ynab_transaction: {
        id: 'ynab-1',
        date: '2025-10-14',
        amount: -45230,
        payee_name: 'Shell',
        category_name: 'Auto',
        cleared: 'uncleared',
        approved: true,
      },
      candidates: [],
      confidence: 'high',
      confidence_score: 97,
      match_reason: 'exact_amount_and_date',
      top_confidence: 97,
      action_hint: 'mark_cleared',
    },
  ],
  suggested_matches: [
    {
      bank_transaction: {
        id: 'bank-2',
        date: '2025-10-20',
        amount: -60,
        payee: 'Amazon',
        original_csv_row: 5,
      },
      candidates: [
        {
          ynab_transaction: {
            id: 'ynab-2',
            date: '2025-10-19',
            amount: -60000,
            payee_name: 'Amazon Online',
            category_name: 'Shopping',
            cleared: 'uncleared',
            approved: true,
          },
          confidence: 75,
          match_reason: 'amount_and_date_fuzzy_payee',
          explanation: 'Amount matches, date off by 1 day',
        },
      ],
      confidence: 'medium',
      confidence_score: 75,
      match_reason: 'amount_and_date_fuzzy_payee',
      top_confidence: 75,
    },
  ],
  unmatched_bank: [
    {
      id: 'bank-3',
      date: '2025-10-25',
      amount: 22.22,
      payee: 'EvoCarShare',
      original_csv_row: 7,
    },
  ],
  unmatched_ynab: [
    {
      id: 'ynab-3',
      date: '2025-10-26',
      amount: -15000,
      payee_name: 'Coffee Shop',
      category_name: 'Dining',
      cleared: 'cleared',
      approved: true,
    },
  ],
  balance_info: {
    current_cleared: makeMoney(-899.02),
    current_uncleared: makeMoney(-45.23),
    current_total: makeMoney(-944.25),
    target_statement: makeMoney(-921.24),
    discrepancy: makeMoney(22.22),
    on_track: false,
  },
  next_steps: ['Review 2 auto-matched transactions', 'Add missing bank transaction'],
  insights: [
    {
      id: 'repeat-22.22',
      type: 'repeat_amount',
      severity: 'warning',
      title: '1 unmatched transaction at $22.22',
      description: 'Matches statement discrepancy',
      evidence: { csv_rows: [7] },
    },
  ],
});

describe('buildReconciliationV2Payload', () => {
  it('returns human narrative and structured payload with MoneyValue fields', () => {
    const payload = buildReconciliationV2Payload(buildAnalysis(), {
      accountName: 'K TD FCT VISA',
      accountId: 'account-123',
      currencyCode: 'USD',
    });

    expect(payload.human).toContain('K TD FCT VISA Reconciliation Report');
    expect(payload.human.toUpperCase()).toContain('DISCREPANCY');

    const structured = payload.structured as Record<string, any>;
    expect(structured.version).toBe('2.0');
    expect(structured.summary.current_cleared_balance.value_display).toBe('-$899.02');
    expect(structured.summary.current_cleared_balance.currency).toBe('USD');
    expect(structured.balance.discrepancy.direction).toBeDefined();
    expect(structured.matches.auto[0].bank_transaction.amount_money.value_milliunits).toBe(-45230);
  });

  it('includes execution data when provided', () => {
    const execution: LegacyReconciliationResult = {
      summary: {
        bank_transactions_count: 3,
        ynab_transactions_count: 4,
        matches_found: 2,
        missing_in_ynab: 1,
        missing_in_bank: 1,
        transactions_created: 1,
        transactions_updated: 1,
        dates_adjusted: 0,
        dry_run: false,
      },
      account_balance: {
        before: { balance: -899020, cleared_balance: -899020, uncleared_balance: 0 },
        after: { balance: -921240, cleared_balance: -921240, uncleared_balance: 0 },
      },
      actions_taken: [
        {
          type: 'create_transaction',
          transaction: { id: 'txn-1' },
          reason: 'Created missing transaction',
        },
      ],
      matches: [],
      missing_in_ynab: [],
      missing_in_bank: [],
      recommendations: ['Review EvoCarShare discrepancy'],
      balance_reconciliation: {
        status: 'DISCREPANCY_FOUND',
        precision_calculations: {
          bank_statement_balance_milliunits: -921240,
          ynab_calculated_balance_milliunits: -899020,
          discrepancy_milliunits: -22220,
          discrepancy_dollars: -22.22,
        },
        discrepancy_analysis: {
          confidence_level: 0.95,
          likely_causes: [
            {
              cause_type: 'MISSING_TRANSACTION',
              description: 'EvoCarShare transaction missing in YNAB',
              confidence: 0.95,
              amount_milliunits: 22220,
              suggested_resolution: 'Create transaction and mark cleared',
              evidence: [],
            },
          ],
          risk_assessment: 'LOW',
        },
        final_verification: {
          balance_matches_exactly: false,
          all_transactions_accounted: false,
          audit_trail_complete: false,
          reconciliation_complete: false,
        },
      },
    };

    const payload = buildReconciliationV2Payload(
      buildAnalysis(),
      {
        accountName: 'K TD FCT VISA',
        accountId: 'account-123',
        currencyCode: 'CAD',
      },
      execution,
    );

    const structured = payload.structured as Record<string, any>;
    expect(structured.execution).toBeDefined();
    expect(structured.execution.summary.transactions_created).toBe(1);
    expect(structured.execution.account_balance.after.cleared_balance.value_milliunits).toBe(
      -921240,
    );
    expect(structured.execution.account_balance.after.cleared_balance.currency).toBe('CAD');
    expect(
      structured.execution.balance_reconciliation?.precision_calculations?.discrepancy
        .value_display,
    ).toBe('-CA$22.22');
    expect(payload.human).toContain('Changes applied to YNAB');
  });
});
