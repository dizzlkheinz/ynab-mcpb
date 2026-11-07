import { describe, expect, it } from "vitest";
import { allocateProportionally } from "../receiptSplit/collapseLogic.js";

const sum = (values: number[]) =>
	values.reduce((total, value) => total + value, 0);

describe("allocateProportionally", () => {
	it("splits 1.00 across three equal weights in whole cents", () => {
		const shares = allocateProportionally(1000, [1, 1, 1], 10);
		expect(shares).toEqual([340, 330, 330]);
	});

	it("never produces negative shares when coarse rounding would overshoot", () => {
		// 0.03 over four equal weights: per-share rounding would give 4 x 0.01
		const shares = allocateProportionally(30, [1, 1, 1, 1], 10);
		expect(sum(shares)).toBe(30);
		expect(shares.every((share) => share >= 0 && share % 10 === 0)).toBe(true);
	});

	it("allocates whole units for a 0-decimal currency", () => {
		const shares = allocateProportionally(5000, [3, 2, 2], 1000);
		expect(sum(shares)).toBe(5000);
		expect(shares.every((share) => share % 1000 === 0)).toBe(true);
	});

	it("keeps the exact total when it is not a multiple of the step", () => {
		const shares = allocateProportionally(1005, [1, 1], 10);
		expect(sum(shares)).toBe(1005);
	});

	it("follows the weights", () => {
		expect(allocateProportionally(1000, [3, 1], 10)).toEqual([750, 250]);
	});

	it("returns zeros for no tax or no weight", () => {
		expect(allocateProportionally(0, [1, 2], 10)).toEqual([0, 0]);
		expect(allocateProportionally(100, [0, 0], 10)).toEqual([0, 0]);
	});
});
