import { handleCreateTransaction } from './dist/tools/transactionTools.js';
import * as ynab from 'ynab';
import { vi } from 'vitest';

const mockYnabAPI = {
  transactions: {
    createTransaction: async () => ({
      data: {
        transaction: {
          id: 'new-transaction-123',
          date: '2024-01-01',
          amount: -50000,
          memo: null,
          cleared: 'cleared',
          approved: true,
          flag_color: 'red',
          account_id: 'account-456',
        }
      }
    }),
  },
  accounts: {
    getAccountById: async () => ({
      data: {
        account: {
          id: 'account-456',
          balance: 100000,
          cleared_balance: 95000,
        }
      }
    })
  }
};

const params = {
  budget_id: 'budget-123',
  account_id: 'account-456',
  amount: -50000,
  date: '2024-01-01',
};

try {
  const result = await handleCreateTransaction(mockYnabAPI, params);
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Error:', error);
}
