import { describe, expect, it } from "vitest";
import { ReconcileAccountOutputSchema } from "../reconciliationOutputs.js";

describe("reconciliationOutputs", () => {
	describe("ReconcileAccountOutputSchema", () => {
		const bankTransaction = {
			id: "550e8400-e29b-41d4-a716-446655440000",
			date: "2025-01-01",
			amount: -10,
			payee: "Coffee Shop",
			sourceRow: 1,
			raw: {
				date: "2025-01-01",
				amount: "-10.00",
				description: "Coffee Shop",
			},
			amount_money: {
				value_milliunits: -10000,
				value: -10,
				value_display: "-$10.00",
				currency: "USD",
				direction: "debit" as const,
			},
		};
		const ynabTransaction = {
			id: "ynab-1",
			date: "2025-01-01",
			amount: -10,
			payee: "Coffee Shop",
			categoryName: "Dining Out",
			cleared: "uncleared" as const,
			approved: true,
			memo: null,
			amount_money: {
				value_milliunits: -10000,
				value: -10,
				value_display: "-$10.00",
				currency: "USD",
				direction: "debit" as const,
			},
		};

		it("accepts filtered unmatched-only structured content", () => {
			const result = ReconcileAccountOutputSchema.safeParse({
				human: "Reconciliation complete",
				structured: {
					unmatched_bank: [bankTransaction],
					unmatched_ynab: [ynabTransaction],
					suggestions: [
						{
							bank_transaction: bankTransaction,
							ynab_transaction: ynabTransaction,
							confidence: "medium",
							confidence_score: 75,
							match_reason: "Same amount and similar payee",
						},
					],
				},
			});

			expect(result.success).toBe(true);
		});

		it("accepts high confidence with sub-90 score (two-pass exact-date auto-match)", () => {
			// The two-pass matcher promotes a score-65+ match to "high" confidence when
			// the bank transaction has an exact date match and is the sole candidate.
			// confidence is the semantic auto-match classification, not a derivative of score.
			const result = ReconcileAccountOutputSchema.safeParse({
				human: "Reconciliation complete",
				structured: {
					unmatched_bank: [bankTransaction],
					unmatched_ynab: [ynabTransaction],
					suggestions: [
						{
							bank_transaction: bankTransaction,
							ynab_transaction: ynabTransaction,
							confidence: "high",
							confidence_score: 75,
							match_reason: "Same amount and similar payee",
						},
					],
				},
			});

			expect(result.success).toBe(true);
		});
	});
});
