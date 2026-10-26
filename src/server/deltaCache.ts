import type { CacheManager } from "./cacheManager.js";
import { isDeltaEnabled } from "./config.js";
import { globalRequestLogger } from "./requestLogger.js";
import type { ServerKnowledgeStore } from "./serverKnowledgeStore.js";

export interface Logger {
	info(message: string, meta?: Record<string, unknown>): void;
	warn(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
}

const LARGE_KNOWLEDGE_GAP_THRESHOLD = 100;

const requestLoggerAdapter: Logger = {
	info(message, meta) {
		globalRequestLogger.logSuccess(
			"delta-cache",
			message,
			meta ? { ...meta } : {},
		);
	},
	warn(message, meta) {
		const parameters: Record<string, unknown> = {
			...(meta ? { ...meta } : {}),
			severity: "warn",
		};
		globalRequestLogger.logSuccess("delta-cache", message, parameters);
	},
	error(message, meta) {
		const parameters: Record<string, unknown> = meta ? { ...meta } : {};
		const errorField = parameters["error"];
		const errorDetail = typeof errorField === "string" ? errorField : message;
		globalRequestLogger.logError(
			"delta-cache",
			message,
			parameters,
			errorDetail,
		);
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

export type MergeFn<T> = (
	snapshot: T[],
	delta: T[],
	options?: MergeOptions,
) => T[];

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

type DeltaFetcher<T> = (
	lastKnowledge?: number,
) => Promise<{ data: T[]; serverKnowledge: number }>;

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
		const effectiveTtl = this.assertFiniteTtl(
			"fetchWithDelta",
			cacheKey,
			options.ttl,
		);
		// Snapshot and knowledge travel together. An expired snapshot can still
		// seed a delta; it is never served as fresh after its TTL expires.
		const previous = this.cacheManager.peek<DeltaCacheEntry<T>>(cacheKey);
		// Also evicts an expired entry, so a failed refresh cannot leave it behind.
		const previousFresh = this.cacheManager.has(cacheKey);
		// In delta mode every read asks YNAB for changes since the snapshot, so
		// edits made outside this server (e.g. the YNAB app) appear immediately.
		const revalidate =
			isDeltaEnabled() && !options.forceFullRefresh && previous !== undefined;
		let fetchedEntry: DeltaCacheEntry<T> | undefined;
		let usedDelta = false;
		let mergedOntoFreshSnapshot = false;
		const entry = await this.cacheManager.wrap<DeltaCacheEntry<T>>(cacheKey, {
			ttl: effectiveTtl,
			...(options.staleWhileRevalidate !== undefined && {
				staleWhileRevalidate: options.staleWhileRevalidate,
			}),
			...(revalidate && { revalidate }),
			loader: async () => {
				const requestedKnowledge =
					isDeltaEnabled() && !options.forceFullRefresh
						? previous?.serverKnowledge
						: undefined;
				let response = await fetcher(requestedKnowledge);
				let fullRefresh = requestedKnowledge === undefined;
				if (
					requestedKnowledge !== undefined &&
					(response.serverKnowledge < requestedKnowledge ||
						response.serverKnowledge - requestedKnowledge >
							LARGE_KNOWLEDGE_GAP_THRESHOLD)
				) {
					this.knowledgeGapEvents++;
					this.logger.warn("delta-cache.knowledge-gap", {
						budgetId,
						cacheKey,
						lastKnowledge: requestedKnowledge,
						serverKnowledge: response.serverKnowledge,
					});
					response = await fetcher(undefined);
					fullRefresh = true;
				}
				let snapshot: T[];
				if (!fullRefresh && previous) {
					this.deltaHits++;
					mergedOntoFreshSnapshot = previousFresh;
					usedDelta = response.serverKnowledge !== requestedKnowledge;
					if (usedDelta) this.mergeOperations++;
					snapshot = usedDelta
						? merger(previous.snapshot, response.data, options.mergeOptions)
						: previous.snapshot;
				} else {
					this.deltaMisses++;
					snapshot = this.filterDeleted(response.data);
				}
				fetchedEntry = {
					snapshot,
					serverKnowledge: response.serverKnowledge,
					timestamp: Date.now(),
					ttl: effectiveTtl,
					...(options.staleWhileRevalidate !== undefined && {
						staleWhileRevalidate: options.staleWhileRevalidate,
					}),
				};
				return fetchedEntry;
			},
		});
		// An invalidated load is still returned to its original caller, but must
		// not republish either its snapshot or its knowledge for future reads.
		if (this.cacheManager.peek(cacheKey) === entry) {
			this.knowledgeStore.update(cacheKey, entry.serverKnowledge);
		}
		return {
			data: entry.snapshot,
			// A delta merged onto a still-fresh snapshot reports as cached, as in 0.29.1.
			wasCached: entry !== fetchedEntry || mergedOntoFreshSnapshot,
			usedDelta: entry === fetchedEntry && usedDelta,
			serverKnowledge: entry.serverKnowledge,
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

	private filterDeleted<T extends { deleted?: boolean }>(items: T[]): T[] {
		return items.filter((item) => !item.deleted);
	}

	private assertFiniteTtl(
		methodName: string,
		cacheKey: string,
		ttl: number,
	): number {
		if (!Number.isFinite(ttl)) {
			throw new Error(
				`DeltaCache.${methodName} requires a finite ttl for cache key "${cacheKey}". Received: ${String(ttl)}.`,
			);
		}

		return ttl;
	}
}
