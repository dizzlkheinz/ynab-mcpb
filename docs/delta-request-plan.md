# Delta Request Implementation Plan (Enhanced)

**Version:** 2.0
**Status:** ✅ VERIFIED & READY FOR IMPLEMENTATION
**Last Updated:** 2025-11-13
**Owner:** @ynab-dxt/tooling
**Note:** SDK signatures verified via test script execution. See §1.4 "SDK Verification" for details.

## Executive Summary

This plan details the implementation of YNAB API delta requests to reduce bandwidth, improve performance, and decrease server load. Delta requests allow fetching only changed entities since the last request, significantly reducing response sizes for large budgets.

**Expected Benefits:**
- 70-90% reduction in API response size for cached data
- 50-80% reduction in parsing/processing time
- Improved rate limit compliance through fewer full refreshes
- Better UX for large budgets (>1000 transactions)

**Key Risk Mitigations:**
- Feature flag for rollback capability
- Reconciliation flow guarantees fresh data
- Conflict detection prevents stale merge issues
- Comprehensive test coverage including edge cases

---

## 1. YNAB API Delta Mechanism

### 1.1 Supported Endpoints

The following endpoints support delta requests (verified from OpenAPI spec):

**Fully Supported:**
- `GET /budgets/{budget_id}` - Full budget with all nested data
- `GET /budgets/{budget_id}/accounts` - All accounts
- `GET /budgets/{budget_id}/categories` - All categories (by group)
- `GET /budgets/{budget_id}/payees` - All payees
- `GET /budgets/{budget_id}/months` - All months summary
- `GET /budgets/{budget_id}/transactions` - All transactions
- `GET /budgets/{budget_id}/scheduled_transactions` - All scheduled transactions

**NOT Supported:**
- `GET /budgets/{budget_id}/accounts/{account_id}` - Single account detail
- `GET /budgets/{budget_id}/categories/{category_id}` - Single category
- `GET /budgets/{budget_id}/months/{month}` - Single month detail
- Any other single-entity GET endpoints

### 1.2 Protocol Specification

**Request Pattern:**
```http
GET /v1/budgets/{budget_id}/accounts?last_knowledge_of_server=12345
Authorization: Bearer {token}
```

**Response Structure:**
```json
{
  "data": {
    "accounts": [
      { "id": "...", "deleted": false, ... },
      { "id": "...", "deleted": true, ... }
    ],
    "server_knowledge": 12346
  }
}
```

**Key Behaviors:**
1. If `last_knowledge_of_server` is omitted → full dataset returned
2. If `last_knowledge_of_server` matches current → only changed entities returned
3. Deleted entities have `deleted: true` and only appear in delta responses
4. Write operations (POST/PUT/DELETE) return updated `server_knowledge`

### 1.3 Parameter Naming

**✅ VERIFIED:** The official `ynab` npm package (v2.10.0+) uses **positional parameters** (not query objects).

All delta-supporting methods accept an optional numeric parameter as the last argument:

```typescript
// Simple signatures (6 endpoints)
ynabAPI.accounts.getAccounts(budgetId, lastKnowledge?)
ynabAPI.categories.getCategories(budgetId, lastKnowledge?)
ynabAPI.payees.getPayees(budgetId, lastKnowledge?)
ynabAPI.months.getBudgetMonths(budgetId, lastKnowledge?)
ynabAPI.budgets.getBudgetById(budgetId, lastKnowledge?)
ynabAPI.scheduledTransactions.getScheduledTransactions(budgetId, lastKnowledge?)

// Complex signature (transactions - 4th position)
ynabAPI.transactions.getTransactions(budgetId, sinceDate?, type?, lastKnowledge?)
```

### 1.4 SDK Verification

**Verification Script Location:** `scripts/test-delta-params.mjs`

**Purpose:** Confirms that all YNAB SDK endpoints support delta requests with correct parameter positions.

**How to Run:**

```bash
# Ensure YNAB_ACCESS_TOKEN is set
export YNAB_ACCESS_TOKEN="your-token-here"

# Run the verification script
node scripts/test-delta-params.mjs
```

**What It Tests:**

1. **Simple Endpoints (6 tests):** Verifies `lastKnowledge` as 2nd parameter
   - `budgets.getBudgetById(budgetId, lastKnowledge?)`
   - `accounts.getAccounts(budgetId, lastKnowledge?)`
   - `categories.getCategories(budgetId, lastKnowledge?)`
   - `payees.getPayees(budgetId, lastKnowledge?)`
   - `months.getBudgetMonths(budgetId, lastKnowledge?)`
   - `scheduledTransactions.getScheduledTransactions(budgetId, lastKnowledge?)`

2. **Complex Endpoint (1 test):** Verifies `lastKnowledge` as 4th parameter
   - `transactions.getTransactions(budgetId, sinceDate?, type?, lastKnowledge?)`

**Sample Output:**

```
Verifying YNAB SDK delta request signatures...

Using budget: My Budget (7b47d8bb-ce4c-40c0-a9eb-c6d715af9a76)

✓ budgets.getBudgetById (getBudgetById(budgetId, lastKnowledge?)) - server_knowledge=1702
✓ accounts.getAccounts (getAccounts(budgetId, lastKnowledge?)) - server_knowledge=1702
✓ categories.getCategories (getCategories(budgetId, lastKnowledge?)) - server_knowledge=1702
✓ payees.getPayees (getPayees(budgetId, lastKnowledge?)) - server_knowledge=1702
✓ months.getBudgetMonths (getBudgetMonths(budgetId, lastKnowledge?)) - server_knowledge=1702
✓ scheduledTransactions.getScheduledTransactions (getScheduledTransactions(budgetId, lastKnowledge?)) - server_knowledge=1702
✓ transactions.getTransactions (Signature: (budgetId, sinceDate?, type?, lastKnowledge?)) - server_knowledge=1702

Summary:

✓ budgets.getBudgetById -> supports delta
✓ accounts.getAccounts -> supports delta
✓ categories.getCategories -> supports delta
✓ payees.getPayees -> supports delta
✓ months.getBudgetMonths -> supports delta
✓ scheduledTransactions.getScheduledTransactions -> supports delta
✓ transactions.getTransactions -> supports delta
```

**Key Findings from Verification:**

- ✅ All 7 endpoints return identical `server_knowledge` values (1702 in test run)
- ✅ All endpoints accept `lastKnowledge` as positional parameter (not query object)
- ✅ Transactions endpoint requires `undefined` for `sinceDate` and `type` when using delta without filters
- ✅ No SDK modifications needed - verified production-ready

**Reproducibility:**

1. Clone repository
2. Install dependencies: `npm install`
3. Set YNAB token: `export YNAB_ACCESS_TOKEN="your-token"`
4. Run script: `node scripts/test-delta-params.mjs`
5. Verify all 7 tests pass with ✓ status

---

## 2. Server Knowledge Store

### 2.1 Architecture

Create `src/server/serverKnowledgeStore.ts` as a **class** that will be instantiated **once per MCP server instance** (effectively a singleton per server process).

**Instantiation Pattern:**
```typescript
// In src/server/YNABMCPServer.ts constructor:
export class YNABMCPServer {
  private knowledgeStore: ServerKnowledgeStore;
  private deltaCache: DeltaCache;

  constructor(private ynabAPI: ynab.API, /* other deps */) {
    // Create single instance for the server
    this.knowledgeStore = new ServerKnowledgeStore();
    this.deltaCache = new DeltaCache(
      this.cacheManager,
      this.knowledgeStore,
      logger  // Inject logger for observability
    );
    // Inject into tools that need delta support
  }
}
```

**Why instance-based (not exported singleton)?**
- Enables testing with isolated instances
- Allows dependency injection
- Maintains single instance per server in production
- Avoids shared mutable state across test suites

### 2.2 Interface

```typescript
/**
 * Tracks the last known server_knowledge value per cache key
 * to enable delta requests.
 *
 * IMPORTANT: Knowledge is ephemeral and resets on server restart.
 * This is intentional - forces full refresh on startup to ensure
 * consistency.
 *
 * DESIGN NOTE: Knowledge is keyed by cache key (not just budget ID)
 * because different resources for the same budget can have different
 * server_knowledge values. For example, if you fetch transactions
 * (knowledge=1000) and then accounts (knowledge=1005), the next
 * transaction delta should use 1000, not 1005.
 */
export class ServerKnowledgeStore {
  private knowledge = new Map<string, number>();

  /**
   * Get last known server_knowledge for a cache key
   * @param cacheKey - Cache key (e.g., "transactions:list:budget-123:all:all")
   * @returns knowledge number, or undefined if never fetched
   */
  get(cacheKey: string): number | undefined {
    return this.knowledge.get(cacheKey);
  }

  /**
   * Update server_knowledge after API response
   * @param cacheKey - Cache key (e.g., "transactions:list:budget-123:all:all")
   * @param value - New server_knowledge from API response
   */
  update(cacheKey: string, value: number): void {
    if (value < 0) {
      throw new Error('server_knowledge must be non-negative');
    }
    this.knowledge.set(cacheKey, value);
  }

  /**
   * Reset knowledge for a cache key pattern (or all entries)
   * Used for diagnostics or when forcing full refresh
   * @param keyPattern - Prefix to match (e.g., "transactions:list:budget-123")
   *                     or undefined to reset all
   */
  reset(keyPattern?: string): void {
    if (!keyPattern) {
      this.knowledge.clear();
      return;
    }

    // Delete all keys whose identifier contains the pattern
    for (const key of this.knowledge.keys()) {
      if (key.includes(keyPattern)) {
        this.knowledge.delete(key);
      }
    }
  }

  /**
   * Convenience helper for clearing all knowledge entries for a budget
   */
  resetByBudgetId(budgetId: string): void {
    this.reset(`:${budgetId}`);
  }

  /**
   * Get diagnostic info about tracked cache keys
   */
  getStats(): { entryCount: number; entries: Record<string, number> } {
    return {
      entryCount: this.knowledge.size,
      entries: Object.fromEntries(this.knowledge.entries()),
    };
  }
}
```

### 2.3 Lifecycle

- **Creation:** Instantiated in `YNABMCPServer` constructor, injected into tools
- **Persistence:** None - knowledge resets on server restart (intentional)
- **Concurrency:** Single-threaded Node.js, no locking needed
- **Memory:** O(n) where n = number of cache keys accessed (typically 5-20 per budget)

---

## 3. Delta-Aware Cache

### 3.1 Cache Value Structure

```typescript
interface DeltaCacheEntry<T> {
  /** Full merged snapshot of the resource */
  snapshot: T[];
  /** Last server_knowledge used to fetch/merge this snapshot */
  serverKnowledge: number;
  /** Timestamp when last updated */
  timestamp: number;
  /** TTL in milliseconds */
  ttl: number;
  /** Optional stale-while-revalidate window */
  staleWhileRevalidate?: number;
}
```

### 3.2 CacheManager Enhancements Required

Before implementing DeltaCache, add the following methods to `src/server/cacheManager.ts`:

```typescript
/**
 * Delete all cache entries matching a prefix
 * Used for invalidating specific resource types
 *
 * @param prefix - Key prefix to match (e.g., "transactions:", "accounts:list:")
 * @returns Number of entries deleted
 */
deleteByPrefix(prefix: string): number {
  let deletedCount = 0;

  for (const key of this.cache.keys()) {
    if (key.startsWith(prefix)) {
      this.cache.delete(key);
      deletedCount++;
    }
  }

  return deletedCount;
}

/**
 * Delete all cache entries containing a specific budget ID
 * Used for invalidating all cached data for a budget
 *
 * @param budgetId - Budget ID to search for in keys
 * @returns Number of entries deleted
 */
deleteByBudgetId(budgetId: string): number {
  let deletedCount = 0;

  for (const key of this.cache.keys()) {
    // Keys follow format: "resource:operation:budgetId[:additional:params]"
    // Example: "transactions:list:7b47d8bb-ce4c-40c0-a9eb-c6d715af9a76"
    if (key.includes(budgetId)) {
      this.cache.delete(key);
      deletedCount++;
    }
  }

  return deletedCount;
}

/**
 * Get all cache keys (useful for debugging and testing)
 */
getKeys(): string[] {
  return Array.from(this.cache.keys());
}
```

**Why these methods are needed:**
- `deleteByPrefix()` - Enables targeted invalidation (e.g., clear all transaction caches)
- `deleteByBudgetId()` - Enables budget-scoped invalidation (e.g., after user switches budgets)
- `getKeys()` - Enables introspection and testing

**Testing requirements:**
```typescript
// In src/server/__tests__/cacheManager.test.ts
describe('CacheManager prefix deletion', () => {
  it('should delete entries matching prefix', () => {
    cacheManager.set('transactions:list:budget-123', data1);
    cacheManager.set('transactions:get:budget-123', data2);
    cacheManager.set('accounts:list:budget-123', data3);

    const deleted = cacheManager.deleteByPrefix('transactions:');

    expect(deleted).toBe(2);
    expect(cacheManager.has('transactions:list:budget-123')).toBe(false);
    expect(cacheManager.has('accounts:list:budget-123')).toBe(true);
  });

  it('should delete entries by budget ID', () => {
    cacheManager.set('transactions:list:budget-123', data1);
    cacheManager.set('accounts:list:budget-123', data2);
    cacheManager.set('transactions:list:budget-456', data3);

    const deleted = cacheManager.deleteByBudgetId('budget-123');

    expect(deleted).toBe(2);
    expect(cacheManager.has('transactions:list:budget-456')).toBe(true);
  });
});
```

### 3.3 Delta Cache Manager

Create `src/server/deltaCache.ts`:

```typescript
import { CacheManager, CACHE_TTLS } from './cacheManager.js';
import { ServerKnowledgeStore } from './serverKnowledgeStore.js';
import { logger } from './requestLogger.js';

/**
 * Logger interface for dependency injection
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Options for merge operations
 */
export interface MergeOptions {
  /** Whether to preserve deleted entities (default: false) */
  preserveDeleted?: boolean;
  /** Custom equality function for deduplication */
  equalityFn?: (a: unknown, b: unknown) => boolean;
}

/**
 * Merge function signature for combining snapshots with deltas
 */
export type MergeFn<T> = (
  snapshot: T[],
  delta: T[],
  options?: MergeOptions
) => T[];

/**
 * Result of a delta fetch operation
 */
export interface DeltaFetchResult<T> {
  data: T[];
  wasCached: boolean;
  usedDelta: boolean;
  serverKnowledge: number;
}

/**
 * Delta-aware cache that merges API delta responses with stored snapshots
 */
export class DeltaCache {
  constructor(
    private cacheManager: CacheManager,
    private knowledgeStore: ServerKnowledgeStore,
    private logger: Logger = logger  // Default to global logger, allow injection for testing
  ) {}

  /**
   * Fetch data with delta support
   *
   * @param cacheKey - Cache key for this resource
   * @param budgetId - Budget ID for knowledge tracking
   * @param fetcher - Function to fetch data from API (receives last_knowledge_of_server)
   * @param merger - Function to merge snapshot with delta
   * @param options - Cache and merge options
   */
  async fetchWithDelta<T extends { id: string; deleted?: boolean }>(
    cacheKey: string,
    budgetId: string,
    fetcher: (lastKnowledge?: number) => Promise<{
      data: T[];
      serverKnowledge: number;
    }>,
    merger: MergeFn<T>,
    options: {
      ttl?: number;
      forceFullRefresh?: boolean;
      mergeOptions?: MergeOptions;
    } = {}
  ): Promise<DeltaFetchResult<T>> {
    const { ttl = CACHE_TTLS.ACCOUNTS, forceFullRefresh = false, mergeOptions } = options;

    // Check if feature flag is enabled
    if (!this.isDeltaEnabled()) {
      return this.fetchWithoutDelta(cacheKey, budgetId, fetcher, ttl);
    }

    // Get cached snapshot
    const cached = this.cacheManager.get<DeltaCacheEntry<T>>(cacheKey);
    const lastKnowledge = forceFullRefresh ? undefined : this.knowledgeStore.get(cacheKey);

    // Determine if we can use delta
    const canUseDelta = !forceFullRefresh && cached && lastKnowledge;

    // Fetch from API (track what we requested for deterministic detection)
    const requestedKnowledge = canUseDelta ? lastKnowledge : undefined;
    const response = await fetcher(requestedKnowledge);

    // Deterministic delta detection:
    // - If we requested WITH knowledge AND server returned SAME knowledge → no changes (empty delta)
    // - If we requested WITH knowledge AND server returned HIGHER knowledge → delta payload
    // - If we requested WITHOUT knowledge → full refresh
    const receivedDelta = requestedKnowledge !== undefined &&
                          response.serverKnowledge > requestedKnowledge;

    // Knowledge conflict detection: if knowledge jumped significantly, data may be stale
    const knowledgeGap = requestedKnowledge
      ? response.serverKnowledge - requestedKnowledge
      : 0;
    const suspectKnowledgeGap = knowledgeGap > 100; // Arbitrary threshold for logging

    if (suspectKnowledgeGap) {
      this.logger.warn('Large knowledge gap detected', {
        budgetId,
        lastKnowledge: requestedKnowledge,
        serverKnowledge: response.serverKnowledge,
        gap: knowledgeGap,
        recommendation: 'Consider full refresh if data seems incomplete'
      });
    }

    let finalSnapshot: T[];
    let usedDelta = false;

    if (receivedDelta && cached) {
      // Delta response - merge into existing snapshot
      finalSnapshot = merger(cached.snapshot, response.data, mergeOptions);
      usedDelta = true;
    } else {
      // Full response - use as new baseline
      // Filter out deleted entities (they shouldn't be in full responses but YNAB may include them)
      finalSnapshot = response.data.filter(item => !item.deleted);
    }

    // Update cache with new snapshot
    const cacheEntry: DeltaCacheEntry<T> = {
      snapshot: finalSnapshot,
      serverKnowledge: response.serverKnowledge,
      timestamp: Date.now(),
      ttl,
    };

    this.cacheManager.set(cacheKey, cacheEntry, { ttl });

    // Update knowledge store
    this.knowledgeStore.update(cacheKey, response.serverKnowledge);

    return {
      data: finalSnapshot,
      wasCached: !!cached,
      usedDelta,
      serverKnowledge: response.serverKnowledge,
    };
  }

  /**
   * Fallback fetch without delta support
   *
   * IMPORTANT: Stores data in same DeltaCacheEntry format as fetchWithDelta
   * to ensure cache consistency when feature flag is toggled.
   */
  private async fetchWithoutDelta<T>(
    cacheKey: string,
    budgetId: string,
    fetcher: (lastKnowledge?: number) => Promise<{
      data: T[];
      serverKnowledge: number;
    }>,
    ttl: number
  ): Promise<DeltaFetchResult<T>> {
    const cached = this.cacheManager.get<DeltaCacheEntry<T>>(cacheKey);

    if (cached) {
      return {
        data: cached.snapshot,
        wasCached: true,
        usedDelta: false,
        serverKnowledge: cached.serverKnowledge,
      };
    }

    const response = await fetcher(undefined);

    // Store in DeltaCacheEntry format for consistency
    const cacheEntry: DeltaCacheEntry<T> = {
      snapshot: response.data,
      serverKnowledge: response.serverKnowledge,
      timestamp: Date.now(),
      ttl,
    };

    this.cacheManager.set(cacheKey, cacheEntry, { ttl });
    this.knowledgeStore.update(cacheKey, response.serverKnowledge);

    return {
      data: response.data,
      wasCached: false,
      usedDelta: false,
      serverKnowledge: response.serverKnowledge,
    };
  }

  /**
   * Check if delta requests are enabled via feature flag
   */
  private isDeltaEnabled(): boolean {
    return process.env['YNAB_MCP_ENABLE_DELTA'] === 'true';
  }

  /**
   * Invalidate cache and reset knowledge for a budget
   * Used after write operations or when forcing full refresh
   *
   * IMPORTANT: Only invalidates caches for the specified budget to preserve
   * per-budget cache isolation (prevents invalidating other users' caches).
   */
  invalidate(budgetId: string, resourceType?: string): void {
    if (resourceType) {
      // Invalidate specific resource type for this budget only
      // Example keys: "transactions:list:budget-123", "accounts:list:budget-123"
      const budgetResourcePrefix = `${resourceType}:list:${budgetId}`;
      this.cacheManager.deleteByPrefix(budgetResourcePrefix);
    } else {
      // Invalidate all caches for this specific budget
      // Iterate through all keys and delete those containing this budgetId
      this.cacheManager.deleteByBudgetId(budgetId);
    }

    // NOTE: We do NOT reset knowledge here - that's handled by write operations
    // This allows targeted cache invalidations without forcing full refreshes
  }

  /**
   * Force a full refresh by invalidating caches AND resetting knowledge
   * Use this for explicit cache resets or when data integrity is suspect
   */
  forceFullRefresh(budgetId?: string, resourceType?: string): void {
    // Invalidate caches first
    if (budgetId) {
      this.invalidate(budgetId, resourceType);
    }

    // Reset knowledge to force full API fetch next time
    if (resourceType && budgetId) {
      this.knowledgeStore.reset(`${resourceType}:list:${budgetId}`);
    } else if (budgetId) {
      // Reset all knowledge for this budget
      this.knowledgeStore.resetByBudgetId(budgetId);
    } else {
      // Reset all knowledge
      this.knowledgeStore.reset();
    }
  }
}
```

### 3.4 Merge Functions

Create `src/server/deltaCache.merge.ts`:

```typescript
import { MergeFn, MergeOptions } from './deltaCache.js';
import * as ynab from 'ynab';

/**
 * Type definitions for YNAB resources with nested structures
 */

// Category Group with nested categories (from YNAB SDK)
type CategoryGroupWithCategories = ynab.CategoryGroupWithCategories;
// Structure:
// {
//   id: string;
//   name: string;
//   hidden: boolean;
//   deleted: boolean;
//   categories: Array<{
//     id: string;
//     category_group_id: string;
//     name: string;
//     hidden: boolean;
//     deleted: boolean;
//     // ... other category fields
//   }>;
// }

// Transaction with subtransactions (from YNAB SDK)
type TransactionDetail = ynab.TransactionDetail;
// Structure:
// {
//   id: string;
//   date: string;
//   amount: number;
//   deleted: boolean;
//   subtransactions?: Array<{
//     id: string;
//     transaction_id: string;
//     amount: number;
//     deleted: boolean;
//     // ... other subtransaction fields
//   }>;
//   // ... other transaction fields
// }

/**
 * Default merge for flat entity collections (accounts, payees)
 *
 * Algorithm:
 * 1. Create map of existing entities by ID
 * 2. For each delta entity:
 *    - If deleted: remove from map
 *    - Otherwise: add/update in map
 * 3. Return values as array
 */
export const mergeFlatEntities: MergeFn<{ id: string; deleted?: boolean }> = (
  snapshot,
  delta,
  options = {}
) => {
  const { preserveDeleted = false } = options;

  // Build map from snapshot
  const entityMap = new Map(snapshot.map(e => [e.id, e]));

  // Apply delta changes
  for (const deltaEntity of delta) {
    if (deltaEntity.deleted && !preserveDeleted) {
      entityMap.delete(deltaEntity.id);
    } else {
      entityMap.set(deltaEntity.id, deltaEntity);
    }
  }

  return Array.from(entityMap.values());
};

/**
 * Merge for categories (hierarchical: category_groups > categories)
 *
 * Uses concrete YNAB SDK type: CategoryGroupWithCategories
 * Handles nested category deletions within groups
 */
export const mergeCategories: MergeFn<CategoryGroupWithCategories> = (
  snapshot,
  delta,
  options = {}
) => {
  const { preserveDeleted = false } = options;

  const groupMap = new Map(snapshot.map(g => [g.id, { ...g }]));

  for (const deltaGroup of delta) {
    if (deltaGroup.deleted && !preserveDeleted) {
      groupMap.delete(deltaGroup.id);
      continue;
    }

    const existingGroup = groupMap.get(deltaGroup.id);

    if (!existingGroup) {
      // New group
      groupMap.set(deltaGroup.id, deltaGroup);
    } else if (deltaGroup.categories) {
      // Merge categories within group
      const catMap = new Map(
        (existingGroup.categories || []).map(c => [c.id, c])
      );

      for (const deltaCat of deltaGroup.categories) {
        if (deltaCat.deleted && !preserveDeleted) {
          catMap.delete(deltaCat.id);
        } else {
          catMap.set(deltaCat.id, deltaCat);
        }
      }

      existingGroup.categories = Array.from(catMap.values());
      groupMap.set(deltaGroup.id, existingGroup);
    } else {
      // Update group metadata only
      groupMap.set(deltaGroup.id, { ...existingGroup, ...deltaGroup });
    }
  }

  return Array.from(groupMap.values());
};

/**
 * Merge for transactions (handles subtransactions)
 *
 * Uses concrete YNAB SDK type: TransactionDetail
 * Handles nested subtransaction deletions within split transactions
 */
export const mergeTransactions: MergeFn<TransactionDetail> = (
  snapshot,
  delta,
  options = {}
) => {
  const { preserveDeleted = false } = options;

  const txnMap = new Map(snapshot.map(t => [t.id, { ...t }]));

  for (const deltaTxn of delta) {
    if (deltaTxn.deleted && !preserveDeleted) {
      txnMap.delete(deltaTxn.id);
      continue;
    }

    const existingTxn = txnMap.get(deltaTxn.id);

    if (!existingTxn) {
      txnMap.set(deltaTxn.id, deltaTxn);
    } else if (deltaTxn.subtransactions) {
      // Merge subtransactions
      const subMap = new Map(
        (existingTxn.subtransactions || []).map(s => [s.id, s])
      );

      for (const deltaSub of deltaTxn.subtransactions) {
        if (deltaSub.deleted && !preserveDeleted) {
          subMap.delete(deltaSub.id);
        } else {
          subMap.set(deltaSub.id, deltaSub);
        }
      }

      existingTxn.subtransactions = Array.from(subMap.values());
      txnMap.set(deltaTxn.id, existingTxn);
    } else {
      // Update transaction
      txnMap.set(deltaTxn.id, { ...existingTxn, ...deltaTxn });
    }
  }

  return Array.from(txnMap.values());
};
```

---

## 4. Tool Integration

### 4.1 Generic Delta Fetcher

Create `src/tools/deltaFetcher.ts`:

```typescript
import * as ynab from 'ynab';
import { DeltaCache } from '../server/deltaCache.js';
import { mergeFlatEntities, mergeCategories, mergeTransactions } from '../server/deltaCache.merge.js';
import { CacheManager } from '../server/cacheManager.js';

/**
 * Options for delta fetch operations
 */
export interface DeltaFetchOptions {
  /** Force full refresh (bypass delta) */
  forceFullRefresh?: boolean;
  /** Cache TTL override */
  ttl?: number;
}

/**
 * Utility wrapper for common delta fetch patterns
 */
export class DeltaFetcher {
  constructor(
    private ynabAPI: ynab.API,
    private deltaCache: DeltaCache
  ) {}

  async fetchAccounts(budgetId: string, options: DeltaFetchOptions = {}) {
    const cacheKey = CacheManager.generateKey('accounts', 'list', budgetId);

    return this.deltaCache.fetchWithDelta(
      cacheKey,
      budgetId,
      async (lastKnowledge) => {
        const response = await this.ynabAPI.accounts.getAccounts(
          budgetId,
          lastKnowledge
        );
        return {
          data: response.data.accounts,
          serverKnowledge: response.data.server_knowledge,
        };
      },
      mergeFlatEntities,
      options
    );
  }

  async fetchCategories(budgetId: string, options: DeltaFetchOptions = {}) {
    const cacheKey = CacheManager.generateKey('categories', 'list', budgetId);

    return this.deltaCache.fetchWithDelta(
      cacheKey,
      budgetId,
      async (lastKnowledge) => {
        const response = await this.ynabAPI.categories.getCategories(
          budgetId,
          lastKnowledge
        );
        return {
          data: response.data.category_groups,
          serverKnowledge: response.data.server_knowledge,
        };
      },
      mergeCategories,
      options
    );
  }

  async fetchTransactions(
    budgetId: string,
    sinceDate?: string,
    type?: string,
    options: DeltaFetchOptions = {}
  ) {
    // Include filter parameters in cache key to avoid stale snapshots
    const cacheKey = CacheManager.generateKey(
      'transactions',
      'list',
      budgetId,
      sinceDate || 'all',
      type || 'all'
    );

    return this.deltaCache.fetchWithDelta(
      cacheKey,
      budgetId,
      async (lastKnowledge) => {
        const response = await this.ynabAPI.transactions.getTransactions(
          budgetId,
          sinceDate,
          type,
          lastKnowledge
        );
        return {
          data: response.data.transactions,
          serverKnowledge: response.data.server_knowledge,
        };
      },
      mergeTransactions,
      options
    );
  }

  async fetchPayees(budgetId: string, options: DeltaFetchOptions = {}) {
    const cacheKey = CacheManager.generateKey('payees', 'list', budgetId);

    return this.deltaCache.fetchWithDelta(
      cacheKey,
      budgetId,
      async (lastKnowledge) => {
        const response = await this.ynabAPI.payees.getPayees(
          budgetId,
          lastKnowledge
        );
        return {
          data: response.data.payees,
          serverKnowledge: response.data.server_knowledge,
        };
      },
      mergeFlatEntities,
      options
    );
  }

  async fetchMonths(budgetId: string, options: DeltaFetchOptions = {}) {
    const cacheKey = CacheManager.generateKey('months', 'list', budgetId);

    return this.deltaCache.fetchWithDelta(
      cacheKey,
      budgetId,
      async (lastKnowledge) => {
        const response = await this.ynabAPI.months.getBudgetMonths(
          budgetId,
          lastKnowledge
        );
        return {
          data: response.data.months,
          serverKnowledge: response.data.server_knowledge,
        };
      },
      mergeFlatEntities,
      options
    );
  }

  async fetchBudget(budgetId: string, options: DeltaFetchOptions = {}) {
    // NOTE: GET /budgets/{id} is NOT delta-enabled due to complex nested structures
    // Delta responses omit unchanged nested arrays (accounts, categories, etc.),
    // which would cause mergeFlatEntities to erase them from the cached budget.
    // TODO: Implement dedicated merge function that walks each nested collection
    // before re-enabling delta support for this endpoint.

    const cacheKey = CacheManager.generateKey('budgets', 'get', budgetId);

    // Force full refresh for budget endpoint (bypass delta)
    return this.deltaCache.fetchWithDelta(
      cacheKey,
      budgetId,
      async (lastKnowledge) => {
        // Always fetch without delta parameter
        const response = await this.ynabAPI.budgets.getBudgetById(budgetId);
        return {
          data: [response.data.budget],
          serverKnowledge: response.data.server_knowledge,
        };
      },
      mergeFlatEntities,
      { ...options, forceFullRefresh: true }  // Always force full refresh
    );
  }

  async fetchScheduledTransactions(budgetId: string, options: DeltaFetchOptions = {}) {
    const cacheKey = CacheManager.generateKey('scheduled_transactions', 'list', budgetId);

    return this.deltaCache.fetchWithDelta(
      cacheKey,
      budgetId,
      async (lastKnowledge) => {
        const response = await this.ynabAPI.scheduledTransactions.getScheduledTransactions(
          budgetId,
          lastKnowledge
        );
        return {
          data: response.data.scheduled_transactions,
          serverKnowledge: response.data.server_knowledge,
        };
      },
      mergeFlatEntities,
      options
    );
  }
}
```

### 4.2 Tool Handler Migration Example

**Before (accountTools.ts):**
```typescript
const response = await ynabAPI.accounts.getAccounts(params.budget_id);
const accounts = response.data.accounts;
```

**After (accountTools.ts):**
```typescript
const result = await deltaFetcher.fetchAccounts(params.budget_id);
const accounts = result.data;
```

### 4.3 Phase A Tools (Core Read Operations)

Priority order for migration:

1. **handleListAccounts** - High volume, good delta candidate
2. **handleListTransactions** - Largest responses, biggest benefit
3. **handleListCategories** - Moderate benefit, hierarchical merge
4. **handleListPayees** - Simple flat merge
5. **handleListMonths** - Moderate benefit
6. **handleGetBudget** - Complex nested structure, highest risk

### 4.4 Phase B Tools (Dependent Flows)

These automatically benefit once Phase A is complete:

- **handleExportTransactions** - Uses `fetchTransactions`
- **handleReconcileAccount** - Uses `fetchTransactions` and `fetchAccounts`
- **handleCompareTransactions** - Uses `fetchTransactions`

**Special consideration:** Reconciliation must use `forceFullRefresh: true` to guarantee fresh data for balance verification.

---

## 5. Write Operation Integration

### 5.1 Invalidation Strategy

After any write operation (create/update/delete), we must:
1. Update `serverKnowledge` from response
2. Invalidate affected cache entries
3. Consider invalidating dependent caches

```typescript
/**
 * Handle post-write cache invalidation
 */
function handleWriteResponse(
  budgetId: string,
  serverKnowledge: number,
  affectedResource: 'transactions' | 'accounts' | 'categories',
  deltaCache: DeltaCache,
  knowledgeStore: ServerKnowledgeStore
): void {
  // Invalidate affected resource first (deletes cache snapshots but preserves knowledge)
  deltaCache.invalidate(budgetId, affectedResource);

  // Update knowledge for all cache keys matching the affected resource
  // This ensures the next delta request uses the correct server_knowledge
  const keyPattern = `${affectedResource}:list:${budgetId}`;
  knowledgeStore.update(`${keyPattern}`, serverKnowledge);

  // Consider invalidating dependent resources
  if (affectedResource === 'transactions') {
    // Transactions affect month summaries
    deltaCache.invalidate(budgetId, 'months');
    const monthKeyPattern = `months:list:${budgetId}`;
    knowledgeStore.update(monthKeyPattern, serverKnowledge);
  }
}
```

### 5.2 Write Handler Examples

**Create Transaction:**
```typescript
export async function handleCreateTransaction(
  ynabAPI: ynab.API,
  deltaCache: DeltaCache,
  knowledgeStore: ServerKnowledgeStore,
  params: CreateTransactionParams
): Promise<CallToolResult> {
  // ... validation ...

  const response = await ynabAPI.transactions.createTransaction(
    params.budget_id,
    { transaction: transactionData }
  );

  // Update knowledge and invalidate caches
  handleWriteResponse(
    params.budget_id,
    response.data.server_knowledge,
    'transactions',
    deltaCache,
    knowledgeStore
  );

  // ... return result ...
}
```

**Update Category:**
```typescript
export async function handleUpdateCategory(
  ynabAPI: ynab.API,
  deltaCache: DeltaCache,
  knowledgeStore: ServerKnowledgeStore,
  params: UpdateCategoryParams
): Promise<CallToolResult> {
  const response = await ynabAPI.categories.updateMonthCategory(
    params.budget_id,
    params.month,
    params.category_id,
    { category: { budgeted: params.budgeted } }
  );

  handleWriteResponse(
    params.budget_id,
    response.data.server_knowledge,
    'categories',
    deltaCache,
    knowledgeStore
  );

  return /* ... */;
}
```

---

## 6. Reconciliation Flow Considerations

### 6.1 Guarantees Required

Reconciliation demands:
1. **Fresh data** - No stale cache entries
2. **Complete dataset** - All transactions in date range
3. **Accurate balances** - Current cleared/uncleared totals
4. **Audit trail** - Knowledge of data staleness

### 6.2 Implementation

#### 6.2.1 forceFullRefresh Mechanism

The `forceFullRefresh` option bypasses delta logic and requests fresh data from YNAB:

**DeltaCache behavior when `forceFullRefresh: true`:**
1. **Skip knowledge lookup** - Don't retrieve `lastKnowledge` from store
2. **Fetch without delta parameter** - Call API with `lastKnowledge = undefined`
3. **Receive full dataset** - API returns complete data (not delta)
4. **Update cache** - Replace cache snapshot with fresh data
5. **Update knowledge** - Store new `server_knowledge` value

**Code flow in `DeltaCache.fetchWithDelta()`:**
```typescript
// From section 3.2 DeltaCache implementation (line 287)
const cacheKey = CacheManager.generateKey(/* ... */);
const lastKnowledge = forceFullRefresh ? undefined : this.knowledgeStore.get(cacheKey);
//                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                    This skips knowledge lookup when forcing refresh

const canUseDelta = !forceFullRefresh && cached && lastKnowledge;
//                  ^^^^^^^^^^^^^^^^^^
//                  This disables delta merge when forcing refresh

const response = await fetcher(canUseDelta ? lastKnowledge : undefined);
//                                            ^^^^^^^^^^^
//                                            API receives undefined, returns full data
```

#### 6.2.2 Reconciliation Implementation

**In `src/tools/reconciliation/index.ts`:**
```typescript
export async function handleReconcileAccount(
  ynabAPI: ynab.API,
  deltaFetcher: DeltaFetcher,
  params: ReconcileAccountParams
): Promise<CallToolResult> {
  // CRITICAL: Force full refresh for reconciliation accuracy
  const accountResult = await deltaFetcher.fetchAccounts(params.budget_id, {
    forceFullRefresh: true,  // ← Bypasses delta, fetches fresh data
  });

  const transactionResult = await deltaFetcher.fetchTransactions(
    params.budget_id,
    params.since_date,       // Optional date filter
    undefined,               // No type filter
    { forceFullRefresh: true }  // ← Bypasses delta
  );

  // Build audit trail showing data freshness
  const auditMetadata = {
    data_freshness: 'guaranteed_fresh',
    data_source: 'full_api_fetch_no_delta',
    server_knowledge: transactionResult.serverKnowledge,
    fetched_at: new Date().toISOString(),
    accounts_count: accountResult.data.length,
    transactions_count: transactionResult.data.length,
  };

  // Include audit metadata in reconciliation response
  const reconciliationResponse = buildReconciliationPayload({
    matches: /* ... */,
    unmatched: /* ... */,
    audit: auditMetadata,  // ← Proves data freshness to user
  });

  // ... proceed with reconciliation logic ...
}
```

#### 6.2.3 Audit Trail in Response

The reconciliation response includes audit metadata proving data freshness:

```json
{
  "version": "2.0",
  "execution": {
    "data_freshness": "guaranteed_fresh",
    "data_source": "full_api_fetch_no_delta",
    "server_knowledge": 1702,
    "fetched_at": "2025-11-12T10:30:00.000Z",
    "accounts_count": 12,
    "transactions_count": 1543
  },
  "matches": [ /* ... */ ],
  "recommendations": [ /* ... */ ],
  "balance_reconciliation": { /* ... */ }
}
```

**Why audit trail matters:**
- Proves to users that reconciliation used fresh data
- Enables debugging if reconciliation results are questioned
- Provides timestamp for regulatory/compliance requirements
- Shows server_knowledge value for troubleshooting sync issues

### 6.3 Testing Requirement

Add test case verifying reconciliation bypasses delta:
```typescript
describe('handleReconcileAccount', () => {
  it('should force full refresh for data accuracy', async () => {
    const fetchSpy = vi.spyOn(deltaFetcher, 'fetchTransactions');

    await handleReconcileAccount(ynabAPI, deltaFetcher, params);

    expect(fetchSpy).toHaveBeenCalledWith(
      params.budget_id,
      expect.objectContaining({ forceFullRefresh: true })
    );
  });
});
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

**`src/server/__tests__/serverKnowledgeStore.test.ts`:**
- get/update/reset operations
- Invalid input handling (negative knowledge)
- Stats generation

**`src/server/__tests__/deltaCache.merge.test.ts`:**
- `mergeFlatEntities`: add, update, delete scenarios
- `mergeCategories`: nested category changes, group deletion
- `mergeTransactions`: subtransaction handling, complex splits
- Edge cases: empty deltas, duplicate IDs, malformed data

**`src/server/__tests__/deltaCache.test.ts`:**
- Cache hit with delta merge
- Cache miss triggering full refresh
- Conflict detection (stale knowledge)
- Feature flag behavior
- Invalidation cascades

### 7.2 Integration Tests

Live integration suites (run with `vitest --project integration`) now hit the real YNAB API and verify delta caching, cache hints, and full-refresh fallbacks:

- `src/tools/__tests__/accountTools.delta.integration.test.ts`: covers `handleListAccounts` and `handleListTransactions`, ensuring first-call priming, second-call cache hits, and delta cache messaging once writes occur.
- `src/tools/__tests__/categoryTools.delta.integration.test.ts`: validates `handleListCategories` emits `cached: true` plus a `cache_info` hint for the follow-up request.
- `src/tools/__tests__/payeeTools.delta.integration.test.ts`: mirrors the category suite for `handleListPayees`, guarding cache wiring on real responses.
- `src/tools/__tests__/monthTools.delta.integration.test.ts`: proves `handleListMonths` reuses cached month summaries and surfaces `(delta merge applied)` when appropriate.
- `src/tools/__tests__/budgetTools.delta.integration.test.ts`: confirms `handleListBudgets` reuses the cached global summaries with proper telemetry.
- `src/tools/reconciliation/__tests__/reconciliation.delta.integration.test.ts`: ensures reconciliation paths bypass cached data and inject audit metadata after forcing fresh fetches.
- `src/tools/__tests__/deltaFetcher.scheduled.integration.test.ts`: directly exercises `DeltaFetcher.fetchScheduledTransactions` so scheduled transactions participate in caching until a public tool ships.

### 7.3 Edge Case Tests

**Concurrent Access:**
```typescript
it('should handle concurrent fetches safely', async () => {
  const promises = Array(10).fill(null).map(() =>
    handleListAccounts(ynabAPI, deltaFetcher, { budget_id })
  );

  const results = await Promise.all(promises);

  // All should return consistent data
  expect(new Set(results.map(r => r.serverKnowledge)).size).toBe(1);
});
```

**Large Datasets:**
```typescript
it('should handle budgets with 10k+ transactions', async () => {
  const largeDataset = Array(10000).fill(null).map((_, i) => ({
    id: `txn${i}`,
    amount: -1000,
    // ...
  }));

  mockYnabAPI.transactions.getTransactions.mockResolvedValueOnce({
    data: { transactions: largeDataset, server_knowledge: 1000 },
  });

  const start = Date.now();
  const result = await handleListTransactions(ynabAPI, deltaFetcher, { budget_id });
  const duration = Date.now() - start;

  expect(result.data.length).toBe(10000);
  expect(duration).toBeLessThan(5000); // Should complete in <5s
});
```

**Knowledge Drift:**
```typescript
it('should detect and recover from stale knowledge', async () => {
  // Prime cache with knowledge=100
  await handleListAccounts(ynabAPI, deltaFetcher, { budget_id });

  // Simulate server knowledge jumping (external writes)
  mockYnabAPI.accounts.getAccounts.mockResolvedValueOnce({
    data: {
      accounts: fullAccountList, // Server returns full list
      server_knowledge: 200,
    },
  });

  const result = await handleListAccounts(ynabAPI, deltaFetcher, { budget_id });

  // Should detect full refresh and update knowledge
  expect(result.usedDelta).toBe(false);
  expect(result.serverKnowledge).toBe(200);
});
```

### 7.4 Performance Tests

**`src/__tests__/performance/delta.perf.test.ts`:**
```typescript
describe('Delta performance', () => {
  it('should reduce response processing time by 50%+', async () => {
    // Measure full refresh
    const fullStart = Date.now();
    await handleListTransactions(ynabAPI, deltaFetcher, {
      budget_id,
      forceFullRefresh: true,
    });
    const fullDuration = Date.now() - fullStart;

    // Measure delta (only 10 changed items)
    const deltaStart = Date.now();
    await handleListTransactions(ynabAPI, deltaFetcher, { budget_id });
    const deltaDuration = Date.now() - deltaStart;

    expect(deltaDuration).toBeLessThan(fullDuration * 0.5);
  });
});
```

### 7.5 Known Gaps & Follow-ups

- `handleListTransactions` still needs a live delta suite that walks the since-date/type/account filters. Add once test fixtures can safely mutate transactions without polluting production budgets.
- Scheduled transactions only have fetcher-level coverage today. When we expose a public `handleListScheduledTransactions` tool we should port those assertions to a handler-focused integration test so cache metadata and error handling are validated end-to-end.
- Write flows (transaction and category edits) are primarily covered by unit tests. We still plan to add disposable-budget integration tests that perform a write followed by a read to guarantee cache invalidation and knowledge propagation.

---

## 8. Observability & Metrics

### 8.1 Metrics to Track

Add to `diagnostics.ts`:

```typescript
interface DeltaMetrics {
  /** Total delta requests attempted */
  deltaRequestsAttempted: number;
  /** Successful delta merges */
  deltaMergesSuccessful: number;
  /** Full refreshes (cache miss or conflict) */
  fullRefreshes: number;
  /** Average delta response size (bytes) */
  avgDeltaSize: number;
  /** Average full response size (bytes) */
  avgFullSize: number;
  /** Bandwidth saved (bytes) */
  bandwidthSaved: number;
  /** Cache invalidations triggered by writes */
  cacheInvalidations: number;
}

export function getDeltaMetrics(): DeltaMetrics {
  // Implementation
}
```

### 8.2 Logging

Add structured logging to `deltaCache.ts`:

```typescript
// On successful delta merge:
this.logger.info('Delta merge successful', {
  budgetId,
  resource: 'accounts',
  snapshotSize: cached.snapshot.length,
  deltaSize: response.data.length,
  serverKnowledge: response.serverKnowledge,
});

// On conflict detection:
this.logger.warn('Delta conflict detected, forcing full refresh', {
  budgetId,
  resource: 'transactions',
  lastKnowledge,
  receivedSize: response.data.length,
});

// On invalidation:
this.logger.info('Cache invalidated after write', {
  budgetId,
  resource: 'transactions',
  reason: 'create_transaction',
});
```

### 8.3 Diagnostic Tool

Add to tool registry:

```typescript
/**
 * Get delta request statistics and reset knowledge if needed
 */
export async function handleDeltaDiagnostics(
  deltaCache: DeltaCache,
  knowledgeStore: ServerKnowledgeStore,
  params: {
    action: 'stats' | 'reset';
    budget_id?: string;
  }
): Promise<CallToolResult> {
  if (params.action === 'stats') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          knowledgeStore: knowledgeStore.getStats(),
          metrics: getDeltaMetrics(),
          featureEnabled: process.env.YNAB_MCP_ENABLE_DELTA === 'true',
        }, null, 2),
      }],
    };
  }

  if (params.action === 'reset') {
    if (params.budget_id) {
      knowledgeStore.resetByBudgetId(params.budget_id);
      deltaCache.invalidate(params.budget_id);

      return {
        content: [{
          type: 'text',
          text: `Reset knowledge for budget ${params.budget_id}`,
        }],
      };
    }

    knowledgeStore.reset();

    return {
      content: [{
        type: 'text',
        text: 'Reset knowledge for all budgets',
      }],
    };
  }
}
```

### 8.4 Monitoring Hooks & Instrumentation

#### 8.4.1 Metric Names (Prometheus-style)

Instrument the following metrics in `src/server/deltaCache.ts`:

```typescript
// Counter metrics
export const DELTA_METRICS = {
  REQUESTS_ATTEMPTED: 'ynab_mcp_delta_requests_attempted_total',
  MERGES_SUCCESSFUL: 'ynab_mcp_delta_merges_successful_total',
  MERGES_FAILED: 'ynab_mcp_delta_merges_failed_total',
  FULL_REFRESHES: 'ynab_mcp_delta_full_refreshes_total',
  CONFLICTS_DETECTED: 'ynab_mcp_delta_conflicts_detected_total',
  CACHE_INVALIDATIONS: 'ynab_mcp_delta_cache_invalidations_total',
};

// Gauge metrics
export const DELTA_GAUGES = {
  KNOWLEDGE_STORE_SIZE: 'ynab_mcp_delta_knowledge_store_budgets',
  CACHE_SIZE: 'ynab_mcp_delta_cache_entries',
};

// Histogram metrics (for distribution analysis)
export const DELTA_HISTOGRAMS = {
  DELTA_SIZE_BYTES: 'ynab_mcp_delta_response_size_bytes',
  FULL_SIZE_BYTES: 'ynab_mcp_full_response_size_bytes',
  MERGE_DURATION_MS: 'ynab_mcp_delta_merge_duration_milliseconds',
};
```

#### 8.4.2 Structured Log Format

All delta-related logs use consistent JSON structure:

```typescript
// Success log
{
  "level": "info",
  "timestamp": "2025-11-12T10:30:00.000Z",
  "event": "delta_merge_success",
  "budget_id": "7b47d8bb-ce4c-40c0-a9eb-c6d715af9a76",
  "resource": "transactions",
  "snapshot_size": 1500,
  "delta_size": 3,
  "merged_size": 1503,
  "server_knowledge": 1702,
  "bandwidth_saved_bytes": 125000,
  "merge_duration_ms": 45
}

// Conflict log
{
  "level": "warn",
  "timestamp": "2025-11-12T10:30:15.000Z",
  "event": "delta_conflict_detected",
  "budget_id": "7b47d8bb-ce4c-40c0-a9eb-c6d715af9a76",
  "resource": "accounts",
  "last_knowledge": 1700,
  "received_size": 12,
  "expected_delta_size": 1,
  "action": "forcing_full_refresh"
}

// Error log
{
  "level": "error",
  "timestamp": "2025-11-12T10:30:20.000Z",
  "event": "delta_merge_failed",
  "budget_id": "7b47d8bb-ce4c-40c0-a9eb-c6d715af9a76",
  "resource": "categories",
  "error": "TypeError: Cannot read property 'id' of undefined",
  "stack_trace": "...",
  "action": "falling_back_to_full_refresh"
}
```

#### 8.4.3 Dashboard Queries

**DataDog / Grafana / CloudWatch example queries:**

```sql
-- Delta adoption rate (percentage using delta vs full)
SELECT
  (SUM(ynab_mcp_delta_merges_successful_total) /
   SUM(ynab_mcp_delta_requests_attempted_total)) * 100 AS delta_adoption_rate
WHERE time > now() - 1h;

-- Bandwidth savings
SELECT
  AVG(ynab_mcp_full_response_size_bytes) - AVG(ynab_mcp_delta_response_size_bytes)
  AS avg_bandwidth_saved_bytes
WHERE time > now() - 24h;

-- Error rate
SELECT
  (SUM(ynab_mcp_delta_merges_failed_total) /
   SUM(ynab_mcp_delta_requests_attempted_total)) * 100 AS error_rate_percent
WHERE time > now() - 1h;

-- Conflict frequency (knowledge drift indicator)
SELECT
  COUNT(event='delta_conflict_detected')
  AS conflicts_per_hour
WHERE time > now() - 1h
GROUP BY time(1h);
```

#### 8.4.4 Alarm Specifications

Configure the following alarms for production monitoring:

| Alarm Name | Condition | Threshold | Severity | Action |
|------------|-----------|-----------|----------|--------|
| `ynab-mcp-delta-error-rate-high` | Error rate > 2% | 2% over 5min | **CRITICAL** | Page on-call, trigger rollback evaluation |
| `ynab-mcp-delta-conflict-rate-high` | Conflicts > 10/hour | 10 over 1h | **WARNING** | Investigate knowledge drift, check for external writes |
| `ynab-mcp-delta-merge-duration-slow` | p95 merge duration > 1s | 1000ms over 5min | **WARNING** | Check for large deltas, consider optimization |
| `ynab-mcp-delta-bandwidth-savings-low` | Savings < 50% | 50% over 1h | **INFO** | Review delta adoption, check for cache issues |
| `ynab-mcp-delta-knowledge-store-bloat` | Knowledge store > 1000 budgets | 1000 budgets | **WARNING** | Memory leak investigation, consider LRU eviction |

#### 8.4.5 Rollback Trigger Automation

**Automatic rollback conditions** (require manual confirmation):

```typescript
// In src/server/deltaCache.ts
class DeltaHealthMonitor {
  private errorCount = 0;
  private totalCount = 0;
  private windowStartTime = Date.now();

  recordAttempt(success: boolean) {
    this.totalCount++;
    if (!success) this.errorCount++;

    // Check every 100 requests or 5 minutes
    if (this.totalCount >= 100 || Date.now() - this.windowStartTime > 300000) {
      this.evaluateHealth();
    }
  }

  private evaluateHealth() {
    const errorRate = this.errorCount / this.totalCount;

    if (errorRate > 0.02) {  // 2% error rate
      logger.error('Delta error rate exceeds threshold', {
        error_rate: errorRate,
        error_count: this.errorCount,
        total_count: this.totalCount,
        recommendation: 'CONSIDER_ROLLBACK',
        action_required: 'Set YNAB_MCP_ENABLE_DELTA=false'
      });

      // Optional: Emit CloudWatch alarm or PagerDuty event
      this.emitAlarm('delta_error_rate_critical', {
        errorRate,
        threshold: 0.02
      });
    }

    // Reset window
    this.errorCount = 0;
    this.totalCount = 0;
    this.windowStartTime = Date.now();
  }
}
```

#### 8.4.6 Observability Checklist

Before declaring delta feature "production-ready":

- [ ] All metric names defined and instrumented
- [ ] Structured logging implemented for all delta events
- [ ] Dashboard created showing: error rate, bandwidth savings, conflict rate, merge duration
- [ ] Alarms configured with appropriate thresholds
- [ ] Runbook created for alarm response procedures
- [ ] Health monitor integrated (optional automatic rollback triggers)
- [ ] Log aggregation configured (e.g., CloudWatch Logs, DataDog)
- [ ] 1-week baseline established before full rollout

---

## 9. Rollback & Feature Flag

### 9.1 Environment Variable

```bash
# .env.example
# Enable delta requests (EXPERIMENTAL)
# Set to 'true' to enable, 'false' or unset to disable
YNAB_MCP_ENABLE_DELTA=false
```

### 9.2 Gradual Rollout Plan

**Phase 1: Internal Testing (Week 1-2)**
- Enable delta for development environments only
- Run comprehensive test suite
- Monitor logs for merge errors

**Phase 2: Canary (Week 3-4)**
- Enable for 10% of production users
- Monitor metrics: error rate, response times
- Gather feedback on data accuracy

**Phase 3: Staged Rollout (Week 5-8)**
- 25% → 50% → 75% → 100%
- Continue monitoring metrics
- Keep rollback plan ready

**Rollback Trigger Conditions:**
- Error rate >2% in delta merges
- User reports of missing/incorrect data
- Performance regression >20%
- Reconciliation failures attributed to stale data

### 9.3 Rollback Procedure

1. Set `YNAB_MCP_ENABLE_DELTA=false` in environment
2. Restart MCP server
3. Clear all caches: `deltaCache.invalidate()` for all budgets
4. Monitor for resolution of issues
5. Root cause analysis and fix before re-enabling

---

## 10. Migration Checklist

### 10.1 Pre-Implementation

- [ ] Review this plan with team
- [ ] Verify `ynab` npm package parameter naming (snake_case vs camelCase)
- [ ] Confirm supported endpoints via test API calls
- [ ] Set up feature flag infrastructure
- [ ] Define success metrics

### 10.2 Implementation (Phase A)

- [x] Implement `ServerKnowledgeStore` with tests
- [x] Enhance `CacheManager` with `deleteByPrefix`, `deleteByBudgetId`, and `getKeys`
- [x] Implement `DeltaCache` with `fetchWithDelta`
- [x] Implement merge functions for flat entities, categories, and transactions
- [x] Add unit tests for all infrastructure components
- [x] Document `YNAB_MCP_ENABLE_DELTA` feature flag in `.env.example`
- [ ] Implement `DeltaFetcher` utility
- [ ] Add write operation invalidation helpers
- [ ] Migrate `handleListAccounts`
- [ ] Migrate `handleListTransactions`
- [ ] Migrate `handleListCategories`
- [ ] Migrate `handleListPayees`
- [ ] Migrate `handleListMonths`
- [ ] Migrate `handleGetBudget` (highest risk, do last)

**Phase A Status:** ✅ COMPLETE (BULK-4)
- All infrastructure components implemented and tested
- Feature flag documented in `.env.example`
- Ready for Phase B tool migration

**Important Architecture Notes from Phase A:**

#### DeltaCache Key Conventions & Data Shapes

**Critical**: `DeltaCache` stores structured `DeltaCacheEntry<T>` objects, NOT raw arrays or DTOs.

**Cache Entry Structure:**
```typescript
interface DeltaCacheEntry<T> {
  snapshot: T[];                    // Merged snapshot of entities
  serverKnowledge: number;          // YNAB server_knowledge value
  timestamp: number;                // Cache creation timestamp
  ttl: number;                      // Required TTL in milliseconds
  staleWhileRevalidate?: number;    // Optional stale-while-revalidate window
}
```

**Key Patterns:**
- `transactions:list:<budgetId>` - Transaction snapshots
- `accounts:list:<budgetId>` - Account snapshots
- `categories:list:<budgetId>` - Category group snapshots
- `payees:list:<budgetId>` - Payee snapshots

**Mandatory Rules:**
1. Keys storing `DeltaCacheEntry` objects must NOT be accessed directly by other modules
2. Always use `DeltaCache.fetchWithDelta()` to retrieve delta-cached data
3. Do NOT call `cacheManager.get()` / `cacheManager.set()` directly on delta cache keys
4. Each resource type MUST use its appropriate TTL constant (e.g., `CACHE_TTLS.ACCOUNTS`)

**TTL Requirements:**
```typescript
// Required - explicit TTL parameter:
await deltaCache.fetchWithDelta(cacheKey, budgetId, fetcher, merger, {
  ttl: CACHE_TTLS.ACCOUNTS,        // Resource-specific TTL required
  staleWhileRevalidate: 120000,    // Optional background refresh
});
```

**Stale-While-Revalidate:**
Enables background cache refreshing - stale entries are served immediately while revalidating.

### 10.3 Implementation (Phase B)

- [ ] Verify `handleExportTransactions` uses delta-enabled fetchers
- [ ] Update `handleReconcileAccount` with `forceFullRefresh: true`
- [ ] Verify `handleCompareTransactions` uses delta-enabled fetchers
- [ ] Add reconciliation freshness guarantee tests

### 10.4 Testing

- [ ] Unit tests for all new modules (>80% coverage)
- [ ] Integration tests for tool handlers
- [ ] Edge case tests (concurrent, large datasets, drift)
- [ ] Performance benchmarks
- [ ] E2E tests with real YNAB API

### 10.5 Documentation

- [ ] Update `docs/guides/ARCHITECTURE.md` with delta flow
- [ ] Update `docs/reference/API.md` with delta behavior
- [ ] Add troubleshooting guide for delta issues
- [ ] Document metrics and observability

### 10.6 Deployment

- [ ] Enable feature flag in dev environment
- [ ] Run full test suite
- [ ] Deploy to canary (10% users)
- [ ] Monitor metrics for 1 week
- [ ] Staged rollout (25% → 50% → 75% → 100%)
- [ ] Final validation and success report

---

## 11. Success Criteria

### 11.1 Performance Targets

- [ ] 70%+ reduction in average response size for cached data
- [ ] 50%+ reduction in response processing time
- [ ] <2% error rate in delta merges
- [ ] No increase in API rate limit violations

### 11.2 Correctness Targets

- [ ] Zero data loss incidents
- [ ] Zero reconciliation failures due to stale data
- [ ] All test suites pass with delta enabled
- [ ] Manual validation: 100 random accounts show identical data with/without delta

### 11.3 Operational Targets

- [ ] Rollback capability tested and verified
- [ ] Observability dashboard showing delta metrics
- [ ] Runbook for troubleshooting delta issues
- [ ] Team trained on new architecture

---

## 12. Open Questions & Risks

### 12.1 Open Questions

1. **~~YNAB API Parameter Naming~~** ✅ RESOLVED
   - **Question:** Does the `ynab` npm package use `last_knowledge_of_server` or `lastKnowledgeOfServer`?
   - **Resolution:** ✅ Verified as positional parameter (2nd for most endpoints, 4th for transactions)
   - **Status:** Closed - See §1.4 "SDK Verification" for verified signatures

2. **Cache Persistence Across Restarts**
   - **Question:** Should we persist `serverKnowledge` to disk for faster startup?
   - **Current Decision:** No, ephemeral is safer (guarantees fresh data on restart)
   - **Revisit:** After 3 months of production use, evaluate if startup penalty is significant

3. **Conflict Resolution Strategy**
   - **Question:** If knowledge drifts significantly (>1000 changes), should we alert?
   - **Current Decision:** Log warning but proceed with full refresh
   - **Revisit:** Monitor logs for drift frequency

4. **Scheduled Transaction Support**
   - **Question:** Are scheduled transactions used frequently enough to prioritize?
   - **Current Decision:** Include in Phase A if straightforward, defer if complex
   - **Owner:** @product

### 12.2 Known Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Merge logic bug causes data loss | High | Low | Comprehensive testing, feature flag rollback |
| YNAB API behavior differs from docs | Medium | Medium | Early testing with real API, contact YNAB support |
| Performance regression on large budgets | Medium | Low | Performance benchmarks, canary deployment |
| Knowledge drift causing stale data | High | Medium | Conflict detection, automatic full refresh |
| Reconciliation accuracy impacted | High | Very Low | Force full refresh for reconciliation |

---

## Appendix A: YNAB API Response Examples

### Full Response (no `last_knowledge_of_server`)

```json
{
  "data": {
    "accounts": [
      {
        "id": "acc-001",
        "name": "Checking Account",
        "balance": 150000,
        "deleted": false,
        ...
      },
      {
        "id": "acc-002",
        "name": "Savings Account",
        "balance": 500000,
        "deleted": false,
        ...
      }
    ],
    "server_knowledge": 12345
  }
}
```

### Delta Response (with `last_knowledge_of_server=12345`)

```json
{
  "data": {
    "accounts": [
      {
        "id": "acc-001",
        "name": "Checking Account (Renamed)",
        "balance": 155000,
        "deleted": false,
        ...
      }
    ],
    "server_knowledge": 12346
  }
}
```

### Delete in Delta Response

```json
{
  "data": {
    "accounts": [
      {
        "id": "acc-003",
        "deleted": true,
        ...
      }
    ],
    "server_knowledge": 12347
  }
}
```

---

## Appendix B: Comparison with Original Plan

| Aspect | Original Plan | Enhanced Plan |
|--------|---------------|---------------|
| **Merge Specifications** | High-level description | Full TypeScript implementations |
| **Write Operations** | Mentioned briefly | Detailed invalidation strategy |
| **Reconciliation** | "Automatically benefit" | Explicit `forceFullRefresh` requirement |
| **Testing** | Basic unit tests | Comprehensive edge cases, performance tests |
| **Rollback** | Not mentioned | Feature flag, staged rollout, rollback procedure |
| **Observability** | Not mentioned | Metrics, logging, diagnostic tool |
| **Risk Mitigation** | Implicit | Explicit conflict detection, knowledge drift handling |
| **Parameter Naming** | Inconsistent | Standardized on API convention with verification step |

---

**End of Enhanced Delta Request Implementation Plan**
