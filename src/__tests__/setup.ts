/**
 * Test setup and configuration
 */

// Load environment variables from .env for integration tests
import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { cacheManager } from "../server/cacheManager.js";
import {
	getLiveTestGate,
	MOCK_TEST_ACCESS_TOKEN,
	normalizeAccessToken,
} from "./testUtils.js";

// A stored token never enables external tests by itself. Unless all live-test
// requirements are satisfied, hide the real token from the test process so a
// misclassified test cannot accidentally contact YNAB.
const liveTestGate = getLiveTestGate();
if (liveTestGate.enabled) {
	process.env["YNAB_ACCESS_TOKEN"] = normalizeAccessToken(
		process.env["YNAB_ACCESS_TOKEN"],
	);
	process.env["SKIP_E2E_TESTS"] = "false";
} else {
	process.env["YNAB_ACCESS_TOKEN"] = MOCK_TEST_ACCESS_TOKEN;
	process.env["SKIP_E2E_TESTS"] = "true";
}

// Set test environment variables immediately
process.env["NODE_ENV"] = "test";
if (!process.env["LOG_LEVEL"]) {
	process.env["LOG_LEVEL"] = "error";
}

// Disable console output for cleaner test output unless VERBOSE_TESTS is set
if (!process.env["VERBOSE_TESTS"]) {
	const originalConsoleError = console.error;

	console.error = (...args: any[]) => {
		const firstArg = args[0];
		const isString = typeof firstArg === "string";
		// Only show errors that are part of test assertions, actual errors, or explicitly marked [ERROR]
		if (
			(isString &&
				(firstArg.includes("❌") ||
					firstArg.includes("Test") ||
					firstArg.includes("[ERROR]"))) ||
			firstArg instanceof Error
		) {
			originalConsoleError(...args);
		}
	};

	console.warn = () => {
		// Suppress warnings by default
	};

	console.log = () => {
		// Suppress logs by default
	};

	console.info = () => {
		// Suppress info logs by default
	};

	console.debug = () => {
		// Suppress debug logs by default
	};
}

type TierFilter = "core" | "domain" | "full";
interface TestMeta {
	tier?: TierFilter;
	domain?: string;
}

const parseFilterList = (value: string | undefined) =>
	value
		?.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean) ?? [];

const tierFilters = parseFilterList(
	process.env["INTEGRATION_TEST_TIER"] ?? "full",
) as TierFilter[];
const domainFilters = parseFilterList(process.env["INTEGRATION_TEST_DOMAINS"]);

const shouldRunTier = (tier?: string): boolean => {
	if (!tier) return true;
	if (tierFilters.length === 0 || tierFilters.includes("full")) {
		return true;
	}
	return tierFilters.includes(tier.toLowerCase() as TierFilter);
};

const shouldRunDomain = (domain?: string): boolean => {
	if (!domain || domainFilters.length === 0) {
		return true;
	}
	return domainFilters.includes(domain.toLowerCase());
};

/**
 * Global test setup
 */
beforeAll(async () => {
	// Set default test token if not provided
	if (!process.env["YNAB_ACCESS_TOKEN"]) {
		process.env["YNAB_ACCESS_TOKEN"] = MOCK_TEST_ACCESS_TOKEN;
	}

	if (process.env["VERBOSE_TESTS"]) {
		console.warn("🧪 Test environment initialized");
	}
});

/**
 * Global test cleanup
 */
afterAll(async () => {
	// Clean up any global resources
	console.warn("🧹 Test environment cleaned up");
});

/**
 * Per-test setup
 */
beforeEach(async () => {
	// Reset environment for each test
	process.env["NODE_ENV"] = "test";

	// Clear cache state between tests to prevent interference
	cacheManager.clear();

	// Clear any cached modules that might interfere (only if they exist)
	try {
		const modulePath = require.resolve("../server/YNABMCPServer.js");
		if (require.cache[modulePath]) {
			require.cache[modulePath] = undefined;
		}
	} catch {
		// Module doesn't exist yet, which is fine
	}
});

beforeEach((ctx) => {
	const meta = ctx.task.meta as TestMeta;

	if (!shouldRunTier(meta?.tier)) {
		ctx.skip();
		return;
	}

	if (!shouldRunDomain(meta?.domain)) {
		ctx.skip();
	}
});

/**
 * Per-test cleanup
 */
afterEach(async () => {
	// Clean up any test-specific resources
	// This is handled by individual test files
});
