/**
 * Unit tests for resources module
 *
 * Tests resource management functionality.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import type { CacheManager } from "../cacheManager.js";
import { type ResourceDependencies, ResourceManager } from "../resources.js";

// Mock YNAB API
const mockYnabAPI = {
	budgets: {
		getBudgets: vi.fn(),
	},
	user: {
		getUser: vi.fn(),
	},
} as unknown as ynab.API;

// Mock response formatter
const mockResponseFormatter = {
	format: vi.fn((data) => JSON.stringify(data)),
};

const mockCacheManager = {
	wrap: vi.fn(async (_key, { loader }) => loader()),
} as unknown as CacheManager;

describe("resources module", () => {
	let resourceManager: ResourceManager;
	let dependencies: ResourceDependencies;

	beforeEach(() => {
		vi.clearAllMocks();

		dependencies = {
			ynabAPI: mockYnabAPI,
			responseFormatter: mockResponseFormatter,
			cacheManager: mockCacheManager,
		};

		resourceManager = new ResourceManager(dependencies);
	});

	describe("ResourceManager", () => {
		describe("constructor", () => {
			it("should initialize with dependencies", () => {
				expect(resourceManager).toBeInstanceOf(ResourceManager);
			});
		});

		describe("listResources", () => {
			it("should return list of available resources", () => {
				const result = resourceManager.listResources();

				expect(result).toEqual({
					resources: [
						{
							uri: "ynab://budgets",
							name: "YNAB Budgets",
							description: "List of all available budgets",
							mimeType: "application/json",
							annotations: { audience: ["assistant"], priority: 0.8 },
						},
						{
							uri: "ynab://user",
							name: "YNAB User Info",
							description:
								"Current user information including ID and email address",
							mimeType: "application/json",
							annotations: { audience: ["assistant"], priority: 0.3 },
						},
					],
				});
			});

			it("should return consistent resource list", () => {
				const result1 = resourceManager.listResources();
				const result2 = resourceManager.listResources();

				expect(result1).toEqual(result2);
			});
		});

		describe("readResource", () => {
			describe("ynab://budgets", () => {
				it("should fetch and format budgets data", async () => {
					const mockBudgets = [
						{
							id: "budget-1",
							name: "Test Budget 1",
							last_modified_on: "2024-01-01T00:00:00.000Z",
							first_month: "2024-01",
							last_month: "2024-12",
							currency_format: {
								iso_code: "USD",
								example_format: "$1,000.00",
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
							last_modified_on: "2024-01-02T00:00:00.000Z",
							first_month: "2024-02",
							last_month: "2024-11",
							currency_format: {
								iso_code: "EUR",
								example_format: "€1,000.00",
								decimal_digits: 2,
								decimal_separator: ".",
								symbol_first: true,
								group_separator: ",",
								currency_symbol: "€",
								display_symbol: true,
							},
						},
					];

					mockYnabAPI.budgets.getBudgets = vi.fn().mockResolvedValue({
						data: { budgets: mockBudgets },
					});

					const result = await resourceManager.readResource("ynab://budgets");

					expect(mockYnabAPI.budgets.getBudgets).toHaveBeenCalledOnce();
					expect(mockResponseFormatter.format).toHaveBeenCalledWith({
						budgets: mockBudgets.map((budget) => ({
							id: budget.id,
							name: budget.name,
							last_modified_on: budget.last_modified_on,
							first_month: budget.first_month,
							last_month: budget.last_month,
							currency_format: budget.currency_format,
						})),
					});

					expect(result).toEqual({
						contents: [
							{
								uri: "ynab://budgets",
								mimeType: "application/json",
								text: JSON.stringify({
									budgets: mockBudgets.map((budget) => ({
										id: budget.id,
										name: budget.name,
										last_modified_on: budget.last_modified_on,
										first_month: budget.first_month,
										last_month: budget.last_month,
										currency_format: budget.currency_format,
									})),
								}),
							},
						],
					});
				});

				it("should handle YNAB API errors", async () => {
					const error = new Error("API Error");
					mockYnabAPI.budgets.getBudgets = vi.fn().mockRejectedValue(error);

					await expect(
						resourceManager.readResource("ynab://budgets"),
					).rejects.toThrow("Failed to fetch budgets: API Error");
				});
			});

			describe("ynab://user", () => {
				it("should fetch and format user data", async () => {
					const mockUser = {
						id: "user-123",
					};

					mockYnabAPI.user.getUser = vi.fn().mockResolvedValue({
						data: { user: mockUser },
					});

					const result = await resourceManager.readResource("ynab://user");

					expect(mockYnabAPI.user.getUser).toHaveBeenCalledOnce();
					expect(mockResponseFormatter.format).toHaveBeenCalledWith({
						user: { id: mockUser.id },
					});

					expect(result).toEqual({
						contents: [
							{
								uri: "ynab://user",
								mimeType: "application/json",
								text: JSON.stringify({
									user: { id: mockUser.id },
								}),
							},
						],
					});
				});

				it("should handle YNAB API errors", async () => {
					const error = new Error("User API Error");
					mockYnabAPI.user.getUser = vi.fn().mockRejectedValue(error);

					await expect(
						resourceManager.readResource("ynab://user"),
					).rejects.toThrow("Failed to fetch user info: User API Error");
				});
			});

			describe("unknown resources", () => {
				it("should throw error for unknown resource URIs", async () => {
					await expect(
						resourceManager.readResource("ynab://unknown"),
					).rejects.toThrow("Resource not found: ynab://unknown");
				});

				it("should throw error for invalid URIs", async () => {
					await expect(
						resourceManager.readResource("invalid-uri"),
					).rejects.toThrow("Resource not found: invalid-uri");
				});

				it("should throw error for empty URI", async () => {
					await expect(resourceManager.readResource("")).rejects.toThrow(
						"Resource not found: ",
					);
				});
			});
		});

		describe("dependency injection", () => {
			it("should use injected YNAB API", async () => {
				const customYnabAPI = {
					budgets: {
						getBudgets: vi.fn().mockResolvedValue({
							data: { budgets: [] },
						}),
					},
					user: {
						getUser: vi.fn(),
					},
				} as unknown as ynab.API;

				const customDependencies = {
					ynabAPI: customYnabAPI,
					responseFormatter: mockResponseFormatter,
					cacheManager: mockCacheManager,
				};

				const customResourceManager = new ResourceManager(customDependencies);
				await customResourceManager.readResource("ynab://budgets");

				expect(customYnabAPI.budgets.getBudgets).toHaveBeenCalledOnce();
				expect(mockYnabAPI.budgets.getBudgets).not.toHaveBeenCalled();
			});

			it("should use injected response formatter", async () => {
				const customFormatter = {
					format: vi.fn(() => "custom-formatted-response"),
				};

				const customDependencies = {
					ynabAPI: mockYnabAPI,
					responseFormatter: customFormatter,
					cacheManager: mockCacheManager,
				};

				mockYnabAPI.budgets.getBudgets = vi.fn().mockResolvedValue({
					data: { budgets: [] },
				});

				const customResourceManager = new ResourceManager(customDependencies);
				const result =
					await customResourceManager.readResource("ynab://budgets");

				expect(customFormatter.format).toHaveBeenCalled();
				expect(mockResponseFormatter.format).not.toHaveBeenCalled();
				expect(result.contents[0].text).toBe("custom-formatted-response");
			});
		});

		describe("edge cases", () => {
			it("should handle empty budgets list", async () => {
				mockYnabAPI.budgets.getBudgets = vi.fn().mockResolvedValue({
					data: { budgets: [] },
				});

				const result = await resourceManager.readResource("ynab://budgets");

				expect(result.contents[0].text).toBe(JSON.stringify({ budgets: [] }));
			});

			it("should handle user without extended properties", async () => {
				const minimalUser = {
					id: "minimal-user",
				};

				mockYnabAPI.user.getUser = vi.fn().mockResolvedValue({
					data: { user: minimalUser },
				});

				const result = await resourceManager.readResource("ynab://user");

				expect(result.contents[0].text).toBe(
					JSON.stringify({ user: { id: minimalUser.id } }),
				);
			});
		});
	});
});
