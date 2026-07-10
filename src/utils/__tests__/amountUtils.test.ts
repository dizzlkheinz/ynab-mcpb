import { describe, expect, it } from "vitest";
import {
	amountToMilliunits,
	formatAmount,
	milliunitsToAmount,
} from "../amountUtils.js";

describe("amountUtils", () => {
	it("rounds exactly at the public milliunit boundary", () => {
		expect(amountToMilliunits(1.2345)).toBe(1235);
		expect(amountToMilliunits(-1.2345)).toBe(-1234);
		expect(milliunitsToAmount(1234.6)).toBe(1.235);
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	])("rejects non-finite amount %s", (amount) => {
		expect(() => amountToMilliunits(amount)).toThrow("not a finite number");
	});

	it("formats with default and explicit currency symbols", () => {
		expect(formatAmount(1234)).toBe("$1.23");
		expect(formatAmount(-2500, "€")).toBe("€-2.50");
	});
});
