import { describe, it, expect } from 'vitest';
import {
  formatHumanReadableReport,
  formatBalanceInfo,
  formatTransactionList,
  type ReportFormatterOptions,
} from '../reportFormatter.js';
import type {
  ReconciliationAnalysis,
  BankTransaction,
  YNABTransaction,
  ReconciliationInsight,
} from '../types.js';
import type { LegacyReconciliationResult } from '../executor.js';

/**
 * Helper to create MoneyValue for tests
 */
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

/**
 * Create a minimal reconciliation analysis for testing
 */
const createTestAnalysis = (
  overrides?: Partial<ReconciliationAnalysis>,
): ReconciliationAnalysis => ({
  success: true,
  phase: 'analysis',
  summary: {
    statement_date_range: '2025-10-01 to 2025-10-31',
    bank_transactions_count: 10,
    ynab_transactions_count: 12,
    auto_matched: 8,
    suggested_matches: 1,
    unmatched_bank: 1,
    unmatched_ynab: 3,
    current_cleared_balance: makeMoney(-899.02),
    target_statement_balance: makeMoney(-921.24),
    discrepancy: makeMoney(22.22),
    discrepancy_explanation: 'Statement shows more owed by $22.22',
  },
  auto_matches: [],
  suggested_matches: [],
  unmatched_bank: [],
  unmatched_ynab: [],
  balance_info: {
    current_cleared: makeMoney(-899.02),
    current_uncleared: makeMoney(-50.0),
    current_total: makeMoney(-949.02),
    target_statement: makeMoney(-921.24),
    discrepancy: makeMoney(22.22),
    on_track: false,
  },
  next_steps: ['Review unmatched transactions', 'Create missing transactions'],
  insights: [],
  ...overrides,
});

/**
 * Create test bank transaction
 */
const createBankTransaction = (
  id: string,
  amount: number,
  payee: string,
  date = '2025-10-15',
): BankTransaction => ({
  id,
  date,
  amount,
  payee,
  original_csv_row: 1,
});

/**
 * Create test YNAB transaction
 */
const createYNABTransaction = (
  id: string,
  amount: number,
  payee: string,
  date = '2025-10-15',
): YNABTransaction => ({
  id,
  date,
  amount,
  payee_name: payee,
  category_name: 'General',
  cleared: 'uncleared',
  approved: true,
});

/**
 * Create test insight
 */
const createInsight = (
  id: string,
  type: 'repeat_amount' | 'near_match' | 'anomaly',
  severity: 'info' | 'warning' | 'critical',
  title: string,
  description: string,
): ReconciliationInsight => ({
  id,
  type,
  severity,
  title,
  description,
});

/**
 * Create test execution result
 */
const createExecutionResult = (
  overrides?: Partial<LegacyReconciliationResult>,
): LegacyReconciliationResult => ({
  summary: {
    transactions_created: 0,
    transactions_updated: 0,
    dates_adjusted: 0,
    dry_run: true,
  },
  account_balance: {
    before: {
      balance: -899020,
      cleared_balance: -899020,
      uncleared_balance: 0,
    },
    after: {
      balance: -899020,
      cleared_balance: -899020,
      uncleared_balance: 0,
    },
  },
  actions_taken: [],
  recommendations: [],
  ...overrides,
});

describe('reportFormatter', () => {
  describe('formatHumanReadableReport', () => {
    it('should format a basic report with header and sections', () => {
      const analysis = createTestAnalysis();
      const options: ReportFormatterOptions = {
        accountName: 'Checking Account',
      };

      const report = formatHumanReadableReport(analysis, options);

      expect(report).toContain('📊 Checking Account Reconciliation Report');
      expect(report).toContain('═'.repeat(60));
      expect(report).toContain('BALANCE CHECK');
      expect(report).toContain('TRANSACTION ANALYSIS');
      expect(report).toContain('RECOMMENDED ACTIONS');
    });

    it('should show statement date range', () => {
      const analysis = createTestAnalysis();
      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('Statement Period: 2025-10-01 to 2025-10-31');
    });

    it('should show balanced status when no discrepancy', () => {
      const analysis = createTestAnalysis({
        balance_info: {
          current_cleared: makeMoney(-921.24),
          current_uncleared: makeMoney(0),
          current_total: makeMoney(-921.24),
          target_statement: makeMoney(-921.24),
          discrepancy: makeMoney(0),
          on_track: true,
        },
        summary: {
          ...createTestAnalysis().summary,
          discrepancy: makeMoney(0),
        },
      });

      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('✅ BALANCES MATCH PERFECTLY');
      expect(report).not.toContain('❌ DISCREPANCY');
    });

    it('should show discrepancy with correct direction when YNAB higher', () => {
      const analysis = createTestAnalysis({
        balance_info: {
          current_cleared: makeMoney(-900.0),
          current_uncleared: makeMoney(0),
          current_total: makeMoney(-900.0),
          target_statement: makeMoney(-920.0),
          discrepancy: makeMoney(20.0), // Positive means YNAB higher
          on_track: false,
        },
        summary: {
          ...createTestAnalysis().summary,
          discrepancy: makeMoney(20.0),
        },
      });

      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('❌ DISCREPANCY: $20.00');
      expect(report).toContain('YNAB shows MORE than statement');
    });

    it('should show discrepancy with correct direction when bank higher', () => {
      const analysis = createTestAnalysis({
        balance_info: {
          current_cleared: makeMoney(-920.0),
          current_uncleared: makeMoney(0),
          current_total: makeMoney(-920.0),
          target_statement: makeMoney(-900.0),
          discrepancy: makeMoney(-20.0), // Negative means bank higher
          on_track: false,
        },
        summary: {
          ...createTestAnalysis().summary,
          discrepancy: makeMoney(-20.0),
        },
      });

      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('❌ DISCREPANCY: -$20.00');
      expect(report).toContain('Statement shows MORE than YNAB');
    });

    it('should show transaction analysis counts', () => {
      const analysis = createTestAnalysis();
      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('Automatically matched:  8 of 10 transactions');
      expect(report).toContain('Suggested matches:      1');
      expect(report).toContain('Unmatched bank:         1');
      expect(report).toContain('Unmatched YNAB:         3');
    });

    it('should list unmatched bank transactions', () => {
      const analysis = createTestAnalysis({
        unmatched_bank: [
          createBankTransaction('bank-1', -22.22, 'EvoCarShare', '2025-10-25'),
          createBankTransaction('bank-2', -15.0, 'Coffee Shop', '2025-10-26'),
        ],
      });

      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('❌ UNMATCHED BANK TRANSACTIONS:');
      expect(report).toContain('2025-10-25');
      expect(report).toContain('EvoCarShare');
      expect(report).toContain('-$22.22');
      expect(report).toContain('Coffee Shop');
    });

    it('should truncate long unmatched lists', () => {
      const unmatchedBank: BankTransaction[] = [];
      for (let i = 0; i < 10; i++) {
        unmatchedBank.push(createBankTransaction(`bank-${i}`, -10.0, `Payee ${i}`, '2025-10-15'));
      }

      const analysis = createTestAnalysis({ unmatched_bank: unmatchedBank });
      const report = formatHumanReadableReport(analysis, { maxUnmatchedToShow: 5 });

      expect(report).toContain('... and 5 more');
    });

    it('should show suggested matches', () => {
      const analysis = createTestAnalysis({
        suggested_matches: [
          {
            bank_transaction: createBankTransaction('bank-1', -60.0, 'Amazon', '2025-10-20'),
            candidates: [],
            confidence: 'medium',
            confidence_score: 75,
            match_reason: 'amount_and_date_fuzzy_payee',
            top_confidence: 75,
          },
        ],
      });

      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('💡 SUGGESTED MATCHES:');
      expect(report).toContain('Amazon');
      expect(report).toContain('75% confidence');
    });

    it('should include insights section when insights present', () => {
      const analysis = createTestAnalysis({
        insights: [
          createInsight(
            '1',
            'repeat_amount',
            'critical',
            'Repeated amount detected',
            'Found $22.22 appearing 3 times',
          ),
          createInsight(
            '2',
            'near_match',
            'warning',
            'Near match found',
            'Transaction differs by only $0.50',
          ),
        ],
      });

      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('KEY INSIGHTS');
      expect(report).toContain('🚨 Repeated amount detected');
      expect(report).toContain('⚠️ Near match found');
    });

    it('should use correct severity icons', () => {
      const analysis = createTestAnalysis({
        insights: [
          createInsight('1', 'anomaly', 'critical', 'Critical Issue', 'Critical description'),
          createInsight('2', 'near_match', 'warning', 'Warning Issue', 'Warning description'),
          createInsight('3', 'repeat_amount', 'info', 'Info Issue', 'Info description'),
        ],
      });

      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('🚨 Critical Issue');
      expect(report).toContain('⚠️ Warning Issue');
      expect(report).toContain('ℹ️ Info Issue');
    });

    it('should truncate insights list', () => {
      const insights: ReconciliationInsight[] = [];
      for (let i = 0; i < 10; i++) {
        insights.push(createInsight(`${i}`, 'anomaly', 'info', `Insight ${i}`, `Description ${i}`));
      }

      const analysis = createTestAnalysis({ insights });
      const report = formatHumanReadableReport(analysis, { maxInsightsToShow: 3 });

      expect(report).toContain('... and 7 more insights');
    });

    it('should include execution section when execution provided', () => {
      const analysis = createTestAnalysis();
      const execution = createExecutionResult({
        summary: {
          transactions_created: 2,
          transactions_updated: 3,
          dates_adjusted: 1,
          dry_run: false,
        },
      });

      const report = formatHumanReadableReport(analysis, {}, execution);

      expect(report).toContain('EXECUTION SUMMARY');
      expect(report).toContain('Transactions created:  2');
      expect(report).toContain('Transactions updated:  3');
      expect(report).toContain('Date adjustments:      1');
      expect(report).toContain('✅ Changes applied to YNAB');
    });

    it('should show dry run notice when dry run enabled', () => {
      const analysis = createTestAnalysis();
      const execution = createExecutionResult({
        summary: {
          transactions_created: 0,
          transactions_updated: 0,
          dates_adjusted: 0,
          dry_run: true,
        },
      });

      const report = formatHumanReadableReport(analysis, {}, execution);

      expect(report).toContain('⚠️  Dry run only — no YNAB changes were applied.');
    });

    it('should show execution recommendations', () => {
      const analysis = createTestAnalysis();
      const execution = createExecutionResult({
        recommendations: [
          'Create transaction for EvoCarShare',
          'Review duplicate entries',
          'Check bank fees',
        ],
      });

      const report = formatHumanReadableReport(analysis, {}, execution);

      expect(report).toContain('Recommendations:');
      expect(report).toContain('Create transaction for EvoCarShare');
      expect(report).toContain('Review duplicate entries');
    });

    it('should show next steps when no execution', () => {
      const analysis = createTestAnalysis({
        next_steps: [
          'Create missing transaction for EvoCarShare',
          'Mark 8 transactions as cleared',
        ],
      });

      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('RECOMMENDED ACTIONS');
      expect(report).toContain('Create missing transaction for EvoCarShare');
      expect(report).toContain('Mark 8 transactions as cleared');
    });

    it('should handle empty next steps gracefully', () => {
      const analysis = createTestAnalysis({
        next_steps: [],
      });

      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('No specific actions recommended');
    });

    it('should use default account name when not provided', () => {
      const analysis = createTestAnalysis();
      const report = formatHumanReadableReport(analysis);

      expect(report).toContain('📊 Account Reconciliation Report');
    });
  });

  describe('formatBalanceInfo', () => {
    it('should format balance info correctly', () => {
      const balanceInfo = {
        current_cleared: makeMoney(-899.02),
        current_uncleared: makeMoney(-50.0),
        current_total: makeMoney(-949.02),
        target_statement: makeMoney(-921.24),
        discrepancy: makeMoney(22.22),
        on_track: false,
      };

      const formatted = formatBalanceInfo(balanceInfo);

      expect(formatted).toContain('Current Cleared:  -$899.02');
      expect(formatted).toContain('Current Total:    -$949.02');
      expect(formatted).toContain('Target Statement: -$921.24');
      expect(formatted).toContain('Discrepancy:      $22.22');
    });
  });

  describe('formatTransactionList', () => {
    it('should format bank transactions', () => {
      const transactions = [
        createBankTransaction('1', -45.23, 'Shell Gas', '2025-10-15'),
        createBankTransaction('2', -60.0, 'Amazon', '2025-10-20'),
      ];

      const formatted = formatTransactionList(transactions);

      expect(formatted).toContain('2025-10-15');
      expect(formatted).toContain('Shell Gas');
      expect(formatted).toContain('-$45.23');
      expect(formatted).toContain('Amazon');
    });

    it('should format YNAB transactions', () => {
      const transactions = [
        createYNABTransaction('1', -45230, 'Shell', '2025-10-15'),
        createYNABTransaction('2', -60000, 'Amazon', '2025-10-20'),
      ];

      const formatted = formatTransactionList(transactions);

      expect(formatted).toContain('2025-10-15');
      expect(formatted).toContain('Shell');
      expect(formatted).toContain('-$45.23');
      expect(formatted).toContain('Amazon');
      expect(formatted).toContain('-$60.00');
    });

    it('should truncate long lists', () => {
      const transactions: BankTransaction[] = [];
      for (let i = 0; i < 20; i++) {
        transactions.push(createBankTransaction(`${i}`, -10.0, `Payee ${i}`, '2025-10-15'));
      }

      const formatted = formatTransactionList(transactions, 5);

      expect(formatted).toContain('... and 15 more');
    });

    it('should handle empty list', () => {
      const formatted = formatTransactionList([]);
      expect(formatted).toBe('');
    });
  });

  describe('edge cases', () => {
    it('should handle negative amounts correctly', () => {
      const analysis = createTestAnalysis({
        unmatched_bank: [createBankTransaction('1', -123.45, 'Test', '2025-10-15')],
      });

      const report = formatHumanReadableReport(analysis);
      expect(report).toContain('-$123.45');
    });

    it('should handle positive amounts correctly', () => {
      const analysis = createTestAnalysis({
        unmatched_bank: [createBankTransaction('1', 123.45, 'Refund', '2025-10-15')],
      });

      const report = formatHumanReadableReport(analysis);
      expect(report).toContain('+$123.45');
    });

    it('should handle long payee names gracefully', () => {
      const longPayee = 'A'.repeat(100);
      const analysis = createTestAnalysis({
        unmatched_bank: [createBankTransaction('1', -10.0, longPayee, '2025-10-15')],
      });

      const report = formatHumanReadableReport(analysis);
      // Should truncate to 40 characters
      expect(report).toContain('A'.repeat(40));
      expect(report).not.toContain('A'.repeat(50));
    });

    it('should handle zero discrepancy', () => {
      const analysis = createTestAnalysis({
        balance_info: {
          current_cleared: makeMoney(-921.24),
          current_uncleared: makeMoney(0),
          current_total: makeMoney(-921.24),
          target_statement: makeMoney(-921.24),
          discrepancy: makeMoney(0),
          on_track: true,
        },
      });

      const report = formatHumanReadableReport(analysis);
      expect(report).toContain('✅ BALANCES MATCH PERFECTLY');
    });

    it('should format insight evidence when available', () => {
      const analysis = createTestAnalysis({
        insights: [
          {
            id: '1',
            type: 'repeat_amount',
            severity: 'warning',
            title: 'Repeated amount',
            description: 'Found duplicates',
            evidence: {
              transaction_count: 3,
            },
          },
        ],
      });

      const report = formatHumanReadableReport(analysis);
      expect(report).toContain('Evidence: 3 transactions');
    });
  });
});
