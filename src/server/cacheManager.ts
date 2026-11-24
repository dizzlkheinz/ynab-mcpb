/**
 * Cache Manager for YNAB API responses
 * Provides in-memory LRU caching with TTL and concurrent request deduplication.
 */

interface CacheEntry<T> {
	data: T;
	timestamp: number;
	ttl: number;
}

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface CacheManagerOptions {
	maxEntries?: number;
	defaultTtlMs?: number;
}

export class CacheManager {
	private cache = new Map<string, CacheEntry<unknown>>();
	private readonly defaultTTL: number;
	private hits = 0;
	private misses = 0;
	private evictions = 0;
	private maxEntries: number;
	private pendingFetches = new Map<string, Promise<unknown>>();

	constructor(options: CacheManagerOptions = {}) {
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		this.defaultTTL = options.defaultTtlMs ?? DEFAULT_TTL_MS;
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

		if (Date.now() - entry.timestamp > entry.ttl) {
			this.cache.delete(key);
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

		if (Date.now() - entry.timestamp > entry.ttl) {
			this.cache.delete(key);
			return false;
		}

		return true;
	}

	/**
	 * Set cache entry with optional TTL in milliseconds
	 */
	set<T>(key: string, data: T, ttl?: number): void {
		if (this.maxEntries <= 0) {
			return;
		}

		const isUpdate = this.cache.has(key);
		if (!isUpdate) {
			this.evictIfNeeded();
		}

		const resolvedTtl =
			typeof ttl === "number" && Number.isFinite(ttl) ? ttl : this.defaultTTL;
		const entry: CacheEntry<T> = {
			data,
			timestamp: Date.now(),
			ttl: resolvedTtl,
		};

		if (isUpdate) {
			// When updating, delete then set to preserve MRU ordering
			this.cache.delete(key);
		}
		this.cache.set(key, entry);
		this.pendingFetches.delete(key);
	}

	/**
	 * Clear specific cache entry
	 */
	delete(key: string): boolean {
		const deleted = this.cache.delete(key);
		// A first load may still be pending without a cached entry. Removing its
		// identity also prevents that older read from publishing after a write.
		this.pendingFetches.delete(key);
		return deleted;
	}

	/**
	 * Delete multiple cache entries in a single operation
	 */
	deleteMany(keys: Iterable<string>): void {
		for (const key of keys) {
			this.cache.delete(key);
			this.pendingFetches.delete(key);
		}
	}

	/**
	 * Delete cache entries that belong to a specific budget.
	 * Matches keys containing the budget ID (e.g., '...:budget-123:...').
	 */
	deleteByBudgetId(budgetId: string): number {
		if (!budgetId) {
			return 0;
		}

		let removed = 0;
		for (const key of new Set([
			...this.cache.keys(),
			...this.pendingFetches.keys(),
		])) {
			const segments = key.split(":");
			if (segments.some((segment) => segment === budgetId)) {
				this.cache.delete(key);
				this.pendingFetches.delete(key);
				removed++;
			}
		}
		return removed;
	}

	/** Retain an expired snapshot for a delta refresh without serving it as fresh. */
	peek<T>(key: string): T | undefined {
		return this.cache.get(key)?.data as T | undefined;
	}

	/**
	 * Clear all cache entries
	 */
	clear(): void {
		this.cache.clear();
		this.hits = 0;
		this.misses = 0;
		this.evictions = 0;
		this.pendingFetches.clear();
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
			maxEntries: this.maxEntries,
			hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
		};
	}

	/**
	 * Get lightweight cache metadata for size estimation without full entry data.
	 */
	getCacheMetadata(): {
		key: string;
		timestamp: number;
		ttl: number;
		dataType: string;
		isExpired: boolean;
	}[] {
		const now = Date.now();
		return Array.from(this.cache.entries()).map(([key, entry]) => ({
			key,
			timestamp: entry.timestamp,
			ttl: entry.ttl,
			dataType: typeof entry.data,
			isExpired: now - entry.timestamp > entry.ttl,
		}));
	}

	/**
	 * Wrap a loader with caching and concurrent deduplication.
	 *
	 * `revalidate` always runs the loader, even over a fresh entry, while keeping
	 * deduplication and the guard against publishing after invalidation.
	 */
	async wrap<T>(
		key: string,
		options: {
			ttl?: number;
			loader: () => Promise<T>;
			revalidate?: boolean;
		},
	): Promise<T> {
		if (!options.revalidate) {
			const cached = this.get<T>(key);
			if (cached !== null) {
				return cached;
			}
		}

		const existingFetch = this.pendingFetches.get(key) as
			| Promise<T>
			| undefined;
		if (existingFetch) {
			return existingFetch;
		}

		return this.loadAndCache(key, options.loader, options.ttl);
	}

	/** Cache only successful loads and release pending state on either outcome. */
	private loadAndCache<T>(
		key: string,
		loader: () => Promise<T>,
		ttl?: number,
	): Promise<T> {
		let loading: Promise<T>;
		try {
			loading = loader();
		} catch (error) {
			loading = Promise.reject(error);
		}
		const pending = loading
			.then((result) => {
				if (this.pendingFetches.get(key) === pending) {
					this.set(key, result, ttl);
				}
				return result;
			})
			.finally(() => {
				// A newer read may have started after invalidation. The older read
				// must neither publish its result nor release the newer read's lock.
				if (this.pendingFetches.get(key) === pending) {
					this.pendingFetches.delete(key);
				}
			});
		this.pendingFetches.set(key, pending);
		return pending;
	}

	/**
	 * Evict least recently used entries if cache is at capacity
	 */
	private evictIfNeeded(): void {
		if (this.maxEntries <= 0) return;

		while (this.cache.size >= this.maxEntries) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
				this.pendingFetches.delete(firstKey);
				this.evictions++;
			} else {
				break;
			}
		}
	}

	/**
	 * Generate cache key from parameters
	 */
	static generateKey(
		prefix: string,
		...params: (string | number | boolean | undefined)[]
	): string {
		const cleanParams = params
			.filter((p) => p !== undefined)
			.map((p) => String(p))
			.join(":");

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
