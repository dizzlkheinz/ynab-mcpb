/**
 * Unit tests for SecurityMiddleware class
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import {
	globalRateLimiter,
	RateLimitError,
	RateLimiter,
} from "../rateLimiter.js";
import { globalRequestLogger } from "../requestLogger.js";
import {
	type SecurityContext,
	SecurityMiddleware,
	withSecurityWrapper,
} from "../securityMiddleware.js";

describe("SecurityMiddleware", () => {
	const testAccessToken = "test-access-token-123";
	const testSchema = z.object({
		budget_id: z.string().min(1),
		amount: z.number().optional(),
	});

	beforeEach(() => {
		// Reset security state before each test
		SecurityMiddleware.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("withSecurity", () => {
		it("should execute operation successfully with valid input", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget", amount: 1000 },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			const result = await SecurityMiddleware.withSecurity(
				context,
				testSchema,
				mockOperation,
			);

			expect(mockOperation).toHaveBeenCalledWith({
				budget_id: "test-budget",
				amount: 1000,
			});
			expect(result).toEqual({
				content: [{ type: "text", text: "Success" }],
			});
		});

		it("should validate input parameters", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "", amount: "invalid" }, // Invalid parameters
				startTime: Date.now(),
			};

			const mockOperation = vi.fn();

			const result = await SecurityMiddleware.withSecurity(
				context,
				testSchema,
				mockOperation,
			);

			expect(mockOperation).not.toHaveBeenCalled();
			const responseText = JSON.parse(result.content[0].text);
			expect(responseText.error.code).toBe("VALIDATION_ERROR");
			expect(responseText.error.message).toContain("Invalid parameters");
		});

		it("should enforce rate limiting", async () => {
			// Create a test rate limiter with small limits
			const testLimiter = new RateLimiter({
				maxRequests: 2,
				windowMs: 1000,
				enableLogging: false,
			});

			// Mock the global rate limiter
			const originalIsAllowed = globalRateLimiter.isAllowed;
			const originalRecordRequest = globalRateLimiter.recordRequest;
			const originalGetStatus = globalRateLimiter.getStatus;

			globalRateLimiter.isAllowed = testLimiter.isAllowed.bind(testLimiter);
			globalRateLimiter.recordRequest =
				testLimiter.recordRequest.bind(testLimiter);
			globalRateLimiter.getStatus = testLimiter.getStatus.bind(testLimiter);

			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			try {
				// First two requests should succeed
				await SecurityMiddleware.withSecurity(
					context,
					testSchema,
					mockOperation,
				);
				await SecurityMiddleware.withSecurity(
					context,
					testSchema,
					mockOperation,
				);

				// Third request should be rate limited
				const result = await SecurityMiddleware.withSecurity(
					context,
					testSchema,
					mockOperation,
				);

				const responseText = JSON.parse(result.content[0].text);
				expect(responseText.error.code).toBe("RATE_LIMIT_EXCEEDED");
				expect(responseText.error.message).toContain("Rate limit exceeded");
			} finally {
				// Restore original methods
				globalRateLimiter.isAllowed = originalIsAllowed;
				globalRateLimiter.recordRequest = originalRecordRequest;
				globalRateLimiter.getStatus = originalGetStatus;
			}
		});

		it("should log successful requests", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);

			const logs = globalRequestLogger.getRecentLogs(1);

			expect(logs).toHaveLength(1);
			expect(logs[0].toolName).toBe("ynab:test");
			expect(logs[0].operation).toBe("test operation");
			expect(logs[0].success).toBe(true);
			expect(logs[0].duration).toBeGreaterThanOrEqual(0);
		});

		it("should log failed requests", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockRejectedValue(new Error("Test error"));

			try {
				await SecurityMiddleware.withSecurity(
					context,
					testSchema,
					mockOperation,
				);
			} catch {
				// Expected to throw
			}

			const logs = globalRequestLogger.getRecentLogs(1);

			expect(logs).toHaveLength(1);
			expect(logs[0].success).toBe(false);
			expect(logs[0].error).toBe("Test error");
		});

		it("should handle rate limit errors specially", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const mockOperation = vi
				.fn()
				.mockRejectedValue(
					new RateLimitError("Rate limit exceeded", new Date(), 0),
				);

			const result = await SecurityMiddleware.withSecurity(
				context,
				testSchema,
				mockOperation,
			);

			const responseText = JSON.parse(result.content[0].text);
			expect(responseText.error.code).toBe("RATE_LIMIT_EXCEEDED");
			expect(responseText.error.details.resetTime).toBeDefined();
			expect(responseText.error.details.remaining).toBe(0);
		});

		it("should include rate limit info in logs", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);

			const logs = globalRequestLogger.getRecentLogs(1);

			expect(logs[0].rateLimitInfo).toBeDefined();
			expect(logs[0].rateLimitInfo.remaining).toBeGreaterThanOrEqual(0);
			expect(typeof logs[0].rateLimitInfo.isLimited).toBe("boolean");
		});
	});

	describe("input validation", () => {
		it("should validate required fields", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: {}, // Missing required budget_id
				startTime: Date.now(),
			};

			const mockOperation = vi.fn();

			const result = await SecurityMiddleware.withSecurity(
				context,
				testSchema,
				mockOperation,
			);

			expect(mockOperation).not.toHaveBeenCalled();
			const responseText = JSON.parse(result.content[0].text);
			expect(responseText.error.code).toBe("VALIDATION_ERROR");
			expect(responseText.error.message).toContain("Invalid parameters");
		});

		it("should validate field types", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget", amount: "not-a-number" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn();

			const result = await SecurityMiddleware.withSecurity(
				context,
				testSchema,
				mockOperation,
			);

			expect(mockOperation).not.toHaveBeenCalled();
			const responseText = JSON.parse(result.content[0].text);
			expect(responseText.error.code).toBe("VALIDATION_ERROR");
			expect(responseText.error.message).toContain("Invalid parameters");
		});

		it("should pass valid optional fields", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" }, // amount is optional
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);

			expect(mockOperation).toHaveBeenCalledWith({
				budget_id: "test-budget",
			});
		});
	});

	describe("token hashing", () => {
		it("should use consistent hashing for the same token", async () => {
			const context1: SecurityContext = {
				accessToken: "same-token",
				toolName: "ynab:test1",
				operation: "test",
				parameters: { budget_id: "test" },
				startTime: Date.now(),
			};

			const context2: SecurityContext = {
				accessToken: "same-token",
				toolName: "ynab:test2",
				operation: "test",
				parameters: { budget_id: "test" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			await SecurityMiddleware.withSecurity(
				context1,
				testSchema,
				mockOperation,
			);
			await SecurityMiddleware.withSecurity(
				context2,
				testSchema,
				mockOperation,
			);

			const logs = globalRequestLogger.getRecentLogs(2);

			// Both requests should affect the same rate limit counter
			expect(logs[0].rateLimitInfo.remaining).toBe(
				logs[1].rateLimitInfo.remaining + 1,
			);
		});

		it("should use different hashing for different tokens", async () => {
			const context1: SecurityContext = {
				accessToken: "token-1",
				toolName: "ynab:test",
				operation: "test",
				parameters: { budget_id: "test" },
				startTime: Date.now(),
			};

			const context2: SecurityContext = {
				accessToken: "token-2",
				toolName: "ynab:test",
				operation: "test",
				parameters: { budget_id: "test" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			await SecurityMiddleware.withSecurity(
				context1,
				testSchema,
				mockOperation,
			);
			await SecurityMiddleware.withSecurity(
				context2,
				testSchema,
				mockOperation,
			);

			const logs = globalRequestLogger.getRecentLogs(2);

			// Different tokens should have independent rate limit counters
			expect(logs[0].rateLimitInfo.remaining).toBe(
				logs[1].rateLimitInfo.remaining,
			);
		});
	});

	describe("getSecurityStats", () => {
		it("should return security statistics", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);

			const stats = SecurityMiddleware.getSecurityStats();

			expect(stats.rateLimitStats).toBeDefined();
			expect(stats.requestStats).toBeDefined();
			expect(stats.requestStats.totalRequests).toBe(1);
			expect(stats.requestStats.successfulRequests).toBe(1);
		});
	});

	describe("reset", () => {
		it("should reset security state", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const mockOperation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			// Make a request
			await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);

			// Verify state exists
			const statsBefore = SecurityMiddleware.getSecurityStats();
			expect(statsBefore.requestStats.totalRequests).toBe(1);

			// Reset
			SecurityMiddleware.reset();

			// Verify state is cleared
			const statsAfter = SecurityMiddleware.getSecurityStats();
			expect(statsAfter.requestStats.totalRequests).toBe(0);
		});
	});

	describe("withSecurityWrapper", () => {
		it("should create a properly configured wrapper function", async () => {
			const wrapper = withSecurityWrapper(
				"ynab:test",
				"test operation",
				testSchema,
			);

			const tokenWrapper = wrapper(testAccessToken);
			const paramWrapper = tokenWrapper({ budget_id: "test-budget" });

			const mockHandler = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});

			const result = await paramWrapper(mockHandler);

			expect(mockHandler).toHaveBeenCalledWith({ budget_id: "test-budget" });
			expect(result).toEqual({
				content: [{ type: "text", text: "Success" }],
			});
		});
	});

	describe("error handling", () => {
		it("should handle validation errors gracefully", async () => {
			const invalidSchema = z.object({
				budget_id: z.string().min(10), // Require at least 10 characters
			});

			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "short" }, // Too short
				startTime: Date.now(),
			};

			const mockOperation = vi.fn();

			const result = await SecurityMiddleware.withSecurity(
				context,
				invalidSchema,
				mockOperation,
			);

			expect(mockOperation).not.toHaveBeenCalled();
			const responseText = JSON.parse(result.content[0].text);
			expect(responseText.error.code).toBe("VALIDATION_ERROR");
			expect(responseText.error.message).toContain("Invalid parameters");
		});

		it("should handle operation errors and re-throw them", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};

			const testError = new Error("Operation failed");
			const mockOperation = vi.fn().mockRejectedValue(testError);

			await expect(
				SecurityMiddleware.withSecurity(context, testSchema, mockOperation),
			).rejects.toThrow("Operation failed");
		});
	});
});
