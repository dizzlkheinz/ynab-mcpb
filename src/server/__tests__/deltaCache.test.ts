import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeltaCache, type DeltaCacheEntry, type Logger } from '../deltaCache.js';
import type { CacheManager } from '../cacheManager.js';
import type { ServerKnowledgeStore } from '../serverKnowledgeStore.js';

interface TestEntity {
  id: string;
  name?: string;
  deleted?: boolean;
  subtransactions?: TestEntity[];
}

interface CacheManagerSpies {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  deleteByPrefix: ReturnType<typeof vi.fn>;
  deleteByBudgetId: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

interface KnowledgeStoreSpies {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  resetByBudgetId: ReturnType<typeof vi.fn>;
}

const createCacheEntry = (
  snapshot: TestEntity[] = [{ id: 'snap-1' }],
  serverKnowledge = 1000,
  ttl = 5000,
): DeltaCacheEntry<TestEntity> => ({
  snapshot,
  serverKnowledge,
  timestamp: Date.now(),
  ttl,
});

describe('DeltaCache', () => {
  let cacheManagerSpies: CacheManagerSpies;
  let knowledgeStoreSpies: KnowledgeStoreSpies;
  let loggerSpies: Logger;
  let cacheManagerMock: CacheManager;
  let knowledgeStoreMock: ServerKnowledgeStore;
  let deltaCache: DeltaCache;

  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    cacheManagerSpies = {
      get: vi.fn(),
      set: vi.fn(),
      deleteByPrefix: vi.fn(),
      deleteByBudgetId: vi.fn(),
      clear: vi.fn(),
    };
    knowledgeStoreSpies = {
      get: vi.fn(),
      update: vi.fn(),
      reset: vi.fn(),
      resetByBudgetId: vi.fn(),
    };
    loggerSpies = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    cacheManagerMock = cacheManagerSpies as unknown as CacheManager;
    knowledgeStoreMock = knowledgeStoreSpies as unknown as ServerKnowledgeStore;
    process.env.YNAB_MCP_ENABLE_DELTA = 'true';
    deltaCache = new DeltaCache(cacheManagerMock, knowledgeStoreMock, loggerSpies);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.YNAB_MCP_ENABLE_DELTA;
  });

  const createFetcher = (
    response: { data: TestEntity[]; serverKnowledge: number },
  ) => vi.fn().mockResolvedValue(response);

  const createMerger = () =>
    vi.fn<[TestEntity[], TestEntity[], unknown?], TestEntity[]>().mockImplementation(
      (snapshot: TestEntity[], delta: TestEntity[]) => [...snapshot, ...delta],
    );

  describe('Feature Flag', () => {
    it('should use delta path when the feature flag is enabled', async () => {
      cacheManagerSpies.get.mockReturnValue(
        createCacheEntry([{ id: 'snap-1' }], 1000),
      );
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'delta-1' }], serverKnowledge: 1010 });
      const merger = createMerger();

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        merger,
        { ttl: 5000 },
      );

      expect(fetcher).toHaveBeenCalledWith(1000);
      expect(merger).toHaveBeenCalledTimes(1);
      expect(result.usedDelta).toBe(true);
    });

    it('should bypass delta logic when flag is disabled', async () => {
      process.env.YNAB_MCP_ENABLE_DELTA = 'false';
      cacheManagerSpies.get.mockReturnValue(null); // No cache - force fetch
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'full' }], serverKnowledge: 1100 });
      const merger = createMerger();

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        merger,
        { ttl: 5000 },
      );

      expect(fetcher).toHaveBeenCalledWith(undefined);
      expect(merger).not.toHaveBeenCalled();
      expect(result.usedDelta).toBe(false);
    });

    it('should still cache results when delta is disabled', async () => {
      process.env.YNAB_MCP_ENABLE_DELTA = 'false';
      const fetcher = createFetcher({ data: [{ id: 'full' }], serverKnowledge: 1100 });
      cacheManagerSpies.get.mockReturnValue(null);

      await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(cacheManagerSpies.set).toHaveBeenCalledTimes(1);
      const [key, entry] = cacheManagerSpies.set.mock.calls[0];
      expect(key).toBe('transactions:list:budget-1');
      expect(entry.snapshot).toEqual([{ id: 'full' }]);
    });
  });

  describe('Delta Detection', () => {
    it('should detect delta when server knowledge increases', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'delta' }], serverKnowledge: 1010 });
      const merger = createMerger();

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        merger,
        { ttl: 5000 },
      );

      expect(result.usedDelta).toBe(true);
      expect(merger).toHaveBeenCalledWith(
        [{ id: 'snap' }],
        [{ id: 'delta' }],
        undefined,
      );
    });

    it('should treat response as unchanged when knowledge stays equal', async () => {
      const cachedEntry = createCacheEntry([{ id: 'snap' }], 1000);
      cacheManagerSpies.get.mockReturnValue(cachedEntry);
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [], serverKnowledge: 1000 });

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(result.data).toEqual([{ id: 'snap' }]);
      expect(result.usedDelta).toBe(false);
    });

    it('should treat cache miss as full refresh', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      knowledgeStoreSpies.get.mockReturnValue(undefined);
      const fetcher = createFetcher({
        data: [
          { id: 'kept' },
          { id: 'deleted', deleted: true },
        ],
        serverKnowledge: 1050,
      });

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(result.usedDelta).toBe(false);
      expect(result.data).toEqual([{ id: 'kept' }]);
    });

    it('should use merger when delta detected and cache exists', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'a' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'b' }], serverKnowledge: 1010 });
      const merger = createMerger();
      merger.mockReturnValue([{ id: 'a' }, { id: 'b' }]);

      const result = await deltaCache.fetchWithDelta(
        'categories:list:budget-1',
        'budget-1',
        fetcher,
        merger,
        { ttl: 5000 },
      );

      expect(merger).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('should filter deleted entities on full refresh', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = createFetcher({
        data: [
          { id: '1' },
          { id: '2', deleted: true },
        ],
        serverKnowledge: 2000,
      });

      const result = await deltaCache.fetchWithDelta(
        'payees:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(result.data).toEqual([{ id: '1' }]);
      expect(result.usedDelta).toBe(false);
    });

    it('should handle initial fetch with no cache or knowledge', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      knowledgeStoreSpies.get.mockReturnValue(undefined);
      const fetcher = createFetcher({ data: [{ id: 'a' }], serverKnowledge: 5 });

      const result = await deltaCache.fetchWithDelta(
        'accounts:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(result.wasCached).toBe(false);
      expect(result.usedDelta).toBe(false);
      expect(result.serverKnowledge).toBe(5);
    });
  });

  describe('Knowledge Gap Warnings', () => {
    it('should log warning when knowledge gap exceeds threshold', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'delta' }], serverKnowledge: 1205 });

      await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(loggerSpies.warn).toHaveBeenCalledWith(
        'delta-cache.knowledge-gap',
        expect.objectContaining({
          budgetId: 'budget-1',
          lastKnowledge: 1000,
          serverKnowledge: 1205,
          gap: 205,
        }),
      );
    });

    it('should not log warning when gap is within tolerance', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [], serverKnowledge: 1050 });

      await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(loggerSpies.warn).not.toHaveBeenCalled();
    });

    it('should include cacheKey in warning metadata', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'delta' }], serverKnowledge: 1155 });

      await deltaCache.fetchWithDelta('payees:list:budget-xyz', 'budget-xyz', fetcher, createMerger(), {
        ttl: 5000,
      });

      expect(loggerSpies.warn).toHaveBeenCalledWith(
        'delta-cache.knowledge-gap',
        expect.objectContaining({
          cacheKey: 'payees:list:budget-xyz',
          budgetId: 'budget-xyz',
        }),
      );
    });

    it('should continue processing even after warning', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'delta' }], serverKnowledge: 1300 });

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      // When knowledge gap > 100, a full refresh is triggered, so cached snapshot is discarded
      expect(result.data).toEqual([{ id: 'delta' }]);
      expect(loggerSpies.warn).toHaveBeenCalledWith(
        'delta-cache.knowledge-gap',
        expect.objectContaining({
          gap: 300,
          action: 'full-refresh',
        }),
      );
    });
  });

  describe('Cache Operations', () => {
    it('should store entries in cache manager format', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = createFetcher({ data: [{ id: 'fresh' }], serverKnowledge: 101 });

      await deltaCache.fetchWithDelta('accounts:list:budget-1', 'budget-1', fetcher, createMerger(), {
        ttl: 1234,
      });

      expect(cacheManagerSpies.set).toHaveBeenCalledWith(
        'accounts:list:budget-1',
        expect.objectContaining({
          snapshot: [{ id: 'fresh' }],
          serverKnowledge: 101,
          ttl: 1234,
        }),
        { ttl: 1234 },
      );
    });

    it('should update knowledge store after fetch', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = createFetcher({ data: [{ id: 'item' }], serverKnowledge: 222 });

      await deltaCache.fetchWithDelta('accounts:list:budget-1', 'budget-1', fetcher, createMerger(), {
        ttl: 5000,
      });

      expect(knowledgeStoreSpies.update).toHaveBeenCalledWith(
        'accounts:list:budget-1',
        222,
      );
    });

    it('should return cached data on cache hit', async () => {
      const entry = createCacheEntry([{ id: 'cached' }], 333);
      cacheManagerSpies.get.mockReturnValue(entry);
      knowledgeStoreSpies.get.mockReturnValue(333);
      const fetcher = createFetcher({ data: [], serverKnowledge: 333 });

      const result = await deltaCache.fetchWithDelta('accounts:list:budget-1', 'budget-1', fetcher, createMerger(), { ttl: 5000 });

      expect(result.wasCached).toBe(true);
      expect(result.data).toEqual([{ id: 'cached' }]);
    });

    it('should respect custom TTL overrides', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = createFetcher({ data: [{ id: 'fresh' }], serverKnowledge: 400 });

      await deltaCache.fetchWithDelta('accounts:list:budget-1', 'budget-1', fetcher, createMerger(), {
        ttl: 9999,
      });

      expect(cacheManagerSpies.set).toHaveBeenCalledWith(
        'accounts:list:budget-1',
        expect.objectContaining({ ttl: 9999 }),
        { ttl: 9999 },
      );
    });

    it('should bypass cache and knowledge when forceFullRefresh is true', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'cached' }], 500));
      knowledgeStoreSpies.get.mockReturnValue(500);
      const fetcher = createFetcher({ data: [{ id: 'fresh' }], serverKnowledge: 600 });

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        {
          ttl: 5000,
          forceFullRefresh: true,
        },
      );

      expect(result.wasCached).toBe(false);
      expect(result.usedDelta).toBe(false);
      expect(fetcher).toHaveBeenCalledWith(undefined);
    });
  });

  describe('Merge Options', () => {
    it('should pass merge options to merger', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'cached' }], 100));
      knowledgeStoreSpies.get.mockReturnValue(100);
      const fetcher = createFetcher({ data: [{ id: 'delta' }], serverKnowledge: 200 });
      const merger = createMerger();
      const mergeOptions = { preserveDeleted: true, equalityFn: vi.fn() };

      await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        merger,
        {
          ttl: 5000,
          mergeOptions,
        },
      );

      expect(merger).toHaveBeenCalledWith(
        [{ id: 'cached' }],
        [{ id: 'delta' }],
        mergeOptions,
      );
    });

    it('should allow preserveDeleted to keep deleted entities after merge', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'cached' }], 100));
      knowledgeStoreSpies.get.mockReturnValue(100);
      const fetcher = createFetcher({
        data: [{ id: 'delta', deleted: true }],
        serverKnowledge: 200,
      });
      const merger = vi.fn().mockReturnValue([{ id: 'cached' }, { id: 'delta', deleted: true }]);

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        merger,
        {
          ttl: 5000,
          mergeOptions: { preserveDeleted: true },
        },
      );

      expect(result.data).toEqual([{ id: 'cached' }, { id: 'delta', deleted: true }]);
    });

    it('should support custom equality functions via merge options', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'cached' }], 100));
      knowledgeStoreSpies.get.mockReturnValue(100);
      const fetcher = createFetcher({ data: [{ id: 'delta' }], serverKnowledge: 200 });
      const equalityFn = vi.fn();
      const merger = createMerger();

      await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        merger,
        {
          ttl: 5000,
          mergeOptions: { equalityFn },
        },
      );

      expect(merger).toHaveBeenCalledWith(
        [{ id: 'cached' }],
        [{ id: 'delta' }],
        expect.objectContaining({ equalityFn }),
      );
    });
  });

  describe('Invalidation', () => {
    it('should delete by prefix when resource type provided', () => {
      deltaCache.invalidate('budget-123', 'transactions');
      expect(cacheManagerSpies.deleteByPrefix).toHaveBeenCalledWith('transactions:list:budget-123');
    });

    it('should delete by budget when resource type omitted', () => {
      deltaCache.invalidate('budget-123');
      expect(cacheManagerSpies.deleteByBudgetId).toHaveBeenCalledWith('budget-123');
    });

    it('should not reset knowledge on invalidate', () => {
      deltaCache.invalidate('budget-123');
      expect(knowledgeStoreSpies.reset).not.toHaveBeenCalled();
      expect(knowledgeStoreSpies.resetByBudgetId).not.toHaveBeenCalled();
    });

    it('should reset targeted knowledge during forceFullRefresh', () => {
      deltaCache.forceFullRefresh('budget-123', 'transactions');
      expect(cacheManagerSpies.deleteByPrefix).toHaveBeenCalledWith('transactions:list:budget-123');
      expect(knowledgeStoreSpies.reset).toHaveBeenCalledWith('transactions:list:budget-123');
    });

    it('should reset entire budget knowledge on forceFullRefresh without resource type', () => {
      deltaCache.forceFullRefresh('budget-123');
      expect(knowledgeStoreSpies.resetByBudgetId).toHaveBeenCalledWith('budget-123');
    });

    it('should support global forceFullRefresh without budgetId', () => {
      deltaCache.forceFullRefresh();
      expect(cacheManagerSpies.clear).toHaveBeenCalledTimes(1);
      expect(knowledgeStoreSpies.reset).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should propagate fetcher errors without caching', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = vi.fn().mockRejectedValue(new Error('API down'));

      await expect(
        deltaCache.fetchWithDelta('transactions:list:budget-1', 'budget-1', fetcher, createMerger(), {
          ttl: 5000,
        }),
      ).rejects.toThrow('API down');

      expect(cacheManagerSpies.set).not.toHaveBeenCalled();
      expect(knowledgeStoreSpies.update).not.toHaveBeenCalled();
    });

    it('should propagate merger errors', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'delta' }], serverKnowledge: 1010 });
      const merger = vi.fn().mockImplementation(() => {
        throw new Error('merge failed');
      });

      await expect(
        deltaCache.fetchWithDelta('transactions:list:budget-1', 'budget-1', fetcher, merger, {
          ttl: 5000,
        }),
      ).rejects.toThrow('merge failed');

      expect(cacheManagerSpies.set).not.toHaveBeenCalled();
      expect(knowledgeStoreSpies.update).not.toHaveBeenCalled();
    });

    it('should not cache when fetch fails before delta detection', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = vi.fn().mockRejectedValue(new Error('boom'));

      await expect(
        deltaCache.fetchWithDelta('accounts:list:budget-1', 'budget-1', fetcher, createMerger(), {
          ttl: 5000,
        }),
      ).rejects.toThrow('boom');

      expect(cacheManagerSpies.set).not.toHaveBeenCalled();
    });

    it('should not update knowledge when fetch fails', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = vi.fn().mockRejectedValue(new Error('boom'));

      await expect(
        deltaCache.fetchWithDelta('accounts:list:budget-1', 'budget-1', fetcher, createMerger(), {
          ttl: 5000,
        }),
      ).rejects.toThrow();

      expect(knowledgeStoreSpies.update).not.toHaveBeenCalled();
    });
  });

  describe('Result Metadata', () => {
    it('should mark wasCached true on cache hits', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [], serverKnowledge: 1000 });

      const result = await deltaCache.fetchWithDelta(
        'accounts:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(result.wasCached).toBe(true);
      expect(result.usedDelta).toBe(false);
    });

    it('should mark wasCached false when cache misses', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = createFetcher({ data: [{ id: 'fresh' }], serverKnowledge: 50 });

      const result = await deltaCache.fetchWithDelta(
        'accounts:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(result.wasCached).toBe(false);
    });

    it('should mark usedDelta true when merge applied', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'delta' }], serverKnowledge: 1005 });

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(result.usedDelta).toBe(true);
    });

    it('should mark usedDelta false when no merge happens', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = createFetcher({ data: [{ id: 'fresh' }], serverKnowledge: 100 });

      const result = await deltaCache.fetchWithDelta(
        'transactions:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(result.usedDelta).toBe(false);
    });
  });

  describe('Stats tracking', () => {
    it('increments deltaHits and mergeOperations when delta merge occurs', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      const fetcher = createFetcher({ data: [{ id: 'delta' }], serverKnowledge: 1005 });
      const merger = createMerger();

      await deltaCache.fetchWithDelta('accounts:list:budget-1', 'budget-1', fetcher, merger, {
        ttl: 5000,
      });

      expect(deltaCache.getStats()).toEqual({
        deltaHits: 1,
        deltaMisses: 0,
        mergeOperations: 1,
        knowledgeGapEvents: 0,
      });
    });

    it('increments deltaMisses when full refresh is required', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = createFetcher({ data: [{ id: 'fresh' }], serverKnowledge: 50 });

      await deltaCache.fetchWithDelta('accounts:list:budget-1', 'budget-1', fetcher, createMerger(), {
        ttl: 5000,
      });

      expect(deltaCache.getStats()).toEqual({
        deltaHits: 0,
        deltaMisses: 1,
        mergeOperations: 0,
        knowledgeGapEvents: 0,
      });
    });

    it('tracks knowledge gap events and treats them as hits', async () => {
      cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap' }], 1000));
      knowledgeStoreSpies.get.mockReturnValue(1000);
      // Two responses required: first triggers gap detection (205 > threshold),
      // second is the full refresh that follows gap detection
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce({ data: [{ id: 'delta' }], serverKnowledge: 1205 })
        .mockResolvedValueOnce({ data: [{ id: 'full' }], serverKnowledge: 1205 });

      await deltaCache.fetchWithDelta(
        'accounts:list:budget-1',
        'budget-1',
        fetcher,
        createMerger(),
        { ttl: 5000 },
      );

      expect(deltaCache.getStats()).toEqual({
        deltaHits: 1,
        deltaMisses: 0,
        mergeOperations: 0,
        knowledgeGapEvents: 1,
      });
    });
  });

  describe('TTL Validation', () => {
    it('should throw when ttl is missing for fetchWithDelta', async () => {
      cacheManagerSpies.get.mockReturnValue(null);
      const fetcher = createFetcher({ data: [{ id: 'fresh' }], serverKnowledge: 1 });

      await expect(
        deltaCache.fetchWithDelta(
          'accounts:list:budget-1',
          'budget-1',
          fetcher,
          createMerger(),
          {
            ttl: undefined as unknown as number,
          },
        ),
      ).rejects.toThrow(/finite ttl/i);
    });

    it('should throw when ttl is not finite for fetchWithoutDelta', async () => {
      const fetchWithoutDelta = (deltaCache as any).fetchWithoutDelta.bind(deltaCache);

      await expect(
        fetchWithoutDelta(
          'accounts:list:budget-1',
          'budget-1',
          createFetcher({ data: [{ id: 'fresh' }], serverKnowledge: 1 }),
          { ttl: Number.POSITIVE_INFINITY },
        ),
      ).rejects.toThrow(/finite ttl/i);
    });
  });
});
