import { defineConfig } from "vitest/config";

const offlineEnvironment = {
	YNAB_ACCESS_TOKEN: "test-token-for-mocked-tests",
	RUN_LIVE_YNAB_TESTS: "false",
	SKIP_E2E_TESTS: "true",
};

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		setupFiles: ["src/__tests__/setup.ts"],
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.{test,spec}.ts"],
					exclude: ["src/**/*.integration.test.ts", "src/**/*.e2e.test.ts"],
					env: offlineEnvironment,
				},
			},
			{
				test: {
					name: "integration",
					include: ["src/**/*.integration.test.ts"],
					env: offlineEnvironment,
					testTimeout: 120000,
					hookTimeout: 30000,
					fileParallelism: false,
					maxWorkers: 1,
				},
			},
			{
				test: {
					name: "live",
					include: ["src/**/*.e2e.test.ts", "src/**/*.integration.test.ts"],
					testTimeout: 60000,
					hookTimeout: 30000,
					fileParallelism: false,
					maxWorkers: 1,
				},
			},
		],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.{test,spec}.ts",
				"src/**/*.d.ts",
				"src/index.ts", // Entry point excluded from coverage
				"src/__tests__/**/*.ts", // Test utilities excluded from coverage
			],
			reporter: ["text", "json", "html"],
			reportsDirectory: "./coverage",
			thresholds: {
				branches: 80,
				functions: 80,
				lines: 80,
				statements: 80,
			},
		},
		reporters: [process.env.VERBOSE_TESTS ? "verbose" : "dot"],
	},
	resolve: {
		alias: {
			"@": "/src",
		},
	},
});
