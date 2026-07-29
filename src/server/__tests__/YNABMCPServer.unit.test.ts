import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../../utils/errors.js";

vi.mock("../config.js", () => ({
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
});
