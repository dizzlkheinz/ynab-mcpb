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
  if (!context.ynabAPI) {
    context.ynabAPI = ynabAPI;
  }

  sharedDeltaContext = context;

  return deltaFetcher;
}

/**
 * Type guard to check if a value is a DeltaFetcher instance.
 */
function isDeltaFetcher(value: unknown): value is DeltaFetcher {
  return (
    value !== null &&
    typeof value === 'object' &&
    value instanceof DeltaFetcher &&
    typeof (value as DeltaFetcher).fetchAccounts === 'function' &&
    typeof (value as DeltaFetcher).fetchCategories === 'function'
  );
}

/**
 * Type guard to check if a value is a DeltaCache instance.
 */
function isDeltaCache(value: unknown): value is DeltaCache {
  return (
    value !== null &&
    typeof value === 'object' &&
    value instanceof DeltaCache &&
    typeof (value as DeltaCache).fetchWithDelta === 'function'
  );
}

/**
 * Type guard to check if a value is a ServerKnowledgeStore instance.
 */
function isServerKnowledgeStore(value: unknown): value is ServerKnowledgeStore {
  return (
    value !== null &&
    typeof value === 'object' &&
    value instanceof ServerKnowledgeStore &&
    typeof (value as ServerKnowledgeStore).get === 'function' &&
    typeof (value as ServerKnowledgeStore).update === 'function'
  );
}

/**
 * Type guard to check if a value is a plain object (params).
 */
function isParamsObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    // Not a class instance
    (value.constructor === Object || value.constructor === undefined)
  );
}

/**
 * Helper to get a descriptive type name for error messages.
 */
function getTypeName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const type = typeof value;
  if (type !== 'object') return type;
  const constructorName = (value as Record<string, unknown>).constructor?.name;
  return constructorName ? `${type} (${constructorName})` : type;
}

export function resolveDeltaFetcherArgs<TParams extends Record<string, unknown>>(
  ynabAPI: ynab.API,
  deltaFetcherOrParams: DeltaFetcher | TParams,
  maybeParams?: TParams,
): { deltaFetcher: DeltaFetcher; params: TParams } {
  // Case 1: Three arguments - (ynabAPI, deltaFetcher, params)
  if (maybeParams !== undefined) {
    // Validate that deltaFetcherOrParams is actually a DeltaFetcher
    if (!isDeltaFetcher(deltaFetcherOrParams)) {
      throw new Error(
        'resolveDeltaFetcherArgs: When providing 3 arguments, the second argument must be a DeltaFetcher instance. ' +
          `Got: ${getTypeName(deltaFetcherOrParams)}`,
      );
    }

    // Validate that maybeParams is a params object
    if (!isParamsObject(maybeParams)) {
      throw new Error(
        'resolveDeltaFetcherArgs: When providing 3 arguments, the third argument must be a params object. ' +
          `Got: ${getTypeName(maybeParams)}`,
      );
    }

    return {
      deltaFetcher: deltaFetcherOrParams,
      params: maybeParams,
    };
  }

  // Case 2: Two arguments - (ynabAPI, params)
  // Validate that deltaFetcherOrParams is a params object, not a DeltaFetcher
  if (isDeltaFetcher(deltaFetcherOrParams)) {
    throw new Error(
      'resolveDeltaFetcherArgs: When providing 2 arguments, the second argument must be a params object, not a DeltaFetcher. ' +
        'To use a custom DeltaFetcher, provide all 3 arguments: (ynabAPI, deltaFetcher, params)',
    );
  }

  if (!isParamsObject(deltaFetcherOrParams)) {
    throw new Error(
      'resolveDeltaFetcherArgs: When providing 2 arguments, the second argument must be a params object. ' +
        `Got: ${getTypeName(deltaFetcherOrParams)}`,
    );
  }

  return {
    deltaFetcher: resolveSharedDeltaFetcher(ynabAPI),
    params: deltaFetcherOrParams,
  };
}

export function resolveDeltaWriteArgs<TParams extends Record<string, unknown>>(
  deltaCacheOrParams: DeltaCache | TParams,
  knowledgeStoreOrParams?: ServerKnowledgeStore | TParams,
  maybeParams?: TParams,
): { deltaCache: DeltaCache; knowledgeStore: ServerKnowledgeStore; params: TParams } {
  // Case 1: Three arguments - (deltaCache, knowledgeStore, params)
  if (maybeParams !== undefined) {
    // Validate that deltaCacheOrParams is actually a DeltaCache
    if (!isDeltaCache(deltaCacheOrParams)) {
      throw new Error(
        'resolveDeltaWriteArgs: When providing 3 arguments, the first argument must be a DeltaCache instance. ' +
          `Got: ${getTypeName(deltaCacheOrParams)}`,
      );
    }

    // Validate that knowledgeStoreOrParams is actually a ServerKnowledgeStore
    if (!isServerKnowledgeStore(knowledgeStoreOrParams)) {
      throw new Error(
        'resolveDeltaWriteArgs: When providing 3 arguments, the second argument must be a ServerKnowledgeStore instance. ' +
          `Got: ${getTypeName(knowledgeStoreOrParams)}`,
      );
    }

    // Validate that maybeParams is a params object
    if (!isParamsObject(maybeParams)) {
      throw new Error(
        'resolveDeltaWriteArgs: When providing 3 arguments, the third argument must be a params object. ' +
          `Got: ${getTypeName(maybeParams)}`,
      );
    }

    return {
      deltaCache: deltaCacheOrParams,
      knowledgeStore: knowledgeStoreOrParams,
      params: maybeParams,
    };
  }

  // Case 2: Two arguments - could be (deltaCache, params) or just (params)
  // Need to determine if knowledgeStoreOrParams is a ServerKnowledgeStore or params
  if (knowledgeStoreOrParams !== undefined) {
    const isKnowledgeStore = isServerKnowledgeStore(knowledgeStoreOrParams);
    const isParams = isParamsObject(knowledgeStoreOrParams);

    if (!isKnowledgeStore && !isParams) {
      throw new Error(
        'resolveDeltaWriteArgs: When providing 2 arguments, the second argument must be either a ServerKnowledgeStore or a params object. ' +
          `Got: ${getTypeName(knowledgeStoreOrParams)}`,
      );
    }

    // If second arg is a params object, then first arg should be params too (invalid)
    if (isParams) {
      throw new Error(
        'resolveDeltaWriteArgs: Invalid argument combination. When providing 2 arguments where the second is a params object, ' +
          'this is ambiguous. Either provide 1 argument (params only) or 3 arguments (deltaCache, knowledgeStore, params).',
      );
    }

    // Second arg is ServerKnowledgeStore, so first arg must be DeltaCache (invalid - missing params)
    if (isKnowledgeStore) {
      throw new Error(
        'resolveDeltaWriteArgs: When providing DeltaCache and ServerKnowledgeStore, you must also provide params as the third argument. ' +
          'Got 2 arguments, expected 3: (deltaCache, knowledgeStore, params)',
      );
    }
  }

  // Case 3: One argument - (params)
  // Validate that deltaCacheOrParams is a params object, not a DeltaCache
  if (isDeltaCache(deltaCacheOrParams)) {
    throw new Error(
      'resolveDeltaWriteArgs: When providing only 1 argument, it must be a params object, not a DeltaCache. ' +
        'To use a custom DeltaCache, provide all 3 arguments: (deltaCache, knowledgeStore, params)',
    );
  }

  if (!isParamsObject(deltaCacheOrParams)) {
    throw new Error(
      'resolveDeltaWriteArgs: When providing only 1 argument, it must be a params object. ' +
        `Got: ${getTypeName(deltaCacheOrParams)}`,
    );
  }

  const fallbackKnowledgeStore = new ServerKnowledgeStore();
  const fallbackDeltaCache = new DeltaCache(cacheManager, fallbackKnowledgeStore);
  return {
    deltaCache: fallbackDeltaCache,
    knowledgeStore: fallbackKnowledgeStore,
    params: deltaCacheOrParams,
  };
}
