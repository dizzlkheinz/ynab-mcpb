import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ynab from 'ynab';
import {
  handleListTransactions,
  handleGetTransaction,
  handleCreateTransaction,
  handleUpdateTransaction,
  handleDeleteTransaction,
  ListTransactionsSchema,
  GetTransactionSchema,
  CreateTransactionSchema,
  UpdateTransactionSchema,
  DeleteTransactionSchema,
} from '../transactionTools.js';

// Mock the cache manager
vi.mock('../../server/cacheManager.js', () => ({
  cacheManager: {
    wrap: vi.fn(),
    has: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  },
  CacheManager: {
    generateKey: vi.fn(),
  },
  CACHE_TTLS: {
    TRANSACTIONS: 180000,
  },
}));

// Mock the YNAB API
const mockYnabAPI = {
  transactions: {
    getTransactions: vi.fn(),
    getTransactionsByAccount: vi.fn(),
    getTransactionsByCategory: vi.fn(),
    getTransactionById: vi.fn(),
    createTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
  },
  accounts: {
    getAccountById: vi.fn(),
  },
} as unknown as ynab.API;

// Import mocked cache manager
const { cacheManager, CacheManager, CACHE_TTLS } = await import('../../server/cacheManager.js');

describe('transactionTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset NODE_ENV to test to ensure cache bypassing in tests
    process.env['NODE_ENV'] = 'test';
  });

  describe('ListTransactionsSchema', () => {
    it('should validate valid parameters', () => {
      const validParams = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        category_id: 'category-789',
        since_date: '2024-01-01',
        type: 'uncategorized' as const,
      };

      const result = ListTransactionsSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('should require budget_id', () => {
      const invalidParams = {
        account_id: 'account-456',
      };

      const result = ListTransactionsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].path).toEqual(['budget_id']);
      }
    });

    it('should validate date format', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        since_date: '01/01/2024', // Invalid format
      };

      const result = ListTransactionsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Date must be in ISO format');
      }
    });

    it('should validate type enum', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        type: 'invalid-type',
      };

      const result = ListTransactionsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should allow optional parameters to be undefined', () => {
      const minimalParams = {
        budget_id: 'budget-123',
      };

      const result = ListTransactionsSchema.safeParse(minimalParams);
      expect(result.success).toBe(true);
    });
  });

  describe('handleListTransactions', () => {
    const mockTransaction = {
      id: 'transaction-123',
      date: '2024-01-01',
      amount: -50000, // $50.00 outflow in milliunits
      memo: 'Test transaction',
      cleared: 'cleared' as any,
      approved: true,
      flag_color: null,
      account_id: 'account-456',
      payee_id: 'payee-789',
      category_id: 'category-101',
      transfer_account_id: null,
      transfer_transaction_id: null,
      matched_transaction_id: null,
      import_id: null,
      deleted: false,
      subtransactions: [],
    };

    it('should bypass cache in test environment for unfiltered requests', async () => {
      const mockResponse = {
        data: {
          transactions: [mockTransaction],
        },
      };

      (mockYnabAPI.transactions.getTransactions as any).mockResolvedValue(mockResponse);

      const params = { budget_id: 'budget-123' };
      const result = await handleListTransactions(mockYnabAPI, params);

      // In test environment, cache should be bypassed
      expect(cacheManager.wrap).not.toHaveBeenCalled();
      expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledWith(
        'budget-123',
        undefined,
        undefined,
      );

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.cached).toBe(false);
      expect(parsedContent.cache_info).toBe('Fresh data retrieved from YNAB API');
      expect(parsedContent.transactions[0].id).toBe('transaction-123');
    });

    it('should use cache when NODE_ENV is not test for unfiltered requests', async () => {
      // Temporarily set NODE_ENV to non-test
      process.env['NODE_ENV'] = 'development';

      const mockCacheKey = 'transactions:list:budget-123:generated-key';
      (CacheManager.generateKey as any).mockReturnValue(mockCacheKey);
      (cacheManager.wrap as any).mockResolvedValue([mockTransaction]);
      (cacheManager.has as any).mockReturnValue(true);

      const params = { budget_id: 'budget-123' };
      const result = await handleListTransactions(mockYnabAPI, params);

      // Verify cache was used for unfiltered request
      expect(CacheManager.generateKey).toHaveBeenCalledWith('transactions', 'list', 'budget-123');
      expect(cacheManager.wrap).toHaveBeenCalledWith(mockCacheKey, {
        ttl: CACHE_TTLS.TRANSACTIONS,
        loader: expect.any(Function),
      });
      expect(cacheManager.has).toHaveBeenCalledWith(mockCacheKey);

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.cached).toBe(true);
      expect(parsedContent.cache_info).toBe('Data retrieved from cache for improved performance');

      // Reset NODE_ENV
      process.env['NODE_ENV'] = 'test';
    });

    it('should not cache filtered requests (account_id)', async () => {
      // Temporarily set NODE_ENV to non-test
      process.env['NODE_ENV'] = 'development';

      const mockResponse = {
        data: {
          transactions: [mockTransaction],
        },
      };

      (mockYnabAPI.transactions.getTransactionsByAccount as any).mockResolvedValue(mockResponse);

      const params = {
        budget_id: 'budget-123',
        account_id: 'account-456',
      };
      const result = await handleListTransactions(mockYnabAPI, params);

      // Verify cache was NOT used for filtered request
      expect(cacheManager.wrap).not.toHaveBeenCalled();
      expect(mockYnabAPI.transactions.getTransactionsByAccount).toHaveBeenCalledWith(
        'budget-123',
        'account-456',
        undefined,
      );

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.cached).toBe(false);
      expect(parsedContent.cache_info).toBe('Fresh data retrieved from YNAB API');

      // Reset NODE_ENV
      process.env['NODE_ENV'] = 'test';
    });

    it('should list all transactions when no filters are provided', async () => {
      const mockResponse = {
        data: {
          transactions: [mockTransaction],
        },
      };

      (mockYnabAPI.transactions.getTransactions as any).mockResolvedValue(mockResponse);

      const params = { budget_id: 'budget-123' };
      const result = await handleListTransactions(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledWith(
        'budget-123',
        undefined,
        undefined,
      );
      expect(result.content[0].text).toContain('transaction-123');
      expect(result.content[0].text).toContain('-50');
    });

    it('should filter by account_id when provided', async () => {
      const mockResponse = {
        data: {
          transactions: [mockTransaction],
        },
      };

      (mockYnabAPI.transactions.getTransactionsByAccount as any).mockResolvedValue(mockResponse);

      const params = {
        budget_id: 'budget-123',
        account_id: 'account-456',
      };
      const result = await handleListTransactions(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.getTransactionsByAccount).toHaveBeenCalledWith(
        'budget-123',
        'account-456',
        undefined,
      );
      expect(result.content[0].text).toContain('transaction-123');
    });

    it('should filter by category_id when provided', async () => {
      const mockResponse = {
        data: {
          transactions: [mockTransaction],
        },
      };

      (mockYnabAPI.transactions.getTransactionsByCategory as any).mockResolvedValue(mockResponse);

      const params = {
        budget_id: 'budget-123',
        category_id: 'category-789',
      };
      const result = await handleListTransactions(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.getTransactionsByCategory).toHaveBeenCalledWith(
        'budget-123',
        'category-789',
        undefined,
      );
      expect(result.content[0].text).toContain('transaction-123');
    });

    it('should include since_date parameter when provided', async () => {
      const mockResponse = {
        data: {
          transactions: [mockTransaction],
        },
      };

      (mockYnabAPI.transactions.getTransactions as any).mockResolvedValue(mockResponse);

      const params = {
        budget_id: 'budget-123',
        since_date: '2024-01-01',
        type: 'uncategorized' as const,
      };
      await handleListTransactions(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledWith(
        'budget-123',
        '2024-01-01',
        'uncategorized',
      );
    });

    it('should handle 401 authentication errors', async () => {
      const error = new Error('401 Unauthorized');
      (mockYnabAPI.transactions.getTransactions as any).mockRejectedValue(error);

      const params = { budget_id: 'budget-123' };
      const result = await handleListTransactions(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Invalid or expired YNAB access token');
    });

    it('should handle 404 not found errors', async () => {
      const error = new Error('404 Not Found');
      (mockYnabAPI.transactions.getTransactions as any).mockRejectedValue(error);

      const params = { budget_id: 'invalid-budget' };
      const result = await handleListTransactions(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Budget, account, category, or transaction not found');
    });

    it('should handle 429 rate limit errors', async () => {
      const error = new Error('429 Too Many Requests');
      (mockYnabAPI.transactions.getTransactions as any).mockRejectedValue(error);

      const params = { budget_id: 'budget-123' };
      const result = await handleListTransactions(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Rate limit exceeded. Please try again later');
    });

    it('should handle generic errors', async () => {
      const error = new Error('Network error');
      (mockYnabAPI.transactions.getTransactions as any).mockRejectedValue(error);

      const params = { budget_id: 'budget-123' };
      const result = await handleListTransactions(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Failed to list transactions');
    });
  });

  describe('GetTransactionSchema', () => {
    it('should validate valid parameters', () => {
      const validParams = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
      };

      const result = GetTransactionSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('should require budget_id', () => {
      const invalidParams = {
        transaction_id: 'transaction-456',
      };

      const result = GetTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].path).toEqual(['budget_id']);
      }
    });

    it('should require transaction_id', () => {
      const invalidParams = {
        budget_id: 'budget-123',
      };

      const result = GetTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].path).toEqual(['transaction_id']);
      }
    });

    it('should reject empty strings', () => {
      const invalidParams = {
        budget_id: '',
        transaction_id: '',
      };

      const result = GetTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });
  });

  describe('handleGetTransaction', () => {
    const mockTransactionDetail = {
      id: 'transaction-123',
      date: '2024-01-01',
      amount: -50000,
      memo: 'Test transaction',
      cleared: 'cleared' as any,
      approved: true,
      flag_color: null,
      account_id: 'account-456',
      payee_id: 'payee-789',
      category_id: 'category-101',
      transfer_account_id: null,
      transfer_transaction_id: null,
      matched_transaction_id: null,
      import_id: null,
      deleted: false,
      account_name: 'Test Account',
      payee_name: 'Test Payee',
      category_name: 'Test Category',
    };

    it('should get transaction details successfully', async () => {
      const mockResponse = {
        data: {
          transaction: mockTransactionDetail,
        },
      };

      (mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue(mockResponse);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
      };
      const result = await handleGetTransaction(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.getTransactionById).toHaveBeenCalledWith(
        'budget-123',
        'transaction-456',
      );

      const response = JSON.parse(result.content[0].text);
      expect(response.transaction.id).toBe('transaction-123');
      expect(response.transaction.amount).toBe(-50);
      expect(response.transaction.account_name).toBe('Test Account');
      expect(response.transaction.payee_name).toBe('Test Payee');
      expect(response.transaction.category_name).toBe('Test Category');
    });

    it('should handle 404 not found errors', async () => {
      const error = new Error('404 Not Found');
      (mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'invalid-transaction',
      };
      const result = await handleGetTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Budget, account, category, or transaction not found');
    });

    it('should handle authentication errors', async () => {
      const error = new Error('401 Unauthorized');
      (mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
      };
      const result = await handleGetTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Invalid or expired YNAB access token');
    });

    it('should handle generic errors', async () => {
      const error = new Error('Network error');
      (mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
      };
      const result = await handleGetTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Failed to get transaction');
    });
  });

  describe('CreateTransactionSchema', () => {
    it('should validate valid parameters with required fields only', () => {
      const validParams = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000, // $50.00 outflow in milliunits
        date: '2024-01-01',
      };

      const result = CreateTransactionSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('should validate valid parameters with all optional fields', () => {
      const validParams = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
        payee_name: 'Test Payee',
        payee_id: 'payee-789',
        category_id: 'category-101',
        memo: 'Test memo',
        cleared: 'cleared' as const,
        approved: true,
        flag_color: 'red' as const,
      };

      const result = CreateTransactionSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('should require budget_id', () => {
      const invalidParams = {
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
      };

      const result = CreateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should require account_id', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        amount: -50000,
        date: '2024-01-01',
      };

      const result = CreateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should require amount to be an integer', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -500.5, // Decimal not allowed
        date: '2024-01-01',
      };

      const result = CreateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Amount must be an integer in milliunits');
      }
    });

    it('should validate date format', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '01/01/2024', // Invalid format
      };

      const result = CreateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Date must be in ISO format');
      }
    });

    it('should validate cleared status enum', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
        cleared: 'invalid-status',
      };

      const result = CreateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should validate flag_color enum', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
        flag_color: 'invalid-color',
      };

      const result = CreateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should validate parameters with subtransactions when totals match', () => {
      const validParams = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -75000,
        date: '2024-01-01',
        subtransactions: [
          {
            amount: -25000,
            memo: 'Groceries',
            category_id: 'category-groceries',
          },
          {
            amount: -50000,
            memo: 'Rent',
            category_id: 'category-rent',
          },
        ],
      };

      const result = CreateTransactionSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('should reject parameters when subtransaction totals do not match amount', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -70000,
        date: '2024-01-01',
        subtransactions: [
          {
            amount: -25000,
          },
          {
            amount: -40000,
          },
        ],
      };

      const result = CreateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          'Amount must equal the sum of subtransaction amounts',
        );
      }
    });
  });

  describe('handleCreateTransaction', () => {
    const mockCreatedTransaction = {
      id: 'new-transaction-123',
      date: '2024-01-01',
      amount: -50000,
      memo: 'Test transaction',
      cleared: 'cleared' as any,
      approved: true,
      flag_color: 'red' as any,
      account_id: 'account-456',
      payee_id: 'payee-789',
      category_id: 'category-101',
      transfer_account_id: null,
      transfer_transaction_id: null,
      matched_transaction_id: null,
      import_id: null,
      deleted: false,
    };

    it('should create transaction with required fields only', async () => {
      const mockResponse = {
        data: {
          transaction: mockCreatedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-456',
            balance: 100000,
            cleared_balance: 95000,
          },
        },
      };

      (mockYnabAPI.transactions.createTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const params = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
      };
      const result = await handleCreateTransaction(mockYnabAPI, params);

      const createCall = (mockYnabAPI.transactions.createTransaction as any).mock.calls[0];
      expect(createCall[0]).toBe('budget-123');
      const payload = createCall[1];
      expect(payload.transaction).toMatchObject({
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
        cleared: undefined,
        flag_color: undefined,
      });
      expect(payload.transaction).not.toHaveProperty('subtransactions');
      expect(payload.transaction).not.toHaveProperty('approved');

      const response = JSON.parse(result.content[0].text);
      expect(response.transaction.id).toBe('new-transaction-123');
      expect(response.transaction.amount).toBe(-50);
    });

    it('should create transaction with all optional fields', async () => {
      const mockResponse = {
        data: {
          transaction: mockCreatedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-456',
            balance: 100000,
            cleared_balance: 95000,
          },
        },
      };

      (mockYnabAPI.transactions.createTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const params = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
        payee_name: 'Test Payee',
        payee_id: 'payee-789',
        category_id: 'category-101',
        memo: 'Test memo',
        cleared: 'cleared' as const,
        approved: true,
        flag_color: 'red' as const,
      };
      const result = await handleCreateTransaction(mockYnabAPI, params);

      const createCall = (mockYnabAPI.transactions.createTransaction as any).mock.calls[0];
      expect(createCall[0]).toBe('budget-123');
      const payload = createCall[1];
      expect(payload.transaction).toMatchObject({
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
        payee_name: 'Test Payee',
        payee_id: 'payee-789',
        category_id: 'category-101',
        memo: 'Test memo',
        cleared: 'cleared',
        approved: true,
        flag_color: 'red',
      });
      expect(payload.transaction).not.toHaveProperty('subtransactions');

      const response = JSON.parse(result.content[0].text);
      expect(response.transaction.id).toBe('new-transaction-123');
    });

    it('should create split transaction with subtransactions', async () => {
      const mockSplitTransaction = {
        ...mockCreatedTransaction,
        amount: -75000,
        subtransactions: [
          {
            id: 'sub-1',
            transaction_id: 'new-transaction-123',
            amount: -25000,
            memo: 'Groceries',
            payee_id: null,
            payee_name: 'Corner Store',
            category_id: 'category-groceries',
            category_name: 'Groceries',
            transfer_account_id: null,
            transfer_transaction_id: null,
            deleted: false,
          },
          {
            id: 'sub-2',
            transaction_id: 'new-transaction-123',
            amount: -50000,
            memo: 'Rent',
            payee_id: 'payee-landlord',
            payee_name: null,
            category_id: 'category-rent',
            category_name: 'Rent',
            transfer_account_id: null,
            transfer_transaction_id: null,
            deleted: false,
          },
        ],
      };

      const mockResponse = {
        data: {
          transaction: mockSplitTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-456',
            balance: 250000,
            cleared_balance: 225000,
          },
        },
      };

      (mockYnabAPI.transactions.createTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const params = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -75000,
        date: '2024-01-01',
        subtransactions: [
          {
            amount: -25000,
            memo: 'Groceries',
            payee_name: 'Corner Store',
            category_id: 'category-groceries',
          },
          {
            amount: -50000,
            memo: 'Rent',
            payee_id: 'payee-landlord',
            category_id: 'category-rent',
          },
        ],
      };

      const result = await handleCreateTransaction(mockYnabAPI, params);

      const createCall = (mockYnabAPI.transactions.createTransaction as any).mock.calls[0];
      expect(createCall[0]).toBe('budget-123');
      const payload = createCall[1];
      expect(payload.transaction).toMatchObject({
        account_id: 'account-456',
        amount: -75000,
        date: '2024-01-01',
        subtransactions: [
          {
            amount: -25000,
            memo: 'Groceries',
            payee_name: 'Corner Store',
            category_id: 'category-groceries',
          },
          {
            amount: -50000,
            memo: 'Rent',
            payee_id: 'payee-landlord',
            category_id: 'category-rent',
          },
        ],
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.transaction.amount).toBe(-75);
      expect(response.transaction.account_balance).toBe(250000);
      expect(response.transaction.account_cleared_balance).toBe(225000);
      expect(response.transaction.subtransactions).toEqual([
        {
          id: 'sub-1',
          transaction_id: 'new-transaction-123',
          amount: -25,
          memo: 'Groceries',
          payee_id: null,
          payee_name: 'Corner Store',
          category_id: 'category-groceries',
          category_name: 'Groceries',
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
        {
          id: 'sub-2',
          transaction_id: 'new-transaction-123',
          amount: -50,
          memo: 'Rent',
          payee_id: 'payee-landlord',
          payee_name: null,
          category_id: 'category-rent',
          category_name: 'Rent',
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
      ]);
    });

    it('should handle 404 not found errors', async () => {
      const error = new Error('404 Not Found');
      (mockYnabAPI.transactions.createTransaction as any).mockRejectedValue(error);

      const params = {
        budget_id: 'invalid-budget',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
      };
      const result = await handleCreateTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Budget, account, category, or transaction not found');
    });

    it('should handle authentication errors', async () => {
      const error = new Error('401 Unauthorized');
      (mockYnabAPI.transactions.createTransaction as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
      };
      const result = await handleCreateTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Invalid or expired YNAB access token');
    });

    it('should handle generic errors', async () => {
      const error = new Error('Network error');
      (mockYnabAPI.transactions.createTransaction as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
      };
      const result = await handleCreateTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Failed to create transaction');
    });

    it('should invalidate transaction cache on successful transaction creation', async () => {
      const mockResponse = {
        data: {
          transaction: mockCreatedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-456',
            balance: 100000,
            cleared_balance: 95000,
          },
        },
      };

      (mockYnabAPI.transactions.createTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const mockCacheKey = 'transactions:list:budget-123:generated-key';
      (CacheManager.generateKey as any).mockReturnValue(mockCacheKey);

      const result = await handleCreateTransaction(mockYnabAPI, {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
      });

      // Verify cache was invalidated for transaction list
      expect(CacheManager.generateKey).toHaveBeenCalledWith('transactions', 'list', 'budget-123');
      expect(cacheManager.delete).toHaveBeenCalledWith(mockCacheKey);

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.transaction.id).toBe('new-transaction-123');
    });

    it('should not invalidate cache on dry_run transaction creation', async () => {
      const mockResponse = {
        data: {
          transaction: mockCreatedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-456',
            balance: 100000,
            cleared_balance: 95000,
          },
        },
      };

      (mockYnabAPI.transactions.createTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const result = await handleCreateTransaction(mockYnabAPI, {
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
        dry_run: true,
      });

      // Verify cache was NOT invalidated for dry run
      expect(cacheManager.delete).not.toHaveBeenCalled();
      expect(CacheManager.generateKey).not.toHaveBeenCalled();

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.dry_run).toBe(true);
      expect(parsedContent.action).toBe('create_transaction');
      expect(parsedContent.request).toMatchObject({
        budget_id: 'budget-123',
        account_id: 'account-456',
        amount: -50000,
        date: '2024-01-01',
        dry_run: true,
      });
    });
  });

  describe('UpdateTransactionSchema', () => {
    it('should validate valid parameters with minimal fields', () => {
      const validParams = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        amount: -60000, // Updated amount
      };

      const result = UpdateTransactionSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('should validate valid parameters with all optional fields', () => {
      const validParams = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        account_id: 'account-789',
        amount: -60000,
        date: '2024-01-02',
        payee_name: 'Updated Payee',
        payee_id: 'payee-999',
        category_id: 'category-202',
        memo: 'Updated memo',
        cleared: 'reconciled' as const,
        approved: false,
        flag_color: 'blue' as const,
      };

      const result = UpdateTransactionSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('should require budget_id', () => {
      const invalidParams = {
        transaction_id: 'transaction-456',
        amount: -60000,
      };

      const result = UpdateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should require transaction_id', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        amount: -60000,
      };

      const result = UpdateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should require amount to be an integer when provided', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        amount: -600.5, // Decimal not allowed
      };

      const result = UpdateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Amount must be an integer in milliunits');
      }
    });

    it('should validate date format when provided', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        date: '01/02/2024', // Invalid format
      };

      const result = UpdateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Date must be in ISO format');
      }
    });

    it('should validate cleared status enum when provided', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        cleared: 'invalid-status',
      };

      const result = UpdateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it('should validate flag_color enum when provided', () => {
      const invalidParams = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        flag_color: 'invalid-color',
      };

      const result = UpdateTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });
  });

  describe('handleUpdateTransaction', () => {
    const mockUpdatedTransaction = {
      id: 'transaction-456',
      date: '2024-01-02',
      amount: -60000,
      memo: 'Updated memo',
      cleared: 'reconciled' as any,
      approved: false,
      flag_color: 'blue' as any,
      account_id: 'account-789',
      payee_id: 'payee-999',
      category_id: 'category-202',
      transfer_account_id: null,
      transfer_transaction_id: null,
      matched_transaction_id: null,
      import_id: null,
      deleted: false,
    };

    const mockOriginalTransaction = {
      id: 'transaction-456',
      account_id: 'account-123',
      amount: -50000,
      date: '2024-01-01',
      memo: 'Original memo',
    };

    beforeEach(() => {
      (mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue({
        data: { transaction: mockOriginalTransaction },
      });
    });

    it('should update transaction with single field', async () => {
      const mockResponse = {
        data: {
          transaction: mockUpdatedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-789',
            balance: 150000,
            cleared_balance: 140000,
          },
        },
      };

      (mockYnabAPI.transactions.updateTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        amount: -60000,
      };
      const result = await handleUpdateTransaction(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.updateTransaction).toHaveBeenCalledWith(
        'budget-123',
        'transaction-456',
        {
          transaction: {
            amount: -60000,
          },
        },
      );

      const response = JSON.parse(result.content[0].text);
      expect(response.transaction.id).toBe('transaction-456');
      expect(response.transaction.amount).toBe(-60);
    });

    it('should update transaction with multiple fields', async () => {
      const mockResponse = {
        data: {
          transaction: mockUpdatedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-789',
            balance: 150000,
            cleared_balance: 140000,
          },
        },
      };

      (mockYnabAPI.transactions.updateTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        account_id: 'account-789',
        amount: -60000,
        date: '2024-01-02',
        memo: 'Updated memo',
        cleared: 'reconciled' as const,
        approved: false,
        flag_color: 'blue' as const,
      };
      const result = await handleUpdateTransaction(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.updateTransaction).toHaveBeenCalledWith(
        'budget-123',
        'transaction-456',
        {
          transaction: {
            account_id: 'account-789',
            amount: -60000,
            date: '2024-01-02',
            memo: 'Updated memo',
            cleared: 'reconciled',
            approved: false,
            flag_color: 'blue',
          },
        },
      );

      const response = JSON.parse(result.content[0].text);
      expect(response.transaction.id).toBe('transaction-456');
    });

    it('should handle 404 not found errors', async () => {
      const error = new Error('404 Not Found');
      (mockYnabAPI.transactions.updateTransaction as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'invalid-transaction',
        amount: -60000,
      };
      const result = await handleUpdateTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Budget, account, category, or transaction not found');
    });

    it('should handle authentication errors', async () => {
      const error = new Error('401 Unauthorized');
      (mockYnabAPI.transactions.updateTransaction as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        amount: -60000,
      };
      const result = await handleUpdateTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Invalid or expired YNAB access token');
    });

    it('should handle generic errors', async () => {
      const error = new Error('Network error');
      (mockYnabAPI.transactions.updateTransaction as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        amount: -60000,
      };
      const result = await handleUpdateTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Failed to update transaction');
    });

    it('should invalidate transaction cache on successful transaction update', async () => {
      const mockResponse = {
        data: {
          transaction: mockUpdatedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-789',
            balance: 150000,
            cleared_balance: 140000,
          },
        },
      };

      (mockYnabAPI.transactions.updateTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const mockCacheKey = 'transactions:list:budget-123:generated-key';
      (CacheManager.generateKey as any).mockReturnValue(mockCacheKey);

      const result = await handleUpdateTransaction(mockYnabAPI, {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        amount: -60000,
      });

      // Verify cache was invalidated for transaction list
      expect(CacheManager.generateKey).toHaveBeenCalledWith('transactions', 'list', 'budget-123');
      expect(cacheManager.delete).toHaveBeenCalledWith(mockCacheKey);

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.transaction.id).toBe('transaction-456');
    });

    it('should not invalidate cache on dry_run transaction update', async () => {
      const mockResponse = {
        data: {
          transaction: mockUpdatedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-789',
            balance: 150000,
            cleared_balance: 140000,
          },
        },
      };

      (mockYnabAPI.transactions.updateTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const result = await handleUpdateTransaction(mockYnabAPI, {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        amount: -60000,
        dry_run: true,
      });

      // Verify cache was NOT invalidated for dry run
      expect(cacheManager.delete).not.toHaveBeenCalled();
      expect(CacheManager.generateKey).not.toHaveBeenCalled();

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.dry_run).toBe(true);
      expect(parsedContent.action).toBe('update_transaction');
      expect(parsedContent.request).toEqual({
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        amount: -60000,
        dry_run: true,
      });
    });
  });

  describe('DeleteTransactionSchema', () => {
    it('should validate valid parameters', () => {
      const validParams = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
      };

      const result = DeleteTransactionSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('should require budget_id', () => {
      const invalidParams = {
        transaction_id: 'transaction-456',
      };

      const result = DeleteTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].path).toEqual(['budget_id']);
      }
    });

    it('should require transaction_id', () => {
      const invalidParams = {
        budget_id: 'budget-123',
      };

      const result = DeleteTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe('invalid_type');
        expect(result.error.issues[0].path).toEqual(['transaction_id']);
      }
    });

    it('should reject empty strings', () => {
      const invalidParams = {
        budget_id: '',
        transaction_id: '',
      };

      const result = DeleteTransactionSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });
  });

  describe('handleDeleteTransaction', () => {
    const mockDeletedTransaction = {
      id: 'transaction-456',
      deleted: true,
    };

    it('should delete transaction successfully', async () => {
      const mockResponse = {
        data: {
          transaction: mockDeletedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-456',
            balance: 50000,
            cleared_balance: 45000,
          },
        },
      };

      (mockYnabAPI.transactions.deleteTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
      };
      const result = await handleDeleteTransaction(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.deleteTransaction).toHaveBeenCalledWith(
        'budget-123',
        'transaction-456',
      );

      const response = JSON.parse(result.content[0].text);
      expect(response.message).toBe('Transaction deleted successfully');
      expect(response.transaction.id).toBe('transaction-456');
      expect(response.transaction.deleted).toBe(true);
    });

    it('should handle 404 not found errors', async () => {
      const error = new Error('404 Not Found');
      (mockYnabAPI.transactions.deleteTransaction as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'invalid-transaction',
      };
      const result = await handleDeleteTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Budget, account, category, or transaction not found');
    });

    it('should handle authentication errors', async () => {
      const error = new Error('401 Unauthorized');
      (mockYnabAPI.transactions.deleteTransaction as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
      };
      const result = await handleDeleteTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Invalid or expired YNAB access token');
    });

    it('should handle generic errors', async () => {
      const error = new Error('Network error');
      (mockYnabAPI.transactions.deleteTransaction as any).mockRejectedValue(error);

      const params = {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
      };
      const result = await handleDeleteTransaction(mockYnabAPI, params);

      const response = JSON.parse(result.content[0].text);
      expect(response.error.message).toBe('Failed to delete transaction');
    });

    it('should invalidate transaction cache on successful transaction deletion', async () => {
      const mockResponse = {
        data: {
          transaction: mockDeletedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-456',
            balance: 50000,
            cleared_balance: 45000,
          },
        },
      };

      (mockYnabAPI.transactions.deleteTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const mockCacheKey = 'transactions:list:budget-123:generated-key';
      (CacheManager.generateKey as any).mockReturnValue(mockCacheKey);

      const result = await handleDeleteTransaction(mockYnabAPI, {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
      });

      // Verify cache was invalidated for transaction list
      expect(CacheManager.generateKey).toHaveBeenCalledWith('transactions', 'list', 'budget-123');
      expect(cacheManager.delete).toHaveBeenCalledWith(mockCacheKey);

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.transaction.id).toBe('transaction-456');
      expect(parsedContent.transaction.deleted).toBe(true);
    });

    it('should not invalidate cache on dry_run transaction deletion', async () => {
      const mockResponse = {
        data: {
          transaction: mockDeletedTransaction,
        },
      };

      const mockAccountResponse = {
        data: {
          account: {
            id: 'account-456',
            balance: 50000,
            cleared_balance: 45000,
          },
        },
      };

      (mockYnabAPI.transactions.deleteTransaction as any).mockResolvedValue(mockResponse);
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const result = await handleDeleteTransaction(mockYnabAPI, {
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        dry_run: true,
      });

      // Verify cache was NOT invalidated for dry run
      expect(cacheManager.delete).not.toHaveBeenCalled();
      expect(CacheManager.generateKey).not.toHaveBeenCalled();

      expect(result.content).toHaveLength(1);
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.dry_run).toBe(true);
      expect(parsedContent.action).toBe('delete_transaction');
      expect(parsedContent.request).toEqual({
        budget_id: 'budget-123',
        transaction_id: 'transaction-456',
        dry_run: true,
      });
    });
  });
});
