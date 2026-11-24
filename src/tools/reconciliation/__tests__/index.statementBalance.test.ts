import { describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import { textOf } from "../../../__tests__/testUtils.js";
import { CacheManager } from "../../../server/cacheManager.js";
import { DeltaFetcher } from "../../deltaFetcher.js";

import { handleReconcileAccount, ReconcileAccountSchema } from "../index.js";

describe("handleReconcileAccount statement balance handling", () => {
	it("preserves a positive liability statement balance instead of forcing it negative", async () => {
		const ynabAPI = {
			accounts: {
				getAccounts: vi.fn().mockResolvedValue({
					data: {
						accounts: [
							{
								id: "credit-card",
								name: "Credit Card",
								type: "creditCard",
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
				getTransactionsByAccount: vi.fn().mockResolvedValue({
					data: {
						transactions: [],
						server_knowledge: 1,
					},
				}),
			},
			plans: {
				getPlanById: vi.fn().mockResolvedValue({
					data: {
						plan: {
							currency_format: {
								iso_code: "USD",
								decimal_digits: 2,
							},
						},
					},
				}),
			},
		} as unknown as ynab.API;
		const deltaFetcher = new DeltaFetcher(ynabAPI, {} as any);

		const result = await handleReconcileAccount(
			ynabAPI,
			ReconcileAccountSchema.parse({
				budget_id: "budget-1",
				account_id: "credit-card",
				csv_data: "Date,Description,Amount\n",
				statement_balance: 10,
				auto_create_transactions: false,
				auto_update_cleared_status: false,
				auto_unclear_missing: false,
				auto_adjust_dates: false,
				dry_run: true,
			}),
			{ cacheManager: new CacheManager(), deltaFetcher: deltaFetcher },
		);

		// The real analyzer reports the statement balance it was given: +10, not -10.
		const report = textOf(result.content[0]);
		expect(report).toMatch(/Statement Balance:\s+\$10\.00/);
		expect(report).not.toMatch(/Statement Balance:\s+-\$10\.00/);
	});
});
