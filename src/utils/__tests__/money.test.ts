import { describe, expect, it } from "vitest";
import { amountToMilliunits, milliunitsToAmount } from "../money.js";

describe("money utilities", () => {
	describe("milliunitsToAmount", () => {
		it("converts integer milliunits to decimal currency amounts", () => {
			expect(milliunitsToAmount(1230)).toBe(1.23);
			expect(milliunitsToAmount(-5670)).toBe(-5.67);
			expect(milliunitsToAmount(0)).toBe(0);
		});

		it("rounds fractional milliunits before dividing", () => {
			expect(milliunitsToAmount(1234.6)).toBe(1.235);
			expect(milliunitsToAmount(-1234.4)).toBe(-1.234);
		});
	});

	describe("amountToMilliunits", () => {
		it("converts decimal currency amounts to integer milliunits", () => {
			expect(amountToMilliunits(1.23)).toBe(1230);
			expect(amountToMilliunits(-5.67)).toBe(-5670);
			expect(amountToMilliunits(0)).toBe(0);
		});

		it("rounds half-milliunits cleanly", () => {
			expect(amountToMilliunits(1.2345)).toBe(1235);
		});

		it("throws for non-finite numbers", () => {
			expect(() => amountToMilliunits(Number.NaN)).toThrow("Invalid amount");
			expect(() => amountToMilliunits(Number.POSITIVE_INFINITY)).toThrow(
				"Invalid amount",
			);
		});
	});
});
