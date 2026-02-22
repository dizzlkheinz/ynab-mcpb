import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import * as ynab from "ynab";
import {
	isAuthError,
	isRateLimitError,
	skipOnRateLimit,
} from "../../../__tests__/testUtils.js";
import { CacheManager } from "../../../server/cacheManager.js";
import { DeltaCache } from "../../../server/deltaCache.js";
import { ServerKnowledgeStore } from "../../../server/serverKnowledgeStore.js";
import { DeltaFetcher } from "../../deltaFetcher.js";
import { handleReconcileAccount } from "../index.js";

const shouldSkip = ["true", "1", "yes", "y", "on"].includes(
	(process.env.SKIP_E2E_TESTS || "").toLowerCase().trim(),
);
const hasToken = !!process.env.YNAB_ACCESS_TOKEN;
const skipTests = shouldSkip || !hasToken;
const describeIntegration = skipTests ? describe.skip : describe;

describeIntegration("Reconciliation delta isolation", () => {
	let ynabAPI: ynab.API;
	let testBudgetId: string;
	let testAccountId: string;
	let deltaFetcher: DeltaFetcher;
	let previousNodeEnv: string | undefined;
	let setupRateLimited = false;
	const parseStructuredPayload = (result: CallToolResult) => {
		if (result.isError) {
			const errorContent = result.content?.find(
				(entry) => entry.type === "text",
			);
			throw new Error(
				errorContent && errorContent.type === "text"
					? errorContent.text
					: "Unexpected reconciliation error response",
			);
		}

		// Find the last text entry that contains valid JSON with an "audit" key
		const textEntries =
			result.content?.filter((entry) => entry.type === "text") ?? [];
		for (let i = textEntries.length - 1; i >= 0; i--) {
			const entry = textEntries[i];
			if (entry.type === "text") {
				try {
					const parsed = JSON.parse(entry.text);
					if (parsed && typeof parsed === "object") {
						// Check if audit is at top level (old format)
						if ("audit" in parsed) {
							return parsed;
						}
						// Check if audit is nested under structured (current format: { human, structured: { audit, ... } })
						const structured = (parsed as any).structured;
						if (
							structured &&
							typeof structured === "object" &&
							"audit" in structured
						) {
							return structured;
						}
					}
				} catch {
					// Not valid JSON, continue searching
				}
			}
		}
		throw new Error(
			'Expected structured reconciliation payload with "audit" key to be present',
		);
	};

	beforeAll(async () => {
		try {
			const accessToken = process.env.YNAB_ACCESS_TOKEN!;
			ynabAPI = new ynab.API(accessToken);
			const budgetsResponse = await ynabAPI.budgets.getBudgets();
			const budget = budgetsResponse.data.budgets[0];
			if (!budget) {
				throw new Error(
					"No budgets available for reconciliation integration tests.",
				);
			}
			testBudgetId = budget.id;

			const accountsResponse = await ynabAPI.accounts.getAccounts(testBudgetId);
			const account = accountsResponse.data.accounts.find(
				(acct) => !acct.closed,
			);
			if (!account) {
				throw new Error(
					"No open accounts available for reconciliation integration tests.",
				);
			}
			testAccountId = account.id;
		} catch (error) {
			if (isRateLimitError(error) || isAuthError(error)) {
				setupRateLimited = true;
				const reason = isAuthError(error)
					? "authentication failure"
					: "YNAB API rate limit";
				console.warn(
					`⏭️  Skipping reconciliation delta integration tests due to ${reason} during setup`,
				);
				return;
			}
			throw error;
		}
	});

	beforeEach(() => {
		previousNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "integration";
		const cacheManager = new CacheManager();
		const knowledgeStore = new ServerKnowledgeStore();
		const deltaCache = new DeltaCache(cacheManager, knowledgeStore);
		deltaFetcher = new DeltaFetcher(ynabAPI, deltaCache);
		process.env.YNAB_MCP_ENABLE_DELTA = "true";
	});

	afterEach(() => {
		process.env.YNAB_MCP_ENABLE_DELTA = undefined;
		if (previousNodeEnv === undefined) {
			process.env.NODE_ENV = undefined;
		} else {
			process.env.NODE_ENV = previousNodeEnv;
		}
		previousNodeEnv = undefined;
		vi.restoreAllMocks();
	});

	const withRateLimitSkip = async (
		ctx: { skip: () => void },
		testFn: () => Promise<void>,
	) => {
		if (setupRateLimited) {
			ctx.skip();
			return;
		}
		await skipOnRateLimit(testFn, ctx);
	};

	it(
		"uses full-fetch helpers and exposes audit metadata",
		{ meta: { tier: "domain", domain: "delta" } },
		async (ctx) => {
			await withRateLimitSkip(ctx, async () => {
				const csvData = [
					"Date,Amount,Description",
					"2024-01-01,10,Coffee",
				].join("\n");
				const params = {
					budget_id: testBudgetId,
					account_id: testAccountId,
					csv_data: csvData,
					statement_balance: 0,
					include_structured_data: true,
				};

				const accountsFullSpy = vi.spyOn(deltaFetcher, "fetchAccountsFull");
				const txFullSpy = vi.spyOn(
					deltaFetcher,
					"fetchTransactionsByAccountFull",
				);
				const txDeltaSpy = vi.spyOn(deltaFetcher, "fetchTransactionsByAccount");

				const result = await handleReconcileAccount(
					ynabAPI,
					deltaFetcher,
					params,
				);

				expect(accountsFullSpy).toHaveBeenCalledWith(testBudgetId);
				expect(txFullSpy).toHaveBeenCalledWith(
					testBudgetId,
					testAccountId,
					expect.any(String),
				);
				expect(txDeltaSpy).not.toHaveBeenCalled();

				const structuredPayload = parseStructuredPayload(result);
				expect(structuredPayload.audit).toMatchObject({
					data_freshness: "guaranteed_fresh",
					data_source: "full_api_fetch_no_delta",
				});
				expect(structuredPayload.audit).toHaveProperty("server_knowledge");
				expect(structuredPayload.audit).toHaveProperty("transactions_count");
			});
		},
	);

	it(
		"can opt into delta-backed fetches when force_full_refresh is false",
		{ meta: { tier: "domain", domain: "delta" } },
		async (ctx) => {
			await withRateLimitSkip(ctx, async () => {
				const csvData = [
					"Date,Amount,Description",
					"2024-01-01,10,Coffee",
				].join("\n");
				const params = {
					budget_id: testBudgetId,
					account_id: testAccountId,
					csv_data: csvData,
					statement_balance: 0,
					include_structured_data: true,
					force_full_refresh: false,
				};

				const accountsFullSpy = vi.spyOn(deltaFetcher, "fetchAccountsFull");
				const txFullSpy = vi.spyOn(
					deltaFetcher,
					"fetchTransactionsByAccountFull",
				);
				const accountsDeltaSpy = vi.spyOn(deltaFetcher, "fetchAccounts");
				const txDeltaSpy = vi.spyOn(deltaFetcher, "fetchTransactionsByAccount");

				const result = await handleReconcileAccount(
					ynabAPI,
					deltaFetcher,
					params,
				);

				expect(accountsFullSpy).not.toHaveBeenCalled();
				expect(txFullSpy).not.toHaveBeenCalled();
				expect(accountsDeltaSpy).toHaveBeenCalledWith(testBudgetId);
				expect(txDeltaSpy).toHaveBeenCalledWith(
					testBudgetId,
					testAccountId,
					expect.any(String),
				);

				const structuredPayload = parseStructuredPayload(result);
				expect(structuredPayload.audit).toMatchObject({
					data_source: expect.stringMatching(/^delta_fetch_/),
				});
				expect(structuredPayload.audit.cache_status).toMatchObject({
					accounts_cached: expect.any(Boolean),
					transactions_cached: expect.any(Boolean),
					delta_merge_applied: expect.any(Boolean),
				});
			});
		},
	);
});
