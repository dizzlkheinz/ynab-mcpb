import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import { maybeTextOf, textOf } from "../../__tests__/testUtils.js";
import type { ReadDeps } from "../../types/toolRegistration.js";
import type { DeltaFetcher } from "../deltaFetcher.js";
import {
	handleGetTransaction as handleGetTransactionImpl,
	handleListTransactions as handleListTransactionsImpl,
} from "../transactionReadTools.js";
import {
	type BulkTransactionInput,
	type CreateReceiptSplitTransactionParams,
	CreateReceiptSplitTransactionSchema,
	CreateTransactionSchema,
	type CreateTransactionsParams,
	CreateTransactionsSchema,
	DeleteTransactionSchema,
	GetTransactionSchema,
	ListTransactionsSchema,
	UpdateTransactionSchema,
	UpdateTransactionsSchema,
} from "../transactionSchemas.js";
import {
	handleCreateReceiptSplitTransaction,
	handleCreateTransaction,
	handleCreateTransactions,
	handleDeleteTransaction,
	handleUpdateTransaction,
	handleUpdateTransactions,
} from "../transactionWriteTools.js";

// Mock the YNAB API without global service fallbacks.
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
		getAccounts: vi.fn(),
	},
} as unknown as ynab.API;

// Read dependencies are explicit test-local fixtures; production handlers use the same path.
const cacheManager = {
	wrap: vi.fn(
		async (_key: string, options: { loader: () => Promise<unknown> }) =>
			options.loader(),
	),
	has: vi.fn(() => false),
};
const makeDeltaFetcher = vi.fn((api: ynab.API) => ({
	fetchAccounts: vi.fn(async (budgetId: string) => {
		const response = await api.accounts.getAccounts(budgetId);
		return { data: response.data.accounts, wasCached: false, usedDelta: false };
	}),
	fetchTransactions: vi.fn(
		async (
			budgetId: string,
			since?: string,
			type?: ynab.GetTransactionsTypeEnum,
		) => {
			const response = await api.transactions.getTransactions(
				budgetId,
				since,
				undefined,
				type,
			);
			return {
				data: response.data.transactions,
				wasCached: false,
				usedDelta: false,
			};
		},
	),
	fetchTransactionsByAccount: vi.fn(
		async (budgetId: string, accountId: string, since?: string) => {
			const response = await api.transactions.getTransactionsByAccount(
				budgetId,
				accountId,
				since,
				undefined,
				undefined,
			);
			return {
				data: response.data.transactions,
				wasCached: false,
				usedDelta: false,
			};
		},
	),
}));
function readDeps(api: ynab.API): ReadDeps {
	return {
		deltaFetcher: makeDeltaFetcher(api) as unknown as DeltaFetcher,
		cacheManager: cacheManager as unknown as ReadDeps["cacheManager"],
	};
}
const handleListTransactions = (
	api: ynab.API,
	params: Parameters<typeof handleListTransactionsImpl>[1],
) => handleListTransactionsImpl(api, params, readDeps(api));
const handleGetTransaction = (
	api: ynab.API,
	params: Parameters<typeof handleGetTransactionImpl>[1],
) => handleGetTransactionImpl(api, params, readDeps(api));
const { globalRequestLogger } = await import("../../server/requestLogger.js");

describe("transactionTools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Each test controls its explicit read dependencies.
		process.env["NODE_ENV"] = "test";
	});

	describe("ListTransactionsSchema", () => {
		it("should validate valid parameters", () => {
			const validParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				category_id: "category-789",
				since_date: "2024-01-01",
				type: "uncategorized" as const,
			};

			const result = ListTransactionsSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		it("should allow missing budget_id for default resolution", () => {
			const paramsWithoutBudget = {
				account_id: "account-456",
			};

			const result = ListTransactionsSchema.safeParse(paramsWithoutBudget);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.budget_id).toBeUndefined();
			}
		});

		it("should validate date format", () => {
			const invalidParams = {
				budget_id: "budget-123",
				since_date: "01/01/2024", // Invalid format
			};

			const result = ListTransactionsSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.message).toContain(
					"Date must be in ISO format",
				);
			}
		});

		it("should validate type enum", () => {
			const invalidParams = {
				budget_id: "budget-123",
				type: "invalid-type",
			};

			const result = ListTransactionsSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});

		it("should allow optional parameters to be undefined", () => {
			const minimalParams = {
				budget_id: "budget-123",
			};

			const result = ListTransactionsSchema.safeParse(minimalParams);
			expect(result.success).toBe(true);
		});
	});

	describe("handleListTransactions", () => {
		const mockTransaction = {
			id: "transaction-123",
			date: "2024-01-01",
			amount: -50000, // $50.00 outflow in milliunits
			memo: "Test transaction",
			cleared: "cleared" as any,
			approved: true,
			flag_color: null,
			account_id: "account-456",
			payee_id: "payee-789",
			category_id: "category-101",
			transfer_account_id: null,
			transfer_transaction_id: null,
			matched_transaction_id: null,
			import_id: null,
			deleted: false,
			subtransactions: [],
		};

		it("uses the injected transaction fetcher for unfiltered requests", async () => {
			const mockResponse = {
				data: {
					transactions: [mockTransaction],
				},
			};

			(mockYnabAPI.transactions.getTransactions as any).mockResolvedValue(
				mockResponse,
			);

			const params = {
				budget_id: "budget-123",
				response_format: "json" as const,
			};
			const result = await handleListTransactions(mockYnabAPI, params);

			expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledWith(
				"budget-123",
				undefined,
				undefined,
				undefined,
			);

			const parsedContent = JSON.parse(textOf(result.content[0]));
			expect(parsedContent.cached).toBe(false);
			expect(parsedContent.cache_info).toBe(
				"Fresh data retrieved from YNAB API",
			);
			expect(parsedContent.transactions[0].id).toBe("transaction-123");
		});

		it("should list all transactions when no filters are provided", async () => {
			const mockResponse = {
				data: {
					transactions: [mockTransaction],
				},
			};

			(mockYnabAPI.transactions.getTransactions as any).mockResolvedValue(
				mockResponse,
			);

			const params = {
				budget_id: "budget-123",
				response_format: "json" as const,
			};
			const result = await handleListTransactions(mockYnabAPI, params);

			expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledWith(
				"budget-123",
				undefined,
				undefined,
				undefined,
			);
			expect(textOf(result.content[0])).toContain("transaction-123");
			expect(textOf(result.content[0])).toContain("-50");
		});

		it("should filter by account_id when provided", async () => {
			const mockAccountsResponse = {
				data: {
					accounts: [
						{ id: "account-456", name: "Test Account", deleted: false },
					],
					server_knowledge: 100,
				},
			};
			const mockResponse = {
				data: {
					transactions: [mockTransaction],
				},
			};

			(mockYnabAPI.accounts.getAccounts as any).mockResolvedValue(
				mockAccountsResponse,
			);
			(
				mockYnabAPI.transactions.getTransactionsByAccount as any
			).mockResolvedValue(mockResponse);

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				response_format: "json" as const,
			};
			const result = await handleListTransactions(mockYnabAPI, params);

			expect(mockYnabAPI.accounts.getAccounts).toHaveBeenCalledWith(
				"budget-123",
			);
			expect(
				mockYnabAPI.transactions.getTransactionsByAccount,
			).toHaveBeenCalledWith(
				"budget-123",
				"account-456",
				undefined,
				undefined,
				undefined,
			);
			expect(textOf(result.content[0])).toContain("transaction-123");
		});

		it("should filter by category_id when provided", async () => {
			const mockResponse = {
				data: {
					transactions: [mockTransaction],
				},
			};

			(
				mockYnabAPI.transactions.getTransactionsByCategory as any
			).mockResolvedValue(mockResponse);

			const params = {
				budget_id: "budget-123",
				category_id: "category-789",
				response_format: "json" as const,
			};
			const result = await handleListTransactions(mockYnabAPI, params);

			expect(
				mockYnabAPI.transactions.getTransactionsByCategory,
			).toHaveBeenCalledWith("budget-123", "category-789", undefined);
			expect(textOf(result.content[0])).toContain("transaction-123");
		});

		it("should filter fetched transactions by cleared status before pagination", async () => {
			const mockResponse = {
				data: {
					transactions: [
						mockTransaction,
						{
							...mockTransaction,
							id: "transaction-456",
							cleared: "uncleared" as ynab.TransactionClearedStatus,
						},
					],
				},
			};

			(mockYnabAPI.transactions.getTransactions as any).mockResolvedValue(
				mockResponse,
			);

			const result = await handleListTransactions(mockYnabAPI, {
				budget_id: "budget-123",
				cleared: "uncleared" as const,
				response_format: "json" as const,
			});
			const deltaFetcherResult = vi
				.mocked(makeDeltaFetcher)
				.mock.results.slice(-1)[0]!.value;

			expect(vi.mocked(makeDeltaFetcher)).toHaveBeenCalled();
			expect(deltaFetcherResult.fetchTransactions).toHaveBeenCalledWith(
				"budget-123",
				undefined,
				undefined,
			);
			expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledWith(
				"budget-123",
				undefined,
				undefined,
				undefined,
			);
			const parsedContent = JSON.parse(textOf(result.content[0]));
			expect(parsedContent.total_count).toBe(1);
			expect(parsedContent.transactions).toHaveLength(1);
			expect(parsedContent.transactions[0].id).toBe("transaction-456");
			expect(parsedContent.transactions[0].cleared).toBe("uncleared");
		});

		it("should include since_date parameter when provided", async () => {
			const mockResponse = {
				data: {
					transactions: [mockTransaction],
				},
			};

			(mockYnabAPI.transactions.getTransactions as any).mockResolvedValue(
				mockResponse,
			);

			const params = {
				budget_id: "budget-123",
				since_date: "2024-01-01",
				type: "uncategorized" as const,
			};
			await handleListTransactions(mockYnabAPI, params);

			expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledWith(
				"budget-123",
				"2024-01-01",
				undefined,
				"uncategorized",
			);
		});

		it("should handle 401 authentication errors", async () => {
			const error = new Error("401 Unauthorized");
			(mockYnabAPI.transactions.getTransactions as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				response_format: "json" as const,
			};
			const result = await handleListTransactions(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Invalid or expired YNAB access token",
			);
		});

		it("should handle 404 not found errors", async () => {
			const error = new Error("404 Not Found");
			(mockYnabAPI.transactions.getTransactions as any).mockRejectedValue(
				error,
			);

			const params = { budget_id: "invalid-budget" };
			const result = await handleListTransactions(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Budget, account, category, or transaction not found",
			);
		});

		it("should handle 429 rate limit errors", async () => {
			const error = new Error("429 Too Many Requests");
			(mockYnabAPI.transactions.getTransactions as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				response_format: "json" as const,
			};
			const result = await handleListTransactions(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Rate limit exceeded. Please try again later",
			);
		});

		it("should handle generic errors", async () => {
			const error = new Error("Network error");
			(mockYnabAPI.transactions.getTransactions as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				response_format: "json" as const,
			};
			const result = await handleListTransactions(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe("Failed to list transactions");
		});

		it("should include cached property in large response path", async () => {
			// Create large transaction list (> 90KB for paginated slice)
			// Each item needs ~1800+ bytes so 50 items (default page) exceeds 90KB limit
			const largeTransactionList: ynab.TransactionDetail[] = [];
			for (let i = 0; i < 5000; i++) {
				largeTransactionList.push({
					id: `transaction-${i}`,
					date: "2025-01-01",
					amount: -10000,
					memo: "Test transaction with long memo to increase size ".repeat(40),
					cleared: "cleared",
					approved: true,
					flag_color: null,
					account_id: "test-account",
					debt_transaction_type: null,
					deleted: false,
					account_name: "Test Account",
					payee_name: "Test Payee",
					category_name: "Test Category",
					subtransactions: [],
				} as ynab.TransactionDetail);
			}

			const mockAccountsResponse = {
				data: {
					accounts: [
						{ id: "test-account", name: "Test Account", deleted: false },
					],
					server_knowledge: 100,
				},
			};
			const mockResponse = {
				data: {
					transactions: largeTransactionList,
				},
			};

			(mockYnabAPI.accounts.getAccounts as any).mockResolvedValue(
				mockAccountsResponse,
			);
			(
				mockYnabAPI.transactions.getTransactionsByAccount as any
			).mockResolvedValue(mockResponse);

			const result = await handleListTransactions(mockYnabAPI, {
				budget_id: "test-budget",
				account_id: "test-account",
				response_format: "json" as const,
			});

			const content = result.content?.[0];
			expect(content).toBeDefined();
			expect(content?.type).toBe("text");

			const parsedResponse = JSON.parse(textOf(content));

			// Large response path returns preview with message and preview_transactions
			expect(parsedResponse.message).toBeDefined();
			expect(parsedResponse.total_count).toBeDefined();
			expect(parsedResponse.preview_transactions).toBeDefined();
		});
	});

	describe("GetTransactionSchema", () => {
		it("should validate valid parameters", () => {
			const validParams = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
			};

			const result = GetTransactionSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		it("should allow missing budget_id for default resolution", () => {
			const paramsWithoutBudget = {
				transaction_id: "transaction-456",
			};

			const result = GetTransactionSchema.safeParse(paramsWithoutBudget);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.budget_id).toBeUndefined();
			}
		});

		it("should require transaction_id", () => {
			const invalidParams = {
				budget_id: "budget-123",
			};

			const result = GetTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.code).toBe("invalid_type");
				expect(result.error.issues[0]!.path).toEqual(["transaction_id"]);
			}
		});

		it("should reject empty strings", () => {
			const invalidParams = {
				budget_id: "",
				transaction_id: "",
			};

			const result = GetTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});
	});

	describe("handleGetTransaction", () => {
		const mockTransactionDetail = {
			id: "transaction-123",
			date: "2024-01-01",
			amount: -50000,
			memo: "Test transaction",
			cleared: "cleared" as any,
			approved: true,
			flag_color: null,
			account_id: "account-456",
			payee_id: "payee-789",
			category_id: "category-101",
			transfer_account_id: null,
			transfer_transaction_id: null,
			matched_transaction_id: null,
			import_id: null,
			deleted: false,
			account_name: "Test Account",
			payee_name: "Test Payee",
			category_name: "Test Category",
		};

		it("should get transaction details successfully", async () => {
			const mockResponse = {
				data: {
					transaction: mockTransactionDetail,
				},
			};

			(mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue(
				mockResponse,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				response_format: "json" as const,
			};
			const result = await handleGetTransaction(mockYnabAPI, params);

			expect(mockYnabAPI.transactions.getTransactionById).toHaveBeenCalledWith(
				"budget-123",
				"transaction-456",
			);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.transaction.id).toBe("transaction-123");
			expect(response.transaction.amount).toBe(-50);
			expect(response.transaction.account_name).toBe("Test Account");
			expect(response.transaction.payee_name).toBe("Test Payee");
			expect(response.transaction.category_name).toBe("Test Category");
		});

		it("should handle 404 not found errors", async () => {
			const error = new Error("404 Not Found");
			(mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "invalid-transaction",
				response_format: "json" as const,
			};
			const result = await handleGetTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Budget, account, category, or transaction not found",
			);
		});

		it("should handle authentication errors", async () => {
			const error = new Error("401 Unauthorized");
			(mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				response_format: "json" as const,
			};
			const result = await handleGetTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Invalid or expired YNAB access token",
			);
		});

		it("should handle generic errors", async () => {
			const error = new Error("Network error");
			(mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				response_format: "json" as const,
			};
			const result = await handleGetTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe("Failed to get transaction");
		});
	});

	describe("CreateTransactionSchema", () => {
		it("should validate valid parameters with required fields only", () => {
			const validParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -50000, // $50.00 outflow in milliunits
				date: "2024-01-01",
			};

			const result = CreateTransactionSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		it("should validate valid parameters with all optional fields", () => {
			const validParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
				payee_name: "Test Payee",
				payee_id: "payee-789",
				category_id: "category-101",
				memo: "Test memo",
				cleared: "cleared" as const,
				approved: true,
				flag_color: "red" as const,
			};

			const result = CreateTransactionSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		it("should allow missing budget_id for default resolution", () => {
			const paramsWithoutBudget = {
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
			};

			const result = CreateTransactionSchema.safeParse(paramsWithoutBudget);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.budget_id).toBeUndefined();
			}
		});

		it("should require account_id", () => {
			const invalidParams = {
				budget_id: "budget-123",
				amount: -50000,
				date: "2024-01-01",
			};

			const result = CreateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});

		it("should require amount to be an integer", () => {
			const invalidParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -500.5, // Decimal not allowed
				date: "2024-01-01",
			};

			const result = CreateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.message).toContain(
					"Amount must be an integer in milliunits",
				);
			}
		});

		it("should validate date format", () => {
			const invalidParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -50000,
				date: "01/01/2024", // Invalid format
			};

			const result = CreateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.message).toContain(
					"Date must be in ISO format",
				);
			}
		});

		it("should validate cleared status enum", () => {
			const invalidParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
				cleared: "invalid-status",
			};

			const result = CreateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});

		it("should validate flag_color enum", () => {
			const invalidParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
				flag_color: "invalid-color",
			};

			const result = CreateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});

		it("should validate parameters with subtransactions when totals match", () => {
			const validParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -75000,
				date: "2024-01-01",
				subtransactions: [
					{
						amount: -25000,
						memo: "Groceries",
						category_id: "category-groceries",
					},
					{
						amount: -50000,
						memo: "Rent",
						category_id: "category-rent",
					},
				],
			};

			const result = CreateTransactionSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		it("should reject parameters when subtransaction totals do not match amount", () => {
			const invalidParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -70000,
				date: "2024-01-01",
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
				expect(result.error.issues[0]!.message).toBe(
					"Amount must equal the sum of subtransaction amounts",
				);
			}
		});
	});

	describe("handleCreateTransaction", () => {
		const mockCreatedTransaction = {
			id: "new-transaction-123",
			date: "2024-01-01",
			amount: -50000,
			memo: "Test transaction",
			cleared: "cleared" as any,
			approved: true,
			flag_color: "red" as any,
			account_id: "account-456",
			payee_id: "payee-789",
			category_id: "category-101",
			transfer_account_id: null,
			transfer_transaction_id: null,
			matched_transaction_id: null,
			import_id: null,
			deleted: false,
		};

		it("should create transaction with required fields only", async () => {
			const mockResponse = {
				data: {
					transaction: mockCreatedTransaction,
					server_knowledge: 1,
				},
			};

			const mockAccountResponse = {
				data: {
					account: {
						id: "account-456",
						balance: 100000,
						cleared_balance: 95000,
					},
				},
			};

			(mockYnabAPI.transactions.createTransaction as any).mockResolvedValue(
				mockResponse,
			);
			(mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(
				mockAccountResponse,
			);

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
			};
			const result = await handleCreateTransaction(mockYnabAPI, params);

			const createCall = (mockYnabAPI.transactions.createTransaction as any)
				.mock.calls[0];
			expect(createCall[0]).toBe("budget-123");
			const payload = createCall[1];
			expect(payload.transaction).toMatchObject({
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
				cleared: undefined,
				flag_color: undefined,
			});
			expect(payload.transaction).not.toHaveProperty("subtransactions");
			expect(payload.transaction).not.toHaveProperty("approved");

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.transaction.id).toBe("new-transaction-123");
			expect(response.transaction.amount).toBe(-50);
		});

		it("should create transaction with all optional fields", async () => {
			const mockResponse = {
				data: {
					transaction: mockCreatedTransaction,
					server_knowledge: 1,
				},
			};

			const mockAccountResponse = {
				data: {
					account: {
						id: "account-456",
						balance: 100000,
						cleared_balance: 95000,
					},
				},
			};

			(mockYnabAPI.transactions.createTransaction as any).mockResolvedValue(
				mockResponse,
			);
			(mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(
				mockAccountResponse,
			);

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
				payee_name: "Test Payee",
				payee_id: "payee-789",
				category_id: "category-101",
				memo: "Test memo",
				cleared: "cleared" as const,
				approved: true,
				flag_color: "red" as const,
			};
			const result = await handleCreateTransaction(mockYnabAPI, params);

			const createCall = (mockYnabAPI.transactions.createTransaction as any)
				.mock.calls[0];
			expect(createCall[0]).toBe("budget-123");
			const payload = createCall[1];
			expect(payload.transaction).toMatchObject({
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
				payee_name: "Test Payee",
				payee_id: "payee-789",
				category_id: "category-101",
				memo: "Test memo",
				cleared: "cleared",
				approved: true,
				flag_color: "red",
			});
			expect(payload.transaction).not.toHaveProperty("subtransactions");

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.transaction.id).toBe("new-transaction-123");
		});

		it("should create split transaction with subtransactions", async () => {
			const mockSplitTransaction = {
				...mockCreatedTransaction,
				amount: -75000,
				subtransactions: [
					{
						id: "sub-1",
						transaction_id: "new-transaction-123",
						amount: -25000,
						memo: "Groceries",
						payee_id: null,
						payee_name: "Corner Store",
						category_id: "category-groceries",
						category_name: "Groceries",
						transfer_account_id: null,
						transfer_transaction_id: null,
						deleted: false,
					},
					{
						id: "sub-2",
						transaction_id: "new-transaction-123",
						amount: -50000,
						memo: "Rent",
						payee_id: "payee-landlord",
						payee_name: null,
						category_id: "category-rent",
						category_name: "Rent",
						transfer_account_id: null,
						transfer_transaction_id: null,
						deleted: false,
					},
				],
			};

			const mockResponse = {
				data: {
					transaction: mockSplitTransaction,
					server_knowledge: 1,
				},
			};

			const mockAccountResponse = {
				data: {
					account: {
						id: "account-456",
						balance: 250000,
						cleared_balance: 225000,
					},
				},
			};

			(mockYnabAPI.transactions.createTransaction as any).mockResolvedValue(
				mockResponse,
			);
			(mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(
				mockAccountResponse,
			);

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -75000,
				date: "2024-01-01",
				subtransactions: [
					{
						amount: -25000,
						memo: "Groceries",
						payee_name: "Corner Store",
						category_id: "category-groceries",
					},
					{
						amount: -50000,
						memo: "Rent",
						payee_id: "payee-landlord",
						category_id: "category-rent",
					},
				],
			};

			const result = await handleCreateTransaction(mockYnabAPI, params);

			const createCall = (mockYnabAPI.transactions.createTransaction as any)
				.mock.calls[0];
			expect(createCall[0]).toBe("budget-123");
			const payload = createCall[1];
			expect(payload.transaction).toMatchObject({
				account_id: "account-456",
				amount: -75000,
				date: "2024-01-01",
				subtransactions: [
					{
						amount: -25000,
						memo: "Groceries",
						payee_name: "Corner Store",
						category_id: "category-groceries",
					},
					{
						amount: -50000,
						memo: "Rent",
						payee_id: "payee-landlord",
						category_id: "category-rent",
					},
				],
			});

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.transaction.amount).toBe(-75);
			expect(response.transaction.subtransactions).toEqual([
				{
					id: "sub-1",
					transaction_id: "new-transaction-123",
					amount: -25,
					amount_milliunits: -25000,
					memo: "Groceries",
					payee_id: null,
					payee_name: "Corner Store",
					category_id: "category-groceries",
					category_name: "Groceries",
					transfer_account_id: null,
					transfer_transaction_id: null,
					deleted: false,
				},
				{
					id: "sub-2",
					transaction_id: "new-transaction-123",
					amount: -50,
					amount_milliunits: -50000,
					memo: "Rent",
					payee_id: "payee-landlord",
					payee_name: null,
					category_id: "category-rent",
					category_name: "Rent",
					transfer_account_id: null,
					transfer_transaction_id: null,
					deleted: false,
				},
			]);
		});

		it("should handle 404 not found errors", async () => {
			const error = new Error("404 Not Found");
			(mockYnabAPI.transactions.createTransaction as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "invalid-budget",
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
			};
			const result = await handleCreateTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Budget, account, category, or transaction not found",
			);
		});

		it("should handle authentication errors", async () => {
			const error = new Error("401 Unauthorized");
			(mockYnabAPI.transactions.createTransaction as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
			};
			const result = await handleCreateTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Invalid or expired YNAB access token",
			);
		});

		it("should handle generic errors", async () => {
			const error = new Error("Network error");
			(mockYnabAPI.transactions.createTransaction as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				amount: -50000,
				date: "2024-01-01",
			};
			const result = await handleCreateTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe("Failed to create transaction");
		});
	});

	describe("handleCreateTransactions", () => {
		it("surfaces top-level validation errors with a reserved transaction index", async () => {
			const invalidParams = {
				budget_id: "",
				transactions: [],
			};

			const result = await handleCreateTransactions(
				mockYnabAPI,
				invalidParams as any,
			);

			expect(result.content).toHaveLength(1);
			const parsed = JSON.parse(textOf(result.content[0]));
			expect(parsed.error.code).toBe("VALIDATION_ERROR");
			expect(parsed.error.details).toBeDefined();

			const details = JSON.parse(parsed.error.details ?? "[]");
			expect(details).toHaveLength(1);
			expect(details[0].transaction_index).toBeNull();
			expect(details[0].errors).toEqual(
				expect.arrayContaining([
					"Budget ID is required",
					"At least one transaction is required",
				]),
			);
		});

		it("combines reserved and per-transaction validation errors", async () => {
			const invalidParams = {
				budget_id: "budget-123",
				dry_run: "later",
				transactions: [
					{
						account_id: "",
						amount: -50000,
						date: "2024-01-01",
					},
				],
			};

			const result = await handleCreateTransactions(
				mockYnabAPI,
				invalidParams as any,
			);

			const parsed = JSON.parse(textOf(result.content[0]));
			expect(parsed.error.code).toBe("VALIDATION_ERROR");
			expect(parsed.error.details).toBeDefined();

			const details = JSON.parse(parsed.error.details ?? "[]");
			const generalEntry = details.find(
				(entry: any) => entry.transaction_index === null,
			);
			const transactionEntry = details.find(
				(entry: any) => entry.transaction_index === 0,
			);

			expect(generalEntry).toBeDefined();
			expect(generalEntry.errors).toEqual(
				expect.arrayContaining([expect.stringContaining("expected boolean")]),
			);

			expect(transactionEntry).toBeDefined();
			expect(transactionEntry.errors).toEqual(
				expect.arrayContaining(["Account ID is required"]),
			);
		});
	});

	describe("CreateReceiptSplitTransactionSchema", () => {
		const basePayload = {
			budget_id: "budget-123",
			account_id: "account-456",
			payee_name: "IKEA",
			receipt_subtotal: 50,
			receipt_tax: 5,
			receipt_total: 55,
			categories: [
				{
					category_id: "category-a",
					category_name: "Home",
					items: [
						{ name: "Lamp", amount: 20 },
						{ name: "Rug", amount: 30 },
					],
				},
			],
		} as const;

		it("should validate a well-formed receipt split payload", () => {
			const result = CreateReceiptSplitTransactionSchema.safeParse(basePayload);
			expect(result.success).toBe(true);
		});

		it("should reject when subtotal does not match categorized items", () => {
			const invalidPayload = {
				...basePayload,
				receipt_subtotal: 40,
			};

			const result =
				CreateReceiptSplitTransactionSchema.safeParse(invalidPayload);
			expect(result.success).toBe(false);
		});

		it("should reject when total does not equal subtotal plus tax", () => {
			const invalidPayload = {
				...basePayload,
				receipt_total: 56,
			};

			const result =
				CreateReceiptSplitTransactionSchema.safeParse(invalidPayload);
			expect(result.success).toBe(false);
		});
	});

	describe("handleCreateReceiptSplitTransaction", () => {
		const mockSplitTransaction = {
			id: "new-transaction-456",
			date: "2025-10-13",
			amount: -55000,
			memo: "Receipt import",
			cleared: "uncleared" as const,
			approved: false,
			flag_color: null,
			account_id: "account-456",
			payee_id: null,
			category_id: null,
			transfer_account_id: null,
			transfer_transaction_id: null,
			matched_transaction_id: null,
			import_id: null,
			deleted: false,
			subtransactions: [
				{
					id: "sub-1",
					transaction_id: "new-transaction-456",
					amount: -20000,
					memo: "Lamp",
					payee_id: null,
					payee_name: null,
					category_id: "category-home",
					category_name: "Home",
					transfer_account_id: null,
					transfer_transaction_id: null,
					deleted: false,
				},
				{
					id: "sub-2",
					transaction_id: "new-transaction-456",
					amount: -10000,
					memo: "Shelf",
					payee_id: null,
					payee_name: null,
					category_id: "category-home",
					category_name: "Home",
					transfer_account_id: null,
					transfer_transaction_id: null,
					deleted: false,
				},
				{
					id: "sub-3",
					transaction_id: "new-transaction-456",
					amount: -15000,
					memo: "Pan",
					payee_id: null,
					payee_name: null,
					category_id: "category-kitchen",
					category_name: "Kitchen",
					transfer_account_id: null,
					transfer_transaction_id: null,
					deleted: false,
				},
				{
					id: "sub-4",
					transaction_id: "new-transaction-456",
					amount: -10000,
					memo: "Tax - Home",
					payee_id: null,
					payee_name: null,
					category_id: "category-home",
					category_name: "Home",
					transfer_account_id: null,
					transfer_transaction_id: null,
					deleted: false,
				},
				{
					id: "sub-5",
					transaction_id: "new-transaction-456",
					amount: -5000,
					memo: "Tax - Kitchen",
					payee_id: null,
					payee_name: null,
					category_id: "category-kitchen",
					category_name: "Kitchen",
					transfer_account_id: null,
					transfer_transaction_id: null,
					deleted: false,
				},
			],
		};

		const mockAccountResponse = {
			data: {
				account: {
					id: "account-456",
					balance: 500000,
					cleared_balance: 450000,
				},
			},
		};

		beforeEach(() => {
			(mockYnabAPI.transactions.createTransaction as any).mockReset();
			(mockYnabAPI.accounts.getAccountById as any).mockReset();
		});

		it("should return a detailed dry-run summary without calling the API", async () => {
			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				payee_name: "IKEA",
				date: "2025-10-13",
				receipt_tax: 5,
				receipt_total: 55,
				categories: [
					{
						category_id: "category-home",
						category_name: "Home",
						items: [
							{ name: "Lamp", amount: 20 },
							{ name: "Shelf", amount: 10 },
						],
					},
					{
						category_id: "category-kitchen",
						category_name: "Kitchen",
						items: [{ name: "Pan", amount: 20 }],
					},
				],
				receipt_subtotal: 50,
				dry_run: true,
			} satisfies CreateReceiptSplitTransactionParams;

			const result = await handleCreateReceiptSplitTransaction(
				mockYnabAPI,
				params,
			);

			expect(mockYnabAPI.transactions.createTransaction).not.toHaveBeenCalled();
			const parsed = JSON.parse(textOf(result.content[0]));
			expect(parsed.dry_run).toBe(true);
			expect(parsed.transaction_preview.amount).toBe(-55);
			expect(parsed.receipt_summary.total).toBe(55);
			expect(parsed.subtransactions).toHaveLength(5);
			expect(parsed.subtransactions.every((item: any) => item.amount < 0)).toBe(
				true,
			);
		});

		it("should default the date to the local calendar date", async () => {
			// West of UTC, so late evening locally is already tomorrow in UTC
			vi.stubEnv("TZ", "America/Toronto");
			vi.useFakeTimers();
			try {
				vi.setSystemTime(new Date(2025, 9, 13, 23, 30));
				const result = await handleCreateReceiptSplitTransaction(mockYnabAPI, {
					budget_id: "budget-123",
					account_id: "account-456",
					payee_name: "IKEA",
					receipt_tax: 0,
					receipt_total: 20,
					receipt_subtotal: 20,
					categories: [
						{
							category_id: "category-home",
							category_name: "Home",
							items: [{ name: "Lamp", amount: 20 }],
						},
					],
					dry_run: true,
				} satisfies CreateReceiptSplitTransactionParams);

				const parsed = JSON.parse(textOf(result.content[0]));
				expect(parsed.transaction_preview.date).toBe("2025-10-13");
			} finally {
				vi.useRealTimers();
				vi.unstubAllEnvs();
			}
		});

		it("should create a split transaction and attach receipt summary", async () => {
			(mockYnabAPI.transactions.createTransaction as any).mockResolvedValue({
				data: {
					transaction: mockSplitTransaction,
				},
			});
			(mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(
				mockAccountResponse,
			);

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				payee_name: "IKEA",
				memo: "Store receipt import",
				date: "2025-10-13",
				receipt_tax: 5,
				receipt_total: 55,
				categories: [
					{
						category_id: "category-home",
						category_name: "Home",
						items: [
							{ name: "Lamp", amount: 20 },
							{ name: "Shelf", amount: 10 },
						],
					},
					{
						category_id: "category-kitchen",
						category_name: "Kitchen",
						items: [{ name: "Pan", amount: 20 }],
					},
				],
				receipt_subtotal: 50,
			} satisfies CreateReceiptSplitTransactionParams;

			const result = await handleCreateReceiptSplitTransaction(
				mockYnabAPI,
				params,
			);

			expect(mockYnabAPI.transactions.createTransaction).toHaveBeenCalledTimes(
				1,
			);
			const callArgs = (mockYnabAPI.transactions.createTransaction as any).mock
				.calls[0];
			expect(callArgs[0]).toBe("budget-123");
			expect(callArgs[1].transaction.amount).toBe(-55000);
			expect(callArgs[1].transaction.subtransactions).toHaveLength(5);

			const parsed = JSON.parse(textOf(result.content[0]));
			expect(parsed.receipt_summary.total).toBe(55);
			const homeCategory = parsed.receipt_summary.categories.find(
				(category: any) => category.category_id === "category-home",
			);
			expect(homeCategory).toBeDefined();
			expect(homeCategory.tax).toBeCloseTo(3);
			expect(homeCategory.total).toBeCloseTo(33);
		});

		describe("Smart Collapse Logic", () => {
			describe("Scenario 1: Small Receipt (fewer than 5 items) - No Collapse", () => {
				it("should itemize each item individually with separate tax per category", async () => {
					// 3 items < 5, so no collapse
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Grocery Store",
						date: "2025-10-13",
						receipt_tax: 1.16,
						receipt_total: 15.63, // 14.47 + 1.16
						categories: [
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Milk", amount: 4.99 },
									{ name: "Bread", amount: 3.49 },
									{ name: "Eggs", amount: 5.99 },
								],
							},
						],
						receipt_subtotal: 14.47, // 4.99 + 3.49 + 5.99
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					expect(parsed.subtransactions).toHaveLength(4);
					// Each item should be separate and use live YNAB outflow signs
					expect(parsed.subtransactions[0].memo).toBe("Milk");
					expect(parsed.subtransactions[0].amount).toBe(-4.99);
					expect(parsed.subtransactions[1].memo).toBe("Bread");
					expect(parsed.subtransactions[1].amount).toBe(-3.49);
					expect(parsed.subtransactions[2].memo).toBe("Eggs");
					expect(parsed.subtransactions[2].amount).toBe(-5.99);
					// Tax separate
					expect(parsed.subtransactions[3].memo).toBe("Tax - Groceries");
					expect(parsed.subtransactions[3].amount).toBe(-1.16);
				});
			});

			describe("Scenario 2: Large Single-Category Receipt - Collapse Mode", () => {
				it("should collapse items into batches of max 5", async () => {
					// 12 items >= 5, so collapse mode
					// Subtotal: 4.99+3.49+5.99+10.99+2.99+6.47+4.0+2.01+3.0+3.98+5.0+3.02 = 55.93
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Grocery Store",
						date: "2025-10-13",
						receipt_tax: 4.15,
						receipt_total: 60.08, // 55.93 + 4.15
						categories: [
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Milk", amount: 4.99 },
									{ name: "Bread", amount: 3.49 },
									{ name: "Eggs", amount: 5.99 },
									{ name: "Cheese", amount: 10.99 },
									{ name: "Butter", amount: 2.99 },
									{ name: "Yogurt", amount: 6.47 },
									{ name: "Apples", amount: 4.0 },
									{ name: "Bananas", amount: 2.01 },
									{ name: "OJ", amount: 3.0 },
									{ name: "Cereal", amount: 3.98 },
									{ name: "Rice", amount: 5.0 },
									{ name: "Pasta", amount: 3.02 },
								],
							},
						],
						receipt_subtotal: 55.93,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Should have 4 subtransactions: 3 collapsed batches + 1 tax
					expect(parsed.subtransactions).toHaveLength(4);

					// First batch: 5 items
					expect(parsed.subtransactions[0].memo).toContain("Milk");
					expect(parsed.subtransactions[0].memo).toContain("Bread");
					expect(parsed.subtransactions[0].memo).toContain("Eggs");
					expect(parsed.subtransactions[0].memo).toContain("Cheese");
					expect(parsed.subtransactions[0].memo).toContain("Butter");
					expect(parsed.subtransactions[0].amount).toBe(-28.45); // 4.99 + 3.49 + 5.99 + 10.99 + 2.99

					// Second batch: next 5 items
					expect(parsed.subtransactions[1].memo).toContain("Yogurt");
					expect(parsed.subtransactions[1].memo).toContain("Apples");
					expect(parsed.subtransactions[1].memo).toContain("Bananas");
					expect(parsed.subtransactions[1].memo).toContain("OJ");
					expect(parsed.subtransactions[1].memo).toContain("Cereal");
					expect(parsed.subtransactions[1].amount).toBe(-19.46); // 6.47 + 4.00 + 2.01 + 3.00 + 3.98

					// Third batch: remaining 2 items
					expect(parsed.subtransactions[2].memo).toContain("Rice");
					expect(parsed.subtransactions[2].memo).toContain("Pasta");
					expect(parsed.subtransactions[2].amount).toBe(-8.02); // 5.00 + 3.02

					// Tax separate
					expect(parsed.subtransactions[3].memo).toBe("Tax - Groceries");
					expect(parsed.subtransactions[3].amount).toBe(-4.15);
				});
			});

			describe("Scenario 3: Mixed Receipt with Big Ticket Item", () => {
				it("should separate big ticket item, collapse remaining items", async () => {
					// TV is > $50 so big ticket (own subtransaction)
					// Remaining: 8 grocery items >= 5, so collapse
					// Groceries: 4.99+3.49+5.99+10.99+2.99+6.47+4.0+2.01 = 40.93
					// Subtotal: 500 + 40.93 = 540.93
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Electronics Store",
						date: "2025-10-13",
						receipt_tax: 43.19,
						receipt_total: 584.12, // 540.93 + 43.19
						categories: [
							{
								category_id: "category-electronics",
								category_name: "Electronics",
								items: [{ name: "TV", amount: 500.0 }],
							},
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Milk", amount: 4.99 },
									{ name: "Bread", amount: 3.49 },
									{ name: "Eggs", amount: 5.99 },
									{ name: "Cheese", amount: 10.99 },
									{ name: "Butter", amount: 2.99 },
									{ name: "Yogurt", amount: 6.47 },
									{ name: "Apples", amount: 4.0 },
									{ name: "Bananas", amount: 2.01 },
								],
							},
						],
						receipt_subtotal: 540.93,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Should have: 1 big ticket + 2 collapsed grocery batches + 2 tax subtransactions
					expect(parsed.subtransactions).toHaveLength(5);

					// Big ticket item first
					expect(parsed.subtransactions[0].memo).toBe("TV");
					expect(parsed.subtransactions[0].amount).toBe(-500);
					expect(parsed.subtransactions[0].category_id).toBe(
						"category-electronics",
					);

					// Collapsed grocery batch 1: 5 items
					expect(parsed.subtransactions[1].memo).toContain("Milk");
					expect(parsed.subtransactions[1].memo).toContain("Butter");
					expect(parsed.subtransactions[1].category_id).toBe(
						"category-groceries",
					);
					expect(parsed.subtransactions[1].amount).toBe(-28.45); // 4.99+3.49+5.99+10.99+2.99

					// Collapsed grocery batch 2: remaining 3 items
					expect(parsed.subtransactions[2].memo).toContain("Yogurt");
					expect(parsed.subtransactions[2].memo).toContain("Apples");
					expect(parsed.subtransactions[2].memo).toContain("Bananas");
					expect(parsed.subtransactions[2].category_id).toBe(
						"category-groceries",
					);
					expect(parsed.subtransactions[2].amount).toBe(-12.48); // 6.47+4.0+2.01

					// Tax for electronics (proportional)
					expect(parsed.subtransactions[3].memo).toBe("Tax - Electronics");
					expect(parsed.subtransactions[3].category_id).toBe(
						"category-electronics",
					);

					// Tax for groceries (proportional)
					expect(parsed.subtransactions[4].memo).toBe("Tax - Groceries");
					expect(parsed.subtransactions[4].category_id).toBe(
						"category-groceries",
					);
				});
			});

			describe("Scenario 4: Receipt with Return", () => {
				it("should separate return, collapse positive items, exclude return from tax", async () => {
					// Return is negative, gets own subtransaction
					// Groceries: 4.99+3.49+5.99+10.99+2.99+6.47+4.01 = 38.93 (7 items >= 5, collapse)
					// Subtotal: -29.99 + 38.93 = 8.94
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 2.79,
						receipt_total: 11.73, // 8.94 + 2.79
						categories: [
							{
								category_id: "category-electronics",
								category_name: "Electronics",
								items: [{ name: "RETURN: Broken headphones", amount: -29.99 }],
							},
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Milk", amount: 4.99 },
									{ name: "Bread", amount: 3.49 },
									{ name: "Eggs", amount: 5.99 },
									{ name: "Cheese", amount: 10.99 },
									{ name: "Butter", amount: 2.99 },
									{ name: "Yogurt", amount: 6.47 },
									{ name: "Apples", amount: 4.01 },
								],
							},
						],
						receipt_subtotal: 8.94, // -29.99 + 38.93
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Should have: 1 return + 2 collapsed grocery batches + 1 tax (groceries only)
					expect(parsed.subtransactions).toHaveLength(4);

					// Return first (positive subtransaction offsets the purchase)
					expect(parsed.subtransactions[0].memo).toBe(
						"RETURN: Broken headphones",
					);
					expect(parsed.subtransactions[0].amount).toBe(29.99);
					expect(parsed.subtransactions[0].category_id).toBe(
						"category-electronics",
					);

					// Collapsed grocery batch 1
					expect(parsed.subtransactions[1].memo).toContain("Milk");
					expect(parsed.subtransactions[1].category_id).toBe(
						"category-groceries",
					);

					// Collapsed grocery batch 2
					expect(parsed.subtransactions[2].memo).toContain("Yogurt");
					expect(parsed.subtransactions[2].category_id).toBe(
						"category-groceries",
					);

					// Tax only on groceries (return receives no tax)
					expect(parsed.subtransactions[3].memo).toBe("Tax - Groceries");
					expect(parsed.subtransactions[3].category_id).toBe(
						"category-groceries",
					);
					expect(parsed.subtransactions[3].amount).toBe(-2.79);
				});
			});

			describe("Scenario 5: Receipt with Discount", () => {
				it("should separate discount, collapse positive items, calculate tax on positive only", async () => {
					// Discount: -5.0 (negative, gets own subtransaction)
					// Positive: 4.99+3.49+5.99+10.99+2.99+6.47+4.0+2.01+3.0 = 43.93 (9 items >= 5, collapse)
					// Subtotal: -5.0 + 43.93 = 38.93
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Grocery Store",
						date: "2025-10-13",
						receipt_tax: 3.19,
						receipt_total: 42.12, // 38.93 + 3.19
						categories: [
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Member discount", amount: -5.0 },
									{ name: "Milk", amount: 4.99 },
									{ name: "Bread", amount: 3.49 },
									{ name: "Eggs", amount: 5.99 },
									{ name: "Cheese", amount: 10.99 },
									{ name: "Butter", amount: 2.99 },
									{ name: "Yogurt", amount: 6.47 },
									{ name: "Apples", amount: 4.0 },
									{ name: "Bananas", amount: 2.01 },
									{ name: "OJ", amount: 3.0 },
								],
							},
						],
						receipt_subtotal: 38.93, // -5.0 + 43.93
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Should have: 1 discount + 2 collapsed batches + 1 tax
					expect(parsed.subtransactions).toHaveLength(4);

					// Discount first (positive subtransaction offsets the purchase)
					expect(parsed.subtransactions[0].memo).toBe("Member discount");
					expect(parsed.subtransactions[0].amount).toBe(5);
					expect(parsed.subtransactions[0].category_id).toBe(
						"category-groceries",
					);

					// Collapsed batch 1 (5 items)
					expect(parsed.subtransactions[1].memo).toContain("Milk");
					expect(parsed.subtransactions[1].memo).toContain("Butter");
					expect(parsed.subtransactions[1].amount).toBe(-28.45); // 4.99+3.49+5.99+10.99+2.99

					// Collapsed batch 2 (4 items)
					expect(parsed.subtransactions[2].memo).toContain("Yogurt");
					expect(parsed.subtransactions[2].memo).toContain("OJ");
					expect(parsed.subtransactions[2].amount).toBe(-15.48); // 6.47+4.0+2.01+3.0

					// Tax only on positive items (not reduced by discount)
					expect(parsed.subtransactions[3].memo).toBe("Tax - Groceries");
					expect(parsed.subtransactions[3].amount).toBe(-3.19);
				});
			});

			describe("Scenario 6: Quantity Items (Not Big Ticket)", () => {
				it("should treat quantity items by unit price, not line total", async () => {
					// Widget: amount=90 (line total), quantity=3, so unit price = 90/3 = $30 < $50 (not big ticket)
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 13.5,
						receipt_total: 148.5, // 135 + 13.5
						categories: [
							{
								category_id: "category-electronics",
								category_name: "Electronics",
								items: [
									{ name: "Widget", amount: 90.0, quantity: 3 }, // line total $90, unit price $30 < $50
								],
							},
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Milk", amount: 10.0 },
									{ name: "Bread", amount: 10.0 },
									{ name: "Eggs", amount: 10.0 },
									{ name: "Cheese", amount: 15.0 },
								],
							},
						],
						receipt_subtotal: 135.0, // 90 + 45
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Total items: 1 widget entry + 4 groceries = 5 items -> collapse mode (>= 5)
					// Widget has unit price $30 < $50, so NOT big ticket
					// Should have: 1 collapsed electronics + 1 collapsed groceries + 2 tax
					expect(parsed.subtransactions).toHaveLength(4);

					// Widgets collapsed (single entry with quantity shown)
					expect(parsed.subtransactions[0].memo).toContain("Widget");
					expect(parsed.subtransactions[0].amount).toBe(-90);
					expect(parsed.subtransactions[0].category_id).toBe(
						"category-electronics",
					);

					// Groceries collapsed
					expect(parsed.subtransactions[1].memo).toContain("Milk");
					expect(parsed.subtransactions[1].memo).toContain("Cheese");
					expect(parsed.subtransactions[1].amount).toBe(-45);
					expect(parsed.subtransactions[1].category_id).toBe(
						"category-groceries",
					);

					// Tax for electronics
					expect(parsed.subtransactions[2].memo).toBe("Tax - Electronics");
					expect(parsed.subtransactions[2].category_id).toBe(
						"category-electronics",
					);

					// Tax for groceries
					expect(parsed.subtransactions[3].memo).toBe("Tax - Groceries");
					expect(parsed.subtransactions[3].category_id).toBe(
						"category-groceries",
					);
				});
			});

			describe("Scenario 7: Tax Refund Scenario", () => {
				it("should create a single tax refund subtransaction for negative tax", async () => {
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: -8.0,
						receipt_total: -108.0,
						categories: [
							{
								category_id: "category-electronics",
								category_name: "Electronics",
								items: [{ name: "RETURN: Defective laptop", amount: -100.0 }],
							},
						],
						receipt_subtotal: -100.0,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Should have: 1 return + 1 tax refund
					expect(parsed.subtransactions).toHaveLength(2);

					// Return (positive subtransaction offsets the purchase)
					expect(parsed.subtransactions[0].memo).toBe(
						"RETURN: Defective laptop",
					);
					expect(parsed.subtransactions[0].amount).toBe(100);
					expect(parsed.subtransactions[0].category_id).toBe(
						"category-electronics",
					);

					// Tax refund (positive subtransaction offsets the purchase)
					expect(parsed.subtransactions[1].memo).toBe("Tax refund");
					expect(parsed.subtransactions[1].amount).toBe(8);
					expect(parsed.subtransactions[1].category_id).toBe(
						"category-electronics",
					);
				});
			});

			describe("Edge Cases", () => {
				it("should handle zero tax (no tax subtransactions)", async () => {
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 0,
						receipt_total: 30.0,
						categories: [
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Item1", amount: 10.0 },
									{ name: "Item2", amount: 10.0 },
									{ name: "Item3", amount: 10.0 },
								],
							},
						],
						receipt_subtotal: 30.0,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Should have 3 itemized items, no tax
					expect(parsed.subtransactions).toHaveLength(3);
					expect(
						parsed.subtransactions.every((s: any) => !s.memo.includes("Tax")),
					).toBe(true);
				});

				it("should handle single category with exactly 5 items (should collapse)", async () => {
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 4.0,
						receipt_total: 54.0,
						categories: [
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Item1", amount: 10.0 },
									{ name: "Item2", amount: 10.0 },
									{ name: "Item3", amount: 10.0 },
									{ name: "Item4", amount: 10.0 },
									{ name: "Item5", amount: 10.0 },
								],
							},
						],
						receipt_subtotal: 50.0,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Should have 2 subtransactions: 1 collapsed batch + 1 tax
					expect(parsed.subtransactions).toHaveLength(2);
					expect(parsed.subtransactions[0].memo).toContain("Item1");
					expect(parsed.subtransactions[0].memo).toContain("Item5");
					expect(parsed.subtransactions[1].memo).toBe("Tax - Groceries");
				});

				it("should handle single category with exactly 4 items (should NOT collapse)", async () => {
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 4.0,
						receipt_total: 44.0,
						categories: [
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Item1", amount: 10.0 },
									{ name: "Item2", amount: 10.0 },
									{ name: "Item3", amount: 10.0 },
									{ name: "Item4", amount: 10.0 },
								],
							},
						],
						receipt_subtotal: 40.0,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Should have 5 subtransactions: 4 itemized + 1 tax
					expect(parsed.subtransactions).toHaveLength(5);
					expect(parsed.subtransactions[0].memo).toBe("Item1");
					expect(parsed.subtransactions[1].memo).toBe("Item2");
					expect(parsed.subtransactions[2].memo).toBe("Item3");
					expect(parsed.subtransactions[3].memo).toBe("Item4");
					expect(parsed.subtransactions[4].memo).toBe("Tax - Groceries");
				});

				it("should handle mixed categories with consistency rule (all collapse)", async () => {
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 10.0,
						receipt_total: 100.0, // 90 subtotal + 10 tax
						categories: [
							{
								category_id: "category-electronics",
								category_name: "Electronics",
								items: [
									{ name: "Item1", amount: 20.0 },
									{ name: "Item2", amount: 20.0 },
								],
							},
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: "Milk", amount: 10.0 },
									{ name: "Bread", amount: 10.0 },
									{ name: "Eggs", amount: 10.0 },
									{ name: "Cheese", amount: 10.0 },
									{ name: "Butter", amount: 10.0 },
								],
							},
						],
						receipt_subtotal: 90.0, // 40 + 50
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Total: 7 items -> collapse mode
					// All categories should collapse (consistency rule)
					// Should have: 1 collapsed electronics + 1 collapsed groceries + 2 tax
					expect(parsed.subtransactions).toHaveLength(4);

					// Electronics collapsed even though it only has 2 items
					expect(parsed.subtransactions[0].memo).toContain("Item1");
					expect(parsed.subtransactions[0].memo).toContain("Item2");
					expect(parsed.subtransactions[0].category_id).toBe(
						"category-electronics",
					);

					// Groceries collapsed
					expect(parsed.subtransactions[1].memo).toContain("Milk");
					expect(parsed.subtransactions[1].category_id).toBe(
						"category-groceries",
					);

					// Taxes
					expect(parsed.subtransactions[2].memo).toBe("Tax - Electronics");
					expect(parsed.subtransactions[3].memo).toBe("Tax - Groceries");
				});

				it("should truncate long memos at 150 chars with ellipsis", async () => {
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 5.0,
						receipt_total: 55.0,
						categories: [
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{
										name: "Very Long Item Name That Will Definitely Cause Truncation",
										amount: 10.0,
									},
									{
										name: "Another Very Long Item Name To Exceed Character Limit",
										amount: 10.0,
									},
									{ name: "Third Very Long Item Name Here", amount: 10.0 },
									{ name: "Fourth Very Long Item Name", amount: 10.0 },
									{ name: "Fifth Very Long Item Name", amount: 10.0 },
								],
							},
						],
						receipt_subtotal: 50.0,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					expect(parsed.subtransactions).toHaveLength(2);
					const collapsedMemo = parsed.subtransactions[0].memo;
					expect(collapsedMemo.length).toBeLessThanOrEqual(153); // 150 + "..."
					if (collapsedMemo.length > 150) {
						expect(collapsedMemo.endsWith("...")).toBe(true);
					}
				});

				it("should detect big ticket by unit price > $50 (not line total)", async () => {
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 10.0,
						receipt_total: 110.0,
						categories: [
							{
								category_id: "category-electronics",
								category_name: "Electronics",
								items: [
									{ name: "Expensive Gadget", amount: 75.0 }, // Unit price $75 > $50 -> big ticket
									{ name: "Cheap Item", amount: 5.0 },
									{ name: "Cheap Item2", amount: 5.0 },
									{ name: "Cheap Item3", amount: 5.0 },
									{ name: "Cheap Item4", amount: 5.0 },
									{ name: "Cheap Item5", amount: 5.0 },
								],
							},
						],
						receipt_subtotal: 100.0,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Big ticket separate + collapsed remaining items + tax
					expect(parsed.subtransactions.length).toBeGreaterThanOrEqual(3);

					// First should be the big ticket item (not collapsed)
					expect(parsed.subtransactions[0].memo).toBe("Expensive Gadget");
					expect(parsed.subtransactions[0].amount).toBe(-75);

					// Remaining 5 items should collapse
					const collapsedSub = parsed.subtransactions[1];
					expect(collapsedSub.memo).toContain("Cheap Item");
					expect(collapsedSub.amount).toBe(-25);
				});

				it("should truncate single very long item name in itemized mode", async () => {
					// Create a name that's way longer than 150 chars
					const veryLongName = "A".repeat(200);
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 1.0,
						receipt_total: 11.0,
						categories: [
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [{ name: veryLongName, amount: 10.0 }],
							},
						],
						receipt_subtotal: 10.0,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// Should have 2 subtransactions: 1 itemized + 1 tax
					// (only 1 item, so no collapse, but name gets truncated)
					expect(parsed.subtransactions).toHaveLength(2);

					const itemMemo = parsed.subtransactions[0].memo;
					// Memo should be truncated to exactly 150 chars
					expect(itemMemo.length).toBeLessThanOrEqual(150);
					// Should contain truncation indicator
					expect(itemMemo).toContain("...");
					// Should start with part of the original name
					expect(itemMemo.startsWith("AAA")).toBe(true);
				});

				it("should truncate very long item name in collapsed mode while preserving amount", async () => {
					// Create a name that's way longer than 150 chars
					const veryLongName = "B".repeat(200);
					const params = {
						budget_id: "budget-123",
						account_id: "account-456",
						payee_name: "Store",
						date: "2025-10-13",
						receipt_tax: 1.0,
						receipt_total: 61.0,
						categories: [
							{
								category_id: "category-groceries",
								category_name: "Groceries",
								items: [
									{ name: veryLongName, amount: 10.0 }, // This one has very long name
									{ name: "Item2", amount: 10.0 },
									{ name: "Item3", amount: 10.0 },
									{ name: "Item4", amount: 10.0 },
									{ name: "Item5", amount: 10.0 },
									{ name: "Item6", amount: 10.0 },
								],
							},
						],
						receipt_subtotal: 60.0,
						dry_run: true,
					} satisfies CreateReceiptSplitTransactionParams;

					const result = await handleCreateReceiptSplitTransaction(
						mockYnabAPI,
						params,
					);
					const parsed = JSON.parse(textOf(result.content[0]));

					// 6 items -> collapse mode, long item first creates its own subtransaction
					// that gets truncated
					expect(parsed.subtransactions.length).toBeGreaterThanOrEqual(2);

					// First subtransaction should be the truncated long item
					const firstMemo = parsed.subtransactions[0].memo;
					expect(firstMemo.length).toBeLessThanOrEqual(150);
					// In collapsed mode, should preserve the amount
					expect(firstMemo).toContain("$10.00");
					// Should contain truncation indicator
					expect(firstMemo).toContain("...");
					// Should start with part of the original name
					expect(firstMemo.startsWith("BBB")).toBe(true);
				});
			});
		});
	});

	describe("UpdateTransactionSchema", () => {
		it("should validate valid parameters with minimal fields", () => {
			const validParams = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				amount: -60000, // Updated amount
			};

			const result = UpdateTransactionSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		it("should validate valid parameters with all optional fields", () => {
			const validParams = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				account_id: "account-789",
				amount: -60000,
				date: "2024-01-02",
				payee_name: "Updated Payee",
				payee_id: "payee-999",
				category_id: "category-202",
				memo: "Updated memo",
				cleared: "reconciled" as const,
				approved: false,
				flag_color: "blue" as const,
			};

			const result = UpdateTransactionSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		it("should allow missing budget_id for default resolution", () => {
			const paramsWithoutBudget = {
				transaction_id: "transaction-456",
				amount: -60000,
			};

			const result = UpdateTransactionSchema.safeParse(paramsWithoutBudget);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.budget_id).toBeUndefined();
			}
		});

		it("should require transaction_id", () => {
			const invalidParams = {
				budget_id: "budget-123",
				amount: -60000,
			};

			const result = UpdateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});

		it("should require amount to be an integer when provided", () => {
			const invalidParams = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				amount: -600.5, // Decimal not allowed
			};

			const result = UpdateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.message).toContain(
					"Amount must be an integer in milliunits",
				);
			}
		});

		it("should validate date format when provided", () => {
			const invalidParams = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				date: "01/02/2024", // Invalid format
			};

			const result = UpdateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.message).toContain(
					"Date must be in ISO format",
				);
			}
		});

		it("should validate cleared status enum when provided", () => {
			const invalidParams = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				cleared: "invalid-status",
			};

			const result = UpdateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});

		it("should validate flag_color enum when provided", () => {
			const invalidParams = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				flag_color: "invalid-color",
			};

			const result = UpdateTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});
	});

	describe("handleUpdateTransaction", () => {
		const mockUpdatedTransaction = {
			id: "transaction-456",
			date: "2024-01-02",
			amount: -60000,
			memo: "Updated memo",
			cleared: "reconciled" as any,
			approved: false,
			flag_color: "blue" as any,
			account_id: "account-789",
			payee_id: "payee-999",
			category_id: "category-202",
			transfer_account_id: null,
			transfer_transaction_id: null,
			matched_transaction_id: null,
			import_id: null,
			deleted: false,
		};

		const mockOriginalTransaction = {
			id: "transaction-456",
			account_id: "account-123",
			amount: -50000,
			date: "2024-01-01",
			memo: "Original memo",
		};

		beforeEach(() => {
			(mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue({
				data: { transaction: mockOriginalTransaction },
			});
		});

		it("should update transaction with single field", async () => {
			const mockResponse = {
				data: {
					transaction: mockUpdatedTransaction,
				},
			};

			const mockAccountResponse = {
				data: {
					account: {
						id: "account-789",
						balance: 150000,
						cleared_balance: 140000,
					},
				},
			};

			(mockYnabAPI.transactions.updateTransaction as any).mockResolvedValue(
				mockResponse,
			);
			(mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(
				mockAccountResponse,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				amount: -60000,
			};
			const result = await handleUpdateTransaction(mockYnabAPI, params);

			expect(mockYnabAPI.transactions.updateTransaction).toHaveBeenCalledWith(
				"budget-123",
				"transaction-456",
				{
					transaction: {
						amount: -60000,
					},
				},
			);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.transaction.id).toBe("transaction-456");
			expect(response.transaction.amount).toBe(-60);
		});

		it("converts a transaction to a split in place", async () => {
			const subtransactions = [
				{ amount: -40000, category_id: "category-1", memo: "First" },
				{ amount: -20000, category_id: "category-2", memo: "Second" },
			];
			(mockYnabAPI.transactions.updateTransaction as any).mockResolvedValue({
				data: {
					transaction: {
						...mockUpdatedTransaction,
						category_id: null,
						subtransactions: subtransactions.map((subtransaction, index) => ({
							...subtransaction,
							id: `sub-${index + 1}`,
							transaction_id: "transaction-456",
							deleted: false,
						})),
					},
				},
			});
			(mockYnabAPI.accounts.getAccountById as any).mockResolvedValue({
				data: {
					account: {
						id: "account-789",
						balance: 150000,
						cleared_balance: 140000,
					},
				},
			});

			const result = await handleUpdateTransaction(mockYnabAPI, {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				amount: -60000,
				subtransactions,
			});

			expect(mockYnabAPI.transactions.updateTransaction).toHaveBeenCalledWith(
				"budget-123",
				"transaction-456",
				{
					transaction: {
						amount: -60000,
						subtransactions,
					},
				},
			);
			const response = JSON.parse(textOf(result.content[0]));
			expect(response.transaction.subtransactions[0].amount).toBe(-40);
			expect(response.transaction.subtransactions[1].amount).toBe(-20);
		});

		it("should update transaction with multiple fields", async () => {
			const mockResponse = {
				data: {
					transaction: mockUpdatedTransaction,
				},
			};

			const mockAccountResponse = {
				data: {
					account: {
						id: "account-789",
						balance: 150000,
						cleared_balance: 140000,
					},
				},
			};

			(mockYnabAPI.transactions.updateTransaction as any).mockResolvedValue(
				mockResponse,
			);
			(mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(
				mockAccountResponse,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				account_id: "account-789",
				amount: -60000,
				date: "2024-01-02",
				memo: "Updated memo",
				cleared: "reconciled" as const,
				approved: false,
				flag_color: "blue" as const,
			};
			const result = await handleUpdateTransaction(mockYnabAPI, params);

			expect(mockYnabAPI.transactions.updateTransaction).toHaveBeenCalledWith(
				"budget-123",
				"transaction-456",
				{
					transaction: {
						account_id: "account-789",
						amount: -60000,
						date: "2024-01-02",
						memo: "Updated memo",
						cleared: "reconciled",
						approved: false,
						flag_color: "blue",
					},
				},
			);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.transaction.id).toBe("transaction-456");
		});

		it("should handle 404 not found errors", async () => {
			const error = new Error("404 Not Found");
			(mockYnabAPI.transactions.updateTransaction as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "invalid-transaction",
				amount: -60000,
			};
			const result = await handleUpdateTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Budget, account, category, or transaction not found",
			);
		});

		it("should handle authentication errors", async () => {
			const error = new Error("401 Unauthorized");
			(mockYnabAPI.transactions.updateTransaction as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				amount: -60000,
			};
			const result = await handleUpdateTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Invalid or expired YNAB access token",
			);
		});

		it("should handle generic errors", async () => {
			const error = new Error("Network error");
			(mockYnabAPI.transactions.updateTransaction as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
				amount: -60000,
			};
			const result = await handleUpdateTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe("Failed to update transaction");
		});
	});

	describe("DeleteTransactionSchema", () => {
		it("should validate valid parameters", () => {
			const validParams = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
			};

			const result = DeleteTransactionSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		it("should allow missing budget_id for default resolution", () => {
			const paramsWithoutBudget = {
				transaction_id: "transaction-456",
			};

			const result = DeleteTransactionSchema.safeParse(paramsWithoutBudget);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.budget_id).toBeUndefined();
			}
		});

		it("should require transaction_id", () => {
			const invalidParams = {
				budget_id: "budget-123",
			};

			const result = DeleteTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.code).toBe("invalid_type");
				expect(result.error.issues[0]!.path).toEqual(["transaction_id"]);
			}
		});

		it("should reject empty strings", () => {
			const invalidParams = {
				budget_id: "",
				transaction_id: "",
			};

			const result = DeleteTransactionSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});
	});

	describe("CreateTransactionsSchema", () => {
		const buildTransaction = (overrides: Record<string, unknown> = {}) => ({
			account_id: "account-123",
			amount: -5000,
			date: "2024-01-01",
			memo: "Bulk entry",
			...overrides,
		});

		it("should accept a valid batch of multiple transactions", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [
					buildTransaction(),
					buildTransaction({ account_id: "account-456" }),
				],
			};
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.transactions).toHaveLength(2);
			}
		});

		it("should accept the minimum batch size of one transaction", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildTransaction()],
			};
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(true);
		});

		it("should accept the maximum batch size of 100 transactions", () => {
			const hundred = Array.from({ length: 100 }, (_, index) =>
				buildTransaction({ import_id: `YNAB:-5000:2024-01-01:${index + 1}` }),
			);
			const params = { budget_id: "budget-123", transactions: hundred };
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(true);
		});

		it("should reject an empty transactions array", () => {
			const params = { budget_id: "budget-123", transactions: [] as unknown[] };
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.message).toContain(
					"At least one transaction is required",
				);
			}
		});

		it("should reject batches exceeding 100 transactions", () => {
			const overLimit = Array.from({ length: 101 }, () => buildTransaction());
			const result = CreateTransactionsSchema.safeParse({
				budget_id: "budget-123",
				transactions: overLimit,
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.message).toContain(
					"A maximum of 100 transactions",
				);
			}
		});

		it("should reject transactions missing required fields", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildTransaction({ account_id: undefined })],
			};
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.path).toEqual([
					"transactions",
					0,
					"account_id",
				]);
			}
		});

		it("should validate ISO date format for each transaction", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildTransaction({ date: "01/01/2024" })],
			};
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.path).toEqual([
					"transactions",
					0,
					"date",
				]);
			}
		});

		it("should require integer milliunit amounts", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildTransaction({ amount: -50.25 })],
			};
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.path).toEqual([
					"transactions",
					0,
					"amount",
				]);
			}
		});

		it("should reject invalid cleared enum values", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildTransaction({ cleared: "pending" })],
			};
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
		});

		it("should reject transactions containing subtransactions", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [
					buildTransaction({ subtransactions: [{ amount: -2500 }] }),
				],
			};
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				const issue = result.error.issues.find(
					(i) => i.code === "unrecognized_keys",
				);
				expect(issue).toBeDefined();
				expect((issue as any)?.keys).toContain("subtransactions");
			}
		});

		it("should fail when any transaction in the batch is invalid", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [
					buildTransaction(),
					buildTransaction({ amount: "invalid" }),
				],
			};
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
		});

		it("should accept optional import_id values", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [
					buildTransaction({ import_id: "YNAB:-5000:2024-01-01:1" }),
				],
			};
			const result = CreateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.transactions[0]!.import_id).toBe(
					"YNAB:-5000:2024-01-01:1",
				);
			}
		});
	});

	describe("handleDeleteTransaction", () => {
		const mockDeletedTransaction: ynab.TransactionDetail = {
			id: "transaction-456",
			deleted: true,
			account_id: "account-456",
			account_name: "Checking",
			date: "2024-01-15",
			amount: -5000,
			cleared: "cleared",
			approved: true,
			category_id: "category-789",
			debt_transaction_type: null,
			subtransactions: [],
		};

		it("should delete transaction successfully", async () => {
			const mockResponse = {
				data: {
					transaction: mockDeletedTransaction,
					server_knowledge: 12345,
				},
			};

			const mockAccountResponse = {
				data: {
					account: {
						id: "account-456",
						balance: 50000,
						cleared_balance: 45000,
					},
				},
			};

			(mockYnabAPI.transactions.deleteTransaction as any).mockResolvedValue(
				mockResponse,
			);
			(mockYnabAPI.accounts.getAccountById as any).mockResolvedValue(
				mockAccountResponse,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
			};
			const result = await handleDeleteTransaction(mockYnabAPI, params);

			expect(mockYnabAPI.transactions.deleteTransaction).toHaveBeenCalledWith(
				"budget-123",
				"transaction-456",
			);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.message).toBe("Transaction deleted successfully");
			expect(response.transaction.id).toBe("transaction-456");
			expect(response.transaction.deleted).toBe(true);
		});

		it("should handle 404 not found errors", async () => {
			const error = new Error("404 Not Found");
			(mockYnabAPI.transactions.deleteTransaction as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "invalid-transaction",
			};
			const result = await handleDeleteTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Budget, account, category, or transaction not found",
			);
		});

		it("should handle authentication errors", async () => {
			const error = new Error("401 Unauthorized");
			(mockYnabAPI.transactions.deleteTransaction as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
			};
			const result = await handleDeleteTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe(
				"Invalid or expired YNAB access token",
			);
		});

		it("should handle generic errors", async () => {
			const error = new Error("Network error");
			(mockYnabAPI.transactions.deleteTransaction as any).mockRejectedValue(
				error,
			);

			const params = {
				budget_id: "budget-123",
				transaction_id: "transaction-456",
			};
			const result = await handleDeleteTransaction(mockYnabAPI, params);

			const response = JSON.parse(textOf(result.content[0]));
			expect(response.error.message).toBe("Failed to delete transaction");
		});
	});

	describe("handleCreateTransactions", () => {
		let transactionCounter = 0;

		const buildTransaction = (
			overrides: Partial<BulkTransactionInput> = {},
		): BulkTransactionInput => ({
			account_id: "account-001",
			amount: -1500,
			date: "2024-01-01",
			memo: "Bulk test",
			cleared: "cleared",
			approved: true,
			...overrides,
		});

		const buildParams = (
			overrides: Partial<CreateTransactionsParams> = {},
		): CreateTransactionsParams => ({
			budget_id: "budget-123",
			transactions: [buildTransaction()],
			...overrides,
		});

		const buildApiTransaction = (overrides: Record<string, unknown> = {}) => ({
			id: overrides["id"] ?? `transaction-${++transactionCounter}`,
			account_id: overrides["account_id"] ?? "account-001",
			date: overrides["date"] ?? "2024-01-01",
			amount: overrides["amount"] ?? -1500,
			memo: overrides["memo"] ?? "Bulk test",
			cleared: overrides["cleared"] ?? "cleared",
			approved: overrides["approved"] ?? true,
			flag_color: overrides["flag_color"] ?? null,
			account_name: overrides["account_name"] ?? "Checking",
			payee_id: overrides["payee_id"] ?? null,
			payee_name: overrides["payee_name"] ?? null,
			category_id: overrides["category_id"] ?? null,
			category_name: overrides["category_name"] ?? null,
			transfer_account_id: overrides["transfer_account_id"] ?? null,
			transfer_transaction_id: overrides["transfer_transaction_id"] ?? null,
			matched_transaction_id: overrides["matched_transaction_id"] ?? null,
			import_id: overrides["import_id"] ?? null,
			deleted: overrides["deleted"] ?? false,
			subtransactions: [],
		});

		const buildApiResponse = (
			transactions: Record<string, unknown>[],
			extras: Record<string, unknown> = {},
		) => ({
			data: {
				transaction_ids: transactions.map((txn) => String(txn["id"])),
				transactions,
				duplicate_import_ids: extras["duplicate_import_ids"] ?? [],
				server_knowledge: extras["server_knowledge"] ?? 1,
			},
		});

		const parseResponse = async (
			resultPromise: ReturnType<typeof handleCreateTransactions>,
		) => {
			const result = await resultPromise;
			const text = maybeTextOf(result.content?.[0]) ?? "{}";
			return JSON.parse(text) as Record<string, any>;
		};

		beforeEach(() => {
			transactionCounter = 0;
			(mockYnabAPI.transactions.createTransactions as any).mockReset();
		});

		describe("dry run", () => {
			it("returns validation summary without calling the API", async () => {
				const params = buildParams({
					dry_run: true,
					transactions: [
						buildTransaction({ amount: -2000, account_id: "account-foo" }),
						buildTransaction({
							amount: -1000,
							account_id: "account-bar",
							date: "2024-02-15",
						}),
					],
				});

				const response = await parseResponse(
					handleCreateTransactions(mockYnabAPI, params),
				);

				expect(
					mockYnabAPI.transactions.createTransactions,
				).not.toHaveBeenCalled();
				expect(response["dry_run"]).toBe(true);
				expect(response["summary"].total_transactions).toBe(2);
				expect(response["summary"].accounts_affected).toEqual([
					"account-foo",
					"account-bar",
				]);
				expect(response["transactions_preview"]).toHaveLength(2);
			});

			it("surfaces validation errors before execution", async () => {
				const invalidParams = buildParams({
					transactions: [
						// @ts-expect-error -- account_id is missing on purpose
						{
							amount: -2000,
							date: "2024-01-01",
						},
					],
				});

				const result = await handleCreateTransactions(
					mockYnabAPI,
					invalidParams as any,
				);
				const parsed = JSON.parse(maybeTextOf(result.content?.[0]) ?? "{}");
				expect(parsed.error).toBeDefined();
				expect(parsed.error.message).toContain("validation failed");
				expect(
					mockYnabAPI.transactions.createTransactions,
				).not.toHaveBeenCalled();
			});
		});

		describe("successful creation", () => {
			it("creates a small batch with import_ids and correlates results", async () => {
				const transactions = [
					buildTransaction({ import_id: "YNAB:-1500:2024-01-01:1" }),
					buildTransaction({
						account_id: "account-002",
						amount: -2500,
						import_id: "YNAB:-2500:2024-01-02:1",
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

				const response = await parseResponse(
					handleCreateTransactions(
						mockYnabAPI,
						buildParams({
							transactions,
						}),
					),
				);

				expect(response["summary"].created).toBe(2);
				expect(response["results"]).toHaveLength(2);
				expect(
					response["results"].every(
						(result: any) => result.status === "created",
					),
				).toBe(true);
				// Cache invalidation now uses individual delete calls, not deleteMany
			});

			it("correlates transactions without import_ids using hashes", async () => {
				const batch = [
					buildTransaction({ memo: "Hash me" }),
					buildTransaction({ memo: "Hash me", date: "2024-01-02" }),
				];
				const apiTransactions = batch.map((txn, index) =>
					buildApiTransaction({ ...txn, id: `hash-${index + 1}` }),
				);
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);

				const response = await parseResponse(
					handleCreateTransactions(
						mockYnabAPI,
						buildParams({ transactions: batch }),
					),
				);
				expect(
					response["results"].map((result: any) => result.transaction_id),
				).toEqual(["hash-1", "hash-2"]);
			});

			it("handles mixed import_id and hash correlation scenarios", async () => {
				const batch = [
					buildTransaction({ import_id: "YNAB:-1500:2024-01-01:mix" }),
					buildTransaction({ memo: "no id" }),
				];
				const apiTransactions = [
					buildApiTransaction({ ...batch[0], id: "mix-1" }),
					buildApiTransaction({ ...batch[1], id: "mix-2" }),
				];
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);

				const response = await parseResponse(
					handleCreateTransactions(
						mockYnabAPI,
						buildParams({ transactions: batch }),
					),
				);
				expect(
					response["results"].find((r: any) => r.transaction_id === "mix-1")
						?.status,
				).toBe("created");
				expect(
					response["results"].find((r: any) => r.transaction_id === "mix-2")
						?.status,
				).toBe("created");
			});
		});

		describe("duplicate handling", () => {
			it("marks all transactions as duplicates when import_ids already exist", async () => {
				const batch = [
					buildTransaction({ import_id: "dup-1" }),
					buildTransaction({ import_id: "dup-2" }),
				];
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue({
					data: {
						transaction_ids: [],
						transactions: [],
						duplicate_import_ids: ["dup-1", "dup-2"],
						server_knowledge: 5,
					},
				});

				const response = await parseResponse(
					handleCreateTransactions(
						mockYnabAPI,
						buildParams({ transactions: batch }),
					),
				);

				expect(response["summary"].duplicates).toBe(2);
				expect(
					response["results"].every(
						(result: any) => result.status === "duplicate",
					),
				).toBe(true);
			});

			it("marks partial duplicates while creating the rest", async () => {
				const batch = [
					buildTransaction({ import_id: "dup-1" }),
					buildTransaction({ import_id: "new-1", memo: "fresh" }),
				];
				const apiTransactions = [
					buildApiTransaction({ ...batch[1], id: "created-new" }),
				];
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue({
					data: {
						transaction_ids: ["created-new"],
						transactions: apiTransactions,
						duplicate_import_ids: ["dup-1"],
						server_knowledge: 10,
					},
				});

				const response = await parseResponse(
					handleCreateTransactions(
						mockYnabAPI,
						buildParams({ transactions: batch }),
					),
				);

				const duplicateResult = response["results"].find(
					(result: any) => result.correlation_key === "dup-1",
				);
				const createdResult = response["results"].find(
					(result: any) => result.transaction_id === "created-new",
				);
				expect(duplicateResult?.status).toBe("duplicate");
				expect(createdResult?.status).toBe("created");
			});
		});

		describe("response size management", () => {
			it("keeps full response when under 64KB", async () => {
				const apiTransactions = [buildApiTransaction()];
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);
				const response = await parseResponse(
					handleCreateTransactions(mockYnabAPI, buildParams()),
				);
				expect(response["transactions"]).toBeDefined();
				expect(response["mode"]).toBe("full");
			});

			it("downgrades to summary mode when response exceeds 64KB", async () => {
				const byteSpy = vi.spyOn(Buffer, "byteLength");
				byteSpy
					.mockImplementationOnce(() => 70 * 1024)
					.mockImplementationOnce(() => 80 * 1024);
				const apiTransactions = [buildApiTransaction()];
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);

				const response = await parseResponse(
					handleCreateTransactions(mockYnabAPI, buildParams()),
				);

				expect(response["transactions"]).toBeUndefined();
				expect(response["mode"]).toBe("summary");
				byteSpy.mockRestore();
			});

			it("downgrades to ids_only mode when necessary", async () => {
				const byteSpy = vi.spyOn(Buffer, "byteLength");
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

				expect(response["mode"]).toBe("ids_only");
				expect(response["results"][0].transaction_id).toBeDefined();
				byteSpy.mockRestore();
			});

			it("returns a completed batch receipt when result details cannot fit under 100KB", async () => {
				const byteSpy = vi.spyOn(Buffer, "byteLength");
				byteSpy
					.mockImplementationOnce(() => 90 * 1024)
					.mockImplementationOnce(() => 99 * 1024)
					.mockImplementationOnce(() => 101 * 1024);
				const apiTransactions = [buildApiTransaction()];
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);

				const result = await handleCreateTransactions(
					mockYnabAPI,
					buildParams(),
				);
				const parsed = JSON.parse(maybeTextOf(result.content?.[0]) ?? "{}");
				expect(result.isError).not.toBe(true);
				expect(parsed.summary.created).toBe(1);
				expect(parsed.results).toEqual([]);
				expect(parsed.results_omitted).toBe(true);
				expect(parsed.message).toContain("Batch processed");
				byteSpy.mockRestore();
			});
		});

		describe("correlation edge cases", () => {
			it("supports multi-bucket matching for identical transactions", async () => {
				const batch = [
					buildTransaction({ memo: "repeat" }),
					buildTransaction({ memo: "repeat" }),
					buildTransaction({ memo: "repeat" }),
				];
				const apiTransactions = batch.map((txn, index) =>
					buildApiTransaction({ ...txn, id: `repeat-${index + 1}` }),
				);
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);

				const response = await parseResponse(
					handleCreateTransactions(
						mockYnabAPI,
						buildParams({ transactions: batch }),
					),
				);

				expect(response["results"].map((r: any) => r.request_index)).toEqual([
					0, 1, 2,
				]);
			});

			it("records failures and logs correlation errors when correlation fails", async () => {
				const logErrorSpy = vi
					.spyOn(globalRequestLogger, "logError")
					.mockImplementation(() => {
						// Mock implementation
					});
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
					buildApiResponse([]),
				);
				const response = await parseResponse(
					handleCreateTransactions(mockYnabAPI, buildParams()),
				);
				expect(response["results"][0].status).toBe("failed");
				expect(response["results"][0].error_code).toBe("correlation_failed");
				expect(logErrorSpy).toHaveBeenCalledWith(
					"ynab:create_transactions",
					"correlate_results",
					expect.objectContaining({
						request_index: 0,
						correlation_key: expect.any(String),
					}),
					"correlation_failed",
				);
				logErrorSpy.mockRestore();
			});
		});

		describe("error handling and edge cases", () => {
			it("propagates API failures", async () => {
				(mockYnabAPI.transactions.createTransactions as any).mockRejectedValue(
					new Error("500 Internal Server Error"),
				);
				const result = await handleCreateTransactions(
					mockYnabAPI,
					buildParams(),
				);
				const parsed = JSON.parse(maybeTextOf(result.content?.[0]) ?? "{}");
				expect(parsed.error).toBeDefined();
			});

			it("handles general validation errors outside of dry run", async () => {
				const invalidParams = {
					budget_id: "budget-123",
					transactions: [],
				};
				const result = await handleCreateTransactions(
					mockYnabAPI,
					invalidParams as any,
				);
				const parsed = JSON.parse(maybeTextOf(result.content?.[0]) ?? "{}");
				expect(parsed.error).toBeDefined();
			});

			it("supports transactions without payees or categories and special memo characters", async () => {
				const batch = [
					buildTransaction({
						memo: "Special | memo",
						payee_name: undefined,
						category_id: undefined,
					}),
				];
				const apiTransactions = batch.map((txn) => buildApiTransaction(txn));
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);
				const response = await parseResponse(
					handleCreateTransactions(
						mockYnabAPI,
						buildParams({ transactions: batch }),
					),
				);
				expect(response["results"][0].status).toBe("created");
			});

			it("allows transfer transactions by passing transfer payee ids", async () => {
				const batch = [
					buildTransaction({
						payee_id: "transfer_payee_account_ABC",
						memo: "Transfer out",
					}),
				];
				const apiTransactions = batch.map((txn) => buildApiTransaction(txn));
				(mockYnabAPI.transactions.createTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);
				const response = await parseResponse(
					handleCreateTransactions(
						mockYnabAPI,
						buildParams({ transactions: batch }),
					),
				);
				expect(response["results"][0].status).toBe("created");
			});
		});
	});

	describe("UpdateTransactionsSchema", () => {
		const buildUpdateTransaction = (
			overrides: Record<string, unknown> = {},
		) => ({
			id: "transaction-123",
			...overrides,
		});

		it("should accept a valid batch of updates with all fields optional except id", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [
					buildUpdateTransaction({ amount: -10000, memo: "Updated" }),
					buildUpdateTransaction({ id: "transaction-456", cleared: "cleared" }),
				],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.transactions).toHaveLength(2);
			}
		});

		it("should require id field for each transaction", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [{ amount: -5000 }],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.path).toContain("id");
			}
		});

		it("should accept minimum batch size of one transaction", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildUpdateTransaction()],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(true);
		});

		it("should accept maximum batch size of 100 transactions", () => {
			const hundred = Array.from({ length: 100 }, (_, index) =>
				buildUpdateTransaction({ id: `transaction-${index + 1}` }),
			);
			const params = { budget_id: "budget-123", transactions: hundred };
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(true);
		});

		it("should reject empty transactions array", () => {
			const params = { budget_id: "budget-123", transactions: [] };
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.message).toContain(
					"At least one transaction is required",
				);
			}
		});

		it("should reject batches exceeding 100 transactions", () => {
			const overLimit = Array.from({ length: 101 }, (_, i) =>
				buildUpdateTransaction({ id: `transaction-${i}` }),
			);
			const params = { budget_id: "budget-123", transactions: overLimit };
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.message).toContain(
					"A maximum of 100 transactions",
				);
			}
		});

		it("should validate ISO date format for optional date field", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildUpdateTransaction({ date: "01/01/2024" })],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.path).toEqual([
					"transactions",
					0,
					"date",
				]);
			}
		});

		it("should validate ISO date format for optional original_date field", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildUpdateTransaction({ original_date: "01/01/2024" })],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.path).toEqual([
					"transactions",
					0,
					"original_date",
				]);
			}
		});

		it("should require integer milliunit amounts when provided", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildUpdateTransaction({ amount: -50.25 })],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]!.path).toEqual([
					"transactions",
					0,
					"amount",
				]);
			}
		});

		it("should reject invalid cleared enum values", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [buildUpdateTransaction({ cleared: "pending" })],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
		});

		it("should accept optional metadata fields for cache invalidation", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [
					buildUpdateTransaction({
						original_account_id: "account-old",
						original_date: "2024-01-01",
					}),
				],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.transactions[0]!.original_account_id).toBe(
					"account-old",
				);
				expect(result.data.transactions[0]!.original_date).toBe("2024-01-01");
			}
		});

		it("should accept update with only id field (no changes)", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [{ id: "transaction-123" }],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(true);
		});

		it("should reject account_id field (account moves not supported)", () => {
			const params = {
				budget_id: "budget-123",
				transactions: [
					buildUpdateTransaction({ account_id: "new-account-456" }),
				],
			};
			const result = UpdateTransactionsSchema.safeParse(params);
			expect(result.success).toBe(false);
			if (!result.success) {
				// Expect "unrecognized_keys" error from strict() schema
				expect(result.error.issues[0]!.code).toBe("unrecognized_keys");
				expect(result.error.issues[0]!.path).toEqual(["transactions", 0]);
			}
		});
	});

	describe("handleUpdateTransactions", () => {
		let transactionCounter = 0;

		const buildUpdateTransaction = (
			overrides: Record<string, unknown> = {},
		) => ({
			id: "transaction-001",
			original_account_id: "account-001",
			original_date: "2024-01-01",
			...overrides,
		});

		const buildParams = (overrides: Record<string, unknown> = {}) => ({
			budget_id: "budget-123",
			transactions: [buildUpdateTransaction()],
			...overrides,
		});

		const buildApiTransaction = (overrides: Record<string, unknown> = {}) => ({
			id: overrides["id"] ?? `transaction-${++transactionCounter}`,
			account_id: overrides["account_id"] ?? "account-001",
			date: overrides["date"] ?? "2024-01-01",
			amount: overrides["amount"] ?? -1500,
			memo: overrides["memo"] ?? "Updated",
			cleared: overrides["cleared"] ?? "cleared",
			approved: overrides["approved"] ?? true,
			flag_color: overrides["flag_color"] ?? null,
			account_name: overrides["account_name"] ?? "Checking",
			payee_id: overrides["payee_id"] ?? null,
			payee_name: overrides["payee_name"] ?? null,
			category_id: overrides["category_id"] ?? null,
			category_name: overrides["category_name"] ?? null,
			transfer_account_id: overrides["transfer_account_id"] ?? null,
			transfer_transaction_id: overrides["transfer_transaction_id"] ?? null,
			matched_transaction_id: overrides["matched_transaction_id"] ?? null,
			import_id: overrides["import_id"] ?? null,
			deleted: overrides["deleted"] ?? false,
			subtransactions: [],
		});

		const buildApiResponse = (
			transactions: Record<string, unknown>[],
			extras: Record<string, unknown> = {},
		) => ({
			data: {
				transactions,
				server_knowledge: extras["server_knowledge"] ?? 1,
			},
		});

		const parseResponse = async (
			resultPromise: ReturnType<typeof handleUpdateTransactions>,
		) => {
			const result = await resultPromise;
			const text = maybeTextOf(result.content?.[0]) ?? "{}";
			return JSON.parse(text) as Record<string, any>;
		};

		beforeEach(() => {
			transactionCounter = 0;
			(mockYnabAPI.transactions.updateTransactions as any).mockReset();
			(mockYnabAPI.transactions.getTransactionById as any).mockReset();
		});

		describe("dry run", () => {
			it("returns validation summary without calling the API", async () => {
				const params = buildParams({
					dry_run: true,
					transactions: [
						buildUpdateTransaction({ id: "transaction-001", amount: -2000 }),
						buildUpdateTransaction({
							id: "transaction-002",
							memo: "Updated memo",
						}),
					],
				});

				const response = await parseResponse(
					handleUpdateTransactions(mockYnabAPI, params),
				);

				expect(
					mockYnabAPI.transactions.updateTransactions,
				).not.toHaveBeenCalled();
				expect(response["dry_run"]).toBe(true);
				expect(response["summary"].total_transactions).toBe(2);
				expect(response["transactions_preview"]).toHaveLength(2);
			});

			it("provides before/after preview showing only changed fields", async () => {
				const currentTransaction = buildApiTransaction({
					id: "transaction-001",
					amount: -5000,
					memo: "Old memo",
					cleared: "uncleared",
				});

				(mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue({
					data: { transaction: currentTransaction },
				});

				const params = buildParams({
					dry_run: true,
					transactions: [
						buildUpdateTransaction({
							id: "transaction-001",
							amount: -10000,
							memo: "New memo",
						}),
					],
				});

				const response = await parseResponse(
					handleUpdateTransactions(mockYnabAPI, params),
				);

				expect(response["dry_run"]).toBe(true);
				expect(response["transactions_preview"]).toHaveLength(1);

				const preview = response["transactions_preview"][0];
				expect(preview.transaction_id).toBe("transaction-001");
				expect(preview.before).toEqual({
					amount: -5,
					amount_milliunits: -5000,
					memo: "Old memo",
				});
				expect(preview.after).toEqual({
					amount: -10,
					amount_milliunits: -10000,
					memo: "New memo",
				});
			});

			it('sets before to "unavailable" when current state cannot be fetched', async () => {
				(mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(
					new Error("Not found"),
				);

				const params = buildParams({
					dry_run: true,
					transactions: [
						buildUpdateTransaction({
							id: "transaction-001",
							amount: -10000,
						}),
					],
				});

				const response = await parseResponse(
					handleUpdateTransactions(mockYnabAPI, params),
				);

				expect(response["dry_run"]).toBe(true);
				const preview = response["transactions_preview"][0];
				expect(preview.before).toBe("unavailable");
				expect(preview.after).toBeDefined();
			});

			it("includes summary with accounts_affected and fields_to_update", async () => {
				(mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue({
					data: {
						transaction: buildApiTransaction({
							id: "transaction-001",
							account_id: "account-001",
							date: "2024-01-01",
						}),
					},
				});

				const params = buildParams({
					dry_run: true,
					transactions: [
						buildUpdateTransaction({
							id: "transaction-001",
							amount: -10000,
							memo: "Updated",
							original_account_id: "account-001",
							original_date: "2024-01-01",
						}),
					],
				});

				const response = await parseResponse(
					handleUpdateTransactions(mockYnabAPI, params),
				);

				expect(response["summary"].accounts_affected).toContain("account-001");
				expect(response["summary"].fields_to_update).toContain("amount");
				expect(response["summary"].fields_to_update).toContain("memo");
			});

			it("previews split lines in major currency units", async () => {
				(mockYnabAPI.transactions.getTransactionById as any).mockResolvedValue({
					data: {
						transaction: buildApiTransaction({
							id: "transaction-001",
							amount: -5000,
							subtransactions: [],
						}),
					},
				});

				const response = await parseResponse(
					handleUpdateTransactions(
						mockYnabAPI,
						buildParams({
							dry_run: true,
							transactions: [
								buildUpdateTransaction({
									id: "transaction-001",
									amount: -5000,
									subtransactions: [
										{ amount: -3000, category_id: "category-1" },
										{ amount: -2000, category_id: "category-2" },
									],
								}),
							],
						}),
					),
				);

				expect(response["summary"].fields_to_update).toContain(
					"subtransactions",
				);
				expect(
					response["transactions_preview"][0].after.subtransactions,
				).toEqual([
					{ amount: -3, amount_milliunits: -3000, category_id: "category-1" },
					{ amount: -2, amount_milliunits: -2000, category_id: "category-2" },
				]);
			});

			it("surfaces validation errors before execution", async () => {
				const invalidParams = buildParams({
					transactions: [{ amount: -2000 }],
				});

				const result = await handleUpdateTransactions(
					mockYnabAPI,
					invalidParams as any,
				);
				const parsed = JSON.parse(maybeTextOf(result.content?.[0]) ?? "{}");
				expect(parsed.error).toBeDefined();
				expect(parsed.error.message).toContain("validation failed");
				expect(
					mockYnabAPI.transactions.updateTransactions,
				).not.toHaveBeenCalled();
			});

			it("fetches fresh preview state once per transaction", async () => {
				const currentTransaction = buildApiTransaction({
					id: "transaction-001",
					amount: -5000,
					memo: "Old memo",
					account_id: "account-001",
					date: "2024-01-01",
				});

				vi.mocked(
					mockYnabAPI.transactions.getTransactionById,
				).mockResolvedValue({
					data: { transaction: currentTransaction },
				} as unknown as ynab.TransactionResponse);

				const params = buildParams({
					dry_run: true,
					transactions: [
						buildUpdateTransaction({
							id: "transaction-001",
							amount: -10000,
							memo: "New memo",
						}),
					],
				});

				const response = await parseResponse(
					handleUpdateTransactions(mockYnabAPI, params),
				);

				// A preview reads the current transaction only once.
				expect(
					mockYnabAPI.transactions.getTransactionById,
				).toHaveBeenCalledTimes(1);

				// Verify preview still works correctly
				expect(response["dry_run"]).toBe(true);
				expect(response["transactions_preview"]).toHaveLength(1);
				const preview = response["transactions_preview"][0];
				expect(preview.transaction_id).toBe("transaction-001");
				expect(preview.before).toEqual({
					amount: -5,
					amount_milliunits: -5000,
					memo: "Old memo",
				});
				expect(preview.after).toEqual({
					amount: -10,
					amount_milliunits: -10000,
					memo: "New memo",
				});
			});
		});

		describe("successful updates", () => {
			it("updates transactions and correlates results", async () => {
				const transactions = [
					buildUpdateTransaction({ id: "transaction-001", amount: -10000 }),
					buildUpdateTransaction({ id: "transaction-002", memo: "New memo" }),
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

				expect(response["summary"].updated).toBe(2);
				expect(response["results"]).toHaveLength(2);
				expect(
					response["results"].every(
						(result: any) => result.status === "updated",
					),
				).toBe(true);
				expect(response["transactions"][0].amount).toBe(-1.5);
				// Cache invalidation now uses individual delete calls
			});

			it("only updates provided fields (partial updates)", async () => {
				const transaction = buildUpdateTransaction({
					id: "transaction-001",
					memo: "Updated memo only",
				});

				const apiTransaction = buildApiTransaction({ id: "transaction-001" });
				(mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
					buildApiResponse([apiTransaction]),
				);

				await handleUpdateTransactions(
					mockYnabAPI,
					buildParams({ transactions: [transaction] }),
				);

				const updateCall = (mockYnabAPI.transactions.updateTransactions as any)
					.mock.calls[0];
				const updatePayload = updateCall[1].transactions[0];
				expect(updatePayload.memo).toBe("Updated memo only");
				expect(updatePayload.amount).toBeUndefined();
				expect(updatePayload.account_id).toBeUndefined();
			});

			it("maps split lines into bulk update payloads", async () => {
				const transaction = buildUpdateTransaction({
					id: "transaction-001",
					amount: -5000,
					subtransactions: [
						{ amount: -3000, category_id: "category-1" },
						{ amount: -2000, category_id: "category-2" },
					],
				});
				(mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
					buildApiResponse([
						buildApiTransaction({
							id: "transaction-001",
							amount: -5000,
						}),
					]),
				);

				await handleUpdateTransactions(
					mockYnabAPI,
					buildParams({ transactions: [transaction] }),
				);

				const payload = (mockYnabAPI.transactions.updateTransactions as any)
					.mock.calls[0][1].transactions[0];
				expect(payload.subtransactions).toEqual([
					{ amount: -3000, category_id: "category-1" },
					{ amount: -2000, category_id: "category-2" },
				]);
			});
		});

		describe("error handling", () => {
			it("handles network failures", async () => {
				const error = new Error("Network error");
				(mockYnabAPI.transactions.updateTransactions as any).mockRejectedValue(
					error,
				);

				const result = await handleUpdateTransactions(
					mockYnabAPI,
					buildParams({
						transactions: [buildUpdateTransaction()],
					}),
				);

				const response = JSON.parse(textOf(result.content[0]));
				expect(response.error).toBeDefined();
			});

			it("handles invalid transaction IDs gracefully", async () => {
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
							transactions: [buildUpdateTransaction({ id: "invalid-id" })],
						}),
					),
				);

				expect(response["results"][0].status).toBe("failed");
				expect(response["results"][0].error_code).toBe("update_failed");
			});

			it("handles metadata resolution failures without crashing", async () => {
				const transaction = buildUpdateTransaction({
					id: "transaction-001",
					amount: -5000,
				});

				(mockYnabAPI.transactions.getTransactionById as any).mockRejectedValue(
					new Error("Transaction not found"),
				);

				const apiTransaction = buildApiTransaction({ id: "transaction-001" });
				(mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
					buildApiResponse([apiTransaction]),
				);

				// Should complete successfully even if metadata resolution fails
				const response = await parseResponse(
					handleUpdateTransactions(
						mockYnabAPI,
						buildParams({ transactions: [transaction] }),
					),
				);

				expect(response["summary"].updated).toBe(1);
			});
		});

		describe("correlation_key in results", () => {
			it("includes correlation_key in successful update results", async () => {
				const transactions = [
					buildUpdateTransaction({ id: "transaction-001", amount: -2000 }),
					buildUpdateTransaction({ id: "transaction-002", memo: "Updated" }),
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

				expect(response["results"]).toHaveLength(2);
				expect(response["results"][0].correlation_key).toBe("transaction-001");
				expect(response["results"][1].correlation_key).toBe("transaction-002");
			});

			it("includes correlation_key in failed update results", async () => {
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
							transactions: [buildUpdateTransaction({ id: "failed-id" })],
						}),
					),
				);

				expect(response["results"][0].status).toBe("failed");
				expect(response["results"][0].correlation_key).toBe("failed-id");
			});

			it("preserves correlation_key in ids_only downgrade mode", async () => {
				const byteSpy = vi.spyOn(Buffer, "byteLength");
				byteSpy
					.mockImplementationOnce(() => 70 * 1024)
					.mockImplementationOnce(() => 97 * 1024)
					.mockImplementationOnce(() => 80 * 1024);

				const apiTransactions = [
					buildApiTransaction({ id: "transaction-001" }),
				];
				(mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);

				const response = await parseResponse(
					handleUpdateTransactions(
						mockYnabAPI,
						buildParams({
							transactions: [buildUpdateTransaction({ id: "transaction-001" })],
						}),
					),
				);

				expect(response["mode"]).toBe("ids_only");
				expect(response["results"][0].correlation_key).toBe("transaction-001");
				expect(response["results"][0].transaction_id).toBe("transaction-001");
				expect(response["results"][0].status).toBe("updated");

				byteSpy.mockRestore();
			});
		});

		describe("response size management", () => {
			beforeEach(() => {});

			it("keeps full response when under 64KB", async () => {
				const apiTransactions = [buildApiTransaction()];
				(mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);
				const response = await parseResponse(
					handleUpdateTransactions(mockYnabAPI, buildParams()),
				);
				expect(response["transactions"]).toBeDefined();
				expect(response["mode"]).toBe("full");
			});

			it("downgrades to summary mode when response exceeds 64KB", async () => {
				const byteSpy = vi.spyOn(Buffer, "byteLength");
				byteSpy
					.mockImplementationOnce(() => 70 * 1024)
					.mockImplementationOnce(() => 80 * 1024);
				const apiTransactions = [buildApiTransaction()];
				(mockYnabAPI.transactions.updateTransactions as any).mockResolvedValue(
					buildApiResponse(apiTransactions),
				);

				const response = await parseResponse(
					handleUpdateTransactions(mockYnabAPI, buildParams()),
				);

				expect(response["transactions"]).toBeUndefined();
				expect(response["mode"]).toBe("summary");
				byteSpy.mockRestore();
			});
		});
	});
});
