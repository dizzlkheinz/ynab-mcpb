import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as ynab from "ynab";
import { createReadDeps } from "../../__tests__/readDeps.js";
import { getLiveTestGate, skipOnRateLimit } from "../../__tests__/testUtils.js";
import { CacheManager } from "../../server/cacheManager.js";
import { resetRuntimeConfig } from "../../server/config.js";
import { DeltaCache } from "../../server/deltaCache.js";
import { ServerKnowledgeStore } from "../../server/serverKnowledgeStore.js";
import { handleListBudgets } from "../budgetTools.js";
import { DeltaFetcher } from "../deltaFetcher.js";

const shouldSkip = !getLiveTestGate().enabled;
const hasToken = !!process.env["YNAB_ACCESS_TOKEN"];
const skipTests = shouldSkip || !hasToken;
const describeIntegration = skipTests ? describe.skip : describe;

describeIntegration("Delta-backed budget tool handler", () => {
	let ynabAPI: ynab.API;
	let deltaFetcher: DeltaFetcher;

	beforeAll(async () => {
		const accessToken = process.env["YNAB_ACCESS_TOKEN"]!;
		ynabAPI = new ynab.API(accessToken);
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

	it("serves cached budget summaries on the second invocation", {
		meta: { tier: "domain", domain: "delta" },
	}, async (ctx) => {
		await skipOnRateLimit(async () => {
			const params = { response_format: "json" as const };
			const firstCall = await handleListBudgets(
				ynabAPI,
				params,
				createReadDeps(ynabAPI, {
					...{
						deltaFetcher: deltaFetcher,
					},
				}),
			);
			const firstPayload = parseResponse(firstCall);

			// If response contains an error, throw it so skipOnRateLimit can catch it
			if (firstPayload.error) {
				throw new Error(JSON.stringify(firstPayload.error));
			}

			expect(firstPayload.cached).toBe(false);

			const secondCall = await handleListBudgets(
				ynabAPI,
				params,
				createReadDeps(ynabAPI, {
					...{
						deltaFetcher: deltaFetcher,
					},
				}),
			);
			const secondPayload = parseResponse(secondCall);

			// If response contains an error, throw it so skipOnRateLimit can catch it
			if (secondPayload.error) {
				throw new Error(JSON.stringify(secondPayload.error));
			}

			expectCacheHit(secondPayload);

			// Verify cached response contains the same budget data as initial fetch
			expect(secondPayload.budgets).toEqual(firstPayload.budgets);
		}, ctx);
	});
});
