import { describe, expect, it } from "vitest";
import { formatISODate, isValidISODate } from "../dateUtils.js";

describe("dateUtils", () => {
	describe("isValidISODate", () => {
		it("should validate correct ISO dates", () => {
			expect(isValidISODate("2024-03-15")).toBe(true);
			expect(isValidISODate("2024-12-31")).toBe(true);
			expect(isValidISODate("2024-02-29")).toBe(true); // Leap year
		});

		it("should reject invalid formats", () => {
			expect(isValidISODate("03/15/2024")).toBe(false);
			expect(isValidISODate("2024-3-15")).toBe(false);
			expect(isValidISODate("2024-03-5")).toBe(false);
			expect(isValidISODate("24-03-15")).toBe(false);
			expect(isValidISODate("not-a-date")).toBe(false);
		});

		it("should reject invalid dates with correct format", () => {
			expect(isValidISODate("2024-02-30")).toBe(false); // Invalid date
			expect(isValidISODate("2024-13-01")).toBe(false); // Invalid month
			expect(isValidISODate("2023-02-29")).toBe(false); // Not a leap year
		});
	});

	describe("formatISODate", () => {
		it("should format the UTC calendar date", () => {
			expect(formatISODate(new Date(Date.UTC(2024, 2, 15)))).toBe("2024-03-15");
			// Late on Dec 31 UTC stays on Dec 31 regardless of host time zone
			expect(formatISODate(new Date("2024-12-31T23:59:59Z"))).toBe(
				"2024-12-31",
			);
		});
	});
});
