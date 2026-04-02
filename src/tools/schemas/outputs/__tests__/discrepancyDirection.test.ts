import { describe, expect, it } from "vitest";
import {
	MoneyValueSchema,
	ReconcileAccountOutputSchema,
} from "../reconciliationOutputs.js";

/**
 * Test suite for discrepancy_direction validation refinement.
 *
 * The schema enforces that discrepancy_direction matches the numeric discrepancy.amount:
 * - If |amount| < 0.01: direction must be 'balanced'
 * - If amount >= 0.01: direction must be 'ynab_higher'
 * - If amount <= -0.01: direction must be 'bank_higher'
 */
describe("ReconcileAccountOutputSchema - discrepancy_direction validation", () => {
	const makeMoneyValue = (dollarAmount: number) => ({
		value_milliunits: Math.round(dollarAmount * 1000),
		value: dollarAmount,
		value_display: `$${Math.abs(dollarAmount).toFixed(2)}`,
		currency: "USD",
		direction: (dollarAmount > 0
			? "credit"
			: dollarAmount < 0
				? "debit"
				: "balanced") as "credit" | "debit" | "balanced",
	});

	const createMinimalStructuredOutput = (
		discrepancyAmount: number,
		direction: "balanced" | "ynab_higher" | "bank_higher",
	) => ({
		human: "Reconciliation complete",
		structured: {
			version: "1.0.0",
			schema_url: "https://example.com/schema",
			generated_at: "2025-11-18T10:00:00Z",
			account: {
				id: "acct-123",
				name: "Checking",
			},
			summary: {
				statement_date_range: "2025-10-01 to 2025-10-31",
				bank_transactions_count: 50,
				ynab_transactions_count: 50,
				auto_matched: 50,
				suggested_matches: 0,
				unmatched_bank: 0,
				unmatched_ynab: 0,
				current_cleared_balance: makeMoneyValue(1000),
				target_statement_balance: makeMoneyValue(1000 + discrepancyAmount),
				discrepancy: makeMoneyValue(discrepancyAmount),
				discrepancy_explanation: "Test",
			},
			balance: {
				current_cleared: makeMoneyValue(1000),
				current_uncleared: makeMoneyValue(0),
				current_total: makeMoneyValue(1000),
				target_statement: makeMoneyValue(1000 + discrepancyAmount),
				discrepancy: makeMoneyValue(discrepancyAmount),
				on_track: Math.abs(discrepancyAmount) < 0.01,
				discrepancy_direction: direction,
			},
			insights: [],
			next_steps: [],
			matches: {
				auto: [],
				suggested: [],
			},
			unmatched: {
				bank: [],
				ynab: [],
			},
		},
	});

	describe("balanced direction (|amount| < 0.01)", () => {
		it('should accept direction "balanced" when amount is 0', () => {
			const output = createMinimalStructuredOutput(0, "balanced");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should accept direction "balanced" when amount is 0.001', () => {
			const output = createMinimalStructuredOutput(0.001, "balanced");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should accept direction "balanced" when amount is -0.009', () => {
			const output = createMinimalStructuredOutput(-0.009, "balanced");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should reject direction "ynab_higher" when amount is 0', () => {
			const output = createMinimalStructuredOutput(0, "ynab_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.path).toEqual([
					"balance",
					"discrepancy_direction",
				]);
				expect(result.error.issues[0]?.message).toContain(
					"Discrepancy direction mismatch",
				);
			}
		});

		it('should reject direction "bank_higher" when amount is 0.005', () => {
			const output = createMinimalStructuredOutput(0.005, "bank_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.path).toEqual([
					"balance",
					"discrepancy_direction",
				]);
			}
		});
	});

	describe("ynab_higher direction (amount >= 0.01)", () => {
		it('should accept direction "ynab_higher" when amount is 25.50', () => {
			const output = createMinimalStructuredOutput(25.5, "ynab_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should accept direction "ynab_higher" when amount is 0.02 (just above threshold)', () => {
			const output = createMinimalStructuredOutput(0.02, "ynab_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should reject direction "balanced" when amount is 100', () => {
			const output = createMinimalStructuredOutput(100, "balanced");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.path).toEqual([
					"balance",
					"discrepancy_direction",
				]);
				expect(result.error.issues[0]?.message).toContain(
					"Discrepancy direction mismatch",
				);
			}
		});

		it('should reject direction "bank_higher" when amount is 50', () => {
			const output = createMinimalStructuredOutput(50, "bank_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.path).toEqual([
					"balance",
					"discrepancy_direction",
				]);
			}
		});
	});

	describe("bank_higher direction (amount <= -0.01)", () => {
		it('should accept direction "bank_higher" when amount is -25.50', () => {
			const output = createMinimalStructuredOutput(-25.5, "bank_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should accept direction "bank_higher" when amount is -0.02 (just below threshold)', () => {
			const output = createMinimalStructuredOutput(-0.02, "bank_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should reject direction "balanced" when amount is -100', () => {
			const output = createMinimalStructuredOutput(-100, "balanced");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.path).toEqual([
					"balance",
					"discrepancy_direction",
				]);
				expect(result.error.issues[0]?.message).toContain(
					"Discrepancy direction mismatch",
				);
			}
		});

		it('should reject direction "ynab_higher" when amount is -50', () => {
			const output = createMinimalStructuredOutput(-50, "ynab_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0]?.path).toEqual([
					"balance",
					"discrepancy_direction",
				]);
			}
		});
	});

	describe("edge cases", () => {
		it('should accept exactly 0.01 as requiring "ynab_higher"', () => {
			const output = createMinimalStructuredOutput(0.01, "ynab_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should accept exactly -0.01 as requiring "bank_higher"', () => {
			const output = createMinimalStructuredOutput(-0.01, "bank_higher");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(true);
		});

		it('should reject "balanced" for exactly 0.01', () => {
			const output = createMinimalStructuredOutput(0.01, "balanced");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(false);
		});

		it('should reject "balanced" for exactly -0.01', () => {
			const output = createMinimalStructuredOutput(-0.01, "balanced");
			const result = ReconcileAccountOutputSchema.safeParse(output);
			expect(result.success).toBe(false);
		});
	});

	describe("human-only output (no validation)", () => {
		it("should accept human-only output without structured data", () => {
			const output = {
				human: "Reconciliation complete - everything balanced",
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
});
