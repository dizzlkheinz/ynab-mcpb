# Enhanced Caching System

v0.8.0 introduces a sophisticated caching system designed for performance, observability, and intelligent data management. This documentation provides comprehensive information about the enhanced caching features and how to use them effectively.

## Table of Contents

- [Cache Overview](#cache-overview)
- [Configuration Options](#configuration-options)
- [Cache API Reference](#cache-api-reference)
- [Cache Strategies](#cache-strategies)
- [Cache Warming](#cache-warming)
- [Observability](#observability)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Cache Overview

The enhanced caching system in v0.8.0 provides significant performance improvements through:

### Key Features

- **LRU Eviction**: Configurable maximum entries with least-recently-used eviction strategy
- **Hit/Miss Tracking**: Comprehensive cache observability with detailed metrics
- **Stale-While-Revalidate**: Serve stale data while refreshing in background for improved performance
- **Concurrent Fetch Deduplication**: Prevent duplicate API calls for the same cache key
- **Cache Warming**: Automatic cache warming for faster initial loads
- **Intelligent TTL Management**: Per-entry TTL configuration with sensible defaults

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Enhanced CacheManager                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │ LRU Storage │  │ TTL Manager │  │ Metrics Collector   │   │
│  │             │  │             │  │                     │   │
│  └─────────────┘  └─────────────┘  └─────────────────────┘   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │Stale-While- │  │Concurrent   │  │ Cache Warming       │   │
│  │Revalidate   │  │Deduplication│  │ Manager             │   │
│  └─────────────┘  └─────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Configuration Options

Configure the cache system using environment variables with sensible defaults:

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `YNAB_MCP_CACHE_MAX_ENTRIES` | `1000` | Maximum number of cache entries before LRU eviction |
| `YNAB_MCP_CACHE_DEFAULT_TTL_MS` | `300000` (5 minutes) | Default cache TTL in milliseconds |
| `YNAB_MCP_CACHE_STALE_MS` | `120000` (2 minutes) | Stale-while-revalidate window in milliseconds |

### Configuration Examples

```bash
# Production configuration (high performance)
YNAB_MCP_CACHE_MAX_ENTRIES=2000
YNAB_MCP_CACHE_DEFAULT_TTL_MS=3600000  # 1 hour
YNAB_MCP_CACHE_STALE_MS=300000         # 5 minutes

# Development configuration (faster invalidation)
YNAB_MCP_CACHE_MAX_ENTRIES=500
YNAB_MCP_CACHE_DEFAULT_TTL_MS=300000   # 5 minutes
YNAB_MCP_CACHE_STALE_MS=60000          # 1 minute

# Memory-constrained environment
YNAB_MCP_CACHE_MAX_ENTRIES=100
YNAB_MCP_CACHE_DEFAULT_TTL_MS=900000   # 15 minutes
YNAB_MCP_CACHE_STALE_MS=120000         # 2 minutes
```

## Cache API Reference

### CacheManager.wrap()

The primary interface for caching operations with concurrent deduplication and enhanced options.

#### Signature

```typescript
async wrap<T>(
  key: string,
  options: {
    ttl?: number;
    staleWhileRevalidate?: number;
    loader: () => Promise<T>;
  }
): Promise<T>
```

#### Parameters

- **key**: Unique cache key for the operation
- **options.ttl**: Time-to-live in milliseconds (optional, uses default if not specified)
- **options.staleWhileRevalidate**: Stale-while-revalidate window in milliseconds (optional)
- **options.loader**: Function that loads data when cache miss occurs

#### Examples

```typescript
// Basic usage with default TTL
const accounts = await cacheManager.wrap('accounts_budget123', {
  loader: () => ynabAPI.accounts.getAccounts(budgetId)
});

// Custom TTL for long-lived data
const budgets = await cacheManager.wrap('user_budgets', {
  ttl: CACHE_TTLS.BUDGETS, // 1 hour
  loader: () => ynabAPI.budgets.getBudgets()
});

// With stale-while-revalidate for better performance
const categories = await cacheManager.wrap('categories_budget123', {
  ttl: CACHE_TTLS.CATEGORIES,
  staleWhileRevalidate: 300000, // 5 minutes
  loader: () => ynabAPI.categories.getCategories(budgetId)
});
```

### CacheManager.getStats()

Returns comprehensive cache metrics for monitoring and optimization.

#### Returns

```typescript
interface CacheStats {
  size: number;            // Current number of cached entries
  keys: string[];          // Array of all cache keys
  hits: number;            // Total cache hits since startup
  misses: number;          // Total cache misses since startup
  evictions: number;       // Total LRU evictions performed
  lastCleanup: number | null; // Timestamp of last cleanup
  maxEntries: number;      // Maximum allowed entries
  hitRate: number;         // Hit rate (0.0 to 1.0)
}
```

#### Example

```typescript
const stats = cacheManager.getStats();
console.log('Cache Performance:', {
  hitRate: `${(stats.hitRate * 100).toFixed(1)}%`,
  totalHits: stats.hits,
  totalMisses: stats.misses,
  currentEntries: stats.size,
  evictions: stats.evictions,
  maxEntries: stats.maxEntries
});

// Example output:
// Cache Performance: {
//   hitRate: '75.2%',
//   totalHits: 301,
//   totalMisses: 99,
//   currentEntries: 45,
//   evictions: 12
// }
```

### CacheManager.clear()

Clears all cache entries and resets metrics.

```typescript
cacheManager.clear();
console.log('Cache cleared. Stats reset.');
```

### CacheManager.delete()

Removes a specific cache entry.

```typescript
// Invalidate specific cache entry
cacheManager.delete(`accounts_${budgetId}`);

// Useful after write operations
await ynabAPI.accounts.createAccount(accountData);
cacheManager.delete(`accounts_${budgetId}`);
```

### CacheManager.has()

Checks if a valid cache entry exists without updating hit/miss counters.

```typescript
const hasValidCache = cacheManager.has(`accounts_${budgetId}`);
if (hasValidCache) {
  console.log('Cache available for accounts');
}
```

## Cache Strategies

Different data types require different caching strategies based on their change frequency and access patterns.

### Predefined Cache TTLs

```typescript
export const CACHE_TTLS = {
  BUDGETS: 3600000,      // 1 hour - budgets rarely change
  ACCOUNTS: 1800000,     // 30 minutes - moderate change frequency
  CATEGORIES: 1800000,   // 30 minutes - moderate change frequency
  PAYEES: 1800000,       // 30 minutes - moderate change frequency
  SHORT: 300000,         // 5 minutes - frequently changing data
  MEDIUM: 900000,        // 15 minutes - balanced TTL
  LONG: 3600000          // 1 hour - stable data
};
```

### Data-Specific Strategies

#### Budget Data (Long TTL)
Budgets change infrequently, making them ideal for long-term caching.

```typescript
const budgets = await cacheManager.wrap(`budgets_${userId}`, {
  ttl: CACHE_TTLS.BUDGETS, // 1 hour
  loader: () => ynabAPI.budgets.getBudgets()
});
```

#### Account Data (Medium TTL with Cache Warming)
Accounts have moderate change frequency and benefit from cache warming.

```typescript
const accounts = await cacheManager.wrap(`accounts_${budgetId}`, {
  ttl: CACHE_TTLS.ACCOUNTS, // 30 minutes
  staleWhileRevalidate: 120000, // 2 minutes
  loader: () => ynabAPI.accounts.getAccounts(budgetId)
});
```

#### Transaction Data (Selective Caching)
Only cache unfiltered transaction requests to avoid memory bloat.

```typescript
// Cache unfiltered requests
if (!params.account_id && !params.category_id && !params.since_date) {
  return cacheManager.wrap(`transactions_${budgetId}`, {
    ttl: CACHE_TTLS.SHORT, // 5 minutes
    loader: () => ynabAPI.transactions.getTransactions(budgetId)
  });
}

// Don't cache filtered requests
return ynabAPI.transactions.getTransactions(budgetId, params);
```

#### Category Data (Medium TTL with Invalidation)
Categories change moderately and need invalidation on budget updates.

```typescript
const categories = await cacheManager.wrap(`categories_${budgetId}`, {
  ttl: CACHE_TTLS.CATEGORIES,
  loader: () => ynabAPI.categories.getCategories(budgetId)
});

// Invalidate after category budget updates
await ynabAPI.categories.updateMonthCategory(params);
cacheManager.delete(`categories_${budgetId}`);
```

### Cache Invalidation Patterns

```typescript
// Single-key invalidation
export function invalidateAccountCache(budgetId: string) {
  cacheManager.delete(`accounts_${budgetId}`);
}

// Multi-key invalidation for related data
export function invalidateBudgetRelatedCaches(budgetId: string) {
  const keysToInvalidate = [
    `accounts_${budgetId}`,
    `categories_${budgetId}`,
    `payees_${budgetId}`,
    `budget_${budgetId}`,
    `financial_overview_${budgetId}`
  ];

  keysToInvalidate.forEach(key => cacheManager.delete(key));
}

// Pattern-based invalidation (conceptual - not implemented)
// cacheManager.deletePattern(`*_${budgetId}`);
```

## Cache Warming

Cache warming proactively loads frequently accessed data for better performance.

### Automatic Cache Warming

Cache warming is automatically triggered after setting a default budget:

```typescript
// Triggers automatic cache warming in background
await executeToolCall(server, 'set_default_budget', {
  budget_id: budgetId
});

// Cache is now being warmed with:
// - accounts_${budgetId}
// - categories_${budgetId}
// - payees_${budgetId}
```

### Manual Cache Warming

```typescript
export async function warmBudgetCache(budgetId: string): Promise<void> {
  // Fire-and-forget pattern for non-blocking operation
  const warmingPromises = [
    cacheManager.wrap(`accounts_${budgetId}`, {
      ttl: CACHE_TTLS.ACCOUNTS,
      loader: () => ynabAPI.accounts.getAccounts(budgetId)
    }),
    cacheManager.wrap(`categories_${budgetId}`, {
      ttl: CACHE_TTLS.CATEGORIES,
      loader: () => ynabAPI.categories.getCategories(budgetId)
    }),
    cacheManager.wrap(`payees_${budgetId}`, {
      ttl: CACHE_TTLS.PAYEES,
      loader: () => ynabAPI.payees.getPayees(budgetId)
    })
  ];

  // Don't await - let warming happen in background
  Promise.all(warmingPromises).catch(error => {
    console.warn('Cache warming failed:', error.message);
    // Non-critical - don't interrupt user flow
  });
}

// Usage
await warmBudgetCache('budget-123');
console.log('Cache warming initiated (background)');
```

### Cache Warming Benefits

- **Reduced Initial Load Time**: Subsequent requests hit cache instead of API
- **Better User Experience**: Faster response times for common operations
- **API Efficiency**: Fewer API calls during active usage periods
- **Non-Blocking**: Fire-and-forget pattern doesn't delay user operations

## Observability

### Real-Time Metrics

Monitor cache performance using the diagnostic tool:

```typescript
// Get current cache statistics
const result = await executeToolCall(server, 'diagnostic_info');
const diagnostics = JSON.parse(result.content[0].text);
const cacheStats = diagnostics.data.cache;

console.log('Cache Metrics:', {
  hitRate: `${(cacheStats.hitRate * 100).toFixed(1)}%`,
  totalHits: cacheStats.hits,
  totalMisses: cacheStats.misses,
  entries: cacheStats.entries,
  evictions: cacheStats.evictions
});
```

### Performance Interpretation

#### Hit Rate Analysis

- **80%+**: Excellent performance, optimal caching strategy
- **60-80%**: Good performance, consider cache warming
- **40-60%**: Moderate performance, review TTL settings
- **<40%**: Poor performance, investigate data access patterns

#### Memory Usage

```typescript
// Monitor memory efficiency
const stats = cacheManager.getStats();
const memoryEfficiency = {
  entriesPerEviction: stats.entries / (stats.evictions || 1),
  cacheUtilization: stats.entries / maxEntries,
  recommendation: stats.evictions > stats.hits * 0.1 ?
    'Consider increasing YNAB_MCP_CACHE_MAX_ENTRIES' :
    'Memory usage optimal'
};
```

### Logging and Monitoring

```typescript
// Periodic cache monitoring
setInterval(() => {
  const stats = cacheManager.getStats();

  if (stats.hitRate < 0.5) {
    console.warn('Low cache hit rate detected:', stats.hitRate);
  }

  if (stats.evictions > stats.hits * 0.2) {
    console.warn('High eviction rate detected, consider increasing cache size');
  }
}, 300000); // Every 5 minutes
```

## Best Practices

### 1. Choose Appropriate TTLs

```typescript
// Match TTL to data volatility
const strategies = {
  // Stable data - long TTL
  budgets: CACHE_TTLS.BUDGETS,     // 1 hour
  accounts: CACHE_TTLS.ACCOUNTS,   // 30 minutes

  // Moderate change - medium TTL
  categories: CACHE_TTLS.MEDIUM,   // 15 minutes
  payees: CACHE_TTLS.MEDIUM,       // 15 minutes

  // Frequently changing - short TTL
  transactions: CACHE_TTLS.SHORT,  // 5 minutes
  recentActivity: CACHE_TTLS.SHORT // 5 minutes
};
```

### 2. Use Stale-While-Revalidate for Critical Data

```typescript
// Important data that users expect to be fast
const accounts = await cacheManager.wrap(`accounts_${budgetId}`, {
  ttl: CACHE_TTLS.ACCOUNTS,
  staleWhileRevalidate: 120000, // 2 minutes
  loader: () => ynabAPI.accounts.getAccounts(budgetId)
});
```

### 3. Implement Proper Cache Invalidation

```typescript
// Always invalidate related caches after write operations
export async function createAccount(params: CreateAccountRequest) {
  const result = await ynabAPI.accounts.createAccount(params);

  // Invalidate related caches
  cacheManager.delete(`accounts_${params.budget_id}`);
  cacheManager.delete(`budget_${params.budget_id}`);

  return result;
}
```

### 4. Design Cache-Friendly Keys

```typescript
// Good: Hierarchical, specific keys
const goodKeys = [
  `accounts_${budgetId}`,
  `categories_${budgetId}`,
  `transactions_${budgetId}_since_${date}`,
  `financial_overview_${budgetId}_${month}`
];

// Avoid: Generic or collision-prone keys
const badKeys = [
  'accounts',              // Too generic
  `data_${id}`,           // Unclear scope
  `${budgetId}_stuff`     // Ambiguous content
];
```

### 5. Monitor and Optimize

```typescript
class CacheOptimizer {
  static analyzePerformance() {
    const stats = cacheManager.getStats();

    return {
      performance: this.getPerformanceRating(stats.hitRate),
      recommendations: this.getRecommendations(stats),
      efficiency: this.calculateEfficiency(stats)
    };
  }

  static getPerformanceRating(hitRate: number): string {
    if (hitRate >= 0.8) return 'Excellent';
    if (hitRate >= 0.6) return 'Good';
    if (hitRate >= 0.4) return 'Fair';
    return 'Poor';
  }

  static getRecommendations(stats: CacheStats): string[] {
    const recommendations = [];

    if (stats.hitRate < 0.5) {
      recommendations.push('Consider implementing cache warming');
      recommendations.push('Review TTL settings for frequently accessed data');
    }

    if (stats.evictions > stats.hits * 0.2) {
      recommendations.push('Increase YNAB_MCP_CACHE_MAX_ENTRIES');
    }

    if (stats.entries < 10) {
      recommendations.push('Cache usage seems low, verify data access patterns');
    }

    return recommendations;
  }
}
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Low Cache Hit Rate

**Symptoms**: Hit rate below 50%, poor performance

**Potential Causes**:
- TTL too short for data access patterns
- Lack of cache warming
- Frequent cache invalidation
- Non-cacheable request patterns

**Solutions**:
```typescript
// Increase TTL for stable data
const longerTTL = await cacheManager.wrap(key, {
  ttl: CACHE_TTLS.LONG, // Instead of SHORT
  loader: () => fetchData()
});

// Implement cache warming
await warmBudgetCache(budgetId);

// Review invalidation patterns
// Only invalidate when data actually changes
```

#### 2. High Memory Usage / Frequent Evictions

**Symptoms**: High eviction count, memory warnings

**Solutions**:
```bash
# Increase cache size
YNAB_MCP_CACHE_MAX_ENTRIES=2000

# Or decrease TTL to reduce memory pressure
YNAB_MCP_CACHE_DEFAULT_TTL_MS=900000  # 15 minutes instead of 30
```

#### 3. Stale Data Issues

**Symptoms**: Users see outdated information

**Solutions**:
```typescript
// Implement proper invalidation
await updateCategory(params);
cacheManager.delete(`categories_${budgetId}`);

// Reduce TTL for critical data
const criticalData = await cacheManager.wrap(key, {
  ttl: CACHE_TTLS.SHORT, // 5 minutes
  loader: () => fetchCriticalData()
});

// Use stale-while-revalidate sparingly
const data = await cacheManager.wrap(key, {
  ttl: CACHE_TTLS.MEDIUM,
  staleWhileRevalidate: 60000, // Only 1 minute
  loader: () => fetchData()
});
```

#### 4. Cache Warming Failures

**Symptoms**: Slower than expected performance after budget selection

**Solutions**:
```typescript
// Add error handling to cache warming
export async function robustCacheWarming(budgetId: string) {
  const warmingTasks = [
    { name: 'accounts', fn: () => ynabAPI.accounts.getAccounts(budgetId) },
    { name: 'categories', fn: () => ynabAPI.categories.getCategories(budgetId) },
    { name: 'payees', fn: () => ynabAPI.payees.getPayees(budgetId) }
  ];

  const results = await Promise.allSettled(
    warmingTasks.map(async task => {
      try {
        await cacheManager.wrap(`${task.name}_${budgetId}`, {
          ttl: CACHE_TTLS.ACCOUNTS,
          loader: task.fn
        });
        return { task: task.name, status: 'success' };
      } catch (error) {
        console.warn(`Cache warming failed for ${task.name}:`, error.message);
        return { task: task.name, status: 'failed', error: error.message };
      }
    })
  );

  const successful = results.filter(r =>
    r.status === 'fulfilled' && r.value.status === 'success'
  ).length;

  console.log(`Cache warming: ${successful}/${warmingTasks.length} tasks successful`);
}
```

### Debugging Cache Behavior

```typescript
// Enable detailed cache logging (development only)
class CacheDebugger {
  static logCacheOperation(key: string, operation: string, result: any) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[CACHE] ${operation}: ${key}`, {
        hit: operation === 'hit',
        size: JSON.stringify(result).length,
        timestamp: new Date().toISOString()
      });
    }
  }

  static analyzeCacheKey(key: string) {
    const parts = key.split('_');
    return {
      type: parts[0],
      budgetId: parts[1],
      additional: parts.slice(2),
      recommendation: this.getKeyRecommendation(key)
    };
  }

  static getKeyRecommendation(key: string): string {
    if (key.length > 100) return 'Key too long, consider abbreviation';
    if (!key.includes('_')) return 'Consider using hierarchical naming';
    if (key.includes(' ')) return 'Remove spaces from cache keys';
    return 'Key format looks good';
  }
}
```

---

The enhanced caching system in v0.8.0 provides significant performance improvements while maintaining simplicity for developers. By following these guidelines and best practices, you can maximize cache effectiveness and deliver optimal user experiences.