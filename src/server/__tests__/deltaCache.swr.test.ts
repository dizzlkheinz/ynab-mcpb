import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeltaCache, type DeltaCacheEntry, type Logger } from '../deltaCache.js';
import type { CacheManager } from '../cacheManager.js';
import type { ServerKnowledgeStore } from '../serverKnowledgeStore.js';

interface TestEntity {
  id: string;
  name?: string;
  deleted?: boolean;
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
  staleWhileRevalidate?: number,
): DeltaCacheEntry<TestEntity> => {
  const entry: DeltaCacheEntry<TestEntity> = {
    snapshot,
    serverKnowledge,
    timestamp: Date.now(),
    ttl,
  };
  if (staleWhileRevalidate !== undefined) {
    entry.staleWhileRevalidate = staleWhileRevalidate;
  }
  return entry;
};

describe('DeltaCache stale-while-revalidate', () => {
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

  it('should pass staleWhileRevalidate to cache entry when set', async () => {
    const fetcher = createFetcher({ data: [{ id: 'test-1' }], serverKnowledge: 1000 });
    cacheManagerSpies.get.mockReturnValue(null);

    await deltaCache.fetchWithDelta(
      'accounts:list:budget-1',
      'budget-1',
      fetcher,
      createMerger(),
      {
        ttl: 5000,
        staleWhileRevalidate: 2000,
      },
    );

    expect(cacheManagerSpies.set).toHaveBeenCalledWith(
      'accounts:list:budget-1',
      expect.objectContaining({
        snapshot: [{ id: 'test-1' }],
        staleWhileRevalidate: 2000,
      }),
      {
        ttl: 5000,
        staleWhileRevalidate: 2000,
      },
    );
  });

  it('should not set staleWhileRevalidate when omitted', async () => {
    const fetcher = createFetcher({ data: [{ id: 'test-1' }], serverKnowledge: 1000 });
    cacheManagerSpies.get.mockReturnValue(null);

    await deltaCache.fetchWithDelta(
      'accounts:list:budget-1',
      'budget-1',
      fetcher,
      createMerger(),
      {
        ttl: 5000,
      },
    );

    const [, entry, options] = cacheManagerSpies.set.mock.calls[0];
    expect(entry.staleWhileRevalidate).toBeUndefined();
    expect(options).not.toHaveProperty('staleWhileRevalidate');
  });

  it('should pass staleWhileRevalidate when delta is disabled', async () => {
    process.env.YNAB_MCP_ENABLE_DELTA = 'false';
    const fetcher = createFetcher({ data: [{ id: 'test-1' }], serverKnowledge: 1000 });
    cacheManagerSpies.get.mockReturnValue(null);

    await deltaCache.fetchWithDelta(
      'accounts:list:budget-1',
      'budget-1',
      fetcher,
      createMerger(),
      {
        ttl: 5000,
        staleWhileRevalidate: 3000,
      },
    );

    expect(cacheManagerSpies.set).toHaveBeenCalledWith(
      'accounts:list:budget-1',
      expect.objectContaining({
        staleWhileRevalidate: 3000,
      }),
      {
        ttl: 5000,
        staleWhileRevalidate: 3000,
      },
    );
  });

  it('should include staleWhileRevalidate in entry after delta merge', async () => {
    cacheManagerSpies.get.mockReturnValue(createCacheEntry([{ id: 'snap-1' }], 1000));
    knowledgeStoreSpies.get.mockReturnValue(1000);
    const fetcher = createFetcher({ data: [{ id: 'delta-1' }], serverKnowledge: 1010 });

    await deltaCache.fetchWithDelta(
      'transactions:list:budget-1',
      'budget-1',
      fetcher,
      createMerger(),
      {
        ttl: 5000,
        staleWhileRevalidate: 1000,
      },
    );

    const [, entry] = cacheManagerSpies.set.mock.calls[0];
    expect(entry.staleWhileRevalidate).toBe(1000);
  });
});
