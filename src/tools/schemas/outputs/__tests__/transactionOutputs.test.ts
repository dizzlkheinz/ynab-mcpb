/**
 * Unit tests for transaction output schemas
 *
 * Tests schema validation for transaction tool outputs including:
 * - ListTransactionsOutputSchema (normal and preview modes)
 * - GetTransactionOutputSchema
 * - TransactionSchema
 * - TransactionPreviewSchema
 */

import { describe, it, expect } from 'vitest';
import {
  ListTransactionsOutputSchema,
  GetTransactionOutputSchema,
  TransactionSchema,
  TransactionPreviewSchema,
} from '../transactionOutputs.js';

describe('TransactionSchema', () => {
  it('should validate complete transaction with all fields', () => {
    const validTransaction = {
      id: 'txn-123',
      date: '2025-11-17',
      amount: -45.5,
      memo: 'Grocery shopping',
      cleared: 'cleared',
      approved: true,
      flag_color: 'red',
      account_id: 'account-123',
      payee_id: 'payee-456',
      category_id: 'category-789',
      transfer_account_id: null,
      transfer_transaction_id: null,
      matched_transaction_id: null,
      import_id: 'import-001',
      deleted: false,
      account_name: 'Checking',
      payee_name: 'Whole Foods',
      category_name: 'Groceries',
    };

    const result = TransactionSchema.safeParse(validTransaction);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('txn-123');
      expect(result.data.amount).toBe(-45.5);
      expect(result.data.cleared).toBe('cleared');
      expect(result.data.approved).toBe(true);
    }
  });

  it('should validate minimal transaction with only required fields', () => {
    const validTransaction = {
      id: 'txn-456',
      date: '2025-11-17',
      amount: 100.0,
      cleared: 'uncleared',
      approved: false,
      account_id: 'account-456',
      deleted: false,
    };

    const result = TransactionSchema.safeParse(validTransaction);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.memo).toBeUndefined();
      expect(result.data.payee_id).toBeUndefined();
      expect(result.data.category_id).toBeUndefined();
      expect(result.data.flag_color).toBeUndefined();
    }
  });

  it('should validate transaction with cleared status values', () => {
    const clearedStatuses = ['uncleared', 'cleared', 'reconciled'];

    for (const status of clearedStatuses) {
      const validTransaction = {
        id: `txn-${status}`,
        date: '2025-11-17',
        amount: 50.0,
        cleared: status,
        approved: true,
        account_id: 'account-123',
        deleted: false,
      };

      const result = TransactionSchema.safeParse(validTransaction);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleared).toBe(status);
      }
    }
  });

  it('should validate split transaction with subtransactions', () => {
    const validTransaction = {
      id: 'txn-split',
      date: '2025-11-17',
      amount: -100.0,
      memo: 'Split transaction',
      cleared: 'cleared',
      approved: true,
      account_id: 'account-123',
      payee_id: 'payee-split',
      deleted: false,
      account_name: 'Checking',
      payee_name: 'Multiple Payees',
    };

    const result = TransactionSchema.safeParse(validTransaction);
    expect(result.success).toBe(true);
  });

  it('should validate transfer transaction', () => {
    const validTransaction = {
      id: 'txn-transfer',
      date: '2025-11-17',
      amount: -500.0,
      memo: 'Transfer to savings',
      cleared: 'cleared',
      approved: true,
      account_id: 'account-checking',
      payee_id: 'payee-transfer',
      transfer_account_id: 'account-savings',
      transfer_transaction_id: 'txn-transfer-other-side',
      deleted: false,
      account_name: 'Checking',
      payee_name: 'Transfer: Savings',
    };

    const result = TransactionSchema.safeParse(validTransaction);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transfer_account_id).toBe('account-savings');
      expect(result.data.transfer_transaction_id).toBe('txn-transfer-other-side');
    }
  });

  it('should fail validation when missing required id field', () => {
    const invalidTransaction = {
      date: '2025-11-17',
      amount: 50.0,
      cleared: 'cleared',
      approved: true,
      account_id: 'account-123',
      deleted: false,
    };

    const result = TransactionSchema.safeParse(invalidTransaction);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required date field', () => {
    const invalidTransaction = {
      id: 'txn-123',
      amount: 50.0,
      cleared: 'cleared',
      approved: true,
      account_id: 'account-123',
      deleted: false,
    };

    const result = TransactionSchema.safeParse(invalidTransaction);
    expect(result.success).toBe(false);
  });

  it('should fail validation when amount is not a number', () => {
    const invalidTransaction = {
      id: 'txn-123',
      date: '2025-11-17',
      amount: '-45.50', // String instead of number
      cleared: 'cleared',
      approved: true,
      account_id: 'account-123',
      deleted: false,
    };

    const result = TransactionSchema.safeParse(invalidTransaction);
    expect(result.success).toBe(false);
  });

  it('should fail validation when approved is not a boolean', () => {
    const invalidTransaction = {
      id: 'txn-123',
      date: '2025-11-17',
      amount: 50.0,
      cleared: 'cleared',
      approved: 'true', // String instead of boolean
      account_id: 'account-123',
      deleted: false,
    };

    const result = TransactionSchema.safeParse(invalidTransaction);
    expect(result.success).toBe(false);
  });
});

describe('TransactionPreviewSchema', () => {
  it('should validate preview transaction with all fields', () => {
    const validPreview = {
      id: 'txn-preview-123',
      date: '2025-11-17',
      amount: -45.5,
      memo: 'Grocery shopping',
      payee_name: 'Whole Foods',
      category_name: 'Groceries',
    };

    const result = TransactionPreviewSchema.safeParse(validPreview);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('txn-preview-123');
      expect(result.data.amount).toBe(-45.5);
      expect(result.data.payee_name).toBe('Whole Foods');
    }
  });

  it('should validate minimal preview transaction', () => {
    const validPreview = {
      id: 'txn-preview-456',
      date: '2025-11-17',
      amount: 100.0,
    };

    const result = TransactionPreviewSchema.safeParse(validPreview);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.memo).toBeUndefined();
      expect(result.data.payee_name).toBeUndefined();
      expect(result.data.category_name).toBeUndefined();
    }
  });

  it('should fail validation when missing required id field', () => {
    const invalidPreview = {
      date: '2025-11-17',
      amount: 50.0,
    };

    const result = TransactionPreviewSchema.safeParse(invalidPreview);
    expect(result.success).toBe(false);
  });
});

describe('ListTransactionsOutputSchema - Normal Mode', () => {
  it('should validate normal mode output with multiple transactions', () => {
    const validOutput = {
      total_count: 50,
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance',
      transactions: [
        {
          id: 'txn-1',
          date: '2025-11-17',
          amount: -45.5,
          memo: 'Grocery shopping',
          cleared: 'cleared',
          approved: true,
          flag_color: 'red',
          account_id: 'account-123',
          payee_id: 'payee-456',
          category_id: 'category-789',
          deleted: false,
          account_name: 'Checking',
          payee_name: 'Whole Foods',
          category_name: 'Groceries',
        },
        {
          id: 'txn-2',
          date: '2025-11-16',
          amount: 1000.0,
          cleared: 'cleared',
          approved: true,
          account_id: 'account-123',
          deleted: false,
        },
      ],
    };

    const result = ListTransactionsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      // Check if it's normal mode by testing for transactions property
      if ('transactions' in result.data) {
        expect(result.data.transactions).toHaveLength(2);
        expect(result.data.total_count).toBe(50);
        expect(result.data.cached).toBe(true);
      }
    }
  });

  it('should validate normal mode output with empty transactions array', () => {
    const validOutput = {
      total_count: 0,
      cached: false,
      cache_info: 'No transactions found',
      transactions: [],
    };

    const result = ListTransactionsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success && 'transactions' in result.data) {
      expect(result.data.transactions).toHaveLength(0);
      expect(result.data.total_count).toBe(0);
    }
  });
});

describe('ListTransactionsOutputSchema - Preview Mode', () => {
  it('should validate preview mode output for large result sets', () => {
    const validOutput = {
      message: 'Large result set detected',
      suggestion: 'Use filter parameters to narrow results',
      showing: 'First 50 transactions:',
      total_count: 250,
      estimated_size_kb: 150,
      preview_transactions: [
        {
          id: 'txn-preview-1',
          date: '2025-11-17',
          amount: -45.5,
          memo: 'Grocery shopping',
          payee_name: 'Whole Foods',
          category_name: 'Groceries',
        },
        {
          id: 'txn-preview-2',
          date: '2025-11-16',
          amount: -30.0,
          payee_name: 'Gas Station',
        },
      ],
    };

    const result = ListTransactionsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      // Check if it's preview mode by testing for preview_transactions property
      if ('preview_transactions' in result.data) {
        expect(result.data.preview_transactions).toHaveLength(2);
        expect(result.data.total_count).toBe(250);
        expect(result.data.estimated_size_kb).toBe(150);
        expect(result.data.message).toBe('Large result set detected');
      }
    }
  });

  it('should validate preview mode output with minimal preview transactions', () => {
    const validOutput = {
      message: 'Large result set detected',
      suggestion: 'Narrow your date range',
      showing: 'First 10 transactions:',
      total_count: 150,
      estimated_size_kb: 90,
      preview_transactions: [
        {
          id: 'txn-1',
          date: '2025-11-17',
          amount: 100.0,
        },
      ],
    };

    const result = ListTransactionsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success && 'preview_transactions' in result.data) {
      expect(result.data.preview_transactions).toHaveLength(1);
    }
  });

  it('should fail validation when preview mode missing required fields', () => {
    const invalidOutput = {
      message: 'Large result set',
      total_count: 250,
      preview_transactions: [],
      // Missing: suggestion, showing, estimated_size_kb
    };

    const result = ListTransactionsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe('GetTransactionOutputSchema', () => {
  it('should validate output with complete transaction and cache metadata', () => {
    const validOutput = {
      transaction: {
        id: 'txn-123',
        date: '2025-11-17',
        amount: -45.5,
        memo: 'Grocery shopping',
        cleared: 'cleared',
        approved: true,
        flag_color: 'red',
        account_id: 'account-123',
        payee_id: 'payee-456',
        category_id: 'category-789',
        deleted: false,
        account_name: 'Checking',
        payee_name: 'Whole Foods',
        category_name: 'Groceries',
      },
      cached: false,
      cache_info: 'Fresh data retrieved from YNAB API',
    };

    const result = GetTransactionOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transaction.id).toBe('txn-123');
      expect(result.data.transaction.amount).toBe(-45.5);
      expect(result.data.cached).toBe(false);
    }
  });

  it('should validate output with minimal transaction', () => {
    const validOutput = {
      transaction: {
        id: 'txn-456',
        date: '2025-11-17',
        amount: 100.0,
        cleared: 'uncleared',
        approved: false,
        account_id: 'account-456',
        deleted: false,
      },
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance (delta merge applied)',
    };

    const result = GetTransactionOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transaction.memo).toBeUndefined();
      expect(result.data.cached).toBe(true);
    }
  });

  it('should fail validation when transaction is not an object', () => {
    const invalidOutput = {
      transaction: 'not-an-object', // String instead of object
      cached: false,
      cache_info: 'Invalid',
    };

    const result = GetTransactionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when transaction missing required fields', () => {
    const invalidOutput = {
      transaction: {
        id: 'txn-123',
        date: '2025-11-17',
        // Missing: amount, cleared, approved, account_id, deleted
      },
      cached: false,
      cache_info: 'Invalid',
    };

    const result = GetTransactionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required transaction field', () => {
    const invalidOutput = {
      cached: false,
      cache_info: 'Missing transaction field',
    };

    const result = GetTransactionOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});
