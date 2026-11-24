/**
 * Comprehensive integration tests for YNAB MCP Server
 * These tests use mocked YNAB API responses to test complete workflows
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import { CACHE_TTLS, type CacheManager } from "../server/cacheManager.js";
import { YNABMCPServer } from "../server/YNABMCPServer.js";
import {
	executeConfirmedToolCall,
	executeToolCall,
	parseToolResult,
	validateToolResult,
	waitFor,
} from "./testUtils.js";

// A fake YNAB client, passed to the server through its constructor.
const mockAPI = {
	plans: {
		getPlans: vi.fn(),
		getPlanById: vi.fn(),
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
		getPlanMonth: vi.fn(),
		getPlanMonths: vi.fn(),
	},
	user: {
		getUser: vi.fn(),
	},
};

const TEST_BUDGET_UUID = "00000000-0000-0000-0000-000000000001";

describe("YNAB SDK utils", () => {
	it("converts milliunits using SDK rounding rules", async () => {
		const { utils } = await import("ynab");

		expect(utils.convertMilliUnitsToCurrencyAmount(123456, 2)).toBe(123.46);
		expect(utils.convertMilliUnitsToCurrencyAmount(123456, 3)).toBe(123.456);
		// The SDK rounds halves toward +infinity (Math.round), so -98.765 becomes
		// -98.76, not -98.77. The old module mock claimed otherwise.
		expect(utils.convertMilliUnitsToCurrencyAmount(-98765, 2)).toBe(-98.76);
	});
});

describe("YNAB MCP Server - Comprehensive Integration Tests", () => {
	let server: YNABMCPServer;
	let cacheManager: CacheManager;
	let mockYnabAPI: any;

	beforeEach(async () => {
		// Set up environment
		process.env["YNAB_ACCESS_TOKEN"] = "test-token";

		// Create server instance
		server = new YNABMCPServer(true, {
			ynabAPI: mockAPI as unknown as ynab.API,
		});
		cacheManager = (server as unknown as { cacheManager: CacheManager })
			.cacheManager;

		// Get the mocked YNAB API instance
		mockYnabAPI = mockAPI;

		// Reset all mocks
		vi.clearAllMocks();
	});

	describe("Complete Budget Management Integration", () => {
		it("should handle complete budget listing and retrieval workflow", async () => {
			// Mock budget list response
			const mockBudgets = {
				data: {
					plans: [
						{
							id: "budget-1",
							name: "Test Budget 1",
							last_modified_on: "2024-01-01T00:00:00Z",
							first_month: "2024-01-01",
							last_month: "2024-12-01",
							date_format: { format: "MM/DD/YYYY" },
							currency_format: {
								iso_code: "USD",
								example_format: "$123.45",
								decimal_digits: 2,
								decimal_separator: ".",
								symbol_first: true,
								group_separator: ",",
								currency_symbol: "$",
								display_symbol: true,
							},
						},
						{
							id: "budget-2",
							name: "Test Budget 2",
							last_modified_on: "2024-01-02T00:00:00Z",
							first_month: "2024-01-01",
							last_month: "2024-12-01",
							date_format: { format: "MM/DD/YYYY" },
							currency_format: {
								iso_code: "USD",
								example_format: "$123.45",
								decimal_digits: 2,
								decimal_separator: ".",
								symbol_first: true,
								group_separator: ",",
								currency_symbol: "$",
								display_symbol: true,
							},
						},
					],
				},
			};

			mockYnabAPI.plans.getPlans.mockResolvedValue(mockBudgets);

			// Test budget listing
			const listResult = await executeToolCall(server, "ynab_list_budgets", {
				response_format: "json",
			});
			validateToolResult(listResult);

			const budgets = parseToolResult<{ budgets: { name: string }[] }>(
				listResult,
			);
			expect(budgets.budgets).toHaveLength(2);
			expect(budgets.budgets[0]!.name).toBe("Test Budget 1");
			expect(budgets.budgets[1]!.name).toBe("Test Budget 2");

			// Mock specific budget response
			const mockBudget = {
				data: {
					plan: {
						id: "budget-1",
						name: "Test Budget 1",
						last_modified_on: "2024-01-01T00:00:00Z",
						first_month: "2024-01-01",
						last_month: "2024-12-01",
						date_format: { format: "MM/DD/YYYY" },
						currency_format: {
							iso_code: "USD",
							example_format: "$123.45",
							decimal_digits: 2,
							decimal_separator: ".",
							symbol_first: true,
							group_separator: ",",
							currency_symbol: "$",
							display_symbol: true,
						},
						accounts: [],
						payees: [],
						category_groups: [],
						months: [],
					},
				},
			};

			mockYnabAPI.plans.getPlanById.mockResolvedValue(mockBudget);

			// Test specific budget retrieval
			const getResult = await executeToolCall(server, "ynab_get_budget", {
				budget_id: "budget-1",
				response_format: "json",
			});
			validateToolResult(getResult);

			const budget = parseToolResult<{ budget: { id: string; name: string } }>(
				getResult,
			);
			expect(budget.budget.id).toBe("budget-1");
			expect(budget.budget.name).toBe("Test Budget 1");

			// Verify API calls
			expect(mockYnabAPI.plans.getPlans).toHaveBeenCalledTimes(1);
			expect(mockYnabAPI.plans.getPlanById).toHaveBeenCalledWith("budget-1");
		});

		it("should handle budget retrieval errors gracefully", async () => {
			// Mock API error
			const apiError = new Error("Budget not found");
			(apiError as any).error = {
				id: "404.2",
				name: "not_found",
				description: "Budget not found",
			};
			mockYnabAPI.plans.getPlanById.mockRejectedValue(apiError);

			// Test error handling
			const result = await executeToolCall(server, "ynab_get_budget", {
				budget_id: "invalid-budget",
			});
			expect(result.isError).toBe(true);

			expect(mockYnabAPI.plans.getPlanById).toHaveBeenCalledWith(
				"invalid-budget",
			);
		});
	});

	describe("Complete Account Management Integration", () => {
		it("should handle complete account workflow", async () => {
			const budgetId = TEST_BUDGET_UUID;

			// Mock accounts list
			const mockAccounts = {
				data: {
					accounts: [
						{
							id: "account-1",
							name: "Checking Account",
							type: "checking",
							on_budget: true,
							closed: false,
							balance: 100000, // $100.00
							cleared_balance: 95000,
							uncleared_balance: 5000,
							transfer_payee_id: "payee-transfer-1",
						},
						{
							id: "account-2",
							name: "Savings Account",
							type: "savings",
							on_budget: true,
							closed: false,
							note: "Emergency fund",
							balance: 500000, // $500.00
							cleared_balance: 500000,
							uncleared_balance: 0,
							transfer_payee_id: "payee-transfer-2",
						},
					],
				},
			};

			mockYnabAPI.accounts.getAccounts.mockResolvedValue(mockAccounts);

			// Test account listing
			const listResult = await executeToolCall(server, "ynab_list_accounts", {
				budget_id: budgetId,
				response_format: "json",
			});
			validateToolResult(listResult);

			const accounts = parseToolResult<{ accounts: { name: string }[] }>(
				listResult,
			);
			expect(accounts.accounts).toHaveLength(2);
			expect(accounts.accounts[0]!.name).toBe("Checking Account");
			expect(accounts.accounts[1]!.name).toBe("Savings Account");

			// Mock specific account response
			const mockAccount = {
				data: {
					account: mockAccounts.data.accounts[0],
				},
			};

			mockYnabAPI.accounts.getAccountById.mockResolvedValue(mockAccount);

			// Test specific account retrieval
			const getResult = await executeToolCall(server, "ynab_get_account", {
				budget_id: budgetId,
				account_id: "account-1",
				response_format: "json",
			});
			validateToolResult(getResult);

			const account = parseToolResult<{
				account: { id: string; name: string; balance: number };
			}>(getResult);
			expect(account.account.id).toBe("account-1");
			expect(account.account.name).toBe("Checking Account");
			expect(account.account.balance).toBe(100);

			// Mock account creation
			const newAccount = {
				id: "account-3",
				name: "New Test Account",
				type: "checking",
				on_budget: true,
				closed: false,
				balance: 0,
				cleared_balance: 0,
				uncleared_balance: 0,
				transfer_payee_id: "payee-transfer-3",
			};

			const mockCreateResponse = {
				data: {
					account: newAccount,
				},
			};

			mockYnabAPI.accounts.createAccount.mockResolvedValue(mockCreateResponse);

			// Test account creation
			const createResult = await executeConfirmedToolCall(
				server,
				"ynab_create_account",
				{
					budget_id: budgetId,
					name: "New Test Account",
					type: "checking",
					balance: 0,
				},
			);
			validateToolResult(createResult);

			const createdAccount = parseToolResult<{
				account: { name: string; type: string };
			}>(createResult);
			expect(createdAccount.account.name).toBe("New Test Account");
			expect(createdAccount.account.type).toBe("checking");

			// Verify API calls
			expect(mockYnabAPI.accounts.getAccounts).toHaveBeenCalledWith(budgetId);
			expect(mockYnabAPI.accounts.getAccountById).toHaveBeenCalledWith(
				budgetId,
				"account-1",
			);
			expect(mockYnabAPI.accounts.createAccount).toHaveBeenCalledWith(
				budgetId,
				{
					account: {
						name: "New Test Account",
						type: "checking",
						balance: 0,
					},
				},
			);
		});
	});

	describe("Complete Transaction Management Integration", () => {
		it("should handle complete transaction workflow", async () => {
			const budgetId = TEST_BUDGET_UUID;
			const accountId = "test-account";
			mockYnabAPI.accounts.getAccounts.mockResolvedValue({
				data: { accounts: [{ id: accountId }] },
			});

			// Mock transactions list
			const mockTransactions = {
				data: {
					transactions: [
						{
							id: "transaction-1",
							date: "2024-01-15",
							amount: -5000, // $5.00 outflow
							memo: "Coffee shop",
							cleared: "cleared",
							approved: true,
							deleted: false,
							flag_color: null,
							account_id: accountId,
							payee_id: "payee-1",
							category_id: "category-1",
							transfer_account_id: null,
						},
						{
							id: "transaction-2",
							date: "2024-01-16",
							amount: 100000, // $100.00 inflow
							memo: "Salary",
							cleared: "cleared",
							approved: true,
							deleted: false,
							flag_color: null,
							account_id: accountId,
							payee_id: "payee-2",
							category_id: null,
							transfer_account_id: null,
						},
					],
				},
			};

			mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue(
				mockTransactions,
			);

			// Test transaction listing
			const listResult = await executeToolCall(
				server,
				"ynab_list_transactions",
				{
					budget_id: budgetId,
					account_id: accountId,
					response_format: "json",
				},
			);
			validateToolResult(listResult);

			const transactions = parseToolResult<{
				transactions: { memo: string }[];
			}>(listResult);
			expect(transactions.transactions).toHaveLength(2);
			expect(transactions.transactions[0]!.memo).toBe("Coffee shop");
			expect(transactions.transactions[1]!.memo).toBe("Salary");

			// Mock specific transaction response
			const mockTransaction = {
				data: {
					transaction: mockTransactions.data.transactions[0],
				},
			};

			mockYnabAPI.transactions.getTransactionById.mockResolvedValue(
				mockTransaction,
			);

			// Test specific transaction retrieval
			const getResult = await executeToolCall(server, "ynab_get_transaction", {
				budget_id: budgetId,
				transaction_id: "transaction-1",
				response_format: "json",
			});
			validateToolResult(getResult);

			const transaction = parseToolResult<{
				transaction: { id: string; memo: string; amount: number };
			}>(getResult);
			expect(transaction.transaction.id).toBe("transaction-1");
			expect(transaction.transaction.memo).toBe("Coffee shop");
			expect(transaction.transaction.amount).toBe(-5);

			// Mock transaction creation
			const newTransaction = {
				id: "transaction-3",
				date: "2024-01-17",
				amount: -2500,
				memo: "Test transaction",
				cleared: "uncleared",
				approved: true,
				deleted: false,
				flag_color: null,
				account_id: accountId,
				payee_id: null,
				category_id: "category-1",
				transfer_account_id: null,
			};

			const mockCreateResponse = {
				data: {
					transaction: newTransaction,
				},
			};

			mockYnabAPI.transactions.createTransaction.mockResolvedValue(
				mockCreateResponse,
			);

			// Test transaction creation
			const createResult = await executeConfirmedToolCall(
				server,
				"ynab_create_transaction",
				{
					budget_id: budgetId,
					account_id: accountId,
					category_id: "category-1",
					payee_name: "Test Payee",
					amount_milliunits: -2500,
					memo: "Test transaction",
					date: "2024-01-17",
					cleared: "uncleared",
				},
			);
			validateToolResult(createResult);

			const createdTransaction = parseToolResult<{
				transaction: { memo: string; amount: number };
			}>(createResult);
			expect(createdTransaction.transaction.memo).toBe("Test transaction");
			expect(createdTransaction.transaction.amount).toBe(-2.5);

			// Mock transaction update
			const updatedTransaction = { ...newTransaction, memo: "Updated memo" };
			const mockUpdateResponse = {
				data: {
					transaction: updatedTransaction,
				},
			};

			mockYnabAPI.transactions.updateTransaction.mockResolvedValue(
				mockUpdateResponse,
			);

			// Test transaction update
			const updateResult = await executeConfirmedToolCall(
				server,
				"ynab_update_transaction",
				{
					budget_id: budgetId,
					transaction_id: "transaction-3",
					memo: "Updated memo",
				},
			);
			validateToolResult(updateResult);

			const updated = parseToolResult<{ transaction: { memo: string } }>(
				updateResult,
			);
			expect(updated.transaction.memo).toBe("Updated memo");

			// Mock transaction deletion
			mockYnabAPI.transactions.deleteTransaction.mockResolvedValue({
				data: {
					transaction: { ...updatedTransaction, deleted: true },
				},
			});

			// Test transaction deletion
			const deleteResult = await executeConfirmedToolCall(
				server,
				"ynab_delete_transaction",
				{
					budget_id: budgetId,
					transaction_id: "transaction-3",
				},
			);
			validateToolResult(deleteResult);

			// Verify API calls
			expect(
				mockYnabAPI.transactions.getTransactionsByAccount,
			).toHaveBeenCalledWith(
				budgetId,
				accountId,
				undefined,
				undefined,
				undefined,
				undefined,
			);
			expect(mockYnabAPI.transactions.getTransactionById).toHaveBeenCalledWith(
				budgetId,
				"transaction-1",
			);
			expect(mockYnabAPI.transactions.createTransaction).toHaveBeenCalled();
			expect(mockYnabAPI.transactions.updateTransaction).toHaveBeenCalled();
			expect(mockYnabAPI.transactions.deleteTransaction).toHaveBeenCalledWith(
				budgetId,
				"transaction-3",
			);
		});

		it("should handle transaction filtering", async () => {
			const budgetId = TEST_BUDGET_UUID;

			// Mock filtered transactions
			mockYnabAPI.transactions.getTransactions.mockResolvedValue({
				data: {
					transactions: [
						{
							id: "filtered-transaction",
							date: "2024-01-15",
							amount: -1000,
							memo: "Filtered transaction",
							cleared: "cleared",
							approved: true,
							deleted: false,
							account_id: "account-1",
							category_id: "category-1",
						},
					],
				},
			});

			// Test filtering by date
			const dateFilterResult = await executeToolCall(
				server,
				"ynab_list_transactions",
				{
					budget_id: budgetId,
					since_date: "2024-01-01",
				},
			);
			validateToolResult(dateFilterResult);

			// Also mock account/category specific endpoints
			mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue({
				data: {
					transactions: [
						{
							id: "filtered-transaction",
							date: "2024-01-15",
							amount: -1000,
							memo: "Filtered transaction",
							cleared: "cleared",
							approved: true,
							deleted: false,
							account_id: "account-1",
							category_id: "category-1",
						},
					],
				},
			});
			mockYnabAPI.transactions.getTransactionsByCategory.mockResolvedValue({
				data: {
					transactions: [
						{
							id: "filtered-transaction",
							date: "2024-01-15",
							amount: -1000,
							memo: "Filtered transaction",
							cleared: "cleared",
							approved: true,
							deleted: false,
							account_id: "account-1",
							category_id: "category-1",
						},
					],
				},
			});

			// Account filters validate the account before listing its transactions
			mockYnabAPI.accounts.getAccounts.mockResolvedValue({
				data: { accounts: [{ id: "account-1" }] },
			});

			// Test filtering by account
			const accountFilterResult = await executeToolCall(
				server,
				"ynab_list_transactions",
				{
					budget_id: budgetId,
					account_id: "account-1",
				},
			);
			validateToolResult(accountFilterResult);

			// Test filtering by category
			const categoryFilterResult = await executeToolCall(
				server,
				"ynab_list_transactions",
				{
					budget_id: budgetId,
					category_id: "category-1",
				},
			);
			validateToolResult(categoryFilterResult);

			// Verify API calls with different parameters
			expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledTimes(1);
			expect(
				mockYnabAPI.transactions.getTransactionsByAccount,
			).toHaveBeenCalledTimes(1);
			expect(
				mockYnabAPI.transactions.getTransactionsByCategory,
			).toHaveBeenCalledTimes(1);
		});
	});

	describe("Complete Category Management Integration", () => {
		it("should handle complete category workflow", async () => {
			const budgetId = TEST_BUDGET_UUID;

			// Mock categories response
			const mockCategories = {
				data: {
					category_groups: [
						{
							id: "group-1",
							name: "Immediate Obligations",
							hidden: false,
							deleted: false,
							categories: [
								{
									id: "category-1",
									category_group_id: "group-1",
									name: "Rent/Mortgage",
									hidden: false,
									budgeted: 150000, // $150.00
									activity: -150000,
									balance: 0,
									// goal_type omitted (undefined, not null)
									deleted: false,
								},
								{
									id: "category-2",
									category_group_id: "group-1",
									name: "Utilities",
									hidden: false,
									budgeted: 10000, // $10.00
									activity: -8500,
									balance: 1500,
									// goal_type omitted (undefined, not null)
									deleted: false,
								},
							],
						},
					],
				},
			};

			mockYnabAPI.categories.getCategories.mockResolvedValue(mockCategories);

			// Test category listing
			const listResult = await executeToolCall(server, "ynab_list_categories", {
				budget_id: budgetId,
				response_format: "json",
			});
			validateToolResult(listResult);

			const categories = parseToolResult<{
				category_groups: unknown[];
				categories: { name: string }[];
			}>(listResult);
			expect(categories.category_groups).toHaveLength(1);
			expect(categories.categories).toHaveLength(2);
			expect(categories.categories[0]!.name).toBe("Rent/Mortgage");

			// Mock specific category response
			const mockCategory = {
				data: {
					category: mockCategories.data.category_groups[0]!.categories[0],
				},
			};

			mockYnabAPI.categories.getCategoryById.mockResolvedValue(mockCategory);

			// Test specific category retrieval
			const getResult = await executeToolCall(server, "ynab_get_category", {
				budget_id: budgetId,
				category_id: "category-1",
				response_format: "json",
			});
			validateToolResult(getResult);

			const category = parseToolResult<{
				category: { id: string; name: string; budgeted: number };
			}>(getResult);
			expect(category.category.id).toBe("category-1");
			expect(category.category.name).toBe("Rent/Mortgage");
			expect(category.category.budgeted).toBe(150);

			// Mock category update
			const updatedCategory = {
				...mockCategories.data.category_groups[0]!.categories[0],
				budgeted: 160000, // $160.00
			};

			const mockUpdateResponse = {
				data: {
					category: updatedCategory,
				},
			};

			mockYnabAPI.categories.updateMonthCategory.mockResolvedValue(
				mockUpdateResponse,
			);

			// Test category budget update
			const updateResult = await executeConfirmedToolCall(
				server,
				"ynab_update_category",
				{
					budget_id: budgetId,
					category_id: "category-1",
					budgeted_milliunits: 160000,
				},
			);
			validateToolResult(updateResult);

			const updated = parseToolResult<{ category: { budgeted: number } }>(
				updateResult,
			);
			expect(updated.category.budgeted).toBe(160);

			// Verify API calls
			expect(mockYnabAPI.categories.getCategories).toHaveBeenCalledWith(
				budgetId,
			);
			expect(mockYnabAPI.categories.getCategoryById).toHaveBeenCalledWith(
				budgetId,
				"category-1",
			);
			expect(mockYnabAPI.categories.updateMonthCategory).toHaveBeenCalled();
		});
	});

	describe("Complete Utility Tools Integration", () => {
		it("should handle user information retrieval", async () => {
			// Mock user response
			const mockUser = {
				data: {
					user: {
						id: "user-123",
						email: "test@example.com",
					},
				},
			};

			mockYnabAPI.user.getUser.mockResolvedValue(mockUser);

			// Test user retrieval
			const userResult = await executeToolCall(server, "ynab_get_user", {
				response_format: "json",
			});
			validateToolResult(userResult);

			const user = parseToolResult<{ user: { id: string } }>(userResult);
			expect(user.user.id).toBe("user-123");

			expect(mockYnabAPI.user.getUser).toHaveBeenCalledTimes(1);
		});
	});

	describe("Error Handling Integration", () => {
		it("should handle various API error scenarios", async () => {
			// Test 401 Unauthorized
			const authError = new Error("Unauthorized");
			(authError as any).error = {
				id: "401",
				name: "unauthorized",
				description: "Unauthorized",
			};
			mockYnabAPI.plans.getPlans.mockRejectedValue(authError);

			const authResult = await executeToolCall(server, "ynab_list_budgets");
			expect(authResult.isError).toBe(true);

			// Test 404 Not Found
			const notFoundError = new Error("Not Found");
			(notFoundError as any).error = {
				id: "404.2",
				name: "not_found",
				description: "Budget not found",
			};
			mockYnabAPI.plans.getPlanById.mockRejectedValue(notFoundError);

			const notFoundResult = await executeToolCall(server, "ynab_get_budget", {
				budget_id: "invalid",
			});
			expect(notFoundResult.isError).toBe(true);

			// Test 429 Rate Limit
			const rateLimitError = new Error("Too Many Requests");
			(rateLimitError as any).error = {
				id: "429",
				name: "rate_limit",
				description: "Rate limit exceeded",
			};
			mockYnabAPI.accounts.getAccounts.mockRejectedValue(rateLimitError);

			const rateLimitResult = await executeToolCall(
				server,
				"ynab_list_accounts",
				{
					budget_id: "test",
				},
			);
			expect(rateLimitResult.isError).toBe(true);
		});

		it("should validate input parameters", async () => {
			// Test missing required parameters
			const missingResult = await executeToolCall(
				server,
				"ynab_get_budget",
				{},
			);
			expect(missingResult.isError).toBe(true);

			// Test invalid parameter types
			const invalidResult = await executeToolCall(
				server,
				"ynab_create_transaction",
				{
					budget_id: "test",
					account_id: "test",
					amount: "invalid-amount", // Should be number
					date: "2024-01-01",
				},
			);
			expect(invalidResult.isError).toBe(true);
		});
	});

	describe("Caching Integration Tests", () => {
		beforeEach(() => {
			cacheManager.clear();
		});

		it("should cache budget list requests and improve performance on subsequent calls", async () => {
			const mockBudgets = {
				data: {
					plans: [
						{
							id: "budget-1",
							name: "Test Budget",
							last_modified_on: "2024-01-01T00:00:00Z",
							first_month: "2024-01-01",
							last_month: "2024-12-01",
							date_format: { format: "MM/DD/YYYY" },
							currency_format: {
								iso_code: "USD",
								example_format: "$123.45",
								decimal_digits: 2,
								decimal_separator: ".",
								symbol_first: true,
								group_separator: ",",
								currency_symbol: "$",
								display_symbol: true,
							},
						},
					],
				},
			};

			mockYnabAPI.plans.getPlans.mockResolvedValue(mockBudgets);

			const statsBeforeFirstCall = cacheManager.getStats();
			const initialSize = statsBeforeFirstCall.size;

			// First call - should hit API and cache result
			const firstResult = await executeToolCall(server, "ynab_list_budgets", {
				response_format: "json",
			});
			validateToolResult(firstResult);

			const firstParsed = parseToolResult<{
				cached: boolean;
				cache_info: string;
			}>(firstResult);
			expect(firstParsed.cached).toBe(false);
			expect(firstParsed.cache_info).toBe("Fresh data retrieved from YNAB API");

			// Cache should have grown
			const statsAfterFirstCall = cacheManager.getStats();
			expect(statsAfterFirstCall.size).toBeGreaterThan(initialSize);

			// Second call - should hit cache
			const secondResult = await executeToolCall(server, "ynab_list_budgets", {
				response_format: "json",
			});
			validateToolResult(secondResult);

			const secondParsed = parseToolResult<{
				cached: boolean;
				cache_info: string;
			}>(secondResult);
			expect(secondParsed.cached).toBe(true);
			expect(secondParsed.cache_info).toBe(
				"Data retrieved from cache for improved performance",
			);

			// API should only have been called once
			expect(mockYnabAPI.plans.getPlans).toHaveBeenCalledTimes(1);

			// Cache hit count should have increased
			const finalStats = cacheManager.getStats();
			expect(finalStats.hits).toBeGreaterThan(statsBeforeFirstCall.hits);
		});

		// Mutation invalidation is tested through the real SDK transport in
		// serverTransport.integration.test.ts. SDK method mocks bypass that boundary.

		it("should cache account-filtered transactions separately from budget transactions", async () => {
			const budgetId = TEST_BUDGET_UUID;

			const mockTransactions = {
				data: {
					transactions: [
						{
							id: "transaction-1",
							date: "2024-01-15",
							amount: -5000,
							memo: "Test transaction",
							cleared: "cleared",
							approved: true,
							deleted: false,
							account_id: "account-1",
							category_id: "category-1",
						},
					],
				},
			};

			mockYnabAPI.transactions.getTransactions.mockResolvedValue(
				mockTransactions,
			);
			mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue(
				mockTransactions,
			);

			mockYnabAPI.accounts.getAccounts.mockResolvedValue({
				data: { accounts: [{ id: "account-1" }] },
			});
			const statsBeforeUnfiltered = cacheManager.getStats();

			// Unfiltered request - should be cached
			const unfilteredResult = await executeToolCall(
				server,
				"ynab_list_transactions",
				{
					budget_id: budgetId,
					response_format: "json",
				},
			);
			const unfilteredParsed = parseToolResult<{ cached: boolean }>(
				unfilteredResult,
			);
			expect(unfilteredParsed.cached).toBe(false); // First call, cache miss

			const statsAfterUnfiltered = cacheManager.getStats();
			expect(statsAfterUnfiltered.size).toBeGreaterThan(
				statsBeforeUnfiltered.size,
			);

			// Account filters have a separate cache entry from the whole budget.
			const filteredResult = await executeToolCall(
				server,
				"ynab_list_transactions",
				{
					budget_id: budgetId,
					account_id: "account-1",
					response_format: "json",
				},
			);
			const filteredParsed = parseToolResult<{
				cached: boolean;
				cache_info: string;
			}>(filteredResult);
			expect(filteredParsed.cached).toBe(false);
			expect(filteredParsed.cache_info).toBe(
				"Fresh data retrieved from YNAB API",
			);

			// Repeating each shape reuses its own snapshot.
			const repeatedFiltered = await executeToolCall(
				server,
				"ynab_list_transactions",
				{
					budget_id: budgetId,
					account_id: "account-1",
					response_format: "json",
				},
			);
			expect(
				parseToolResult<{ cached: boolean }>(repeatedFiltered).cached,
			).toBe(true);
			const repeatedUnfiltered = await executeToolCall(
				server,
				"ynab_list_transactions",
				{
					budget_id: budgetId,
					response_format: "json",
				},
			);
			expect(
				parseToolResult<{ cached: boolean }>(repeatedUnfiltered).cached,
			).toBe(true);
			expect(cacheManager.getStats().size).toBeGreaterThan(
				statsAfterUnfiltered.size,
			);

			// Both API methods were called; each repeat revalidates with a delta request
			expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledTimes(2);
			expect(
				mockYnabAPI.transactions.getTransactionsByAccount,
			).toHaveBeenCalledTimes(2);
		});

		it("should handle cache warming after setting default budget", async () => {
			const budgetId = TEST_BUDGET_UUID;

			// Mock all the responses for cache warming
			mockYnabAPI.accounts.getAccounts.mockResolvedValue({
				data: { accounts: [] },
			});
			mockYnabAPI.plans.getPlanById.mockResolvedValue({
				data: { plan: { id: budgetId, name: "Warm Cache Budget" } },
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
			await executeToolCall(server, "ynab_set_default_budget", {
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

		it("should handle cache clear operation", async () => {
			// Populate cache with some data
			mockYnabAPI.plans.getPlans.mockResolvedValue({
				data: { plans: [] },
			});

			await executeToolCall(server, "ynab_list_budgets");

			// Verify cache has entries
			const statsAfterPopulation = cacheManager.getStats();
			expect(statsAfterPopulation.size).toBeGreaterThan(0);

			// Clear cache
			await executeToolCall(server, "ynab_clear_cache");

			// Verify cache is empty
			const statsAfterClear = cacheManager.getStats();
			expect(statsAfterClear.size).toBe(0);
			expect(statsAfterClear.hits).toBe(0);
			expect(statsAfterClear.misses).toBe(0);
		});

		it("should respect cache TTL and return fresh data after expiration", async () => {
			const mockBudgets = {
				data: {
					plans: [
						{
							id: "budget-1",
							name: "Test Budget",
							last_modified_on: "2024-01-01T00:00:00Z",
							first_month: "2024-01-01",
							last_month: "2024-12-01",
							date_format: { format: "MM/DD/YYYY" },
							currency_format: {
								iso_code: "USD",
								example_format: "$123.45",
								decimal_digits: 2,
								decimal_separator: ".",
								symbol_first: true,
								group_separator: ",",
								currency_symbol: "$",
								display_symbol: true,
							},
						},
					],
				},
			};

			mockYnabAPI.plans.getPlans.mockResolvedValue(mockBudgets);

			// First call - cache miss
			const firstResult = await executeToolCall(server, "ynab_list_budgets", {
				response_format: "json",
			});
			const firstParsed = parseToolResult<{ cached: boolean }>(firstResult);
			expect(firstParsed.cached).toBe(false);

			// Second call - cache hit
			const secondResult = await executeToolCall(server, "ynab_list_budgets", {
				response_format: "json",
			});
			const secondParsed = parseToolResult<{ cached: boolean }>(secondResult);
			expect(secondParsed.cached).toBe(true);

			expect(mockYnabAPI.plans.getPlans).toHaveBeenCalledTimes(1);

			// Advance only Date.now so request timeouts remain real.
			const now = vi
				.spyOn(Date, "now")
				.mockReturnValue(Date.now() + CACHE_TTLS.BUDGETS + 1);
			try {
				mockYnabAPI.plans.getPlans.mockResolvedValue({
					data: {
						plans: [{ ...mockBudgets.data.plans[0], name: "Refreshed Budget" }],
					},
				});
				const refreshed = await executeToolCall(server, "ynab_list_budgets", {
					response_format: "json",
				});
				const refreshedParsed = parseToolResult<{
					cached: boolean;
					budgets: { name: string }[];
				}>(refreshed);
				expect(refreshedParsed.cached).toBe(false);
				expect(refreshedParsed.budgets[0]!.name).toBe("Refreshed Budget");
				expect(mockYnabAPI.plans.getPlans).toHaveBeenCalledTimes(2);
			} finally {
				now.mockRestore();
			}
		});
	});
});
