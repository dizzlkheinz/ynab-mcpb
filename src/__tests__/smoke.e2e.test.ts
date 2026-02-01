/**
 * End-to-end smoke tests for YNAB MCP Server
 *
 * These tests require a real YNAB API key but only perform read operations
 * to verify connectivity and basic functionality without hitting rate limits.
 *
 * NOTE: This file was intentionally reduced from comprehensive CRUD workflow tests
 * to lightweight smoke tests. The full E2E test suite was removed because:
 * 1. YNAB API rate limits (200 requests/hour) made full E2E runs unreliable in CI
 * 2. Comprehensive integration tests with mocked APIs provide better coverage
 * 3. Smoke tests validate real API connectivity without rate limit pressure
 *
 * For full workflow testing, see integration tests in src/tools/__tests__/
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { YNABMCPServer } from "../server/YNABMCPServer.js";
import {
	createTestServer,
	executeToolCall,
	getTestConfig,
	parseToolResult,
	validateOutputSchema,
} from "./testUtils.js";

const runE2ETests = process.env.SKIP_E2E_TESTS !== "true";
const describeE2E = runE2ETests ? describe : describe.skip;

describeE2E("YNAB MCP Server - Smoke Tests", () => {
	let server: YNABMCPServer;
	let testConfig: ReturnType<typeof getTestConfig>;

	beforeAll(async () => {
		testConfig = getTestConfig();

		if (testConfig.skipE2ETests) {
			console.warn(
				"Skipping E2E smoke tests - no real API key or SKIP_E2E_TESTS=true",
			);
			return;
		}

		server = await createTestServer();
	});

	it("should authenticate and retrieve user information", async () => {
		if (testConfig.skipE2ETests) return;

		const result = await executeToolCall(server, "ynab:get_user");

		// Validate output schema
		const validation = validateOutputSchema(server, "get_user", result);
		expect(validation.valid).toBe(true);

		const data = parseToolResult(result);
		expect(data.data.user).toBeDefined();
		expect(data.data.user.id).toBeDefined();
	});

	it("should list budgets", async () => {
		if (testConfig.skipE2ETests) return;

		const result = await executeToolCall(server, "ynab:list_budgets");

		// Validate output schema
		const validation = validateOutputSchema(server, "list_budgets", result);
		expect(validation.valid).toBe(true);

		const data = parseToolResult(result);
		expect(Array.isArray(data.data.budgets)).toBe(true);
	});
});
