import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ynab from 'ynab';
import {
  handleListTransactions,
  handleGetTransaction,
  handleCreateTransaction,
  handleCreateTransactions,
  handleCreateReceiptSplitTransaction,
  handleUpdateTransaction,
  handleUpdateTransactions,
  handleDeleteTransaction,
  ListTransactionsSchema,
  GetTransactionSchema,
  CreateTransactionSchema,
  CreateTransactionsSchema,
  CreateReceiptSplitTransactionSchema,
  UpdateTransactionSchema,
  UpdateTransactionsSchema,
  DeleteTransactionSchema,
} from '../transactionTools.js';

// Mock the cache manager
vi.mock('../../server/cacheManager.js', () => ({
  cacheManager: {
    wrap: vi.fn(),
    has: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
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
    createTransactions: vi.fn(),
    updateTransaction: vi.fn(),
    updateTransactions: vi.fn(),
    deleteTransaction: vi.fn(),
  },
  accounts: {
    getAccountById: vi.fn(),
  },
} as unknown as ynab.API;

// Import mocked cache manager
const { cacheManager, CacheManager, CACHE_TTLS } = await import('../../server/cacheManager.js');
const { globalRequestLogger } = await import('../../server/requestLogger.js');

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

  describe('handleCreateTransactions', () => {
    it('surfaces top-level validation errors with a reserved transaction index', async () => {
      const invalidParams = {
        budget_id: '',
        transactions: [],
      };

      const result = await handleCreateTransactions(mockYnabAPI, invalidParams as any);

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.details).toBeDefined();

      const details = JSON.parse(parsed.error.details ?? '[]');
      expect(details).toHaveLength(1);
      expect(details[0].transaction_index).toBeNull();
      expect(details[0].errors).toEqual(
        expect.arrayContaining([
          'Budget ID is required',
          'At least one transaction is required',
        ]),
      );
    });

    it('combines reserved and per-transaction validation errors', async () => {
      const invalidParams = {
        budget_id: 'budget-123',
        dry_run: 'later',
        transactions: [
          {
            account_id: '',
            amount: -50000,
            date: '2024-01-01',
          },
        ],
      };

      const result = await handleCreateTransactions(mockYnabAPI, invalidParams as any);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.details).toBeDefined();

      const details = JSON.parse(parsed.error.details ?? '[]');
      const generalEntry = details.find((entry: any) => entry.transaction_index === null);
      const transactionEntry = details.find((entry: any) => entry.transaction_index === 0);

      expect(generalEntry).toBeDefined();
      expect(generalEntry.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('expected boolean')]),
      );

      expect(transactionEntry).toBeDefined();
      expect(transactionEntry.errors).toEqual(expect.arrayContaining(['Account ID is required']));
    });
  });

  describe('CreateReceiptSplitTransactionSchema', () => {
    const basePayload = {
      budget_id: 'budget-123',
      account_id: 'account-456',
      payee_name: 'IKEA',
      receipt_subtotal: 50,
      receipt_tax: 5,
      receipt_total: 55,
      categories: [
        {
          category_id: 'category-a',
          category_name: 'Home',
          items: [
            { name: 'Lamp', amount: 20 },
            { name: 'Rug', amount: 30 },
          ],
        },
      ],
    } as const;

    it('should validate a well-formed receipt split payload', () => {
      const result = CreateReceiptSplitTransactionSchema.safeParse(basePayload);
      expect(result.success).toBe(true);
    });

    it('should reject when subtotal does not match categorized items', () => {
      const invalidPayload = {
        ...basePayload,
        receipt_subtotal: 40,
      };

      const result = CreateReceiptSplitTransactionSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it('should reject when total does not equal subtotal plus tax', () => {
      const invalidPayload = {
        ...basePayload,
        receipt_total: 56,
      };

      const result = CreateReceiptSplitTransactionSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });

  describe('handleCreateReceiptSplitTransaction', () => {
    const mockSplitTransaction = {
      id: 'new-transaction-456',
      date: '2025-10-13',
      amount: -55000,
      memo: 'Receipt import',
      cleared: 'uncleared' as const,
      approved: false,
      flag_color: null,
      account_id: 'account-456',
      payee_id: null,
      category_id: null,
      transfer_account_id: null,
      transfer_transaction_id: null,
      matched_transaction_id: null,
      import_id: null,
      deleted: false,
      subtransactions: [
        {
          id: 'sub-1',
          transaction_id: 'new-transaction-456',
          amount: -20000,
          memo: 'Lamp',
          payee_id: null,
          payee_name: null,
          category_id: 'category-home',
          category_name: 'Home',
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
        {
          id: 'sub-2',
          transaction_id: 'new-transaction-456',
          amount: -10000,
          memo: 'Shelf',
          payee_id: null,
          payee_name: null,
          category_id: 'category-home',
          category_name: 'Home',
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
        {
          id: 'sub-3',
          transaction_id: 'new-transaction-456',
          amount: -15000,
          memo: 'Pan',
          payee_id: null,
          payee_name: null,
          category_id: 'category-kitchen',
          category_name: 'Kitchen',
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
        {
          id: 'sub-4',
          transaction_id: 'new-transaction-456',
          amount: -10000,
          memo: 'Tax - Home',
          payee_id: null,
          payee_name: null,
          category_id: 'category-home',
          category_name: 'Home',
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
        {
          id: 'sub-5',
          transaction_id: 'new-transaction-456',
          amount: -5000,
          memo: 'Tax - Kitchen',
          payee_id: null,
          payee_name: null,
          category_id: 'category-kitchen',
          category_name: 'Kitchen',
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
      ],
    };

    const mockAccountResponse = {
      data: {
        account: {
          id: 'account-456',
          balance: 500000,
          cleared_balance: 450000,
        },
      },
    };

    beforeEach(() => {
      (mockYnabAPI.transactions.createTransaction as any).mockReset();
      (mockYnabAPI.accounts.getAccountById as any).mockReset();
    });

    it('should return a detailed dry-run summary without calling the API', async () => {
      const params = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        payee_name: 'IKEA',
        date: '2025-10-13',
        receipt_tax: 5,
        receipt_total: 55,
        categories: [
          {
            category_id: 'category-home',
            category_name: 'Home',
            items: [
              { name: 'Lamp', amount: 20 },
              { name: 'Shelf', amount: 10 },
            ],
          },
          {
            category_id: 'category-kitchen',
            category_name: 'Kitchen',
            items: [{ name: 'Pan', amount: 20 }],
          },
        ],
        receipt_subtotal: 50,
        dry_run: true,
      } as const;

      const result = await handleCreateReceiptSplitTransaction(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.createTransaction).not.toHaveBeenCalled();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.dry_run).toBe(true);
      expect(parsed.receipt_summary.total).toBe(55);
      expect(parsed.subtransactions).toHaveLength(5);
    });

    it('should create a split transaction and attach receipt summary', async () => {
      (mockYnabAPI.transactions.createTransaction as any).mockResolvedValue({
        data: {
          transaction: mockSplitTransaction,
        },
      });
      (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(mockAccountResponse);

      const params = {
        budget_id: 'budget-123',
        account_id: 'account-456',
        payee_name: 'IKEA',
        memo: 'Store receipt import',
        date: '2025-10-13',
        receipt_tax: 5,
        receipt_total: 55,
        categories: [
          {
            category_id: 'category-home',
            category_name: 'Home',
            items: [
              { name: 'Lamp', amount: 20 },
              { name: 'Shelf', amount: 10 },
            ],
          },
          {
            category_id: 'category-kitchen',
            category_name: 'Kitchen',
            items: [{ name: 'Pan', amount: 20 }],
          },
        ],
        receipt_subtotal: 50,
      } as const;

      const result = await handleCreateReceiptSplitTransaction(mockYnabAPI, params);

      expect(mockYnabAPI.transactions.createTransaction).toHaveBeenCalledTimes(1);
      const callArgs = (mockYnabAPI.transactions.createTransaction as any).mock.calls[0];
      expect(callArgs[0]).toBe('budget-123');
      expect(callArgs[1].transaction.amount).toBe(-55000);
      expect(callArgs[1].transaction.subtransactions).toHaveLength(5);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.receipt_summary.total).toBe(55);
      const homeCategory = parsed.receipt_summary.categories.find(
        (category: any) => category.category_id === 'category-home',
      );
      expect(homeCategory).toBeDefined();
      expect(homeCategory.tax).toBeCloseTo(3);
      expect(homeCategory.total).toBeCloseTo(33);
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

  describe('CreateTransactionsSchema', () => {
    const buildTransaction = (overrides: Record<string, unknown> = {}) => ({
      account_id: 'account-123',
      amount: -5000,
      date: '2024-01-01',
      memo: 'Bulk entry',
      ...overrides,
    });

    it('should accept a valid batch of multiple transactions', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildTransaction(), buildTransaction({ account_id: 'account-456' })],
      };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transactions).toHaveLength(2);
      }
    });

    it('should accept the minimum batch size of one transaction', () => {
      const params = { budget_id: 'budget-123', transactions: [buildTransaction()] };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it('should accept the maximum batch size of 100 transactions', () => {
      const hundred = Array.from({ length: 100 }, (_, index) =>
        buildTransaction({ import_id: `YNAB:-5000:2024-01-01:${index + 1}` }),
      );
      const params = { budget_id: 'budget-123', transactions: hundred };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it('should reject an empty transactions array', () => {
      const params = { budget_id: 'budget-123', transactions: [] as unknown[] };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('At least one transaction is required');
      }
    });

    it('should reject batches exceeding 100 transactions', () => {
      const overLimit = Array.from({ length: 101 }, () => buildTransaction());
      const result = CreateTransactionsSchema.safeParse({
        budget_id: 'budget-123',
        transactions: overLimit,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('A maximum of 100 transactions');
      }
    });

    it('should reject transactions missing required fields', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildTransaction({ account_id: undefined })],
      };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['transactions', 0, 'account_id']);
      }
    });

    it('should validate ISO date format for each transaction', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildTransaction({ date: '01/01/2024' })],
      };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['transactions', 0, 'date']);
      }
    });

    it('should require integer milliunit amounts', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildTransaction({ amount: -50.25 })],
      };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['transactions', 0, 'amount']);
      }
    });

    it('should reject invalid cleared enum values', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildTransaction({ cleared: 'pending' })],
      };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it('should reject transactions containing subtransactions', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildTransaction({ subtransactions: [{ amount: -2500 }] })],
      };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('subtransactions'));
        expect(issue?.message).toContain('Subtransactions are not supported');
      }
    });

    it('should fail when any transaction in the batch is invalid', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildTransaction(), buildTransaction({ amount: 'invalid' })],
      };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it('should accept optional import_id values', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildTransaction({ import_id: 'YNAB:-5000:2024-01-01:1' })],
      };
      const result = CreateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transactions[0].import_id).toBe('YNAB:-5000:2024-01-01:1');
      }
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

  describe('handleCreateTransactions', () => {
    let transactionCounter = 0;

    const buildTransaction = (overrides: Record<string, unknown> = {}) => ({
      account_id: 'account-001',
      amount: -1500,
      date: '2024-01-01',
      memo: 'Bulk test',
      cleared: 'cleared',
      approved: true,
      ...overrides,
    });

    const buildParams = (overrides: Record<string, unknown> = {}) => ({
      budget_id: 'budget-123',
      transactions: [buildTransaction()],
      ...overrides,
    });

    const buildApiTransaction = (overrides: Record<string, unknown> = {}) => ({
      id: overrides['id'] ?? `transaction-${++transactionCounter}`,
      account_id: overrides['account_id'] ?? 'account-001',
      date: overrides['date'] ?? '2024-01-01',
      amount: overrides['amount'] ?? -1500,
      memo: overrides['memo'] ?? 'Bulk test',
      cleared: overrides['cleared'] ?? 'cleared',
      approved: overrides['approved'] ?? true,
      flag_color: overrides['flag_color'] ?? null,
      account_name: overrides['account_name'] ?? 'Checking',
      payee_id: overrides['payee_id'] ?? null,
      payee_name: overrides['payee_name'] ?? null,
      category_id: overrides['category_id'] ?? null,
      category_name: overrides['category_name'] ?? null,
      transfer_account_id: overrides['transfer_account_id'] ?? null,
      transfer_transaction_id: overrides['transfer_transaction_id'] ?? null,
      matched_transaction_id: overrides['matched_transaction_id'] ?? null,
      import_id: overrides['import_id'] ?? null,
      deleted: overrides['deleted'] ?? false,
      subtransactions: [],
    });

    const buildApiResponse = (
      transactions: Record<string, unknown>[],
      extras: Record<string, unknown> = {},
    ) => ({
      data: {
        transaction_ids: transactions.map((txn) => String(txn['id'])),
        transactions,
        duplicate_import_ids: extras['duplicate_import_ids'] ?? [],
        server_knowledge: extras['server_knowledge'] ?? 1,
      },
    });

    const parseResponse = async (resultPromise: ReturnType<typeof handleCreateTransactions>) => {
      const result = await resultPromise;
      const text = result.content?.[0]?.text ?? '{}';
      return JSON.parse(text) as Record<string, any>;
    };

    beforeEach(() => {
      transactionCounter = 0;
      (mockYnabAPI.transactions.createTransactions as any).mockReset();
      cacheManager.delete.mockReset();
      cacheManager.deleteMany.mockReset();
      (CacheManager.generateKey as any).mockReset();
    });

    describe('dry run', () => {
      it('returns validation summary without calling the API', async () => {
        const params = buildParams({
          dry_run: true,
          transactions: [
            buildTransaction({ amount: -2000, account_id: 'account-foo' }),
            buildTransaction({ amount: -1000, account_id: 'account-bar', date: '2024-02-15' }),
          ],
        });

        const response = await parseResponse(handleCreateTransactions(mockYnabAPI, params));

        expect(mockYnabAPI.transactions.createTransactions).not.toHaveBeenCalled();
        expect(response.dry_run).toBe(true);
        expect(response.summary.total_transactions).toBe(2);
        expect(response.summary.accounts_affected).toEqual(['account-foo', 'account-bar']);
        expect(response.transactions_preview).toHaveLength(2);
        expect(cacheManager.deleteMany).not.toHaveBeenCalled();
      });

      it('surfaces validation errors before execution', async () => {
        const invalidParams = buildParams({
          transactions: [
            {
              amount: -2000,
              date: '2024-01-01',
            },
          ],
        });

        const result = await handleCreateTransactions(mockYnabAPI, invalidParams as any);
        const parsed = JSON.parse(result.content?.[0]?.text ?? '{}');
        expect(parsed.error).toBeDefined();
        expect(parsed.error.message).toContain('validation failed');
        expect(mockYnabAPI.transactions.createTransactions).not.toHaveBeenCalled();
      });
    });

    describe('successful creation', () => {
      it('creates a small batch with import_ids and correlates results', async () => {
        const transactions = [
          buildTransaction({ import_id: 'YNAB:-1500:2024-01-01:1' }),
          buildTransaction({
            account_id: 'account-002',
            amount: -2500,
            import_id: 'YNAB:-2500:2024-01-02:1',
          }),
        ];

        const apiTransactions = transactions.map((transaction, index) =>
          buildApiTransaction({
            ...transaction,
            id: `ynab-${index + 1}`,
          }),
        );

        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );

        const response = await parseResponse(
          handleCreateTransactions(
            mockYnabAPI,
            buildParams({
              transactions,
            }),
          ),
        );

        expect(response.summary.created).toBe(2);
        expect(response.results).toHaveLength(2);
        expect(response.results.every((result: any) => result.status === 'created')).toBe(true);
        const deletedKeys = cacheManager.deleteMany.mock.calls.flatMap((args) => args[0] ?? []);
        expect(deletedKeys).toEqual(expect.arrayContaining(['transactions:list:budget-123:all']));
      });

      it('correlates transactions without import_ids using hashes', async () => {
        const batch = [
          buildTransaction({ memo: 'Hash me' }),
          buildTransaction({ memo: 'Hash me', date: '2024-01-02' }),
        ];
        const apiTransactions = batch.map((txn, index) =>
          buildApiTransaction({ ...txn, id: `hash-${index + 1}` }),
        );
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams({ transactions: batch })),
        );
        expect(response.results.map((result: any) => result.transaction_id)).toEqual([
          'hash-1',
          'hash-2',
        ]);
      });

      it('handles mixed import_id and hash correlation scenarios', async () => {
        const batch = [
          buildTransaction({ import_id: 'YNAB:-1500:2024-01-01:mix' }),
          buildTransaction({ memo: 'no id' }),
        ];
        const apiTransactions = [
          buildApiTransaction({ ...batch[0], id: 'mix-1' }),
          buildApiTransaction({ ...batch[1], id: 'mix-2' }),
        ];
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams({ transactions: batch })),
        );
        expect(response.results.find((r: any) => r.transaction_id === 'mix-1')?.status).toBe(
          'created',
        );
        expect(response.results.find((r: any) => r.transaction_id === 'mix-2')?.status).toBe(
          'created',
        );
      });
    });

    describe('duplicate handling', () => {
      it('marks all transactions as duplicates when import_ids already exist', async () => {
        const batch = [
          buildTransaction({ import_id: 'dup-1' }),
          buildTransaction({ import_id: 'dup-2' }),
        ];
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue({
          data: {
            transaction_ids: [],
            transactions: [],
            duplicate_import_ids: ['dup-1', 'dup-2'],
            server_knowledge: 5,
          },
        });

        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams({ transactions: batch })),
        );

        expect(response.summary.duplicates).toBe(2);
        expect(response.results.every((result: any) => result.status === 'duplicate')).toBe(true);
      });

      it('marks partial duplicates while creating the rest', async () => {
        const batch = [
          buildTransaction({ import_id: 'dup-1' }),
          buildTransaction({ import_id: 'new-1', memo: 'fresh' }),
        ];
        const apiTransactions = [buildApiTransaction({ ...batch[1], id: 'created-new' })];
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue({
          data: {
            transaction_ids: ['created-new'],
            transactions: apiTransactions,
            duplicate_import_ids: ['dup-1'],
            server_knowledge: 10,
          },
        });

        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams({ transactions: batch })),
        );

        const duplicateResult = response.results.find(
          (result: any) => result.correlation_key === 'dup-1',
        );
        const createdResult = response.results.find(
          (result: any) => result.transaction_id === 'created-new',
        );
        expect(duplicateResult?.status).toBe('duplicate');
        expect(createdResult?.status).toBe('created');
      });
    });

    describe('response size management', () => {
      it('keeps full response when under 64KB', async () => {
        const apiTransactions = [buildApiTransaction()];
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );
        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams()),
        );
        expect(response.transactions).toBeDefined();
        expect(response.mode).toBe('full');
      });

      it('downgrades to summary mode when response exceeds 64KB', async () => {
        const byteSpy = vi.spyOn(Buffer, 'byteLength');
        byteSpy.mockImplementationOnce(() => 70 * 1024).mockImplementationOnce(() => 80 * 1024);
        const apiTransactions = [buildApiTransaction()];
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams()),
        );

        expect(response.transactions).toBeUndefined();
        expect(response.mode).toBe('summary');
        byteSpy.mockRestore();
      });

      it('downgrades to ids_only mode when necessary', async () => {
        const byteSpy = vi.spyOn(Buffer, 'byteLength');
        byteSpy
          .mockImplementationOnce(() => 80 * 1024)
          .mockImplementationOnce(() => 97 * 1024)
          .mockImplementationOnce(() => 98 * 1024);
        const apiTransactions = [buildApiTransaction()];
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams()),
        );

        expect(response.mode).toBe('ids_only');
        expect(response.results[0].transaction_id).toBeDefined();
        byteSpy.mockRestore();
      });

      it('errors when response cannot fit under 100KB', async () => {
        const byteSpy = vi.spyOn(Buffer, 'byteLength');
        byteSpy
          .mockImplementationOnce(() => 90 * 1024)
          .mockImplementationOnce(() => 99 * 1024)
          .mockImplementationOnce(() => 101 * 1024);
        const apiTransactions = [buildApiTransaction()];
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const result = await handleCreateTransactions(mockYnabAPI, buildParams());
        const parsed = JSON.parse(result.content?.[0]?.text ?? '{}');
        expect(parsed.error).toBeDefined();
        expect(parsed.error.message).toContain('RESPONSE_TOO_LARGE');
        byteSpy.mockRestore();
      });
    });

    describe('correlation edge cases', () => {
      it('supports multi-bucket matching for identical transactions', async () => {
        const batch = [
          buildTransaction({ memo: 'repeat' }),
          buildTransaction({ memo: 'repeat' }),
          buildTransaction({ memo: 'repeat' }),
        ];
        const apiTransactions = batch.map((txn, index) =>
          buildApiTransaction({ ...txn, id: `repeat-${index + 1}` }),
        );
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams({ transactions: batch })),
        );

        expect(response.results.map((r: any) => r.request_index)).toEqual([0, 1, 2]);
      });

      it('records failures and logs correlation errors when correlation fails', async () => {
        const logErrorSpy = vi.spyOn(globalRequestLogger, 'logError').mockImplementation(() => {
          // Mock implementation
        });
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse([]),
        );
        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams()),
        );
        expect(response.results[0].status).toBe('failed');
        expect(response.results[0].error_code).toBe('correlation_failed');
        expect(logErrorSpy).toHaveBeenCalledWith(
          'ynab:create_transactions',
          'correlate_results',
          expect.objectContaining({
            request_index: 0,
            correlation_key: expect.any(String),
          }),
          'correlation_failed',
        );
        logErrorSpy.mockRestore();
      });
    });

    describe('cache invalidation', () => {
      it('invalidates transaction, account, and month caches for affected resources', async () => {
        const batch = [
          buildTransaction({ account_id: 'account-A', date: '2024-03-15' }),
          buildTransaction({ account_id: 'account-B', date: '2024-04-01' }),
        ];
        const apiTransactions = batch.map((txn, index) =>
          buildApiTransaction({ ...txn, id: `cache-${index + 1}` }),
        );
        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        await handleCreateTransactions(mockYnabAPI, buildParams({ transactions: batch }));

        const deletedKeys = cacheManager.deleteMany.mock.calls.flatMap((args) => args[0] ?? []);
        expect(deletedKeys).toEqual(
          expect.arrayContaining([
            'transactions:list:budget-123:all',
            'account:get:budget-123:account-A',
            'account:get:budget-123:account-B',
            'month:get:budget-123:2024-03-01',
            'month:get:budget-123:2024-04-01',
          ]),
        );
      });

      it('deduplicates cache keys for repeated accounts and months', async () => {
        const batch = [
          buildTransaction({ account_id: 'repeat-account', date: '2024-05-10' }),
          buildTransaction({ account_id: 'repeat-account', date: '2024-05-20' }),
        ];
        const apiTransactions = batch.map((txn, index) =>
          buildApiTransaction({ ...txn, id: `repeat-cache-${index + 1}` }),
        );
        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        await handleCreateTransactions(mockYnabAPI, buildParams({ transactions: batch }));

        const deletedKeys = cacheManager.deleteMany.mock.calls.flatMap((args) => args[0] ?? []);
        const uniqueKeys = new Set(deletedKeys);
        expect(uniqueKeys.has('account:get:budget-123:repeat-account')).toBe(true);
        expect(uniqueKeys.has('month:get:budget-123:2024-05-01')).toBe(true);
        expect(deletedKeys.filter((key) => key === 'account:get:budget-123:repeat-account')).toHaveLength(
          1,
        );
      });

      it('does not invalidate caches during dry runs', async () => {
        await handleCreateTransactions(
          mockYnabAPI,
          buildParams({
            dry_run: true,
          }),
        );
        expect(cacheManager.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe('error handling and edge cases', () => {
      it('propagates API failures', async () => {
        (mockYnabAPI.transactions.createTransactions as any).mockRejectedValue(
          new Error('500 Internal Server Error'),
        );
        const result = await handleCreateTransactions(mockYnabAPI, buildParams());
        const parsed = JSON.parse(result.content?.[0]?.text ?? '{}');
        expect(parsed.error).toBeDefined();
      });

      it('handles general validation errors outside of dry run', async () => {
        const invalidParams = {
          budget_id: 'budget-123',
          transactions: [],
        };
        const result = await handleCreateTransactions(mockYnabAPI, invalidParams as any);
        const parsed = JSON.parse(result.content?.[0]?.text ?? '{}');
        expect(parsed.error).toBeDefined();
      });

      it('supports transactions without payees or categories and special memo characters', async () => {
        const batch = [
          buildTransaction({ memo: 'Special | memo', payee_name: undefined, category_id: undefined }),
        ];
        const apiTransactions = batch.map((txn) => buildApiTransaction(txn));
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );
        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams({ transactions: batch })),
        );
        expect(response.results[0].status).toBe('created');
      });

      it('allows transfer transactions by passing transfer payee ids', async () => {
        const batch = [
          buildTransaction({
            payee_id: 'transfer_payee_account_ABC',
            memo: 'Transfer out',
          }),
        ];
        const apiTransactions = batch.map((txn) => buildApiTransaction(txn));
        (mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );
        const response = await parseResponse(
          handleCreateTransactions(mockYnabAPI, buildParams({ transactions: batch })),
        );
        expect(response.results[0].status).toBe('created');
      });
    });
  });

  describe('UpdateTransactionsSchema', () => {
    const buildUpdateTransaction = (overrides: Record<string, unknown> = {}) => ({
      id: 'transaction-123',
      ...overrides,
    });

    it('should accept a valid batch of updates with all fields optional except id', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [
          buildUpdateTransaction({ amount: -10000, memo: 'Updated' }),
          buildUpdateTransaction({ id: 'transaction-456', cleared: 'cleared' }),
        ],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transactions).toHaveLength(2);
      }
    });

    it('should require id field for each transaction', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [{ amount: -5000 }],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('id');
      }
    });

    it('should accept minimum batch size of one transaction', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildUpdateTransaction()],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it('should accept maximum batch size of 100 transactions', () => {
      const hundred = Array.from({ length: 100 }, (_, index) =>
        buildUpdateTransaction({ id: `transaction-${index + 1}` }),
      );
      const params = { budget_id: 'budget-123', transactions: hundred };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it('should reject empty transactions array', () => {
      const params = { budget_id: 'budget-123', transactions: [] };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('At least one transaction is required');
      }
    });

    it('should reject batches exceeding 100 transactions', () => {
      const overLimit = Array.from({ length: 101 }, (_, i) =>
        buildUpdateTransaction({ id: `transaction-${i}` }),
      );
      const params = { budget_id: 'budget-123', transactions: overLimit };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('A maximum of 100 transactions');
      }
    });

    it('should validate ISO date format for optional date field', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildUpdateTransaction({ date: '01/01/2024' })],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['transactions', 0, 'date']);
      }
    });

    it('should validate ISO date format for optional original_date field', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildUpdateTransaction({ original_date: '01/01/2024' })],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['transactions', 0, 'original_date']);
      }
    });

    it('should require integer milliunit amounts when provided', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildUpdateTransaction({ amount: -50.25 })],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['transactions', 0, 'amount']);
      }
    });

    it('should reject invalid cleared enum values', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildUpdateTransaction({ cleared: 'pending' })],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it('should accept optional metadata fields for cache invalidation', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [
          buildUpdateTransaction({
            original_account_id: 'account-old',
            original_date: '2024-01-01',
          }),
        ],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transactions[0].original_account_id).toBe('account-old');
        expect(result.data.transactions[0].original_date).toBe('2024-01-01');
      }
    });

    it('should accept update with only id field (no changes)', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [{ id: 'transaction-123' }],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it('should reject account_id field (account moves not supported)', () => {
      const params = {
        budget_id: 'budget-123',
        transactions: [buildUpdateTransaction({ account_id: 'new-account-456' })],
      };
      const result = UpdateTransactionsSchema.safeParse(params);
      expect(result.success).toBe(false);
      if (!result.success) {
        // Expect "unrecognized_keys" error from strict() schema
        expect(result.error.issues[0].code).toBe('unrecognized_keys');
        expect(result.error.issues[0].path).toEqual(['transactions', 0]);
      }
    });
  });

  describe('handleUpdateTransactions', () => {
    let transactionCounter = 0;

    const buildUpdateTransaction = (overrides: Record<string, unknown> = {}) => ({
      id: 'transaction-001',
      original_account_id: 'account-001',
      original_date: '2024-01-01',
      ...overrides,
    });

    const buildUpdateTransactionWithoutMetadata = (overrides: Record<string, unknown> = {}) =>
      buildUpdateTransaction({
        original_account_id: undefined,
        original_date: undefined,
        ...overrides,
      });

    const buildParams = (overrides: Record<string, unknown> = {}) => ({
      budget_id: 'budget-123',
      transactions: [buildUpdateTransaction()],
      ...overrides,
    });

    const buildApiTransaction = (overrides: Record<string, unknown> = {}) => ({
      id: overrides['id'] ?? `transaction-${++transactionCounter}`,
      account_id: overrides['account_id'] ?? 'account-001',
      date: overrides['date'] ?? '2024-01-01',
      amount: overrides['amount'] ?? -1500,
      memo: overrides['memo'] ?? 'Updated',
      cleared: overrides['cleared'] ?? 'cleared',
      approved: overrides['approved'] ?? true,
      flag_color: overrides['flag_color'] ?? null,
      account_name: overrides['account_name'] ?? 'Checking',
      payee_id: overrides['payee_id'] ?? null,
      payee_name: overrides['payee_name'] ?? null,
      category_id: overrides['category_id'] ?? null,
      category_name: overrides['category_name'] ?? null,
      transfer_account_id: overrides['transfer_account_id'] ?? null,
      transfer_transaction_id: overrides['transfer_transaction_id'] ?? null,
      matched_transaction_id: overrides['matched_transaction_id'] ?? null,
      import_id: overrides['import_id'] ?? null,
      deleted: overrides['deleted'] ?? false,
      subtransactions: [],
    });

    const buildApiResponse = (
      transactions: Record<string, unknown>[],
      extras: Record<string, unknown> = {},
    ) => ({
      data: {
        transactions,
        server_knowledge: extras['server_knowledge'] ?? 1,
      },
    });

    const parseResponse = async (resultPromise: ReturnType<typeof handleUpdateTransactions>) => {
      const result = await resultPromise;
      const text = result.content?.[0]?.text ?? '{}';
      return JSON.parse(text) as Record<string, any>;
    };

    beforeEach(() => {
      transactionCounter = 0;
      (mockYnabAPI.transactions.updateTransactions as any).mockReset();
      (mockYnabAPI.transactions.getTransactionById as any).mockReset();
      cacheManager.delete.mockReset();
      cacheManager.deleteMany.mockReset();
      (cacheManager.get as any).mockReset();
      (CacheManager.generateKey as any).mockReset();
    });

    describe('dry run', () => {
      it('returns validation summary without calling the API', async () => {
        const params = buildParams({
          dry_run: true,
          transactions: [
            buildUpdateTransaction({ id: 'transaction-001', amount: -2000 }),
            buildUpdateTransaction({ id: 'transaction-002', memo: 'Updated memo' }),
          ],
        });

        const response = await parseResponse(handleUpdateTransactions(mockYnabAPI, params));

        expect(mockYnabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
        expect(response.dry_run).toBe(true);
        expect(response.summary.total_transactions).toBe(2);
        expect(response.transactions_preview).toHaveLength(2);
        expect(cacheManager.deleteMany).not.toHaveBeenCalled();
      });

      it('provides before/after preview showing only changed fields', async () => {
        const currentTransaction = buildApiTransaction({
          id: 'transaction-001',
          amount: -5000,
          memo: 'Old memo',
          cleared: 'uncleared',
        });

        (cacheManager.get as any).mockReturnValue(null);
        (mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue({
          data: { transaction: currentTransaction },
        });

        const params = buildParams({
          dry_run: true,
          transactions: [
            buildUpdateTransaction({
              id: 'transaction-001',
              amount: -10000,
              memo: 'New memo',
            }),
          ],
        });

        const response = await parseResponse(handleUpdateTransactions(mockYnabAPI, params));

        expect(response.dry_run).toBe(true);
        expect(response.transactions_preview).toHaveLength(1);

        const preview = response.transactions_preview[0];
        expect(preview.transaction_id).toBe('transaction-001');
        expect(preview.before).toEqual({
          amount: -5,
          memo: 'Old memo',
        });
        expect(preview.after).toEqual({
          amount: -10,
          memo: 'New memo',
        });
      });

      it('sets before to "unavailable" when current state cannot be fetched', async () => {
        (cacheManager.get as any).mockReturnValue(null);
        (mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(
          new Error('Not found'),
        );

        const params = buildParams({
          dry_run: true,
          transactions: [
            buildUpdateTransaction({
              id: 'transaction-001',
              amount: -10000,
            }),
          ],
        });

        const response = await parseResponse(handleUpdateTransactions(mockYnabAPI, params));

        expect(response.dry_run).toBe(true);
        const preview = response.transactions_preview[0];
        expect(preview.before).toBe('unavailable');
        expect(preview.after).toBeDefined();
      });

      it('includes summary with accounts_affected and fields_to_update', async () => {
        (cacheManager.get as any).mockReturnValue(null);
        (mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue({
          data: {
            transaction: buildApiTransaction({
              id: 'transaction-001',
              account_id: 'account-001',
              date: '2024-01-01',
            }),
          },
        });

        const params = buildParams({
          dry_run: true,
          transactions: [
            buildUpdateTransaction({
              id: 'transaction-001',
              amount: -10000,
              memo: 'Updated',
              original_account_id: 'account-001',
              original_date: '2024-01-01',
            }),
          ],
        });

        const response = await parseResponse(handleUpdateTransactions(mockYnabAPI, params));

        expect(response.summary.accounts_affected).toContain('account-001');
        expect(response.summary.fields_to_update).toContain('amount');
        expect(response.summary.fields_to_update).toContain('memo');
      });

      it('surfaces validation errors before execution', async () => {
        const invalidParams = buildParams({
          transactions: [{ amount: -2000 }],
        });

        const result = await handleUpdateTransactions(mockYnabAPI, invalidParams as any);
        const parsed = JSON.parse(result.content?.[0]?.text ?? '{}');
        expect(parsed.error).toBeDefined();
        expect(parsed.error.message).toContain('validation failed');
        expect(mockYnabAPI.transactions.updateTransactions).not.toHaveBeenCalled();
      });

      it('reuses metadata resolution output for preview without duplicate fetches', async () => {
        const currentTransaction = buildApiTransaction({
          id: 'transaction-001',
          amount: -5000,
          memo: 'Old memo',
          account_id: 'account-001',
          date: '2024-01-01',
        });

        // Mock cache to return the transaction for metadata resolution
        (cacheManager.get as any).mockImplementation((key: string) => {
          if (key.includes('transaction-001')) {
            return currentTransaction;
          }
          return null;
        });
        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );

        const params = buildParams({
          dry_run: true,
          transactions: [
            buildUpdateTransaction({
              id: 'transaction-001',
              amount: -10000,
              memo: 'New memo',
            }),
          ],
        });

        const response = await parseResponse(handleUpdateTransactions(mockYnabAPI, params));

        // Verify the transaction was fetched only once during metadata resolution
        // After refactoring, getTransactionById should NOT be called because
        // resolveMetadata already provided the full TransactionDetail
        expect(mockYnabAPI.transactions.getTransactionById).not.toHaveBeenCalled();

        // Verify preview still works correctly
        expect(response.dry_run).toBe(true);
        expect(response.transactions_preview).toHaveLength(1);
        const preview = response.transactions_preview[0];
        expect(preview.transaction_id).toBe('transaction-001');
        expect(preview.before).toEqual({
          amount: -5,
          memo: 'Old memo',
        });
        expect(preview.after).toEqual({
          amount: -10,
          memo: 'New memo',
        });
      });
    });

    describe('successful updates', () => {
      it('updates transactions and correlates results', async () => {
        const transactions = [
          buildUpdateTransaction({ id: 'transaction-001', amount: -10000 }),
          buildUpdateTransaction({ id: 'transaction-002', memo: 'New memo' }),
        ];

        const apiTransactions = transactions.map((transaction) =>
          buildApiTransaction({ id: transaction.id }),
        );

        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );

        const response = await parseResponse(
          handleUpdateTransactions(mockYnabAPI, buildParams({ transactions })),
        );

        expect(response.summary.updated).toBe(2);
        expect(response.results).toHaveLength(2);
        expect(response.results.every((result: any) => result.status === 'updated')).toBe(true);
        const deletedKeys = cacheManager.deleteMany.mock.calls.flatMap((args) => args[0] ?? []);
        expect(deletedKeys).toEqual(expect.arrayContaining(['transactions:list:budget-123:all']));
      });

      it('only updates provided fields (partial updates)', async () => {
        const transaction = buildUpdateTransaction({
          id: 'transaction-001',
          memo: 'Updated memo only',
        });

        const apiTransaction = buildApiTransaction({ id: 'transaction-001' });
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse([apiTransaction]),
        );

        await handleUpdateTransactions(mockYnabAPI, buildParams({ transactions: [transaction] }));

        const updateCall = (mockYnabAPI.transactions.updateTransactions as any).mock.calls[0];
        const updatePayload = updateCall[1].transactions[0];
        expect(updatePayload.transaction.memo).toBe('Updated memo only');
        expect(updatePayload.transaction.amount).toBeUndefined();
        expect(updatePayload.transaction.account_id).toBeUndefined();
      });
    });

    describe('metadata resolution for cache invalidation', () => {
      it('uses client-supplied original_* metadata when provided', async () => {
        const transaction = buildUpdateTransaction({
          id: 'transaction-001',
          amount: -5000,
          original_account_id: 'account-old',
          original_date: '2024-01-01',
        });

        const apiTransaction = buildApiTransaction({ id: 'transaction-001' });
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse([apiTransaction]),
        );

        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );

        await handleUpdateTransactions(mockYnabAPI, buildParams({ transactions: [transaction] }));

        // Should not need to fetch transaction since metadata was provided
        expect(mockYnabAPI.transactions.getTransactionById).not.toHaveBeenCalled();

        // Should invalidate cache using provided metadata
        const deletedKeys = cacheManager.deleteMany.mock.calls.flatMap((args) => args[0] ?? []);
        expect(deletedKeys).toEqual(
          expect.arrayContaining([
            'account:get:budget-123:account-old',
            'month:get:budget-123:2024-01-01',
          ]),
        );
      });

      it('falls back to cache when metadata not provided', async () => {
        const transaction = buildUpdateTransactionWithoutMetadata({
          id: 'transaction-001',
          amount: -5000,
        });

        const cachedTransaction = {
          id: 'transaction-001',
          account_id: 'account-cached',
          date: '2024-02-01',
        };

        (cacheManager.get as any).mockReturnValue(cachedTransaction);

        const apiTransaction = buildApiTransaction({ id: 'transaction-001' });
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse([apiTransaction]),
        );

        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );

        await handleUpdateTransactions(mockYnabAPI, buildParams({ transactions: [transaction] }));

        // Should use cache and not fetch from API
        expect(cacheManager.get).toHaveBeenCalled();
        expect(mockYnabAPI.transactions.getTransactionById).not.toHaveBeenCalled();

        // Should invalidate cache using cached metadata
        const deletedKeys = cacheManager.deleteMany.mock.calls.flatMap((args) => args[0] ?? []);
        expect(deletedKeys).toEqual(
          expect.arrayContaining([
            'account:get:budget-123:account-cached',
            'month:get:budget-123:2024-02-01',
          ]),
        );
      });

      it('falls back to API when metadata not in cache', async () => {
        const transaction = buildUpdateTransactionWithoutMetadata({
          id: 'transaction-001',
          amount: -5000,
        });

        (cacheManager.get as any).mockReturnValue(null);

        const fetchedTransaction = {
          data: {
            transaction: {
              id: 'transaction-001',
              account_id: 'account-fetched',
              date: '2024-03-01',
            },
          },
        };

        (mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue(
          fetchedTransaction,
        );

        const apiTransaction = buildApiTransaction({ id: 'transaction-001' });
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse([apiTransaction]),
        );

        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );

        await handleUpdateTransactions(mockYnabAPI, buildParams({ transactions: [transaction] }));

        // Should fetch from API when not in cache
        expect(cacheManager.get).toHaveBeenCalled();
        expect(mockYnabAPI.transactions.getTransactionById).toHaveBeenCalledWith(
          'budget-123',
          'transaction-001',
        );

        // Should invalidate cache using fetched metadata
        const deletedKeys = cacheManager.deleteMany.mock.calls.flatMap((args) => args[0] ?? []);
        expect(deletedKeys).toEqual(
          expect.arrayContaining([
            'account:get:budget-123:account-fetched',
            'month:get:budget-123:2024-03-01',
          ]),
        );
      });
    });

    describe('error handling', () => {
      it('handles network failures', async () => {
        const error = new Error('Network error');
        (mockYnabAPI.transactions.updateTransactions as any).mockRejectedValue(error);

        const result = await handleUpdateTransactions(
          mockYnabAPI,
          buildParams({
            transactions: [buildUpdateTransaction()],
          }),
        );

        const response = JSON.parse(result.content[0].text);
        expect(response.error).toBeDefined();
      });

      it('handles invalid transaction IDs gracefully', async () => {
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue({
          data: {
            transactions: [],
            server_knowledge: 1,
          },
        });

        (cacheManager.get as any).mockReturnValue({
          account_id: 'account-valid',
          date: '2024-01-01',
        });

        const response = await parseResponse(
          handleUpdateTransactions(
            mockYnabAPI,
            buildParams({
              transactions: [buildUpdateTransaction({ id: 'invalid-id' })],
            }),
          ),
        );

        expect(response.results[0].status).toBe('failed');
        expect(response.results[0].error_code).toBe('update_failed');
      });

      it('handles metadata resolution failures without crashing', async () => {
        const transaction = buildUpdateTransaction({
          id: 'transaction-001',
          amount: -5000,
        });

        (cacheManager.get as any).mockReturnValue(null);
        (mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(
          new Error('Transaction not found'),
        );

        const apiTransaction = buildApiTransaction({ id: 'transaction-001' });
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse([apiTransaction]),
        );

        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );

        // Should complete successfully even if metadata resolution fails
        const response = await parseResponse(
          handleUpdateTransactions(mockYnabAPI, buildParams({ transactions: [transaction] })),
        );

        expect(response.summary.updated).toBe(1);
      });
    });

    describe('metadata completeness threshold', () => {
      it('throws ValidationError when >5% of transactions have missing metadata (live mode)', async () => {
        // Create 20 transactions, 2 (10%) with missing metadata - exceeds 5% threshold
        const transactions = Array.from({ length: 20 }, (_, i) =>
          i < 2
            ? buildUpdateTransactionWithoutMetadata({
                id: `transaction-${i + 1}`,
                amount: -1000,
              })
            : buildUpdateTransaction({
                id: `transaction-${i + 1}`,
                amount: -1000,
              }),
        );

        // Mock cache miss for all transactions
        (cacheManager.get as any).mockReturnValue(null);

        // Mock API to fail for 2 transactions (10% > 5% threshold)
        (mockYnabAPI.transactions.getTransactionById as any).mockImplementation(
          async (budgetId: string, transactionId: string) => {
            if (transactionId === 'transaction-1' || transactionId === 'transaction-2') {
              throw new Error('Transaction not found');
            }
            return {
              data: {
                transaction: {
                  id: transactionId,
                  account_id: 'account-001',
                  date: '2024-01-01',
                },
              },
            };
          },
        );


        const result = await handleUpdateTransactions(mockYnabAPI, buildParams({ transactions }));
        const response = JSON.parse(result.content[0].text);

        expect(response.error).toBeDefined();
        expect(response.error.code).toBe('VALIDATION_ERROR');
        expect(response.error.message).toContain('METADATA_INCOMPLETE');
        expect(response.error.details).toContain('10.0%');
      });

      it('succeeds when <=5% of transactions have missing metadata (live mode)', async () => {
        // Create 20 transactions, 1 (5%) with missing metadata - at threshold
        const transactions = Array.from({ length: 20 }, (_, i) =>
          i === 0
            ? buildUpdateTransactionWithoutMetadata({
                id: `transaction-${i + 1}`,
                amount: -1000,
              })
            : buildUpdateTransaction({
                id: `transaction-${i + 1}`,
                amount: -1000,
              }),
        );

        (cacheManager.get as any).mockReturnValue(null);

        // Mock API to fail for only 1 transaction (5% = threshold)
        (mockYnabAPI.transactions.getTransactionById as any).mockImplementation(
          async (budgetId: string, transactionId: string) => {
            if (transactionId === 'transaction-1') {
              throw new Error('Transaction not found');
            }
            return {
              data: {
                transaction: {
                  id: transactionId,
                  account_id: 'account-001',
                  date: '2024-01-01',
                },
              },
            };
          },
        );

        const apiTransactions = transactions.map((t) => buildApiTransaction({ id: t.id }));
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const response = await parseResponse(
          handleUpdateTransactions(mockYnabAPI, buildParams({ transactions })),
        );

        expect(response.summary.updated).toBe(20);
      });

      it('returns warnings in dry_run mode when metadata is missing', async () => {
        const transactions = [
          buildUpdateTransactionWithoutMetadata({ id: 'transaction-001' }),
          buildUpdateTransactionWithoutMetadata({ id: 'transaction-002' }),
        ];

        (cacheManager.get as any).mockReturnValue(null);
        (mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(
          new Error('Not found'),
        );

        const response = await parseResponse(
          handleUpdateTransactions(mockYnabAPI, buildParams({ transactions, dry_run: true })),
        );

        expect(response.dry_run).toBe(true);
        expect(response.warnings).toBeDefined();
        expect(response.warnings).toHaveLength(1);
        expect(response.warnings[0].code).toBe('metadata_unavailable');
        expect(response.warnings[0].count).toBe(2);
        expect(response.warnings[0].sample_ids).toEqual(['transaction-001', 'transaction-002']);
      });

      it('does not return warnings in dry_run when all metadata is resolved', async () => {
        const transactions = [
          buildUpdateTransaction({
            id: 'transaction-001',
            original_account_id: 'account-001',
            original_date: '2024-01-01',
          }),
        ];

        (cacheManager.get as any).mockImplementation((key: string) => {
          if (key.includes('transaction-001')) {
            return buildApiTransaction({ id: 'transaction-001' });
          }
          return null;
        });

        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );

        const response = await parseResponse(
          handleUpdateTransactions(mockYnabAPI, buildParams({ transactions, dry_run: true })),
        );

        expect(response.dry_run).toBe(true);
        expect(response.warnings).toBeUndefined();
      });
    });

    describe('correlation_key in results', () => {
      it('includes correlation_key in successful update results', async () => {
        const transactions = [
          buildUpdateTransaction({ id: 'transaction-001', amount: -2000 }),
          buildUpdateTransaction({ id: 'transaction-002', memo: 'Updated' }),
        ];

        const apiTransactions = transactions.map((transaction) =>
          buildApiTransaction({ id: transaction.id }),
        );

        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const response = await parseResponse(
          handleUpdateTransactions(mockYnabAPI, buildParams({ transactions })),
        );

        expect(response.results).toHaveLength(2);
        expect(response.results[0].correlation_key).toBe('transaction-001');
        expect(response.results[1].correlation_key).toBe('transaction-002');
      });

      it('includes correlation_key in failed update results', async () => {
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue({
          data: {
            transactions: [],
            server_knowledge: 1,
          },
        });

        const response = await parseResponse(
          handleUpdateTransactions(
            mockYnabAPI,
            buildParams({
              transactions: [buildUpdateTransaction({ id: 'failed-id' })],
            }),
          ),
        );

        expect(response.results[0].status).toBe('failed');
        expect(response.results[0].correlation_key).toBe('failed-id');
      });

      it('preserves correlation_key in ids_only downgrade mode', async () => {
        const byteSpy = vi.spyOn(Buffer, 'byteLength');
        byteSpy
          .mockImplementationOnce(() => 70 * 1024)
          .mockImplementationOnce(() => 97 * 1024)
          .mockImplementationOnce(() => 80 * 1024);

        const apiTransactions = [buildApiTransaction({ id: 'transaction-001' })];
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const response = await parseResponse(
          handleUpdateTransactions(
            mockYnabAPI,
            buildParams({ transactions: [buildUpdateTransaction({ id: 'transaction-001' })] }),
          ),
        );

        expect(response.mode).toBe('ids_only');
        expect(response.results[0].correlation_key).toBe('transaction-001');
        expect(response.results[0].transaction_id).toBe('transaction-001');
        expect(response.results[0].status).toBe('updated');

        byteSpy.mockRestore();
      });
    });

    describe('response size management', () => {
      beforeEach(() => {
        (cacheManager.get as any).mockReturnValue({
          account_id: 'account-default',
          date: '2024-01-01',
        });
      });

      it('keeps full response when under 64KB', async () => {
        const apiTransactions = [buildApiTransaction()];
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );
        const response = await parseResponse(handleUpdateTransactions(mockYnabAPI, buildParams()));
        expect(response.transactions).toBeDefined();
        expect(response.mode).toBe('full');
      });

      it('downgrades to summary mode when response exceeds 64KB', async () => {
        const byteSpy = vi.spyOn(Buffer, 'byteLength');
        byteSpy.mockImplementationOnce(() => 70 * 1024).mockImplementationOnce(() => 80 * 1024);
        const apiTransactions = [buildApiTransaction()];
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse(apiTransactions),
        );

        const response = await parseResponse(handleUpdateTransactions(mockYnabAPI, buildParams()));

        expect(response.transactions).toBeUndefined();
        expect(response.mode).toBe('summary');
        byteSpy.mockRestore();
      });
    });

    describe('cache invalidation', () => {
      it('invalidates transaction and account caches after successful updates', async () => {
        const transaction = buildUpdateTransaction({
          id: 'transaction-001',
          // Note: account_id is not included because account moves are not supported
          original_account_id: 'account-old',
          original_date: '2024-01-01',
          amount: -2000, // Include a change so the update does something
        });

        // Mock cache to return null (no cached data)
        (cacheManager.get as any).mockReturnValue(null);

        const apiTransaction = buildApiTransaction({ id: 'transaction-001' });
        (mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
          buildApiResponse([apiTransaction]),
        );

        (CacheManager.generateKey as any).mockImplementation(
          (scope: string, action: string, budgetId: string, qualifier?: string) =>
            `${scope}:${action}:${budgetId}:${qualifier ?? 'all'}`,
        );

        const response = await parseResponse(
          handleUpdateTransactions(mockYnabAPI, buildParams({ transactions: [transaction] })),
        );

        // Verify the update was successful
        expect(response.error).toBeUndefined();
        expect(response.summary).toBeDefined();
        expect(response.summary.updated).toBe(1);

        const deletedKeys = cacheManager.deleteMany.mock.calls.flatMap((args) => args[0] ?? []);
        expect(deletedKeys).toEqual(
          expect.arrayContaining([
            'transactions:list:budget-123:all',
            'transaction:get:budget-123:transaction-001',
            'account:get:budget-123:account-old',
            'month:get:budget-123:2024-01-01', // Month from original_date
          ]),
        );
      });

      it('does not invalidate cache on dry run', async () => {
        await handleUpdateTransactions(
          mockYnabAPI,
          buildParams({
            dry_run: true,
            transactions: [buildUpdateTransaction()],
          }),
        );

        expect(cacheManager.deleteMany).not.toHaveBeenCalled();
        expect(cacheManager.delete).not.toHaveBeenCalled();
      });
    });
  });
});
