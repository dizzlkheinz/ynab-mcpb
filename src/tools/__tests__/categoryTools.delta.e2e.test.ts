import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as ynab from "ynab";
import { createReadDeps } from "../../__tests__/readDeps.js";
import { getLiveTestGate } from "../../__tests__/testUtils.js";
import { CacheManager } from "../../server/cacheManager.js";
import { resetRuntimeConfig } from "../../server/config.js";
import { DeltaCache } from "../../server/deltaCache.js";
import { ServerKnowledgeStore } from "../../server/serverKnowledgeStore.js";
import { listBudgetsCompat } from "../../utils/ynabApiCompat.js";
import { handleListCategories } from "../categoryTools.js";
import { DeltaFetcher } from "../deltaFetcher.js";

const shouldSkip = !getLiveTestGate().enabled;
const hasToken = !!process.env["YNAB_ACCESS_TOKEN"];
const skipTests = shouldSkip || !hasToken;
const describeIntegration = skipTests ? describe.skip : describe;

describeIntegration("Delta-backed category tool handler", () => {
	let ynabAPI: ynab.API;
	let testBudgetId: string;
	let deltaFetcher: DeltaFetcher;

	beforeAll(async () => {
		const accessToken = process.env["YNAB_ACCESS_TOKEN"]!;
		ynabAPI = new ynab.API(accessToken);
		const budgetsResponse = await listBudgetsCompat(ynabAPI);
		const budget = budgetsResponse.budgets[0];
		if (!budget) {
			throw new Error("No budgets available for delta integration tests.");
		}
		testBudgetId = budget.id;
	});

	beforeEach(() => {
		const cacheManager = new CacheManager();
		const knowledgeStore = new ServerKnowledgeStore();
		const deltaCache = new DeltaCache(cacheManager, knowledgeStore);
		deltaFetcher = new DeltaFetcher(ynabAPI, deltaCache);
		resetRuntimeConfig();
	});

	afterEach(() => {
		resetRuntimeConfig();
	});

	const parseResponse = (result: CallToolResult) => {
		const content = result.content?.[0];
		if (content?.type !== "text") {
			throw new Error("Unexpected tool response format");
		}
		return JSON.parse(content.text);
	};
	const expectCacheHit = (payload: { cached: boolean; cache_info: string }) => {
		expect(payload.cached).toBe(true);
		expect(payload.cache_info).toMatch(/cache/i);
	};

	it("serves cached category results on the second invocation", {
		meta: { tier: "domain", domain: "delta" },
	}, async () => {
		const params = {
			budget_id: testBudgetId,
			response_format: "json" as const,
		};
		const firstCall = await handleListCategories(
			ynabAPI,
			params,
			createReadDeps(ynabAPI, {
				...{
					deltaFetcher: deltaFetcher,
				},
			}),
		);
		const firstPayload = parseResponse(firstCall);
		expect(firstPayload.cached).toBe(false);

		const secondCall = await handleListCategories(
			ynabAPI,
			params,
			createReadDeps(ynabAPI, {
				...{
					deltaFetcher,
				},
			}),
		);
		const secondPayload = parseResponse(secondCall);
		expectCacheHit(secondPayload);
	});
});
