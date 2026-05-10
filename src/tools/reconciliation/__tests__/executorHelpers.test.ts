import { describe, expect, it } from "vitest";
import { computeUpdateFlags } from "../executorHelpers.js";
import type { ReconcileAccountRequest } from "../index.js";
import type { TransactionMatch } from "../types.js";

describe("executorHelpers", () => {
	it("does not downgrade reconciled matches to cleared", () => {
		const match: TransactionMatch = {
			bankTransaction: {
				id: "bank-1",
				date: "2025-10-15",
				amount: -50000,
				payee: "Store",
				sourceRow: 1,
				raw: {},
			},
			ynabTransaction: {
				id: "ynab-1",
				date: "2025-10-15",
				amount: -50000,
				payee: "Store",
				categoryName: "Shopping",
				cleared: "reconciled",
				approved: true,
				memo: null,
			},
			candidates: [],
			confidence: "high",
			confidenceScore: 99,
			matchReason: "Exact match",
		};

		const flags = computeUpdateFlags(match, {
			auto_update_cleared_status: true,
			auto_adjust_dates: false,
		} as ReconcileAccountRequest);

		expect(flags.needsClearedUpdate).toBe(false);
		expect(flags.needsDateUpdate).toBe(false);
	});
});
