import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "../executor.js";
import { buildReconciliationPayload } from "../outputBuilder.js";
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

const baseAnalysis: ReconciliationAnalysis = {
	success: true,
	phase: "analysis",
	summary: {
		statement_date_range: "2025-10-01 to 2025-10-31",
		bank_transactions_count: 1,
		ynab_transactions_count: 1,
		ynab_in_range_count: 1,
		ynab_outside_range_count: 0,
		auto_matched: 0,
		suggested_matches: 0,
		unmatched_bank: 0,
		unmatched_ynab: 0,
		current_cleared_balance: makeMoney(-899.02),
		target_statement_balance: makeMoney(-921.24),
		discrepancy: makeMoney(22.22),
		discrepancy_explanation: "Need to investigate discrepancy",
	},
	auto_matches: [],
	suggested_matches: [],
	unmatched_bank: [],
	unmatched_ynab: [],
	ynab_outside_date_range: [],
	balance_info: {
		current_cleared: makeMoney(-899.02),
		current_uncleared: makeMoney(0),
		current_total: makeMoney(-899.02),
		target_statement: makeMoney(-921.24),
		discrepancy: makeMoney(22.22),
		on_track: false,
	},
	next_steps: [],
	insights: [],
};

const execution: ExecutionResult = {
	summary: {
		bank_transactions_count: 1,
		ynab_transactions_count: 1,
		matches_found: 0,
		missing_in_ynab: 0,
		missing_in_bank: 0,
		transactions_created: 0,
		transactions_updated: 0,
		dates_adjusted: 0,
		dry_run: false,
	},
	account_balance: {
		before: {
			balance: -899020,
			cleared_balance: -899020,
			uncleared_balance: 0,
		},
		after: { balance: -921240, cleared_balance: -921240, uncleared_balance: 0 },
	},
	recommendations: [],
	balance_reconciliation: {
		status: "unbalanced",
		precision_calculations: {
			bank_statement_balance_milliunits: -921240,
			ynab_calculated_balance_milliunits: -899020,
			discrepancy_milliunits: -22220,
			currency_decimal_digits: 2,
			discrepancy_dollars: -22.22,
		},
		discrepancy_analysis: {
			confidence_level: 0.8,
			risk_assessment: "MEDIUM",
			likely_causes: [
				{
					cause_type: "BANK_FEE",
					description: "Monthly service fee detected",
					confidence: 0.7,
					amount_milliunits: -1500,
					suggested_resolution: "Record bank fee",
					evidence: [],
				},
				{
					cause_type: "INTEREST",
					description: "Interest credit",
					confidence: 0.5,
					amount_milliunits: 500,
					suggested_resolution: "Record interest income",
					evidence: [],
				},
			],
		},
		final_verification: {
			balance_matches_exactly: false,
			all_transactions_accounted: false,
			audit_trail_complete: false,
			reconciliation_complete: false,
		},
	},
};

describe("public reconciliation execution failures", () => {
	it("keeps failed write details in both response channels", () => {
		const failed = {
			...execution,
			errors: ["Write outcome uncertain: connection lost"],
			recommendations: ["Check YNAB before retrying"],
		};
		const payload = buildReconciliationPayload(
			baseAnalysis,
			{ currencyCode: "CAD" },
			failed,
		);
		expect(payload.structured.errors).toEqual(failed.errors);
		expect(payload.human).toContain("connection lost");
		expect(payload.human).not.toContain("already up to date");
		expect(payload.structured.execution_summary?.balance_status).toBe(
			"unbalanced",
		);
	});
});
