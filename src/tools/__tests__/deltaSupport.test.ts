/**
 * Unit tests for deltaSupport.ts - argument resolution with runtime validation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as ynab from 'ynab';
import { resolveDeltaFetcherArgs, resolveDeltaWriteArgs } from '../deltaSupport.js';
import { DeltaFetcher } from '../deltaFetcher.js';
import { DeltaCache } from '../../server/deltaCache.js';
import { ServerKnowledgeStore } from '../../server/serverKnowledgeStore.js';
import { cacheManager } from '../../server/cacheManager.js';

describe('deltaSupport runtime validation', () => {
  let ynabAPI: ynab.API;
  let deltaFetcher: DeltaFetcher;
  let deltaCache: DeltaCache;
  let knowledgeStore: ServerKnowledgeStore;

  beforeEach(() => {
    ynabAPI = new ynab.API('test-token');
    knowledgeStore = new ServerKnowledgeStore();
    deltaCache = new DeltaCache(cacheManager, knowledgeStore);
    deltaFetcher = new DeltaFetcher(ynabAPI, deltaCache);
  });

  describe('resolveDeltaFetcherArgs', () => {
    it('should accept valid 2-argument form (ynabAPI, params)', () => {
      const params = { budgetId: 'test-budget' };
      const result = resolveDeltaFetcherArgs(ynabAPI, params);

      expect(result.deltaFetcher).toBeDefined();
      expect(result.params).toBe(params);
    });

    it('should accept valid 3-argument form (ynabAPI, deltaFetcher, params)', () => {
      const params = { budgetId: 'test-budget' };
      const result = resolveDeltaFetcherArgs(ynabAPI, deltaFetcher, params);

      expect(result.deltaFetcher).toBe(deltaFetcher);
      expect(result.params).toBe(params);
    });

    it('should reject 2-argument form with DeltaFetcher instead of params', () => {
      expect(() => {
        resolveDeltaFetcherArgs(ynabAPI, deltaFetcher as unknown as Record<string, unknown>);
      }).toThrow(
        'resolveDeltaFetcherArgs: When providing 2 arguments, the second argument must be a params object, not a DeltaFetcher',
      );
    });

    it('should reject 3-argument form with wrong types', () => {
      const params = { budgetId: 'test-budget' };

      // Second arg should be DeltaFetcher, not params
      expect(() => {
        resolveDeltaFetcherArgs(ynabAPI, params as unknown as DeltaFetcher, params);
      }).toThrow(
        'resolveDeltaFetcherArgs: When providing 3 arguments, the second argument must be a DeltaFetcher instance',
      );

      // Third arg should be params object, not DeltaFetcher
      expect(() => {
        resolveDeltaFetcherArgs(ynabAPI, deltaFetcher, deltaFetcher as unknown as Record<string, unknown>);
      }).toThrow(
        'resolveDeltaFetcherArgs: When providing 3 arguments, the third argument must be a params object',
      );
    });

    it('should reject non-object params', () => {
      expect(() => {
        resolveDeltaFetcherArgs(ynabAPI, 'invalid' as unknown as Record<string, unknown>);
      }).toThrow('resolveDeltaFetcherArgs: When providing 2 arguments, the second argument must be a params object');

      expect(() => {
        resolveDeltaFetcherArgs(ynabAPI, 123 as unknown as Record<string, unknown>);
      }).toThrow('resolveDeltaFetcherArgs: When providing 2 arguments, the second argument must be a params object');

      expect(() => {
        resolveDeltaFetcherArgs(ynabAPI, null as unknown as Record<string, unknown>);
      }).toThrow('resolveDeltaFetcherArgs: When providing 2 arguments, the second argument must be a params object');
    });
  });

  describe('resolveDeltaWriteArgs', () => {
    it('should accept valid 1-argument form (params)', () => {
      const params = { budgetId: 'test-budget' };
      const result = resolveDeltaWriteArgs(params);

      expect(result.deltaCache).toBeDefined();
      expect(result.knowledgeStore).toBeDefined();
      expect(result.params).toBe(params);
    });

    it('should accept valid 3-argument form (deltaCache, knowledgeStore, params)', () => {
      const params = { budgetId: 'test-budget' };
      const result = resolveDeltaWriteArgs(deltaCache, knowledgeStore, params);

      expect(result.deltaCache).toBe(deltaCache);
      expect(result.knowledgeStore).toBe(knowledgeStore);
      expect(result.params).toBe(params);
    });

    it('should reject 1-argument form with DeltaCache instead of params', () => {
      expect(() => {
        resolveDeltaWriteArgs(deltaCache as unknown as Record<string, unknown>);
      }).toThrow(
        'resolveDeltaWriteArgs: When providing only 1 argument, it must be a params object, not a DeltaCache',
      );
    });

    it('should reject 2-argument form (ambiguous)', () => {
      const params = { budgetId: 'test-budget' };

      // (deltaCache, knowledgeStore) - missing params
      expect(() => {
        resolveDeltaWriteArgs(
          deltaCache as unknown as Record<string, unknown>,
          knowledgeStore as unknown as Record<string, unknown>,
        );
      }).toThrow(
        'resolveDeltaWriteArgs: When providing DeltaCache and ServerKnowledgeStore, you must also provide params',
      );

      // (params, params) - ambiguous
      expect(() => {
        resolveDeltaWriteArgs(params, params);
      }).toThrow('resolveDeltaWriteArgs: Invalid argument combination');
    });

    it('should reject 3-argument form with wrong types', () => {
      const params = { budgetId: 'test-budget' };

      // First arg should be DeltaCache
      expect(() => {
        resolveDeltaWriteArgs(
          params as unknown as DeltaCache,
          knowledgeStore,
          params,
        );
      }).toThrow(
        'resolveDeltaWriteArgs: When providing 3 arguments, the first argument must be a DeltaCache instance',
      );

      // Second arg should be ServerKnowledgeStore
      expect(() => {
        resolveDeltaWriteArgs(
          deltaCache,
          params as unknown as ServerKnowledgeStore,
          params,
        );
      }).toThrow(
        'resolveDeltaWriteArgs: When providing 3 arguments, the second argument must be a ServerKnowledgeStore instance',
      );

      // Third arg should be params
      expect(() => {
        resolveDeltaWriteArgs(
          deltaCache,
          knowledgeStore,
          deltaCache as unknown as Record<string, unknown>,
        );
      }).toThrow(
        'resolveDeltaWriteArgs: When providing 3 arguments, the third argument must be a params object',
      );
    });

    it('should reject non-object params', () => {
      expect(() => {
        resolveDeltaWriteArgs('invalid' as unknown as Record<string, unknown>);
      }).toThrow('resolveDeltaWriteArgs: When providing only 1 argument, it must be a params object');

      expect(() => {
        resolveDeltaWriteArgs(123 as unknown as Record<string, unknown>);
      }).toThrow('resolveDeltaWriteArgs: When providing only 1 argument, it must be a params object');

      expect(() => {
        resolveDeltaWriteArgs(null as unknown as Record<string, unknown>);
      }).toThrow('resolveDeltaWriteArgs: When providing only 1 argument, it must be a params object');
    });
  });
});
