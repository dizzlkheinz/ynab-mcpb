import { describe, expect, it } from "vitest";
import { getLiveTestGate, MOCK_TEST_ACCESS_TOKEN } from "./testUtils.js";

describe("live YNAB test gate", () => {
	it("does not enable live tests from token presence alone", () => {
		const gate = getLiveTestGate({
			YNAB_ACCESS_TOKEN: "real-looking-token",
		});

		expect(gate.hasRealApiKey).toBe(true);
		expect(gate.enabled).toBe(false);
	});

	it("requires explicit opt-in and a real token", () => {
		const gate = getLiveTestGate({
			RUN_LIVE_YNAB_TESTS: "true",
			YNAB_ACCESS_TOKEN: "real-looking-token",
		});

		expect(gate.enabled).toBe(true);
	});

	it("allows SKIP_E2E_TESTS to override explicit opt-in", () => {
		const gate = getLiveTestGate({
			RUN_LIVE_YNAB_TESTS: "true",
			SKIP_E2E_TESTS: "true",
			YNAB_ACCESS_TOKEN: "real-looking-token",
		});

		expect(gate.skipExplicitlyRequested).toBe(true);
		expect(gate.enabled).toBe(false);
	});

	it("rejects the mocked-test sentinel as a real token", () => {
		const gate = getLiveTestGate({
			RUN_LIVE_YNAB_TESTS: "true",
			YNAB_ACCESS_TOKEN: MOCK_TEST_ACCESS_TOKEN,
		});

		expect(gate.hasRealApiKey).toBe(false);
		expect(gate.enabled).toBe(false);
	});
});
