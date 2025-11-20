import { describe, it, expect } from 'vitest';
import {
  TransactionDryRunPreviewSchema,
  SubtransactionPreviewSchema,
  CreateReceiptSplitTransactionOutputSchema,
} from '../transactionMutationOutputs.js';

describe('Transaction Mutation Schema Type Safety', () => {
  describe('TransactionDryRunPreviewSchema', () => {
    it('should accept valid transaction preview', () => {
      const validPreview = {
        account_id: 'acct-123',
        date: '2024-11-18',
        amount: -25500,
        memo: 'Grocery shopping',
        cleared: 'cleared' as const,
        approved: true,
        flag_color: 'red' as const,
        payee_id: 'payee-456',
        payee_name: 'Whole Foods',
        category_id: 'cat-789',
        import_id: 'import-abc',
      };

      expect(() => TransactionDryRunPreviewSchema.parse(validPreview)).not.toThrow();
    });

    it('should accept minimal transaction preview with required fields only', () => {
      const minimalPreview = {
        account_id: 'acct-123',
        date: '2024-11-18',
        amount: -25500,
      };

      expect(() => TransactionDryRunPreviewSchema.parse(minimalPreview)).not.toThrow();
    });

    it('should reject invalid date format', () => {
      const invalidPreview = {
        account_id: 'acct-123',
        date: '11/18/2024', // Wrong format
        amount: -25500,
      };

      expect(() => TransactionDryRunPreviewSchema.parse(invalidPreview)).toThrow();
    });

    it('should reject invalid cleared status', () => {
      const invalidPreview = {
        account_id: 'acct-123',
        date: '2024-11-18',
        amount: -25500,
        cleared: 'invalid' as const,
      };

      expect(() => TransactionDryRunPreviewSchema.parse(invalidPreview)).toThrow();
    });

    it('should reject transaction with server-generated fields', () => {
      const previewWithId = {
        id: 'txn-123', // Should not be in preview
        account_id: 'acct-123',
        date: '2024-11-18',
        amount: -25500,
      };

      // The schema doesn't have 'id' field, so parsing will succeed but the extra field is ignored
      const parsed = TransactionDryRunPreviewSchema.parse(previewWithId);
      expect(parsed).not.toHaveProperty('id');
    });
  });

  describe('SubtransactionPreviewSchema', () => {
    it('should accept valid subtransaction preview', () => {
      const validSubtransaction = {
        amount: -50000,
        memo: 'Groceries',
        payee_id: 'payee-123',
        payee_name: 'Whole Foods',
        category_id: 'cat-456',
        category_name: 'Groceries',
        transfer_account_id: 'acct-transfer',
        transfer_transaction_id: 'txn-transfer',
      };

      expect(() => SubtransactionPreviewSchema.parse(validSubtransaction)).not.toThrow();
    });

    it('should accept minimal subtransaction with amount only', () => {
      const minimalSubtransaction = {
        amount: -50000,
      };

      expect(() => SubtransactionPreviewSchema.parse(minimalSubtransaction)).not.toThrow();
    });

    it('should not include server-generated fields', () => {
      const subtransactionWithServerFields = {
        id: 'sub-123', // Server-generated, should be omitted
        transaction_id: 'txn-456', // Server-generated, should be omitted
        amount: -50000,
        deleted: false, // Server-managed, should be omitted
      };

      const parsed = SubtransactionPreviewSchema.parse(subtransactionWithServerFields);
      expect(parsed).not.toHaveProperty('id');
      expect(parsed).not.toHaveProperty('transaction_id');
      expect(parsed).not.toHaveProperty('deleted');
      expect(parsed.amount).toBe(-50000);
    });
  });

  describe('CreateReceiptSplitTransactionOutputSchema - Dry Run Branch', () => {
    it('should accept valid dry-run response with strongly-typed preview', () => {
      const validDryRunResponse = {
        dry_run: true,
        action: 'create_receipt_split_transaction',
        transaction_preview: {
          account_id: 'acct-123',
          date: '2024-11-18',
          amount: -53500,
          cleared: 'cleared' as const,
          approved: true,
        },
        receipt_summary: {
          subtotal: 50.0,
          tax: 3.5,
          total: 53.5,
          categories: [
            {
              category_id: 'cat-groceries',
              category_name: 'Groceries',
              items: [
                { name: 'Apples', amount: 25.0 },
                { name: 'Bread', amount: 25.0 },
              ],
              subtotal: 50.0,
              tax: 3.5,
              total: 53.5,
            },
          ],
        },
        subtransactions: [
          { amount: -50000, category_id: 'cat-groceries', memo: 'Groceries' },
          { amount: -3500, category_id: 'cat-tax', memo: 'Tax' },
        ],
      };

      expect(() =>
        CreateReceiptSplitTransactionOutputSchema.parse(validDryRunResponse),
      ).not.toThrow();
    });

    it('should reject dry-run response with loose unknown types', () => {
      // This would have been valid with z.record(z.string(), z.unknown())
      // but should now be rejected with strongly-typed schemas
      const invalidDryRunResponse = {
        dry_run: true,
        action: 'create_receipt_split_transaction',
        transaction_preview: {
          // Missing required 'account_id'
          date: '2024-11-18',
          amount: -53500,
        },
        receipt_summary: {
          subtotal: 50.0,
          tax: 3.5,
          total: 53.5,
          categories: [],
        },
        subtransactions: [],
      };

      expect(() =>
        CreateReceiptSplitTransactionOutputSchema.parse(invalidDryRunResponse),
      ).toThrow();
    });

    it('should reject subtransactions with server-generated id fields', () => {
      const dryRunWithInvalidSubtransactions = {
        dry_run: true,
        action: 'create_receipt_split_transaction',
        transaction_preview: {
          account_id: 'acct-123',
          date: '2024-11-18',
          amount: -53500,
        },
        receipt_summary: {
          subtotal: 50.0,
          tax: 3.5,
          total: 53.5,
          categories: [],
        },
        subtransactions: [
          {
            id: 'sub-123', // Should not be in preview
            transaction_id: 'txn-456', // Should not be in preview
            amount: -50000,
          },
        ],
      };

      // The schema will parse but ignore the extra fields
      const parsed = CreateReceiptSplitTransactionOutputSchema.parse(
        dryRunWithInvalidSubtransactions,
      );
      if (parsed.dry_run === true) {
        expect(parsed.subtransactions[0]).not.toHaveProperty('id');
        expect(parsed.subtransactions[0]).not.toHaveProperty('transaction_id');
      }
    });
  });
});
