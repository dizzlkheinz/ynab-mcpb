import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textOf } from "../../__tests__/testUtils.js";
import { ConfigurationError } from "../../utils/errors.js";
import type { CacheManager } from "../cacheManager.js";
import * as config from "../config.js";

vi.mock("../config.js", () => ({
	getRuntimeConfig: () => ({
		LOG_LEVEL: "error",
		RATE_LIMIT_LOGGING: false,
		VERBOSE_TESTS: false,
		YNAB_MCP_ENABLE_DELTA: undefined,
		YNAB_EXPORT_PATH: undefined,
		XDG_DOCUMENTS_DIR: undefined,
	}),
	getAppConfig: () => ({
		LOG_LEVEL: "error",
		RATE_LIMIT_LOGGING: false,
		VERBOSE_TESTS: false,
		YNAB_MCP_ENABLE_DELTA: undefined,
	}),
	isDeltaEnabled: () => false,
	loadConfig: () => ({
		YNAB_ACCESS_TOKEN: "unit-test-token",
		YNAB_DEFAULT_BUDGET_ID: undefined,
		YNAB_MCP_WRITE_MODE: "preview",
		YNAB_MCP_TOOL_PROFILE: "full",
		LOG_LEVEL: "error",
	}),
}));

import { YNABMCPServer } from "../YNABMCPServer.js";

describe("YNABMCPServer isolated behavior", () => {
	let server: YNABMCPServer;

	beforeEach(() => {
		server = new YNABMCPServer(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("exposes static server surfaces and local default-budget state", async () => {
		expect(server.getYNABAPI()).toBeDefined();
		expect(server.getServer()).toBeDefined();
		expect(server.getServerVersion()).toMatch(/^\d+\.\d+\.\d+$/);
		expect((await server.handleListTools()).tools).toHaveLength(35);
		expect((await server.handleListResources()).resources).toHaveLength(2);
		expect((await server.handleListPrompts()).prompts).toHaveLength(9);

		expect(server.getDefaultBudget()).toBeUndefined();
		server.setDefaultBudget("budget-1");
		expect(server.getDefaultBudget()).toBe("budget-1");
		server.clearDefaultBudget();
		expect(server.getDefaultBudget()).toBeUndefined();
	});

	it("handles known and unknown prompt requests", async () => {
		const known = await server.handleGetPrompt({
			name: "weekly-budget-review",
			arguments: { week_start: "2026-07-06" },
		});
		expect(known).toHaveProperty("messages");

		const unknown = await server.handleGetPrompt({ name: "missing-prompt" });
		expect(unknown).toMatchObject({ isError: true });
	});

	it("preserves optional prompt tool declarations", async () => {
		const internals = server as unknown as {
			promptManager: {
				getPrompt: () => Promise<{
					description: string;
					messages: [];
					tools: { name: string; inputSchema: { type: "object" } }[];
				}>;
			};
		};
		internals.promptManager.getPrompt = async () => ({
			description: "Tool-aware prompt",
			messages: [],
			tools: [{ name: "ynab_list_budgets", inputSchema: { type: "object" } }],
		});
		const result = await server.handleGetPrompt({ name: "tool-aware" });
		expect(result).toHaveProperty("tools");
	});

	it("formats resource success and error paths", async () => {
		vi.spyOn(server.getYNABAPI().user, "getUser").mockResolvedValue({
			data: { user: { id: "user-1" } },
		});
		const result = await server.handleReadResource({ uri: "ynab://user" });
		expect(result).toHaveProperty("contents");

		const missing = await server.handleReadResource({ uri: "ynab://missing" });
		expect(missing).toMatchObject({ isError: true });
	});

	it.each([
		[new SyntaxError("bad JSON"), "Unexpected response"],
		["unexpected token at position 0", "Unexpected response"],
		[{ message: "unexpected end of JSON input" }, "Unexpected response"],
		[{ message: "<html>gateway failure</html>" }, "Unexpected response"],
		[new Error("401 request failed"), "Invalid or expired"],
		[new Error("Unauthorized request"), "Invalid or expired"],
		[new Error("403 request failed"), "insufficient permissions"],
		[new Error("Forbidden request"), "insufficient permissions"],
		[new Error("network unavailable"), "network unavailable"],
		[new Error(""), "Token validation failed"],
		[42, "Token validation failed: 42"],
	] as const)(
		"classifies token validation failure %#",
		async (error, message) => {
			vi.spyOn(server.getYNABAPI().user, "getUser").mockRejectedValue(error);
			await expect(server.validateToken()).rejects.toThrow(message);
		},
	);

	it("returns true for a valid token", async () => {
		vi.spyOn(server.getYNABAPI().user, "getUser").mockResolvedValue({
			data: { user: { id: "user-1" } },
		});
		await expect(server.validateToken()).resolves.toBe(true);
	});

	it("executes local tools in JSON and markdown forms", async () => {
		const registry = server.getToolRegistry();
		const first = await registry.executeTool({
			name: "ynab_get_default_budget",
			accessToken: "unit-test-token",
			arguments: { response_format: "json" },
		});
		expect(first.structuredContent).toMatchObject({ has_default: false });

		server.setDefaultBudget("budget-1");
		const second = await registry.executeTool({
			name: "ynab_get_default_budget",
			accessToken: "unit-test-token",
			arguments: { response_format: "markdown" },
		});
		expect(second.structuredContent).toMatchObject({
			has_default: true,
			default_budget_id: "budget-1",
		});

		const cleared = await registry.executeTool({
			name: "ynab_clear_cache",
			accessToken: "unit-test-token",
			arguments: {},
		});
		expect(cleared.structuredContent).toEqual({ success: true });
	});

	it("rejects missing and mismatched tool access tokens", async () => {
		const registry = server.getToolRegistry();
		const missing = await registry.executeTool({
			name: "ynab_get_default_budget",
			accessToken: "",
			arguments: {},
		});
		expect(missing).toMatchObject({ isError: true });

		const mismatch = await registry.executeTool({
			name: "ynab_get_default_budget",
			accessToken: "wrong-token",
			arguments: {},
		});
		expect(mismatch).toMatchObject({ isError: true });
	});

	it("starts after connection and treats token validation as non-fatal", async () => {
		const connect = vi.spyOn(server.getServer(), "connect").mockResolvedValue();
		vi.spyOn(server, "validateToken").mockRejectedValue("offline");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await server.run();

		expect(connect).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith(
			"⚠️ Token validation warning: offline",
		);
		expect(consoleError).toHaveBeenCalledWith(
			"YNAB MCP Server started successfully",
		);
	});

	it("rethrows classified startup failures when process exit is disabled", async () => {
		const failure = new ConfigurationError("bad configuration");
		vi.spyOn(server.getServer(), "connect").mockRejectedValue(failure);
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(server.run()).rejects.toBe(failure);
	});

	it("loads configuration independently for each server", () => {
		const initial = config.loadConfig();
		vi.spyOn(config, "loadConfig")
			.mockReturnValueOnce({
				...initial,
				YNAB_DEFAULT_BUDGET_ID: "first-budget",
			})
			.mockReturnValueOnce({
				...initial,
				YNAB_DEFAULT_BUDGET_ID: "second-budget",
			});
		const first = new YNABMCPServer(false);
		const second = new YNABMCPServer(false);
		expect(first.getDefaultBudget()).toBe("first-budget");
		expect(second.getDefaultBudget()).toBe("second-budget");
	});

	it.each([
		[{ RATE_LIMIT_LOGGING: true }, true],
		[{ LOG_LEVEL: "debug" as const }, true],
		[{ VERBOSE_TESTS: true }, true],
		[{}, false],
	])("enables rate limiter logging from config %o", (overrides, expected) => {
		vi.spyOn(config, "loadConfig").mockReturnValueOnce({
			...config.loadConfig(),
			RATE_LIMIT_LOGGING: false,
			VERBOSE_TESTS: false,
			...overrides,
		});
		const configured = new YNABMCPServer(false);
		const internals = configured as unknown as {
			rateLimiter: { config: { enableLogging: boolean } };
		};
		expect(internals.rateLimiter.config.enableLogging).toBe(expected);
	});

	it.each([
		"ynab_list_accounts",
		"ynab_list_transactions",
		"ynab_list_categories",
		"ynab_list_payees",
		"ynab_list_months",
	])("returns a consistent missing-budget error for %s", async (name) => {
		const result = await server.getToolRegistry().executeTool({
			name,
			accessToken: "unit-test-token",
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(JSON.parse(textOf(result.content[0]))).toMatchObject({
			error: {
				code: "VALIDATION_ERROR",
				message: expect.stringContaining("No budget ID provided"),
				suggestions: expect.any(Array),
			},
		});
	});

	it("rejects malformed budget IDs before calling the API", async () => {
		const request = vi.spyOn(server.getYNABAPI().accounts, "getAccounts");
		const result = await server.getToolRegistry().executeTool({
			name: "ynab_list_accounts",
			accessToken: "unit-test-token",
			arguments: { budget_id: "invalid" },
		});
		expect(result.isError).toBe(true);
		expect(JSON.parse(textOf(result.content[0])).error.code).toBe(
			"VALIDATION_ERROR",
		);
		expect(request).not.toHaveBeenCalled();
	});

	it("resolves the default budget and caches repeated account reads", async () => {
		const budgetId = "00000000-0000-4000-8000-000000000001";
		const request = vi
			.spyOn(server.getYNABAPI().accounts, "getAccounts")
			.mockResolvedValue({ data: { accounts: [], server_knowledge: 1 } });
		server.setDefaultBudget(budgetId);
		for (let i = 0; i < 2; i++) {
			const result = await server.getToolRegistry().executeTool({
				name: "ynab_list_accounts",
				accessToken: "unit-test-token",
				arguments: {},
			});
			expect(result.isError).not.toBe(true);
			expect(result.structuredContent).toMatchObject({ accounts: [] });
		}
		expect(request).toHaveBeenCalledExactlyOnceWith(budgetId);
	});

	it.each([false, true])(
		"setting a default budget tolerates warming failures=%s",
		async (fail) => {
			const budgetId = "00000000-0000-4000-8000-000000000001";
			vi.spyOn(server.getYNABAPI().plans, "getPlanById").mockResolvedValue({
				data: { plan: { id: budgetId, name: "Test" }, server_knowledge: 1 },
			} as never);
			const accounts = vi.spyOn(server.getYNABAPI().accounts, "getAccounts");
			const categories = vi.spyOn(
				server.getYNABAPI().categories,
				"getCategories",
			);
			const payees = vi.spyOn(server.getYNABAPI().payees, "getPayees");
			if (fail) {
				accounts.mockRejectedValue(new Error("offline"));
				categories.mockRejectedValue(new Error("offline"));
				payees.mockRejectedValue(new Error("offline"));
			} else {
				accounts.mockResolvedValue({
					data: { accounts: [], server_knowledge: 1 },
				});
				categories.mockResolvedValue({
					data: { category_groups: [], server_knowledge: 1 },
				});
				payees.mockResolvedValue({ data: { payees: [], server_knowledge: 1 } });
			}
			const result = await server.getToolRegistry().executeTool({
				name: "ynab_set_default_budget",
				accessToken: "unit-test-token",
				arguments: { budget_id: budgetId },
			});
			expect(result.structuredContent).toMatchObject({
				success: true,
				default_budget_id: budgetId,
				cache_warm_started: true,
			});
			await vi.waitFor(() => {
				expect(accounts).toHaveBeenCalledOnce();
				expect(categories).toHaveBeenCalledOnce();
				expect(payees).toHaveBeenCalledOnce();
			});
			expect(server.getDefaultBudget()).toBe(budgetId);
		},
	);

	it("reports and clears only this server's cache", async () => {
		const otherServer = new YNABMCPServer(false);
		const cacheOf = (instance: YNABMCPServer) =>
			(instance as unknown as { cacheManager: CacheManager }).cacheManager;
		cacheOf(server).set("test:entry", 1);
		cacheOf(server).get("test:entry");
		cacheOf(otherServer).set("other:entry", 2);
		const diagnostics = await server.getToolRegistry().executeTool({
			name: "ynab_diagnostic_info",
			accessToken: "unit-test-token",
			arguments: {
				include_server: false,
				include_cache: true,
				include_memory: false,
				include_environment: false,
				include_security: false,
				response_format: "json",
			},
		});
		expect(diagnostics.structuredContent).toMatchObject({
			cache: { entries: 1, hits: 1 },
		});
		expect(diagnostics.structuredContent).not.toHaveProperty("memory");
		await server.getToolRegistry().executeTool({
			name: "ynab_clear_cache",
			accessToken: "unit-test-token",
			arguments: {},
		});
		expect(cacheOf(server).getStats().size).toBe(0);
		expect(cacheOf(otherServer).get("other:entry")).toBe(2);
	});
});
