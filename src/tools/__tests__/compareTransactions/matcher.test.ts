import { describe, expect, test } from "vitest";
import { findMatches } from "../../compareTransactions/matcher.js";
import type {
	BankTransaction,
	YNABTransaction,
} from "../../compareTransactions/types.js";

// Helper functions to create test transactions
function createBankTransaction(
	date: string,
	amount: number,
	description: string,
	rowNumber = 1,
): BankTransaction {
	return {
		date: new Date(date),
		amount,
		description,
		raw_amount: (amount / 1000).toString(),
		raw_date: date,
		row_number: rowNumber,
	};
}

function createYNABTransaction(
	id: string,
	date: string,
	amount: number,
	payeeName?: string,
	memo?: string,
): YNABTransaction {
	return {
		id,
		date: new Date(date),
		amount,
		payee_name: payeeName || null,
		memo: memo || null,
		cleared: "cleared",
		original: {} as any, // Mock original transaction
	};
}

describe("matcher", () => {
	describe("findMatches", () => {
		test("should find simple one-to-one matches", () => {
			const bankTxns = [
				createBankTransaction("2023-09-15", 123450, "Test 1"),
				createBankTransaction("2023-09-16", 67890, "Test 2"),
			];
			const ynabTxns = [
				createYNABTransaction("ynab1", "2023-09-15", 123450, "Test 1"),
				createYNABTransaction("ynab2", "2023-09-16", 67890, "Test 2"),
			];

			const { matches, unmatched_bank, unmatched_ynab } = findMatches(
				bankTxns,
				ynabTxns,
				0.01,
				5,
			);

			expect(matches).toHaveLength(2);
			expect(unmatched_bank).toHaveLength(0);
			expect(unmatched_ynab).toHaveLength(0);
		});

		test("should handle unmatched transactions", () => {
			const bankTxns = [
				createBankTransaction("2023-09-10", 123450, "Bank Only"), // Moved further away from any YNAB dates
				createBankTransaction("2023-09-16", 67890, "Matched"),
			];
			const ynabTxns = [
				createYNABTransaction("ynab1", "2023-09-16", 67890, "Matched"),
				createYNABTransaction("ynab2", "2023-09-25", 99999, "YNAB Only"),
			];

			const { matches, unmatched_bank, unmatched_ynab } = findMatches(
				bankTxns,
				ynabTxns,
				0.01,
				5,
			);

			expect(matches).toHaveLength(1);
			expect(unmatched_bank).toHaveLength(1);
			expect(unmatched_ynab).toHaveLength(1);
			// The exact match may vary based on algorithm, but we should have proper separation
			expect(matches[0]!.bank_transaction.description).toBe("Matched");
			expect(matches[0]!.ynab_transaction.payee_name).toBe("Matched");
		});

		test("should handle duplicate amounts with special logic", () => {
			const bankTxns = [
				createBankTransaction("2023-09-15", 123450, "Duplicate 1"),
				createBankTransaction("2023-09-17", 123450, "Duplicate 2"),
				createBankTransaction("2023-09-18", 67890, "Unique"),
			];
			const ynabTxns = [
				createYNABTransaction("ynab1", "2023-09-14", 123450, "YNAB Dup 1"),
				createYNABTransaction("ynab2", "2023-09-18", 123450, "YNAB Dup 2"),
				createYNABTransaction("ynab3", "2023-09-18", 67890, "YNAB Unique"),
			];

			const { matches, unmatched_bank, unmatched_ynab } = findMatches(
				bankTxns,
				ynabTxns,
				0.01,
				5,
			);

			expect(matches).toHaveLength(3);
			expect(unmatched_bank).toHaveLength(0);
			expect(unmatched_ynab).toHaveLength(0);

			// Verify that duplicates are handled with chronological matching
			const duplicateMatches = matches.filter(
				(m) => m.bank_transaction.amount === 123450,
			);
			expect(duplicateMatches).toHaveLength(2);
		});

		test("should respect minimum score threshold", () => {
			const bankTxns = [createBankTransaction("2023-09-15", 123450, "Test")];
			const ynabTxns = [
				createYNABTransaction("ynab1", "2023-10-15", 67890), // Different amount and far date
			];

			const { matches, unmatched_bank, unmatched_ynab } = findMatches(
				bankTxns,
				ynabTxns,
				0.01,
				5,
			);

			expect(matches).toHaveLength(0);
			expect(unmatched_bank).toHaveLength(1);
			expect(unmatched_ynab).toHaveLength(1);
		});

		test("should not reuse transactions", () => {
			const bankTxns = [
				createBankTransaction("2023-09-15", 123450, "Test 1"),
				createBankTransaction("2023-09-16", 123460, "Test 2"), // Very close amount
			];
			const ynabTxns = [createYNABTransaction("ynab1", "2023-09-15", 123450)];

			const { matches, unmatched_bank, unmatched_ynab } = findMatches(
				bankTxns,
				ynabTxns,
				0.01,
				5,
			);

			expect(matches).toHaveLength(1); // Only one match possible
			expect(unmatched_bank).toHaveLength(1);
			expect(unmatched_ynab).toHaveLength(0);
		});

		test("should handle empty transaction lists", () => {
			const { matches, unmatched_bank, unmatched_ynab } = findMatches(
				[],
				[],
				0.01,
				5,
			);

			expect(matches).toHaveLength(0);
			expect(unmatched_bank).toHaveLength(0);
			expect(unmatched_ynab).toHaveLength(0);
		});

		test("should handle large datasets efficiently", () => {
			// Create larger datasets to test performance
			const bankTxns = Array.from({ length: 50 }, (_, i) =>
				createBankTransaction(
					new Date(Date.UTC(2023, 8, i + 1)).toISOString().slice(0, 10),
					i * 1000,
					`Bank ${i}`,
				),
			);
			const ynabTxns = Array.from({ length: 50 }, (_, i) =>
				createYNABTransaction(
					`ynab${i}`,
					new Date(Date.UTC(2023, 8, i + 1)).toISOString().slice(0, 10),
					i * 1000,
					`YNAB ${i}`,
				),
			);

			const start = Date.now();
			const { matches } = findMatches(bankTxns, ynabTxns, 0.01, 5);
			const duration = Date.now() - start;

			expect(matches).toHaveLength(50); // Should match all
			expect(duration).toBeLessThan(1000); // Should complete quickly
		});

		test("should handle negative amounts correctly", () => {
			const bankTxns = [
				createBankTransaction("2023-09-15", -123450, "Debit Transaction"),
			];
			const ynabTxns = [
				createYNABTransaction("ynab1", "2023-09-15", -123450, "Credit Payment"),
			];

			const { matches } = findMatches(bankTxns, ynabTxns, 0.01, 5);

			expect(matches).toHaveLength(1);
			expect(matches[0]!.bank_transaction.amount).toBe(-123450);
			expect(matches[0]!.ynab_transaction.amount).toBe(-123450);
		});

		test("should demonstrate parity mode (legacy behavior) vs enhanced mode with chronology bonus", () => {
			const bankTxns = [
				createBankTransaction("2023-09-15", 123450, "Duplicate 1"),
				createBankTransaction("2023-09-17", 123450, "Duplicate 2"),
			];
			const ynabTxns = [
				createYNABTransaction("ynab1", "2023-09-20", 123450, "Far YNAB 1"), // 5 days from first, 3 days from second
				createYNABTransaction("ynab2", "2023-09-14", 123450, "Close YNAB 2"), // 1 day from first, 3 days from second
			];

			// Legacy mode (parity mode) - no chronology bonus
			const legacyResults = findMatches(bankTxns, ynabTxns, 0.01, 5, false);

			// Enhanced mode - with chronology bonus
			const enhancedResults = findMatches(bankTxns, ynabTxns, 0.01, 5, true);

			expect(legacyResults.matches).toHaveLength(2);
			expect(enhancedResults.matches).toHaveLength(2);

			// In enhanced mode, chronology bonus should affect matching preferences
			const enhancedMatch1 = enhancedResults.matches.find(
				(m) => m.bank_transaction.description === "Duplicate 1",
			);
			expect(enhancedMatch1?.match_reasons).toContain(
				"Chronological order bonus (+15)",
			);
		});

		test("should preserve legacy behavior when chronology bonus is disabled", () => {
			const bankTxns = [createBankTransaction("2023-09-15", 123450, "Test")];
			const ynabTxns = [
				createYNABTransaction("ynab1", "2023-09-15", 123450, "Close Match"),
			];

			const { matches } = findMatches(bankTxns, ynabTxns, 0.01, 5, false);

			expect(matches).toHaveLength(1);
			expect(matches[0]!.match_reasons).not.toContain(
				"Chronological order bonus",
			);
		});

		test("should apply chronology bonus when enabled for duplicate amounts", () => {
			const bankTxns = [createBankTransaction("2023-09-15", 123450, "Test")];
			const ynabTxns = [
				createYNABTransaction("ynab1", "2023-09-15", 123450, "Same Day Match"),
			];

			const { matches } = findMatches(bankTxns, ynabTxns, 0.01, 5, true);

			expect(matches).toHaveLength(1);
			// Note: chronology bonus is only applied to duplicate amounts, so this single transaction won't get the bonus
			expect(matches[0]!.match_reasons).not.toContain(
				"Chronological order bonus",
			);
		});
	});
});
