import { beforeEach, describe, expect, it, vi } from "vitest";
import { CacheManager } from "../cacheManager.js";
import { ErrorHandler } from "../errorHandler.js";
import { RateLimiter } from "../rateLimiter.js";
import { ServerKnowledgeStore } from "../serverKnowledgeStore.js";
import { YNABClient } from "../ynabClient.js";

const response = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});

describe("YNAB network and cache boundary", () => {
	let cache: CacheManager;
	let knowledge: ServerKnowledgeStore;
	let limiter: RateLimiter;
	let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
	let api: YNABClient;
	beforeEach(() => {
		cache = new CacheManager();
		knowledge = new ServerKnowledgeStore();
		limiter = new RateLimiter({ maxRequests: 2 });
		fetch = vi.fn<typeof globalThis.fetch>();
		api = new YNABClient("mock-token", {
			cacheManager: cache,
			knowledgeStore: knowledge,
			rateLimiter: limiter,
			fetch,
		});
	});

	it("counts HTTP requests, while cached reads consume no allowance", async () => {
		fetch.mockImplementation(async () =>
			response({ data: { user: { id: "user" } } }),
		);
		const read = () =>
			cache.wrap("user", { ttl: 60000, loader: () => api.user.getUser() });
		await read();
		await read();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(limiter.getStatus("mock-token").remaining).toBe(1);
		await api.user.getUser();
		const error = await api.user.getUser().catch((cause: unknown) => cause);
		const result = new ErrorHandler({ format: JSON.stringify }).handleError(
			error,
			"getting user",
		);
		expect(result.isError).toBe(true);
		expect(
			JSON.parse((result.content[0] as { text: string }).text).error.code,
		).toBe(429);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("honors an actual 429 even when the tool converts the API error", async () => {
		fetch.mockResolvedValue(
			response({ error: { id: "429", name: "too_many_requests" } }, 429),
		);
		await expect(api.user.getUser()).rejects.toBeDefined();
		expect(limiter.getStatus("mock-token").isLimited).toBe(true);
		await expect(api.user.getUser()).rejects.toThrow();
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("invalidates every view of the mutated budget, preserving other budgets", async () => {
		for (const key of [
			"transactions:account:a:checking",
			"accounts:get:a:checking",
			"resources:accounts:list:a",
			"completions:accounts:a",
			"budgets:list",
			"resources:budgets:list",
			"completions:budgets",
		])
			cache.set(key, { balance: 0 });
		cache.set("accounts:get:b:savings", { balance: 100 });
		knowledge.update("transactions:account:a:checking", 1);
		fetch.mockResolvedValue(
			response({
				data: {
					transaction: {
						subtransactions: [],
						id: "tx",
						account_id: "checking",
						amount: -10000,
					},
				},
			}),
		);
		await api.transactions.createTransaction("a", {
			transaction: {
				account_id: "checking",
				date: "2026-01-01",
				amount: -10000,
			},
		});
		expect(cache.getKeys()).toEqual(["accounts:get:b:savings"]);
		expect(knowledge.get("transactions:account:a:checking")).toBeUndefined();
	});

	it("an older pending read cannot repopulate a budget after a write", async () => {
		let resolveRead!: (value: number) => void;
		const oldRead = cache.wrap("accounts:get:a:checking", {
			ttl: 60000,
			loader: () =>
				new Promise<number>((resolve) => {
					resolveRead = resolve;
				}),
		});
		await Promise.resolve();
		fetch.mockResolvedValue(
			response({
				data: {
					transaction: { subtransactions: [], id: "tx", amount: -10000 },
				},
			}),
		);
		await api.transactions.createTransaction("a", {
			transaction: {
				account_id: "checking",
				date: "2026-01-01",
				amount: -10000,
			},
		});
		resolveRead(0);
		await oldRead;
		expect(cache.get("accounts:get:a:checking")).toBeNull();
		const fresh = await cache.wrap("accounts:get:a:checking", {
			ttl: 60000,
			loader: async () => -10000,
		});
		expect(fresh).toBe(-10000);
	});

	it("invalidates after a timeout because the mutation may have committed", async () => {
		cache.set("accounts:get:a:checking", 0);
		fetch.mockImplementation(async () => {
			cache.set("accounts:get:a:checking", 0); // A read during the write.
			throw new Error("ECONNRESET");
		});
		await expect(
			api.transactions.deleteTransaction("a", "tx"),
		).rejects.toThrow();
		expect(cache.get("accounts:get:a:checking")).toBeNull();
	});

	it("keeps separate clients' caches and allowances isolated", async () => {
		const otherCache = new CacheManager();
		otherCache.set("accounts:get:a:checking", 42);
		const otherLimiter = new RateLimiter();
		const other = new YNABClient("other-token", {
			cacheManager: otherCache,
			knowledgeStore: new ServerKnowledgeStore(),
			rateLimiter: otherLimiter,
			fetch: async () => response({ data: { user: { id: "other" } } }),
		});
		fetch.mockResolvedValue(
			response({ data: { transaction: { subtransactions: [], id: "tx" } } }),
		);
		await api.transactions.deleteTransaction("a", "tx");
		await other.user.getUser();
		expect(otherCache.get("accounts:get:a:checking")).toBe(42);
		expect(otherLimiter.getStatus("other-token").remaining).toBe(199);
	});
});
