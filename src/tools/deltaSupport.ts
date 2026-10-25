import type * as ynab from "ynab";
import { cacheManager } from "../server/cacheManager.js";
import { DeltaCache } from "../server/deltaCache.js";
import { ServerKnowledgeStore } from "../server/serverKnowledgeStore.js";
import { DeltaFetcher } from "./deltaFetcher.js";

interface SharedDeltaSupportContext {
	deltaFetcher?: DeltaFetcher;
	deltaCache?: DeltaCache;
	knowledgeStore?: ServerKnowledgeStore;
	ynabAPI?: ynab.API;
	manuallyConfigured?: boolean;
}

export interface SharedDeltaSupportOptions {
	deltaFetcher?: DeltaFetcher;
	deltaCache?: DeltaCache;
	knowledgeStore?: ServerKnowledgeStore;
}

let sharedDeltaContext: SharedDeltaSupportContext | undefined;

export function setSharedDeltaSupport(
	options?: SharedDeltaSupportOptions,
): void {
	if (!options) {
		sharedDeltaContext = undefined;
		return;
	}
	sharedDeltaContext = {
		...options,
		manuallyConfigured: true,
	};
}

export function getSharedDeltaSupport(): SharedDeltaSupportOptions | undefined {
	if (!sharedDeltaContext) {
		return undefined;
	}
	const result: SharedDeltaSupportOptions = {};
	if (sharedDeltaContext.deltaFetcher) {
		result.deltaFetcher = sharedDeltaContext.deltaFetcher;
	}
	if (sharedDeltaContext.deltaCache) {
		result.deltaCache = sharedDeltaContext.deltaCache;
	}
	if (sharedDeltaContext.knowledgeStore) {
		result.knowledgeStore = sharedDeltaContext.knowledgeStore;
	}
	return result;
}

function resolveSharedDeltaFetcher(ynabAPI: ynab.API): DeltaFetcher {
	if (
		sharedDeltaContext &&
		!sharedDeltaContext.manuallyConfigured &&
		sharedDeltaContext.ynabAPI &&
		sharedDeltaContext.ynabAPI !== ynabAPI
	) {
		sharedDeltaContext = undefined;
	}

	if (sharedDeltaContext?.deltaFetcher) {
		return sharedDeltaContext.deltaFetcher;
	}

	const context: SharedDeltaSupportContext = sharedDeltaContext
		? { ...sharedDeltaContext }
		: {};
	if (context.manuallyConfigured === undefined) {
		context.manuallyConfigured = false;
	}

	if (!context.deltaCache) {
		if (!context.knowledgeStore) {
			context.knowledgeStore = new ServerKnowledgeStore();
		}
		context.deltaCache = new DeltaCache(cacheManager, context.knowledgeStore);
	}

	const deltaFetcher = new DeltaFetcher(ynabAPI, context.deltaCache);
	context.deltaFetcher = deltaFetcher;
	if (!context.ynabAPI) {
		context.ynabAPI = ynabAPI;
	}

	sharedDeltaContext = context;

	return deltaFetcher;
}

export interface DeltaFetcherDeps {
	deltaFetcher?: DeltaFetcher;
}

export interface DeltaWriteDeps {
	deltaCache?: DeltaCache;
	knowledgeStore?: ServerKnowledgeStore;
}

/**
 * Resolve the DeltaFetcher for a read handler. Uses the provided fetcher when
 * given; otherwise falls back to the shared context (creating it on demand).
 */
export function resolveDeltaFetcherDeps(
	ynabAPI: ynab.API,
	deps?: DeltaFetcherDeps,
): DeltaFetcher {
	return deps?.deltaFetcher ?? resolveSharedDeltaFetcher(ynabAPI);
}

/**
 * Return the injected DeltaFetcher, throwing with the given message when absent.
 * Unlike resolveDeltaFetcherDeps, this never falls back to the shared context.
 */
export function requireDeltaFetcher(
	deps: DeltaFetcherDeps | undefined,
	errorMessage: string,
): DeltaFetcher {
	if (!deps?.deltaFetcher) {
		throw new Error(errorMessage);
	}
	return deps.deltaFetcher;
}

/**
 * Return the injected DeltaCache, throwing with the given message when absent.
 * Unlike resolveDeltaWriteDeps, this never falls back to the shared context.
 */
export function requireDeltaCache(
	deps: DeltaWriteDeps | undefined,
	errorMessage: string,
): DeltaCache {
	if (!deps?.deltaCache) {
		throw new Error(errorMessage);
	}
	return deps.deltaCache;
}

/**
 * Resolve the DeltaCache and ServerKnowledgeStore for a write handler. Uses
 * the provided instances when given; otherwise falls back to the shared
 * context (creating them on demand).
 */
export function resolveDeltaWriteDeps(deps?: DeltaWriteDeps): {
	deltaCache: DeltaCache;
	knowledgeStore: ServerKnowledgeStore;
} {
	if (deps?.deltaCache && deps?.knowledgeStore) {
		return {
			deltaCache: deps.deltaCache,
			knowledgeStore: deps.knowledgeStore,
		};
	}

	if (!sharedDeltaContext) {
		sharedDeltaContext = {};
	}
	if (!sharedDeltaContext.knowledgeStore) {
		if (deps?.knowledgeStore) {
			sharedDeltaContext.knowledgeStore = deps.knowledgeStore;
		} else {
			sharedDeltaContext.knowledgeStore = new ServerKnowledgeStore();
		}
	}
	if (!sharedDeltaContext.deltaCache) {
		if (deps?.deltaCache) {
			sharedDeltaContext.deltaCache = deps.deltaCache;
		} else {
			sharedDeltaContext.deltaCache = new DeltaCache(
				cacheManager,
				sharedDeltaContext.knowledgeStore,
			);
		}
	}

	return {
		deltaCache: sharedDeltaContext.deltaCache,
		knowledgeStore: sharedDeltaContext.knowledgeStore,
	};
}
