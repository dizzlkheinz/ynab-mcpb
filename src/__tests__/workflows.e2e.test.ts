/**
 * End-to-end workflow tests for YNAB MCP Server
 * These tests require a real YNAB API key and test budget
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { YNABMCPServer } from '../server/YNABMCPServer.js';
import { getCurrentMonth } from '../utils/dateUtils.js';
import {
  getTestConfig,
  createTestServer,
  executeToolCall,
  parseToolResult,
  isErrorResult,
  getErrorMessage,
  TestData,
  TestDataCleanup,
  YNABAssertions,
  validateOutputSchema,
} from './testUtils.js';
import { testEnv } from './setup.js';

const runE2ETests = process.env['SKIP_E2E_TESTS'] !== 'true';
const describeE2E = runE2ETests ? describe : describe.skip;

describeE2E('YNAB MCP Server - End-to-End Workflows', () => {
  let server: YNABMCPServer;
  let testConfig: ReturnType<typeof getTestConfig>;
  let cleanup: TestDataCleanup;
  let testBudgetId: string;
  let testAccountId: string;

  beforeAll(async () => {
    testConfig = getTestConfig();

    if (testConfig.skipE2ETests) {
      console.warn('Skipping E2E tests - no real API key or SKIP_E2E_TESTS=true');
      return;
    }

    server = await createTestServer();
    cleanup = new TestDataCleanup();

    // Get the first budget for testing
    const budgetsResult = await executeToolCall(server, 'ynab:list_budgets');
    const budgets = parseToolResult(budgetsResult);
    const budgetList = budgets.data?.budgets ?? [];

    if (!budgetList.length && !testConfig.testBudgetId) {
      throw new Error('No budgets found for testing. Please create a test budget in YNAB.');
    }

    testBudgetId = testConfig.testBudgetId ?? budgetList[0]?.id;

    // Get the first account for testing
    const accountsResult = await executeToolCall(server, 'ynab:list_accounts', {
      budget_id: testBudgetId,
    });
    const accounts = parseToolResult(accountsResult);
    const accountList = accounts.data?.accounts ?? [];

    if (!accountList.length) {
      if (testConfig.testAccountId) {
        testAccountId = testConfig.testAccountId;
      } else {
        throw new Error('No accounts found for testing. Please create a test account in YNAB.');
      }
    } else {
      testAccountId = testConfig.testAccountId ?? accountList[0].id;
    }
  });

  afterAll(async () => {
    if (testConfig.skipE2ETests) return;

    if (cleanup && server && testBudgetId) {
      await cleanup.cleanup(server, testBudgetId);
    }
  });

  beforeEach(() => {
    if (testConfig.skipE2ETests) {
      // Skip individual tests if E2E tests are disabled
      return;
    }
  });

  describe('Complete Budget Management Workflow', () => {
    it('should retrieve and validate budget information', async () => {
      if (testConfig.skipE2ETests) return;

      // List all budgets
      const budgetsResult = await executeToolCall(server, 'ynab:list_budgets');

      // Validate output schema
      const budgetsValidation = validateOutputSchema(server, 'list_budgets', budgetsResult);
      expect(budgetsValidation.valid).toBe(true);
      if (!budgetsValidation.valid) {
        console.error('list_budgets schema validation errors:', budgetsValidation.errors);
      }

      const budgets = parseToolResult(budgetsResult);

      // Verify backward compatibility contract: parseToolResult returns {success: true, data: ...}
      expect(budgets).toHaveProperty('success');
      expect(budgets.success).toBe(true);
      expect(budgets).toHaveProperty('data');

      expect(budgets.data).toBeDefined();
      expect(budgets.data.budgets).toBeDefined();
      expect(Array.isArray(budgets.data.budgets)).toBe(true);
      expect(budgets.data.budgets.length).toBeGreaterThan(0);

      // Validate budget structure
      budgets.data.budgets.forEach(YNABAssertions.assertBudget);

      // Get specific budget details
      const budgetResult = await executeToolCall(server, 'ynab:get_budget', {
        budget_id: testBudgetId,
      });

      // Validate output schema
      const budgetValidation = validateOutputSchema(server, 'get_budget', budgetResult);
      expect(budgetValidation.valid).toBe(true);
      if (!budgetValidation.valid) {
        console.error('get_budget schema validation errors:', budgetValidation.errors);
      }

      const budget = parseToolResult(budgetResult);

      expect(budget.data).toBeDefined();
      expect(budget.data.budget).toBeDefined();
      YNABAssertions.assertBudget(budget.data.budget);
      expect(budget.data.budget.id).toBe(testBudgetId);
    });

    it('should retrieve user information', async () => {
      if (testConfig.skipE2ETests) return;

      const userResult = await executeToolCall(server, 'ynab:get_user');
      const user = parseToolResult(userResult);

      expect(user.data).toBeDefined();
      expect(user.data.user).toBeDefined();
      expect(typeof user.data.user.id).toBe('string');
    });
  });

  describe('Complete Account Management Workflow', () => {
    it('should list and retrieve account information', async () => {
      if (testConfig.skipE2ETests) return;

      // List all accounts
      const accountsResult = await executeToolCall(server, 'ynab:list_accounts', {
        budget_id: testBudgetId,
      });

      // Validate output schema
      const accountsValidation = validateOutputSchema(server, 'list_accounts', accountsResult);
      expect(accountsValidation.valid).toBe(true);
      if (!accountsValidation.valid) {
        console.error('list_accounts schema validation errors:', accountsValidation.errors);
      }

      const accounts = parseToolResult(accountsResult);

      // Verify backward compatibility contract: parseToolResult returns {success: true, data: ...}
      expect(accounts).toHaveProperty('success');
      expect(accounts.success).toBe(true);
      expect(accounts).toHaveProperty('data');

      expect(accounts.data).toBeDefined();
      expect(accounts.data.accounts).toBeDefined();
      expect(Array.isArray(accounts.data.accounts)).toBe(true);
      expect(accounts.data.accounts.length).toBeGreaterThan(0);

      // Validate account structures
      accounts.data.accounts.forEach(YNABAssertions.assertAccount);

      // Get specific account details
      const accountResult = await executeToolCall(server, 'ynab:get_account', {
        budget_id: testBudgetId,
        account_id: testAccountId,
      });

      // Validate output schema
      const accountValidation = validateOutputSchema(server, 'get_account', accountResult);
      expect(accountValidation.valid).toBe(true);
      if (!accountValidation.valid) {
        console.error('get_account schema validation errors:', accountValidation.errors);
      }

      const account = parseToolResult(accountResult);

      expect(account.data).toBeDefined();
      expect(account.data.account).toBeDefined();
      YNABAssertions.assertAccount(account.data.account);
      expect(account.data.account.id).toBe(testAccountId);

      // Reconcile account as part of account management workflow
      const reconcileResult = await executeToolCall(server, 'ynab:reconcile_account', {
        budget_id: testBudgetId,
        account_id: testAccountId,
        cleared_balance: account.data.account.cleared_balance,
      });

      // Validate reconcile_account output schema
      const reconcileValidation = validateOutputSchema(server, 'reconcile_account', reconcileResult);
      expect(reconcileValidation.valid).toBe(true);
      if (!reconcileValidation.valid) {
        console.error('reconcile_account schema validation errors:', reconcileValidation.errors);
      }
    });

    it('should create a new account', async () => {
      if (testConfig.skipE2ETests) return;

      const accountName = TestData.generateAccountName();

      const createResult = await executeToolCall(server, 'ynab:create_account', {
        budget_id: testBudgetId,
        name: accountName,
        type: 'checking',
        balance: 10000, // $10.00
      });

      // Validate output schema
      const createValidation = validateOutputSchema(server, 'create_account', createResult);
      expect(createValidation.valid).toBe(true);
      if (!createValidation.valid) {
        console.error('create_account schema validation errors:', createValidation.errors);
      }

      const createdAccount = parseToolResult(createResult);

      expect(createdAccount.data).toBeDefined();
      expect(createdAccount.data.account).toBeDefined();
      YNABAssertions.assertAccount(createdAccount.data.account);
      expect(createdAccount.data.account.name).toBe(accountName);
      expect(createdAccount.data.account.type).toBe('checking');

      // Track for cleanup
      cleanup.trackAccount(createdAccount.data.account.id);

      // Verify account appears in list
      const accountsResult = await executeToolCall(server, 'ynab:list_accounts', {
        budget_id: testBudgetId,
      });
      const accounts = parseToolResult(accountsResult);

      const foundAccount = accounts.data.accounts.find(
        (acc: any) => acc.id === createdAccount.data.account.id,
      );
      expect(foundAccount).toBeDefined();
      expect(foundAccount.name).toBe(accountName);
    });
  });

  describe('Complete Transaction Management Workflow', () => {
    let testTransactionId: string;

    it('should create, retrieve, update, and delete a transaction', async () => {
      if (testConfig.skipE2ETests) return;

      // Get categories for transaction creation
      const categoriesResult = await executeToolCall(server, 'ynab:list_categories', {
        budget_id: testBudgetId,
      });
      const categories = parseToolResult(categoriesResult);

      expect(categories.data.category_groups).toBeDefined();
      expect(Array.isArray(categories.data.category_groups)).toBe(true);

      // Find a non-hidden category
      let testCategoryId: string | undefined;
      for (const group of categories.data.category_groups) {
        const availableCategory = group.categories?.find((cat: any) => !cat.hidden);
        if (availableCategory) {
          testCategoryId = availableCategory.id;
          break;
        }
      }

      // Create a transaction
      const transactionData = TestData.generateTransaction(testAccountId, testCategoryId);

      const createResult = await executeToolCall(server, 'ynab:create_transaction', {
        budget_id: testBudgetId,
        ...transactionData,
      });

      // Validate create_transaction output schema
      const createValidation = validateOutputSchema(server, 'create_transaction', createResult);
      expect(createValidation.valid).toBe(true);
      if (!createValidation.valid) {
        console.error('create_transaction schema validation errors:', createValidation.errors);
      }

      const createdTransaction = parseToolResult(createResult);

      // Verify backward compatibility contract: parseToolResult returns {success: true, data: ...}
      expect(createdTransaction).toHaveProperty('success');
      expect(createdTransaction.success).toBe(true);
      expect(createdTransaction).toHaveProperty('data');

      expect(createdTransaction.data).toBeDefined();
      expect(createdTransaction.data.transaction).toBeDefined();
      YNABAssertions.assertTransaction(createdTransaction.data.transaction);

      testTransactionId = createdTransaction.data.transaction.id;
      cleanup.trackTransaction(testTransactionId);

      // Retrieve the transaction
      const getResult = await executeToolCall(server, 'ynab:get_transaction', {
        budget_id: testBudgetId,
        transaction_id: testTransactionId,
      });

      // Validate get_transaction output schema
      const getValidation = validateOutputSchema(server, 'get_transaction', getResult);
      expect(getValidation.valid).toBe(true);
      if (!getValidation.valid) {
        console.error('get_transaction schema validation errors:', getValidation.errors);
      }

      const retrievedTransaction = parseToolResult(getResult);

      expect(retrievedTransaction.data).toBeDefined();
      expect(retrievedTransaction.data.transaction).toBeDefined();
      expect(retrievedTransaction.data.transaction.id).toBe(testTransactionId);
      YNABAssertions.assertTransaction(retrievedTransaction.data.transaction);

      // Update the transaction
      const updatedMemo = `Updated memo ${Date.now()}`;
      const updateResult = await executeToolCall(server, 'ynab:update_transaction', {
        budget_id: testBudgetId,
        transaction_id: testTransactionId,
        memo: updatedMemo,
      });

      // Validate update_transaction output schema
      const updateValidation = validateOutputSchema(server, 'update_transaction', updateResult);
      expect(updateValidation.valid).toBe(true);
      if (!updateValidation.valid) {
        console.error('update_transaction schema validation errors:', updateValidation.errors);
      }

      const updatedTransaction = parseToolResult(updateResult);

      expect(updatedTransaction.data).toBeDefined();
      expect(updatedTransaction.data.transaction).toBeDefined();
      expect(updatedTransaction.data.transaction.memo).toBe(updatedMemo);

      // List transactions and verify our transaction is included
      const listResult = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: testBudgetId,
        account_id: testAccountId,
      });

      // Validate list_transactions output schema
      const listValidation = validateOutputSchema(server, 'list_transactions', listResult);
      expect(listValidation.valid).toBe(true);
      if (!listValidation.valid) {
        console.error('list_transactions schema validation errors:', listValidation.errors);
      }

      const transactions = parseToolResult(listResult);

      expect(transactions.data).toBeDefined();
      expect(transactions.data.transactions).toBeDefined();
      expect(Array.isArray(transactions.data.transactions)).toBe(true);

      const foundTransaction = transactions.data.transactions.find(
        (txn: any) => txn.id === testTransactionId,
      );
      expect(foundTransaction).toBeDefined();
      expect(foundTransaction.memo).toBe(updatedMemo);

      // Delete the transaction
      const deleteResult = await executeToolCall(server, 'ynab:delete_transaction', {
        budget_id: testBudgetId,
        transaction_id: testTransactionId,
      });

      // Validate delete_transaction output schema
      const deleteValidation = validateOutputSchema(server, 'delete_transaction', deleteResult);
      expect(deleteValidation.valid).toBe(true);
      if (!deleteValidation.valid) {
        console.error('delete_transaction schema validation errors:', deleteValidation.errors);
      }

      const deleteResponse = parseToolResult(deleteResult);

      expect(deleteResponse.data).toBeDefined();

      // Verify transaction is deleted (should return error when trying to retrieve)
      const getDeletedResult = await executeToolCall(server, 'ynab:get_transaction', {
        budget_id: testBudgetId,
        transaction_id: testTransactionId,
      });
      expect(isErrorResult(getDeletedResult)).toBe(true);
      // Expected - transaction should not be found
      expect(getDeletedResult.content).toBeDefined();
      expect(getDeletedResult.content.length).toBeGreaterThan(0);
    });

    it('should filter transactions by date and account', async () => {
      if (testConfig.skipE2ETests) return;

      const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // List transactions since last month
      const recentResult = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: testBudgetId,
        since_date: lastMonth,
      });
      const recentTransactions = parseToolResult(recentResult);

      expect(recentTransactions.data).toBeDefined();
      expect(recentTransactions.data.transactions).toBeDefined();
      expect(Array.isArray(recentTransactions.data.transactions)).toBe(true);

      // List transactions for specific account
      const accountResult = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: testBudgetId,
        account_id: testAccountId,
      });
      const accountTransactions = parseToolResult(accountResult);

      expect(accountTransactions.data).toBeDefined();
      expect(accountTransactions.data.transactions).toBeDefined();
      expect(Array.isArray(accountTransactions.data.transactions)).toBe(true);

      // All transactions should be for the specified account
      accountTransactions.data.transactions.forEach((txn: any) => {
        expect(txn.account_id).toBe(testAccountId);
      });
    });

    it('should export and compare transactions', async () => {
      if (testConfig.skipE2ETests) return;

      // Export transactions as part of transaction management workflow
      const exportResult = await executeToolCall(server, 'ynab:export_transactions', {
        budget_id: testBudgetId,
        account_id: testAccountId,
      });

      // Validate export_transactions output schema
      const exportValidation = validateOutputSchema(server, 'export_transactions', exportResult);
      expect(exportValidation.valid).toBe(true);
      if (!exportValidation.valid) {
        console.error('export_transactions schema validation errors:', exportValidation.errors);
      }

      const exportData = parseToolResult(exportResult);
      expect(exportData.data).toBeDefined();

      // Compare transactions as part of transaction management workflow
      const csvData = `Date,Payee,Amount\n2025-01-15,Test Comparison Payee,-25.00`;
      const compareResult = await executeToolCall(server, 'ynab:compare_transactions', {
        budget_id: testBudgetId,
        account_id: testAccountId,
        csv_data: csvData,
        start_date: '2025-01-01',
        end_date: '2025-01-31',
      });

      // Validate compare_transactions output schema
      const compareValidation = validateOutputSchema(server, 'compare_transactions', compareResult);
      expect(compareValidation.valid).toBe(true);
      if (!compareValidation.valid) {
        console.error('compare_transactions schema validation errors:', compareValidation.errors);
      }

      const compareData = parseToolResult(compareResult);
      expect(compareData.data).toBeDefined();
    });

    it('should create and update transactions in bulk', async () => {
      if (testConfig.skipE2ETests) return;

      // Create multiple transactions as part of bulk workflow
      const transactions = [
        {
          account_id: testAccountId,
          date: new Date().toISOString().split('T')[0],
          amount: -1500,
          payee_name: `Bulk Workflow Payee 1 ${Date.now()}`,
          memo: 'Bulk workflow test 1',
          cleared: 'uncleared' as const,
        },
        {
          account_id: testAccountId,
          date: new Date().toISOString().split('T')[0],
          amount: -2500,
          payee_name: `Bulk Workflow Payee 2 ${Date.now()}`,
          memo: 'Bulk workflow test 2',
          cleared: 'uncleared' as const,
        },
      ];

      const createBulkResult = await executeToolCall(server, 'ynab:create_transactions', {
        budget_id: testBudgetId,
        transactions,
      });

      // Validate create_transactions (bulk) output schema
      const createBulkValidation = validateOutputSchema(
        server,
        'create_transactions',
        createBulkResult,
      );
      expect(createBulkValidation.valid).toBe(true);
      if (!createBulkValidation.valid) {
        console.error('create_transactions schema validation errors:', createBulkValidation.errors);
      }

      const createdBulk = parseToolResult(createBulkResult);
      expect(createdBulk.data?.transactions).toBeDefined();
      expect(Array.isArray(createdBulk.data.transactions)).toBe(true);
      expect(createdBulk.data.transactions.length).toBe(2);

      // Track for cleanup
      const transactionIds = createdBulk.data.transactions.map((txn: any) => txn.id);
      transactionIds.forEach((id: string) => cleanup.trackTransaction(id));

      // Update transactions in bulk as part of workflow
      const updateBulkResult = await executeToolCall(server, 'ynab:update_transactions', {
        budget_id: testBudgetId,
        transactions: transactionIds.map((id: string, index: number) => ({
          id,
          memo: `Updated bulk memo ${index + 1}`,
        })),
      });

      // Validate update_transactions (bulk) output schema
      const updateBulkValidation = validateOutputSchema(
        server,
        'update_transactions',
        updateBulkResult,
      );
      expect(updateBulkValidation.valid).toBe(true);
      if (!updateBulkValidation.valid) {
        console.error('update_transactions schema validation errors:', updateBulkValidation.errors);
      }

      const updatedBulk = parseToolResult(updateBulkResult);
      expect(updatedBulk.data?.transactions).toBeDefined();
      expect(Array.isArray(updatedBulk.data.transactions)).toBe(true);
    });

    it('should create receipt split transaction', async () => {
      if (testConfig.skipE2ETests) return;

      // Get categories for the receipt split
      const categoriesResult = await executeToolCall(server, 'ynab:list_categories', {
        budget_id: testBudgetId,
      });
      const categories = parseToolResult(categoriesResult);

      // Find a non-hidden category
      let testCategoryName: string | undefined;
      for (const group of categories.data.category_groups) {
        const availableCategory = group.categories?.find((cat: any) => !cat.hidden);
        if (availableCategory) {
          testCategoryName = availableCategory.name;
          break;
        }
      }

      if (!testCategoryName) {
        console.warn('No available categories found for receipt split test');
        return;
      }

      // Create receipt split transaction as part of transaction workflow
      const receiptResult = await executeToolCall(server, 'ynab:create_receipt_split_transaction', {
        budget_id: testBudgetId,
        account_id: testAccountId,
        date: new Date().toISOString().split('T')[0],
        payee_name: `Receipt Workflow ${Date.now()}`,
        tax_amount: 150,
        receipt_items: [
          {
            category_name: testCategoryName,
            amount: 2000,
          },
        ],
      });

      // Validate create_receipt_split_transaction output schema
      const receiptValidation = validateOutputSchema(
        server,
        'create_receipt_split_transaction',
        receiptResult,
      );
      expect(receiptValidation.valid).toBe(true);
      if (!receiptValidation.valid) {
        console.error(
          'create_receipt_split_transaction schema validation errors:',
          receiptValidation.errors,
        );
      }

      const receiptData = parseToolResult(receiptResult);
      expect(receiptData.data?.transaction).toBeDefined();

      // Track for cleanup
      if (receiptData.data.transaction.id) {
        cleanup.trackTransaction(receiptData.data.transaction.id);
      }
    });
  });

  describe('Complete Category Management Workflow', () => {
    it('should list categories and update category budget', async () => {
      if (testConfig.skipE2ETests) return;

      // List all categories
      const categoriesResult = await executeToolCall(server, 'ynab:list_categories', {
        budget_id: testBudgetId,
      });

      // Validate list_categories output schema
      const listValidation = validateOutputSchema(server, 'list_categories', categoriesResult);
      expect(listValidation.valid).toBe(true);
      if (!listValidation.valid) {
        console.error('list_categories schema validation errors:', listValidation.errors);
      }

      const categories = parseToolResult(categoriesResult);

      expect(categories.data).toBeDefined();
      expect(categories.data.category_groups).toBeDefined();
      expect(Array.isArray(categories.data.category_groups)).toBe(true);

      // Find a category to test with
      let testCategoryId: string | undefined;
      let testCategory: any;

      for (const group of categories.data.category_groups) {
        if (group.categories && group.categories.length > 0) {
          testCategory = group.categories.find((cat: any) => !cat.hidden);
          if (testCategory) {
            testCategoryId = testCategory.id;
            break;
          }
        }
      }

      if (!testCategoryId) {
        console.warn('No available categories found for testing');
        return;
      }

      // Get specific category details
      const categoryResult = await executeToolCall(server, 'ynab:get_category', {
        budget_id: testBudgetId,
        category_id: testCategoryId,
      });

      // Validate get_category output schema
      const getValidation = validateOutputSchema(server, 'get_category', categoryResult);
      expect(getValidation.valid).toBe(true);
      if (!getValidation.valid) {
        console.error('get_category schema validation errors:', getValidation.errors);
      }

      const category = parseToolResult(categoryResult);

      expect(category.data).toBeDefined();
      expect(category.data.category).toBeDefined();
      YNABAssertions.assertCategory(category.data.category);
      expect(category.data.category.id).toBe(testCategoryId);

      // Update category budget
      const newBudgetAmount = TestData.generateAmount(50); // $50.00
      const updateResult = await executeToolCall(server, 'ynab:update_category', {
        budget_id: testBudgetId,
        category_id: testCategoryId,
        budgeted: newBudgetAmount,
      });

      // Validate update_category output schema
      const updateValidation = validateOutputSchema(server, 'update_category', updateResult);
      expect(updateValidation.valid).toBe(true);
      if (!updateValidation.valid) {
        console.error('update_category schema validation errors:', updateValidation.errors);
      }

      const updatedCategory = parseToolResult(updateResult);

      expect(updatedCategory.data).toBeDefined();
      expect(updatedCategory.data.category).toBeDefined();
      expect(updatedCategory.data.category.budgeted).toBe(newBudgetAmount);
    });
  });

  describe('Complete Payee Management Workflow', () => {
    it('should list and retrieve payee information', async () => {
      if (testConfig.skipE2ETests) return;

      // List all payees
      const payeesResult = await executeToolCall(server, 'ynab:list_payees', {
        budget_id: testBudgetId,
      });

      // Validate list_payees output schema
      const listValidation = validateOutputSchema(server, 'list_payees', payeesResult);
      expect(listValidation.valid).toBe(true);
      if (!listValidation.valid) {
        console.error('list_payees schema validation errors:', listValidation.errors);
      }

      const payees = parseToolResult(payeesResult);

      expect(payees.data).toBeDefined();
      expect(payees.data.payees).toBeDefined();
      expect(Array.isArray(payees.data.payees)).toBe(true);

      if (payees.data.payees.length > 0) {
        // Validate payee structures
        payees.data.payees.forEach(YNABAssertions.assertPayee);

        // Get specific payee details
        const testPayeeId = payees.data.payees[0].id;
        const payeeResult = await executeToolCall(server, 'ynab:get_payee', {
          budget_id: testBudgetId,
          payee_id: testPayeeId,
        });

        // Validate get_payee output schema
        const getValidation = validateOutputSchema(server, 'get_payee', payeeResult);
        expect(getValidation.valid).toBe(true);
        if (!getValidation.valid) {
          console.error('get_payee schema validation errors:', getValidation.errors);
        }

        const payee = parseToolResult(payeeResult);

        expect(payee.data).toBeDefined();
        expect(payee.data.payee).toBeDefined();
        YNABAssertions.assertPayee(payee.data.payee);
        expect(payee.data.payee.id).toBe(testPayeeId);
      }
    });
  });

  describe('Complete Monthly Data Workflow', () => {
    it('should retrieve monthly budget data', async () => {
      if (testConfig.skipE2ETests) return;

      // List all months
      const monthsResult = await executeToolCall(server, 'ynab:list_months', {
        budget_id: testBudgetId,
      });

      // Validate list_months output schema
      const listValidation = validateOutputSchema(server, 'list_months', monthsResult);
      expect(listValidation.valid).toBe(true);
      if (!listValidation.valid) {
        console.error('list_months schema validation errors:', listValidation.errors);
      }

      const months = parseToolResult(monthsResult);

      expect(months.data).toBeDefined();
      expect(months.data.months).toBeDefined();
      expect(Array.isArray(months.data.months)).toBe(true);
      expect(months.data.months.length).toBeGreaterThan(0);

      // Get current month data
      const currentMonth = getCurrentMonth();
      const monthResult = await executeToolCall(server, 'ynab:get_month', {
        budget_id: testBudgetId,
        month: currentMonth,
      });

      // Validate get_month output schema
      const getValidation = validateOutputSchema(server, 'get_month', monthResult);
      expect(getValidation.valid).toBe(true);
      if (!getValidation.valid) {
        console.error('get_month schema validation errors:', getValidation.errors);
      }

      const month = parseToolResult(monthResult);

      expect(month.data).toBeDefined();
      expect(month.data.month).toBeDefined();
      expect(typeof month.data.month.month).toBe('string');
      expect(typeof month.data.month.income).toBe('number');
      expect(typeof month.data.month.budgeted).toBe('number');
      expect(typeof month.data.month.activity).toBe('number');
      expect(typeof month.data.month.to_be_budgeted).toBe('number');
    });
  });

  describe('Utility Tools Workflow', () => {
    it('should convert amounts between dollars and milliunits', async () => {
      if (testConfig.skipE2ETests) return;

      // Convert dollars to milliunits
      const toMilliunitsResult = await executeToolCall(server, 'ynab:convert_amount', {
        amount: 25.5,
        to_milliunits: true,
      });
      const milliunits = parseToolResult(toMilliunitsResult);

      expect(milliunits.data?.conversion?.converted_amount).toBe(25500);
      expect(milliunits.data?.conversion?.description).toContain('25500');
      expect(milliunits.data?.conversion?.to_milliunits).toBe(true);

      // Convert milliunits to dollars
      const toDollarsResult = await executeToolCall(server, 'ynab:convert_amount', {
        amount: 25500,
        to_milliunits: false,
      });
      const dollars = parseToolResult(toDollarsResult);

      expect(dollars.data?.conversion?.converted_amount).toBe(25.5);
      expect(dollars.data?.conversion?.description).toContain('$25.50');
      expect(dollars.data?.conversion?.to_milliunits).toBe(false);
    });
  });

  describe('v0.8.x Architecture Integration Tests', () => {
    describe('Cache System Verification', () => {
      it('should demonstrate cache warming after default budget set', async () => {
        if (testConfig.skipE2ETests) return;

        // Enable caching for this test
        testEnv.enableCache();

        try {
          // Get initial cache stats
          const initialStatsResult = await executeToolCall(server, 'ynab:diagnostic_info');
          const initialStats = parseToolResult(initialStatsResult);
          const initialCacheStats = initialStats.data?.cache;

          // Set default budget (should trigger cache warming)
          await executeToolCall(server, 'ynab:set_default_budget', {
            budget_id: testBudgetId,
          });

          // Allow time for cache warming (fire-and-forget)
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Get updated cache stats
          const finalStatsResult = await executeToolCall(server, 'ynab:diagnostic_info');
          const finalStats = parseToolResult(finalStatsResult);
          const finalCacheStats = finalStats.data?.cache;

          // Verify cache warming occurred
          expect(finalCacheStats?.entries).toBeGreaterThan(initialCacheStats?.entries || 0);
          expect(finalCacheStats?.hits).toBeGreaterThanOrEqual(0);
        } finally {
          // Restore original NODE_ENV
          testEnv.restoreEnv();
        }
      });

      it('should demonstrate LRU eviction and observability metrics', async () => {
        if (testConfig.skipE2ETests) return;

        // Enable caching for this test (bypass NODE_ENV='test' check)
        testEnv.enableCache();

        try {
          // Get initial cache stats
          const initialStatsResult = await executeToolCall(server, 'ynab:diagnostic_info');
          const initialStats = parseToolResult(initialStatsResult);
          const initialCacheStats = initialStats.data?.cache;

          // Perform operations that should hit cache
          await executeToolCall(server, 'ynab:list_accounts', { budget_id: testBudgetId });
          await executeToolCall(server, 'ynab:list_categories', { budget_id: testBudgetId });
          await executeToolCall(server, 'ynab:list_payees', { budget_id: testBudgetId });

          // Perform same operations again (should hit cache)
          await executeToolCall(server, 'ynab:list_accounts', { budget_id: testBudgetId });
          await executeToolCall(server, 'ynab:list_categories', { budget_id: testBudgetId });
          await executeToolCall(server, 'ynab:list_payees', { budget_id: testBudgetId });

          // Get final cache stats
          const finalStatsResult = await executeToolCall(server, 'ynab:diagnostic_info');
          const finalStats = parseToolResult(finalStatsResult);
          const finalCacheStats = finalStats.data?.cache;

          // Verify cache behavior
          expect(finalCacheStats?.hits).toBeGreaterThan(initialCacheStats?.hits || 0);
          expect(finalCacheStats?.misses).toBeGreaterThan(initialCacheStats?.misses || 0);
          expect(finalCacheStats?.hits).toBeGreaterThan(0);
          expect(finalCacheStats?.entries).toBeGreaterThan(0);
        } finally {
          // Restore original NODE_ENV
          testEnv.restoreEnv();
        }
      });

      it('should demonstrate cache invalidation on write operations', async () => {
        if (testConfig.skipE2ETests) return;

        // Enable caching for this test
        testEnv.enableCache();

        try {
          // Prime cache by listing accounts
          await executeToolCall(server, 'ynab:list_accounts', { budget_id: testBudgetId });

          // Create new account (should invalidate accounts cache)
          const accountName = TestData.generateAccountName();
          const createResult = await executeToolCall(server, 'ynab:create_account', {
            budget_id: testBudgetId,
            name: accountName,
            type: 'checking',
            balance: 10000,
          });

          // Validate output schema
          const createValidation = validateOutputSchema(server, 'create_account', createResult);
          expect(createValidation.valid).toBe(true);
          if (!createValidation.valid) {
            console.error('create_account schema validation errors:', createValidation.errors);
          }

          const createdAccount = parseToolResult(createResult);
          cleanup.trackAccount(createdAccount.data.account.id);

          // List accounts again (should show new account due to cache invalidation)
          const accountsResult = await executeToolCall(server, 'ynab:list_accounts', {
            budget_id: testBudgetId,
          });
          const accounts = parseToolResult(accountsResult);

          const foundAccount = accounts.data.accounts.find(
            (acc: any) => acc.id === createdAccount.data.account.id,
          );
          expect(foundAccount).toBeDefined();
          expect(foundAccount.name).toBe(accountName);
        } finally {
          // Restore original NODE_ENV
          testEnv.restoreEnv();
        }
      });
    });

    describe('Budget Resolution Consistency', () => {
      it('should provide consistent error messages for missing budget ID', async () => {
        if (testConfig.skipE2ETests) return;

        // Clear default budget first
        server.clearDefaultBudget();

        // Test multiple tools for consistent error handling
        const toolsToTest = [
          'ynab:list_accounts',
          'ynab:list_categories',
          'ynab:list_payees',
          'ynab:list_transactions',
        ];

        for (const toolName of toolsToTest) {
          const result = await executeToolCall(server, toolName, {});
          expect(isErrorResult(result)).toBe(true);
          const errorMessage = getErrorMessage(result);
          expect(errorMessage).toContain('No budget ID provided and no default budget set');
          expect(errorMessage).toContain('set_default_budget');
        }

        // Restore default budget for other tests
        await executeToolCall(server, 'ynab:set_default_budget', { budget_id: testBudgetId });
      });

      it('should handle invalid budget ID format consistently', async () => {
        if (testConfig.skipE2ETests) return;

        const invalidBudgetId = 'invalid-format';
        const toolsToTest = ['ynab:list_accounts', 'ynab:list_categories', 'ynab:list_payees'];

        for (const toolName of toolsToTest) {
          const result = await executeToolCall(server, toolName, { budget_id: invalidBudgetId });
          expect(isErrorResult(result)).toBe(true);
          // All tools should provide similar error handling
          expect(result.content).toBeDefined();
          expect(result.content.length).toBeGreaterThan(0);
        }
      });
    });

    describe('Month Data Integration', () => {
      it('should execute month data tools', async () => {
        if (testConfig.skipE2ETests) return;

        // Test get_month tool
        const currentMonth = new Date().toISOString().substring(0, 8) + '01';
        const monthResult = await executeToolCall(server, 'ynab:get_month', {
          budget_id: testBudgetId,
          month: currentMonth,
        });
        const monthData = parseToolResult(monthResult);

        expect(monthData.data, 'Month data should return data object').toBeDefined();
        expect(monthData.data.month || monthData.data, 'Should contain month info').toBeDefined();

        // Test list_months tool
        const monthsResult = await executeToolCall(server, 'ynab:list_months', {
          budget_id: testBudgetId,
        });
        const monthsData = parseToolResult(monthsResult);

        expect(monthsData.data).toBeDefined();
        expect(Array.isArray(monthsData.data.months), 'Should return months array').toBe(true);
      });
    });

    describe('Tool Registry Integration', () => {
      it('should demonstrate tool registry functionality', async () => {
        if (testConfig.skipE2ETests) return;

        // Test that tool listing includes all expected tools
        const toolsResult = await server.handleListTools();
        expect(toolsResult.tools).toBeDefined();
        expect(Array.isArray(toolsResult.tools)).toBe(true);
        expect(toolsResult.tools.length).toBeGreaterThan(20);

        // Verify key v0.8.x tools are present (tools are registered without ynab: prefix)
        const toolNames = toolsResult.tools.map((tool: any) => tool.name);
        expect(toolNames, 'Should contain list_budgets tool').toContain('list_budgets');
        expect(toolNames, 'Should contain get_month tool').toContain('get_month');
        expect(toolNames, 'Should contain list_months tool').toContain('list_months');
        expect(toolNames, 'Should contain compare_transactions tool').toContain(
          'compare_transactions',
        );
        expect(toolNames, 'Should contain diagnostic_info tool').toContain('diagnostic_info');

        // Test that each tool has proper schema validation
        for (const tool of toolsResult.tools) {
          expect(tool.name).toBeDefined();
          expect(tool.description).toBeDefined();
          expect(tool.inputSchema).toBeDefined();

          // Verify that all tools define outputSchema (as guaranteed by CHANGELOG.md and docs/reference/TOOLS.md)
          // Note: Some utility tools like diagnostic_info or clear_cache may not define structured outputs,
          // but most data-retrieval and CRUD tools should have output schemas.
          expect(tool.outputSchema, `Tool '${tool.name}' should define an outputSchema`).toBeDefined();
        }
      });
    });

    describe('Module Integration Tests', () => {
      it('should verify resource manager integration', async () => {
        if (testConfig.skipE2ETests) return;

        // Test resource listing
        const resourcesResult = await server.handleListResources();
        expect(resourcesResult.resources).toBeDefined();
        expect(Array.isArray(resourcesResult.resources)).toBe(true);

        // Test reading a specific resource
        if (resourcesResult.resources.length > 0) {
          const resource = resourcesResult.resources[0];
          const readResult = await server.handleReadResource({
            uri: resource.uri,
          });
          expect(readResult.contents).toBeDefined();
        }
      });

      it('should verify prompt manager integration', async () => {
        if (testConfig.skipE2ETests) return;

        // Test prompt listing
        const promptsResult = await server.handleListPrompts();
        expect(promptsResult.prompts).toBeDefined();
        expect(Array.isArray(promptsResult.prompts)).toBe(true);

        // Test getting a specific prompt
        if (promptsResult.prompts.length > 0) {
          const prompt = promptsResult.prompts[0];
          const getResult = await server.handleGetPrompt({
            name: prompt.name,
            arguments: {},
          });
          expect(getResult.messages).toBeDefined();
        }
      });

      it('should verify diagnostic manager integration', async () => {
        if (testConfig.skipE2ETests) return;

        // Test diagnostic info tool
        const diagnosticResult = await executeToolCall(server, 'ynab:diagnostic_info');
        const diagnostic = parseToolResult(diagnosticResult);

        expect(diagnostic.data, 'Diagnostic should return data object').toBeDefined();

        // The diagnostic data is in the root of data, not under diagnostics
        expect(diagnostic.data.timestamp, 'Should contain timestamp').toBeDefined();
        expect(diagnostic.data.server, 'Should contain server info').toBeDefined();
        expect(diagnostic.data.memory, 'Should contain memory info').toBeDefined();
        expect(diagnostic.data.environment, 'Should contain environment info').toBeDefined();
        expect(diagnostic.data.cache, 'Should contain cache info').toBeDefined();
      });
    });

    describe('Backward Compatibility Verification', () => {
      it('should maintain v0.7.x API compatibility', async () => {
        if (testConfig.skipE2ETests) return;

        // Test that all existing tool calls work identically
        const v7Tools = [
          { name: 'ynab:list_budgets', args: {} },
          { name: 'ynab:list_accounts', args: { budget_id: testBudgetId } },
          { name: 'ynab:list_categories', args: { budget_id: testBudgetId } },
          { name: 'ynab:list_payees', args: { budget_id: testBudgetId } },
          { name: 'ynab:get_user', args: {} },
          { name: 'ynab:convert_amount', args: { amount: 100, to_milliunits: true } },
        ];

        for (const tool of v7Tools) {
          const result = await executeToolCall(server, tool.name, tool.args);
          const parsed = parseToolResult(result);

          // Verify response structure is consistent with v0.7.x
          expect(parsed.data).toBeDefined();
          expect(parsed.success).toBe(true);
        }
      });

      it('should maintain response format consistency', async () => {
        if (testConfig.skipE2ETests) return;

        // Test that response formats match expected v0.7.x structure
        const budgetsResult = await executeToolCall(server, 'ynab:list_budgets');
        const budgets = parseToolResult(budgetsResult);

        // Verify standard response wrapper
        expect(budgets).toHaveProperty('success');
        expect(budgets).toHaveProperty('data');
        expect(budgets.success).toBe(true);
        expect(budgets.data).toHaveProperty('budgets');
      });
    });

    describe('Performance Regression Tests', () => {
      it('should not introduce performance regressions', async () => {
        if (testConfig.skipE2ETests) return;

        // Test response times for common operations
        const operations = [
          { name: 'ynab:list_budgets', args: {} },
          { name: 'ynab:list_accounts', args: { budget_id: testBudgetId } },
          { name: 'ynab:list_categories', args: { budget_id: testBudgetId } },
        ];

        for (const operation of operations) {
          const startTime = Date.now();
          await executeToolCall(server, operation.name, operation.args);
          const endTime = Date.now();
          const duration = endTime - startTime;

          // Response should be reasonably fast (under 5 seconds for E2E)
          expect(duration).toBeLessThan(5000);
        }
      });

      it('should demonstrate cache performance improvements', async () => {
        if (testConfig.skipE2ETests) return;

        // Enable caching for this test
        testEnv.enableCache();

        try {
          // First call (cache miss)
          const startTime1 = Date.now();
          await executeToolCall(server, 'ynab:list_accounts', { budget_id: testBudgetId });
          const duration1 = Date.now() - startTime1;

          // Second call (cache hit)
          const startTime2 = Date.now();
          await executeToolCall(server, 'ynab:list_accounts', { budget_id: testBudgetId });
          const duration2 = Date.now() - startTime2;

          // Cached call should be faster (allowing for some variance in E2E environment)
          expect(duration2).toBeLessThanOrEqual(duration1 + 500); // Allow 500ms tolerance for E2E environment
        } finally {
          // Restore original NODE_ENV
          testEnv.restoreEnv();
        }
      });
    });

    describe('Enhanced Error Handling', () => {
      it('should provide improved error messages with actionable suggestions', async () => {
        if (testConfig.skipE2ETests) return;

        // Clear default budget
        server.clearDefaultBudget();

        const result = await executeToolCall(server, 'ynab:list_accounts', {});
        expect(isErrorResult(result)).toBe(true);
        const errorMessage = getErrorMessage(result);

        // Error should provide actionable guidance
        expect(errorMessage).toContain('No budget ID provided and no default budget set');
        expect(errorMessage).toContain('set_default_budget');
        expect(errorMessage).toContain('budget_id parameter');

        // Restore default budget
        await executeToolCall(server, 'ynab:set_default_budget', { budget_id: testBudgetId });
      });
    });
  });

  describe('Error Handling Workflow', () => {
    it('should handle invalid budget ID gracefully', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:get_budget', {
        budget_id: 'invalid-budget-id',
      });
      expect(isErrorResult(result)).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      // Verify error response contract: error responses should not have success: true
      const textContent = result.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        const parsed = JSON.parse(textContent.text);
        expect(parsed).toHaveProperty('error');
        // If success property exists, it should be false for errors
        if ('success' in parsed) {
          expect(parsed.success).toBe(false);
        }
      }
    });

    it('should handle invalid account ID gracefully', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:get_account', {
        budget_id: testBudgetId,
        account_id: 'invalid-account-id',
      });
      expect(isErrorResult(result)).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      // Verify error response contract
      const textContent = result.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        const parsed = JSON.parse(textContent.text);
        expect(parsed).toHaveProperty('error');
        if ('success' in parsed) {
          expect(parsed.success).toBe(false);
        }
      }
    });

    it('should handle invalid transaction ID gracefully', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:get_transaction', {
        budget_id: testBudgetId,
        transaction_id: 'invalid-transaction-id',
      });
      expect(isErrorResult(result)).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);

      // Verify error response contract
      const textContent = result.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        const parsed = JSON.parse(textContent.text);
        expect(parsed).toHaveProperty('error');
        if ('success' in parsed) {
          expect(parsed.success).toBe(false);
        }
      }
    });
  });

  describe('Output Schema Validation', () => {
    it('should validate list_budgets output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:list_budgets');
      const validation = validateOutputSchema(server, 'list_budgets', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate list_accounts output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:list_accounts', {
        budget_id: testBudgetId,
      });
      const validation = validateOutputSchema(server, 'list_accounts', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate list_transactions output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: testBudgetId,
        since_date: '2025-01-01',
      });
      const validation = validateOutputSchema(server, 'list_transactions', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate list_categories output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:list_categories', {
        budget_id: testBudgetId,
      });
      const validation = validateOutputSchema(server, 'list_categories', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate list_payees output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:list_payees', {
        budget_id: testBudgetId,
      });
      const validation = validateOutputSchema(server, 'list_payees', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate list_months output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:list_months', {
        budget_id: testBudgetId,
      });
      const validation = validateOutputSchema(server, 'list_months', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate get_month output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const currentMonth = getCurrentMonth();
      const result = await executeToolCall(server, 'ynab:get_month', {
        budget_id: testBudgetId,
        month: currentMonth,
      });
      const validation = validateOutputSchema(server, 'get_month', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate get_user output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:get_user');
      const validation = validateOutputSchema(server, 'get_user', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate diagnostic_info output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:diagnostic_info');
      const validation = validateOutputSchema(server, 'diagnostic_info', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate set_default_budget output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:set_default_budget', {
        budget_id: testBudgetId,
      });
      const validation = validateOutputSchema(server, 'set_default_budget', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate get_default_budget output schema', async () => {
      if (testConfig.skipE2ETests) return;

      // Ensure default budget is set
      await executeToolCall(server, 'ynab:set_default_budget', {
        budget_id: testBudgetId,
      });

      const result = await executeToolCall(server, 'ynab:get_default_budget');
      const validation = validateOutputSchema(server, 'get_default_budget', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate clear_cache output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:clear_cache');
      const validation = validateOutputSchema(server, 'clear_cache', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate set_output_format output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:set_output_format', {
        minify: false,
      });
      const validation = validateOutputSchema(server, 'set_output_format', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }

      // Reset to default
      await executeToolCall(server, 'ynab:set_output_format', {
        minify: true,
      });
    });

    it('should validate reconcile_account output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:reconcile_account', {
        budget_id: testBudgetId,
        account_id: testAccountId,
        cleared_balance: 0,
      });
      const validation = validateOutputSchema(server, 'reconcile_account', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate create_transactions (bulk) output schema', async () => {
      if (testConfig.skipE2ETests) return;

      // Create multiple transactions
      const transactions = [
        {
          account_id: testAccountId,
          date: new Date().toISOString().split('T')[0],
          amount: -1000,
          payee_name: `Test Payee 1 ${Date.now()}`,
          memo: 'Bulk test 1',
          cleared: 'uncleared' as const,
        },
        {
          account_id: testAccountId,
          date: new Date().toISOString().split('T')[0],
          amount: -2000,
          payee_name: `Test Payee 2 ${Date.now()}`,
          memo: 'Bulk test 2',
          cleared: 'uncleared' as const,
        },
      ];

      const result = await executeToolCall(server, 'ynab:create_transactions', {
        budget_id: testBudgetId,
        transactions,
      });
      const validation = validateOutputSchema(server, 'create_transactions', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }

      // Track transactions for cleanup
      const parsed = parseToolResult(result);
      if (parsed.data?.transactions) {
        parsed.data.transactions.forEach((txn: any) => {
          cleanup.trackTransaction(txn.id);
        });
      }
    });

    it('should validate update_transactions (bulk) output schema', async () => {
      if (testConfig.skipE2ETests) return;

      // First create a transaction to update
      const createResult = await executeToolCall(server, 'ynab:create_transaction', {
        budget_id: testBudgetId,
        account_id: testAccountId,
        date: new Date().toISOString().split('T')[0],
        amount: -3000,
        payee_name: `Test Update Payee ${Date.now()}`,
        memo: 'Before update',
        cleared: 'uncleared',
      });
      const created = parseToolResult(createResult);
      const transactionId = created.data.transaction.id;
      cleanup.trackTransaction(transactionId);

      // Update the transaction
      const result = await executeToolCall(server, 'ynab:update_transactions', {
        budget_id: testBudgetId,
        transactions: [
          {
            id: transactionId,
            memo: 'After update',
          },
        ],
      });
      const validation = validateOutputSchema(server, 'update_transactions', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate compare_transactions output schema', async () => {
      if (testConfig.skipE2ETests) return;

      // Create a minimal CSV for comparison
      const csvData = `Date,Payee,Amount\n2025-01-15,Test Payee,-10.00`;

      const result = await executeToolCall(server, 'ynab:compare_transactions', {
        budget_id: testBudgetId,
        account_id: testAccountId,
        csv_data: csvData,
        start_date: '2025-01-01',
        end_date: '2025-01-31',
      });
      const validation = validateOutputSchema(server, 'compare_transactions', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate convert_amount output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:convert_amount', {
        amount: 100,
        to_milliunits: true,
      });
      const validation = validateOutputSchema(server, 'convert_amount', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate export_transactions output schema', async () => {
      if (testConfig.skipE2ETests) return;

      const result = await executeToolCall(server, 'ynab:export_transactions', {
        budget_id: testBudgetId,
        account_id: testAccountId,
      });
      const validation = validateOutputSchema(server, 'export_transactions', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }
    });

    it('should validate create_receipt_split_transaction output schema', async () => {
      if (testConfig.skipE2ETests) return;

      // Get categories to find a valid one
      const categoriesResult = await executeToolCall(server, 'ynab:list_categories', {
        budget_id: testBudgetId,
      });
      const categories = parseToolResult(categoriesResult);

      // Find a non-hidden category
      let testCategoryName: string | undefined;
      for (const group of categories.data.category_groups) {
        const availableCategory = group.categories?.find((cat: any) => !cat.hidden);
        if (availableCategory) {
          testCategoryName = availableCategory.name;
          break;
        }
      }

      if (!testCategoryName) {
        console.warn('No available categories found for create_receipt_split_transaction test');
        return;
      }

      // Create a minimal receipt split transaction
      const result = await executeToolCall(server, 'ynab:create_receipt_split_transaction', {
        budget_id: testBudgetId,
        account_id: testAccountId,
        date: new Date().toISOString().split('T')[0],
        payee_name: `Test Receipt ${Date.now()}`,
        tax_amount: 100,
        receipt_items: [
          {
            category_name: testCategoryName,
            amount: 1000,
          },
        ],
      });

      const validation = validateOutputSchema(server, 'create_receipt_split_transaction', result);
      expect(validation.hasSchema).toBe(true);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Schema validation errors:', validation.errors);
      }

      // Track the created transaction for cleanup
      const parsed = parseToolResult(result);
      if (parsed.data?.transaction?.id) {
        cleanup.trackTransaction(parsed.data.transaction.id);
      }
    });
  });
});
