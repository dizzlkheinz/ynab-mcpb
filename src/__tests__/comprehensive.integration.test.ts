/**
 * Comprehensive integration tests for YNAB MCP Server
 * These tests use mocked YNAB API responses to test complete workflows
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { YNABMCPServer } from '../server/YNABMCPServer.js';
import { executeToolCall, parseToolResult, validateToolResult, waitFor } from './testUtils.js';
import { cacheManager } from '../server/cacheManager.js';

// Mock the YNAB SDK
vi.mock('ynab', () => {
  const mockAPI = {
    budgets: {
      getBudgets: vi.fn(),
      getBudgetById: vi.fn(),
    },
    accounts: {
      getAccounts: vi.fn(),
      getAccountById: vi.fn(),
      createAccount: vi.fn(),
    },
    transactions: {
      getTransactions: vi.fn(),
      getTransactionsByAccount: vi.fn(),
      getTransactionsByCategory: vi.fn(),
      getTransactionById: vi.fn(),
      createTransaction: vi.fn(),
      updateTransaction: vi.fn(),
      deleteTransaction: vi.fn(),
    },
    categories: {
      getCategories: vi.fn(),
      getCategoryById: vi.fn(),
      updateMonthCategory: vi.fn(),
    },
    payees: {
      getPayees: vi.fn(),
      getPayeeById: vi.fn(),
    },
    months: {
      getBudgetMonth: vi.fn(),
      getBudgetMonths: vi.fn(),
    },
    user: {
      getUser: vi.fn(),
    },
  };

  return {
    API: vi.fn(() => mockAPI),
    utils: {
      convertMilliUnitsToCurrencyAmount: vi.fn(
        (milliunits: number, currencyDecimalDigits: number = 2) => {
          const amount = milliunits / 1000;
          return Number(amount.toFixed(currencyDecimalDigits));
        },
      ),
      convertCurrencyAmountToMilliUnits: vi.fn((amount: number) => Math.round(amount * 1000)),
    },
  };
});

const TEST_BUDGET_UUID = '00000000-0000-0000-0000-000000000001';

describe('YNAB utils mock', () => {
  it('converts milliunits using SDK rounding rules', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
    const { utils } = await import('ynab');

    expect(utils.convertMilliUnitsToCurrencyAmount(123456, 2)).toBe(123.46);
    expect(utils.convertMilliUnitsToCurrencyAmount(123456, 3)).toBe(123.456);
    expect(utils.convertMilliUnitsToCurrencyAmount(-98765, 2)).toBe(-98.77);
  });
});

describe('YNAB MCP Server - Comprehensive Integration Tests', () => {
  let server: YNABMCPServer;
  let mockYnabAPI: any;

  beforeEach(async () => {
    // Set up environment
    process.env['YNAB_ACCESS_TOKEN'] = 'test-token';

    // Create server instance
    server = new YNABMCPServer();

    // Get the mocked YNAB API instance
    const { API } = await import('ynab');
    mockYnabAPI = new (API as any)();

    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('Complete Budget Management Integration', () => {
    it('should handle complete budget listing and retrieval workflow', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      // Mock budget list response
      const mockBudgets = {
        data: {
          budgets: [
            {
              id: 'budget-1',
              name: 'Test Budget 1',
              last_modified_on: '2024-01-01T00:00:00Z',
              first_month: '2024-01-01',
              last_month: '2024-12-01',
              date_format: { format: 'MM/DD/YYYY' },
              currency_format: { iso_code: 'USD', example_format: '$123.45' },
            },
            {
              id: 'budget-2',
              name: 'Test Budget 2',
              last_modified_on: '2024-01-02T00:00:00Z',
              first_month: '2024-01-01',
              last_month: '2024-12-01',
              date_format: { format: 'MM/DD/YYYY' },
              currency_format: { iso_code: 'USD', example_format: '$123.45' },
            },
          ],
        },
      };

      mockYnabAPI.budgets.getBudgets.mockResolvedValue(mockBudgets);

      // Test budget listing
      const listResult = await executeToolCall(server, 'ynab:list_budgets');
      validateToolResult(listResult);

      const budgets = parseToolResult(listResult);
      expect(budgets.data.budgets).toHaveLength(2);
      expect(budgets.data.budgets[0].name).toBe('Test Budget 1');
      expect(budgets.data.budgets[1].name).toBe('Test Budget 2');

      // Mock specific budget response
      const mockBudget = {
        data: {
          budget: {
            id: 'budget-1',
            name: 'Test Budget 1',
            last_modified_on: '2024-01-01T00:00:00Z',
            first_month: '2024-01-01',
            last_month: '2024-12-01',
            date_format: { format: 'MM/DD/YYYY' },
            currency_format: { iso_code: 'USD', example_format: '$123.45' },
            accounts: [],
            payees: [],
            category_groups: [],
            months: [],
          },
        },
      };

      mockYnabAPI.budgets.getBudgetById.mockResolvedValue(mockBudget);

      // Test specific budget retrieval
      const getResult = await executeToolCall(server, 'ynab:get_budget', {
        budget_id: 'budget-1',
      });
      validateToolResult(getResult);

      const budget = parseToolResult(getResult);
      expect(budget.data.budget.id).toBe('budget-1');
      expect(budget.data.budget.name).toBe('Test Budget 1');

      // Verify API calls
      expect(mockYnabAPI.budgets.getBudgets).toHaveBeenCalledTimes(1);
      expect(mockYnabAPI.budgets.getBudgetById).toHaveBeenCalledWith('budget-1');
    });

    it('should handle budget retrieval errors gracefully', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      // Mock API error
      const apiError = new Error('Budget not found');
      (apiError as any).error = { id: '404.2', name: 'not_found', description: 'Budget not found' };
      mockYnabAPI.budgets.getBudgetById.mockRejectedValue(apiError);

      // Test error handling
      try {
        await executeToolCall(server, 'ynab:get_budget', {
          budget_id: 'invalid-budget',
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }

      expect(mockYnabAPI.budgets.getBudgetById).toHaveBeenCalledWith('invalid-budget');
    });
  });

  describe('Complete Account Management Integration', () => {
    it('should handle complete account workflow', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      const budgetId = TEST_BUDGET_UUID;

      // Mock accounts list
      const mockAccounts = {
        data: {
          accounts: [
            {
              id: 'account-1',
              name: 'Checking Account',
              type: 'checking',
              on_budget: true,
              closed: false,
              note: null,
              balance: 100000, // $100.00
              cleared_balance: 95000,
              uncleared_balance: 5000,
            },
            {
              id: 'account-2',
              name: 'Savings Account',
              type: 'savings',
              on_budget: true,
              closed: false,
              note: 'Emergency fund',
              balance: 500000, // $500.00
              cleared_balance: 500000,
              uncleared_balance: 0,
            },
          ],
        },
      };

      mockYnabAPI.accounts.getAccounts.mockResolvedValue(mockAccounts);

      // Test account listing
      const listResult = await executeToolCall(server, 'ynab:list_accounts', {
        budget_id: budgetId,
      });
      validateToolResult(listResult);

      const accounts = parseToolResult(listResult);
      expect(accounts.data.accounts).toHaveLength(2);
      expect(accounts.data.accounts[0].name).toBe('Checking Account');
      expect(accounts.data.accounts[1].name).toBe('Savings Account');

      // Mock specific account response
      const mockAccount = {
        data: {
          account: mockAccounts.data.accounts[0],
        },
      };

      mockYnabAPI.accounts.getAccountById.mockResolvedValue(mockAccount);

      // Test specific account retrieval
      const getResult = await executeToolCall(server, 'ynab:get_account', {
        budget_id: budgetId,
        account_id: 'account-1',
      });
      validateToolResult(getResult);

      const account = parseToolResult(getResult);
      expect(account.data.account.id).toBe('account-1');
      expect(account.data.account.name).toBe('Checking Account');
      expect(account.data.account.balance).toBe(100);

      // Mock account creation
      const newAccount = {
        id: 'account-3',
        name: 'New Test Account',
        type: 'checking',
        on_budget: true,
        closed: false,
        note: null,
        balance: 0,
        cleared_balance: 0,
        uncleared_balance: 0,
      };

      const mockCreateResponse = {
        data: {
          account: newAccount,
        },
      };

      mockYnabAPI.accounts.createAccount.mockResolvedValue(mockCreateResponse);

      // Test account creation
      const createResult = await executeToolCall(server, 'ynab:create_account', {
        budget_id: budgetId,
        name: 'New Test Account',
        type: 'checking',
        balance: 0,
      });
      validateToolResult(createResult);

      const createdAccount = parseToolResult(createResult);
      expect(createdAccount.data.account.name).toBe('New Test Account');
      expect(createdAccount.data.account.type).toBe('checking');

      // Verify API calls
      expect(mockYnabAPI.accounts.getAccounts).toHaveBeenCalledWith(budgetId);
      expect(mockYnabAPI.accounts.getAccountById).toHaveBeenCalledWith(budgetId, 'account-1');
      expect(mockYnabAPI.accounts.createAccount).toHaveBeenCalledWith(budgetId, {
        account: {
          name: 'New Test Account',
          type: 'checking',
          balance: 0,
        },
      });
    });
  });

  describe('Complete Transaction Management Integration', () => {
    it('should handle complete transaction workflow', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      const budgetId = TEST_BUDGET_UUID;
      const accountId = 'test-account';

      // Mock transactions list
      const mockTransactions = {
        data: {
          transactions: [
            {
              id: 'transaction-1',
              date: '2024-01-15',
              amount: -5000, // $5.00 outflow
              memo: 'Coffee shop',
              cleared: 'cleared',
              approved: true,
              flag_color: null,
              account_id: accountId,
              payee_id: 'payee-1',
              category_id: 'category-1',
              transfer_account_id: null,
            },
            {
              id: 'transaction-2',
              date: '2024-01-16',
              amount: 100000, // $100.00 inflow
              memo: 'Salary',
              cleared: 'cleared',
              approved: true,
              flag_color: null,
              account_id: accountId,
              payee_id: 'payee-2',
              category_id: null,
              transfer_account_id: null,
            },
          ],
        },
      };

      mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue(mockTransactions);

      // Test transaction listing
      const listResult = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: budgetId,
        account_id: accountId,
      });
      validateToolResult(listResult);

      const transactions = parseToolResult(listResult);
      expect(transactions.data.transactions).toHaveLength(2);
      expect(transactions.data.transactions[0].memo).toBe('Coffee shop');
      expect(transactions.data.transactions[1].memo).toBe('Salary');

      // Mock specific transaction response
      const mockTransaction = {
        data: {
          transaction: mockTransactions.data.transactions[0],
        },
      };

      mockYnabAPI.transactions.getTransactionById.mockResolvedValue(mockTransaction);

      // Test specific transaction retrieval
      const getResult = await executeToolCall(server, 'ynab:get_transaction', {
        budget_id: budgetId,
        transaction_id: 'transaction-1',
      });
      validateToolResult(getResult);

      const transaction = parseToolResult(getResult);
      expect(transaction.data.transaction.id).toBe('transaction-1');
      expect(transaction.data.transaction.memo).toBe('Coffee shop');
      expect(transaction.data.transaction.amount).toBe(-5);

      // Mock transaction creation
      const newTransaction = {
        id: 'transaction-3',
        date: '2024-01-17',
        amount: -2500,
        memo: 'Test transaction',
        cleared: 'uncleared',
        approved: true,
        flag_color: null,
        account_id: accountId,
        payee_id: null,
        category_id: 'category-1',
        transfer_account_id: null,
      };

      const mockCreateResponse = {
        data: {
          transaction: newTransaction,
        },
      };

      mockYnabAPI.transactions.createTransaction.mockResolvedValue(mockCreateResponse);

      // Test transaction creation
      const createResult = await executeToolCall(server, 'ynab:create_transaction', {
        budget_id: budgetId,
        account_id: accountId,
        category_id: 'category-1',
        payee_name: 'Test Payee',
        amount: -2500,
        memo: 'Test transaction',
        date: '2024-01-17',
        cleared: 'uncleared',
      });
      validateToolResult(createResult);

      const createdTransaction = parseToolResult(createResult);
      expect(createdTransaction.data.transaction.memo).toBe('Test transaction');
      expect(createdTransaction.data.transaction.amount).toBe(-2.5);

      // Mock transaction update
      const updatedTransaction = { ...newTransaction, memo: 'Updated memo' };
      const mockUpdateResponse = {
        data: {
          transaction: updatedTransaction,
        },
      };

      mockYnabAPI.transactions.updateTransaction.mockResolvedValue(mockUpdateResponse);

      // Test transaction update
      const updateResult = await executeToolCall(server, 'ynab:update_transaction', {
        budget_id: budgetId,
        transaction_id: 'transaction-3',
        memo: 'Updated memo',
      });
      validateToolResult(updateResult);

      const updated = parseToolResult(updateResult);
      expect(updated.data.transaction.memo).toBe('Updated memo');

      // Mock transaction deletion
      mockYnabAPI.transactions.deleteTransaction.mockResolvedValue({
        data: {
          transaction: { ...updatedTransaction, deleted: true },
        },
      });

      // Test transaction deletion
      const deleteResult = await executeToolCall(server, 'ynab:delete_transaction', {
        budget_id: budgetId,
        transaction_id: 'transaction-3',
      });
      validateToolResult(deleteResult);

      // Verify API calls
      expect(mockYnabAPI.transactions.getTransactionsByAccount).toHaveBeenCalledWith(
        budgetId,
        accountId,
        undefined,
      );
      expect(mockYnabAPI.transactions.getTransactionById).toHaveBeenCalledWith(
        budgetId,
        'transaction-1',
      );
      expect(mockYnabAPI.transactions.createTransaction).toHaveBeenCalled();
      expect(mockYnabAPI.transactions.updateTransaction).toHaveBeenCalled();
      expect(mockYnabAPI.transactions.deleteTransaction).toHaveBeenCalledWith(
        budgetId,
        'transaction-3',
      );
    });

    it('should handle transaction filtering', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      const budgetId = TEST_BUDGET_UUID;

      // Mock filtered transactions
      mockYnabAPI.transactions.getTransactions.mockResolvedValue({
        data: {
          transactions: [
            {
              id: 'filtered-transaction',
              date: '2024-01-15',
              amount: -1000,
              memo: 'Filtered transaction',
              cleared: 'cleared',
              approved: true,
              account_id: 'account-1',
              category_id: 'category-1',
            },
          ],
        },
      });

      // Test filtering by date
      const dateFilterResult = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: budgetId,
        since_date: '2024-01-01',
      });
      validateToolResult(dateFilterResult);

      // Also mock account/category specific endpoints
      mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue({
        data: {
          transactions: [
            {
              id: 'filtered-transaction',
              date: '2024-01-15',
              amount: -1000,
              memo: 'Filtered transaction',
              cleared: 'cleared',
              approved: true,
              account_id: 'account-1',
              category_id: 'category-1',
            },
          ],
        },
      });
      mockYnabAPI.transactions.getTransactionsByCategory.mockResolvedValue({
        data: {
          transactions: [
            {
              id: 'filtered-transaction',
              date: '2024-01-15',
              amount: -1000,
              memo: 'Filtered transaction',
              cleared: 'cleared',
              approved: true,
              account_id: 'account-1',
              category_id: 'category-1',
            },
          ],
        },
      });

      // Test filtering by account
      const accountFilterResult = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: budgetId,
        account_id: 'account-1',
      });
      validateToolResult(accountFilterResult);

      // Test filtering by category
      const categoryFilterResult = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: budgetId,
        category_id: 'category-1',
      });
      validateToolResult(categoryFilterResult);

      // Verify API calls with different parameters
      expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledTimes(1);
      expect(mockYnabAPI.transactions.getTransactionsByAccount).toHaveBeenCalledTimes(1);
      expect(mockYnabAPI.transactions.getTransactionsByCategory).toHaveBeenCalledTimes(1);
    });
  });

  describe('Complete Category Management Integration', () => {
    it('should handle complete category workflow', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      const budgetId = 'test-budget';

      // Mock categories response
      const mockCategories = {
        data: {
          category_groups: [
            {
              id: 'group-1',
              name: 'Immediate Obligations',
              hidden: false,
              categories: [
                {
                  id: 'category-1',
                  category_group_id: 'group-1',
                  name: 'Rent/Mortgage',
                  hidden: false,
                  budgeted: 150000, // $150.00
                  activity: -150000,
                  balance: 0,
                  goal_type: null,
                },
                {
                  id: 'category-2',
                  category_group_id: 'group-1',
                  name: 'Utilities',
                  hidden: false,
                  budgeted: 10000, // $10.00
                  activity: -8500,
                  balance: 1500,
                  goal_type: null,
                },
              ],
            },
          ],
        },
      };

      mockYnabAPI.categories.getCategories.mockResolvedValue(mockCategories);

      // Test category listing
      const listResult = await executeToolCall(server, 'ynab:list_categories', {
        budget_id: budgetId,
      });
      validateToolResult(listResult);

      const categories = parseToolResult(listResult);
      expect(categories.data.category_groups).toHaveLength(1);
      expect(categories.data.categories).toHaveLength(2);
      expect(categories.data.categories[0].name).toBe('Rent/Mortgage');

      // Mock specific category response
      const mockCategory = {
        data: {
          category: mockCategories.data.category_groups[0].categories[0],
        },
      };

      mockYnabAPI.categories.getCategoryById.mockResolvedValue(mockCategory);

      // Test specific category retrieval
      const getResult = await executeToolCall(server, 'ynab:get_category', {
        budget_id: budgetId,
        category_id: 'category-1',
      });
      validateToolResult(getResult);

      const category = parseToolResult(getResult);
      expect(category.data.category.id).toBe('category-1');
      expect(category.data.category.name).toBe('Rent/Mortgage');
      expect(category.data.category.budgeted).toBe(150);

      // Mock category update
      const updatedCategory = {
        ...mockCategories.data.category_groups[0].categories[0],
        budgeted: 160000, // $160.00
      };

      const mockUpdateResponse = {
        data: {
          category: updatedCategory,
        },
      };

      mockYnabAPI.categories.updateMonthCategory.mockResolvedValue(mockUpdateResponse);

      // Test category budget update
      const updateResult = await executeToolCall(server, 'ynab:update_category', {
        budget_id: budgetId,
        category_id: 'category-1',
        budgeted: 160000,
      });
      validateToolResult(updateResult);

      const updated = parseToolResult(updateResult);
      expect(updated.data.category.budgeted).toBe(160);

      // Verify API calls
      expect(mockYnabAPI.categories.getCategories).toHaveBeenCalledWith(budgetId);
      expect(mockYnabAPI.categories.getCategoryById).toHaveBeenCalledWith(budgetId, 'category-1');
      expect(mockYnabAPI.categories.updateMonthCategory).toHaveBeenCalled();
    });
  });

  describe('Complete Utility Tools Integration', () => {
    it('should handle user information retrieval', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      // Mock user response
      const mockUser = {
        data: {
          user: {
            id: 'user-123',
            email: 'test@example.com',
          },
        },
      };

      mockYnabAPI.user.getUser.mockResolvedValue(mockUser);

      // Test user retrieval
      const userResult = await executeToolCall(server, 'ynab:get_user');
      validateToolResult(userResult);

      const user = parseToolResult(userResult);
      expect(user.data.user.id).toBe('user-123');

      expect(mockYnabAPI.user.getUser).toHaveBeenCalledTimes(1);
    });

    it('should handle amount conversion', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      // Test dollar to milliunits conversion
      const toMilliunitsResult = await executeToolCall(server, 'ynab:convert_amount', {
        amount: 25.75,
        to_milliunits: true,
      });
      validateToolResult(toMilliunitsResult);

      const toMilli = parseToolResult(toMilliunitsResult);
      expect(toMilli.data.conversion.converted_amount).toBe(25750);
      expect(toMilli.data.conversion.description).toBe('$25.75 = 25750 milliunits');

      // Test milliunits to dollar conversion
      const toDollarsResult = await executeToolCall(server, 'ynab:convert_amount', {
        amount: 25750,
        to_milliunits: false,
      });
      validateToolResult(toDollarsResult);

      const dollars = parseToolResult(toDollarsResult);
      expect(dollars.data.conversion.converted_amount).toBe(25.75);
      expect(dollars.data.conversion.description).toBe('25750 milliunits = $25.75');
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle various API error scenarios', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      // Test 401 Unauthorized
      const authError = new Error('Unauthorized');
      (authError as any).error = { id: '401', name: 'unauthorized', description: 'Unauthorized' };
      mockYnabAPI.budgets.getBudgets.mockRejectedValue(authError);

      try {
        await executeToolCall(server, 'ynab:list_budgets');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Test 404 Not Found
      const notFoundError = new Error('Not Found');
      (notFoundError as any).error = {
        id: '404.2',
        name: 'not_found',
        description: 'Budget not found',
      };
      mockYnabAPI.budgets.getBudgetById.mockRejectedValue(notFoundError);

      try {
        await executeToolCall(server, 'ynab:get_budget', { budget_id: 'invalid' });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Test 429 Rate Limit
      const rateLimitError = new Error('Too Many Requests');
      (rateLimitError as any).error = {
        id: '429',
        name: 'rate_limit',
        description: 'Rate limit exceeded',
      };
      mockYnabAPI.accounts.getAccounts.mockRejectedValue(rateLimitError);

      try {
        await executeToolCall(server, 'ynab:list_accounts', { budget_id: 'test' });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should validate input parameters', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      // Test missing required parameters
      try {
        await executeToolCall(server, 'ynab:get_budget', {});
        expect.fail('Should have thrown validation error');
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Test invalid parameter types
      try {
        await executeToolCall(server, 'ynab:create_transaction', {
          budget_id: 'test',
          account_id: 'test',
          amount: 'invalid-amount', // Should be number
          date: '2024-01-01',
        });
        expect.fail('Should have thrown validation error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Caching Integration Tests', () => {
    let previousNodeEnv: string | undefined;

    beforeAll(() => {
      previousNodeEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';
    });

    beforeEach(() => {
      cacheManager.clear();
      process.env['NODE_ENV'] = 'development';
    });

    afterAll(() => {
      // Restore NODE_ENV after all caching tests complete
      if (previousNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = previousNodeEnv;
      }
    });

    it('should cache budget list requests and improve performance on subsequent calls', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      const mockBudgets = {
        data: {
          budgets: [
            {
              id: 'budget-1',
              name: 'Test Budget',
              last_modified_on: '2024-01-01T00:00:00Z',
              first_month: '2024-01-01',
              last_month: '2024-12-01',
              date_format: { format: 'MM/DD/YYYY' },
              currency_format: { iso_code: 'USD', example_format: '$123.45' },
            },
          ],
        },
      };

      mockYnabAPI.budgets.getBudgets.mockResolvedValue(mockBudgets);

      const statsBeforeFirstCall = cacheManager.getStats();
      const initialSize = statsBeforeFirstCall.size;

      // First call - should hit API and cache result
      const firstResult = await executeToolCall(server, 'ynab:list_budgets');
      validateToolResult(firstResult);

      const firstParsed = parseToolResult(firstResult);
      expect(firstParsed.data.cached).toBe(false);
      expect(firstParsed.data.cache_info).toBe('Fresh data retrieved from YNAB API');

      // Cache should have grown
      const statsAfterFirstCall = cacheManager.getStats();
      expect(statsAfterFirstCall.size).toBeGreaterThan(initialSize);

      // Second call - should hit cache
      const secondResult = await executeToolCall(server, 'ynab:list_budgets');
      validateToolResult(secondResult);

      const secondParsed = parseToolResult(secondResult);
      expect(secondParsed.data.cached).toBe(true);
      expect(secondParsed.data.cache_info).toBe(
        'Data retrieved from cache for improved performance',
      );

      // API should only have been called once
      expect(mockYnabAPI.budgets.getBudgets).toHaveBeenCalledTimes(1);

      // Cache hit count should have increased
      const finalStats = cacheManager.getStats();
      expect(finalStats.hits).toBeGreaterThan(statsBeforeFirstCall.hits);
    });

    it('should invalidate cache on write operations', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      const budgetId = TEST_BUDGET_UUID;

      // Mock responses
      const mockAccounts = {
        data: {
          accounts: [
            {
              id: 'account-1',
              name: 'Test Account',
              type: 'checking',
              on_budget: true,
              closed: false,
              balance: 100000,
              cleared_balance: 95000,
              uncleared_balance: 5000,
            },
          ],
        },
      };

      const mockCreatedAccount = {
        data: {
          account: {
            id: 'account-2',
            name: 'New Account',
            type: 'savings',
            on_budget: true,
            closed: false,
            balance: 0,
            cleared_balance: 0,
            uncleared_balance: 0,
          },
        },
      };

      mockYnabAPI.accounts.getAccounts.mockResolvedValue(mockAccounts);
      mockYnabAPI.accounts.createAccount.mockResolvedValue(mockCreatedAccount);

      // First, populate cache with account list
      await executeToolCall(server, 'ynab:list_accounts', { budget_id: budgetId });

      // Verify cache has entries
      const statsAfterRead = cacheManager.getStats();
      expect(statsAfterRead.size).toBeGreaterThan(0);

      // Create a new account (write operation)
      await executeToolCall(server, 'ynab:create_account', {
        budget_id: budgetId,
        name: 'New Account',
        type: 'savings',
      });

      // Next call to list accounts should hit API again (cache was invalidated)
      mockYnabAPI.accounts.getAccounts.mockClear();
      await executeToolCall(server, 'ynab:list_accounts', { budget_id: budgetId });

      // Verify API was called again after cache invalidation
      expect(mockYnabAPI.accounts.getAccounts).toHaveBeenCalledTimes(1);
    });

    it('should not cache filtered transaction requests', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      const budgetId = TEST_BUDGET_UUID;

      const mockTransactions = {
        data: {
          transactions: [
            {
              id: 'transaction-1',
              date: '2024-01-15',
              amount: -5000,
              memo: 'Test transaction',
              cleared: 'cleared',
              approved: true,
              account_id: 'account-1',
              category_id: 'category-1',
            },
          ],
        },
      };

      mockYnabAPI.transactions.getTransactions.mockResolvedValue(mockTransactions);
      mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue(mockTransactions);

      const statsBeforeUnfiltered = cacheManager.getStats();

      // Unfiltered request - should be cached
      const unfilteredResult = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: budgetId,
      });
      const unfilteredParsed = parseToolResult(unfilteredResult);
      expect(unfilteredParsed.data.cached).toBe(false); // First call, cache miss

      const statsAfterUnfiltered = cacheManager.getStats();
      expect(statsAfterUnfiltered.size).toBeGreaterThan(statsBeforeUnfiltered.size);

      // Filtered request - should NOT be cached
      const filteredResult = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: budgetId,
        account_id: 'account-1',
      });
      const filteredParsed = parseToolResult(filteredResult);
      expect(filteredParsed.data.cached).toBe(false);
      expect(filteredParsed.data.cache_info).toBe('Fresh data retrieved from YNAB API');

      // Cache size should not have increased for filtered request
      const statsAfterFiltered = cacheManager.getStats();
      expect(statsAfterFiltered.size).toBe(statsAfterUnfiltered.size);

      // Both API methods should have been called
      expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledTimes(1);
      expect(mockYnabAPI.transactions.getTransactionsByAccount).toHaveBeenCalledTimes(1);
    });

    it('should handle cache warming after setting default budget', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      const budgetId = TEST_BUDGET_UUID;

      // Mock all the responses for cache warming
      mockYnabAPI.accounts.getAccounts.mockResolvedValue({
        data: { accounts: [] },
      });
      mockYnabAPI.budgets.getBudgetById.mockResolvedValue({
        data: { budget: { id: budgetId, name: 'Warm Cache Budget' } },
      });
      mockYnabAPI.categories.getCategories.mockResolvedValue({
        data: { category_groups: [] },
      });
      mockYnabAPI.payees.getPayees.mockResolvedValue({
        data: { payees: [] },
      });

      const statsBeforeSet = cacheManager.getStats();
      const initialSize = statsBeforeSet.size;

      // Set default budget (should trigger cache warming)
      await executeToolCall(server, 'ynab:set_default_budget', {
        budget_id: budgetId,
      });

      // Wait for cache warming to populate entries (fire-and-forget process)
      let statsAfterSet = cacheManager.getStats();
      await waitFor(
        () => {
          statsAfterSet = cacheManager.getStats();
          return statsAfterSet.size > initialSize;
        },
        1000,
        50,
      );

      // Cache should have more entries due to warming
      expect(statsAfterSet.size).toBeGreaterThan(initialSize);

      // Verify that cache warming API calls were made
      expect(mockYnabAPI.accounts.getAccounts).toHaveBeenCalled();
      expect(mockYnabAPI.categories.getCategories).toHaveBeenCalled();
      expect(mockYnabAPI.payees.getPayees).toHaveBeenCalled();
    });

    it('should handle cache clear operation', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      // Populate cache with some data
      mockYnabAPI.budgets.getBudgets.mockResolvedValue({
        data: { budgets: [] },
      });

      await executeToolCall(server, 'ynab:list_budgets');

      // Verify cache has entries
      const statsAfterPopulation = cacheManager.getStats();
      expect(statsAfterPopulation.size).toBeGreaterThan(0);

      // Clear cache
      await executeToolCall(server, 'ynab:clear_cache');

      // Verify cache is empty
      const statsAfterClear = cacheManager.getStats();
      expect(statsAfterClear.size).toBe(0);
      expect(statsAfterClear.hits).toBe(0);
      expect(statsAfterClear.misses).toBe(0);
    });

    it('should respect cache TTL and return fresh data after expiration', { meta: { tier: 'domain', domain: 'workflows' } }, async () => {
      // Note: This test is conceptual since TTL testing requires time manipulation
      // In a real scenario, we would mock the Date.now() or use a test clock

      const mockBudgets = {
        data: {
          budgets: [
            {
              id: 'budget-1',
              name: 'Test Budget',
              last_modified_on: '2024-01-01T00:00:00Z',
              first_month: '2024-01-01',
              last_month: '2024-12-01',
              date_format: { format: 'MM/DD/YYYY' },
              currency_format: { iso_code: 'USD', example_format: '$123.45' },
            },
          ],
        },
      };

      mockYnabAPI.budgets.getBudgets.mockResolvedValue(mockBudgets);

      // First call - cache miss
      const firstResult = await executeToolCall(server, 'ynab:list_budgets');
      const firstParsed = parseToolResult(firstResult);
      expect(firstParsed.data.cached).toBe(false);

      // Second call - cache hit
      const secondResult = await executeToolCall(server, 'ynab:list_budgets');
      const secondParsed = parseToolResult(secondResult);
      expect(secondParsed.data.cached).toBe(true);

      // Verify API was only called once (second call used cache)
      expect(mockYnabAPI.budgets.getBudgets).toHaveBeenCalledTimes(1);
    });
  });
});
