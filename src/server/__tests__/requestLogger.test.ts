/**
 * Unit tests for RequestLogger class
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestLogger, resolveLogLevel } from "../requestLogger.js";

describe("RequestLogger", () => {
	let logger: RequestLogger;

	beforeEach(() => {
		logger = new RequestLogger({
			enabled: true,
			logLevel: "info",
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("logRequest and statistics", () => {
		it("should track successful and failed requests with O(1) counters", () => {
			logger.logSuccess("ynab_list_budgets", "listing", 100);
			logger.logError("ynab_get_budget", "getting", "Not found", 50);
			logger.logSuccess("ynab_list_budgets", "listing", 150);
			logger.logSuccess("ynab_create_transaction", "creating", 200);
			logger.logError(
				"ynab_update_transaction",
				"updating",
				"Rate limited",
				75,
			);

			const stats = logger.getStats();
			expect(stats.totalRequests).toBe(5);
			expect(stats.successfulRequests).toBe(3);
			expect(stats.failedRequests).toBe(2);
			expect(stats.averageDuration).toBe(115);
			expect(stats.toolUsage).toEqual({
				ynab_list_budgets: 2,
				ynab_get_budget: 1,
				ynab_create_transaction: 1,
				ynab_update_transaction: 1,
			});
		});

		it("should not track or log when disabled", () => {
			const disabledLogger = new RequestLogger({ enabled: false });
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			disabledLogger.logSuccess("ynab_test", "test operation", 25);

			expect(disabledLogger.getStats().totalRequests).toBe(0);
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it("should reset counters on clearLogs", () => {
			logger.logSuccess("ynab_test1", "test", 10);
			logger.logError("ynab_test2", "test", "err", 20);
			expect(logger.getStats().totalRequests).toBe(2);

			logger.clearLogs();

			expect(logger.getStats()).toEqual({
				totalRequests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				averageDuration: 0,
				toolUsage: {},
			});
		});
	});

	describe("error sanitization and console output", () => {
		it("should sanitize sensitive tokens in error output", () => {
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			logger.logError(
				"ynab_test",
				"test",
				"Authentication failed with token=aaaaaaaaaa and Bearer bbbbbbbbbb",
			);

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("token=***"),
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Bearer ***"),
			);
			expect(consoleSpy).not.toHaveBeenCalledWith(
				expect.stringContaining("aaaaaaaaaa"),
			);
		});

		it("should output success logs at info level and errors at error level", () => {
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			logger.logSuccess("ynab_test", "test operation", 100);
			logger.logError("ynab_test", "test operation", "Test error", 50);

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"[INFO] ynab_test:test operation | SUCCESS | 100ms",
				),
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					'[ERROR] ynab_test:test operation | FAILED | 50ms | error:"Test error"',
				),
			);
		});

		it("should respect log level configuration and debug()", () => {
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const errorOnlyLogger = new RequestLogger({ logLevel: "error" });

			errorOnlyLogger.logSuccess("ynab_test", "test");
			errorOnlyLogger.debug("hidden debug");
			errorOnlyLogger.logError("ynab_test", "test", "Error");

			expect(consoleSpy).toHaveBeenCalledTimes(1);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[ERROR]"),
			);

			errorOnlyLogger.setConfig({ logLevel: resolveLogLevel("trace") });
			errorOnlyLogger.debug("visible debug");
			expect(consoleSpy).toHaveBeenCalledWith("[DEBUG] visible debug");
		});
	});
});
