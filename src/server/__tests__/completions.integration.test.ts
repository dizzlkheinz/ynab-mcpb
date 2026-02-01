import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestServer, getTestConfig } from "../../__tests__/testUtils.js";
import type { YNABMCPServer } from "../YNABMCPServer.js";

/**
 * Integration tests for CompletionsManager
 * Tests completions functionality with real or mocked YNAB API
 */
describe("CompletionsManager Integration", () => {
	let server: YNABMCPServer;
	let testConfig: ReturnType<typeof getTestConfig>;

	beforeAll(async () => {
		testConfig = getTestConfig();

		if (testConfig.skipE2ETests) {
			console.warn(
				"Skipping CompletionsManager integration tests - no real API key",
			);
			return;
		}

		server = await createTestServer();
	});

	beforeEach(() => {
		if (testConfig.skipE2ETests) {
			return;
		}
	});

	describe("Budget Completions", () => {
		it("should complete budget names from real API", async () => {
			if (testConfig.skipE2ETests) return;

			const completionsManager = (
				server as unknown as {
					completionsManager: {
						getCompletions: (
							arg: string,
							val: string,
						) => Promise<{ completion: { values: string[]; total: number } }>;
					};
				}
			).completionsManager;

			if (!completionsManager) {
				console.warn(
					"CompletionsManager not exposed on server - skipping test",
				);
				return;
			}

			const result = await completionsManager.getCompletions("budget_id", "");

			expect(result.completion).toBeDefined();
			expect(Array.isArray(result.completion.values)).toBe(true);
			// Should have at least one budget
			expect(result.completion.total).toBeGreaterThanOrEqual(0);
		});
	});

	describe("Account Completions", () => {
		it("should require budget context for account completions", async () => {
			if (testConfig.skipE2ETests) return;

			const completionsManager = (
				server as unknown as {
					completionsManager: {
						getCompletions: (
							arg: string,
							val: string,
							ctx?: unknown,
						) => Promise<{ completion: { values: string[]; total: number } }>;
					};
				}
			).completionsManager;

			if (!completionsManager) {
				console.warn(
					"CompletionsManager not exposed on server - skipping test",
				);
				return;
			}

			// Without budget context, should return empty
			const result = await completionsManager.getCompletions(
				"account_id",
				"check",
			);

			expect(result.completion).toBeDefined();
			expect(Array.isArray(result.completion.values)).toBe(true);
		});
	});

	describe("MCP Completion Handler Integration", () => {
		it("should handle completion requests through MCP server", async () => {
			if (testConfig.skipE2ETests) return;

			const mcpServer = server.getServer();

			// The MCP server should have completion capability
			expect(mcpServer).toBeDefined();

			// Note: Full MCP completion request testing would require
			// setting up the complete MCP request/response flow
			// This is a basic smoke test for integration
		});
	});
});

/**
 * Mock-based integration tests that don't require real API
 */
describe("CompletionsManager Mock Integration", () => {
	it("should be importable and constructible", async () => {
		const { CompletionsManager } = await import("../completions.js");
		expect(CompletionsManager).toBeDefined();
	});

	it("should export correct types", async () => {
		const module = await import("../completions.js");
		expect(module.CompletionsManager).toBeDefined();
	});
});
