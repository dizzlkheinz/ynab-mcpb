import { describe, expect, it } from "vitest";
import { buildReconciliationPayload } from "../../reconcileAdapter.js";
import type { ReconciliationAnalysis } from "../types.js";

const makeMoney = (value: number, currency = "USD") => ({
	value_milliunits: Math.round(value * 1000),
	value,
	value_display:
		value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`,
	currency,
	direction: (value === 0 ? "balanced" : value > 0 ? "credit" : "debit") as
		| "balanced"
		| "credit"
		| "debit",
});

const minimalAnalysis: ReconciliationAnalysis = {
	success: true,
	phase: "analysis",
	summary: {
		statement_date_range: "2025-10-01 to 2025-10-31",
		bank_transactions_count: 0,
		ynab_transactions_count: 0,
		ynab_in_range_count: 0,
		ynab_outside_range_count: 0,
		auto_matched: 0,
		suggested_matches: 0,
		unmatched_bank: 0,
		unmatched_ynab: 0,
		current_cleared_balance: makeMoney(0),
		target_statement_balance: makeMoney(0),
		discrepancy: makeMoney(0),
		discrepancy_explanation: "Balanced",
	},
	auto_matches: [],
	suggested_matches: [],
	unmatched_bank: [],
	unmatched_ynab: [],
	ynab_outside_date_range: [],
	balance_info: {
		current_cleared: makeMoney(0),
		current_uncleared: makeMoney(0),
		current_total: makeMoney(0),
		target_statement: makeMoney(0),
		discrepancy: makeMoney(0),
		on_track: true,
	},
	next_steps: [],
	insights: [],
};

describe("buildReconciliationPayload schema reference", () => {
	it("points to the master branch schema file on raw.githubusercontent.com", () => {
		const { structured } = buildReconciliationPayload(minimalAnalysis, {
			accountId: "acct-id",
			accountName: "Checking",
			currencyCode: "USD",
		});

		const schemaUrl = (structured as Record<string, unknown>).schema_url;
		expect(schemaUrl).toContain("raw.githubusercontent.com");
		expect(schemaUrl).toContain("/docs/schemas/reconciliation-v2.json");
	});
});
