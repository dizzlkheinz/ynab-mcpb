/**
 * Live checks for preview-mode writes against the real YNAB API.
 *
 * READ-ONLY: every mutation call here is a preview. The suite first asserts
 * that the server runs in preview mode, always passes dry_run: true, and never
 * sends a confirmation_token, so nothing is written to the budget. About ten
 * API requests in total.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { YNABMCPServer } from "../server/YNABMCPServer.js";
import {
	createTestServer,
	executeToolCall,
	getTestConfig,
} from "./testUtils.js";

const testConfig = getTestConfig();
const describeLive = testConfig.liveTestsEnabled ? describe : describe.skip;

const UNKNOWN_CATEGORY = "84d05aab-0000-4000-8000-000000000000";

function structured(result: CallToolResult): Record<string, unknown> {
	expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
	expect(result.structuredContent).toBeDefined();
	return result.structuredContent as Record<string, unknown>;
}

function text(result: CallToolResult): string {
	return result.content
		.map((item) => (item.type === "text" ? item.text : ""))
		.join("\n");
}

describeLive("Live preview checks (read-only)", () => {
	let server: YNABMCPServer;
	let budgetId: string;
	let accountId: string;
	let categoryId: string;
	let decimalDigits: number | undefined;

	/** Preview of ynab_create_transaction; dry_run is always forced on. */
	const preview = (args: Record<string, unknown>) =>
		executeToolCall(server, "ynab_create_transaction", {
			budget_id: budgetId,
			account_id: accountId,
			date: new Date().toISOString().slice(0, 10),
			payee_name: "MCP live preview check",
			...args,
			dry_run: true,
		});

	beforeAll(async () => {
		server = await createTestServer();

		// Refuse to run anything that could write unless previews are enforced.
		const createTool = server
			.getToolRegistry()
			.listTools()
			.find((tool) => tool.name === "ynab_create_transaction");
		if (!createTool?.inputSchema.properties?.["confirmation_token"]) {
			throw new Error(
				"Live preview checks require YNAB_MCP_WRITE_MODE=preview; refusing to run",
			);
		}

		const budgets = structured(
			await executeToolCall(server, "ynab_list_budgets", {
				response_format: "json",
			}),
		)["budgets"] as {
			id: string;
			currency_format?: { decimal_digits?: number };
		}[];
		const budget =
			budgets.find((candidate) => candidate.id === testConfig.testBudgetId) ??
			budgets[0];
		if (!budget) throw new Error("No budget available for live checks");
		budgetId = budget.id;
		decimalDigits = budget.currency_format?.decimal_digits;

		const accounts = structured(
			await executeToolCall(server, "ynab_list_accounts", {
				budget_id: budgetId,
				response_format: "json",
			}),
		)["accounts"] as { id: string; closed?: boolean; deleted?: boolean }[];
		const account =
			accounts.find((candidate) => candidate.id === testConfig.testAccountId) ??
			accounts.find((candidate) => !candidate.closed && !candidate.deleted);
		if (!account) throw new Error("No open account available for live checks");
		accountId = account.id;

		const categories = structured(
			await executeToolCall(server, "ynab_list_categories", {
				budget_id: budgetId,
				response_format: "json",
			}),
		)["categories"] as { id: string; hidden?: boolean; deleted?: boolean }[];
		const category = categories.find(
			(candidate) => !candidate.hidden && !candidate.deleted,
		);
		if (!category) throw new Error("No category available for live checks");
		categoryId = category.id;
	});

	it("returns the confirmation token in structuredContent for a valid preview", async () => {
		const result = await preview({
			amount_decimal: -1.23,
			category_id: categoryId,
		});
		const data = structured(result);
		expect(data["dry_run"]).toBe(true);
		const token = data["confirmation_token"];
		expect(typeof token).toBe("string");
		expect(text(result)).toContain(`confirmation_token="${token}"`);
		expect(Date.parse(String(data["confirmation_expires_at"]))).toBeGreaterThan(
			Date.now(),
		);
	});

	it("rejects an unknown but well-formed category_id", async () => {
		const result = await preview({
			amount_decimal: -1.23,
			category_id: UNKNOWN_CATEGORY,
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toContain(UNKNOWN_CATEGORY);
		expect(text(result)).toContain("was not found in this budget");
		expect(result.structuredContent?.["confirmation_token"]).toBeUndefined();
	});

	it("rejects a sub-cent amount in a 2-decimal currency", async () => {
		if (decimalDigits !== 2) return;
		const result = await preview({ amount_milliunits: -378 });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("amount_decimal: -3.78");
	});

	it("filters list_transactions by account, date window and amount", async () => {
		const result = await executeToolCall(server, "ynab_list_transactions", {
			budget_id: budgetId,
			account_id: accountId,
			since_date: "2000-01-01",
			until_date: "2000-01-31",
			amount_decimal: -1.23,
			response_format: "json",
		});
		const data = structured(result);
		expect(Array.isArray(data["transactions"])).toBe(true);
		expect(data["total_count"]).toBe(
			(data["transactions"] as unknown[]).length,
		);
	});
});
