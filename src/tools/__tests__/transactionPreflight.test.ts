import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../types/toolRegistration.js";
import {
	CreateTransactionOutputSchema,
	CreateTransactionsOutputSchema,
	UpdateTransactionOutputSchema,
} from "../schemas/outputs/index.js";
import {
	runTransactionPreflight,
	withTransactionPreflight,
} from "../transactionPreflight.js";

const BUDGET = "budget-1";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const CATEGORY = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_CATEGORY = "84d05aab-0000-4000-8000-000000000000";
const NEW_CATEGORY = "33333333-3333-4333-8333-333333333333";

function notFound(): Error {
	return Object.assign(new Error("Resource not found"), {
		error: { id: "404", name: "not_found", detail: "Resource not found" },
	});
}

function createDeps(
	options: {
		decimalDigits?: number | undefined;
		budgetsFail?: boolean;
		categoriesFail?: boolean;
		importIds?: string[];
	} = {},
) {
	const getCategoryById = vi.fn(async (_budget: string, id: string) => {
		if (id === NEW_CATEGORY) {
			return { data: { category: { id, deleted: false } } };
		}
		throw notFound();
	});
	const getAccountById = vi.fn(async () => {
		throw notFound();
	});
	const fetchTransactionsByAccount = vi.fn(async () => ({
		data: (options.importIds ?? []).map((importId, index) => ({
			id: `txn-${index}`,
			import_id: importId,
			deleted: false,
		})),
	}));
	const deps = {
		ynabAPI: {
			categories: { getCategoryById },
			accounts: { getAccountById },
		},
		deltaFetcher: {
			fetchBudgets: vi.fn(async () => {
				if (options.budgetsFail) throw new Error("budgets down");
				return {
					data: [
						{
							id: BUDGET,
							currency_format:
								"decimalDigits" in options
									? { decimal_digits: options.decimalDigits }
									: { decimal_digits: 2 },
						},
					],
				};
			}),
			fetchAccounts: vi.fn(async () => ({
				data: [{ id: ACCOUNT, deleted: false }],
			})),
			fetchCategories: vi.fn(async () => {
				if (options.categoriesFail) throw new Error("categories down");
				return {
					data: [
						{
							id: "group",
							deleted: false,
							categories: [
								{ id: CATEGORY, deleted: false },
								{ id: "deleted-cat", deleted: true },
							],
						},
					],
				};
			}),
			fetchTransactionsByAccount,
		},
	};
	return {
		deps: deps as unknown as Parameters<typeof runTransactionPreflight>[0],
		getCategoryById,
		fetchTransactionsByAccount,
	};
}

describe("runTransactionPreflight", () => {
	it("accepts a request that matches the budget", async () => {
		const { deps, getCategoryById } = createDeps();
		const report = await runTransactionPreflight(deps, BUDGET, [
			{ path: "", account_id: ACCOUNT, amount: -3780, category_id: CATEGORY },
		]);
		expect(report).toEqual({ errors: [], warnings: [] });
		expect(getCategoryById).not.toHaveBeenCalled();
	});

	it("reports an unknown well-formed category_id as not found", async () => {
		const { deps } = createDeps();
		const report = await runTransactionPreflight(deps, BUDGET, [
			{
				path: "transactions[1]",
				account_id: ACCOUNT,
				amount: -1000,
				category_id: UNKNOWN_CATEGORY,
			},
		]);
		expect(report.errors).toHaveLength(1);
		expect(report.errors[0]).toContain(
			`transactions[1].category_id: category_id "${UNKNOWN_CATEGORY}" was not found in this budget`,
		);
	});

	it("checks split lines and treats deleted categories as missing", async () => {
		const { deps } = createDeps();
		const report = await runTransactionPreflight(deps, BUDGET, [
			{
				path: "",
				account_id: ACCOUNT,
				amount: -2000,
				subtransactions: [
					{ amount: -1000, category_id: CATEGORY },
					{ amount: -1000, category_id: "deleted-cat" },
				],
			},
		]);
		expect(report.errors).toEqual([
			expect.stringContaining(
				'subtransactions[1].category_id: category_id "deleted-cat"',
			),
		]);
	});

	it("accepts a category created after the cache was filled", async () => {
		const { deps, getCategoryById } = createDeps();
		const report = await runTransactionPreflight(deps, BUDGET, [
			{
				path: "",
				account_id: ACCOUNT,
				amount: -1000,
				category_id: NEW_CATEGORY,
			},
		]);
		expect(report.errors).toEqual([]);
		expect(getCategoryById).toHaveBeenCalledWith(BUDGET, NEW_CATEGORY);
	});

	it("reports an unknown account_id", async () => {
		const { deps } = createDeps();
		const report = await runTransactionPreflight(deps, BUDGET, [
			{ path: "", account_id: UNKNOWN_CATEGORY, amount: -1000 },
		]);
		expect(report.errors[0]).toContain("account_id");
	});

	it("rejects sub-cent amounts in a 2-decimal currency and suggests units", async () => {
		const { deps } = createDeps();
		const report = await runTransactionPreflight(deps, BUDGET, [
			{ path: "", account_id: ACCOUNT, amount: -378 },
		]);
		expect(report.errors).toHaveLength(1);
		expect(report.errors[0]).toContain("-378 milliunits is -0.378");
		expect(report.errors[0]).toContain("amount_decimal: -3.78");
	});

	it("allows milliunit precision in a 3-decimal currency", async () => {
		const { deps } = createDeps({ decimalDigits: 3 });
		const report = await runTransactionPreflight(deps, BUDGET, [
			{ path: "", account_id: ACCOUNT, amount: -378 },
		]);
		expect(report).toEqual({ errors: [], warnings: [] });
	});

	it("rejects fractional amounts in a 0-decimal currency", async () => {
		const { deps } = createDeps({ decimalDigits: 0 });
		const report = await runTransactionPreflight(deps, BUDGET, [
			{ path: "", account_id: ACCOUNT, amount: -1500 },
		]);
		expect(report.errors[0]).toContain("0 decimal place(s)");
	});

	it("only warns about precision when the currency is unknown", async () => {
		const { deps } = createDeps({ budgetsFail: true });
		const report = await runTransactionPreflight(deps, BUDGET, [
			{ path: "", account_id: ACCOUNT, amount: -378 },
		]);
		expect(report.errors).toEqual([]);
		expect(report.warnings).toEqual([
			expect.objectContaining({ code: "amount_precision", count: 1 }),
		]);
	});

	it("warns when an import_id already exists in the account", async () => {
		const { deps, fetchTransactionsByAccount } = createDeps({
			importIds: ["YNAB:-1000:2026-01-01:1"],
		});
		const report = await runTransactionPreflight(deps, BUDGET, [
			{
				path: "transactions[0]",
				account_id: ACCOUNT,
				amount: -1000,
				import_id: "YNAB:-1000:2026-01-01:1",
			},
			{
				path: "transactions[1]",
				account_id: ACCOUNT,
				amount: -1000,
				import_id: "YNAB:-1000:2026-01-01:2",
			},
		]);
		expect(fetchTransactionsByAccount).toHaveBeenCalledTimes(1);
		expect(report.errors).toEqual([]);
		expect(report.warnings).toEqual([
			expect.objectContaining({
				code: "import_id_exists",
				count: 1,
				sample_ids: ["YNAB:-1000:2026-01-01:1"],
			}),
		]);
	});

	it("fails open with a warning when budget data cannot be read", async () => {
		const { deps } = createDeps({ categoriesFail: true });
		const report = await runTransactionPreflight(deps, BUDGET, [
			{ path: "", account_id: ACCOUNT, amount: -1000, category_id: CATEGORY },
		]);
		expect(report.errors).toEqual([]);
		expect(report.warnings).toEqual([
			expect.objectContaining({
				code: "preflight_unavailable",
				message: expect.stringContaining("category_id"),
			}),
		]);
	});
});

describe("withTransactionPreflight", () => {
	function wrap(deps: ReturnType<typeof createDeps>["deps"]) {
		const createValidationError = vi.fn(
			(message: string, details?: string): CallToolResult => ({
				isError: true,
				content: [{ type: "text", text: `${message}\n${details}` }],
			}),
		);
		const context = {
			...deps,
			errorHandler: { createValidationError },
		} as unknown as ToolContext;
		const inner = vi.fn(
			async (): Promise<CallToolResult> => ({
				content: [{ type: "text", text: "{}" }],
				structuredContent: { dry_run: true, warnings: [{ code: "existing" }] },
			}),
		);
		const handler = withTransactionPreflight(
			context,
			(input: Record<string, unknown>) => [
				{
					path: "",
					account_id: ACCOUNT,
					amount: input["amount"] as number,
					import_id: input["import_id"] as string | undefined,
				},
			],
			inner,
		);
		const call = (input: Record<string, unknown>) =>
			handler({
				input: { budget_id: BUDGET, ...input },
				context: {
					accessToken: "t",
					name: "ynab_create_transaction",
					operation: "op",
					rawArguments: {},
				},
			});
		return { call, inner, createValidationError };
	}

	it("rejects a dry run with errors before calling the handler", async () => {
		const { call, inner, createValidationError } = wrap(createDeps().deps);
		const result = await call({ dry_run: true, amount: -378 });
		expect(result.isError).toBe(true);
		expect(inner).not.toHaveBeenCalled();
		expect(createValidationError.mock.calls[0]?.[1]).toContain(
			"amount_decimal: -3.78",
		);
	});

	it("appends warnings to the dry-run output", async () => {
		const { call } = wrap(createDeps({ importIds: ["dup"] }).deps);
		const result = await call({
			dry_run: true,
			amount: -1000,
			import_id: "dup",
		});
		expect(result.structuredContent?.["warnings"]).toEqual([
			{ code: "existing" },
			expect.objectContaining({ code: "import_id_exists" }),
		]);
		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("import_id_exists"),
		});
	});

	it("passes real writes straight through", async () => {
		const { deps } = createDeps();
		const { call, inner } = wrap(deps);
		await call({ dry_run: false, amount: -378 });
		expect(inner).toHaveBeenCalledTimes(1);
		expect(
			(deps as unknown as { deltaFetcher: { fetchBudgets: unknown } })
				.deltaFetcher.fetchBudgets,
		).not.toHaveBeenCalled();
	});
});

describe("dry-run output schemas keep preflight warnings", () => {
	const warnings = [{ code: "import_id_exists", count: 1, message: "m" }];

	it.each([
		[
			"ynab_create_transaction",
			CreateTransactionOutputSchema,
			{ dry_run: true, action: "ynab_create_transaction", request: {} },
		],
		[
			"ynab_update_transaction",
			UpdateTransactionOutputSchema,
			{ dry_run: true, action: "ynab_update_transaction", request: {} },
		],
		[
			"ynab_create_transactions",
			CreateTransactionsOutputSchema,
			{
				dry_run: true,
				action: "ynab_create_transactions",
				validation: "passed",
				summary: {
					total_transactions: 0,
					total_amount: 0,
					accounts_affected: [],
					categories_affected: [],
				},
				transactions_preview: [],
				note: "n",
			},
		],
	])("%s", (_name, schema, preview) => {
		const parsed = schema.safeParse({ ...preview, warnings });
		expect(parsed.success).toBe(true);
		expect(parsed.data).toHaveProperty("warnings", warnings);
	});
});
