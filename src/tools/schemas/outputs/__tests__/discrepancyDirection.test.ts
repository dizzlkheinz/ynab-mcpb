import { describe, expect, it } from "vitest";
import {
	MoneyValueSchema,
	ReconcileAccountOutputSchema,
} from "../reconciliationOutputs.js";

describe("ReconcileAccountOutputSchema", () => {
	it("accepts valid unmatched_only structured output", () => {
		const output = {
			human: "Reconciliation complete",
			structured: {
				unmatched_bank: [],
				unmatched_ynab: [],
				suggestions: [],
			},
		};
		const result = ReconcileAccountOutputSchema.safeParse(output);
		expect(result.success).toBe(true);
	});

	it("rejects output without structured field", () => {
		const output = { human: "Reconciliation complete" };
		const result = ReconcileAccountOutputSchema.safeParse(output);
		expect(result.success).toBe(false);
	});

	it("rejects output with unknown fields in structured", () => {
		const output = {
			human: "Reconciliation complete",
			structured: {
				unmatched_bank: [],
				unmatched_ynab: [],
				suggestions: [],
				extra_field: "not allowed",
			},
		};
		const result = ReconcileAccountOutputSchema.safeParse(output);
		expect(result.success).toBe(false);
	});

	it("accepts output with execution_summary", () => {
		const output = {
			human: "Reconciliation complete",
			structured: {
				unmatched_bank: [],
				unmatched_ynab: [],
				suggestions: [],
				execution_summary: {
					transactions_created: 5,
					transactions_updated: 2,
					dates_adjusted: 0,
					dry_run: false,
					balance_status: "balanced",
					recommendations: ["Review matched transactions"],
				},
			},
		};
		const result = ReconcileAccountOutputSchema.safeParse(output);
		expect(result.success).toBe(true);
	});

	it("accepts output without execution_summary", () => {
		const output = {
			human: "Reconciliation complete",
			structured: {
				unmatched_bank: [],
				unmatched_ynab: [],
				suggestions: [],
			},
		};
		const result = ReconcileAccountOutputSchema.safeParse(output);
		expect(result.success).toBe(true);
	});
});

describe("MoneyValueSchema - non-finite value validation", () => {
	it("should reject NaN value", () => {
		const invalid = {
			value_milliunits: 0,
			value: Number.NaN,
			value_display: "$NaN",
			currency: "USD",
			direction: "balanced",
		};
		const result = MoneyValueSchema.safeParse(invalid);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["value"]);
		}
	});

	it("should reject positive Infinity value", () => {
		const invalid = {
			value_milliunits: 0,
			value: Number.POSITIVE_INFINITY,
			value_display: "$Infinity",
			currency: "USD",
			direction: "credit",
		};
		const result = MoneyValueSchema.safeParse(invalid);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["value"]);
		}
	});

	it("should reject negative Infinity value", () => {
		const invalid = {
			value_milliunits: 0,
			value: Number.NEGATIVE_INFINITY,
			value_display: "-$Infinity",
			currency: "USD",
			direction: "debit",
		};
		const result = MoneyValueSchema.safeParse(invalid);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["value"]);
		}
	});

	it("should reject non-integer value_milliunits", () => {
		const invalid = {
			value_milliunits: 25.5,
			value: 0.0255,
			value_display: "$0.03",
			currency: "USD",
			direction: "credit",
		};
		const result = MoneyValueSchema.safeParse(invalid);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(["value_milliunits"]);
		}
	});

	it("should accept finite positive amounts", () => {
		const valid = {
			value_milliunits: 25500,
			value: 25.5,
			value_display: "$25.50",
			currency: "USD",
			direction: "credit",
		};
		const result = MoneyValueSchema.safeParse(valid);
		expect(result.success).toBe(true);
	});

	it("should accept finite negative amounts", () => {
		const valid = {
			value_milliunits: -25500,
			value: -25.5,
			value_display: "-$25.50",
			currency: "USD",
			direction: "debit",
		};
		const result = MoneyValueSchema.safeParse(valid);
		expect(result.success).toBe(true);
	});

	it("should accept zero", () => {
		const valid = {
			value_milliunits: 0,
			value: 0,
			value_display: "$0.00",
			currency: "USD",
			direction: "balanced",
		};
		const result = MoneyValueSchema.safeParse(valid);
		expect(result.success).toBe(true);
	});
});
