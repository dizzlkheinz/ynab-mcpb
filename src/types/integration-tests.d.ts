type IntegrationTestTier = "core" | "domain" | "full";
type IntegrationTestDomain =
	| "budgets"
	| "accounts"
	| "transactions"
	| "categories"
	| "payees"
	| "months"
	| "delta"
	| "reconciliation"
	| "utility"
	| "security"
	| "server"
	| "workflows"
	| (string & {});

export interface IntegrationTestMeta {
	tier: IntegrationTestTier;
	domain: IntegrationTestDomain;
}

// Vitest 5 bundles its runner types, so TaskMeta is augmented on "vitest".
declare module "vitest" {
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type
	interface TaskMeta extends Partial<IntegrationTestMeta> {}

	interface TestOptions {
		meta?: IntegrationTestMeta;
	}
}
