/**
 * Test setup and configuration
 */

// Load environment variables from .env for integration tests
import "dotenv/config";
import { beforeEach } from "vitest";
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

beforeEach(() => {
	process.env["NODE_ENV"] = "test";
});
