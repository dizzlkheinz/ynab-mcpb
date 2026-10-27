import { describe, expect, it } from "vitest";
import {
	formatLocalISODate,
	formatUTCISODate,
	isDateInRange,
	isValidISODate,
} from "../dateUtils.js";

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

	describe("formatUTCISODate", () => {
		it("should format the UTC calendar date", () => {
			expect(formatUTCISODate(new Date(Date.UTC(2024, 2, 15)))).toBe(
				"2024-03-15",
			);
			// Late on Dec 31 UTC stays on Dec 31 regardless of host time zone
			expect(formatUTCISODate(new Date("2024-12-31T23:59:59Z"))).toBe(
				"2024-12-31",
			);
		});

		it("should keep the whole date for years past 9999", () => {
			expect(formatUTCISODate(new Date(Date.UTC(10000, 0, 31)))).toBe(
				"+010000-01-31",
			);
		});
	});

	describe("isDateInRange", () => {
		it("should include both bounds", () => {
			expect(isDateInRange("2024-01-01", "2024-01-01", "2024-01-31")).toBe(
				true,
			);
			expect(isDateInRange("2024-01-31", "2024-01-01", "2024-01-31")).toBe(
				true,
			);
			expect(isDateInRange("2023-12-31", "2024-01-01", "2024-01-31")).toBe(
				false,
			);
			expect(isDateInRange("2024-02-01", "2024-01-01", "2024-01-31")).toBe(
				false,
			);
		});

		it("should treat a missing or empty bound as open", () => {
			expect(isDateInRange("1999-01-01", undefined, "2024-01-31")).toBe(true);
			expect(isDateInRange("2099-01-01", "2024-01-01")).toBe(true);
			expect(isDateInRange("2099-01-01", "", "")).toBe(true);
		});
	});

	describe("formatLocalISODate", () => {
		it("should format the local calendar date", () => {
			// Built from local components, so the local date is the same in any zone
			expect(formatLocalISODate(new Date(2024, 11, 31, 23, 59, 59))).toBe(
				"2024-12-31",
			);
			expect(formatLocalISODate(new Date(2024, 0, 1, 0, 0, 1))).toBe(
				"2024-01-01",
			);
		});
	});
});
