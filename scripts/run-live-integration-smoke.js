#!/usr/bin/env node
/**
 * Runs a live YNAB suite against the real API:
 *   (default) smoke - small, read-only E2E smoke suite
 *   delta           - delta-backed tool tests; WRITES: creates one $1.00
 *                     transaction in the first budget and deletes it again
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

const SUITES = {
	smoke: ["--project", "e2e", "src/__tests__/smoke.e2e.test.ts"],
	delta: [
		"--project",
		"integration:domain",
		"src/tools/__tests__/accountTools.delta.integration.test.ts",
		"src/tools/__tests__/budgetTools.delta.integration.test.ts",
		"src/tools/__tests__/categoryTools.delta.integration.test.ts",
		"src/tools/__tests__/monthTools.delta.integration.test.ts",
		"src/tools/__tests__/payeeTools.delta.integration.test.ts",
		"src/tools/__tests__/deltaFetcher.scheduled.integration.test.ts",
		"src/tools/reconciliation/__tests__/reconciliation.delta.integration.test.ts",
	],
};
const [suiteArg, ...passthroughArgs] = process.argv.slice(2);
const suiteName = suiteArg && suiteArg in SUITES ? suiteArg : "smoke";
const extraArgs =
	suiteArg && suiteArg in SUITES ? passthroughArgs : process.argv.slice(2);
if (suiteName === "delta") {
	console.warn(
		"Live delta suite: creates and deletes one test transaction in your first budget.",
	);
}

const projectRoot = process.cwd();
const vitestBin = path.join(
	projectRoot,
	"node_modules",
	"vitest",
	"vitest.mjs",
);
const vitestArgs = ["run", ...SUITES[suiteName], ...extraArgs];

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
