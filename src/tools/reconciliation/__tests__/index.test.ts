import { describe, expect, it } from "vitest";
import type * as ynab from "ynab";
import { DeltaFetcher } from "../../deltaFetcher.js";
import { handleReconcileAccount, ReconcileAccountSchema } from "../index.js";

describe("ReconcileAccountSchema", () => {
	it("parses new response options and defaults structured_content to full", () => {
		const result = ReconcileAccountSchema.parse({
			budget_id: "budget-1",
			account_id: "account-1",
			csv_data: "Date,Description,Amount\n2025-01-01,Coffee,-10.00",
			statement_balance: -10,
			max_suggestions_in_output: 3,
		});

		expect(result.structured_content).toBe("full");
		expect(result.max_suggestions_in_output).toBe(3);
	});

	it("returns the improved CSV requirement message when no CSV input is provided", () => {
		const result = ReconcileAccountSchema.safeParse({
			budget_id: "budget-1",
			account_id: "account-1",
			statement_balance: -10,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toContain(
				"csv_data or csv_file_path is required",
			);
			expect(result.error.issues[0]?.message).toContain(
				"ynab_list_transactions with a cleared filter",
			);
		}
	});
});

describe("handleReconcileAccount", () => {
	it('returns filtered structured content for "unmatched_only"', async () => {
		const ynabAPI = {
			accounts: {
				getAccounts: async () => ({
					data: {
						accounts: [
							{
								id: "account-1",
								name: "Checking",
								type: "checking",
								balance: 0,
								cleared_balance: 0,
								uncleared_balance: 0,
								deleted: false,
							},
						],
						server_knowledge: 1,
					},
				}),
			},
			transactions: {
				getTransactionsByAccount: async () => ({
					data: {
						transactions: [],
						server_knowledge: 1,
					},
				}),
			},
			plans: {
				getPlanById: async () => ({
					data: {
						plan: {
							currency_format: {
								iso_code: "USD",
							},
						},
					},
				}),
			},
		} as unknown as ynab.API;

		const deltaFetcher = new DeltaFetcher(ynabAPI, {} as any);

		const result = await handleReconcileAccount(ynabAPI, deltaFetcher, {
			budget_id: "budget-1",
			account_id: "account-1",
			csv_data: "Date,Description,Amount\n2025-01-01,Coffee,-10.00",
			statement_balance: -10,
			include_structured_data: true,
			structured_content: "unmatched_only",
			auto_unclear_missing: false,
			force_full_refresh: true,
		});

		const structured = (result.structuredContent as Record<string, unknown>)
			.structured as Record<string, unknown>;

		expect(structured).toHaveProperty("unmatched_bank");
		expect(structured).toHaveProperty("unmatched_ynab");
		expect(structured).toHaveProperty("suggestions");
		expect(structured).not.toHaveProperty("summary");
		expect(structured).not.toHaveProperty("balance");
		expect(structured).not.toHaveProperty("matches");
		expect(structured).not.toHaveProperty("unmatched");
		expect(Array.isArray(structured["unmatched_bank"])).toBe(true);
		expect(Array.isArray(structured["unmatched_ynab"])).toBe(true);
		expect(Array.isArray(structured["suggestions"])).toBe(true);
	});
});
