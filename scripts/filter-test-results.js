#!/usr/bin/env node
/**

Reads test-results.json produced by the vitest run and exits non-zero when the
run was not successful, so `npm test` fails correctly.

*/

import fs from "node:fs";

try {
	const raw = fs.readFileSync("test-results.json", "utf-8");
	const results = JSON.parse(raw);
	if (!results.quickStats?.success) {
		console.warn(
			"Tests failed. See test-results/failed-tests.json for details.",
		);
		process.exit(1);
	}
	console.log(
		`Tests passed: ${results.quickStats.passed ?? "unknown count"}/${results.quickStats.total ?? "?"} tests.`,
	);
} catch (e) {
	console.warn("Could not read test results:", e.message);
	process.exit(1);
}
