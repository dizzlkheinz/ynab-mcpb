import { describe, it, expect } from 'vitest';
import {
  ExecutionActionRecordSchema,
  CreatedTransactionSchema,
  TransactionCreationPayloadSchema,
  TransactionUpdatePayloadSchema,
  DuplicateDetectionPayloadSchema,
} from '../reconciliationOutputs.js';

describe('reconciliationOutputs', () => {
  describe('ExecutionActionRecordSchema', () => {
    describe('create_transaction type', () => {
      it('should validate successful transaction creation with full response', () => {
        const valid = {
          type: 'create_transaction',
          transaction: {
            id: 'txn-123',
            date: '2025-01-15',
            amount: -25500,
            memo: 'Auto-reconciled from bank statement',
            cleared: 'cleared',
            approved: true,
            payee_name: 'Coffee Shop',
            category_name: 'Dining Out',
            import_id: 'YNAB:bulk:abc123',
          },
          reason: 'Created missing transaction: Coffee Shop ($25.50)',
          bulk_chunk_index: 1,
          correlation_key: 'hash:abc123',
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate successful transaction creation with null transaction', () => {
        const valid = {
          type: 'create_transaction',
          transaction: null,
          reason: 'Created missing transaction: Coffee Shop ($25.50)',
          correlation_key: 'hash:abc123',
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should accept additional YNAB API fields via passthrough', () => {
        const valid = {
          type: 'create_transaction',
          transaction: {
            id: 'txn-123',
            date: '2025-01-15',
            amount: -25500,
            // Additional YNAB API fields that might be present
            account_name: 'Checking Account',
            deleted: false,
            flag_color: null,
          },
          reason: 'Created missing transaction',
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('create_transaction_failed type', () => {
      it('should validate failed transaction creation with payload', () => {
        const valid = {
          type: 'create_transaction_failed',
          transaction: {
            account_id: 'acct-123',
            date: '2025-01-15',
            amount: -25500,
            payee_name: 'Coffee Shop',
            memo: 'Auto-reconciled from bank statement',
            cleared: 'cleared',
            approved: true,
            import_id: 'YNAB:bulk:abc123',
          },
          reason: 'Bulk fallback failed for Coffee Shop (API error)',
          bulk_chunk_index: 2,
          correlation_key: 'hash:abc123',
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should reject when transaction is null for failed creation', () => {
        const invalid = {
          type: 'create_transaction_failed',
          transaction: null, // Should be a payload object, not null
          reason: 'Failed to create transaction',
        };

        const result = ExecutionActionRecordSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('create_transaction_duplicate type', () => {
      it('should validate duplicate detection with transaction ID', () => {
        const valid = {
          type: 'create_transaction_duplicate',
          transaction: {
            transaction_id: 'txn-existing-123',
            import_id: 'YNAB:bulk:abc123',
          },
          reason: 'Duplicate import detected for Coffee Shop (import_id YNAB:bulk:abc123)',
          bulk_chunk_index: 1,
          correlation_key: 'hash:abc123',
          duplicate: true,
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate duplicate detection with null transaction ID', () => {
        const valid = {
          type: 'create_transaction_duplicate',
          transaction: {
            transaction_id: null,
            import_id: 'YNAB:bulk:abc123',
          },
          reason: 'Duplicate import detected',
          bulk_chunk_index: 1,
          duplicate: true,
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should require duplicate field to be true', () => {
        const invalid = {
          type: 'create_transaction_duplicate',
          transaction: {
            transaction_id: 'txn-123',
            import_id: 'YNAB:bulk:abc123',
          },
          reason: 'Duplicate detected',
          bulk_chunk_index: 1,
          duplicate: false, // Must be true
        };

        const result = ExecutionActionRecordSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should require bulk_chunk_index for duplicates', () => {
        const invalid = {
          type: 'create_transaction_duplicate',
          transaction: {
            transaction_id: 'txn-123',
            import_id: 'YNAB:bulk:abc123',
          },
          reason: 'Duplicate detected',
          duplicate: true,
          // Missing bulk_chunk_index - required for this type
        };

        const result = ExecutionActionRecordSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('update_transaction type', () => {
      it('should validate update with full created transaction (real execution)', () => {
        const valid = {
          type: 'update_transaction',
          transaction: {
            id: 'txn-123',
            date: '2025-01-15',
            amount: -25500,
            cleared: 'cleared',
            approved: true,
          },
          reason: 'Updated transaction: marked as cleared',
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate update with partial payload (dry run)', () => {
        const valid = {
          type: 'update_transaction',
          transaction: {
            transaction_id: 'txn-123',
            new_date: '2025-01-16',
            cleared: 'cleared',
          },
          reason: 'Would update transaction: marked as cleared, date adjusted to 2025-01-16',
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate update with null transaction', () => {
        const valid = {
          type: 'update_transaction',
          transaction: null,
          reason: 'Updated transaction: marked as cleared',
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('balance_checkpoint type', () => {
      it('should validate balance checkpoint', () => {
        const valid = {
          type: 'balance_checkpoint',
          transaction: null,
          reason:
            'Cleared delta $0.05 within ±$0.10 after creating Coffee Shop - halting newest-to-oldest pass',
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should require transaction to be null for balance checkpoint', () => {
        const invalid = {
          type: 'balance_checkpoint',
          transaction: { id: 'txn-123' }, // Must be null
          reason: 'Balance aligned',
        };

        const result = ExecutionActionRecordSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('bulk_create_fallback type', () => {
      it('should validate bulk create fallback', () => {
        const valid = {
          type: 'bulk_create_fallback',
          transaction: null,
          reason: 'Bulk chunk #1 failed (API error) - falling back to sequential creation',
          bulk_chunk_index: 1,
        };

        const result = ExecutionActionRecordSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should require bulk_chunk_index for fallback', () => {
        const invalid = {
          type: 'bulk_create_fallback',
          transaction: null,
          reason: 'Bulk failed',
          // Missing bulk_chunk_index - required for this type
        };

        const result = ExecutionActionRecordSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });
    });

    describe('discriminated union behavior', () => {
      it('should reject unknown action types', () => {
        const invalid = {
          type: 'unknown_action_type',
          transaction: null,
          reason: 'Some reason',
        };

        const result = ExecutionActionRecordSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should provide clear error messages for type mismatches', () => {
        const invalid = {
          type: 'create_transaction',
          transaction: {
            // Wrong shape - looks like creation payload not created transaction
            account_id: 'acct-123',
            date: '2025-01-15',
            amount: -25500,
          },
          reason: 'Created transaction',
        };

        const result = ExecutionActionRecordSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          // Should have validation errors for missing required fields
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Helper schemas', () => {
    describe('CreatedTransactionSchema', () => {
      it('should validate minimal created transaction', () => {
        const valid = {
          id: 'txn-123',
          date: '2025-01-15',
          amount: -25500,
        };

        const result = CreatedTransactionSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should allow passthrough fields', () => {
        const valid = {
          id: 'txn-123',
          date: '2025-01-15',
          amount: -25500,
          // Extra fields from YNAB API
          subtransactions: [],
          transfer_account_id: null,
        };

        const result = CreatedTransactionSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('TransactionCreationPayloadSchema', () => {
      it('should validate minimal creation payload', () => {
        const valid = {
          account_id: 'acct-123',
          date: '2025-01-15',
          amount: -25500,
        };

        const result = TransactionCreationPayloadSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate full creation payload', () => {
        const valid = {
          account_id: 'acct-123',
          date: '2025-01-15',
          amount: -25500,
          payee_name: 'Coffee Shop',
          memo: 'Auto-reconciled',
          cleared: 'cleared',
          approved: true,
          import_id: 'YNAB:bulk:abc123',
        };

        const result = TransactionCreationPayloadSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('TransactionUpdatePayloadSchema', () => {
      it('should validate update with all fields', () => {
        const valid = {
          transaction_id: 'txn-123',
          new_date: '2025-01-16',
          cleared: 'uncleared',
        };

        const result = TransactionUpdatePayloadSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate update with only transaction_id', () => {
        const valid = {
          transaction_id: 'txn-123',
        };

        const result = TransactionUpdatePayloadSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('DuplicateDetectionPayloadSchema', () => {
      it('should validate with both fields', () => {
        const valid = {
          transaction_id: 'txn-123',
          import_id: 'YNAB:bulk:abc123',
        };

        const result = DuplicateDetectionPayloadSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate with null transaction_id', () => {
        const valid = {
          transaction_id: null,
          import_id: 'YNAB:bulk:abc123',
        };

        const result = DuplicateDetectionPayloadSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });
  });
});
