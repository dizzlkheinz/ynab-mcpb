import { describe, expect, it } from "vitest";
import { UpdateCategorySchema } from "../categoryTools.js";
import {
	CreateTransactionSchema,
	CreateTransactionsSchema,
	UpdateTransactionSchema,
	UpdateTransactionsSchema,
} from "../transactionSchemas.js";

describe("public monetary input contract", () => {
	it("normalizes decimal transaction amounts with exact milliunit rounding", () => {
		const parsed = CreateTransactionSchema.parse({
			account_id: "account-1",
			amount_decimal: -12.3456,
			date: "2026-07-09",
		});
		expect(parsed.amount).toBe(-12_346);
		expect(parsed).not.toHaveProperty("amount_decimal");
	});

	it("accepts explicitly named raw milliunits", () => {
		const parsed = UpdateTransactionSchema.parse({
			transaction_id: "transaction-1",
			amount_milliunits: 12_345,
		});
		expect(parsed.amount).toBe(12_345);
	});

	it("preserves the deprecated amount field as milliunits without guessing", () => {
		const parsed = CreateTransactionSchema.parse({
			account_id: "account-1",
			amount: 12_345,
			date: "2026-07-09",
		});
		expect(parsed.amount).toBe(12_345);
	});

	it("rejects ambiguous transaction representations", () => {
		expect(() =>
			CreateTransactionSchema.parse({
				account_id: "account-1",
				amount_decimal: 12.34,
				amount_milliunits: 12_340,
				date: "2026-07-09",
			}),
		).toThrow("Provide exactly one");
	});

	it("uses the same convention for manual subtransactions", () => {
		const parsed = CreateTransactionSchema.parse({
			account_id: "account-1",
			amount_decimal: -15,
			date: "2026-07-09",
			subtransactions: [
				{ amount_decimal: -10, category_id: "category-1" },
				{ amount_milliunits: -5_000, category_id: "category-2" },
			],
		});
		expect(parsed.subtransactions?.map((item) => item.amount)).toEqual([
			-10_000, -5_000,
		]);
	});

	it("normalizes decimal amounts in bulk creates and updates", () => {
		const creates = CreateTransactionsSchema.parse({
			transactions: [
				{
					account_id: "account-1",
					amount_decimal: -1.01,
					date: "2026-07-09",
				},
			],
		});
		const updates = UpdateTransactionsSchema.parse({
			transactions: [{ id: "transaction-1", amount_decimal: 2.345 }],
		});
		expect(creates.transactions[0]?.amount).toBe(-1_010);
		expect(updates.transactions[0]?.amount).toBe(2_345);
	});

	it("normalizes category funding while preserving its legacy alias", () => {
		expect(
			UpdateCategorySchema.parse({
				category_id: "category-1",
				budgeted_decimal: 100.125,
			}).budgeted,
		).toBe(100_125);
		expect(
			UpdateCategorySchema.parse({
				category_id: "category-1",
				budgeted: 100_125,
			}).budgeted,
		).toBe(100_125);
	});
});
