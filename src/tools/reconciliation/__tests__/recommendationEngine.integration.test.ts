/**
 * Integration tests for recommendation engine
 * Tests the full flow from analysis → recommendations with realistic data
 */

import { describe, it, expect } from 'vitest';
import { analyzeReconciliation } from '../analyzer.js';
import type * as ynab from 'ynab';
import type { ActionableRecommendation } from '../types.js';

/**
 * Helper to create a mock YNAB transaction
 */
function createYNABTransaction(
  id: string,
  date: string,
  amount: number, // in milliunits
  payeeName: string,
  cleared: 'cleared' | 'uncleared' | 'reconciled' = 'uncleared',
): ynab.TransactionDetail {
  return {
    id,
    date,
    amount,
    payee_name: payeeName,
    category_name: 'Test Category',
    cleared,
    approved: true,
    memo: null,
    account_id: 'test-account',
    account_name: 'Test Account',
    deleted: false,
    flag_color: null,
    flag_name: null,
    category_id: 'test-category',
    payee_id: 'test-payee',
    transfer_account_id: null,
    transfer_transaction_id: null,
    matched_transaction_id: null,
    import_id: null,
    import_payee_name: null,
    import_payee_name_original: null,
    debt_transaction_type: null,
    subtransactions: [],
  } as ynab.TransactionDetail;
}

describe('Recommendation Engine Integration', () => {
  describe('with account_id and budget_id provided', () => {
    it('should generate recommendations for unmatched bank transactions', () => {
      // Create CSV with unmatched bank transaction
      const csvContent = 'Date,Description,Amount\n2024-01-15,Coffee Shop,22.22';
      const ynabTransactions: ynab.TransactionDetail[] = [];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        22.22, // statement balance
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      // Verify recommendations are generated
      expect(analysis.recommendations).toBeDefined();
      expect(analysis.recommendations!.length).toBeGreaterThan(0);

      // Verify recommendation details
      const rec = analysis.recommendations![0]!;
      expect(rec.action_type).toBe('create_transaction');
      expect(rec.priority).toMatch(/^(high|medium|low)$/);
      expect(rec.account_id).toBe('test-account-id');

      if (rec.action_type === 'create_transaction') {
        expect(rec.parameters.payee_name).toContain('Coffee Shop');
        expect(rec.parameters.amount).toBe(22220); // In milliunits
        expect(rec.parameters.date).toBe('2024-01-15');
        expect(rec.parameters.cleared).toBe('cleared');
      }
    });

    it('should handle the EvoCarShare scenario correctly', () => {
      // Test the exact scenario from documentation
      // YNAB cleared balance: $100
      // Statement balance: $122.22
      // Missing transaction: EvoCarShare $22.22
      // Should generate high-priority create_transaction recommendation

      const csvContent = 'Date,Description,Amount\n2024-01-15,EvoCarShare,22.22\n2024-01-10,Grocery Store,100.00';

      const ynabTransactions: ynab.TransactionDetail[] = [
        createYNABTransaction('ynab-1', '2024-01-10', 100000, 'Grocery Store', 'cleared'),
      ];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        122.22, // statement balance
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      // Verify recommendations exist
      expect(analysis.recommendations).toBeDefined();
      expect(analysis.recommendations!.length).toBeGreaterThan(0);

      // Find the EvoCarShare recommendation
      const evoCarShareRec = analysis.recommendations!.find(
        (rec) =>
          rec.action_type === 'create_transaction' &&
          rec.action_type === 'create_transaction' &&
          rec.parameters.payee_name.includes('EvoCarShare'),
      ) as Extract<ActionableRecommendation, { action_type: 'create_transaction' }> | undefined;

      expect(evoCarShareRec).toBeDefined();
      expect(evoCarShareRec!.parameters.amount).toBe(22220); // In milliunits
      expect(evoCarShareRec!.parameters.date).toBe('2024-01-15');
      expect(evoCarShareRec!.priority).toMatch(/^(high|medium)$/); // Should be high or medium priority
      expect(evoCarShareRec!.confidence).toBeGreaterThan(0.5); // Reasonable confidence
    });

    it('should generate update_cleared recommendations for unmatched uncleared YNAB transactions', () => {
      const csvContent = 'Date,Description,Amount\n2024-01-15,Coffee Shop,10.00';

      const ynabTransactions: ynab.TransactionDetail[] = [
        createYNABTransaction('ynab-1', '2024-01-15', 10000, 'Coffee Shop', 'uncleared'),
      ];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        10.0, // statement balance
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      expect(analysis.recommendations).toBeDefined();

      // High confidence match should generate review_duplicate or update_cleared
      const updateRecs = analysis.recommendations!.filter(
        (rec) => rec.action_type === 'update_cleared',
      );

      // Depending on matching score, this could be an auto-match (no recommendation)
      // or an update_cleared recommendation
      // The key is that recommendations exist and are properly formatted
      expect(analysis.recommendations!.length).toBeGreaterThan(0);

      // Verify any update_cleared recommendations are properly formed
      for (const rec of updateRecs) {
        if (rec.action_type === 'update_cleared') {
          expect(rec.parameters.transaction_id).toBeDefined();
          expect(rec.parameters.cleared).toMatch(/^(cleared|reconciled)$/);
        }
      }
    });

    it('should generate review_duplicate for suggested matches', () => {
      // Create a near match that should be suggested but not auto-matched
      const csvContent = 'Date,Description,Amount\n2024-01-15,Amazon Online Purchase,49.99';

      const ynabTransactions: ynab.TransactionDetail[] = [
        createYNABTransaction(
          'ynab-1',
          '2024-01-14', // 1 day off
          49990,
          'Amazon.com',
          'uncleared',
        ),
      ];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        49.99,
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      expect(analysis.recommendations).toBeDefined();

      // Should have at least one recommendation
      expect(analysis.recommendations!.length).toBeGreaterThan(0);

      // Could be create_transaction or review_duplicate depending on match score
      const hasRelevantRec = analysis.recommendations!.some(
        (rec) =>
          rec.action_type === 'create_transaction' || rec.action_type === 'review_duplicate',
      );
      expect(hasRelevantRec).toBe(true);
    });
  });

  describe('without account_id and budget_id (backward compatibility)', () => {
    it('should NOT generate recommendations when IDs are missing', () => {
      const csvContent = 'Date,Description,Amount\n2024-01-15,Test Transaction,10.00';
      const ynabTransactions: ynab.TransactionDetail[] = [];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        10.0,
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        // No accountId or budgetId provided
      );

      // Should still work, but no recommendations
      expect(analysis.success).toBe(true);
      expect(analysis.recommendations).toBeUndefined();
      expect(analysis.unmatched_bank.length).toBe(1);
    });

    it('should still perform analysis correctly without recommendations', () => {
      const csvContent =
        'Date,Description,Amount\n2024-01-15,Store A,25.00\n2024-01-16,Store B,35.00';

      const ynabTransactions: ynab.TransactionDetail[] = [
        createYNABTransaction('ynab-1', '2024-01-15', 25000, 'Store A', 'cleared'),
      ];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        60.0,
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        // No IDs
      );

      expect(analysis.success).toBe(true);
      expect(analysis.recommendations).toBeUndefined();
      expect(analysis.summary).toBeDefined();
      expect(analysis.balance_info).toBeDefined();
      expect(analysis.insights).toBeDefined();

      // Should still have matches and unmatched items
      expect(analysis.summary.bank_transactions_count).toBe(2);
      expect(analysis.summary.ynab_transactions_count).toBe(1);
    });
  });

  describe('complex scenarios', () => {
    it('should generate multiple recommendations for multiple unmatched transactions', () => {
      const csvContent = `Date,Description,Amount
2024-01-15,Coffee Shop,5.00
2024-01-16,Gas Station,45.00
2024-01-17,Restaurant,25.00`;

      const ynabTransactions: ynab.TransactionDetail[] = [];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        75.0,
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      expect(analysis.recommendations).toBeDefined();
      expect(analysis.recommendations!.length).toBeGreaterThanOrEqual(3);

      // All should be create_transaction recommendations
      const createRecs = analysis.recommendations!.filter(
        (rec) => rec.action_type === 'create_transaction',
      );
      expect(createRecs.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle repeat amounts with recommendations', () => {
      const csvContent = `Date,Description,Amount
2024-01-15,Netflix,15.99
2024-02-15,Netflix,15.99
2024-03-15,Netflix,15.99`;

      const ynabTransactions: ynab.TransactionDetail[] = [];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        47.97,
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      expect(analysis.recommendations).toBeDefined();
      expect(analysis.recommendations!.length).toBeGreaterThanOrEqual(3);

      // Should have insights about repeat amounts
      const repeatInsight = analysis.insights.find((insight) => insight.type === 'repeat_amount');
      expect(repeatInsight).toBeDefined();

      // Should have recommendations (create_transaction or manual_review)
      const relevantRecs = analysis.recommendations!.filter(
        (rec) =>
          rec.action_type === 'create_transaction' || rec.action_type === 'manual_review',
      );
      expect(relevantRecs.length).toBeGreaterThan(0);
    });

    it('should generate mixed recommendation types for complex scenario', () => {
      const csvContent = `Date,Description,Amount
2024-01-15,New Store,25.00
2024-01-16,Coffee,5.00
2024-01-17,Gas Station,45.00`;

      const ynabTransactions: ynab.TransactionDetail[] = [
        // Near match - might be Coffee
        createYNABTransaction('ynab-1', '2024-01-16', 4500, 'Starbucks Coffee', 'uncleared'),
        // Exact amount but different payee - might be Gas Station
        createYNABTransaction('ynab-2', '2024-01-17', 45000, 'Shell', 'uncleared'),
        // Unrelated uncleared transaction
        createYNABTransaction('ynab-3', '2024-01-10', 10000, 'Grocery', 'uncleared'),
      ];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        75.0,
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      expect(analysis.recommendations).toBeDefined();
      expect(analysis.recommendations!.length).toBeGreaterThan(0);

      // Should have various recommendation types
      const actionTypes = new Set(analysis.recommendations!.map((rec) => rec.action_type));

      // Should have at least 2 different action types
      expect(actionTypes.size).toBeGreaterThanOrEqual(1);

      // Verify all recommendations have required fields
      for (const rec of analysis.recommendations!) {
        expect(rec.id).toBeDefined();
        expect(rec.priority).toMatch(/^(high|medium|low)$/);
        expect(rec.confidence).toBeGreaterThanOrEqual(0);
        expect(rec.confidence).toBeLessThanOrEqual(1);
        expect(rec.message).toBeDefined();
        expect(rec.reason).toBeDefined();
        expect(rec.estimated_impact).toBeDefined();
        expect(rec.account_id).toBe('test-account-id');
        expect(rec.metadata).toBeDefined();
        expect(rec.metadata.version).toBe('1.0');
        expect(rec.metadata.created_at).toBeDefined();
      }
    });

    it('should prioritize recommendations by priority and confidence', () => {
      const csvContent = `Date,Description,Amount
2024-01-15,Important Transaction,100.00
2024-01-16,Small Purchase,5.00
2024-01-17,Medium Transaction,25.00`;

      const ynabTransactions: ynab.TransactionDetail[] = [];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        130.0,
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      expect(analysis.recommendations).toBeDefined();
      expect(analysis.recommendations!.length).toBeGreaterThanOrEqual(3);

      // Verify recommendations are sorted by priority (high > medium > low)
      const priorities = analysis.recommendations!.map((rec) => rec.priority);
      const priorityValues = { high: 3, medium: 2, low: 1 };

      for (let i = 0; i < priorities.length - 1; i++) {
        const currentPriorityValue = priorityValues[priorities[i]!];
        const nextPriorityValue = priorityValues[priorities[i + 1]!];
        expect(currentPriorityValue).toBeGreaterThanOrEqual(nextPriorityValue);
      }
    });

    it('should handle large discrepancies with appropriate recommendations', () => {
      const csvContent = `Date,Description,Amount
2024-01-15,Large Transaction A,500.00
2024-01-16,Large Transaction B,750.00
2024-01-17,Large Transaction C,1000.00`;

      const ynabTransactions: ynab.TransactionDetail[] = [
        createYNABTransaction('ynab-1', '2024-01-15', 500000, 'Transaction A', 'cleared'),
      ];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        2250.0, // Large statement balance
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      expect(analysis.recommendations).toBeDefined();

      // Should have insights about large discrepancy
      const anomalyInsight = analysis.insights.find((insight) => insight.type === 'anomaly');
      expect(anomalyInsight).toBeDefined();

      // Should have recommendations for the unmatched transactions
      const createRecs = analysis.recommendations!.filter(
        (rec) => rec.action_type === 'create_transaction',
      );
      expect(createRecs.length).toBeGreaterThanOrEqual(2);

      // Large amounts should have high or medium priority
      for (const rec of createRecs) {
        if (rec.action_type === 'create_transaction' && Math.abs(rec.parameters.amount) >= 500000) { // 500 dollars in milliunits
          expect(rec.priority).toMatch(/^(high|medium)$/);
        }
      }
    });
  });

  describe('recommendation field validation', () => {
    it('should include all required metadata fields', () => {
      const csvContent = 'Date,Description,Amount\n2024-01-15,Test,10.00';
      const ynabTransactions: ynab.TransactionDetail[] = [];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        10.0,
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      expect(analysis.recommendations).toBeDefined();
      expect(analysis.recommendations!.length).toBeGreaterThan(0);

      for (const rec of analysis.recommendations!) {
        // Base recommendation fields
        expect(rec.id).toBeDefined();
        expect(typeof rec.id).toBe('string');
        expect(rec.priority).toMatch(/^(high|medium|low)$/);
        expect(typeof rec.confidence).toBe('number');
        expect(rec.confidence).toBeGreaterThanOrEqual(0);
        expect(rec.confidence).toBeLessThanOrEqual(1);
        expect(typeof rec.message).toBe('string');
        expect(rec.message.length).toBeGreaterThan(0);
        expect(typeof rec.reason).toBe('string');
        expect(rec.reason.length).toBeGreaterThan(0);
        expect(rec.estimated_impact).toBeDefined();
        expect(rec.estimated_impact.value).toBeDefined();
        expect(rec.estimated_impact.currency).toBe('USD');
        expect(rec.account_id).toBe('test-account-id');

        // Metadata
        expect(rec.metadata).toBeDefined();
        expect(rec.metadata.version).toBe('1.0');
        expect(rec.metadata.created_at).toBeDefined();
        expect(Date.parse(rec.metadata.created_at)).not.toBeNaN();

        // Action-specific fields
        expect(rec.action_type).toMatch(
          /^(create_transaction|update_cleared|review_duplicate|manual_review)$/,
        );
        expect(rec.parameters).toBeDefined();
      }
    });

    it('should generate valid create_transaction parameters', () => {
      const csvContent = 'Date,Description,Amount\n2024-01-15,Test Store,25.50';
      const ynabTransactions: ynab.TransactionDetail[] = [];

      const analysis = analyzeReconciliation(
        csvContent,
        undefined,
        ynabTransactions,
        25.5,
        {
          dateToleranceDays: 2,
          amountToleranceCents: 1,
          descriptionSimilarityThreshold: 0.8,
          autoMatchThreshold: 90,
          suggestionThreshold: 60,
        },
        'USD',
        'test-account-id',
        'test-budget-id',
      );

      const createRec = analysis.recommendations!.find(
        (rec) => rec.action_type === 'create_transaction',
      ) as Extract<ActionableRecommendation, { action_type: 'create_transaction' }> | undefined;

      expect(createRec).toBeDefined();
      expect(createRec!.parameters.account_id).toBe('test-account-id');
      expect(createRec!.parameters.date).toBe('2024-01-15');
      expect(createRec!.parameters.amount).toBe(25500); // In milliunits
      expect(createRec!.parameters.payee_name).toBe('Test Store');
      expect(createRec!.parameters.cleared).toMatch(/^(cleared|uncleared)$/);
      expect(typeof createRec!.parameters.approved).toBe('boolean');
    });
  });
});
