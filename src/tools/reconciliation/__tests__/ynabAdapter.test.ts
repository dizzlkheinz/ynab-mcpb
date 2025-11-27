import { describe, it, expect } from 'vitest';
import type * as ynab from 'ynab';
import { normalizeYNABTransaction, normalizeYNABTransactions } from '../ynabAdapter.js';

describe('ynabAdapter', () => {
  const mockTransaction: ynab.TransactionDetail = {
    id: 'test-id-1',
    date: '2024-01-01',
    amount: -10000,
    payee_name: 'Test Payee',
    memo: 'Test Memo',
    category_name: 'Test Category',
    cleared: 'uncleared' as ynab.TransactionClearedStatus,
    approved: false,
    account_id: 'account-1',
    deleted: false,
    account_name: 'Test Account',
    subtransactions: []
  };

  it('should normalize a single transaction correctly', () => {
    const result = normalizeYNABTransaction(mockTransaction);
    
    expect(result).toEqual({
      id: 'test-id-1',
      date: '2024-01-01',
      amount: -10000,
      payee: 'Test Payee',
      memo: 'Test Memo',
      categoryName: 'Test Category',
      cleared: 'uncleared',
      approved: false,
    });
  });

  it('should handle null fields correctly', () => {
    const minimalTransaction: ynab.TransactionDetail = {
      ...mockTransaction,
      payee_name: null as any, // SDK typing might say string | undefined/null
      memo: null as any,
      category_name: null as any,
    };

    const result = normalizeYNABTransaction(minimalTransaction);
    
    expect(result.payee).toBeNull();
    expect(result.memo).toBeNull();
    expect(result.categoryName).toBeNull();
  });

  it('should normalize multiple transactions', () => {
    const transactions = [
      mockTransaction,
      { ...mockTransaction, id: 'test-id-2', amount: 5000 }
    ];

    const results = normalizeYNABTransactions(transactions);
    
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('test-id-1');
    expect(results[1].id).toBe('test-id-2');
    expect(results[1].amount).toBe(5000);
  });
});
