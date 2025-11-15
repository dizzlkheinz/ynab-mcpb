import { CacheManager } from './cacheManager.js';
import globalRequestLogger from './requestLogger.js';
import { ServerKnowledgeStore } from './serverKnowledgeStore.js';

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const LARGE_KNOWLEDGE_GAP_THRESHOLD = 100;

const requestLoggerAdapter: Logger = {
  info(message, meta) {
    globalRequestLogger.logSuccess('delta-cache', message, meta ? { ...meta } : {});
  },
  warn(message, meta) {
    const parameters: Record<string, unknown> = {
      ...(meta ? { ...meta } : {}),
      severity: 'warn',
    };
    globalRequestLogger.logSuccess('delta-cache', message, parameters);
  },
  error(message, meta) {
    const parameters: Record<string, unknown> = meta ? { ...meta } : {};
    const errorField = parameters['error'];
    const errorDetail = typeof errorField === 'string' ? errorField : message;
    globalRequestLogger.logError('delta-cache', message, parameters, errorDetail);
  },
};

/**
 * Options for merge operations
 */
export interface MergeOptions {
  /** Whether to preserve deleted entities (default: false) */
  preserveDeleted?: boolean;
  /**
   * Custom equality function for deduplication.
   *
   * NOTE: The built-in merge functions (mergeFlatEntities, mergeCategories, mergeTransactions)
   * ignore this field and use ID-based equality (`entity.id`). This field is available for
   * caller-supplied custom merge functions that need non-ID-based equality semantics.
   *
   * @example
   * // Custom merge function using equalityFn:
   * const customMerge: MergeFn<MyEntity> = (snapshot, delta, options) => {
   *   const equals = options?.equalityFn || ((a, b) => a.id === b.id);
   *   // Use equals() for custom deduplication logic
   * };
   */
  equalityFn?: (a: unknown, b: unknown) => boolean;
}

export type MergeFn<T> = (snapshot: T[], delta: T[], options?: MergeOptions) => T[];

export interface DeltaFetchResult<T> {
  data: T[];
  wasCached: boolean;
  usedDelta: boolean;
  serverKnowledge: number;
}

export interface DeltaCacheEntry<T> {
  snapshot: T[];
  serverKnowledge: number;
  timestamp: number;
  ttl: number;
  staleWhileRevalidate?: number;
}

export interface DeltaCacheStats {
  deltaHits: number;
  deltaMisses: number;
  mergeOperations: number;
  knowledgeGapEvents: number;
}

type DeltaFetcher<T> = (lastKnowledge?: number) => Promise<{ data: T[]; serverKnowledge: number }>;

/**
 * DeltaCache coordinates cache entries with server knowledge tracking to issue delta-aware requests.
 * The feature is gated by YNAB_MCP_ENABLE_DELTA for safe rollouts.
 */
export class DeltaCache {
  private deltaHits = 0;
  private deltaMisses = 0;
  private mergeOperations = 0;
  private knowledgeGapEvents = 0;

  constructor(
    private readonly cacheManager: CacheManager,
    private readonly knowledgeStore: ServerKnowledgeStore,
    private readonly logger: Logger = requestLoggerAdapter,
  ) {}

  /**
   * Fetch data with optional delta semantics using cached snapshots and merge functions.
   *
   * @param options.ttl - Required TTL in milliseconds. Callers must explicitly specify the appropriate
   *                      resource-specific TTL (e.g., CACHE_TTLS.ACCOUNTS, CACHE_TTLS.CATEGORIES, etc.)
   *                      to ensure each resource type uses correct cache expiration.
   * @param options.staleWhileRevalidate - Optional stale-while-revalidate window in milliseconds.
   *                                        Allows serving stale cache entries while refreshing in background.
   */
  async fetchWithDelta<T extends { deleted?: boolean }>(
    cacheKey: string,
    budgetId: string,
    fetcher: DeltaFetcher<T>,
    merger: MergeFn<T>,
    options: {
      ttl: number;
      forceFullRefresh?: boolean;
      mergeOptions?: MergeOptions;
      staleWhileRevalidate?: number;
    },
  ): Promise<DeltaFetchResult<T>> {
    const effectiveTtl = this.assertFiniteTtl('fetchWithDelta', cacheKey, options.ttl);

    if (!this.isDeltaEnabled()) {
      return this.fetchWithoutDelta(cacheKey, budgetId, fetcher, options);
    }

    const cachedEntry = options.forceFullRefresh
      ? null
      : this.cacheManager.get<DeltaCacheEntry<T>>(cacheKey);
    const lastKnowledge = options.forceFullRefresh ? undefined : this.knowledgeStore.get(cacheKey);
    const canUseDelta = Boolean(
      !options.forceFullRefresh && cachedEntry && lastKnowledge !== undefined,
    );
    const requestedKnowledge = canUseDelta ? lastKnowledge : undefined;

    let response = await fetcher(requestedKnowledge);
    const knowledgeGap =
      requestedKnowledge !== undefined ? response.serverKnowledge - requestedKnowledge : 0;

    let forcedFullRefreshDueToGap = false;

    if (knowledgeGap > LARGE_KNOWLEDGE_GAP_THRESHOLD) {
      this.logger.warn('delta-cache.knowledge-gap', {
        budgetId,
        cacheKey,
        lastKnowledge: requestedKnowledge,
        serverKnowledge: response.serverKnowledge,
        gap: knowledgeGap,
        threshold: LARGE_KNOWLEDGE_GAP_THRESHOLD,
        action: 'full-refresh',
        recommendation: 'Consider forcing a full refresh to resync cache.',
      });
      forcedFullRefreshDueToGap = true;
      this.knowledgeGapEvents++;
      response = await fetcher(undefined);
    }

    const receivedDelta =
      !forcedFullRefreshDueToGap &&
      requestedKnowledge !== undefined &&
      response.serverKnowledge > requestedKnowledge;

    let finalSnapshot: T[];
    let usedDelta = false;

    if (receivedDelta && cachedEntry) {
      this.mergeOperations++;
      finalSnapshot = merger(cachedEntry.snapshot, response.data, options.mergeOptions);
      usedDelta = true;
    } else if (cachedEntry && requestedKnowledge !== undefined && !forcedFullRefreshDueToGap) {
      // No changes were reported, so reuse the cached snapshot
      finalSnapshot = cachedEntry.snapshot;
    } else {
      finalSnapshot = this.filterDeleted(response.data);
    }

    const cacheEntry: DeltaCacheEntry<T> = {
      snapshot: finalSnapshot,
      serverKnowledge: response.serverKnowledge,
      timestamp: Date.now(),
      ttl: effectiveTtl,
    };

    if (options.staleWhileRevalidate !== undefined) {
      cacheEntry.staleWhileRevalidate = options.staleWhileRevalidate;
    }

    const cacheOptions: { ttl: number; staleWhileRevalidate?: number } = {
      ttl: effectiveTtl,
    };
    if (options.staleWhileRevalidate !== undefined) {
      cacheOptions.staleWhileRevalidate = options.staleWhileRevalidate;
    }

    this.cacheManager.set(cacheKey, cacheEntry, cacheOptions);
    this.knowledgeStore.update(cacheKey, response.serverKnowledge);

    if (canUseDelta) {
      this.deltaHits++;
    } else {
      this.deltaMisses++;
    }

    return {
      data: finalSnapshot,
      wasCached: Boolean(cachedEntry),
      usedDelta,
      serverKnowledge: response.serverKnowledge,
    };
  }

  getStats(): DeltaCacheStats {
    return {
      deltaHits: this.deltaHits,
      deltaMisses: this.deltaMisses,
      mergeOperations: this.mergeOperations,
      knowledgeGapEvents: this.knowledgeGapEvents,
    };
  }

  /**
   * Invalidate cached entries for a budget, optionally scoped to a resource type.
   * Does not reset server knowledge to allow graceful follow-up delta requests.
   */
  invalidate(budgetId: string, resourceType?: string): void {
    if (!budgetId) {
      return;
    }

    if (resourceType) {
      const prefix = `${resourceType}:list:${budgetId}`;
      this.cacheManager.deleteByPrefix(prefix);
    } else {
      this.cacheManager.deleteByBudgetId(budgetId);
    }
  }

  /**
   * Force a full refresh by invalidating caches and resetting knowledge entries.
   */
  forceFullRefresh(budgetId?: string, resourceType?: string): void {
    if (budgetId) {
      this.invalidate(budgetId, resourceType);
    } else {
      this.cacheManager.clear();
    }

    if (resourceType && budgetId) {
      this.knowledgeStore.reset(`${resourceType}:list:${budgetId}`);
    } else if (budgetId) {
      this.knowledgeStore.resetByBudgetId(budgetId);
    } else {
      this.knowledgeStore.reset();
    }
  }

  private async fetchWithoutDelta<T extends { deleted?: boolean }>(
    cacheKey: string,
    _budgetId: string,
    fetcher: DeltaFetcher<T>,
    options: { ttl: number; forceFullRefresh?: boolean; staleWhileRevalidate?: number },
  ): Promise<DeltaFetchResult<T>> {
    const effectiveTtl = this.assertFiniteTtl('fetchWithoutDelta', cacheKey, options.ttl);

    const cachedEntry = options.forceFullRefresh
      ? null
      : this.cacheManager.get<DeltaCacheEntry<T>>(cacheKey);
    if (cachedEntry) {
      return {
        data: cachedEntry.snapshot,
        wasCached: true,
        usedDelta: false,
        serverKnowledge: cachedEntry.serverKnowledge,
      };
    }

    const response = await fetcher(undefined);
    const cleanedData = this.filterDeleted(response.data);
    const cacheEntry: DeltaCacheEntry<T> = {
      snapshot: cleanedData,
      serverKnowledge: response.serverKnowledge,
      timestamp: Date.now(),
      ttl: effectiveTtl,
    };

    if (options.staleWhileRevalidate !== undefined) {
      cacheEntry.staleWhileRevalidate = options.staleWhileRevalidate;
    }

    const cacheOptions: { ttl: number; staleWhileRevalidate?: number } = {
      ttl: effectiveTtl,
    };
    if (options.staleWhileRevalidate !== undefined) {
      cacheOptions.staleWhileRevalidate = options.staleWhileRevalidate;
    }

    this.cacheManager.set(cacheKey, cacheEntry, cacheOptions);
    this.knowledgeStore.update(cacheKey, response.serverKnowledge);

    return {
      data: cleanedData,
      wasCached: false,
      usedDelta: false,
      serverKnowledge: response.serverKnowledge,
    };
  }

  private filterDeleted<T extends { deleted?: boolean }>(items: T[]): T[] {
    return items.filter((item) => !item.deleted);
  }

  private assertFiniteTtl(methodName: string, cacheKey: string, ttl: number): number {
    if (!Number.isFinite(ttl)) {
      throw new Error(
        `DeltaCache.${methodName} requires a finite ttl for cache key "${cacheKey}". Received: ${String(ttl)}.`,
      );
    }

    return ttl;
  }

  private isDeltaEnabled(): boolean {
    return process.env['YNAB_MCP_ENABLE_DELTA'] === 'true';
  }
}
