# YNAB MCP Server Architecture

This guide explains the modular architecture, core components, and architectural patterns.

## Table of Contents

- [Modular Architecture](#modular-architecture)
- [Core Components](#core-components)
- [Tool Factory Pattern](#tool-factory-pattern)
- [Dependency Injection Pattern](#dependency-injection-pattern)
- [Developing Tools](#developing-tools)
- [Cache Management](#cache-management)
- [Service Module Patterns](#service-module-patterns)

## Modular Architecture

The server uses a modular architecture that improves maintainability, testability, and performance.

### Architecture Overview

The architecture consists of several key components working together:

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

## Tool Factory Pattern

Tool registration uses a factory pattern that improves encapsulation, scalability, and maintainability. Domain-scoped factory functions register tools with the centralized registry.

### Factory Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                      YNABMCPServer.ts                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  1. Create ToolContext with all dependencies            │   │
│  │  2. Call domain factory functions                       │   │
│  │  3. Register server-owned tools inline                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  budgetTools.ts │  │ accountTools.ts │  │transactionTools │
│  ───────────────│  │  ──────────────│  │  ──────────────│
│  - Schemas      │  │  - Schemas     │  │  - Schemas     │
│  - Handlers     │  │  - Handlers    │  │  - Handlers    │
│  - registerXxx()│  │  - registerXxx()│  │  - registerXxx()│
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### ToolContext Interface

The `ToolContext` provides all dependencies tools might need:

```typescript
// src/types/toolRegistration.ts
export interface ToolContext {
  ynabAPI: ynab.API;
  deltaFetcher: DeltaFetcher;
  deltaCache: DeltaCache;
  serverKnowledgeStore: ServerKnowledgeStore;
  getDefaultBudgetId: () => string | undefined;
  setDefaultBudget: (budgetId: string) => void;
  cacheManager: CacheManager;
  diagnosticManager?: DiagnosticManager;
}
```

### Adapter Utilities

Adapters reduce boilerplate in tool factory functions:

| Adapter | Description | Example Tools |
|---------|-------------|---------------|
| `adapt` | Read-only, YNAB API only | `get_budget`, `get_account` |
| `adaptNoInput` | No input parameters | `get_user` |
| `adaptWithDelta` | Read-only with delta fetching | `list_budgets`, `list_accounts` |
| `adaptWrite` | Write operations with cache invalidation | `create_transaction`, `update_category` |

```typescript
// src/tools/adapters.ts
export function createAdapters(context: ToolContext) {
  const { ynabAPI, deltaFetcher, deltaCache, serverKnowledgeStore } = context;

  return {
    adapt: <TInput>(handler) => async ({ input }) => handler(ynabAPI, input),
    adaptNoInput: (handler) => async () => handler(ynabAPI),
    adaptWithDelta: <TInput>(handler) => async ({ input }) =>
      handler(ynabAPI, deltaFetcher, input),
    adaptWrite: <TInput>(handler) => async ({ input }) =>
      handler(ynabAPI, deltaCache, serverKnowledgeStore, input),
  };
}
```

### Factory Function Example

```typescript
// src/tools/budgetTools.ts
export const registerBudgetTools: ToolFactory = (registry, context) => {
  const { adapt, adaptWithDelta } = createAdapters(context);

  registry.register({
    name: 'list_budgets',
    description: "List all budgets associated with the user's account",
    inputSchema: emptyObjectSchema,
    outputSchema: ListBudgetsOutputSchema,
    handler: adaptWithDelta(handleListBudgets),
    metadata: {
      annotations: {
        ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
        title: 'YNAB: List Budgets',
      },
    },
  });
};
```

### Server Setup

```typescript
// src/server/YNABMCPServer.ts
private setupToolRegistry(): void {
  const context: ToolContext = {
    ynabAPI: this.ynabAPI,
    deltaFetcher: this.deltaFetcher,
    deltaCache: this.deltaCache,
    serverKnowledgeStore: this.serverKnowledgeStore,
    getDefaultBudgetId: () => this.defaultBudgetId,
    setDefaultBudget: (id: string) => this.setDefaultBudget(id),
    cacheManager: cacheManager,
    diagnosticManager: this.diagnosticManager,
  };

  // Register domain tools via factories
  registerBudgetTools(this.toolRegistry, context);
  registerAccountTools(this.toolRegistry, context);
  registerTransactionTools(this.toolRegistry, context);
  // ... other domain factories

  // Server-owned tools remain inline
  this.registerServerOwnedTools();
}
```

### Tool Inventory

**Domain Tools (25 tools)** - Registered via factory functions:

| Domain | Tools |
|--------|-------|
| Budget | `list_budgets`, `get_budget` |
| Account | `list_accounts`, `get_account`, `create_account` |
| Transaction | `list_transactions`, `export_transactions`, `get_transaction`, `create_transaction`, `create_transactions`, `update_transaction`, `update_transactions`, `delete_transaction`, `create_receipt_split_transaction` |
| Category | `list_categories`, `get_category`, `update_category` |
| Payee | `list_payees`, `get_payee` |
| Month | `get_month`, `list_months` |
| Reconciliation | `compare_transactions`, `reconcile_account` |
| Utility | `get_user`, `convert_amount` |

**Server-Owned Tools (5 tools)** - Remain inline in YNABMCPServer:

| Tool | Reason |
|------|--------|
| `set_default_budget` | Accesses server state and cache warming |
| `get_default_budget` | Accesses server state |
| `clear_cache` | Direct cache manipulation |
| `diagnostic_info` | Accesses multiple server internals |
| `set_output_format` | Modifies response formatter state |

## Dependency Injection Pattern

The architecture uses explicit dependency injection for better testability and maintainability:

```typescript
// Explicit dependency injection pattern
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

## Developing Tools

### Tool Development Patterns

Creating new tools follows the Tool Registry pattern for consistency and maintainability.

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

The server includes a sophisticated caching system designed for performance and observability.

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

The server decomposes functionality into focused service modules.

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

---

For practical development patterns and examples, see [`DEVELOPMENT.md`](DEVELOPMENT.md).
For troubleshooting guidance, see [`../reference/TROUBLESHOOTING.md`](../reference/TROUBLESHOOTING.md).
