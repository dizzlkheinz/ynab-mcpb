# YNAB MCP Server Architecture

This guide explains the v0.8.x modular architecture, core components, and architectural patterns.

## Table of Contents

- [v0.8.x Modular Architecture](#v08x-modular-architecture)
- [Core Components](#core-components)
- [Dependency Injection Pattern](#dependency-injection-pattern)
- [Developing Tools with v0.8.x](#developing-tools-with-v08x)
- [Cache Management](#cache-management)
- [Service Module Patterns](#service-module-patterns)
- [Migration from v0.7.x](#migration-from-v07x)

## v0.8.x Modular Architecture

The v0.8.x series introduces a completely refactored architecture that improves maintainability, testability, and performance while maintaining 100% backward compatibility.

### Architecture Overview

The v0.8.x architecture consists of several key components working together:

```
┌─────────────────────────────────────────────────────────────┐
│                     YNABMCPServer                           │
│                  (Main Orchestrator)                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐   │
│  │ Tool Registry│  │ Cache Manager │  │ Budget Resolver │   │
│  │              │  │               │  │                 │   │
│  └──────────────┘  └───────────────┘  └─────────────────┘   │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐   │
│  │Config Module │  │Resource Mgr   │  │ Prompt Manager  │   │
│  │              │  │               │  │                 │   │
│  └──────────────┘  └───────────────┘  └─────────────────┘   │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐   │
│  │Error Handler │  │Security Mdlwr │  │Diagnostic Mgr   │   │
│  │              │  │               │  │                 │   │
│  └──────────────┘  └───────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### Tool Registry
Centralized management of all MCP tools with consistent validation, security, and error handling.

**Key Benefits:**
- Uniform tool registration and validation
- Consistent error messages across all tools
- Centralized security checks
- Automatic JSON schema generation

**Example Tool Definition:**
```typescript
registry.register({
  name: 'my_custom_tool',
  description: 'A custom tool for specific operations',
  inputSchema: MyToolSchema,
  handler: adapt(handleMyTool),
  defaultArgumentResolver: resolveBudgetId(),
  security: { requiresValidation: true }
});
```

### Enhanced Cache Manager
Advanced caching system with observability, LRU eviction, and performance optimization.

**Key Features:**
- Hit/miss tracking with detailed metrics
- LRU eviction with configurable limits
- Stale-while-revalidate for improved performance
- Concurrent fetch deduplication
- Cache warming for faster initial loads

### Budget Resolver
Standardized budget ID resolution with consistent error handling across all tools.

**Benefits:**
- Uniform budget validation
- Clear, actionable error messages
- Automatic default budget injection
- Consistent user experience

### Service Modules
Focused modules handling specific server concerns:

- **Config Module**: Environment validation and configuration management
- **Resource Manager**: MCP resource definitions and handlers
- **Prompt Manager**: MCP prompt definitions and handlers
- **Diagnostic Manager**: System diagnostics and health monitoring

## Dependency Injection Pattern

The v0.8.x releases adopt explicit dependency injection for better testability and maintainability:

```typescript
// v0.8.x pattern - explicit dependencies
class MyService {
  constructor(
    private cacheManager: CacheManager,
    private errorHandler: ErrorHandler,
    private budgetResolver: BudgetResolver
  ) {}

  async performOperation(budgetId: string) {
    const resolved = this.budgetResolver.resolveBudgetId(budgetId, defaultBudgetId);
    if (typeof resolved !== 'string') {
      return resolved; // Error response
    }

    return this.cacheManager.wrap(`operation_${resolved}`, {
      ttl: CACHE_TTLS.MEDIUM,
      loader: () => this.executeOperation(resolved)
    });
  }
}

// Service instantiation with dependencies
const myService = new MyService(cacheManager, errorHandler, budgetResolver);
```

## Developing Tools with v0.8.x

### Tool Development Patterns

Creating new tools in v0.8.x follows the Tool Registry pattern for consistency and maintainability.

#### 1. Define Tool Schema

```typescript
import { z } from 'zod';

export const MyToolSchema = z.object({
  budget_id: z.string().optional(),
  custom_parameter: z.string(),
  optional_parameter: z.number().optional().default(100)
}).describe('Schema for my custom tool');

export type MyToolRequest = z.infer<typeof MyToolSchema>;
```

#### 2. Implement Tool Handler

```typescript
import { adapt } from '../server/toolRegistry.js';
import { BudgetResolver } from '../server/budgetResolver.js';
import { cacheManager, CACHE_TTLS } from '../server/cacheManager.js';

export async function handleMyTool(
  params: MyToolRequest
): Promise<any> {
  // Budget resolution is handled automatically by defaultArgumentResolver
  const { budget_id, custom_parameter, optional_parameter } = params;

  // Use enhanced caching
  return cacheManager.wrap(`my_tool_${budget_id}_${custom_parameter}`, {
    ttl: CACHE_TTLS.SHORT,
    staleWhileRevalidate: 60000,
    loader: async () => {
      // Implement your tool logic here
      const result = await performMyOperation(budget_id, custom_parameter);
      return {
        success: true,
        data: {
          custom_result: result,
          parameter_used: custom_parameter,
          optional_value: optional_parameter
        }
      };
    }
  });
}
```

#### 3. Register Tool with Registry

```typescript
// In YNABMCPServer.ts or a tool registration module
import { resolveBudgetId } from './budgetResolver.js';

registry.register({
  name: 'my_custom_tool',
  description: 'Performs custom operation with enhanced caching and error handling',
  inputSchema: MyToolSchema,
  handler: adapt(handleMyTool),
  defaultArgumentResolver: resolveBudgetId(),
  cacheConfig: {
    enabled: true,
    ttl: CACHE_TTLS.SHORT
  }
});
```

### Using Default Argument Resolution

The Tool Registry provides automatic budget ID resolution:

```typescript
// Budget ID is automatically resolved when not provided
export const resolveBudgetId = (): DefaultArgumentResolver =>
  async (args, context) => {
    if (!args.budget_id) {
      const defaultBudget = context.getDefaultBudget();
      if (!defaultBudget) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'No default budget set. Use set_default_budget first or provide budget_id parameter.'
              }
            })
          }]
        };
      }
      args.budget_id = defaultBudget;
    }
    return null; // No error, continue with resolved args
  };
```

### Error Handling Best Practices

Use the centralized error handling system for consistent responses:

```typescript
import { ErrorHandler } from '../server/errorHandler.js';

export async function handleMyTool(params: MyToolRequest): Promise<any> {
  try {
    // Tool implementation
    const result = await performOperation(params);
    return result;
  } catch (error) {
    // Use centralized error handling
    return ErrorHandler.createErrorResponse(
      'OPERATION_FAILED',
      `Custom tool operation failed: ${error.message}`,
      { operation: 'my_custom_tool', params }
    );
  }
}
```

## Cache Management

### Understanding the Enhanced Cache System

The v0.8.x line introduces a sophisticated caching system designed for performance and observability.

#### Cache Configuration

```typescript
// Environment variables for cache tuning
YNAB_MCP_CACHE_MAX_ENTRIES=1000        // Maximum cache entries
YNAB_MCP_CACHE_DEFAULT_TTL_MS=1800000  // Default TTL (30 minutes)
YNAB_MCP_CACHE_STALE_MS=120000         // Stale-while-revalidate window
```

#### Using Cache.wrap() Method

The primary interface for caching is the `wrap()` method:

```typescript
import { cacheManager, CACHE_TTLS } from '../server/cacheManager.js';

// Basic usage
const result = await cacheManager.wrap('my_cache_key', {
  ttl: CACHE_TTLS.ACCOUNTS,
  loader: async () => {
    // Expensive operation (API call, computation, etc.)
    return await ynabAPI.accounts.getAccounts(budgetId);
  }
});

// Advanced usage with stale-while-revalidate
const result = await cacheManager.wrap('complex_operation', {
  ttl: CACHE_TTLS.LONG,
  staleWhileRevalidate: 300000, // 5 minutes
  loader: async () => {
    return await performComplexAnalysis(budgetId);
  }
});
```

#### Cache Strategy Guidelines

**Long TTL (1 hour+):** Budget data, categories, accounts
```typescript
// Budget data changes infrequently
const budgets = await cacheManager.wrap(`budgets_${userId}`, {
  ttl: CACHE_TTLS.BUDGETS, // 1 hour
  loader: () => ynabAPI.budgets.getBudgets()
});
```

**Medium TTL (30 minutes):** Account balances, category balances
```typescript
// Account data changes moderately
const accounts = await cacheManager.wrap(`accounts_${budgetId}`, {
  ttl: CACHE_TTLS.ACCOUNTS, // 30 minutes
  staleWhileRevalidate: 120000, // 2 minutes
  loader: () => ynabAPI.accounts.getAccounts(budgetId)
});
```

**Short TTL (5-15 minutes):** Recent transactions, monthly data
```typescript
// Recent transactions change frequently
const recentTransactions = await cacheManager.wrap(`recent_txns_${budgetId}`, {
  ttl: CACHE_TTLS.SHORT, // 5 minutes
  loader: () => ynabAPI.transactions.getTransactions(budgetId, { since_date })
});
```

**No Caching:** User-specific filtered transactions, write operations
```typescript
// Don't cache filtered or user-specific data
const filteredTransactions = await ynabAPI.transactions.getTransactions(budgetId, {
  account_id: accountId,
  category_id: categoryId,
  since_date: userSpecificDate
});
```

#### Cache Invalidation Patterns

```typescript
// Invalidate related caches after write operations
export async function handleCreateAccount(params: CreateAccountRequest) {
  const result = await ynabAPI.accounts.createAccount(params);

  // Invalidate related caches
  cacheManager.delete(`accounts_${params.budget_id}`);
  cacheManager.delete(`budget_${params.budget_id}`);

  return result;
}

// Pattern-based invalidation
export function invalidateAccountCaches(budgetId: string) {
  const keysToInvalidate = [
    `accounts_${budgetId}`,
    `budget_${budgetId}`
  ];

  keysToInvalidate.forEach(key => cacheManager.delete(key));
}
```

#### Cache Observability

Monitor cache performance with built-in metrics:

```typescript
// Get cache statistics
const stats = cacheManager.getStats();
console.log('Cache Performance:', {
  hitRate: stats.hit_rate,
  totalHits: stats.total_hits,
  totalMisses: stats.total_misses,
  totalEntries: stats.total_entries,
  evictions: stats.evictions
});

// Example output:
// Cache Performance: {
//   hitRate: 0.75,           // 75% hit rate
//   totalHits: 150,
//   totalMisses: 50,
//   totalEntries: 45,
//   evictions: 5
// }
```

### Cache Warming Strategies

Implement proactive cache warming for better user experience:

```typescript
// Cache warming after budget selection
export async function warmBudgetCache(budgetId: string) {
  // Fire and forget - don't block user operations
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

  // Don't await - let these run in background
  Promise.all(warmingPromises).catch(error => {
    console.warn('Cache warming failed:', error.message);
  });
}

// Trigger cache warming
export async function handleSetDefaultBudget(params: SetDefaultBudgetRequest) {
  const result = await setDefaultBudget(params.budget_id);

  // Warm cache for better subsequent performance
  if (result.success) {
    warmBudgetCache(params.budget_id);
  }

  return result;
}
```

## Service Module Patterns

### Working with Service Modules

The v0.8.x releases decompose server functionality into focused service modules.

#### Resource Manager

Handle MCP resources consistently:

```typescript
// Custom resource definition
class MyResourceManager extends ResourceManager {
  getResources() {
    return [
      ...super.getResources(),
      {
        uri: 'my-app://custom-resource',
        name: 'Custom Resource',
        description: 'Application-specific resource',
        mimeType: 'application/json'
      }
    ];
  }

  async readResource(uri: string) {
    if (uri === 'my-app://custom-resource') {
      return {
        contents: [{
          type: 'text',
          text: JSON.stringify({
            custom_data: 'value',
            timestamp: new Date().toISOString()
          })
        }]
      };
    }
    return super.readResource(uri);
  }
}
```

#### Prompt Manager

Create dynamic prompts with context:

```typescript
// Custom prompt with dynamic context
class MyPromptManager extends PromptManager {
  getPrompts() {
    return [
      ...super.getPrompts(),
      {
        name: 'analyze_spending',
        description: 'Analyze spending patterns with budget context'
      }
    ];
  }

  async getPrompt(name: string, args: any) {
    if (name === 'analyze_spending') {
      const budgetContext = await this.getBudgetContext(args.budget_id);
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze spending patterns for budget: ${budgetContext.name}.
                   Current month: ${budgetContext.current_month}.
                   Focus on categories with significant changes.`
          }
        }]
      };
    }
    return super.getPrompt(name, args);
  }
}
```

#### Diagnostic Manager

Extend diagnostics for custom monitoring:

```typescript
class MyDiagnosticManager extends DiagnosticManager {
  async getSystemDiagnostics() {
    const baseDiagnostics = await super.getSystemDiagnostics();

    return {
      ...baseDiagnostics,
      custom_metrics: {
        active_integrations: this.getActiveIntegrations(),
        last_sync_time: this.getLastSyncTime(),
        error_rate: this.calculateErrorRate()
      }
    };
  }

  private getActiveIntegrations() {
    // Custom integration monitoring
    return {
      external_apis: ['ynab', 'my_custom_api'],
      webhooks: this.activeWebhooks.length,
      background_jobs: this.backgroundJobs.size
    };
  }
}
```

## Migration from v0.7.x

### No Breaking Changes for Users

**Important:** All v0.7.x tool calls, parameters, and responses work identically in v0.8.x. This section is for developers working with the internal architecture.

### Internal API Changes

#### Error Handling Migration

**v0.7.x Pattern:**
```typescript
// Direct error throwing
if (!budgetId) {
  throw new Error('No budget ID provided');
}
```

**v0.8.x Pattern:**
```typescript
// Centralized error handling with consistent format
const result = BudgetResolver.resolveBudgetId(providedId, defaultId);
if (typeof result !== 'string') {
  return result; // Returns properly formatted CallToolResult
}
```

#### Caching Migration

**v0.7.x Pattern:**
```typescript
// Manual cache management
const cached = cacheManager.get(key);
if (cached && !isExpired(cached)) {
  return cached.data;
}

const result = await apiCall();
cacheManager.set(key, result, ttl);
return result;
```

**v0.8.x Pattern:**
```typescript
// Enhanced cache wrapper with observability
return cacheManager.wrap(key, {
  ttl: CACHE_TTLS.ACCOUNTS,
  staleWhileRevalidate: 120000,
  loader: () => apiCall()
});
```

#### Tool Registration Migration

**v0.7.x Pattern:**
```typescript
// Direct switch statement in handleCallTool
case 'my_tool':
  return withSecurityWrapper(async () => {
    const validated = MyToolSchema.parse(params);
    return await handleMyTool(validated);
  });
```

**v0.8.x Pattern:**
```typescript
// Registry-based registration
registry.register({
  name: 'my_tool',
  description: 'Tool description',
  inputSchema: MyToolSchema,
  handler: adapt(handleMyTool),
  defaultArgumentResolver: resolveBudgetId()
});
```

### Testing Pattern Updates

**Enhanced Dependency Injection for Testing:**

```typescript
// v0.8.x - Mock individual services
const mockCacheManager = {
  wrap: vi.fn().mockImplementation((key, options) => options.loader()),
  getStats: vi.fn().mockReturnValue({ hit_rate: 0.5 })
};

const mockErrorHandler = {
  createErrorResponse: vi.fn().mockReturnValue({ success: false })
};

// Test with mocked dependencies
const service = new MyService(mockCacheManager, mockErrorHandler);
```

### Import Path Updates

Most imports remain the same due to barrel exports:

```typescript
// Still works (barrel export)
import { handleMyTool } from '../tools/myTool.js';

// New modular imports available
import { parseCSV } from '../tools/compareTransactions/parser.js';
import { findMatches } from '../tools/compareTransactions/matcher.js';
import { formatResults } from '../tools/compareTransactions/formatter.js';
```

### Performance Improvements to Expect

- **Cache Hit Rate**: 60-80% for repeated operations
- **Initial Load Time**: Faster due to cache warming
- **Memory Usage**: More efficient with LRU eviction
- **Error Response Time**: Faster with pre-formatted responses

---

For practical development patterns and examples, see [`DEVELOPMENT.md`](DEVELOPMENT.md).
For troubleshooting guidance, see [`../reference/TROUBLESHOOTING.md`](../reference/TROUBLESHOOTING.md).
