import { describe, it, expect } from 'vitest';
import { generateRecommendations } from '../recommendationEngine.js';
import type {
  RecommendationContext,
  ReconciliationAnalysis,
  BankTransaction,
  YNABTransaction,
  MoneyValue,
  ReconciliationInsight,
  ActionableRecommendation,
  CreateTransactionRecommendation,
  UpdateClearedRecommendation,
  ReviewDuplicateRecommendation,
  ManualReviewRecommendation,
  TransactionMatch,
} from '../types.js';
import { toMoneyValueFromDecimal } from '../../../utils/money.js';

// Helper to create MoneyValue objects
const makeMoney = (value: number, currency = 'USD'): MoneyValue => {
  return toMoneyValueFromDecimal(value, currency);
};

// Helper to create minimal mock context
const createMockContext = (overrides?: Partial<RecommendationContext>): RecommendationContext => {
  const defaultAnalysis: ReconciliationAnalysis = {
    success: true,
    phase: 'analysis',
    matches: [],
    auto_matches: [],
    suggested_matches: [],
    unmatched_bank: [],
    unmatched_ynab: [],
    balance_info: {
      current_cleared: makeMoney(100),
      current_uncleared: makeMoney(0),
      current_total: makeMoney(100),
      target_statement: makeMoney(100),
      discrepancy: makeMoney(0),
      on_track: true,
    },
    summary: {
      statement_date_range: '2024-01-01 to 2024-01-31',
      bank_transactions_count: 0,
      ynab_transactions_count: 0,
      auto_matched: 0,
      suggested_matches: 0,
      unmatched_bank: 0,
      unmatched_ynab: 0,
      current_cleared_balance: makeMoney(100),
      target_statement_balance: makeMoney(100),
      discrepancy: makeMoney(0),
      discrepancy_explanation: 'Balanced',
    },
    insights: [],
    next_steps: [],
  };

  return {
    account_id: 'test-account-id',
    budget_id: 'test-budget-id',
    analysis: defaultAnalysis,
    matching_config: {
      amountToleranceCents: 1,
      dateToleranceDays: 2,
      descriptionSimilarityThreshold: 0.8,
      autoMatchThreshold: 90,
      suggestionThreshold: 60,
    },
    ...overrides,
  };
};

// Helper to create mock bank transaction
const createBankTransaction = (overrides?: Partial<BankTransaction>): BankTransaction => ({
  id: 'bank-txn-1',
  date: '2024-01-15',
  amount: -50.0,
  payee: 'Test Store',
  memo: 'Test memo',
  original_csv_row: 1,
  ...overrides,
});

// Helper to create mock YNAB transaction
const createYNABTransaction = (overrides?: Partial<YNABTransaction>): YNABTransaction => ({
  id: 'ynab-txn-1',
  date: '2024-01-15',
  amount: -50000,
  payee_name: 'Test Store',
  category_name: 'Shopping',
  cleared: 'uncleared',
  approved: true,
  memo: 'Test memo',
  ...overrides,
});

// Helper to create mock insight
const createInsight = (
  type: ReconciliationInsight['type'],
  severity: ReconciliationInsight['severity'] = 'info',
): ReconciliationInsight => ({
  id: `insight-${type}-1`,
  type,
  severity,
  title: `Test ${type} insight`,
  description: `This is a test ${type} insight`,
  evidence: {},
});

describe('recommendationEngine', () => {
  describe('generateRecommendations', () => {
    describe('empty context scenarios', () => {
      it('should return empty array for completely empty context', () => {
        const context = createMockContext();
        const recommendations = generateRecommendations(context);
        expect(recommendations).toEqual([]);
      });

      it('should return empty array with no insights and no unmatched transactions', () => {
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [],
            unmatched_bank: [],
            unmatched_ynab: [],
            suggested_matches: [],
          },
        });
        const recommendations = generateRecommendations(context);
        expect(recommendations).toEqual([]);
      });
    });

    describe('insight processing', () => {
      it('should process near_match insights', () => {
        const insight = createInsight('near_match', 'warning');
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [insight],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as ManualReviewRecommendation;
        expect(rec.action_type).toBe('manual_review');
        expect(rec.priority).toBe('medium');
        expect(rec.confidence).toBe(0.7); // CONFIDENCE.NEAR_MATCH_REVIEW
        expect(rec.source_insight_id).toBe(insight.id);
        expect(rec.parameters.issue_type).toBe('complex_match');
      });

      it('should process repeat_amount insights', () => {
        const insight = createInsight('repeat_amount', 'info');
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [insight],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as ManualReviewRecommendation;
        expect(rec.action_type).toBe('manual_review');
        expect(rec.priority).toBe('medium');
        expect(rec.confidence).toBe(0.75); // CONFIDENCE.REPEAT_AMOUNT
        expect(rec.source_insight_id).toBe(insight.id);
        expect(rec.message).toContain('recurring pattern');
      });

      it('should process anomaly insights', () => {
        const insight = createInsight('anomaly', 'warning');
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [insight],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as ManualReviewRecommendation;
        expect(rec.action_type).toBe('manual_review');
        expect(rec.priority).toBe('low');
        expect(rec.confidence).toBe(0.5); // CONFIDENCE.ANOMALY_REVIEW
        expect(rec.source_insight_id).toBe(insight.id);
      });

      it('should process critical anomaly insights with higher severity', () => {
        const insight = createInsight('anomaly', 'critical');
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [insight],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as ManualReviewRecommendation;
        expect(rec.action_type).toBe('manual_review');
        expect(rec.parameters.issue_type).toBe('large_discrepancy');
      });

      it('should process multiple insights', () => {
        const insights = [
          createInsight('near_match', 'warning'),
          createInsight('repeat_amount', 'info'),
          createInsight('anomaly', 'warning'),
        ];
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights,
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(3);
        expect(recommendations.map((r) => r.action_type)).toEqual([
          'manual_review',
          'manual_review',
          'manual_review',
        ]);
      });
    });

    describe('unmatched bank transactions', () => {
      it('should create create_transaction recommendation for unmatched bank transaction', () => {
        const bankTxn = createBankTransaction({
          id: 'bank-1',
          amount: -75.5,
          payee: 'Coffee Shop',
          date: '2024-01-20',
        });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.action_type).toBe('create_transaction');
        expect(rec.priority).toBe('medium');
        expect(rec.confidence).toBe(0.8); // CONFIDENCE.UNMATCHED_BANK
        expect(rec.parameters.account_id).toBe('test-account-id');
        expect(rec.parameters.date).toBe('2024-01-20');
        expect(rec.parameters.amount).toBe(-75500); // In milliunits
        expect(rec.parameters.payee_name).toBe('Coffee Shop');
        expect(rec.parameters.cleared).toBe('cleared');
        expect(rec.parameters.approved).toBe(true);
      });

      it('should include memo if present in bank transaction', () => {
        const bankTxn = createBankTransaction({
          memo: 'Business expense',
        });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.parameters.memo).toBe('Business expense');
      });

      it('should not include memo if not present in bank transaction', () => {
        const bankTxn = createBankTransaction();
        delete bankTxn.memo;

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.parameters.memo).toBeUndefined();
      });

      it('should create recommendations for multiple unmatched bank transactions', () => {
        const bankTxns = [
          createBankTransaction({ id: 'b1', amount: -10.0 }),
          createBankTransaction({ id: 'b2', amount: -20.0 }),
          createBankTransaction({ id: 'b3', amount: -30.0 }),
        ];

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: bankTxns,
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(3);
        expect(recommendations.every((r) => r.action_type === 'create_transaction')).toBe(true);
      });
    });

    describe('unmatched YNAB transactions', () => {
      it('should create update_cleared recommendation for uncleared YNAB transaction', () => {
        const ynabTxn = createYNABTransaction({
          id: 'ynab-1',
          cleared: 'uncleared',
          payee_name: 'Restaurant',
        });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_ynab: [ynabTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as UpdateClearedRecommendation;
        expect(rec.action_type).toBe('update_cleared');
        expect(rec.priority).toBe('low');
        expect(rec.confidence).toBe(0.6); // CONFIDENCE.UPDATE_CLEARED
        expect(rec.parameters.transaction_id).toBe('ynab-1');
        expect(rec.parameters.cleared).toBe('cleared');
      });

      it('should not create recommendation for already cleared YNAB transaction', () => {
        const ynabTxn = createYNABTransaction({
          cleared: 'cleared',
        });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_ynab: [ynabTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(0);
      });

      it('should not create recommendation for reconciled YNAB transaction', () => {
        const ynabTxn = createYNABTransaction({
          cleared: 'reconciled',
        });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_ynab: [ynabTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(0);
      });

      it('should handle null payee_name in YNAB transaction', () => {
        const ynabTxn = createYNABTransaction({
          cleared: 'uncleared',
          payee_name: null,
        });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_ynab: [ynabTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as UpdateClearedRecommendation;
        expect(rec.message).toContain('Unknown');
      });
    });

    describe('suggested matches', () => {
      it('should create review_duplicate recommendation for suggested match', () => {
        const bankTxn = createBankTransaction();
        const ynabTxn = createYNABTransaction();

        const suggestedMatch: TransactionMatch = {
          bank_transaction: bankTxn,
          ynab_transaction: ynabTxn,
          confidence: 'medium',
          confidence_score: 75,
          match_reason: 'Fuzzy payee match',
        };

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            suggested_matches: [suggestedMatch],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as ReviewDuplicateRecommendation;
        expect(rec.action_type).toBe('review_duplicate');
        expect(rec.priority).toBe('high');
        expect(rec.confidence).toBe(0.75); // confidence_score / 100
        expect(rec.parameters.candidate_ids).toContain(ynabTxn.id);
        expect(rec.parameters.suggested_match_id).toBe(ynabTxn.id);
      });

      it('should create create_transaction for suggested match with no YNAB transaction', () => {
        const bankTxn = createBankTransaction({ amount: -45.0 });

        const suggestedMatch: TransactionMatch = {
          bank_transaction: bankTxn,
          confidence: 'none',
          confidence_score: 0,
          match_reason: 'No match found',
        };

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            suggested_matches: [suggestedMatch],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.action_type).toBe('create_transaction');
        expect(rec.priority).toBe('high');
        expect(rec.confidence).toBe(0.95); // CONFIDENCE.CREATE_EXACT_MATCH
        expect(rec.parameters.amount).toBe(-45000); // In milliunits
      });

      it('should create manual_review for combination match with multiple candidates', () => {
        const bankTxn = createBankTransaction({ amount: -100.0, payee: 'Split Payment' });
        const ynabTxn1 = createYNABTransaction({ id: 'y1', amount: -50000, payee_name: 'Vendor A' });
        const ynabTxn2 = createYNABTransaction({ id: 'y2', amount: -50000, payee_name: 'Vendor B' });

        const suggestedMatch: TransactionMatch = {
          bank_transaction: bankTxn,
          candidates: [
            {
              ynab_transaction: ynabTxn1,
              confidence: 60,
              match_reason: 'Partial amount match',
              explanation: 'Amount matches half of bank transaction',
            },
            {
              ynab_transaction: ynabTxn2,
              confidence: 60,
              match_reason: 'Partial amount match',
              explanation: 'Amount matches half of bank transaction',
            },
          ],
          confidence: 'medium',
          confidence_score: 60,
          match_reason: 'combination_match',
        };

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            suggested_matches: [suggestedMatch],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as ManualReviewRecommendation;
        expect(rec.action_type).toBe('manual_review');
        expect(rec.priority).toBe('medium');
        expect(rec.confidence).toBe(0.7); // CONFIDENCE.NEAR_MATCH_REVIEW
        expect(rec.parameters.issue_type).toBe('complex_match');
        expect(rec.parameters.related_transactions).toHaveLength(3); // 1 bank + 2 YNAB

        // Verify related transactions structure
        const relatedTxns = rec.parameters.related_transactions!;
        expect(relatedTxns[0]?.source).toBe('bank');
        expect(relatedTxns[0]?.id).toBe(bankTxn.id);
        expect(relatedTxns[0]?.description).toBe('Split Payment');
        expect(relatedTxns[1]?.source).toBe('ynab');
        expect(relatedTxns[1]?.id).toBe('y1');
        expect(relatedTxns[2]?.source).toBe('ynab');
        expect(relatedTxns[2]?.id).toBe('y2');

        // Verify enhanced metadata
        expect(rec.metadata?.bank_transaction_amount).toBeDefined();
        expect(rec.metadata?.bank_transaction_amount.value).toBe(-100.0);
        expect(rec.metadata?.candidate_total_amount).toBeDefined();
        expect(rec.metadata?.candidate_total_amount.value).toBe(-100.0); // -50 + -50
        expect(rec.metadata?.candidate_count).toBe(2);
      });
    });

    describe('amount sign preservation (CRITICAL)', () => {
      it('should preserve negative amounts for expenses in create_transaction', () => {
        const bankTxn = createBankTransaction({
          amount: -123.45,
          payee: 'Grocery Store',
        });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.parameters.amount).toBe(-123450); // In milliunits
        expect(rec.parameters.amount).toBeLessThan(0);
        expect(rec.estimated_impact.value).toBe(-123.45); // Estimated impact stays in dollars
      });

      it('should preserve positive amounts for income in create_transaction', () => {
        const bankTxn = createBankTransaction({
          amount: 500.0,
          payee: 'Paycheck Refund',
        });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.parameters.amount).toBe(500000); // In milliunits
        expect(rec.parameters.amount).toBeGreaterThan(0);
        expect(rec.estimated_impact.value).toBe(500.0); // Estimated impact stays in dollars
      });

      it('should preserve negative amounts in suggested match create_transaction', () => {
        const bankTxn = createBankTransaction({ amount: -99.99 });

        const suggestedMatch: TransactionMatch = {
          bank_transaction: bankTxn,
          confidence: 'none',
          confidence_score: 0,
          match_reason: 'No match',
        };

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            suggested_matches: [suggestedMatch],
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.parameters.amount).toBe(-99990); // In milliunits
      });

      it('should handle zero amounts correctly', () => {
        const bankTxn = createBankTransaction({ amount: 0 });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.parameters.amount).toBe(0); // Zero in milliunits is still zero
      });
    });

    describe('sorting logic', () => {
      it('should sort by priority (high > medium > low)', () => {
        const bankTxn = createBankTransaction();
        const ynabTxn = createYNABTransaction({ cleared: 'uncleared' });
        const insight = createInsight('anomaly', 'warning');

        // Create context that will generate all priority levels
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn], // medium priority
            unmatched_ynab: [ynabTxn], // low priority
            insights: [insight], // low priority (anomaly)
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(3);
        // First should be medium (unmatched_bank)
        expect(recommendations[0].priority).toBe('medium');
        // Next should be low priority items
        expect(recommendations[1].priority).toBe('low');
        expect(recommendations[2].priority).toBe('low');
      });

      it('should sort by confidence when priorities are equal', () => {
        const insights = [
          createInsight('near_match', 'warning'), // priority: medium, confidence: 0.7
          createInsight('repeat_amount', 'info'), // priority: medium, confidence: 0.75
        ];

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights,
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(2);
        // Both are medium priority, so should be sorted by confidence (0.75 > 0.7)
        expect(recommendations[0].confidence).toBe(0.75); // repeat_amount
        expect(recommendations[1].confidence).toBe(0.7); // near_match
      });

      it('should handle mixed priorities and confidence', () => {
        const bankTxn = createBankTransaction();
        const ynabTxn = createYNABTransaction({ cleared: 'uncleared' });
        const suggestedMatch: TransactionMatch = {
          bank_transaction: bankTxn,
          ynab_transaction: ynabTxn,
          confidence: 'medium',
          confidence_score: 75,
          match_reason: 'Suggested',
        };

        const insights = [
          createInsight('near_match', 'warning'), // medium priority, 0.7 confidence
          createInsight('anomaly', 'warning'), // low priority, 0.5 confidence
        ];

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            suggested_matches: [suggestedMatch], // high priority, 0.75 confidence
            unmatched_bank: [createBankTransaction({ id: 'b2' })], // medium priority, 0.8 confidence
            insights,
          },
        });

        const recommendations = generateRecommendations(context);

        // Should be: high priority first, then medium sorted by confidence, then low
        expect(recommendations[0].priority).toBe('high');
        expect(recommendations[1].priority).toBe('medium');
        expect(recommendations[1].confidence).toBe(0.8); // unmatched_bank
        expect(recommendations[2].priority).toBe('medium');
        expect(recommendations[2].confidence).toBe(0.7); // near_match
        expect(recommendations[3].priority).toBe('low');
      });
    });

    describe('recommendation metadata', () => {
      it('should include correct metadata in all recommendations', () => {
        const bankTxn = createBankTransaction();
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0];
        expect(rec.id).toBeDefined();
        expect(rec.account_id).toBe('test-account-id');
        expect(rec.metadata.version).toBe('1.0');
        expect(rec.metadata.created_at).toBeDefined();
        expect(new Date(rec.metadata.created_at).getTime()).not.toBeNaN();
      });

      it('should generate unique IDs for each recommendation', () => {
        const bankTxns = [
          createBankTransaction({ id: 'b1' }),
          createBankTransaction({ id: 'b2' }),
          createBankTransaction({ id: 'b3' }),
        ];

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: bankTxns,
          },
        });

        const recommendations = generateRecommendations(context);

        const ids = recommendations.map((r) => r.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      });

      it('should use correct currency from balance info', () => {
        const bankTxn = createBankTransaction({ amount: -50.0 });
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
            balance_info: {
              ...createMockContext().analysis.balance_info,
              current_cleared: makeMoney(100, 'EUR'),
            },
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0];
        expect(rec.estimated_impact.currency).toBe('EUR');
      });

      it('should include enhanced metadata in insight-based manual review recommendations', () => {
        const insight = createInsight('near_match', 'critical');
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [insight],
            balance_info: {
              ...createMockContext().analysis.balance_info,
              discrepancy: makeMoney(-100, 'USD'),
            },
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as ManualReviewRecommendation;
        expect(rec.action_type).toBe('manual_review');

        // Verify enhanced metadata fields
        expect(rec.metadata?.current_discrepancy).toBeDefined();
        expect(rec.metadata?.current_discrepancy.value).toBe(-100);
        expect(rec.metadata?.current_discrepancy.currency).toBe('USD');
        expect(rec.metadata?.insight_severity).toBe('critical');
      });

      it('should include enhanced metadata for all insight-based recommendation types', () => {
        const nearMatchInsight = createInsight('near_match', 'warning');
        const repeatAmountInsight = createInsight('repeat_amount', 'info');
        const anomalyInsight = createInsight('anomaly', 'critical');

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [nearMatchInsight, repeatAmountInsight, anomalyInsight],
            balance_info: {
              ...createMockContext().analysis.balance_info,
              discrepancy: makeMoney(-250.75, 'CAD'),
            },
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(3);

        // All insight-based recommendations should have enhanced metadata
        for (const rec of recommendations) {
          expect(rec.action_type).toBe('manual_review');
          const manualRec = rec as ManualReviewRecommendation;

          expect(manualRec.metadata?.current_discrepancy).toBeDefined();
          expect(manualRec.metadata?.current_discrepancy.value).toBe(-250.75);
          expect(manualRec.metadata?.current_discrepancy.currency).toBe('CAD');
          expect(manualRec.metadata?.insight_severity).toMatch(/^(info|warning|critical)$/);
        }

        // Verify specific severities
        const severities = recommendations.map(r => (r as ManualReviewRecommendation).metadata?.insight_severity);
        expect(severities).toContain('warning');
        expect(severities).toContain('info');
        expect(severities).toContain('critical');
      });
    });

    describe('edge cases', () => {
      it('should handle empty insights array', () => {
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [],
          },
        });

        const recommendations = generateRecommendations(context);
        expect(recommendations).toEqual([]);
      });

      it('should handle empty unmatched arrays', () => {
        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [],
            unmatched_ynab: [],
            suggested_matches: [],
          },
        });

        const recommendations = generateRecommendations(context);
        expect(recommendations).toEqual([]);
      });

      it('should handle missing optional fields', () => {
        const bankTxn = createBankTransaction();
        delete bankTxn.memo;

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.parameters.memo).toBeUndefined();
      });

      it('should handle very large arrays of recommendations', () => {
        const bankTxns = Array.from({ length: 100 }, (_, i) =>
          createBankTransaction({ id: `b${i}`, amount: -10.0 - i }),
        );

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: bankTxns,
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(100);
        // Verify sorting still works
        for (let i = 0; i < recommendations.length - 1; i++) {
          expect(recommendations[i].priority).toBeDefined();
        }
      });

      it('should handle insight without evidence', () => {
        const insight = createInsight('near_match');
        delete insight.evidence;

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [insight],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(1);
        expect(recommendations[0]).toBeDefined();
      });

      it('should handle transactions with very small amounts', () => {
        const bankTxn = createBankTransaction({ amount: -0.01 });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.parameters.amount).toBe(-10); // In milliunits (0.01 * 1000)
      });

      it('should handle transactions with very large amounts', () => {
        const bankTxn = createBankTransaction({ amount: -999999.99 });

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            unmatched_bank: [bankTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        const rec = recommendations[0] as CreateTransactionRecommendation;
        expect(rec.parameters.amount).toBe(-999999990); // In milliunits
      });
    });

    describe('combined scenarios', () => {
      it('should handle combination of insights, unmatched bank, and unmatched YNAB', () => {
        const bankTxn = createBankTransaction({ id: 'b1' });
        const ynabTxn = createYNABTransaction({ id: 'y1', cleared: 'uncleared' });
        const insight = createInsight('near_match', 'warning');

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights: [insight],
            unmatched_bank: [bankTxn],
            unmatched_ynab: [ynabTxn],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations).toHaveLength(3);
        expect(recommendations.map((r) => r.action_type).sort()).toEqual([
          'create_transaction',
          'manual_review',
          'update_cleared',
        ]);
      });

      it('should handle all recommendation types at once', () => {
        const bankTxn = createBankTransaction({ id: 'b1' });
        const ynabTxn = createYNABTransaction({ id: 'y1', cleared: 'uncleared' });
        const suggestedMatch: TransactionMatch = {
          bank_transaction: createBankTransaction({ id: 'b2' }),
          ynab_transaction: createYNABTransaction({ id: 'y2' }),
          confidence: 'medium',
          confidence_score: 75,
          match_reason: 'Suggested',
        };
        const insights = [
          createInsight('near_match', 'warning'),
          createInsight('repeat_amount', 'info'),
          createInsight('anomaly', 'critical'),
        ];

        const context = createMockContext({
          analysis: {
            ...createMockContext().analysis,
            insights,
            unmatched_bank: [bankTxn],
            unmatched_ynab: [ynabTxn],
            suggested_matches: [suggestedMatch],
          },
        });

        const recommendations = generateRecommendations(context);

        expect(recommendations.length).toBeGreaterThan(0);
        const actionTypes = new Set(recommendations.map((r) => r.action_type));
        expect(actionTypes.size).toBeGreaterThan(1);
      });
    });
  });
});
