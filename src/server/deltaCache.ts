import type { CacheManager } from "./cacheManager.js";
import { globalRequestLogger } from "./requestLogger.js";
import type { ServerKnowledgeStore } from "./serverKnowledgeStore.js";

export interface Logger {
	info(message: string, meta?: Record<string, unknown>): void;
	warn(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
}

const LARGE_KNOWLEDGE_GAP_THRESHOLD = 100;

const requestLoggerAdapter: Logger = {
	info(message) {
		globalRequestLogger.logSuccess("delta-cache", message);
	},
	warn(message) {
		globalRequestLogger.logSuccess("delta-cache", message);
	},
	error(message, meta) {
		const errorField = meta?.["error"];
		const errorDetail = typeof errorField === "string" ? errorField : message;
		globalRequestLogger.logError("delta-cache", message, errorDetail);
	},
};

/**
 * Options for merge operations
 */
export interface MergeOptions {
	/** Whether to preserve deleted entities (default: false) */
	preserveDeleted?: boolean;
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
		// Every read asks YNAB for changes since the snapshot, so edits made
		// outside this server (e.g. the YNAB app) appear immediately.
		const revalidate = !options.forceFullRefresh && previous !== undefined;
		let fetchedEntry: DeltaCacheEntry<T> | undefined;
		let usedDelta = false;
		let mergedOntoFreshSnapshot = false;
		const entry = await this.cacheManager.wrap<DeltaCacheEntry<T>>(cacheKey, {
			ttl: effectiveTtl,
			...(revalidate && { revalidate }),
			loader: async () => {
				const loaded = await this.loadDeltaEntry(
					cacheKey,
					budgetId,
					fetcher,
					merger,
					previous,
					previousFresh,
					effectiveTtl,
					options,
				);
				fetchedEntry = loaded.entry;
				usedDelta = loaded.usedDelta;
				mergedOntoFreshSnapshot = loaded.mergedOntoFreshSnapshot;
				return loaded.entry;
			},
		});
		// An invalidated load is still returned to its original caller, but must
		// not republish either its snapshot or its knowledge for future reads.
		if (this.cacheManager.peek(cacheKey) === entry) {
			this.knowledgeStore.update(cacheKey, entry.serverKnowledge);
		}
		return {
			data: entry.snapshot,
			wasCached: entry !== fetchedEntry || mergedOntoFreshSnapshot,
			usedDelta: entry === fetchedEntry && usedDelta,
			serverKnowledge: entry.serverKnowledge,
		};
	}

	private isKnowledgeGap(
		requested: number | undefined,
		received: number,
	): boolean {
		return (
			requested !== undefined &&
			(received < requested ||
				received - requested > LARGE_KNOWLEDGE_GAP_THRESHOLD)
		);
	}

	private async loadDeltaEntry<T extends { deleted?: boolean }>(
		cacheKey: string,
		budgetId: string,
		fetcher: DeltaFetcher<T>,
		merger: MergeFn<T>,
		previous: DeltaCacheEntry<T> | undefined,
		previousFresh: boolean,
		effectiveTtl: number,
		options: {
			forceFullRefresh?: boolean;
			mergeOptions?: MergeOptions;
		},
	): Promise<{
		entry: DeltaCacheEntry<T>;
		usedDelta: boolean;
		mergedOntoFreshSnapshot: boolean;
	}> {
		const requestedKnowledge = options.forceFullRefresh
			? undefined
			: previous?.serverKnowledge;
		let response = await fetcher(requestedKnowledge);
		let fullRefresh = requestedKnowledge === undefined;
		if (this.isKnowledgeGap(requestedKnowledge, response.serverKnowledge)) {
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
		let usedDelta = false;
		let mergedOntoFreshSnapshot = false;
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
		const entry: DeltaCacheEntry<T> = {
			snapshot,
			serverKnowledge: response.serverKnowledge,
			timestamp: Date.now(),
			ttl: effectiveTtl,
		};
		return { entry, usedDelta, mergedOntoFreshSnapshot };
	}

	getStats(): DeltaCacheStats {
		return {
			deltaHits: this.deltaHits,
			deltaMisses: this.deltaMisses,
			mergeOperations: this.mergeOperations,
			knowledgeGapEvents: this.knowledgeGapEvents,
		};
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
