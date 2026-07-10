import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import type { CacheManager } from "../cacheManager.js";
import { ResourceManager } from "../resources.js";

const api = {
	plans: {
		getPlanById: vi.fn(),
	},
	accounts: {
		getAccounts: vi.fn(),
		getAccountById: vi.fn(),
	},
	categories: {
		getCategories: vi.fn(),
	},
	months: {
		getPlanMonths: vi.fn(),
		getPlanMonth: vi.fn(),
	},
};

const formatter = {
	format: vi.fn((value: unknown) => JSON.stringify(value)),
};

const cache = {
	wrap: vi.fn(
		async <T>(
			_key: string,
			options: { loader: () => Promise<T> },
		): Promise<T> => options.loader(),
	),
} as unknown as CacheManager;

describe("ResourceManager template branches", () => {
	let manager: ResourceManager;

	beforeEach(() => {
		vi.clearAllMocks();
		manager = new ResourceManager({
			ynabAPI: api as unknown as ynab.API,
			responseFormatter: formatter,
			cacheManager: cache,
		});
	});

	it("formats category, month-list, and month-detail resources", async () => {
		api.categories.getCategories.mockResolvedValue({
			data: {
				category_groups: [
					{
						name: "Bills",
						categories: [
							{
								id: "category-1",
								category_group_id: "group-1",
								name: "Rent",
								hidden: false,
								note: null,
								budgeted: 1000000,
								activity: -1000000,
								balance: 0,
								goal_type: null,
								deleted: false,
							},
						],
					},
				],
			},
		});
		api.months.getPlanMonths.mockResolvedValue({
			data: { months: [{ month: "2026-07-01" }] },
		});
		api.months.getPlanMonth.mockResolvedValue({
			data: { month: { month: "2026-07-01", income: 2500000 } },
		});

		const categories = await manager.readResource(
			"ynab://budgets/budget-1/categories",
		);
		const months = await manager.readResource("ynab://budgets/budget-1/months");
		const month = await manager.readResource(
			"ynab://budgets/budget-1/months/2026-07-01",
		);

		expect(JSON.parse(categories.contents[0]?.text ?? "")).toEqual({
			categories: [
				expect.objectContaining({
					id: "category-1",
					category_group_name: "Bills",
				}),
			],
		});
		expect(JSON.parse(months.contents[0]?.text ?? "")).toEqual({
			months: [{ month: "2026-07-01" }],
		});
		expect(JSON.parse(month.contents[0]?.text ?? "")).toEqual({
			month: "2026-07-01",
			income: 2500000,
		});
	});

	it.each([
		{
			uri: "ynab://budgets/budget-1",
			mock: api.plans.getPlanById,
			message: "Failed to fetch budget budget-1: plain failure",
		},
		{
			uri: "ynab://budgets/budget-1/accounts",
			mock: api.accounts.getAccounts,
			message: "Failed to fetch accounts for budget budget-1: plain failure",
		},
		{
			uri: "ynab://budgets/budget-1/categories",
			mock: api.categories.getCategories,
			message: "Failed to fetch categories for budget budget-1: plain failure",
		},
		{
			uri: "ynab://budgets/budget-1/months",
			mock: api.months.getPlanMonths,
			message: "Failed to fetch months for budget budget-1: plain failure",
		},
		{
			uri: "ynab://budgets/budget-1/months/2026-07-01",
			mock: api.months.getPlanMonth,
			message:
				"Failed to fetch month 2026-07-01 for budget budget-1: plain failure",
		},
		{
			uri: "ynab://budgets/budget-1/accounts/account-1",
			mock: api.accounts.getAccountById,
			message:
				"Failed to fetch account account-1 in budget budget-1: plain failure",
		},
	])("wraps non-Error failures for $uri", async ({ uri, mock, message }) => {
		mock.mockRejectedValue("plain failure");
		await expect(manager.readResource(uri)).rejects.toThrow(message);
	});

	it("registers unannotated resources and preserves explicit MCP errors", async () => {
		manager.registerResource(
			{
				uri: "ynab://custom",
				name: "Custom",
				description: "Custom test resource",
				mimeType: "application/json",
			},
			async () => {
				throw new McpError(ErrorCode.InvalidParams, "custom failure");
			},
		);

		expect(manager.listResources().resources).toContainEqual({
			uri: "ynab://custom",
			name: "Custom",
			description: "Custom test resource",
			mimeType: "application/json",
		});
		await expect(manager.readResource("ynab://custom")).rejects.toMatchObject({
			code: ErrorCode.InvalidParams,
		});
		await expect(manager.readResource("ynab://custom")).rejects.toThrow(
			"custom failure",
		);
	});

	it("registers an unannotated template and executes it", async () => {
		manager.registerTemplate({
			uriTemplate: "ynab://custom/{item_id}",
			name: "Custom item",
			description: "Custom template",
			mimeType: "application/json",
			handler: async (uri, params) => [
				{ uri, mimeType: "application/json", text: JSON.stringify(params) },
			],
		});

		expect(manager.listResourceTemplates().resourceTemplates).toContainEqual({
			uriTemplate: "ynab://custom/{item_id}",
			name: "Custom item",
			description: "Custom template",
			mimeType: "application/json",
		});
		const result = await manager.readResource("ynab://custom/item-1");
		expect(JSON.parse(result.contents[0]?.text ?? "")).toEqual({
			item_id: "item-1",
		});
	});

	it("rejects duplicate template parameter names", () => {
		expect(() =>
			manager.registerTemplate({
				uriTemplate: "ynab://custom/{item_id}/{item_id}",
				name: "Duplicate",
				description: "Invalid duplicate parameters",
				mimeType: "application/json",
				handler: async () => [],
			}),
		).toThrow("Duplicate parameter names detected");
	});
});
