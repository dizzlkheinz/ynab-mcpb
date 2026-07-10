import { describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import type { DeltaCache } from "../../server/deltaCache.js";
import type { ServerKnowledgeStore } from "../../server/serverKnowledgeStore.js";
import type { DeltaFetcher } from "../deltaFetcher.js";
import {
	CreateScheduledTransactionSchema,
	handleCreateScheduledTransaction,
	handleDeleteScheduledTransaction,
	handleGetScheduledTransaction,
	handleListScheduledTransactions,
	handleUpdateScheduledTransaction,
	UpdateScheduledTransactionSchema,
} from "../scheduledTransactionTools.js";

const scheduled = {
	id: "scheduled-1",
	date_first: "2026-07-10",
	date_next: "2026-08-10",
	frequency: "monthly" as const,
	amount: -12_345,
	account_id: "account-1",
	account_name: "Checking",
	payee_id: "payee-1",
	payee_name: "Internet",
	category_id: "category-1",
	category_name: "Bills",
	memo: "Monthly bill",
	flag_color: null,
	deleted: false,
	subtransactions: [],
};

function parse(
	result: Awaited<ReturnType<typeof handleGetScheduledTransaction>>,
) {
	return result.structuredContent as Record<string, unknown>;
}

function apiMock() {
	return {
		scheduledTransactions: {
			getScheduledTransactionById: vi.fn().mockResolvedValue({
				data: { scheduled_transaction: scheduled },
			}),
			createScheduledTransaction: vi.fn().mockResolvedValue({
				data: { scheduled_transaction: scheduled },
			}),
			updateScheduledTransaction: vi.fn().mockResolvedValue({
				data: { scheduled_transaction: { ...scheduled, amount: -20_000 } },
			}),
			deleteScheduledTransaction: vi.fn().mockResolvedValue({
				data: { scheduled_transaction: { ...scheduled, deleted: true } },
			}),
		},
	} as unknown as ynab.API;
}

function cacheMock() {
	return {
		forceFullRefresh: vi.fn(),
	} as unknown as DeltaCache;
}

const knowledgeStore = {} as ServerKnowledgeStore;

describe("scheduled transaction tools", () => {
	it("lists normalized scheduled transactions from the delta cache", async () => {
		const deltaFetcher = {
			fetchScheduledTransactions: vi.fn().mockResolvedValue({
				data: [scheduled, { ...scheduled, id: "deleted", deleted: true }],
				wasCached: true,
				usedDelta: true,
			}),
		} as unknown as DeltaFetcher;
		const output = parse(
			await handleListScheduledTransactions(apiMock(), deltaFetcher, {
				budget_id: "budget-1",
				limit: 10,
				offset: 0,
			}),
		);
		expect(output["total_count"]).toBe(1);
		expect(output["cached"]).toBe(true);
		expect(output["scheduled_transactions"]).toEqual([
			expect.objectContaining({ amount: -12.345, amount_milliunits: -12_345 }),
		]);
	});

	it("gets one normalized scheduled transaction", async () => {
		const output = parse(
			await handleGetScheduledTransaction(apiMock(), {
				budget_id: "budget-1",
				scheduled_transaction_id: "scheduled-1",
			}),
		);
		expect(output["scheduled_transaction"]).toEqual(
			expect.objectContaining({ id: "scheduled-1", amount: -12.345 }),
		);
	});

	it("normalizes decimal create input and previews without an API write", async () => {
		const api = apiMock();
		const params = CreateScheduledTransactionSchema.parse({
			budget_id: "budget-1",
			account_id: "account-1",
			date: "2026-08-10",
			amount_decimal: -20.125,
			frequency: "monthly",
			dry_run: true,
		});
		const output = parse(
			await handleCreateScheduledTransaction(
				api,
				cacheMock(),
				knowledgeStore,
				params,
			),
		);
		expect(output).toMatchObject({
			dry_run: true,
			request: { amount: -20.125 },
		});
		expect(
			api.scheduledTransactions.createScheduledTransaction,
		).not.toHaveBeenCalled();
	});

	it("creates and invalidates scheduled delta state", async () => {
		const api = apiMock();
		const cache = cacheMock();
		const params = CreateScheduledTransactionSchema.parse({
			budget_id: "budget-1",
			account_id: "account-1",
			date: "2026-08-10",
			amount_milliunits: -20_125,
			frequency: "monthly",
		});
		await handleCreateScheduledTransaction(api, cache, knowledgeStore, params);
		expect(
			api.scheduledTransactions.createScheduledTransaction,
		).toHaveBeenCalledWith(
			"budget-1",
			expect.objectContaining({
				scheduled_transaction: expect.objectContaining({ amount: -20_125 }),
			}),
		);
		expect(cache.forceFullRefresh).toHaveBeenCalledWith(
			"budget-1",
			"scheduled_transactions",
		);
	});

	it("merges partial updates with required current fields", async () => {
		const api = apiMock();
		const cache = cacheMock();
		const params = UpdateScheduledTransactionSchema.parse({
			budget_id: "budget-1",
			scheduled_transaction_id: "scheduled-1",
			amount_decimal: -20,
		});
		await handleUpdateScheduledTransaction(api, cache, knowledgeStore, params);
		expect(
			api.scheduledTransactions.updateScheduledTransaction,
		).toHaveBeenCalledWith(
			"budget-1",
			"scheduled-1",
			expect.objectContaining({
				scheduled_transaction: expect.objectContaining({
					account_id: "account-1",
					date: "2026-08-10",
					amount: -20_000,
				}),
			}),
		);
	});

	it("preserves explicit nulls when clearing optional scheduled fields", async () => {
		const api = apiMock();
		const params = UpdateScheduledTransactionSchema.parse({
			budget_id: "budget-1",
			scheduled_transaction_id: "scheduled-1",
			payee_id: null,
			category_id: null,
			memo: null,
			flag_color: null,
		});
		await handleUpdateScheduledTransaction(
			api,
			cacheMock(),
			knowledgeStore,
			params,
		);
		expect(
			api.scheduledTransactions.updateScheduledTransaction,
		).toHaveBeenCalledWith(
			"budget-1",
			"scheduled-1",
			expect.objectContaining({
				scheduled_transaction: expect.objectContaining({
					payee_id: null,
					category_id: null,
					memo: null,
					flag_color: null,
				}),
			}),
		);
	});

	it("deletes and invalidates scheduled delta state", async () => {
		const api = apiMock();
		const cache = cacheMock();
		const output = parse(
			await handleDeleteScheduledTransaction(api, cache, knowledgeStore, {
				budget_id: "budget-1",
				scheduled_transaction_id: "scheduled-1",
			}),
		);
		expect(output).toEqual({
			success: true,
			scheduled_transaction_id: "scheduled-1",
		});
		expect(cache.forceFullRefresh).toHaveBeenCalled();
	});
});
