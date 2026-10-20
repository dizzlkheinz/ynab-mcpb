/**
 * Unit tests for deltaSupport.ts - dependency resolution
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as ynab from "ynab";
import { cacheManager } from "../../server/cacheManager.js";
import { DeltaCache } from "../../server/deltaCache.js";
import { ServerKnowledgeStore } from "../../server/serverKnowledgeStore.js";
import { DeltaFetcher } from "../deltaFetcher.js";
import {
	resolveDeltaFetcherDeps,
	resolveDeltaWriteDeps,
	setSharedDeltaSupport,
} from "../deltaSupport.js";

describe("deltaSupport dependency resolution", () => {
	let ynabAPI: ynab.API;
	let deltaFetcher: DeltaFetcher;
	let deltaCache: DeltaCache;
	let knowledgeStore: ServerKnowledgeStore;

	beforeEach(() => {
		setSharedDeltaSupport();
		ynabAPI = new ynab.API("test-token");
		knowledgeStore = new ServerKnowledgeStore();
		deltaCache = new DeltaCache(cacheManager, knowledgeStore);
		deltaFetcher = new DeltaFetcher(ynabAPI, deltaCache);
	});

	describe("resolveDeltaFetcherDeps", () => {
		it("returns the provided fetcher", () => {
			expect(resolveDeltaFetcherDeps(ynabAPI, { deltaFetcher })).toBe(
				deltaFetcher,
			);
		});

		it("creates a shared fetcher when no deps are provided", () => {
			const fetcher = resolveDeltaFetcherDeps(ynabAPI);
			expect(fetcher).toBeInstanceOf(DeltaFetcher);
			// Subsequent resolutions reuse the shared instance
			expect(resolveDeltaFetcherDeps(ynabAPI)).toBe(fetcher);
		});
	});

	describe("resolveDeltaWriteDeps", () => {
		it("returns provided cache and knowledge store", () => {
			const result = resolveDeltaWriteDeps({ deltaCache, knowledgeStore });
			expect(result.deltaCache).toBe(deltaCache);
			expect(result.knowledgeStore).toBe(knowledgeStore);
		});

		it("creates shared instances when no deps are provided", () => {
			const first = resolveDeltaWriteDeps();
			expect(first.deltaCache).toBeInstanceOf(DeltaCache);
			expect(first.knowledgeStore).toBeInstanceOf(ServerKnowledgeStore);
			// Subsequent resolutions reuse the shared instances
			const second = resolveDeltaWriteDeps();
			expect(second.deltaCache).toBe(first.deltaCache);
			expect(second.knowledgeStore).toBe(first.knowledgeStore);
		});

		it("reuses the shared context on subsequent calls", () => {
			const first = resolveDeltaWriteDeps();
			const result = resolveDeltaWriteDeps({ knowledgeStore });
			// Existing shared instances win over newly provided partial deps
			expect(result.knowledgeStore).toBe(first.knowledgeStore);
			expect(result.deltaCache).toBe(first.deltaCache);
		});
	});
});
