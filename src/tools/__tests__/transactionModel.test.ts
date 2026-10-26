import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import { CacheManager } from "../../server/cacheManager.js";
import type { ReadDeps } from "../../types/toolRegistration.js";
import type { DeltaFetcher } from "../deltaFetcher.js";
import { handleExportTransactions } from "../exportTransactions.js";
import {
	CreateTransactionOutputSchema,
	DeleteTransactionOutputSchema,
	ExportTransactionsOutputSchema,
	GetTransactionOutputSchema,
	ListTransactionsOutputSchema,
	UpdateTransactionOutputSchema,
} from "../schemas/outputs/index.js";
import {
	TransactionModelSchema,
	TransactionOutputSchema,
	toTransactionOutput,
} from "../transactionModel.js";
import {
	handleGetTransaction,
	handleListTransactions,
} from "../transactionReadTools.js";
import {
	CreateTransactionSchema,
	UpdateTransactionsSchema,
} from "../transactionSchemas.js";
import {
	handleCreateTransaction,
	handleDeleteTransaction,
	handleUpdateTransaction,
	handleUpdateTransactions,
} from "../transactionWriteTools.js";

vi.mock("node:fs", () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn() }));

const transaction = TransactionModelSchema.parse({
	id: "transaction-1",
	date: "2026-10-01",
	amount: -12_345,
	account_id: "account-1",
	account_name: "Checking",
	payee_id: "shop",
	payee_name: "Shop",
	category_id: null,
	category_name: "Split",
	memo: null,
	flag_color: null,
	flag_name: "Review",
	import_payee_name_original: "SHOP #123",
	cleared: "uncleared",
	approved: false,
	deleted: false,
	subtransactions: [
		{
			id: "line-1",
			transaction_id: "transaction-1",
			amount: -12_345,
			category_id: "groceries",
			category_name: "Groceries",
			memo: "Dinner",
			deleted: false,
		},
	],
});

function fixture() {
	const api = {
		transactions: {
			getTransactionById: vi.fn().mockResolvedValue({ data: { transaction } }),
			getTransactions: vi
				.fn()
				.mockResolvedValue({ data: { transactions: [transaction] } }),
			createTransaction: vi.fn().mockResolvedValue({ data: { transaction } }),
			updateTransaction: vi.fn().mockResolvedValue({ data: { transaction } }),
			deleteTransaction: vi.fn().mockResolvedValue({
				data: { transaction: { ...transaction, deleted: true } },
			}),
			updateTransactions: vi
				.fn()
				.mockResolvedValue({ data: { transactions: [transaction] } }),
		},
		accounts: {
			getAccountById: vi
				.fn()
				.mockRejectedValue(new Error("Balance lookup unavailable")),
		},
	} as unknown as ynab.API;
	const deps: ReadDeps = {
		cacheManager: new CacheManager(),
		deltaFetcher: {
			fetchTransactions: vi.fn().mockResolvedValue({
				data: [transaction],
				wasCached: false,
				usedDelta: false,
			}),
		} as unknown as DeltaFetcher,
	};
	return { api, deps };
}

beforeEach(() => vi.clearAllMocks());

describe("shared transaction representation", () => {
	it("keeps domain and nested amounts integral and serializes without mutating them", () => {
		const output = toTransactionOutput(transaction);
		expect(TransactionOutputSchema.parse(output)).toMatchObject({
			amount: -12.345,
			amount_milliunits: -12_345,
			subtransactions: [{ amount: -12.345, amount_milliunits: -12_345 }],
		});
		expect(transaction.amount).toBe(-12_345);
		expect(transaction.subtransactions?.[0]?.amount).toBe(-12_345);
		expect(
			TransactionModelSchema.safeParse({ ...transaction, amount: -12.345 })
				.success,
		).toBe(false);
	});

	it("returns the same complete representation from reads, writes, and full export", async () => {
		const { api, deps } = fixture();
		const expected = toTransactionOutput(transaction);
		const list = await handleListTransactions(
			api,
			{ budget_id: "budget" },
			deps,
		);
		const detail = await handleGetTransaction(
			api,
			{ budget_id: "budget", transaction_id: transaction.id },
			deps,
		);
		const created = await handleCreateTransaction(api, {
			budget_id: "budget",
			account_id: transaction.account_id,
			date: transaction.date,
			amount: transaction.amount,
		});
		const updated = await handleUpdateTransaction(api, {
			budget_id: "budget",
			transaction_id: transaction.id,
			memo: "Dinner",
		});
		const exportResult = await handleExportTransactions(api, {
			budget_id: "budget",
			minimal: false,
		});
		const fileContents = vi.mocked(writeFileSync).mock.calls[0]?.[1];
		const exported = JSON.parse(String(fileContents));

		expect(list.structuredContent?.["transactions"]).toEqual([expected]);
		expect(detail.structuredContent?.["transaction"]).toEqual(expected);
		expect(created.structuredContent?.["transaction"]).toEqual(expected);
		expect(updated.structuredContent?.["transaction"]).toEqual(expected);
		expect(exported.transactions).toEqual([expected]);
		expect(
			ListTransactionsOutputSchema.parse(list.structuredContent),
		).toMatchObject({ transactions: [expected] });
		expect(
			GetTransactionOutputSchema.parse(detail.structuredContent).transaction,
		).toEqual(expected);
		expect(
			CreateTransactionOutputSchema.parse(created.structuredContent),
		).toMatchObject({ transaction: expected });
		expect(
			UpdateTransactionOutputSchema.parse(updated.structuredContent),
		).toMatchObject({ transaction: expected });
		expect(
			ExportTransactionsOutputSchema.parse(exportResult.structuredContent)
				.preview_transactions,
		).toEqual([expected]);
		expect(
			DeleteTransactionOutputSchema.parse({
				message: "Deleted",
				transaction: { ...expected, deleted: true },
			}),
		).toMatchObject({ transaction: { ...expected, deleted: true } });

		expect(JSON.stringify(list.content)).toContain("Shop");
		expect(JSON.stringify(detail.content)).toContain("Groceries");
		expect(api.accounts.getAccountById).not.toHaveBeenCalled();
	});

	it("keeps committed creates, updates, and deletes successful without balance enrichment", async () => {
		const { api } = fixture();
		const results = await Promise.all([
			handleCreateTransaction(api, {
				budget_id: "budget",
				account_id: "account-1",
				date: "2026-10-01",
				amount: -1000,
			}),
			handleUpdateTransaction(api, {
				budget_id: "budget",
				transaction_id: transaction.id,
				memo: "Updated",
			}),
			handleDeleteTransaction(api, {
				budget_id: "budget",
				transaction_id: transaction.id,
			}),
		]);
		for (const result of results) {
			expect(result.isError).not.toBe(true);
			expect(result.structuredContent?.["transaction"]).toMatchObject({
				id: transaction.id,
			});
		}
		expect(api.accounts.getAccountById).not.toHaveBeenCalled();
		expect(api.transactions.getTransactionById).not.toHaveBeenCalled();
	});

	it("uses the same amount and split conversion for previews without sending writes", async () => {
		const { api } = fixture();
		const preview = await handleCreateTransaction(
			api,
			CreateTransactionSchema.parse({
				budget_id: "budget",
				account_id: "account-1",
				date: "2026-10-01",
				amount_decimal: -12.345,
				dry_run: true,
				subtransactions: [
					{ amount_decimal: -12.345, category_id: "groceries" },
				],
			}),
		);
		expect(preview.structuredContent?.["request"]).toMatchObject({
			amount: -12.345,
			amount_milliunits: -12_345,
			subtransactions: [{ amount: -12.345, amount_milliunits: -12_345 }],
		});
		const changes = await handleUpdateTransactions(
			api,
			UpdateTransactionsSchema.parse({
				budget_id: "budget",
				dry_run: true,
				transactions: [{ id: transaction.id, amount_decimal: -13 }],
			}),
		);
		expect(changes.structuredContent?.["transactions_preview"]).toMatchObject([
			{
				before: { amount: -12.345, amount_milliunits: -12_345 },
				after: { amount: -13, amount_milliunits: -13_000 },
			},
		]);
		expect(api.transactions.createTransaction).not.toHaveBeenCalled();
		expect(api.transactions.updateTransactions).not.toHaveBeenCalled();
	});
});
