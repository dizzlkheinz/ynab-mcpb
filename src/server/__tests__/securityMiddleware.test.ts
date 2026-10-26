/**
 * Unit tests for SecurityMiddleware class
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { textOf } from "../../__tests__/testUtils.js";
import { RateLimitError } from "../rateLimiter.js";
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
			const responseText = JSON.parse(textOf(result.content[0]));
			expect(responseText.error.code).toBe("VALIDATION_ERROR");
			expect(responseText.error.message).toContain("Invalid parameters");
		});

		it("does not charge local tool operations against the API quota", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:get_default_budget",
				operation: "get default budget",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};
			const operation = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "Success" }],
			});
			const results = await Promise.all(
				Array.from({ length: 201 }, () =>
					SecurityMiddleware.withSecurity(context, testSchema, operation),
				),
			);
			expect(operation).toHaveBeenCalledTimes(201);
			expect(results.every((result) => !result.isError)).toBe(true);
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
			expect(logs[0]!.toolName).toBe("ynab:test");
			expect(logs[0]!.operation).toBe("test operation");
			expect(logs[0]!.success).toBe(true);
			expect(logs[0]!.duration).toBeGreaterThanOrEqual(0);
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
			expect(logs[0]!.success).toBe(false);
			expect(logs[0]!.error).toBe("Test error");
		});

		it("logs transport rate errors and preserves them for the registry", async () => {
			const context: SecurityContext = {
				accessToken: testAccessToken,
				toolName: "ynab:test",
				operation: "test operation",
				parameters: { budget_id: "test-budget" },
				startTime: Date.now(),
			};
			const error = new RateLimitError("Rate limit exceeded", new Date(), 0);
			await expect(
				SecurityMiddleware.withSecurity(
					context,
					testSchema,
					vi.fn().mockRejectedValue(error),
				),
			).rejects.toBe(error);
			expect(globalRequestLogger.getRecentLogs(1)[0]).toMatchObject({
				success: false,
				error: "Rate limit exceeded",
			});
		});

		it("does not invent API quota information for tool logs", async () => {
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

			expect(logs[0]!.rateLimitInfo).toBeUndefined();
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
			const responseText = JSON.parse(textOf(result.content[0]));
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
			const responseText = JSON.parse(textOf(result.content[0]));
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
			expect(stats.requestStats["totalRequests"]).toBe(1);
			expect(stats.requestStats["successfulRequests"]).toBe(1);
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
			expect(statsBefore.requestStats["totalRequests"]).toBe(1);

			// Reset
			SecurityMiddleware.reset();

			// Verify state is cleared
			const statsAfter = SecurityMiddleware.getSecurityStats();
			expect(statsAfter.requestStats["totalRequests"]).toBe(0);
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
			const responseText = JSON.parse(textOf(result.content[0]));
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
