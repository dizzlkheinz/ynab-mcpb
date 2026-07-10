import { describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import type { DeltaFetcher } from "../deltaFetcher.js";
import {
	AnalyzeSpendingSchema,
	handleAnalyzeSpending,
	handleCompareSpendingPeriods,
} from "../spendingAnalytics.js";

function transaction(
	overrides: Partial<ynab.TransactionDetail>,
): ynab.TransactionDetail {
	return {
		id: "transaction-1",
		date: "2026-07-09",
		amount: -10_000,
		memo: "",
		cleared: "cleared",
		approved: true,
		account_id: "account-1",
		account_name: "Checking",
		payee_id: "payee-1",
		payee_name: "Store",
		category_id: "category-1",
		category_name: "Groceries",
		deleted: false,
		subtransactions: [],
		...overrides,
	};
}

function fetcher(dataBySince: Record<string, ynab.TransactionDetail[]>) {
	return {
		fetchTransactions: vi.fn(async (_budgetId: string, sinceDate?: string) => ({
			data: dataBySince[sinceDate ?? ""] ?? [],
			wasCached: false,
			usedDelta: true,
			serverKnowledge: 1,
		})),
	} as unknown as DeltaFetcher;
}

function structured(result: Awaited<ReturnType<typeof handleAnalyzeSpending>>) {
	return result.structuredContent as Record<string, unknown>;
}

describe("deterministic spending analytics", () => {
	it("validates both inclusive date boundaries", () => {
		expect(() =>
			AnalyzeSpendingSchema.parse({
				since_date: "2026-07-10",
				until_date: "2026-07-09",
				group_by: "category",
			}),
		).toThrow("since_date must be on or before until_date");
	});

	it("calculates complete totals before grouping and excludes transfers", async () => {
		const data = [
			transaction({ id: "before", date: "2026-07-01", amount: -99_000 }),
			transaction({ id: "start", date: "2026-07-02", amount: -10_000 }),
			transaction({ id: "income", date: "2026-07-03", amount: 50_000 }),
			transaction({
				id: "transfer",
				date: "2026-07-04",
				amount: -20_000,
				transfer_account_id: "account-2",
			}),
			transaction({ id: "end", date: "2026-07-05", amount: -5_000 }),
			transaction({ id: "after", date: "2026-07-06", amount: -99_000 }),
		];
		const output = structured(
			await handleAnalyzeSpending(
				{} as ynab.API,
				fetcher({ "2026-07-02": data }),
				{
					budget_id: "budget-1",
					since_date: "2026-07-02",
					until_date: "2026-07-05",
					group_by: "payee",
					include_transfers: false,
				},
			),
		);
		expect(output["totals"]).toEqual(
			expect.objectContaining({
				income: 50,
				spending: 15,
				net: 35,
				transaction_count: 3,
			}),
		);
		expect(output["excluded_transfer_count"]).toBe(1);
	});

	it("expands split transactions for category groups without corrupting totals", async () => {
		const split = transaction({
			amount: -15_000,
			category_id: undefined,
			category_name: "Split",
			subtransactions: [
				{
					id: "sub-1",
					transaction_id: "transaction-1",
					amount: -10_000,
					category_id: "food",
					category_name: "Food",
					deleted: false,
				},
				{
					id: "sub-2",
					transaction_id: "transaction-1",
					amount: -5_000,
					category_id: "tax",
					category_name: "Tax",
					deleted: false,
				},
			],
		});
		const output = structured(
			await handleAnalyzeSpending(
				{} as ynab.API,
				fetcher({ "2026-07-01": [split] }),
				{
					budget_id: "budget-1",
					since_date: "2026-07-01",
					until_date: "2026-07-31",
					group_by: "category",
				},
			),
		);
		expect(output["totals"]).toEqual(
			expect.objectContaining({ spending: 15, transaction_count: 1 }),
		);
		expect(output["groups"]).toEqual([
			expect.objectContaining({ key: "food", spending: 10 }),
			expect.objectContaining({ key: "tax", spending: 5 }),
		]);
	});

	it("compares two complete periods in code", async () => {
		const result = await handleCompareSpendingPeriods(
			{} as ynab.API,
			fetcher({
				"2026-06-01": [transaction({ date: "2026-06-10", amount: -10_000 })],
				"2026-07-01": [transaction({ date: "2026-07-10", amount: -25_000 })],
			}),
			{
				budget_id: "budget-1",
				period_a: { since_date: "2026-06-01", until_date: "2026-06-30" },
				period_b: { since_date: "2026-07-01", until_date: "2026-07-31" },
				group_by: "account",
			},
		);
		const output = result.structuredContent as Record<string, unknown>;
		expect(output["difference"]).toEqual(
			expect.objectContaining({ spending: 15, net: -15 }),
		);
	});

	it("groups weeks from Monday and months deterministically", async () => {
		const data = [
			transaction({ id: "sun", date: "2026-07-12", amount: -1_000 }),
			transaction({ id: "mon", date: "2026-07-13", amount: -2_000 }),
		];
		const weekly = structured(
			await handleAnalyzeSpending(
				{} as ynab.API,
				fetcher({ "2026-07-01": data }),
				{
					budget_id: "budget-1",
					since_date: "2026-07-01",
					until_date: "2026-07-31",
					group_by: "week",
				},
			),
		);
		expect(weekly["groups"]).toEqual([
			expect.objectContaining({ key: "2026-07-13" }),
			expect.objectContaining({ key: "2026-07-06" }),
		]);
	});
});
