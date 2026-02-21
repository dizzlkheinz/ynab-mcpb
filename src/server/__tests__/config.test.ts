import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("Config Module", () => {
	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
		if (!process.env.YNAB_ACCESS_TOKEN) {
			process.env.YNAB_ACCESS_TOKEN = "test-token-placeholder";
		}
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("reloads environment variables on each loadConfig call", async () => {
		const { loadConfig } = await import("../config");
		process.env.YNAB_ACCESS_TOKEN = "test-token-123";
		expect(loadConfig().YNAB_ACCESS_TOKEN).toBe("test-token-123");

		process.env.YNAB_ACCESS_TOKEN = "updated-token-456";
		expect(loadConfig().YNAB_ACCESS_TOKEN).toBe("updated-token-456");
	});

	it("throws a detailed error if YNAB_ACCESS_TOKEN is missing", async () => {
		const { loadConfig } = await import("../config");
		const env = { ...process.env };
		env.YNAB_ACCESS_TOKEN = undefined;

		expect.assertions(2);
		try {
			loadConfig(env);
		} catch (error) {
			expect((error as { name?: string }).name).toBe("ValidationError");
			expect((error as Error).message).toMatch(/YNAB_ACCESS_TOKEN/i);
		}
	});

	it("parses LOG_LEVEL and defaults to info", async () => {
		const { loadConfig } = await import("../config");
		const envWithLog = {
			...process.env,
			YNAB_ACCESS_TOKEN: "token",
			LOG_LEVEL: "debug",
		};
		expect(loadConfig(envWithLog).LOG_LEVEL).toBe("debug");

		const envWithoutLog = { ...envWithLog };
		envWithoutLog.LOG_LEVEL = undefined; // Ensure LOG_LEVEL is not set
		expect(loadConfig(envWithoutLog).LOG_LEVEL).toBe("info");
	});
});
