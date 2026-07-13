#!/usr/bin/env node
/**
 * Runs the small, read-only YNAB E2E smoke suite.
 *
 * Live access requires both an explicit opt-in and a real token. Keeping this
 * guard in the command prevents an ordinary integration run from consuming API
 * quota merely because a token is present in the environment.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";

const enabledValues = new Set(["true", "1", "yes", "on"]);
const liveOptIn = enabledValues.has(
	(process.env.RUN_LIVE_YNAB_TESTS ?? "").trim().toLowerCase(),
);
const accessToken = process.env.YNAB_ACCESS_TOKEN?.trim();
const invalidTokens = new Set([
	"",
	"undefined",
	"null",
	"your_ynab_personal_access_token_here",
	"test-token-for-mocked-tests",
]);
const hasRealToken =
	typeof accessToken === "string" &&
	!invalidTokens.has(accessToken.toLowerCase());

if (!liveOptIn) {
	console.error("Live YNAB smoke tests require RUN_LIVE_YNAB_TESTS=true.");
	process.exit(1);
}

if (!hasRealToken) {
	console.error("Live YNAB smoke tests require a real YNAB_ACCESS_TOKEN.");
	process.exit(1);
}

const projectRoot = process.cwd();
const vitestBin = path.join(
	projectRoot,
	"node_modules",
	"vitest",
	"vitest.mjs",
);
const vitestArgs = [
	"run",
	"--project",
	"e2e",
	"src/__tests__/smoke.e2e.test.ts",
	...process.argv.slice(2),
];

const child = spawn(process.execPath, [vitestBin, ...vitestArgs], {
	stdio: "inherit",
	env: {
		...process.env,
		SKIP_E2E_TESTS: "false",
		RUN_LIVE_YNAB_TESTS: "true",
	},
});

child.on("close", (code) => {
	process.exit(code ?? 1);
});
child.on("error", (error) => {
	console.error("Failed to start live integration smoke tests:", error);
	process.exit(1);
});
