/**
 * Unit tests for enhanced CacheManager
 * Tests all new functionality including observability, LRU eviction, and concurrent deduplication
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheManager } from '../cacheManager.js';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: 0 }); // Start fake timers at timestamp 0
    // Clear environment variables
    delete process.env.YNAB_MCP_CACHE_MAX_ENTRIES;
    delete process.env.YNAB_MCP_CACHE_STALE_MS;
    delete process.env.YNAB_MCP_CACHE_DEFAULT_TTL_MS;
    cache = new CacheManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic Functionality', () => {
    it('should store and retrieve data', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should delete entries', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeNull();
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });

    it('should handle TTL expiration', () => {
      cache.set('key1', 'value1', 1000); // 1 second TTL
      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(1100);
      expect(cache.get('key1')).toBeNull();
    });

    it('should generate consistent cache keys', () => {
      const key1 = CacheManager.generateKey('prefix', 'param1', 2, true);
      const key2 = CacheManager.generateKey('prefix', 'param1', 2, true);
      expect(key1).toBe(key2);
      expect(key1).toBe('prefix:param1:2:true');
    });

    it('should filter undefined parameters in key generation', () => {
      const key = CacheManager.generateKey('prefix', 'param1', undefined, 'param3');
      expect(key).toBe('prefix:param1:param3');
    });
  });

  describe('Hit/Miss Counters', () => {
    it('should track cache hits', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(1);
    });

    it('should track cache misses', () => {
      cache.get('nonexistent1');
      cache.get('nonexistent2');

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0);
    });

    it('should track expired entries as misses', () => {
      cache.set('key1', 'value1', 1000);
      vi.advanceTimersByTime(1100);
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });

    it('should reset counters on clear', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('nonexistent');

      cache.clear();
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should handle zero requests for hit rate', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('LRU Eviction', () => {
    beforeEach(() => {
      process.env.YNAB_MCP_CACHE_MAX_ENTRIES = '3';
      cache = new CacheManager();
    });

    it('should not evict when under limit', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.evictions).toBe(0);
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
    });

    it('should evict LRU entry when maxEntries is exceeded', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // Should evict key1

      const stats = cache.getStats();
      expect(stats.size).toBe(3);
      expect(stats.evictions).toBe(1);
      expect(cache.get('key1')).toBeNull(); // Evicted
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('should update access order on get', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 to make it most recently used
      cache.get('key1');

      cache.set('key4', 'value4'); // Should evict key2 (oldest)

      expect(cache.get('key1')).toBe('value1'); // Still there
      expect(cache.get('key2')).toBeNull(); // Evicted
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('should handle zero maxEntries (no caching)', () => {
      process.env.YNAB_MCP_CACHE_MAX_ENTRIES = '0';
      cache = new CacheManager();

      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBeNull();
      expect(cache.getStats().size).toBe(0);
    });

    it('should evict multiple entries if needed', () => {
      // Fill cache
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Change maxEntries to 1 by creating a new cache manager
      process.env.YNAB_MCP_CACHE_MAX_ENTRIES = '1';
      const smallCache = new CacheManager();

      // Add entries that should trigger multiple evictions
      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');

      expect(smallCache.getStats().size).toBe(1);
      expect(smallCache.getStats().evictions).toBe(1);
      expect(smallCache.get('key2')).toBe('value2'); // Most recent
    });

    it('should not evict when updating existing key at maxEntries limit', () => {
      // Fill cache to capacity
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const initialStats = cache.getStats();
      expect(initialStats.size).toBe(3);
      expect(initialStats.evictions).toBe(0);

      // Update an existing key - should not trigger eviction
      cache.set('key2', 'updated-value2');

      const updatedStats = cache.getStats();
      expect(updatedStats.size).toBe(3); // Same size
      expect(updatedStats.evictions).toBe(0); // No evictions
      expect(cache.get('key1')).toBe('value1'); // Other keys still present
      expect(cache.get('key2')).toBe('updated-value2'); // Updated value
      expect(cache.get('key3')).toBe('value3'); // Other keys still present
    });
  });

  describe('Per-Entry Options', () => {
    it('should use custom TTL from options', () => {
      cache.set('key1', 'value1', { ttl: 500, staleWhileRevalidate: 0 });
      cache.set('key2', 'value2', { ttl: 1500, staleWhileRevalidate: 0 });

      vi.advanceTimersByTime(1000);
      expect(cache.get('key1')).toBeNull(); // Expired
      expect(cache.get('key2')).toBe('value2'); // Still valid
    });

    it('should use default TTL when no options provided', () => {
      cache.set('key1', 'value1');

      // Advance to just before expiration (5 minutes is default TTL)
      vi.advanceTimersByTime(299000); // Just under 5 minutes - should still be valid
      expect(cache.get('key1')).toBe('value1');

      // Advance past the TTL (using simple set should have NO stale window)
      vi.advanceTimersByTime(2000); // Total ~5 minutes - should be expired
      expect(cache.get('key1')).toBeNull();
    });

    it('should support staleWhileRevalidate', () => {
      cache.set('key1', 'value1', { ttl: 1000, staleWhileRevalidate: 2000 });

      vi.advanceTimersByTime(1500); // Within stale window
      const result = cache.get('key1');

      expect(result).toBe('value1'); // Should return stale data
      const stats = cache.getStats();
      expect(stats.hits).toBe(1); // Counted as hit
    });

    it('should not return data outside stale window', () => {
      cache.set('key1', 'value1', { ttl: 1000, staleWhileRevalidate: 2000 });

      vi.advanceTimersByTime(3500); // Outside stale window
      const result = cache.get('key1');

      expect(result).toBeNull();
      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
    });

    it('should maintain backward compatibility with number TTL', () => {
      cache.set('key1', 'value1', 2000);
      vi.advanceTimersByTime(1000);
      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(1500);
      expect(cache.get('key1')).toBeNull();
    });
  });

  describe('wrap() Helper', () => {
    it('should return cached data immediately on hit', async () => {
      const loader = vi.fn().mockResolvedValue('loaded-value');
      cache.set('key1', 'cached-value');

      const result = await cache.wrap('key1', { loader });

      expect(result).toBe('cached-value');
      expect(loader).not.toHaveBeenCalled();
    });

    it('should call loader and cache result on miss', async () => {
      const loader = vi.fn().mockResolvedValue('loaded-value');

      const result = await cache.wrap('key1', { loader });

      expect(result).toBe('loaded-value');
      expect(loader).toHaveBeenCalledTimes(1);
      expect(cache.get('key1')).toBe('loaded-value');
    });

    it('should deduplicate concurrent requests', async () => {
      const loader = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('loaded-value'), 100)),
        );

      // Start two concurrent requests
      const promise1 = cache.wrap('key1', { loader });
      const promise2 = cache.wrap('key1', { loader });

      // Advance time to resolve promises
      vi.advanceTimersByTime(100);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe('loaded-value');
      expect(result2).toBe('loaded-value');
      expect(loader).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should handle loader errors gracefully', async () => {
      const loader = vi.fn().mockRejectedValue(new Error('Load failed'));

      await expect(cache.wrap('key1', { loader })).rejects.toThrow('Load failed');
      expect(cache.get('key1')).toBeNull(); // Should not cache error
    });

    it('should serve stale data and trigger background refresh', async () => {
      const loader1 = vi.fn().mockResolvedValue('initial-value');
      const loader2 = vi.fn().mockResolvedValue('refreshed-value');

      // Initial load
      await cache.wrap('key1', { loader: loader1, ttl: 1000, staleWhileRevalidate: 2000 });

      // Move to stale period
      vi.advanceTimersByTime(1500);

      // Second call should return stale data immediately and refresh in background
      const result = await cache.wrap('key1', { loader: loader2 });
      expect(result).toBe('initial-value'); // Stale data returned

      // Advance time to allow background refresh
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(loader2).toHaveBeenCalledTimes(1);
    });

    it('should apply cache options from wrap call', async () => {
      const loader = vi.fn().mockResolvedValue('loaded-value');

      await cache.wrap('key1', {
        loader,
        ttl: 500,
        staleWhileRevalidate: 1000,
      });

      // Verify custom TTL
      vi.advanceTimersByTime(400);
      expect(cache.get('key1')).toBe('loaded-value');

      vi.advanceTimersByTime(200); // Total 600ms, past TTL but within stale window
      const staleResult = cache.get('key1');
      expect(staleResult).toBe('loaded-value'); // Should return stale data
    });

    it('should clean up pending operations on completion', async () => {
      const loader = vi.fn().mockResolvedValue('loaded-value');

      await cache.wrap('key1', { loader });

      // Start another request after first completes
      const loader2 = vi.fn().mockResolvedValue('loaded-value-2');
      await cache.wrap('key1', { loader: loader2 });

      // Should use cached value, not call loader2
      expect(loader2).not.toHaveBeenCalled();
    });

    it('should preserve existing TTL/SWR when options omitted in background refresh', async () => {
      const loader1 = vi.fn().mockResolvedValue('initial-value');
      const loader2 = vi.fn().mockResolvedValue('refreshed-value');

      // Initial load with specific TTL/SWR
      await cache.wrap('key1', {
        loader: loader1,
        ttl: 2000,
        staleWhileRevalidate: 3000,
      });

      // Move to stale period
      vi.advanceTimersByTime(2500);

      // Background refresh with no TTL/SWR specified - should preserve original values
      await cache.wrap('key1', { loader: loader2 });

      // Advance time to allow background refresh
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      // Now check if the refreshed entry still has the original TTL
      vi.advanceTimersByTime(1800); // Should still be within original TTL (2000ms)
      const result = cache.get('key1');
      expect(result).toBe('refreshed-value');

      // Move past original TTL but within stale window
      vi.advanceTimersByTime(300); // Total 2300ms past refresh, should be in stale window
      const staleResult = cache.get('key1');
      expect(staleResult).toBe('refreshed-value'); // Should still be available due to preserved SWR

      // Move beyond original TTL + stale window (5000ms) from the initial load to ensure expiry
      vi.advanceTimersByTime(3000); // Total elapsed time ~7700ms from first load
      await vi.runAllTimersAsync();
      expect(cache.get('key1')).toBeNull(); // Entry should be expired after preserved TTL/SWR window
    });
  });

  describe('Cleanup Enhancement', () => {
    it('should update lastCleanup timestamp', () => {
      const startTime = Date.now();
      vi.advanceTimersByTime(1000);

      cache.set('key1', 'value1', 500);
      vi.advanceTimersByTime(600);
      cache.cleanup();

      const stats = cache.getStats();
      expect(stats.lastCleanup).toBeGreaterThan(startTime);
    });

    it('should include cleanup removals in eviction count', () => {
      cache.set('key1', 'value1', 500);
      cache.set('key2', 'value2', 1000);

      vi.advanceTimersByTime(600);
      const cleaned = cache.cleanup();

      expect(cleaned).toBe(1);
      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
    });

    it('should return zero when no cleanup needed', () => {
      cache.set('key1', 'value1', 5000);
      const cleaned = cache.cleanup();

      expect(cleaned).toBe(0);
      const stats = cache.getStats();
      expect(stats.evictions).toBe(0);
    });

    it('should provide detailed cleanup information', () => {
      cache.set('key1', 'value1', 500);
      cache.set('key2', 'value2', 1000);
      cache.set('key3', 'value3', 5000);

      vi.advanceTimersByTime(600);
      const result = cache.cleanupDetailed();

      expect(result.cleaned).toBe(1);
      expect(result.evictions).toBe(1);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });

    it('should maintain backward compatibility with cleanup() method', () => {
      cache.set('key1', 'value1', 500);
      cache.set('key2', 'value2', 1000);

      vi.advanceTimersByTime(600);
      const cleaned = cache.cleanup();

      expect(cleaned).toBe(1); // Should still return number of cleaned entries
      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('Environment Variable Configuration', () => {
    it('should use environment variable for maxEntries', () => {
      process.env.YNAB_MCP_CACHE_MAX_ENTRIES = '5';
      const configuredCache = new CacheManager();

      const stats = configuredCache.getStats();
      expect(stats.maxEntries).toBe(5);
    });

    it('should use environment variable for stale window', () => {
      process.env.YNAB_MCP_CACHE_STALE_MS = '30000';
      const configuredCache = new CacheManager();

      configuredCache.set('key1', 'value1', { ttl: 1000, staleWhileRevalidate: undefined });

      // The default stale window should be used from env var
      vi.advanceTimersByTime(15000); // Within default stale window from env
      expect(configuredCache.get('key1')).toBe('value1'); // Served as stale data

      vi.advanceTimersByTime(16100); // Beyond stale window now (total 31100ms > 31000ms)
      expect(configuredCache.get('key1')).toBeNull();
    });

    it('should fall back to defaults for invalid environment values', () => {
      process.env.YNAB_MCP_CACHE_MAX_ENTRIES = 'invalid';
      process.env.YNAB_MCP_CACHE_STALE_MS = 'not-a-number';
      process.env.YNAB_MCP_CACHE_DEFAULT_TTL_MS = 'invalid-ttl';

      // Reset timers for new cache instance
      vi.useRealTimers();
      vi.useFakeTimers({ now: 0 });

      const configuredCache = new CacheManager();
      const stats = configuredCache.getStats();

      expect(stats.maxEntries).toBe(1000); // Default value

      // Test that invalid default TTL falls back to 300000ms (5 minutes)
      configuredCache.set('key1', 'value1');
      vi.advanceTimersByTime(299000); // Just under 5 minutes - should be valid
      expect(configuredCache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(2000); // ~5 minutes total - should expire
      expect(configuredCache.get('key1')).toBeNull();
    });

    it('should use environment variable for default TTL', () => {
      process.env.YNAB_MCP_CACHE_DEFAULT_TTL_MS = '60000'; // 1 minute

      // Reset timers for new cache instance
      vi.useRealTimers();
      vi.useFakeTimers({ now: 0 });

      const configuredCache = new CacheManager();

      configuredCache.set('key1', 'value1'); // Use default TTL
      vi.advanceTimersByTime(59000); // Just under 1 minute - should be valid
      expect(configuredCache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(2000); // ~1 minute total - should expire
      expect(configuredCache.get('key1')).toBeNull();
    });

    it('should fall back to defaults when environment variables are missing', () => {
      delete process.env.YNAB_MCP_CACHE_MAX_ENTRIES;
      delete process.env.YNAB_MCP_CACHE_STALE_MS;
      delete process.env.YNAB_MCP_CACHE_DEFAULT_TTL_MS;

      // Reset timers for new cache instance
      vi.useRealTimers();
      vi.useFakeTimers({ now: 0 });

      const configuredCache = new CacheManager();
      const stats = configuredCache.getStats();

      expect(stats.maxEntries).toBe(1000); // Default value

      // Test default TTL (300000ms = 5 minutes)
      configuredCache.set('key1', 'value1');
      vi.advanceTimersByTime(299000); // Just under 5 minutes - should be valid
      expect(configuredCache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(2000); // ~5 minutes total - should expire
      expect(configuredCache.get('key1')).toBeNull();
    });
  });

  describe('Enhanced Statistics', () => {
    it('should return comprehensive stats', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('nonexistent');

      const stats = cache.getStats();

      expect(stats).toEqual({
        size: 1,
        keys: ['key1'],
        hits: 1,
        misses: 1,
        evictions: 0,
        lastCleanup: null,
        maxEntries: 1000,
        hitRate: 0.5,
      });
    });

    it('should maintain backward compatibility with basic stats', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();

      // Basic fields should always be present
      expect(stats).toHaveProperty('size', 2);
      expect(stats).toHaveProperty('keys');
      expect(stats.keys).toEqual(['key1', 'key2']);
    });

    it('should handle getEntriesForSizeEstimation correctly', () => {
      cache.set('key1', 'value1', 1000);
      cache.set('key2', 'value2', 2000);

      vi.advanceTimersByTime(1500);

      const entries = cache.getEntriesForSizeEstimation();
      expect(entries).toHaveLength(1); // Only non-expired entry
      expect(entries[0][0]).toBe('key2');
    });

    it('should provide lightweight cache metadata without full entry data', () => {
      cache.set('key1', 'string-value', 1000);
      cache.set('key2', { prop: 'object' }, 2000);
      cache.set('key3', 42, { ttl: 3000, staleWhileRevalidate: 1000 });

      vi.advanceTimersByTime(1500); // key1 should be expired

      const metadata = cache.getCacheMetadata();
      expect(metadata).toHaveLength(3);

      // Check expired entry
      const key1Meta = metadata.find((m) => m.key === 'key1');
      expect(key1Meta).toEqual({
        key: 'key1',
        timestamp: expect.any(Number),
        ttl: 1000,
        staleWhileRevalidate: undefined,
        dataType: 'string',
        isExpired: true,
      });

      // Check non-expired entry
      const key2Meta = metadata.find((m) => m.key === 'key2');
      expect(key2Meta).toEqual({
        key: 'key2',
        timestamp: expect.any(Number),
        ttl: 2000,
        staleWhileRevalidate: undefined,
        dataType: 'object',
        isExpired: false,
      });

      // Check entry with staleWhileRevalidate
      const key3Meta = metadata.find((m) => m.key === 'key3');
      expect(key3Meta).toEqual({
        key: 'key3',
        timestamp: expect.any(Number),
        ttl: 3000,
        staleWhileRevalidate: 1000,
        dataType: 'number',
        isExpired: false,
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle circular references in cache values', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;

      expect(() => cache.set('key1', circular)).not.toThrow();
      expect(cache.get('key1')).toBe(circular);
    });

    it('should handle very large cache sizes', () => {
      process.env.YNAB_MCP_CACHE_MAX_ENTRIES = '10000';
      const largeCache = new CacheManager();

      // Add many entries
      for (let i = 0; i < 5000; i++) {
        largeCache.set(`key${i}`, `value${i}`);
      }

      expect(largeCache.getStats().size).toBe(5000);
      expect(largeCache.get('key0')).toBe('value0');
      expect(largeCache.get('key4999')).toBe('value4999');
    });

    it('should handle concurrent wrap calls with different keys independently', async () => {
      const loader1 = vi.fn().mockResolvedValue('value1');
      const loader2 = vi.fn().mockResolvedValue('value2');

      const [result1, result2] = await Promise.all([
        cache.wrap('key1', { loader: loader1 }),
        cache.wrap('key2', { loader: loader2 }),
      ]);

      expect(result1).toBe('value1');
      expect(result2).toBe('value2');
      expect(loader1).toHaveBeenCalledTimes(1);
      expect(loader2).toHaveBeenCalledTimes(1);
    });

    it('should clean up failed operations', async () => {
      const loader = vi.fn().mockRejectedValue(new Error('Failed'));

      await expect(cache.wrap('key1', { loader })).rejects.toThrow('Failed');

      // Subsequent call should try again
      const loader2 = vi.fn().mockResolvedValue('success');
      const result = await cache.wrap('key1', { loader: loader2 });

      expect(result).toBe('success');
      expect(loader2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Prefix and Budget-based Deletion', () => {
    describe('deleteByPrefix', () => {
      it('should delete entries matching prefix and return count', () => {
        cache.set('transactions:list:budget-123', 'list');
        cache.set('transactions:get:budget-123', 'detail');
        cache.set('accounts:list:budget-123', 'accounts');

        const removed = cache.deleteByPrefix('transactions:');
        expect(removed).toBe(2);
        expect(cache.getKeys()).toEqual(['accounts:list:budget-123']);
      });

      it('should return 0 when no matches found', () => {
        cache.set('accounts:list:budget-123', 'accounts');
        const removed = cache.deleteByPrefix('payments:');
        expect(removed).toBe(0);
        expect(cache.getKeys()).toEqual(['accounts:list:budget-123']);
      });

      it('should handle empty prefix safely', () => {
        cache.set('transactions:list:budget-123', 'list');
        cache.set('accounts:list:budget-123', 'accounts');

        const removed = cache.deleteByPrefix('');
        expect(removed).toBe(0);
        expect(cache.getKeys()).toEqual([
          'transactions:list:budget-123',
          'accounts:list:budget-123',
        ]);
      });

      it("should not delete when prefix only partially matches a resource's namespace", () => {
        cache.set('transactions:list:budget-123', 'list');
        cache.set('accounts:list:budget-123', 'accounts');

        const removed = cache.deleteByPrefix('trans');
        expect(removed).toBe(0);
        expect(cache.getKeys()).toEqual([
          'transactions:list:budget-123',
          'accounts:list:budget-123',
        ]);
      });

      it('should not affect cache hit or miss counters', () => {
        cache.set('transactions:list:budget-123', 'list');
        cache.set('transactions:list:budget-456', 'list');

        const before = cache.getStats();
        cache.deleteByPrefix('transactions:');
        const after = cache.getStats();

        expect(after.hits).toBe(before.hits);
        expect(after.misses).toBe(before.misses);
      });
    });

    describe('deleteByBudgetId', () => {
      it('should delete entries containing the provided budget ID', () => {
        cache.set('transactions:list:budget-123', 'txn');
        cache.set('accounts:list:budget-123', 'acct');
        cache.set('transactions:list:budget-456', 'other');

        const removed = cache.deleteByBudgetId('budget-123');
        expect(removed).toBe(2);
        expect(cache.getKeys()).toEqual(['transactions:list:budget-456']);
      });

      it('should return 0 when budget ID does not exist in cache', () => {
        cache.set('transactions:list:budget-123', 'txn');

        const removed = cache.deleteByBudgetId('budget-999');
        expect(removed).toBe(0);
        expect(cache.getKeys()).toEqual(['transactions:list:budget-123']);
      });

      it('should not match budget IDs that are substrings of other IDs', () => {
        cache.set('transactions:list:budget-123', 'txn');
        cache.set('transactions:list:budget-1234', 'txn2');

        const removed = cache.deleteByBudgetId('budget-1');
        expect(removed).toBe(0);
        expect(cache.getKeys()).toEqual([
          'transactions:list:budget-123',
          'transactions:list:budget-1234',
        ]);
      });

      it('should handle UUID formatted budget identifiers', () => {
        const uuid = '123e4567-e89b-12d3-a456-426614174000';
        cache.set(`transactions:list:${uuid}`, 'txn');
        cache.set(`accounts:list:${uuid}`, 'acct');
        cache.set('transactions:list:budget-456', 'other');

        const removed = cache.deleteByBudgetId(uuid);
        expect(removed).toBe(2);
        expect(cache.getKeys()).toEqual(['transactions:list:budget-456']);
      });

      it('should not affect cache stats when deleting by budget ID', () => {
        cache.set('transactions:list:budget-123', 'txn');
        cache.set('transactions:list:budget-456', 'other');

        const before = cache.getStats();
        cache.deleteByBudgetId('budget-123');
        const after = cache.getStats();

        expect(after.hits).toBe(before.hits);
        expect(after.misses).toBe(before.misses);
      });
    });

    describe('getKeys', () => {
      it('should return an empty array when cache is empty', () => {
        expect(cache.getKeys()).toEqual([]);
      });

      it('should return all cache keys', () => {
        cache.set('accounts:list:budget-123', 'acct');
        cache.set('transactions:list:budget-123', 'txn');
        cache.set('payees:list:budget-123', 'payees');

        expect(cache.getKeys()).toEqual([
          'accounts:list:budget-123',
          'transactions:list:budget-123',
          'payees:list:budget-123',
        ]);
      });

      it('should preserve insertion order of cache keys', () => {
        cache.set('key-a', 'a');
        cache.set('key-b', 'b');
        cache.set('key-c', 'c');

        expect(cache.getKeys()).toEqual(['key-a', 'key-b', 'key-c']);
      });
    });
  });

  describe('Integration with Existing Patterns', () => {
    it('should work with existing tool usage patterns', () => {
      // Simulate existing usage pattern from tools
      const key = CacheManager.generateKey('budgets', 'user123');
      cache.set(key, { budgets: ['budget1', 'budget2'] }, 10 * 60 * 1000);

      const cached = cache.get(key);
      expect(cached).toEqual({ budgets: ['budget1', 'budget2'] });

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.size).toBe(1);
    });

    it('should maintain singleton behavior', async () => {
      // The imported singleton should work consistently
      const { cacheManager } = await import('../cacheManager.js');

      cacheManager.set('singleton-test', 'value');
      expect(cacheManager.get('singleton-test')).toBe('value');

      const stats = cacheManager.getStats();
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
    });
  });
});
