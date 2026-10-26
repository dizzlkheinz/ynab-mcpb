/**
 * Integration tests for security measures
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { textOf } from "../../__tests__/testUtils.js";
import { RateLimiter } from "../rateLimiter.js";
import { globalRequestLogger, RequestLogger } from "../requestLogger.js";
import { SecurityMiddleware } from "../securityMiddleware.js";

describe("Security Integration", () => {
	const testAccessToken = "integration-test-token-123";
	const testSchema = z.object({
		budget_id: z.string().min(1),
		amount: z.number().optional(),
	});

	beforeEach(() => {
		// Reset all security components
		SecurityMiddleware.reset();

		// Pin the logger config so console-output assertions do not depend
		// on ambient LOG_LEVEL/NODE_ENV values
		globalRequestLogger.setConfig({ enabled: true, logLevel: "info" });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("end-to-end security flow", () => {
		it("should handle a complete successful request flow", async () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
				// Mock implementation for testing
			});

			const context = {
				accessToken: testAccessToken,
				toolName: "ynab:create_transaction",
				operation: "creating transaction",
				parameters: { budget_id: "test-budget-123", amount: 1000 },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: JSON.stringify({ success: true }) }],
			});

			// Execute the operation
			const result = await SecurityMiddleware.withSecurity(
				context,
				testSchema,
				mockOperation,
			);

			// Verify operation was called with validated parameters
			expect(mockOperation).toHaveBeenCalledWith({
				budget_id: "test-budget-123",
				amount: 1000,
			});

			// Verify successful result
			expect(textOf(result.content[0])).toContain("success");

			// Verify logging occurred
			const logs = globalRequestLogger.getRecentLogs(1);
			expect(logs).toHaveLength(1);
			expect(logs[0]!.toolName).toBe("ynab:create_transaction");
			expect(logs[0]!.success).toBe(true);
			expect(logs[0]!.parameters["budget_id"]).toBe("test-budget-123");
			expect(logs[0]!.parameters["amount"]).toBe(1000);

			// API accounting belongs to the transport, not the tool logger.
			expect(logs[0]!.rateLimitInfo).toBeUndefined();

			// Verify console logging (should show success)
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[INFO]"),
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"ynab:create_transaction:creating transaction | SUCCESS",
				),
			);

			consoleSpy.mockRestore();
		});

		it("should handle validation failures with proper logging", async () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
				// Mock implementation for testing
			});

			const context = {
				accessToken: testAccessToken,
				toolName: "ynab:create_transaction",
				operation: "creating transaction",
				parameters: { budget_id: "", amount: "invalid" }, // Invalid parameters
				startTime: Date.now(),
			};

			const mockOperation = vi.fn();

			const result = await SecurityMiddleware.withSecurity(
				context,
				testSchema,
				mockOperation,
			);

			// Verify operation was not called
			expect(mockOperation).not.toHaveBeenCalled();

			// Verify error response
			const responseText = JSON.parse(textOf(result.content[0]));
			expect(responseText.error.code).toBe("VALIDATION_ERROR");
			expect(responseText.error.message).toContain("Invalid parameters");

			// Verify error logging
			const logs = globalRequestLogger.getRecentLogs(1);
			expect(logs).toHaveLength(1);
			expect(logs[0]!.success).toBe(false);
			expect(logs[0]!.error).toContain("Validation failed");

			// Verify console error logging
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[ERROR]"),
			);

			consoleSpy.mockRestore();
		});

		it("logs local requests beyond the YNAB hourly quota without blocking", async () => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			const context = {
				accessToken: testAccessToken,
				toolName: "ynab:get_default_budget",
				operation: "get default budget",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};
			const operation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});
			for (let i = 0; i < 201; i++) {
				const result = await SecurityMiddleware.withSecurity(
					context,
					testSchema,
					operation,
				);
				expect(result.isError).not.toBe(true);
			}
			expect(operation).toHaveBeenCalledTimes(201);
			const logs = globalRequestLogger.getRecentLogs(201);
			expect(logs).toHaveLength(201);
			expect(
				logs.every((log) => log.success && log.rateLimitInfo === undefined),
			).toBe(true);
		});

		it("should sanitize sensitive data in logs", async () => {
			const context = {
				accessToken: testAccessToken,
				toolName: "ynab:create_transaction",
				operation: "creating transaction",
				parameters: {
					budget_id: "test-budget",
					memo: "Payment with token=secret123456789",
					access_token: "very-secret-token-abc123",
					api_key: "secret-api-key-xyz789",
				},
				startTime: Date.now(),
			};

			const extendedSchema = z.object({
				budget_id: z.string(),
				memo: z.string().optional(),
				access_token: z.string().optional(),
				api_key: z.string().optional(),
			});

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			await SecurityMiddleware.withSecurity(
				context,
				extendedSchema,
				mockOperation,
			);

			const logs = globalRequestLogger.getRecentLogs(1);
			const loggedParams = logs[0]!.parameters;

			// Verify sensitive data is sanitized
			expect(loggedParams["budget_id"]).toBe("test-budget"); // Non-sensitive data preserved
			expect(loggedParams["memo"]).toBe("Payment with token=***"); // Token pattern sanitized
			expect(loggedParams["access_token"]).toBe("***"); // Sensitive parameter name sanitized
			expect(loggedParams["api_key"]).toBe("***"); // Sensitive parameter name sanitized
		});

		it("keeps request logs for separate users without consuming API quota", async () => {
			const token1 = "user-1-token";
			const token2 = "user-2-token";

			const context1 = {
				accessToken: token1,
				toolName: "ynab:test",
				operation: "test",
				parameters: { budget_id: "budget-1" },
				startTime: Date.now(),
			};

			const context2 = {
				accessToken: token2,
				toolName: "ynab:test",
				operation: "test",
				parameters: { budget_id: "budget-2" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			// Exercise repeated local calls for the first user.
			await SecurityMiddleware.withSecurity(
				context1,
				testSchema,
				mockOperation,
			);
			await SecurityMiddleware.withSecurity(
				context1,
				testSchema,
				mockOperation,
			);
			await SecurityMiddleware.withSecurity(
				context1,
				testSchema,
				mockOperation,
			);

			// Repeated local calls remain successful.
			const user1Result = await SecurityMiddleware.withSecurity(
				context1,
				testSchema,
				mockOperation,
			);
			expect(textOf(user1Result.content[0])).toBe("Success");

			// User 2 should still be allowed
			const user2Result = await SecurityMiddleware.withSecurity(
				context2,
				testSchema,
				mockOperation,
			);
			expect(textOf(user2Result.content[0])).toBe("Success");

			// Verify independent tracking in logs
			const logs = globalRequestLogger.getRecentLogs(5);
			const user1Logs = logs.filter(
				(log) => log.parameters["budget_id"] === "budget-1",
			);
			const user2Logs = logs.filter(
				(log) => log.parameters["budget_id"] === "budget-2",
			);

			expect(user1Logs).toHaveLength(4);
			expect(user2Logs).toHaveLength(1); // 1 successful

			expect(user1Logs.every((log) => log.success)).toBe(true);
			expect(user2Logs[0]!.rateLimitInfo).toBeUndefined();
		});

		it("should provide comprehensive security statistics", async () => {
			const context = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const mockSuccessOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			const mockFailOperation = vi
				.fn()
				.mockRejectedValue(new Error("Test error"));

			// Make some successful requests
			await SecurityMiddleware.withSecurity(
				context,
				testSchema,
				mockSuccessOperation,
			);
			await SecurityMiddleware.withSecurity(
				context,
				testSchema,
				mockSuccessOperation,
			);

			// Make a failed request
			try {
				await SecurityMiddleware.withSecurity(
					context,
					testSchema,
					mockFailOperation,
				);
			} catch {
				// Expected
			}

			const stats = SecurityMiddleware.getSecurityStats();

			expect(stats.rateLimitStats).toBeDefined();
			expect(stats.requestStats).toBeDefined();
			expect(stats.requestStats["totalRequests"]).toBe(3);
			expect(stats.requestStats["successfulRequests"]).toBe(2);
			expect(stats.requestStats["failedRequests"]).toBe(1);
			expect(stats.requestStats["averageDuration"]).toBeGreaterThanOrEqual(0);
			expect(stats.requestStats["toolUsage"]).toMatchObject({ "ynab:test": 3 });
		});
	});

	describe("performance under load", () => {
		it("should handle rapid requests efficiently", async () => {
			const context = {
				accessToken: testAccessToken,
				toolName: "ynab:performance_test",
				operation: "performance test",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			const startTime = Date.now();

			// Make multiple rapid requests (within rate limit)
			const promises = [];
			for (let i = 0; i < 3; i++) {
				promises.push(
					SecurityMiddleware.withSecurity(context, testSchema, mockOperation),
				);
			}

			await Promise.all(promises);

			const endTime = Date.now();
			const totalTime = endTime - startTime;

			// Should complete reasonably quickly (less than 1 second for 3 requests)
			expect(totalTime).toBeLessThan(1000);

			// Verify all requests were processed
			expect(mockOperation).toHaveBeenCalledTimes(3);

			const logs = globalRequestLogger.getRecentLogs(3);
			expect(logs).toHaveLength(3);
			expect(logs.every((log) => log.success)).toBe(true);
		});
	});

	describe("cleanup and maintenance", () => {
		it("should clean up expired rate limit entries", async () => {
			// Use a very short window for testing
			const testLimiter = new RateLimiter({
				maxRequests: 5,
				windowMs: 50, // 50ms
				enableLogging: false,
			});

			const testToken = "cleanup-test-token";

			// Make some requests
			testLimiter.recordRequest(testToken);
			testLimiter.recordRequest(testToken);

			expect(testLimiter.getStatus(testToken).remaining).toBe(3);

			// Wait for window to expire
			await new Promise((resolve) => setTimeout(resolve, 60));

			// Cleanup
			testLimiter.cleanup();

			// Should have full capacity again
			expect(testLimiter.getStatus(testToken).remaining).toBe(5);
		});

		it("should maintain log size limits", async () => {
			const testLogger = new RequestLogger({ maxLogEntries: 2 });

			// Add more logs than the limit
			testLogger.logSuccess("tool1", "op1", {});
			testLogger.logSuccess("tool2", "op2", {});
			testLogger.logSuccess("tool3", "op3", {});

			const logs = testLogger.getRecentLogs();
			expect(logs).toHaveLength(2);

			// Should keep the most recent entries
			expect(logs[0]!.toolName).toBe("tool2");
			expect(logs[1]!.toolName).toBe("tool3");
		});
	});
});
