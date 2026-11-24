/**
 * Test setup and configuration
 */

import { setAcceptFixtureBudgetIds } from "../server/budgetResolver.js";

process.env["YNAB_ACCESS_TOKEN"] = "test-token-for-mocked-tests";

// Accept fixture budget IDs such as "test-budget-1" in tests
setAcceptFixtureBudgetIds(true);
if (!process.env["LOG_LEVEL"]) {
	process.env["LOG_LEVEL"] = "error";
}

// Disable console output for cleaner test output unless VERBOSE_TESTS is set
if (!process.env["VERBOSE_TESTS"]) {
	const originalConsoleError = console.error;

	console.error = (...args: unknown[]) => {
		const firstArg = args[0];
		const isString = typeof firstArg === "string";
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

	console.warn = () => {};
	console.log = () => {};
	console.info = () => {};
	console.debug = () => {};
}
