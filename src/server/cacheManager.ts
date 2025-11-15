/**
 * Cache Manager for YNAB API responses
 * Provides in-memory caching with TTL to reduce API calls and improve performance
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  staleWhileRevalidate?: number;
}

interface CacheSetOptions {
  ttl?: number;
  /**
   * Stale-while-revalidate window in milliseconds.
   * When explicitly set to undefined, uses the default stale window.
   * When omitted entirely, no stale-while-revalidate is applied.
   */
  staleWhileRevalidate?: number;
}

export class CacheManager {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTTL: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private lastCleanup: number | null = null;
  private maxEntries: number;
  private defaultStaleWindow: number;
  private pendingFetches = new Map<string, Promise<unknown>>();
  private pendingRefresh = new Set<string>();

  constructor() {
    this.maxEntries = this.parseEnvInt('YNAB_MCP_CACHE_MAX_ENTRIES', 1000);
    this.defaultStaleWindow = this.parseEnvInt('YNAB_MCP_CACHE_STALE_MS', 2 * 60 * 1000);
    this.defaultTTL = this.parseEnvInt('YNAB_MCP_CACHE_DEFAULT_TTL_MS', 300000);
  }

  /**
   * Get cached data if valid, null if expired or not found
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    // Check if entry is expired
    if (age > entry.ttl) {
      // Check if we're within stale-while-revalidate window
      const staleWindow = entry.staleWhileRevalidate || 0;
      if (staleWindow > 0 && age <= entry.ttl + staleWindow) {
        this.hits++;
        // Update access order for LRU
        this.cache.delete(key);
        this.cache.set(key, entry);
        // Mark for background refresh
        this.pendingRefresh.add(key);
        return entry.data as T;
      }

      this.cache.delete(key);
      this.pendingFetches.delete(key);
      this.pendingRefresh.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    // Update access order for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  /**
   * Check if a valid cache entry exists without updating hit/miss counters
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    const age = now - entry.timestamp;
    if (age > entry.ttl) {
      const staleWindow = entry.staleWhileRevalidate || 0;
      if (staleWindow > 0 && age <= entry.ttl + staleWindow) {
        return true;
      }

      this.cache.delete(key);
      this.pendingFetches.delete(key);
      this.pendingRefresh.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Set cache entry with optional TTL or options
   *
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttlOrOptions - TTL in milliseconds (number) or options object
   *
   * Note: Default stale-while-revalidate window is applied only when:
   * - An options object is provided AND
   * - The staleWhileRevalidate property is explicitly present (even if undefined)
   *
   * When using the simple number interface or when staleWhileRevalidate property
   * is not present in the options object, no default stale window is applied.
   */
  set<T>(key: string, data: T, ttlOrOptions?: number | CacheSetOptions): void {
    // Don't cache anything if maxEntries is 0
    if (this.maxEntries <= 0) {
      return;
    }

    const isUpdate = this.cache.has(key);
    if (!isUpdate) {
      this.evictIfNeeded();
    }

    let ttl: number;
    let staleWhileRevalidate: number | undefined;

    if (typeof ttlOrOptions === 'number') {
      ttl = Number.isFinite(ttlOrOptions) ? ttlOrOptions : this.defaultTTL;
      // When using simple number interface, no stale window is applied
      staleWhileRevalidate = undefined;
    } else if (ttlOrOptions === undefined) {
      // When called without any options (simple set), use defaults but NO stale window
      ttl = this.defaultTTL;
      staleWhileRevalidate = undefined;
    } else {
      const providedTtl = ttlOrOptions?.ttl;
      ttl = providedTtl !== undefined ? providedTtl : this.defaultTTL;
      if (ttlOrOptions && 'staleWhileRevalidate' in ttlOrOptions) {
        staleWhileRevalidate = ttlOrOptions.staleWhileRevalidate;
      } else {
        staleWhileRevalidate = ttlOrOptions?.staleWhileRevalidate;
      }
      // Apply default stale window only when options object is provided and staleWhileRevalidate is undefined
      if (staleWhileRevalidate === undefined && this.defaultStaleWindow > 0) {
        staleWhileRevalidate = this.defaultStaleWindow;
      }
    }
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    };
    if (staleWhileRevalidate !== undefined) {
      entry.staleWhileRevalidate = staleWhileRevalidate;
    }

    if (isUpdate) {
      // When updating, delete then set to preserve MRU ordering
      this.cache.delete(key);
    }
    this.cache.set(key, entry);
    // Clear any pending operations since we have fresh data
    this.pendingFetches.delete(key);
    this.pendingRefresh.delete(key);
  }

  /**
   * Clear specific cache entry
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.pendingFetches.delete(key);
      this.pendingRefresh.delete(key);
    }
    return deleted;
  }

  /**
   * Delete multiple cache entries in a single operation
   */
  deleteMany(keys: Iterable<string>): void {
    for (const key of keys) {
      this.cache.delete(key);
      this.pendingFetches.delete(key);
      this.pendingRefresh.delete(key);
    }
  }

  /**
   * Delete cache entries whose keys begin with the provided prefix.
   * Useful for invalidating a specific resource type across budgets.
   *
   * @param prefix - Cache key prefix (e.g., 'transactions:' or 'accounts:list:')
   * @returns The number of entries removed
   */
  deleteByPrefix(prefix: string): number {
    if (!prefix) {
      return 0;
    }

    const normalizedPrefix = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix;
    const prefixWithColon = `${normalizedPrefix}:`;

    let removed = 0;
    for (const key of this.cache.keys()) {
      if (key === normalizedPrefix || key.startsWith(prefixWithColon)) {
        this.cache.delete(key);
        this.pendingFetches.delete(key);
        this.pendingRefresh.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Delete cache entries that belong to a specific budget.
   * Matches keys containing the budget ID (e.g., '...:budget-123:...').
   *
   * @param budgetId - Budget identifier to match
   */
  deleteByBudgetId(budgetId: string): number {
    if (!budgetId) {
      return 0;
    }

    let removed = 0;
    for (const key of this.cache.keys()) {
      const segments = key.split(':');
      if (segments.some((segment) => segment === budgetId)) {
        this.cache.delete(key);
        this.pendingFetches.delete(key);
        this.pendingRefresh.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Return all cache keys for debugging and diagnostics.
   *
   * @returns Snapshot of cache keys in insertion order
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.lastCleanup = null;
    this.pendingFetches.clear();
    this.pendingRefresh.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    keys: string[];
    hits: number;
    misses: number;
    evictions: number;
    lastCleanup: number | null;
    maxEntries: number;
    hitRate: number;
  } {
    const totalRequests = this.hits + this.misses;
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      lastCleanup: this.lastCleanup,
      maxEntries: this.maxEntries,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
    };
  }

  /**
   * Provide a filtered snapshot for cache size estimation without exposing expired entries.
   */
  getEntriesForSizeEstimation(): [string, CacheEntry<unknown>][] {
    const now = Date.now();
    return Array.from(this.cache.entries()).filter(
      ([, entry]) => now - entry.timestamp <= entry.ttl,
    );
  }

  /**
   * Get lightweight cache metadata for size estimation without full entry data.
   * Returns summaries with keys, timestamps, and TTLs for estimating memory usage.
   */
  getCacheMetadata(): {
    key: string;
    timestamp: number;
    ttl: number;
    staleWhileRevalidate?: number;
    dataType: string;
    isExpired: boolean;
  }[] {
    const now = Date.now();
    return Array.from(this.cache.entries()).map(([key, entry]) => {
      const metadata: {
        key: string;
        timestamp: number;
        ttl: number;
        staleWhileRevalidate?: number;
        dataType: string;
        isExpired: boolean;
      } = {
        key,
        timestamp: entry.timestamp,
        ttl: entry.ttl,
        dataType: typeof entry.data,
        isExpired: now - entry.timestamp > entry.ttl,
      };
      if (entry.staleWhileRevalidate !== undefined) {
        metadata.staleWhileRevalidate = entry.staleWhileRevalidate;
      }
      return metadata;
    });
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const result = this.cleanupDetailed();
    return result.cleaned;
  }

  /**
   * Clean up expired entries with detailed information
   */
  cleanupDetailed(): { cleaned: number; evictions: number } {
    const now = Date.now();
    let cleaned = 0;
    const initialEvictions = this.evictions;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        this.pendingFetches.delete(key);
        this.pendingRefresh.delete(key);
        cleaned++;
        this.evictions++;
      }
    }

    this.lastCleanup = now;
    return { cleaned, evictions: this.evictions - initialEvictions };
  }

  /**
   * Wrap a loader function with caching and concurrent deduplication
   */
  async wrap<T>(key: string, options: CacheSetOptions & { loader: () => Promise<T> }): Promise<T> {
    // Check cache first and preserve existing entry for background refresh
    const existingEntry = this.cache.get(key);
    const cached = this.get<T>(key);
    if (cached !== null) {
      // Check if this key was marked for background refresh (stale-while-revalidate)
      if (this.pendingRefresh.has(key) && !this.pendingFetches.has(key)) {
        // Start background refresh
        const refreshPromise = options.loader().then(
          (result) => {
            // Preserve existing TTL/SWR if not specified in options
            const refreshOptions: CacheSetOptions = {};
            const ttl = options.ttl ?? existingEntry?.ttl;
            if (ttl !== undefined) {
              refreshOptions.ttl = ttl;
            }
            const staleWhileRevalidate =
              options.staleWhileRevalidate ?? existingEntry?.staleWhileRevalidate;
            if (staleWhileRevalidate !== undefined) {
              refreshOptions.staleWhileRevalidate = staleWhileRevalidate;
            }
            // Cache the successful result
            this.set(key, result, refreshOptions);
            // Clean up
            this.pendingFetches.delete(key);
            this.pendingRefresh.delete(key);
            return result;
          },
          (error) => {
            // Clean up on error
            this.pendingFetches.delete(key);
            this.pendingRefresh.delete(key);
            throw error;
          },
        );
        this.pendingFetches.set(key, refreshPromise);
      }
      return cached;
    }

    // Check if there's already a pending fetch for this key
    const existingFetch = this.pendingFetches.get(key) as Promise<T> | undefined;
    if (existingFetch) {
      return existingFetch;
    }

    // Execute the loader
    const fetchPromise = options.loader().then(
      (result) => {
        // Cache the successful result using provided options (no existing entry to preserve)
        this.set(key, result, options);
        // Clean up pending fetch
        this.pendingFetches.delete(key);
        this.pendingRefresh.delete(key);
        return result;
      },
      (error) => {
        // Clean up on error, don't cache failures
        this.pendingFetches.delete(key);
        this.pendingRefresh.delete(key);
        throw error;
      },
    );

    // Store the pending fetch
    this.pendingFetches.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Evict least recently used entries if cache is at capacity
   */
  private evictIfNeeded(): void {
    if (this.maxEntries <= 0) return;

    while (this.cache.size >= this.maxEntries) {
      // Get the first (oldest) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        this.pendingFetches.delete(firstKey);
        this.pendingRefresh.delete(firstKey);
        this.evictions++;
      } else {
        break;
      }
    }
  }

  /**
   * Parse environment variable as integer with fallback
   */
  private parseEnvInt(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) return defaultValue;

    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Generate cache key from parameters
   */
  static generateKey(prefix: string, ...params: (string | number | boolean | undefined)[]): string {
    const cleanParams = params
      .filter((p) => p !== undefined)
      .map((p) => String(p))
      .join(':');

    return `${prefix}:${cleanParams}`;
  }
}

// Cache TTL configurations for different data types
export const CACHE_TTLS = {
  BUDGETS: 10 * 60 * 1000, // 10 minutes - budgets don't change often
  ACCOUNTS: 5 * 60 * 1000, // 5 minutes - account info is fairly static
  CATEGORIES: 5 * 60 * 1000, // 5 minutes - categories change infrequently
  PAYEES: 10 * 60 * 1000, // 10 minutes - payees are relatively stable
  TRANSACTIONS: 2 * 60 * 1000, // 2 minutes - transactions change more frequently
  SCHEDULED_TRANSACTIONS: 5 * 60 * 1000, // 5 minutes - scheduled transactions rarely change rapidly
  USER_INFO: 30 * 60 * 1000, // 30 minutes - user info rarely changes
  MONTHS: 5 * 60 * 1000, // 5 minutes - month data changes with new transactions
} as const;

// Singleton cache manager instance
export const cacheManager = new CacheManager();
