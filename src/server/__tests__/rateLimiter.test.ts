/**
 * Unit tests for RateLimiter class
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError, RateLimiter } from "../rateLimiter.js";

describe("RateLimiter", () => {
	let rateLimiter: RateLimiter;
	const testIdentifier = "test-token-123";

	beforeEach(() => {
		rateLimiter = new RateLimiter({
			maxRequests: 5,
			windowMs: 1000, // 1 second for testing
			enableLogging: false,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("isAllowed", () => {
		it("should allow requests within the limit", () => {
			const result = rateLimiter.isAllowed(testIdentifier);

			expect(result.isLimited).toBe(false);
			expect(result.remaining).toBe(5);
			expect(result.resetTime).toBeInstanceOf(Date);
		});

		it("should track requests correctly", () => {
			// Make 3 requests
			rateLimiter.recordRequest(testIdentifier);
			rateLimiter.recordRequest(testIdentifier);
			rateLimiter.recordRequest(testIdentifier);

			const result = rateLimiter.isAllowed(testIdentifier);

			expect(result.isLimited).toBe(false);
			expect(result.remaining).toBe(2);
		});

		it("should limit requests when max is reached", () => {
			// Make 5 requests (the limit)
			for (let i = 0; i < 5; i++) {
				rateLimiter.recordRequest(testIdentifier);
			}

			const result = rateLimiter.isAllowed(testIdentifier);

			expect(result.isLimited).toBe(true);
			expect(result.remaining).toBe(0);
		});

		it("should handle multiple identifiers independently", () => {
			const identifier1 = "token-1";
			const identifier2 = "token-2";

			// Max out identifier1
			for (let i = 0; i < 5; i++) {
				rateLimiter.recordRequest(identifier1);
			}

			// identifier2 should still be allowed
			const result1 = rateLimiter.isAllowed(identifier1);
			const result2 = rateLimiter.isAllowed(identifier2);

			expect(result1.isLimited).toBe(true);
			expect(result2.isLimited).toBe(false);
			expect(result2.remaining).toBe(5);
		});

		it("should reset after time window expires", async () => {
			// Use a very short window for testing
			const shortWindowLimiter = new RateLimiter({
				maxRequests: 2,
				windowMs: 50, // 50ms
				enableLogging: false,
			});

			// Max out the requests
			shortWindowLimiter.recordRequest(testIdentifier);
			shortWindowLimiter.recordRequest(testIdentifier);

			expect(shortWindowLimiter.isAllowed(testIdentifier).isLimited).toBe(true);

			// Wait for window to expire
			await new Promise((resolve) => setTimeout(resolve, 60));

			// Should be allowed again
			const result = shortWindowLimiter.isAllowed(testIdentifier);
			expect(result.isLimited).toBe(false);
			expect(result.remaining).toBe(2);
		});
	});

	describe("recordRequest", () => {
		it("should record requests correctly", () => {
			rateLimiter.recordRequest(testIdentifier);
			rateLimiter.recordRequest(testIdentifier);

			const status = rateLimiter.getStatus(testIdentifier);
			expect(status.remaining).toBe(3);
		});

		it("should handle rapid successive requests", () => {
			// Record requests rapidly
			for (let i = 0; i < 10; i++) {
				rateLimiter.recordRequest(testIdentifier);
			}

			const status = rateLimiter.getStatus(testIdentifier);
			expect(status.isLimited).toBe(true);
			expect(status.remaining).toBe(0);
		});
	});

	describe("getStatus", () => {
		it("should return current status without modifying state", () => {
			rateLimiter.recordRequest(testIdentifier);

			const status1 = rateLimiter.getStatus(testIdentifier);
			const status2 = rateLimiter.getStatus(testIdentifier);

			expect(status1.remaining).toBe(status2.remaining);
			expect(status1.isLimited).toBe(status2.isLimited);
		});
	});

	describe("markExhausted", () => {
		it("should mark the identifier limited on the next check", () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-05-10T12:00:00Z"));

			rateLimiter.markExhausted(testIdentifier);
			vi.advanceTimersByTime(10);

			const status = rateLimiter.getStatus(testIdentifier);
			expect(status.isLimited).toBe(true);
			expect(status.remaining).toBe(0);
		});
	});

	describe("reset", () => {
		it("should reset specific identifier", () => {
			// Max out requests
			for (let i = 0; i < 5; i++) {
				rateLimiter.recordRequest(testIdentifier);
			}

			expect(rateLimiter.isAllowed(testIdentifier).isLimited).toBe(true);

			// Reset
			rateLimiter.reset(testIdentifier);

			// Should be allowed again
			const result = rateLimiter.isAllowed(testIdentifier);
			expect(result.isLimited).toBe(false);
			expect(result.remaining).toBe(5);
		});

		it("should reset all identifiers when no specific identifier provided", () => {
			const identifier1 = "token-1";
			const identifier2 = "token-2";

			// Max out both identifiers
			for (let i = 0; i < 5; i++) {
				rateLimiter.recordRequest(identifier1);
				rateLimiter.recordRequest(identifier2);
			}

			expect(rateLimiter.isAllowed(identifier1).isLimited).toBe(true);
			expect(rateLimiter.isAllowed(identifier2).isLimited).toBe(true);

			// Reset all
			rateLimiter.reset();

			// Both should be allowed again
			expect(rateLimiter.isAllowed(identifier1).isLimited).toBe(false);
			expect(rateLimiter.isAllowed(identifier2).isLimited).toBe(false);
		});
	});

	describe("cleanup", () => {
		it("should remove expired requests", async () => {
			const shortWindowLimiter = new RateLimiter({
				maxRequests: 5,
				windowMs: 50, // 50ms
				enableLogging: false,
			});

			// Record some requests
			shortWindowLimiter.recordRequest(testIdentifier);
			shortWindowLimiter.recordRequest(testIdentifier);

			expect(shortWindowLimiter.getStatus(testIdentifier).remaining).toBe(3);

			// Wait for requests to expire
			await new Promise((resolve) => setTimeout(resolve, 60));

			// Cleanup
			shortWindowLimiter.cleanup();

			// Should have full capacity again
			const result = shortWindowLimiter.getStatus(testIdentifier);
			expect(result.remaining).toBe(5);
		});
	});

	describe("logging", () => {
		it("should log when logging is enabled", () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
				// Mock implementation for testing
			});

			const loggingLimiter = new RateLimiter({
				maxRequests: 2,
				windowMs: 1000,
				enableLogging: true,
			});

			loggingLimiter.isAllowed(testIdentifier);
			loggingLimiter.recordRequest(testIdentifier);

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Rate limit check"),
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Recorded request"),
			);

			consoleSpy.mockRestore();
		});

		it("should not log when logging is disabled", () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
				// Mock implementation for testing
			});

			rateLimiter.isAllowed(testIdentifier);
			rateLimiter.recordRequest(testIdentifier);

			expect(consoleSpy).not.toHaveBeenCalled();

			consoleSpy.mockRestore();
		});
	});

	describe("RateLimitError", () => {
		it("should create error with correct properties", () => {
			const resetTime = new Date();
			const error = new RateLimitError("Rate limit exceeded", resetTime, 0);

			expect(error.message).toBe("Rate limit exceeded");
			expect(error.resetTime).toBe(resetTime);
			expect(error.remaining).toBe(0);
			expect(error.name).toBe("RateLimitError");
		});
	});

	describe("YNAB API compliance", () => {
		it("should use YNAB API limits by default", () => {
			const defaultLimiter = new RateLimiter();

			// YNAB allows 200 requests per hour
			const status = defaultLimiter.getStatus(testIdentifier);
			expect(status.remaining).toBe(200);
		});

		it("should handle YNAB-scale request volumes", () => {
			const ynabLimiter = new RateLimiter({
				maxRequests: 200,
				windowMs: 60 * 60 * 1000, // 1 hour
				enableLogging: false,
			});

			// Make 150 requests
			for (let i = 0; i < 150; i++) {
				ynabLimiter.recordRequest(testIdentifier);
			}

			const status = ynabLimiter.getStatus(testIdentifier);
			expect(status.remaining).toBe(50);
			expect(status.isLimited).toBe(false);

			// Make 50 more requests to hit the limit
			for (let i = 0; i < 50; i++) {
				ynabLimiter.recordRequest(testIdentifier);
			}

			const limitedStatus = ynabLimiter.getStatus(testIdentifier);
			expect(limitedStatus.remaining).toBe(0);
			expect(limitedStatus.isLimited).toBe(true);
		});
	});

	describe("security considerations", () => {
		it("should hash identifiers in logs to avoid token exposure", () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {
				// Mock implementation for testing
			});

			const loggingLimiter = new RateLimiter({
				maxRequests: 2,
				windowMs: 1000,
				enableLogging: true,
			});

			const sensitiveToken = "very-secret-token-12345";
			loggingLimiter.isAllowed(sensitiveToken);

			// Check that the actual token is not in the log
			const logCalls = consoleSpy.mock.calls.flat();
			const hasActualToken = logCalls.some(
				(call) => typeof call === "string" && call.includes(sensitiveToken),
			);

			expect(hasActualToken).toBe(false);

			// Check that a hashed version is used
			const hasHashedToken = logCalls.some(
				(call) => typeof call === "string" && call.includes("token_"),
			);

			expect(hasHashedToken).toBe(true);

			consoleSpy.mockRestore();
		});
	});
});
