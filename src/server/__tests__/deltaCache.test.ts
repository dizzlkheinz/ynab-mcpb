import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheManager } from "../cacheManager.js";
import { resetRuntimeConfig } from "../config.js";
import { DeltaCache, type Logger, type MergeOptions } from "../deltaCache.js";
import { mergeFlatEntities } from "../deltaCache.merge.js";
import { ServerKnowledgeStore } from "../serverKnowledgeStore.js";

interface Entity {
	id: string;
	name?: string;
	deleted?: boolean;
}
interface Response {
	data: Entity[];
	serverKnowledge: number;
}
const key = "accounts:list:budget-1";
const budget = "budget-1";
const ttl = 100;
let cache: CacheManager;
let knowledge: ServerKnowledgeStore;
let delta: DeltaCache;
let logger: Logger;

beforeEach(() => {
	vi.useFakeTimers({ now: 1000 });
	vi.stubEnv("YNAB_MCP_ENABLE_DELTA", "true");
	resetRuntimeConfig();
	cache = new CacheManager();
	knowledge = new ServerKnowledgeStore();
	logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	delta = new DeltaCache(cache, knowledge, logger);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	resetRuntimeConfig();
});

async function seed(cacheKey = key, data: Entity[] = [{ id: "original" }]) {
	return delta.fetchWithDelta<Entity>(
		cacheKey,
		budget,
		async () => ({ data, serverKnowledge: 1000 }),
		mergeFlatEntities,
		{ ttl },
	);
}

const expire = () => vi.advanceTimersByTime(ttl + 1);

describe("DeltaCache with the real cache lifecycle", () => {
	it("filters deleted full-response records, revalidates fresh reads with a delta and reports knowledge", async () => {
		const fetcher = vi.fn<() => Promise<Response>>().mockResolvedValue({
			data: [{ id: "kept" }, { id: "deleted", deleted: true }],
			serverKnowledge: 10,
		});
		const first = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl: 50 },
		);
		expect(first).toEqual({
			data: [{ id: "kept" }],
			serverKnowledge: 10,
			usedDelta: false,
			wasCached: false,
		});
		vi.advanceTimersByTime(49);
		const cached = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl: 50 },
		);
		// Delta mode asks YNAB for changes even within the TTL; unchanged
		// knowledge keeps the cached snapshot.
		expect(cached).toMatchObject({
			data: first.data,
			wasCached: true,
			usedDelta: false,
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher).toHaveBeenLastCalledWith(10);
		expect(knowledge.get(key)).toBe(10);
		vi.advanceTimersByTime(51);
		const expired = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{
				ttl: 50,
			},
		);
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(expired.wasCached).toBe(false);
	});

	it("shows changes made outside the server on the next read within the TTL", async () => {
		await seed();
		const fetcher = vi.fn().mockResolvedValue({
			data: [{ id: "added-in-ynab-app" }],
			serverKnowledge: 1001,
		});
		const result = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl },
		);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(1000);
		expect(result).toMatchObject({
			data: [{ id: "original" }, { id: "added-in-ynab-app" }],
			wasCached: true,
			usedDelta: true,
			serverKnowledge: 1001,
		});
		expect(knowledge.get(key)).toBe(1001);
	});

	it("serves fresh reads from cache without a request when delta is disabled", async () => {
		vi.stubEnv("YNAB_MCP_ENABLE_DELTA", "false");
		resetRuntimeConfig();
		await seed();
		const fetcher = vi.fn();
		const result = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl },
		);
		expect(fetcher).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			data: [{ id: "original" }],
			wasCached: true,
		});
	});

	it("uses an expired snapshot's knowledge and merges updates, additions and deletions", async () => {
		await seed(key, [
			{ id: "changed", name: "before" },
			{ id: "removed" },
			{ id: "unchanged" },
		]);
		knowledge.update(key, 9000); // A detached knowledge value must not replace the snapshot's version.
		expire();
		const fetcher = vi.fn().mockResolvedValue({
			data: [
				{ id: "changed", name: "after" },
				{ id: "removed", deleted: true },
				{ id: "added" },
			],
			serverKnowledge: 1010,
		});
		const result = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl },
		);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(1000);
		expect(result.data).toEqual([
			{ id: "changed", name: "after" },
			{ id: "unchanged" },
			{ id: "added" },
		]);
		expect(result).toMatchObject({
			wasCached: false,
			usedDelta: true,
			serverKnowledge: 1010,
		});
		expect(knowledge.get(key)).toBe(1010);
		expect(delta.getStats()).toMatchObject({
			deltaHits: 1,
			deltaMisses: 1,
			mergeOperations: 1,
		});
	});

	it("keeps the snapshot without merging when knowledge is unchanged", async () => {
		await seed();
		expire();
		const merger = vi.fn(mergeFlatEntities<Entity>);
		const result = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			async () => ({ data: [], serverKnowledge: 1000 }),
			merger,
			{ ttl },
		);
		expect(result).toMatchObject({
			data: [{ id: "original" }],
			usedDelta: false,
			wasCached: false,
		});
		expect(merger).not.toHaveBeenCalled();
		expect(delta.getStats()).toMatchObject({
			deltaHits: 1,
			mergeOperations: 0,
		});
	});

	it("requests a full response when knowledge survives without its snapshot", async () => {
		knowledge.update(key, 1000);
		const fetcher = vi
			.fn()
			.mockResolvedValue({ data: [{ id: "complete" }], serverKnowledge: 1010 });
		const result = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl },
		);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(undefined);
		expect(result).toMatchObject({
			data: [{ id: "complete" }],
			usedDelta: false,
		});
	});

	it("retains normal TTL caching while the delta feature is disabled", async () => {
		vi.stubEnv("YNAB_MCP_ENABLE_DELTA", "false");
		resetRuntimeConfig();
		await seed();
		const fetcher = vi.fn().mockResolvedValue({
			data: [{ id: "replacement" }],
			serverKnowledge: 1010,
		});
		expect(
			(
				await delta.fetchWithDelta<Entity>(
					key,
					budget,
					fetcher,
					mergeFlatEntities,
					{ ttl },
				)
			).wasCached,
		).toBe(true);
		expect(fetcher).not.toHaveBeenCalled();
		expire();
		const refreshed = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl },
		);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(undefined);
		expect(refreshed.data).toEqual([{ id: "replacement" }]);
		expect(refreshed.usedDelta).toBe(false);
	});

	it("uses fresh data but requests a full response on the next forced refresh", async () => {
		await seed();
		const fetcher = vi.fn().mockResolvedValue({
			data: [{ id: "replacement" }],
			serverKnowledge: 1010,
		});
		const options = { ttl, forceFullRefresh: true };
		await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		expect(fetcher).not.toHaveBeenCalled();
		expire();
		const result = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(undefined);
		expect(result.data).toEqual([{ id: "replacement" }]);
	});

	it("supports preservation of deleted records during merging", async () => {
		await seed();
		expire();
		const result = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			async () => ({
				data: [{ id: "original", deleted: true }],
				serverKnowledge: 1001,
			}),
			mergeFlatEntities,
			{ ttl, mergeOptions: { preserveDeleted: true } },
		);
		expect(result.data).toEqual([{ id: "original", deleted: true }]);
	});

	it("passes custom equality options to caller-supplied mergers", async () => {
		await seed(key, [{ id: "old", name: "same" }]);
		expire();
		const equalityFn = (a: unknown, b: unknown) =>
			(a as Entity).name === (b as Entity).name;
		const merge = (
			previous: Entity[],
			updates: Entity[],
			options?: MergeOptions,
		) => [
			...previous.filter(
				(item) =>
					!updates.some((update) => options?.equalityFn?.(item, update)),
			),
			...updates,
		];
		const result = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			async () => ({
				data: [{ id: "new", name: "same" }],
				serverKnowledge: 1001,
			}),
			merge,
			{ ttl, mergeOptions: { equalityFn } },
		);
		expect(result.data).toEqual([{ id: "new", name: "same" }]);
	});

	it.each([1101, 999])(
		"falls back to a full response for incompatible knowledge %s",
		async (version) => {
			await seed();
			expire();
			const fetcher = vi
				.fn()
				.mockResolvedValueOnce({
					data: [{ id: "unsafe-delta" }],
					serverKnowledge: version,
				})
				.mockResolvedValueOnce({
					data: [{ id: "complete" }],
					serverKnowledge: version,
				});
			const merger = vi.fn(mergeFlatEntities<Entity>);
			const result = await delta.fetchWithDelta<Entity>(
				key,
				budget,
				fetcher,
				merger,
				{
					ttl,
				},
			);
			expect(fetcher.mock.calls).toEqual([[1000], [undefined]]);
			expect(result).toMatchObject({
				data: [{ id: "complete" }],
				usedDelta: false,
			});
			expect(merger).not.toHaveBeenCalled();
			expect(logger.warn).toHaveBeenCalledWith(
				"delta-cache.knowledge-gap",
				expect.objectContaining({ cacheKey: key, budgetId: budget }),
			);
			expect(delta.getStats()).toMatchObject({
				knowledgeGapEvents: 1,
				deltaMisses: 2,
				deltaHits: 0,
			});
		},
	);

	it("merges a knowledge change at the supported gap boundary", async () => {
		await seed();
		expire();
		const fetcher = vi
			.fn()
			.mockResolvedValue({ data: [{ id: "new" }], serverKnowledge: 1100 });
		const result = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl },
		);
		expect(result.usedDelta).toBe(true);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("propagates fetch failures without publishing cache or knowledge, then permits retry", async () => {
		const error = new Error("offline");
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(error)
			.mockResolvedValueOnce({
				data: [{ id: "recovered" }],
				serverKnowledge: 1,
			});
		await expect(
			delta.fetchWithDelta<Entity>(key, budget, fetcher, mergeFlatEntities, {
				ttl,
			}),
		).rejects.toBe(error);
		expect(cache.peek(key)).toBeUndefined();
		expect(knowledge.get(key)).toBeUndefined();
		expect(
			(
				await delta.fetchWithDelta<Entity>(
					key,
					budget,
					fetcher,
					mergeFlatEntities,
					{ ttl },
				)
			).data,
		).toEqual([{ id: "recovered" }]);
	});

	it("does not publish a failed merge or advance its knowledge", async () => {
		await seed();
		expire();
		const error = new Error("cannot merge");
		await expect(
			delta.fetchWithDelta<Entity>(
				key,
				budget,
				async () => ({ data: [{ id: "new" }], serverKnowledge: 1001 }),
				() => {
					throw error;
				},
				{ ttl },
			),
		).rejects.toBe(error);
		expect(cache.peek(key)).toBeUndefined();
		expect(knowledge.get(key)).toBe(1000);
	});

	it.each([Number.NaN, Infinity, undefined])(
		"rejects a non-finite TTL (%s) before calling the API",
		async (value) => {
			const fetcher = vi.fn();
			await expect(
				delta.fetchWithDelta<Entity>(key, budget, fetcher, mergeFlatEntities, {
					ttl: value as number,
				}),
			).rejects.toThrow("finite ttl");
			expect(fetcher).not.toHaveBeenCalled();
		},
	);

	it("deduplicates concurrent cache misses", async () => {
		let finish!: (response: Response) => void;
		const pending = new Promise<Response>((resolve) => {
			finish = resolve;
		});
		const fetcher = vi.fn(() => pending);
		const first = delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl },
		);
		const second = delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			{ ttl },
		);
		finish({ data: [{ id: "shared" }], serverKnowledge: 1 });
		expect((await first).data).toEqual((await second).data);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("does not resurrect an invalidated in-flight snapshot or overwrite a newer load", async () => {
		let finish!: (response: Response) => void;
		const pending = new Promise<Response>((resolve) => {
			finish = resolve;
		});
		const first = delta.fetchWithDelta<Entity>(
			key,
			budget,
			() => pending,
			mergeFlatEntities,
			{ ttl },
		);
		delta.forceFullRefresh(budget);
		await delta.fetchWithDelta<Entity>(
			key,
			budget,
			async () => ({ data: [{ id: "new" }], serverKnowledge: 2 }),
			mergeFlatEntities,
			{ ttl },
		);
		finish({ data: [{ id: "old" }], serverKnowledge: 1 });
		expect((await first).data).toEqual([{ id: "old" }]);
		const nextFetcher = vi
			.fn()
			.mockResolvedValue({ data: [], serverKnowledge: 2 });
		const next = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			nextFetcher,
			mergeFlatEntities,
			{ ttl },
		);
		// The next delta builds on the newer load, never the invalidated one.
		expect(nextFetcher).toHaveBeenCalledExactlyOnceWith(2);
		expect(next.data).toEqual([{ id: "new" }]);
		expect(knowledge.get(key)).toBe(2);
	});

	describe("invalidation scope", () => {
		const sibling = "transactions:list:budget-1";
		const unrelated = "accounts:list:budget-2";
		beforeEach(async () => {
			await seed();
			await seed(sibling);
			await seed(unrelated);
		});

		it("invalidates only the requested resource while retaining its diagnostic knowledge", () => {
			delta.invalidate(budget, "accounts");
			expect(cache.peek(key)).toBeUndefined();
			expect(cache.peek(sibling)).toBeDefined();
			expect(cache.peek(unrelated)).toBeDefined();
			expect(knowledge.get(key)).toBe(1000);
		});
		it("ignores empty budget invalidation", () => {
			delta.invalidate("");
			expect(cache.getKeys()).toHaveLength(3);
		});
		it("fully resets one resource without affecting the rest", () => {
			delta.forceFullRefresh(budget, "accounts");
			expect(cache.peek(key)).toBeUndefined();
			expect(knowledge.get(key)).toBeUndefined();
			expect(cache.peek(sibling)).toBeDefined();
			expect(knowledge.get(sibling)).toBe(1000);
		});
		it("fully resets one budget without affecting another", () => {
			delta.forceFullRefresh(budget);
			expect(cache.getKeys()).toEqual([unrelated]);
			expect(knowledge.getStats().entries).toEqual({ [unrelated]: 1000 });
		});
		it("supports a global full refresh", () => {
			delta.forceFullRefresh();
			expect(cache.getKeys()).toEqual([]);
			expect(knowledge.getStats().entryCount).toBe(0);
		});
	});
});
