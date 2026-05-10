import { describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import {
	buildBalanceReconciliation,
	buildLikelyCauses,
} from "../balanceReconciliation.js";

describe("balanceReconciliation", () => {
	it("reports discrepancy amounts using the budget currency decimal digits", async () => {
		const ynabAPI = {
			transactions: {
				getTransactionsByAccount: vi.fn().mockResolvedValue({
					data: { transactions: [] },
				}),
			},
		} as unknown as ynab.API;

		const result = await buildBalanceReconciliation({
			ynabAPI,
			budgetId: "budget-1",
			accountId: "account-1",
			statementDate: "2025-10-31",
			statementBalanceMilli: 1234,
			decimalDigits: 0,
			analysis: {} as any,
		});

		expect(result.precision_calculations.discrepancy_milliunits).toBe(1234);
		expect(result.precision_calculations.discrepancy_dollars).toBe(1);
		expect(result.precision_calculations.currency_decimal_digits).toBe(0);
	});

	it("does not emit duplicate likely causes for round bank-fee amounts", () => {
		const result = buildLikelyCauses(1000);

		expect(result?.likely_causes).toHaveLength(1);
		expect(result?.likely_causes[0]?.cause_type).toBe("bank_fee");
	});
});
