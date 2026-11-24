/**
 * Unit tests for enhanced CacheManager
 * Tests all new functionality including observability, LRU eviction, and concurrent deduplication
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheManager } from "../cacheManager.js";

describe("CacheManager", () => {
	let cache: CacheManager;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ now: 0 }); // Start fake timers at timestamp 0
		cache = new CacheManager();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("Basic Functionality", () => {
		it("should store and retrieve data", () => {
			cache.set("key1", "value1");
			expect(cache.get("key1")).toBe("value1");
		});

		it("should return null for non-existent keys", () => {
			expect(cache.get("nonexistent")).toBeNull();
		});

		it("should delete entries", () => {
			cache.set("key1", "value1");
			expect(cache.delete("key1")).toBe(true);
			expect(cache.get("key1")).toBeNull();
			expect(cache.delete("nonexistent")).toBe(false);
		});

		it("should clear all entries", () => {
			cache.set("key1", "value1");
			cache.set("key2", "value2");
			cache.clear();
			expect(cache.get("key1")).toBeNull();
			expect(cache.get("key2")).toBeNull();
		});

		it("should handle TTL expiration", () => {
			cache.set("key1", "value1", 1000); // 1 second TTL
			expect(cache.get("key1")).toBe("value1");

			vi.advanceTimersByTime(1100);
			expect(cache.get("key1")).toBeNull();
		});

		it("should generate consistent cache keys", () => {
			const key1 = CacheManager.generateKey("prefix", "param1", 2, true);
			const key2 = CacheManager.generateKey("prefix", "param1", 2, true);
			expect(key1).toBe(key2);
			expect(key1).toBe("prefix:param1:2:true");
		});

		it("should filter undefined parameters in key generation", () => {
			const key = CacheManager.generateKey(
				"prefix",
				"param1",
				undefined,
				"param3",
			);
			expect(key).toBe("prefix:param1:param3");
		});
	});

	describe("Hit/Miss Counters", () => {
		it("should track cache hits", () => {
			cache.set("key1", "value1");
			cache.get("key1");
			cache.get("key1");

			const stats = cache.getStats();
			expect(stats.hits).toBe(2);
			expect(stats.misses).toBe(0);
			expect(stats.hitRate).toBe(1);
		});

		it("should track cache misses", () => {
			cache.get("nonexistent1");
			cache.get("nonexistent2");

			const stats = cache.getStats();
			expect(stats.hits).toBe(0);
			expect(stats.misses).toBe(2);
			expect(stats.hitRate).toBe(0);
		});

		it("should track expired entries as misses", () => {
			cache.set("key1", "value1", 1000);
			vi.advanceTimersByTime(1100);
			cache.get("key1");

			const stats = cache.getStats();
			expect(stats.hits).toBe(0);
			expect(stats.misses).toBe(1);
		});

		it("should calculate hit rate correctly", () => {
			cache.set("key1", "value1");
			cache.get("key1"); // hit
			cache.get("key1"); // hit
			cache.get("nonexistent"); // miss

			const stats = cache.getStats();
			expect(stats.hits).toBe(2);
			expect(stats.misses).toBe(1);
			expect(stats.hitRate).toBeCloseTo(2 / 3);
		});

		it("should reset counters on clear", () => {
			cache.set("key1", "value1");
			cache.get("key1");
			cache.get("nonexistent");

			cache.clear();
			const stats = cache.getStats();
			expect(stats.hits).toBe(0);
			expect(stats.misses).toBe(0);
			expect(stats.hitRate).toBe(0);
		});

		it("should handle zero requests for hit rate", () => {
			const stats = cache.getStats();
			expect(stats.hitRate).toBe(0);
		});
	});

	describe("LRU Eviction", () => {
		beforeEach(() => {
			cache = new CacheManager({ maxEntries: 3 });
		});

		it("should not evict when under limit", () => {
			cache.set("key1", "value1");
			cache.set("key2", "value2");

			const stats = cache.getStats();
			expect(stats.size).toBe(2);
			expect(stats.evictions).toBe(0);
			expect(cache.get("key1")).toBe("value1");
			expect(cache.get("key2")).toBe("value2");
		});

		it("should evict LRU entry when maxEntries is exceeded", () => {
			cache.set("key1", "value1");
			cache.set("key2", "value2");
			cache.set("key3", "value3");
			cache.set("key4", "value4"); // Should evict key1

			const stats = cache.getStats();
			expect(stats.size).toBe(3);
			expect(stats.evictions).toBe(1);
			expect(cache.get("key1")).toBeNull(); // Evicted
			expect(cache.get("key2")).toBe("value2");
			expect(cache.get("key3")).toBe("value3");
			expect(cache.get("key4")).toBe("value4");
		});

		it("should update access order on get", () => {
			cache.set("key1", "value1");
			cache.set("key2", "value2");
			cache.set("key3", "value3");

			// Access key1 to make it most recently used
			cache.get("key1");

			cache.set("key4", "value4"); // Should evict key2 (oldest)

			expect(cache.get("key1")).toBe("value1"); // Still there
			expect(cache.get("key2")).toBeNull(); // Evicted
			expect(cache.get("key3")).toBe("value3");
			expect(cache.get("key4")).toBe("value4");
		});

		it("should handle zero maxEntries (no caching)", () => {
			cache = new CacheManager({ maxEntries: 0 });

			cache.set("key1", "value1");
			expect(cache.get("key1")).toBeNull();
			expect(cache.getStats().size).toBe(0);
		});

		it("should evict multiple entries if needed", () => {
			// Fill cache
			cache.set("key1", "value1");
			cache.set("key2", "value2");
			cache.set("key3", "value3");

			// Change maxEntries to 1 by creating a new cache manager
			const smallCache = new CacheManager({ maxEntries: 1 });

			// Add entries that should trigger multiple evictions
			smallCache.set("key1", "value1");
			smallCache.set("key2", "value2");

			expect(smallCache.getStats().size).toBe(1);
			expect(smallCache.getStats().evictions).toBe(1);
			expect(smallCache.get("key2")).toBe("value2"); // Most recent
		});

		it("should not evict when updating existing key at maxEntries limit", () => {
			// Fill cache to capacity
			cache.set("key1", "value1");
			cache.set("key2", "value2");
			cache.set("key3", "value3");

			const initialStats = cache.getStats();
			expect(initialStats.size).toBe(3);
			expect(initialStats.evictions).toBe(0);

			// Update an existing key - should not trigger eviction
			cache.set("key2", "updated-value2");

			const updatedStats = cache.getStats();
			expect(updatedStats.size).toBe(3); // Same size
			expect(updatedStats.evictions).toBe(0); // No evictions
			expect(cache.get("key1")).toBe("value1"); // Other keys still present
			expect(cache.get("key2")).toBe("updated-value2"); // Updated value
			expect(cache.get("key3")).toBe("value3"); // Other keys still present
		});
	});

	describe("Per-Entry Options", () => {
		it("should use custom TTL from options", () => {
			cache.set("key1", "value1", 500);
			cache.set("key2", "value2", 1500);

			vi.advanceTimersByTime(1000);
			expect(cache.get("key1")).toBeNull(); // Expired
			expect(cache.get("key2")).toBe("value2"); // Still valid
		});

		it("should use default TTL when no options provided", () => {
			cache.set("key1", "value1");

			// Advance to just before expiration (5 minutes is default TTL)
			vi.advanceTimersByTime(299000); // Just under 5 minutes - should still be valid
			expect(cache.get("key1")).toBe("value1");

			// Advance past the TTL (using simple set should have NO stale window)
			vi.advanceTimersByTime(2000); // Total ~5 minutes - should be expired
			expect(cache.get("key1")).toBeNull();
		});

		it("should maintain backward compatibility with number TTL", () => {
			cache.set("key1", "value1", 2000);
			vi.advanceTimersByTime(1000);
			expect(cache.get("key1")).toBe("value1");

			vi.advanceTimersByTime(1500);
			expect(cache.get("key1")).toBeNull();
		});
	});

	describe("wrap() Helper", () => {
		it("should return cached data immediately on hit", async () => {
			const loader = vi.fn().mockResolvedValue("loaded-value");
			cache.set("key1", "cached-value");

			const result = await cache.wrap("key1", { loader });

			expect(result).toBe("cached-value");
			expect(loader).not.toHaveBeenCalled();
		});

		it("should call loader and cache result on miss", async () => {
			const loader = vi.fn().mockResolvedValue("loaded-value");

			const result = await cache.wrap("key1", { loader });

			expect(result).toBe("loaded-value");
			expect(loader).toHaveBeenCalledTimes(1);
			expect(cache.get("key1")).toBe("loaded-value");
		});

		it("should run the loader over a fresh entry when revalidating", async () => {
			const loader = vi.fn().mockResolvedValue("revalidated-value");
			cache.set("key1", "cached-value");

			const result = await cache.wrap("key1", { loader, revalidate: true });

			expect(result).toBe("revalidated-value");
			expect(loader).toHaveBeenCalledTimes(1);
			expect(cache.get("key1")).toBe("revalidated-value");
		});

		it("should deduplicate concurrent revalidations and not publish after invalidation", async () => {
			cache.set("budgets:list:b1", "cached-value");
			let finish!: (value: string) => void;
			const loader = vi.fn(
				() =>
					new Promise<string>((resolve) => {
						finish = resolve;
					}),
			);

			const first = cache.wrap("budgets:list:b1", { loader, revalidate: true });
			const second = cache.wrap("budgets:list:b1", {
				loader,
				revalidate: true,
			});
			cache.deleteByBudgetId("b1");
			finish("stale-value");

			expect(await first).toBe("stale-value");
			expect(await second).toBe("stale-value");
			expect(loader).toHaveBeenCalledTimes(1);
			expect(cache.peek("budgets:list:b1")).toBeUndefined();
		});

		it("should deduplicate concurrent requests", async () => {
			const loader = vi
				.fn()
				.mockImplementation(
					() =>
						new Promise((resolve) =>
							setTimeout(() => resolve("loaded-value"), 100),
						),
				);

			// Start two concurrent requests
			const promise1 = cache.wrap("key1", { loader });
			const promise2 = cache.wrap("key1", { loader });

			// Advance time to resolve promises
			vi.advanceTimersByTime(100);

			const [result1, result2] = await Promise.all([promise1, promise2]);

			expect(result1).toBe("loaded-value");
			expect(result2).toBe("loaded-value");
			expect(loader).toHaveBeenCalledTimes(1); // Only called once
		});

		it("should handle loader errors gracefully", async () => {
			const loader = vi.fn().mockRejectedValue(new Error("Load failed"));

			await expect(cache.wrap("key1", { loader })).rejects.toThrow(
				"Load failed",
			);
			expect(cache.get("key1")).toBeNull(); // Should not cache error
		});

		it("should clean up pending operations on completion", async () => {
			const loader = vi.fn().mockResolvedValue("loaded-value");

			await cache.wrap("key1", { loader });

			// Start another request after first completes
			const loader2 = vi.fn().mockResolvedValue("loaded-value-2");
			await cache.wrap("key1", { loader: loader2 });

			// Should use cached value, not call loader2
			expect(loader2).not.toHaveBeenCalled();
		});
	});

	describe("Constructor Options", () => {
		it("should use constructor option for maxEntries", () => {
			const configuredCache = new CacheManager({ maxEntries: 5 });

			const stats = configuredCache.getStats();
			expect(stats.maxEntries).toBe(5);
		});

		it("should use constructor option for default TTL", () => {
			// Reset timers for new cache instance
			vi.useRealTimers();
			vi.useFakeTimers({ now: 0 });

			const configuredCache = new CacheManager({ defaultTtlMs: 60000 });

			configuredCache.set("key1", "value1"); // Use default TTL
			vi.advanceTimersByTime(59000); // Just under 1 minute - should be valid
			expect(configuredCache.get("key1")).toBe("value1");

			vi.advanceTimersByTime(2000); // ~1 minute total - should expire
			expect(configuredCache.get("key1")).toBeNull();
		});

		it("should use defaults when no options are given", () => {
			// Reset timers for new cache instance
			vi.useRealTimers();
			vi.useFakeTimers({ now: 0 });

			const configuredCache = new CacheManager();
			const stats = configuredCache.getStats();

			expect(stats.maxEntries).toBe(1000); // Default value

			// Test default TTL (300000ms = 5 minutes)
			configuredCache.set("key1", "value1");
			vi.advanceTimersByTime(299000); // Just under 5 minutes - should be valid
			expect(configuredCache.get("key1")).toBe("value1");

			vi.advanceTimersByTime(2000); // ~5 minutes total - should expire
			expect(configuredCache.get("key1")).toBeNull();
		});
	});

	describe("Enhanced Statistics", () => {
		it("should return comprehensive stats", () => {
			cache.set("key1", "value1");
			cache.get("key1");
			cache.get("nonexistent");

			const stats = cache.getStats();

			expect(stats).toEqual({
				size: 1,
				keys: ["key1"],
				hits: 1,
				misses: 1,
				evictions: 0,
				maxEntries: 1000,
				hitRate: 0.5,
			});
		});

		it("should maintain backward compatibility with basic stats", () => {
			cache.set("key1", "value1");
			cache.set("key2", "value2");

			const stats = cache.getStats();

			// Basic fields should always be present
			expect(stats).toHaveProperty("size", 2);
			expect(stats).toHaveProperty("keys");
			expect(stats.keys).toEqual(["key1", "key2"]);
		});

		it("should provide lightweight cache metadata without full entry data", () => {
			cache.set("key1", "string-value", 1000);
			cache.set("key2", { prop: "object" }, 2000);
			cache.set("key3", 42, 3000);

			vi.advanceTimersByTime(1500); // key1 should be expired

			const metadata = cache.getCacheMetadata();
			expect(metadata).toHaveLength(3);

			// Check expired entry
			const key1Meta = metadata.find((m) => m.key === "key1");
			expect(key1Meta).toEqual({
				key: "key1",
				timestamp: expect.any(Number),
				ttl: 1000,
				dataType: "string",
				isExpired: true,
			});

			// Check non-expired entry
			const key2Meta = metadata.find((m) => m.key === "key2");
			expect(key2Meta).toEqual({
				key: "key2",
				timestamp: expect.any(Number),
				ttl: 2000,
				dataType: "object",
				isExpired: false,
			});

			const key3Meta = metadata.find((m) => m.key === "key3");
			expect(key3Meta).toEqual({
				key: "key3",
				timestamp: expect.any(Number),
				ttl: 3000,
				dataType: "number",
				isExpired: false,
			});
		});
	});

	describe("Edge Cases and Error Handling", () => {
		it("should handle circular references in cache values", () => {
			const circular: any = { name: "test" };
			circular.self = circular;

			expect(() => cache.set("key1", circular)).not.toThrow();
			expect(cache.get("key1")).toBe(circular);
		});

		it("should handle very large cache sizes", () => {
			const largeCache = new CacheManager({ maxEntries: 10000 });

			// Add many entries
			for (let i = 0; i < 5000; i++) {
				largeCache.set(`key${i}`, `value${i}`);
			}

			expect(largeCache.getStats().size).toBe(5000);
			expect(largeCache.get("key0")).toBe("value0");
			expect(largeCache.get("key4999")).toBe("value4999");
		});

		it("should handle concurrent wrap calls with different keys independently", async () => {
			const loader1 = vi.fn().mockResolvedValue("value1");
			const loader2 = vi.fn().mockResolvedValue("value2");

			const [result1, result2] = await Promise.all([
				cache.wrap("key1", { loader: loader1 }),
				cache.wrap("key2", { loader: loader2 }),
			]);

			expect(result1).toBe("value1");
			expect(result2).toBe("value2");
			expect(loader1).toHaveBeenCalledTimes(1);
			expect(loader2).toHaveBeenCalledTimes(1);
		});

		it("should clean up failed operations", async () => {
			const loader = vi.fn().mockRejectedValue(new Error("Failed"));

			await expect(cache.wrap("key1", { loader })).rejects.toThrow("Failed");

			// Subsequent call should try again
			const loader2 = vi.fn().mockResolvedValue("success");
			const result = await cache.wrap("key1", { loader: loader2 });

			expect(result).toBe("success");
			expect(loader2).toHaveBeenCalledTimes(1);
		});
	});

	describe("Budget-based Deletion", () => {
		describe("deleteByBudgetId", () => {
			it("should delete entries containing the provided budget ID", () => {
				cache.set("transactions:list:budget-123", "txn");
				cache.set("accounts:list:budget-123", "acct");
				cache.set("transactions:list:budget-456", "other");

				const removed = cache.deleteByBudgetId("budget-123");
				expect(removed).toBe(2);
				expect(cache.getStats().keys).toEqual(["transactions:list:budget-456"]);
			});

			it("should return 0 when budget ID does not exist in cache", () => {
				cache.set("transactions:list:budget-123", "txn");

				const removed = cache.deleteByBudgetId("budget-999");
				expect(removed).toBe(0);
				expect(cache.getStats().keys).toEqual(["transactions:list:budget-123"]);
			});

			it("should not match budget IDs that are substrings of other IDs", () => {
				cache.set("transactions:list:budget-123", "txn");
				cache.set("transactions:list:budget-1234", "txn2");

				const removed = cache.deleteByBudgetId("budget-1");
				expect(removed).toBe(0);
				expect(cache.getStats().keys).toEqual([
					"transactions:list:budget-123",
					"transactions:list:budget-1234",
				]);
			});

			it("should handle UUID formatted budget identifiers", () => {
				const uuid = "123e4567-e89b-12d3-a456-426614174000";
				cache.set(`transactions:list:${uuid}`, "txn");
				cache.set(`accounts:list:${uuid}`, "acct");
				cache.set("transactions:list:budget-456", "other");

				const removed = cache.deleteByBudgetId(uuid);
				expect(removed).toBe(2);
				expect(cache.getStats().keys).toEqual(["transactions:list:budget-456"]);
			});

			it("should not affect cache stats when deleting by budget ID", () => {
				cache.set("transactions:list:budget-123", "txn");
				cache.set("transactions:list:budget-456", "other");

				const before = cache.getStats();
				cache.deleteByBudgetId("budget-123");
				const after = cache.getStats();

				expect(after.hits).toBe(before.hits);
				expect(after.misses).toBe(before.misses);
			});
		});
	});

	describe("Integration with Existing Patterns", () => {
		it("should work with existing tool usage patterns", () => {
			// Simulate existing usage pattern from tools
			const key = CacheManager.generateKey("budgets", "user123");
			cache.set(key, { budgets: ["budget1", "budget2"] }, 10 * 60 * 1000);

			const cached = cache.get(key);
			expect(cached).toEqual({ budgets: ["budget1", "budget2"] });

			const stats = cache.getStats();
			expect(stats.hits).toBe(1);
			expect(stats.size).toBe(1);
		});

		it("keeps independently owned caches isolated", () => {
			const other = new CacheManager();
			cache.set("same-key", "first");
			other.set("same-key", "second");
			cache.clear();
			expect(other.get("same-key")).toBe("second");
		});
	});
});

describe("cache invalidation while reads are pending", () => {
	it.each(["delete", "deleteMany", "deleteByBudgetId", "clear"] as const)(
		"%s rejects late publication without disrupting a newer read",
		async (method) => {
			const cache = new CacheManager();
			const key = "accounts:get:budget-a:account-a";
			let finishOld!: (value: string) => void;
			let finishNew!: (value: string) => void;
			const old = cache.wrap(key, {
				loader: () =>
					new Promise<string>((resolve) => {
						finishOld = resolve;
					}),
			});
			switch (method) {
				case "delete":
					cache.delete(key);
					break;
				case "deleteMany":
					cache.deleteMany([key]);
					break;
				case "deleteByBudgetId":
					cache.deleteByBudgetId("budget-a");
					break;
				case "clear":
					cache.clear();
					break;
				default:
					throw new Error(`Unexpected invalidation method: ${String(method)}`);
			}
			const fresh = cache.wrap(key, {
				loader: () =>
					new Promise<string>((resolve) => {
						finishNew = resolve;
					}),
			});
			finishOld("stale");
			await old;
			expect(cache.get(key)).toBeNull();
			const redundantLoader = vi.fn(async () => "unexpected");
			const joined = cache.wrap(key, { loader: redundantLoader });
			finishNew("fresh");
			expect(await fresh).toBe("fresh");
			expect(await joined).toBe("fresh");
			expect(redundantLoader).not.toHaveBeenCalled();
			expect(cache.get(key)).toBe("fresh");
		},
	);
});
