import { describe, expect, it, vi } from "vitest";
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

		const timeZones = ["America/Los_Angeles", "Australia/Sydney"];
		// Each names 2024-01-31. Date-only forms keep the written date; ISO
		// timestamps keep their date prefix; others keep their UTC date
		const inputs = [
			"01/31/2024",
			"1/31/2024",
			"01-31-2024",
			"2024/01/31",
			"Jan 31, 2024",
			"January 31 2024",
			"Jan. 31, 2024",
			"31 Jan 2024",
			"Wednesday, January 31, 2024",
			"2024-01-31 00:00:00Z",
			"2024-01-31t00:00:00z",
			"2024-01-31 23:30:00-05:00",
			"2024-01-31Z",
			"Wed, 31 Jan 2024 00:00:00 GMT",
			"Wed, 31 Jan 2024 GMT",
			"Jan 31, 2024 UTC",
			"Jan 31, 2024 12:00 AM UTC",
			"Jan 31, 2024 00:00 UT",
			"Jan 31, 2024 EST",
			"Jan 31, 2024 11:59 PM GMT",
			"Jan 31, 2024 12:00 PM PST",
			"Wed Jan 31 2024 00:00:00 GMT-0800 (Pacific Standard Time)",
		];
		it.each(
			timeZones.flatMap((timeZone) =>
				inputs.map((input) => [timeZone, input] as const),
			),
		)("in %s reads %j as 2024-01-31", (timeZone, input) => {
			vi.stubEnv("TZ", timeZone);
			try {
				expect(normalizeStatementDate(input)).toBe("2024-01-31");
			} finally {
				vi.unstubAllEnvs();
			}
		});

		it("keeps the calendar date of ISO timestamps", () => {
			expect(normalizeStatementDate("2024-01-31T23:30:00-05:00")).toBe(
				"2024-01-31",
			);
		});

		it("returns undefined for invalid dates", () => {
			expect(normalizeStatementDate("not-a-date")).toBeUndefined();
			expect(normalizeStatementDate("2024-02-30")).toBeUndefined();
			expect(normalizeStatementDate("2024-13-45T00:00:00Z")).toBeUndefined();
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
			expect(clamped.parseResult.warnings.slice(-1)[0]?.message).toContain(
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
