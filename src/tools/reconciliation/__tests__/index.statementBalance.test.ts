import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import { toMoneyValue } from "../../../utils/money.js";
import { DeltaFetcher } from "../../deltaFetcher.js";
import type { ReconciliationAnalysis } from "../types.js";

const analyzerMocks = vi.hoisted(() => ({
	analyzeReconciliation: vi.fn(),
}));

vi.mock("../analyzer.js", () => ({
	analyzeReconciliation: analyzerMocks.analyzeReconciliation,
}));

import { handleReconcileAccount } from "../index.js";

const buildAnalysis = (): ReconciliationAnalysis => ({
	success: true,
	phase: "analysis",
	summary: {
		statement_date_range: "Unknown",
		bank_transactions_count: 0,
		ynab_transactions_count: 0,
		ynab_in_range_count: 0,
		ynab_outside_range_count: 0,
		auto_matched: 0,
		suggested_matches: 0,
		unmatched_bank: 0,
		unmatched_ynab: 0,
		current_cleared_balance: toMoneyValue(0, "USD"),
		target_statement_balance: toMoneyValue(10000, "USD"),
		discrepancy: toMoneyValue(-10000, "USD"),
		discrepancy_explanation: "No transactions",
	},
	auto_matches: [],
	suggested_matches: [],
	unmatched_bank: [],
	unmatched_ynab: [],
	ynab_outside_date_range: [],
	balance_info: {
		current_cleared: toMoneyValue(0, "USD"),
		current_uncleared: toMoneyValue(0, "USD"),
		current_total: toMoneyValue(0, "USD"),
		target_statement: toMoneyValue(10000, "USD"),
		discrepancy: toMoneyValue(-10000, "USD"),
		on_track: false,
	},
	next_steps: [],
	insights: [],
});

describe("handleReconcileAccount statement balance handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		analyzerMocks.analyzeReconciliation.mockReturnValue(buildAnalysis());
	});

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

		await handleReconcileAccount(ynabAPI, deltaFetcher, {
			budget_id: "budget-1",
			account_id: "credit-card",
			csv_data: "Date,Description,Amount\n",
			statement_balance: 10,
			auto_create_transactions: false,
			auto_update_cleared_status: false,
			auto_unclear_missing: false,
			auto_adjust_dates: false,
			dry_run: true,
		});

		expect(analyzerMocks.analyzeReconciliation).toHaveBeenCalled();
		expect(analyzerMocks.analyzeReconciliation.mock.calls[0]?.[3]).toBe(10);
	});
});
