import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type * as ynab from "ynab";
import type { DeltaCache } from "../../../server/deltaCache.js";
import { DeltaFetcher } from "../../deltaFetcher.js";
import { handleReconcileAccount, ReconcileAccountSchema } from "../index.js";

// These tests stub ynabAPI directly, so the fetcher's delta cache is never used
const unusedDeltaCache = {} as unknown as DeltaCache;

describe("ReconcileAccountSchema", () => {
	it("parses params and respects max_suggestions_in_output", () => {
		const result = ReconcileAccountSchema.parse({
			budget_id: "budget-1",
			account_id: "account-1",
			csv_data: "Date,Description,Amount\n2025-01-01,Coffee,-10.00",
			statement_balance: -10,
			max_suggestions_in_output: 3,
		});

		expect(result.max_suggestions_in_output).toBe(3);
	});

	it("defaults max_suggestions_in_output to 20 when omitted", () => {
		const result = ReconcileAccountSchema.parse({
			budget_id: "budget-1",
			account_id: "account-1",
			csv_data: "Date,Description,Amount\n2025-01-01,Coffee,-10.00",
			statement_balance: -10,
		});

		expect(result.max_suggestions_in_output).toBe(20);
	});

	it("defaults auto_unclear_missing to false when omitted", () => {
		const result = ReconcileAccountSchema.parse({
			budget_id: "budget-1",
			account_id: "account-1",
			csv_data: "Date,Description,Amount\n2025-01-01,Coffee,-10.00",
			statement_balance: -10,
		});

		expect(result.auto_unclear_missing).toBe(false);
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

const buildEmptyAccountAPI = () =>
	({
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
	}) as unknown as ynab.API;

describe("handleReconcileAccount", () => {
	it("reports an empty CSV file as empty rather than as a read failure", async () => {
		const dir = await mkdtemp(join(tmpdir(), "reconcile-empty-"));
		const csvPath = join(dir, "statement.csv");
		await writeFile(csvPath, "");
		const ynabAPI = buildEmptyAccountAPI();

		try {
			const result = await handleReconcileAccount(
				ynabAPI,
				{
					budget_id: "budget-1",
					account_id: "account-1",
					csv_file_path: csvPath,
					statement_balance: -10,
				},
				{ deltaFetcher: new DeltaFetcher(ynabAPI, unusedDeltaCache) },
			);

			expect(result.isError).toBe(true);
			const text = JSON.stringify(result.content);
			expect(text).toMatch(/CSV content is empty/);
			expect(text).not.toMatch(/Failed to read CSV file/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("always returns unmatched_only structured content", async () => {
		const ynabAPI = buildEmptyAccountAPI();

		const deltaFetcher = new DeltaFetcher(ynabAPI, unusedDeltaCache);

		const result = await handleReconcileAccount(
			ynabAPI,
			{
				budget_id: "budget-1",
				account_id: "account-1",
				csv_data: "Date,Description,Amount\n2025-01-01,Coffee,-10.00",
				statement_balance: -10,
				auto_unclear_missing: false,
			},
			{ deltaFetcher: deltaFetcher },
		);

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
		expect(structured).toHaveProperty("execution_summary");
		expect(
			(
				structured["execution_summary"] as {
					balance_status?: string;
				}
			).balance_status,
		).toBe("unbalanced");
	});
});
