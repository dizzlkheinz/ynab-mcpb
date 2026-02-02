/**
 * Unit tests for tool registration verification.
 *
 * Verifies that all expected tools are registered through the factory pattern
 * and that tool metadata (annotations, schemas) are properly configured.
 */
import { describe, expect, it, vi } from "vitest";

// Mock config before importing YNABMCPServer
vi.mock("../config.js", () => ({
	loadConfig: () => ({
		YNAB_ACCESS_TOKEN: "test-token-for-registration-tests",
		YNAB_DEFAULT_BUDGET_ID: undefined,
		LOG_LEVEL: "info",
	}),
	config: {
		YNAB_ACCESS_TOKEN: "test-token-for-registration-tests",
		YNAB_DEFAULT_BUDGET_ID: undefined,
		LOG_LEVEL: "info",
	},
}));

import { YNABMCPServer } from "../YNABMCPServer.js";

const DEFAULT_BUDGET_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Expected tool names organized by domain.
 * This serves as the authoritative list of all 30 registered tools.
 */
const EXPECTED_TOOLS_BY_DOMAIN = {
	budget: ["list_budgets", "get_budget"],
	account: ["list_accounts", "get_account", "create_account"],
	transaction: [
		"list_transactions",
		"export_transactions",
		"get_transaction",
		"create_transaction",
		"create_transactions",
		"update_transaction",
		"update_transactions",
		"delete_transaction",
		"create_receipt_split_transaction",
	],
	category: ["list_categories", "get_category", "update_category"],
	payee: ["list_payees", "get_payee"],
	month: ["get_month", "list_months"],
	reconciliation: ["compare_transactions", "reconcile_account"],
	utility: ["get_user"],
	server: [
		"set_default_budget",
		"get_default_budget",
		"clear_cache",
		"diagnostic_info",
		"set_output_format",
	],
} as const;

/** Flat list of all expected tool names */
const ALL_EXPECTED_TOOLS = Object.values(EXPECTED_TOOLS_BY_DOMAIN).flat();

/** Expected total tool count */
const EXPECTED_TOOL_COUNT = 29;

describe("Tool Registration", () => {
	// Config is mocked at module level, no env setup needed

	describe("Tool Count Verification", () => {
		it("registers exactly 29 tools", () => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();
			expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
		});

		it("registers all expected tools with correct names", () => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();
			const toolNames = tools.map((t) => t.name).sort();
			const expectedNames = [...ALL_EXPECTED_TOOLS].sort();

			expect(toolNames).toEqual(expectedNames);
		});
	});

	describe("Domain Tool Registration", () => {
		it.each([
			["budget", EXPECTED_TOOLS_BY_DOMAIN.budget],
			["account", EXPECTED_TOOLS_BY_DOMAIN.account],
			["transaction", EXPECTED_TOOLS_BY_DOMAIN.transaction],
			["category", EXPECTED_TOOLS_BY_DOMAIN.category],
			["payee", EXPECTED_TOOLS_BY_DOMAIN.payee],
			["month", EXPECTED_TOOLS_BY_DOMAIN.month],
			["reconciliation", EXPECTED_TOOLS_BY_DOMAIN.reconciliation],
			["utility", EXPECTED_TOOLS_BY_DOMAIN.utility],
			["server", EXPECTED_TOOLS_BY_DOMAIN.server],
		])("registers all %s domain tools", (domain: string, expectedTools: readonly string[]) => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();
			const toolNames = tools.map((t) => t.name);

			for (const toolName of expectedTools) {
				expect(toolNames, `Missing ${domain} tool: ${toolName}`).toContain(
					toolName,
				);
			}
		});
	});

	describe("Tool Metadata Verification", () => {
		it("has descriptions for all tools", () => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();

			for (const tool of tools) {
				expect(
					tool.description,
					`${tool.name} missing description`,
				).toBeDefined();
				expect(
					tool.description.length,
					`${tool.name} has empty description`,
				).toBeGreaterThan(0);
			}
		});

		it("has input schemas for all tools", () => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();

			for (const tool of tools) {
				expect(
					tool.inputSchema,
					`${tool.name} missing inputSchema`,
				).toBeDefined();
				expect(
					tool.inputSchema.type,
					`${tool.name} inputSchema not object type`,
				).toBe("object");
			}
		});

		it("has annotations for all tools", () => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();

			for (const tool of tools) {
				expect(
					tool.annotations,
					`${tool.name} missing annotations`,
				).toBeDefined();
				expect(tool.annotations, `${tool.name} missing title`).toHaveProperty(
					"title",
				);
				expect(
					tool.annotations,
					`${tool.name} missing readOnlyHint`,
				).toHaveProperty("readOnlyHint");
				expect(
					tool.annotations,
					`${tool.name} missing openWorldHint`,
				).toHaveProperty("openWorldHint");
			}
		});

		it("has YNAB prefix in all tool titles", () => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();

			for (const tool of tools) {
				expect(
					tool.annotations?.title,
					`${tool.name} title should start with "YNAB:"`,
				).toMatch(/^YNAB:/);
			}
		});
	});

	describe("No Duplicate Tools", () => {
		it("does not have duplicate tool names", () => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();
			const toolNames = tools.map((t) => t.name);
			const uniqueNames = new Set(toolNames);

			expect(uniqueNames.size).toBe(toolNames.length);
		});
	});

	describe("Factory Registration Completeness", () => {
		it("does not have unexpected tools registered", () => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();
			const toolNames = tools.map((t) => t.name);

			const unexpectedTools = toolNames.filter(
				(name) => !ALL_EXPECTED_TOOLS.includes(name),
			);
			expect(unexpectedTools, "Unexpected tools found").toEqual([]);
		});

		it("does not have missing expected tools", () => {
			const server = new YNABMCPServer(false);
			const tools = server.getToolRegistry().listTools();
			const toolNames = tools.map((t) => t.name);

			const missingTools = ALL_EXPECTED_TOOLS.filter(
				(name) => !toolNames.includes(name),
			);
			expect(missingTools, "Missing expected tools").toEqual([]);
		});
	});

	describe("Default Argument Resolution", () => {
		it("applies defaultArgumentResolver when budget_id is omitted", () => {
			const server = new YNABMCPServer(false);
			server.setDefaultBudget(DEFAULT_BUDGET_ID);

			const listAccounts = server
				.getToolRegistry()
				.getToolDefinitions()
				.find((tool) => tool.name === "list_accounts");

			expect(listAccounts?.defaultArgumentResolver).toBeDefined();

			const resolved = listAccounts?.defaultArgumentResolver?.({
				name: "list_accounts",
				accessToken: "token",
				rawArguments: {},
			});

			expect(resolved).toEqual({ budget_id: DEFAULT_BUDGET_ID });
		});

		it("budget-dependent tools have defaultArgumentResolver", () => {
			const server = new YNABMCPServer(false);
			const definitions = server.getToolRegistry().getToolDefinitions();

			// Tools that require budget_id should have resolvers
			const budgetDependentTools = [
				"list_accounts",
				"get_account",
				"create_account",
				"list_transactions",
				"get_transaction",
				"list_categories",
				"get_category",
				"list_payees",
				"get_payee",
				"get_month",
				"list_months",
			];

			for (const toolName of budgetDependentTools) {
				const tool = definitions.find((t) => t.name === toolName);
				expect(
					tool?.defaultArgumentResolver,
					`${toolName} should have defaultArgumentResolver`,
				).toBeDefined();
			}
		});
	});
});
