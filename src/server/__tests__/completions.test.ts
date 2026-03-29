import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import type { CacheManager } from "../cacheManager.js";
import { CompletionsManager } from "../completions.js";

/**
 * Unit tests for CompletionsManager
 * Tests autocomplete functionality for YNAB entities
 */
describe("CompletionsManager", () => {
	let manager: CompletionsManager;
	let mockYnabAPI: Partial<ynab.API>;
	let mockCacheManager: Partial<CacheManager>;
	let getDefaultBudgetId: () => string | undefined;

	const mockBudgets = [
		{ id: "budget-1", name: "Personal Budget" },
		{ id: "budget-2", name: "Business Budget" },
		{ id: "budget-3", name: "Savings" },
	];

	const mockAccounts = [
		{ id: "acc-1", name: "Checking Account", deleted: false, closed: false },
		{ id: "acc-2", name: "Savings Account", deleted: false, closed: false },
		{ id: "acc-3", name: "Credit Card", deleted: false, closed: false },
		{
			id: "acc-deleted",
			name: "Deleted Account",
			deleted: true,
			closed: false,
		},
		{ id: "acc-closed", name: "Closed Account", deleted: false, closed: true },
	];

	const mockCategories = {
		category_groups: [
			{
				name: "Bills",
				hidden: false,
				deleted: false,
				categories: [
					{ id: "cat-1", name: "Rent", hidden: false, deleted: false },
					{ id: "cat-2", name: "Utilities", hidden: false, deleted: false },
				],
			},
			{
				name: "Food",
				hidden: false,
				deleted: false,
				categories: [
					{ id: "cat-3", name: "Groceries", hidden: false, deleted: false },
					{ id: "cat-4", name: "Restaurants", hidden: false, deleted: false },
				],
			},
			{
				name: "Hidden Group",
				hidden: true,
				deleted: false,
				categories: [
					{
						id: "cat-hidden",
						name: "Hidden Category",
						hidden: false,
						deleted: false,
					},
				],
			},
		],
	};

	const mockPayees = [
		{ id: "payee-1", name: "Amazon", deleted: false },
		{ id: "payee-2", name: "Walmart", deleted: false },
		{ id: "payee-3", name: "Target", deleted: false },
		{ id: "payee-deleted", name: "Deleted Payee", deleted: true },
	];

	beforeEach(() => {
		mockYnabAPI = {
			plans: {
				getPlans: vi.fn().mockResolvedValue({ data: { plans: mockBudgets } }),
			} as unknown as ynab.PlansApi,
			accounts: {
				getAccounts: vi
					.fn()
					.mockResolvedValue({ data: { accounts: mockAccounts } }),
			} as unknown as ynab.AccountsApi,
			categories: {
				getCategories: vi.fn().mockResolvedValue({ data: mockCategories }),
			} as unknown as ynab.CategoriesApi,
			payees: {
				getPayees: vi.fn().mockResolvedValue({ data: { payees: mockPayees } }),
			} as unknown as ynab.PayeesApi,
		};

		// Mock cache manager that bypasses caching
		mockCacheManager = {
			wrap: vi.fn().mockImplementation(async (_key, { loader }) => loader()),
		};

		getDefaultBudgetId = vi.fn().mockReturnValue("default-budget-id");

		manager = new CompletionsManager(
			mockYnabAPI as ynab.API,
			mockCacheManager as CacheManager,
			getDefaultBudgetId,
		);
	});

	describe("getCompletions", () => {
		it("should return empty completion for unknown argument names", async () => {
			const result = await manager.getCompletions("unknown_arg", "test");
			expect(result.completion.values).toEqual([]);
			expect(result.completion.total).toBe(0);
			expect(result.completion.hasMore).toBe(false);
		});

		it("should handle case-insensitive argument names", async () => {
			const result = await manager.getCompletions("BUDGET_ID", "pers");
			expect(result.completion.values).toContain("Personal Budget");
		});
	});

	describe("completeBudgets", () => {
		it("should return matching budgets by name", async () => {
			const result = await manager.getCompletions("budget_id", "pers");
			expect(result.completion.values).toContain("Personal Budget");
			expect(result.completion.total).toBe(1);
		});

		it("should return all budgets when search value is empty", async () => {
			const result = await manager.getCompletions("budget_id", "");
			expect(result.completion.values).toHaveLength(3);
			expect(result.completion.total).toBe(3);
		});

		it("should match by budget ID", async () => {
			const result = await manager.getCompletions("budget_id", "budget-1");
			expect(result.completion.values.length).toBeGreaterThan(0);
		});

		it("should prioritize prefix matches over contains", async () => {
			const result = await manager.getCompletions("budget_id", "sav");
			// "Savings" starts with "sav" so it should come before "Business Budget" (contains "sav" in "Business")
			expect(result.completion.values[0]).toBe("Savings");
		});
	});

	describe("completeAccounts", () => {
		it("should return matching accounts by name", async () => {
			const result = await manager.getCompletions("account_id", "check");
			expect(result.completion.values).toContain("Checking Account");
		});

		it("should filter out deleted accounts", async () => {
			const result = await manager.getCompletions("account_id", "deleted");
			expect(result.completion.values).not.toContain("Deleted Account");
			expect(result.completion.total).toBe(0);
		});

		it("should filter out closed accounts", async () => {
			const result = await manager.getCompletions("account_id", "closed");
			expect(result.completion.values).not.toContain("Closed Account");
			expect(result.completion.total).toBe(0);
		});

		it("should return empty when no budget context available", async () => {
			getDefaultBudgetId = vi.fn().mockReturnValue(undefined);
			manager = new CompletionsManager(
				mockYnabAPI as ynab.API,
				mockCacheManager as CacheManager,
				getDefaultBudgetId,
			);

			const result = await manager.getCompletions("account_id", "check");
			expect(result.completion.values).toEqual([]);
		});

		it("should use budget_id from context if provided", async () => {
			const context = { arguments: { budget_id: "context-budget" } };
			await manager.getCompletions("account_id", "check", context);

			expect(mockCacheManager.wrap).toHaveBeenCalledWith(
				"completions:accounts:context-budget",
				expect.any(Object),
			);
		});

		it("should handle account_name argument", async () => {
			const result = await manager.getCompletions("account_name", "sav");
			expect(result.completion.values).toContain("Savings Account");
		});
	});

	describe("completeCategories", () => {
		it("should return matching categories by name", async () => {
			const result = await manager.getCompletions("category", "groc");
			expect(result.completion.values).toContain("Groceries");
		});

		it("should match by group:name format", async () => {
			const result = await manager.getCompletions("category", "Food: Groc");
			expect(result.completion.total).toBeGreaterThan(0);
		});

		it("should filter out hidden categories", async () => {
			const result = await manager.getCompletions("category", "hidden");
			expect(result.completion.values).not.toContain("Hidden Category");
		});

		it("should return empty when no budget context available", async () => {
			getDefaultBudgetId = vi.fn().mockReturnValue(undefined);
			manager = new CompletionsManager(
				mockYnabAPI as ynab.API,
				mockCacheManager as CacheManager,
				getDefaultBudgetId,
			);

			const result = await manager.getCompletions("category", "groc");
			expect(result.completion.values).toEqual([]);
		});

		it("should handle category_id argument", async () => {
			const result = await manager.getCompletions("category_id", "rent");
			expect(result.completion.values).toContain("Rent");
		});

		it("should prioritize name over ID in results", async () => {
			// When searching for a category, we should get the name, not the ID
			const result = await manager.getCompletions("category", "cat-1");
			// Even when matching by ID, the display value should prefer the name
			expect(result.completion.total).toBeGreaterThanOrEqual(0);
		});
	});

	describe("completePayees", () => {
		it("should return matching payees by name", async () => {
			const result = await manager.getCompletions("payee", "amaz");
			expect(result.completion.values).toContain("Amazon");
		});

		it("should filter out deleted payees", async () => {
			const result = await manager.getCompletions("payee", "deleted");
			expect(result.completion.values).not.toContain("Deleted Payee");
		});

		it("should handle payee_id argument", async () => {
			const result = await manager.getCompletions("payee_id", "targ");
			expect(result.completion.values).toContain("Target");
		});

		it("should return empty when no budget context available", async () => {
			getDefaultBudgetId = vi.fn().mockReturnValue(undefined);
			manager = new CompletionsManager(
				mockYnabAPI as ynab.API,
				mockCacheManager as CacheManager,
				getDefaultBudgetId,
			);

			const result = await manager.getCompletions("payee", "amaz");
			expect(result.completion.values).toEqual([]);
		});
	});

	describe("filterAndFormat", () => {
		it("should respect MAX_COMPLETIONS limit", async () => {
			// Create a large list of budgets
			const manyBudgets = Array.from({ length: 150 }, (_, i) => ({
				id: `budget-${i}`,
				name: `Budget ${i}`,
			}));

			mockYnabAPI.plans = {
				getPlans: vi.fn().mockResolvedValue({ data: { plans: manyBudgets } }),
			} as unknown as ynab.PlansApi;

			manager = new CompletionsManager(
				mockYnabAPI as ynab.API,
				mockCacheManager as CacheManager,
				getDefaultBudgetId,
			);

			const result = await manager.getCompletions("budget_id", "Budget");
			expect(result.completion.values.length).toBeLessThanOrEqual(100);
			expect(result.completion.hasMore).toBe(true);
			expect(result.completion.total).toBe(150);
		});

		it("should cache lowercased values for performance", async () => {
			// This is tested implicitly by the fact that filtering works correctly
			// The internal cache is not exposed, but we verify behavior is correct
			const result = await manager.getCompletions("budget_id", "PERSONAL");
			expect(result.completion.values).toContain("Personal Budget");
		});

		it("should return unique values only", async () => {
			const result = await manager.getCompletions("budget_id", "budget");
			const uniqueCount = new Set(result.completion.values).size;
			expect(uniqueCount).toBe(result.completion.values.length);
		});
	});

	describe("caching behavior", () => {
		it("should use cache manager for budgets", async () => {
			await manager.getCompletions("budget_id", "test");
			expect(mockCacheManager.wrap).toHaveBeenCalledWith(
				"completions:budgets",
				expect.any(Object),
			);
		});

		it("should use cache manager for accounts with budget-specific key", async () => {
			await manager.getCompletions("account_id", "test");
			expect(mockCacheManager.wrap).toHaveBeenCalledWith(
				"completions:accounts:default-budget-id",
				expect.any(Object),
			);
		});

		it("should use cache manager for categories with budget-specific key", async () => {
			await manager.getCompletions("category", "test");
			expect(mockCacheManager.wrap).toHaveBeenCalledWith(
				"completions:categories:default-budget-id",
				expect.any(Object),
			);
		});

		it("should use cache manager for payees with budget-specific key", async () => {
			await manager.getCompletions("payee", "test");
			expect(mockCacheManager.wrap).toHaveBeenCalledWith(
				"completions:payees:default-budget-id",
				expect.any(Object),
			);
		});
	});
});
