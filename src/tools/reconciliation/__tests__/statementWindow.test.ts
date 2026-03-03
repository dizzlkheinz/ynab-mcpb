import { describe, expect, it } from "vitest";
import type { CSVParseResult } from "../csvParser.js";
import {
	clampCSVToStatementWindow,
	formatStatementWindow,
	normalizeStatementDate,
} from "../statementWindow.js";

const baseParseResult = (): CSVParseResult => ({
	transactions: [
		{
			id: "txn-1",
			date: "2026-01-10",
			amount: -1000,
			payee: "Before",
			memo: "",
			sourceRow: 1,
			raw: { date: "2026-01-10", amount: "-1.00", description: "Before" },
		},
		{
			id: "txn-2",
			date: "2026-02-15",
			amount: -2000,
			payee: "Inside",
			memo: "",
			sourceRow: 2,
			raw: { date: "2026-02-15", amount: "-2.00", description: "Inside" },
		},
		{
			id: "txn-3",
			date: "2026-03-20",
			amount: -3000,
			payee: "After",
			memo: "",
			sourceRow: 3,
			raw: { date: "2026-03-20", amount: "-3.00", description: "After" },
		},
	],
	errors: [],
	warnings: [],
	meta: {
		detectedDelimiter: ",",
		detectedColumns: ["Date", "Amount", "Payee"],
		totalRows: 3,
		validRows: 3,
		skippedRows: 0,
	},
});

describe("statementWindow helpers", () => {
	describe("normalizeStatementDate", () => {
		it("returns ISO date inputs unchanged", () => {
			expect(normalizeStatementDate("2026-02-28")).toBe("2026-02-28");
		});

		it("normalizes parseable date inputs", () => {
			expect(normalizeStatementDate("Feb 28, 2026")).toBe("2026-02-28");
		});

		it("returns undefined for invalid dates", () => {
			expect(normalizeStatementDate("not-a-date")).toBeUndefined();
		});
	});

	describe("clampCSVToStatementWindow", () => {
		it("returns original result when no bounds are provided", () => {
			const parseResult = baseParseResult();
			const clamped = clampCSVToStatementWindow(parseResult, {});

			expect(clamped.parseResult).toBe(parseResult);
			expect(clamped.excludedCount).toBe(0);
			expect(clamped.windowApplied).toBeNull();
		});

		it("filters transactions outside an explicit statement window", () => {
			const clamped = clampCSVToStatementWindow(baseParseResult(), {
				startDate: "2026-02-01",
				endDate: "2026-02-28",
			});

			expect(clamped.excludedCount).toBe(2);
			expect(clamped.parseResult.transactions).toHaveLength(1);
			expect(clamped.parseResult.transactions[0]?.id).toBe("txn-2");
			expect(clamped.parseResult.meta.validRows).toBe(1);
			expect(clamped.parseResult.meta.skippedRows).toBe(2);
			expect(clamped.parseResult.warnings.at(-1)?.message).toContain(
				"outside statement window 2026-02-01 to 2026-02-28",
			);
		});

		it("supports one-sided windows", () => {
			const clamped = clampCSVToStatementWindow(baseParseResult(), {
				endDate: "2026-02-15",
			});

			expect(clamped.parseResult.transactions).toHaveLength(2);
			expect(clamped.parseResult.transactions.map((txn) => txn.id)).toEqual([
				"txn-1",
				"txn-2",
			]);
			expect(clamped.windowApplied).toEqual({ endDate: "2026-02-15" });
		});
	});

	describe("formatStatementWindow", () => {
		it("renders missing bounds as ellipsis", () => {
			expect(formatStatementWindow({ startDate: "2026-01-01" })).toBe(
				"2026-01-01 to ...",
			);
		});
	});
});
