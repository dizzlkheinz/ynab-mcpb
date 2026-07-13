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

const initialTestConfig = getTestConfig();
const describeE2E = initialTestConfig.liveTestsEnabled
	? describe
	: describe.skip;

describeE2E("YNAB MCP Server - Smoke Tests", () => {
	let server: YNABMCPServer;
	let testConfig = initialTestConfig;

	beforeAll(async () => {
		testConfig = getTestConfig();

		if (testConfig.skipE2ETests) {
			console.warn(
				"Skipping E2E smoke tests - set RUN_LIVE_YNAB_TESTS=true with a real token and leave SKIP_E2E_TESTS disabled",
			);
			return;
		}

		server = await createTestServer();
	});

	it("should authenticate and retrieve user information", async () => {
		if (testConfig.skipE2ETests) return;

		const result = await executeToolCall(server, "ynab:get_user");

		// Validate output schema
		const validation = validateOutputSchema(server, "ynab_get_user", result);
		expect(validation.valid).toBe(true);

		const data = parseToolResult(result);
		expect(data.data.user).toBeDefined();
		expect(data.data.user.id).toBeDefined();
	});

	it("should list budgets", async () => {
		if (testConfig.skipE2ETests) return;

		const result = await executeToolCall(server, "ynab:list_budgets");

		// Validate output schema
		const validation = validateOutputSchema(
			server,
			"ynab_list_budgets",
			result,
		);
		expect(validation.valid).toBe(true);

		const data = parseToolResult(result);
		expect(Array.isArray(data.data.budgets)).toBe(true);
	});
});
