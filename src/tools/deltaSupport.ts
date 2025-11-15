import * as ynab from 'ynab';
import { cacheManager } from '../server/cacheManager.js';
import { DeltaCache } from '../server/deltaCache.js';
import { ServerKnowledgeStore } from '../server/serverKnowledgeStore.js';
import { DeltaFetcher } from './deltaFetcher.js';

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

export function setSharedDeltaSupport(options?: SharedDeltaSupportOptions): void {
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
  if (!context.manuallyConfigured) {
    context.ynabAPI = ynabAPI;
  } else if (!context.ynabAPI) {
    context.ynabAPI = ynabAPI;
  }

  sharedDeltaContext = context;

  return deltaFetcher;
}

export function resolveDeltaFetcherArgs<TParams extends Record<string, unknown>>(
  ynabAPI: ynab.API,
  deltaFetcherOrParams: DeltaFetcher | TParams,
  maybeParams?: TParams,
): { deltaFetcher: DeltaFetcher; params: TParams } {
  if (maybeParams !== undefined) {
    return {
      deltaFetcher: deltaFetcherOrParams as DeltaFetcher,
      params: maybeParams,
    };
  }

  return {
    deltaFetcher: resolveSharedDeltaFetcher(ynabAPI),
    params: deltaFetcherOrParams as TParams,
  };
}

export function resolveDeltaWriteArgs<TParams extends Record<string, unknown>>(
  deltaCacheOrParams: DeltaCache | TParams,
  knowledgeStoreOrParams?: ServerKnowledgeStore | TParams,
  maybeParams?: TParams,
): { deltaCache: DeltaCache; knowledgeStore: ServerKnowledgeStore; params: TParams } {
  if (maybeParams !== undefined) {
    return {
      deltaCache: deltaCacheOrParams as DeltaCache,
      knowledgeStore: knowledgeStoreOrParams as ServerKnowledgeStore,
      params: maybeParams,
    };
  }

  const fallbackKnowledgeStore = new ServerKnowledgeStore();
  const fallbackDeltaCache = new DeltaCache(cacheManager, fallbackKnowledgeStore);
  return {
    deltaCache: fallbackDeltaCache,
    knowledgeStore: fallbackKnowledgeStore,
    params: deltaCacheOrParams as TParams,
  };
}
