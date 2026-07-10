import { describe, expect, it } from "vitest";
import {
	CORE_TOOL_NAMES,
	DEFAULT_TOOL_PROFILE,
	toolBelongsToProfile,
} from "../toolProfiles.js";

describe("tool profiles", () => {
	it("defaults to the backward-compatible full surface", () => {
		expect(DEFAULT_TOOL_PROFILE).toBe("full");
		expect(toolBelongsToProfile("full", "custom_tool")).toBe(true);
	});

	it("read-only includes only tools with an explicit read-only annotation", () => {
		expect(
			toolBelongsToProfile("read-only", "read", { readOnlyHint: true }),
		).toBe(true);
		expect(
			toolBelongsToProfile("read-only", "write", { readOnlyHint: false }),
		).toBe(false);
		expect(toolBelongsToProfile("read-only", "unannotated")).toBe(false);
	});

	it("core keeps common reads and differentiated workflows", () => {
		expect(CORE_TOOL_NAMES.size).toBeGreaterThan(10);
		for (const name of [
			"ynab_list_transactions",
			"ynab_reconcile_account",
			"ynab_create_receipt_split_transaction",
			"ynab_compare_transactions",
			"ynab_analyze_spending",
		]) {
			expect(toolBelongsToProfile("core", name), name).toBe(true);
		}
		expect(toolBelongsToProfile("core", "ynab_diagnostic_info")).toBe(false);
	});
});
