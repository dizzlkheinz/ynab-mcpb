#!/usr/bin/env node
/**
 * Runs every integration tier with live YNAB access forcibly disabled.
 *
 * Supplying a real token in the parent environment must never turn this command
 * into a live test run. This makes the command safe for pull requests and local
 * development on machines that have a token in `.env`.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const projectRoot = process.cwd();
const vitestBin = path.join(
	projectRoot,
	"node_modules",
	"vitest",
	"vitest.mjs",
);
const passthroughArgs = process.argv.slice(2);
const vitestArgs = ["run", "--project", "integration:full", ...passthroughArgs];

const child = spawn(process.execPath, [vitestBin, ...vitestArgs], {
	stdio: "inherit",
	env: {
		...process.env,
		YNAB_ACCESS_TOKEN: "test-token-for-mocked-tests",
		SKIP_E2E_TESTS: "true",
		RUN_LIVE_YNAB_TESTS: "false",
		INTEGRATION_TEST_TIER: "full",
		INTEGRATION_TEST_DOMAINS: "",
	},
});

child.on("close", (code) => {
	process.exit(code ?? 1);
});
child.on("error", (error) => {
	console.error("Failed to start mocked integration tests:", error);
	process.exit(1);
});
