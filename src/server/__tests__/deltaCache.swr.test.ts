import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheManager } from "../cacheManager.js";
import { resetRuntimeConfig } from "../config.js";
import { DeltaCache } from "../deltaCache.js";
import { mergeFlatEntities } from "../deltaCache.merge.js";
import { ServerKnowledgeStore } from "../serverKnowledgeStore.js";

interface Entity {
	id: string;
	deleted?: boolean;
}
interface Response {
	data: Entity[];
	serverKnowledge: number;
}
const key = "accounts:list:budget-1";
const budget = "budget-1";
const options = { ttl: 100, staleWhileRevalidate: 200 };
let cache: CacheManager;
let knowledge: ServerKnowledgeStore;
let delta: DeltaCache;

beforeEach(() => {
	vi.useFakeTimers({ now: 1000 });
	vi.stubEnv("YNAB_MCP_ENABLE_DELTA", "true");
	resetRuntimeConfig();
	cache = new CacheManager();
	knowledge = new ServerKnowledgeStore();
	delta = new DeltaCache(cache, knowledge, {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	resetRuntimeConfig();
});

async function seed(stale = true) {
	await delta.fetchWithDelta<Entity>(
		key,
		budget,
		async () => ({ data: [{ id: "original" }], serverKnowledge: 1000 }),
		mergeFlatEntities,
		stale ? options : { ttl: options.ttl },
	);
}

function deferred() {
	let resolve!: (value: Response) => void;
	const promise = new Promise<Response>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function disableDelta() {
	vi.stubEnv("YNAB_MCP_ENABLE_DELTA", "false");
	resetRuntimeConfig();
}

describe("DeltaCache stale-while-revalidate with real caching", () => {
	it("serves stale data and performs one background refresh when delta is disabled", async () => {
		disableDelta();
		await seed();
		vi.advanceTimersByTime(101);
		const refresh = deferred();
		const fetcher = vi.fn(() => refresh.promise);
		const stale = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		const concurrent = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		expect(stale).toMatchObject({
			data: [{ id: "original" }],
			wasCached: true,
			usedDelta: false,
		});
		expect(concurrent.data).toEqual(stale.data);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(undefined);
		refresh.resolve({ data: [{ id: "updated" }], serverKnowledge: 1001 });
		await vi.advanceTimersByTimeAsync(0);
		const fresh = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		expect(fresh.data).toEqual([{ id: "updated" }]);
		expect(fresh).toMatchObject({
			wasCached: true,
			serverKnowledge: 1001,
			usedDelta: false,
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(knowledge.get(key)).toBe(1001);
	});

	it("in delta mode, a stale read waits for the delta instead of serving stale data", async () => {
		await seed();
		vi.advanceTimersByTime(101);
		const refresh = deferred();
		const fetcher = vi.fn(() => refresh.promise);
		let settled = false;
		const result = delta
			.fetchWithDelta<Entity>(key, budget, fetcher, mergeFlatEntities, options)
			.then((value) => {
				settled = true;
				return value;
			});
		const concurrent = delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(1000);
		refresh.resolve({ data: [{ id: "updated" }], serverKnowledge: 1001 });
		expect(await result).toMatchObject({
			data: [{ id: "original" }, { id: "updated" }],
			wasCached: true,
			usedDelta: true,
			serverKnowledge: 1001,
		});
		expect((await concurrent).data).toEqual([
			{ id: "original" },
			{ id: "updated" },
		]);
		expect(knowledge.get(key)).toBe(1001);
	});

	it("waits for fresh data when the stale window has expired", async () => {
		await seed();
		vi.advanceTimersByTime(301);
		const refresh = deferred();
		const fetcher = vi.fn(() => refresh.promise);
		let settled = false;
		const result = delta
			.fetchWithDelta<Entity>(key, budget, fetcher, mergeFlatEntities, options)
			.then((value) => {
				settled = true;
				return value;
			});
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(1000);
		refresh.resolve({ data: [{ id: "updated" }], serverKnowledge: 1001 });
		expect(await result).toMatchObject({
			wasCached: false,
			usedDelta: true,
			data: [{ id: "original" }, { id: "updated" }],
		});
	});

	it("waits for fresh data when no stale window was configured", async () => {
		await seed(false);
		vi.advanceTimersByTime(101);
		const refresh = deferred();
		const fetcher = vi.fn(() => refresh.promise);
		let settled = false;
		const result = delta
			.fetchWithDelta<Entity>(key, budget, fetcher, mergeFlatEntities, {
				ttl: 100,
			})
			.then((value) => {
				settled = true;
				return value;
			});
		await Promise.resolve();
		expect(settled).toBe(false);
		refresh.resolve({ data: [], serverKnowledge: 1000 });
		expect(await result).toMatchObject({
			wasCached: false,
			data: [{ id: "original" }],
		});
	});

	it("in delta mode, a failed delta request rejects and keeps the snapshot for the next read", async () => {
		await seed();
		vi.advanceTimersByTime(101);
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({
				data: [{ id: "recovered" }],
				serverKnowledge: 1001,
			});
		await expect(
			delta.fetchWithDelta<Entity>(
				key,
				budget,
				fetcher,
				mergeFlatEntities,
				options,
			),
		).rejects.toThrow("offline");
		expect(cache.peek(key)).toBeDefined();
		expect(knowledge.get(key)).toBe(1000);
		const recovered = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		expect(fetcher).toHaveBeenNthCalledWith(2, 1000);
		expect(recovered.data).toEqual([{ id: "original" }, { id: "recovered" }]);
	});

	it("retains stale data after a background error and permits a later refresh", async () => {
		disableDelta();
		await seed();
		vi.advanceTimersByTime(101);
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({
				data: [{ id: "recovered" }],
				serverKnowledge: 1001,
			});
		const stale = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		expect(stale.data).toEqual([{ id: "original" }]);
		await vi.advanceTimersByTimeAsync(0);
		expect(cache.peek(key)).toBeDefined();
		expect(knowledge.get(key)).toBe(1000);
		await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		await vi.advanceTimersByTimeAsync(0);
		const recovered = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		expect(recovered.data).toEqual([{ id: "recovered" }]);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("does not resurrect invalidated in-flight data or knowledge", async () => {
		await seed();
		vi.advanceTimersByTime(101);
		const refresh = deferred();
		const inFlight = delta.fetchWithDelta<Entity>(
			key,
			budget,
			() => refresh.promise,
			mergeFlatEntities,
			options,
		);
		delta.forceFullRefresh(budget);
		refresh.resolve({ data: [{ id: "stale-update" }], serverKnowledge: 1001 });
		await inFlight;
		await vi.advanceTimersByTimeAsync(0);
		expect(cache.peek(key)).toBeUndefined();
		expect(knowledge.get(key)).toBeUndefined();
		const fetcher = vi
			.fn()
			.mockResolvedValue({ data: [{ id: "complete" }], serverKnowledge: 1002 });
		const fresh = await delta.fetchWithDelta<Entity>(
			key,
			budget,
			fetcher,
			mergeFlatEntities,
			options,
		);
		expect(fetcher).toHaveBeenCalledExactlyOnceWith(undefined);
		expect(fresh.data).toEqual([{ id: "complete" }]);
	});
});
