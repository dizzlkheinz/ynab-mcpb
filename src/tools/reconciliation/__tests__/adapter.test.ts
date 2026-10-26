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

const buildAnalysis = (): ReconciliationAnalysis => ({
	success: true,
	phase: "analysis",
	summary: {
		statement_date_range: "2025-10-01 to 2025-10-31",
		bank_transactions_count: 3,
		ynab_transactions_count: 4,
		ynab_in_range_count: 4,
		ynab_outside_range_count: 0,
		auto_matched: 2,
		suggested_matches: 1,
		unmatched_bank: 1,
		unmatched_ynab: 1,
		current_cleared_balance: makeMoney(-899.02),
		target_statement_balance: makeMoney(-921.24),
		discrepancy: makeMoney(22.22),
		discrepancy_explanation: "Need to add 1 missing transaction",
	},
	auto_matches: [
		{
			bankTransaction: {
				id: "bank-1",
				date: "2025-10-15",
				amount: -45230,
				payee: "Shell Gas",
				sourceRow: 2,
				raw: { date: "2025-10-15", amount: "-45.23", description: "Shell Gas" },
			},
			ynabTransaction: {
				id: "ynab-1",
				date: "2025-10-14",
				amount: -45230,
				payee: "Shell",
				categoryName: "Auto",
				cleared: "uncleared",
				approved: true,
				memo: null,
			},
			candidates: [],
			confidence: "high",
			confidenceScore: 97,
			matchReason: "exact_amount_and_date",
			topConfidence: 97,
			actionHint: "mark_cleared",
		},
	],
	suggested_matches: [
		{
			bankTransaction: {
				id: "bank-2",
				date: "2025-10-20",
				amount: -60000,
				payee: "Amazon",
				sourceRow: 5,
				raw: { date: "2025-10-20", amount: "-60.00", description: "Amazon" },
			},
			candidates: [
				{
					ynab_transaction: {
						id: "ynab-2",
						date: "2025-10-19",
						amount: -60000,
						payee: "Amazon Online",
						categoryName: "Shopping",
						cleared: "uncleared",
						approved: true,
						memo: null,
					},
					confidence: 75,
					match_reason: "amount_and_date_fuzzy_payee",
					explanation: "Amount matches, date off by 1 day",
				},
			],
			confidence: "medium",
			confidenceScore: 75,
			matchReason: "amount_and_date_fuzzy_payee",
			topConfidence: 75,
		},
	],
	unmatched_bank: [
		{
			id: "bank-3",
			date: "2025-10-25",
			amount: 22220,
			payee: "EvoCarShare",
			sourceRow: 7,
			raw: { date: "2025-10-25", amount: "22.22", description: "EvoCarShare" },
		},
	],
	unmatched_ynab: [
		{
			id: "ynab-3",
			date: "2025-10-26",
			amount: -15000,
			payee: "Coffee Shop",
			categoryName: "Dining",
			cleared: "cleared",
			approved: true,
			memo: null,
		},
	],
	ynab_outside_date_range: [],
	balance_info: {
		current_cleared: makeMoney(-899.02),
		current_uncleared: makeMoney(-45.23),
		current_total: makeMoney(-944.25),
		target_statement: makeMoney(-921.24),
		discrepancy: makeMoney(22.22),
		on_track: false,
	},
	next_steps: [
		"Review 2 auto-matched transactions",
		"Add missing bank transaction",
	],
	insights: [
		{
			id: "repeat-22.22",
			type: "repeat_amount",
			severity: "warning",
			title: "1 unmatched transaction at $22.22",
			description: "Matches statement discrepancy",
			evidence: { csv_rows: [7] },
		},
	],
});

describe("buildReconciliationPayload", () => {
	it("returns human narrative and structured payload with MoneyValue fields", () => {
		const payload = buildReconciliationPayload(buildAnalysis(), {
			accountName: "K TD FCT VISA",
			accountId: "account-123",
			currencyCode: "USD",
		});

		expect(payload.human).toContain("K TD FCT VISA Reconciliation Report");
		expect(payload.human.toUpperCase()).toContain("DISCREPANCY");

		expect(payload.structured.unmatched_bank[0]?.amount_money.currency).toBe(
			"USD",
		);
		expect(
			payload.structured.suggestions[0]?.bank_transaction.amount_money
				.value_milliunits,
		).toBe(-60000);
	});

	it("includes execution data when provided", () => {
		const execution: ExecutionResult = {
			summary: {
				bank_transactions_count: 3,
				ynab_transactions_count: 4,
				matches_found: 2,
				missing_in_ynab: 1,
				missing_in_bank: 1,
				transactions_created: 1,
				transactions_updated: 1,
				dates_adjusted: 0,
				dry_run: false,
			},
			account_balance: {
				before: {
					balance: -899020,
					cleared_balance: -899020,
					uncleared_balance: 0,
				},
				after: {
					balance: -921240,
					cleared_balance: -921240,
					uncleared_balance: 0,
				},
			},

			recommendations: ["Review EvoCarShare discrepancy"],
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
					confidence_level: 0.95,
					likely_causes: [
						{
							cause_type: "MISSING_TRANSACTION",
							description: "EvoCarShare transaction missing in YNAB",
							confidence: 0.95,
							amount_milliunits: 22220,
							suggested_resolution: "Create transaction and mark cleared",
							evidence: [],
						},
					],
					risk_assessment: "LOW",
				},
				final_verification: {
					balance_matches_exactly: false,
					all_transactions_accounted: false,
					audit_trail_complete: false,
					reconciliation_complete: false,
				},
			},
		};

		const payload = buildReconciliationPayload(
			buildAnalysis(),
			{
				accountName: "K TD FCT VISA",
				accountId: "account-123",
				currencyCode: "CAD",
			},
			execution,
		);

		expect(payload.structured.execution_summary?.transactions_created).toBe(1);
		expect(payload.structured.execution_summary?.balance_status).toBe(
			"unbalanced",
		);
		expect(payload.structured.unmatched_bank[0]?.amount_money.currency).toBe(
			"CAD",
		);
		expect(payload.human).toContain("change(s) applied to YNAB");
	});

	it("limits human output entries when maxSuggestionsInOutput is provided", () => {
		const analysis = buildAnalysis();
		analysis.unmatched_bank = [
			{
				id: "bank-3",
				date: "2025-10-25",
				amount: 22220,
				payee: "First Missing Transaction",
				sourceRow: 7,
				raw: {
					date: "2025-10-25",
					amount: "22.22",
					description: "First Missing Transaction",
				},
			},
			{
				id: "bank-4",
				date: "2025-10-26",
				amount: 33330,
				payee: "Second Missing Transaction",
				sourceRow: 8,
				raw: {
					date: "2025-10-26",
					amount: "33.33",
					description: "Second Missing Transaction",
				},
			},
		];
		analysis.summary.unmatched_bank = analysis.unmatched_bank.length;
		analysis.suggested_matches = [];
		analysis.summary.suggested_matches = 0;

		const payload = buildReconciliationPayload(analysis, {
			accountName: "K TD FCT VISA",
			maxSuggestionsInOutput: 1,
		});

		expect(payload.human).toContain("First Missing Transaction");
		expect(payload.human).not.toContain("Second Missing Transaction");
		expect(payload.human).toContain("... and 1 more");
	});
});
