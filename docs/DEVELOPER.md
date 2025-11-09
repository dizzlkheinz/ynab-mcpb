# YNAB MCP Server Developer Guide

This guide provides best practices, common patterns, and practical examples for working with the YNAB MCP Server. It's designed to help developers integrate YNAB functionality into their AI applications effectively.

## Table of Contents

- [Getting Started](#getting-started)
- [v0.8.x Modular Architecture](#v08x-modular-architecture)
- [Developing Tools with v0.8.x](#developing-tools-with-v08x)
- [Cache Management Guide](#cache-management-guide)
- [Service Module Patterns](#service-module-patterns)
- [Migration from v0.7.x to v0.8.x](#migration-from-v07x-to-v08x)
- [Common Patterns](#common-patterns)
- [Best Practices](#best-practices)
- [Error Handling Strategies](#error-handling-strategies)
- [Performance Optimization](#performance-optimization)
- [Security Considerations](#security-considerations)
- [Common Pitfalls](#common-pitfalls)
- [Example Workflows](#example-workflows)
- [Troubleshooting](#troubleshooting)

## Getting Started

### Basic Setup

```javascript
// Initialize MCP client (example using hypothetical MCP client)
import { MCPClient } from '@modelcontextprotocol/client';

const client = new MCPClient({
  transport: 'stdio',
  command: 'node',
  args: ['path/to/ynab-mcp-server/dist/index.js']
});

await client.connect();
```

### First API Call

```javascript
// Get user information to verify connection
try {
  const userResult = await client.callTool('get_user', {});
  const user = JSON.parse(userResult.content[0].text);
  console.log(`Connected as: ${user.user.email}`);
} catch (error) {
  console.error('Connection failed:', error);
}
```

## v0.8.x Modular Architecture

The v0.8.x series introduces a completely refactored architecture that improves maintainability, testability, and performance while maintaining 100% backward compatibility. Understanding this architecture helps you build better integrations and troubleshoot issues more effectively.

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

### Core Components

#### Tool Registry
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

#### Enhanced Cache Manager
Advanced caching system with observability, LRU eviction, and performance optimization.

**Key Features:**
- Hit/miss tracking with detailed metrics
- LRU eviction with configurable limits
- Stale-while-revalidate for improved performance
- Concurrent fetch deduplication
- Cache warming for faster initial loads

#### Budget Resolver
Standardized budget ID resolution with consistent error handling across all tools.

**Benefits:**
- Uniform budget validation
- Clear, actionable error messages
- Automatic default budget injection
- Consistent user experience

#### Service Modules
Focused modules handling specific server concerns:

- **Config Module**: Environment validation and configuration management
- **Resource Manager**: MCP resource definitions and handlers
- **Prompt Manager**: MCP prompt definitions and handlers
- **Diagnostic Manager**: System diagnostics and health monitoring

### Dependency Injection Pattern

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

## Cache Management Guide

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

## Migration from v0.7.x to v0.8.x

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

## Common Patterns

### 1. Budget Discovery Pattern

Most operations require a budget ID. Start by discovering available budgets:

```javascript
async function discoverBudgets() {
  const result = await client.callTool('list_budgets', {});
  const data = JSON.parse(result.content[0].text);
  
  return data.budgets.map(budget => ({
    id: budget.id,
    name: budget.name,
    lastModified: new Date(budget.last_modified_on)
  }));
}

// Use the first budget or let user choose
const budgets = await discoverBudgets();
const primaryBudget = budgets[0];
```

### 2. Account Selection Pattern

After selecting a budget, discover available accounts:

```javascript
async function getAccountsByType(budgetId, accountType = null) {
  const result = await client.callTool('list_accounts', {
    budget_id: budgetId
  });
  const data = JSON.parse(result.content[0].text);
  
  let accounts = data.accounts.filter(account => !account.closed);
  
  if (accountType) {
    accounts = accounts.filter(account => account.type === accountType);
  }
  
  return accounts.map(account => ({
    id: account.id,
    name: account.name,
    type: account.type,
    balance: account.balance / 1000, // Convert to dollars
    onBudget: account.on_budget
  }));
}

// Get checking accounts only
const checkingAccounts = await getAccountsByType(budgetId, 'checking');
```

### 3. Category Hierarchy Pattern

YNAB organizes categories in groups. Handle the hierarchy properly:

```javascript
async function getCategorizedStructure(budgetId) {
  const result = await client.callTool('list_categories', {
    budget_id: budgetId
  });
  const data = JSON.parse(result.content[0].text);
  
  return data.category_groups
    .filter(group => !group.hidden && !group.deleted)
    .map(group => ({
      id: group.id,
      name: group.name,
      categories: group.categories
        .filter(cat => !cat.hidden && !cat.deleted)
        .map(cat => ({
          id: cat.id,
          name: cat.name,
          budgeted: cat.budgeted / 1000,
          activity: cat.activity / 1000,
          balance: cat.balance / 1000
        }))
    }));
}
```

### 4. Transaction Filtering Pattern

Use server-side filtering for better performance:

```javascript
async function getRecentTransactions(budgetId, accountId = null, days = 30) {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);
  
  const params = {
    budget_id: budgetId,
    since_date: sinceDate.toISOString().split('T')[0] // YYYY-MM-DD
  };
  
  if (accountId) {
    params.account_id = accountId;
  }
  
  const result = await client.callTool('list_transactions', params);
  const data = JSON.parse(result.content[0].text);
  
  return data.transactions.map(transaction => ({
    id: transaction.id,
    date: transaction.date,
    amount: transaction.amount / 1000, // Convert to dollars
    payeeName: transaction.payee_name,
    categoryName: transaction.category_name,
    memo: transaction.memo,
    cleared: transaction.cleared,
    approved: transaction.approved
  }));
}
```

### 5. Amount Conversion Pattern

Always use the conversion utility for accuracy:

```javascript
class AmountConverter {
  static async toMilliunits(dollars) {
    const result = await client.callTool('convert_amount', {
      amount: dollars,
      to_milliunits: true
    });
    const data = JSON.parse(result.content[0].text);
    return data.converted_amount;
  }
  
  static async toDollars(milliunits) {
    const result = await client.callTool('convert_amount', {
      amount: milliunits,
      to_milliunits: false
    });
    const data = JSON.parse(result.content[0].text);
    return data.converted_amount;
  }
  
  // For display purposes, you can also do simple division
  static displayDollars(milliunits) {
    return (milliunits / 1000).toFixed(2);
  }
}

// Usage
const userAmount = 25.50; // User enters $25.50
const milliunits = await AmountConverter.toMilliunits(userAmount);
// Use milliunits in API calls
```

## Best Practices

### 1. Error Handling

Implement comprehensive error handling with specific responses:

```javascript
class YNABErrorHandler {
  static async handleToolCall(toolName, params, operation) {
    try {
      const result = await client.callTool(toolName, params);
      return JSON.parse(result.content[0].text);
    } catch (error) {
      return this.handleError(error, toolName, operation);
    }
  }
  
  static handleError(error, toolName, operation) {
    const errorData = JSON.parse(error.content[0].text);
    
    switch (errorData.error.code) {
      case 'AUTHENTICATION_ERROR':
        throw new Error('YNAB token is invalid or expired. Please update your token.');
      
      case 'AUTHORIZATION_ERROR':
        throw new Error('Insufficient permissions for this operation.');
      
      case 'RESOURCE_NOT_FOUND':
        throw new Error(`The requested ${operation} was not found. Please verify the ID.`);
      
      case 'RATE_LIMIT_EXCEEDED':
        throw new Error('Too many requests. Please wait before trying again.');
      
      case 'VALIDATION_ERROR':
        throw new Error(`Invalid input: ${errorData.error.message}`);
      
      default:
        throw new Error(`Operation failed: ${errorData.error.message}`);
    }
  }
}

// Usage
try {
  const budgets = await YNABErrorHandler.handleToolCall(
    'list_budgets', 
    {}, 
    'budget listing'
  );
} catch (error) {
  console.error('User-friendly error:', error.message);
}
```

### 2. Caching Strategy

Implement intelligent caching for better performance:

```javascript
class YNABCache {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map();
  }
  
  set(key, value, ttlMinutes = 30) {
    this.cache.set(key, value);
    this.ttl.set(key, Date.now() + (ttlMinutes * 60 * 1000));
  }
  
  get(key) {
    if (this.ttl.get(key) < Date.now()) {
      this.cache.delete(key);
      this.ttl.delete(key);
      return null;
    }
    return this.cache.get(key);
  }
  
  async getBudgets() {
    const cached = this.get('budgets');
    if (cached) return cached;
    
    const result = await client.callTool('list_budgets', {});
    const budgets = JSON.parse(result.content[0].text);
    
    this.set('budgets', budgets, 60); // Cache for 1 hour
    return budgets;
  }
  
  async getAccounts(budgetId) {
    const key = `accounts_${budgetId}`;
    const cached = this.get(key);
    if (cached) return cached;
    
    const result = await client.callTool('list_accounts', {
      budget_id: budgetId
    });
    const accounts = JSON.parse(result.content[0].text);
    
    this.set(key, accounts, 30); // Cache for 30 minutes
    return accounts;
  }
  
  // Don't cache transactions - they change frequently
  async getTransactions(budgetId, filters = {}) {
    return await client.callTool('list_transactions', {
      budget_id: budgetId,
      ...filters
    });
  }
}
```

### 3. Batch Operations

When possible, batch related operations:

```javascript
async function createMultipleTransactions(budgetId, transactions) {
  const results = [];
  const errors = [];
  
  // Process in small batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < transactions.length; i += batchSize) {
    const batch = transactions.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (transaction, index) => {
      try {
        const milliunits = await AmountConverter.toMilliunits(transaction.amount);
        
        const result = await client.callTool('create_transaction', {
          budget_id: budgetId,
          account_id: transaction.accountId,
          amount: transaction.amount < 0 ? -milliunits : milliunits,
          date: transaction.date,
          payee_name: transaction.payeeName,
          category_id: transaction.categoryId,
          memo: transaction.memo
        });
        
        results.push({
          index: i + index,
          success: true,
          data: JSON.parse(result.content[0].text)
        });
      } catch (error) {
        errors.push({
          index: i + index,
          error: error.message,
          transaction: transaction
        });
      }
    });
    
    await Promise.all(batchPromises);
    
    // Add delay between batches to respect rate limits
    if (i + batchSize < transactions.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return { results, errors };
}
```

### 4. Data Validation

Validate data before making API calls:

```javascript
class YNABValidator {
  static validateDate(date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new Error('Date must be in YYYY-MM-DD format');
    }
    
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      throw new Error('Invalid date');
    }
    
    return true;
  }
  
  static validateAmount(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error('Amount must be a valid number');
    }
    
    if (Math.abs(amount) > 999999999) {
      throw new Error('Amount is too large');
    }
    
    return true;
  }
  
  static validateAccountType(type) {
    const validTypes = [
      'checking', 'savings', 'creditCard', 'cash', 
      'lineOfCredit', 'otherAsset', 'otherLiability'
    ];
    
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid account type. Must be one of: ${validTypes.join(', ')}`);
    }
    
    return true;
  }
  
  static validateTransaction(transaction) {
    this.validateDate(transaction.date);
    this.validateAmount(transaction.amount);
    
    if (!transaction.accountId || typeof transaction.accountId !== 'string') {
      throw new Error('Account ID is required');
    }
    
    if (transaction.memo && transaction.memo.length > 200) {
      throw new Error('Memo cannot exceed 200 characters');
    }
    
    return true;
  }
}
```

## Error Handling Strategies

### 1. Retry Logic with Exponential Backoff

```javascript
class RetryHandler {
  static async withRetry(operation, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const errorData = JSON.parse(error.content[0].text);
        
        // Don't retry certain errors
        if (['AUTHENTICATION_ERROR', 'AUTHORIZATION_ERROR', 'VALIDATION_ERROR'].includes(errorData.error.code)) {
          throw error;
        }
        
        // Retry rate limit and server errors
        if (attempt === maxRetries) {
          throw error;
        }
        
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

// Usage
const budgets = await RetryHandler.withRetry(async () => {
  return await client.callTool('list_budgets', {});
});
```

### 2. Circuit Breaker Pattern

```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }
  
  async call(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}
```

## Performance Optimization

The v0.8.x series introduces significant performance improvements through enhanced caching, modular architecture, and optimized data access patterns.

### 1. Enhanced Caching (v0.8.x)

The new caching system provides automatic performance improvements with minimal code changes:

```javascript
// v0.8.x - Automatic caching with observability
class OptimizedYNABData {
  constructor(budgetId) {
    this.budgetId = budgetId;
  }

  async getAccounts() {
    // Automatically cached with 30-minute TTL and observability
    const result = await client.callTool('list_accounts', {
      budget_id: this.budgetId
    });
    return JSON.parse(result.content[0].text);
  }

  async getCategories() {
    // Cached with stale-while-revalidate for better performance
    const result = await client.callTool('list_categories', {
      budget_id: this.budgetId
    });
    return JSON.parse(result.content[0].text);
  }

  // Cache performance monitoring
  async getCacheStats() {
    const result = await client.callTool('diagnostic_info');
    const data = JSON.parse(result.content[0].text);
    return data.diagnostics.cache_stats;
  }
}

// Example cache performance output:
// {
//   hit_rate: 0.75,        // 75% cache hit rate
//   total_hits: 150,
//   total_misses: 50,
//   total_entries: 45,
//   evictions: 5
// }
```

### 2. Cache-Aware Data Access

Leverage cache warming and intelligent invalidation:

```javascript
// Trigger cache warming for better subsequent performance
async function optimizedBudgetSetup(budgetId) {
  // Set default budget (triggers automatic cache warming)
  await client.callTool('set_default_budget', { budget_id: budgetId });

  // Cache is now warmed with accounts, categories, and payees
  // Subsequent calls will be significantly faster

  // These calls will hit cache
  const [accounts, categories, payees] = await Promise.all([
    client.callTool('list_accounts', { budget_id: budgetId }),
    client.callTool('list_categories', { budget_id: budgetId }),
    client.callTool('list_payees', { budget_id: budgetId })
  ]);

  return {
    accounts: JSON.parse(accounts.content[0].text),
    categories: JSON.parse(categories.content[0].text),
    payees: JSON.parse(payees.content[0].text)
  };
}
```

### 3. Lazy Loading with Enhanced Caching

Combine lazy loading patterns with automatic caching:

```javascript
class LazyYNABData {
  constructor(budgetId) {
    this.budgetId = budgetId;
    // No need to manually manage cache - v0.8.x handles it
  }

  async getAccounts() {
    // First call: cache miss, data fetched and cached
    // Subsequent calls: cache hit, instant response
    const result = await client.callTool('list_accounts', {
      budget_id: this.budgetId
    });
    return JSON.parse(result.content[0].text);
  }

  async getCategories() {
    // Benefits from stale-while-revalidate caching
    const result = await client.callTool('list_categories', {
      budget_id: this.budgetId
    });
    return JSON.parse(result.content[0].text);
  }

  async findAccountByName(name) {
    const accounts = await this.getAccounts(); // May hit cache
    return accounts.accounts.find(account =>
      account.name.toLowerCase().includes(name.toLowerCase())
    );
  }

  async findCategoryByName(name) {
    const categories = await this.getCategories(); // May hit cache
    for (const group of categories.category_groups) {
      const category = group.categories.find(cat =>
        cat.name.toLowerCase().includes(name.toLowerCase())
      );
      if (category) return category;
    }
    return null;
  }
}
```

### 4. Parallel Data Fetching with Cache Benefits

Parallel operations now benefit from enhanced caching:

```javascript
async function getBudgetOverview(budgetId) {
  // All operations may hit cache for significant speedup
  const [budgetResult, accountsResult, categoriesResult, payeesResult] = await Promise.all([
    client.callTool('get_budget', { budget_id: budgetId }),
    client.callTool('list_accounts', { budget_id: budgetId }),
    client.callTool('list_categories', { budget_id: budgetId }),
    client.callTool('list_payees', { budget_id: budgetId })
  ]);

  return {
    budget: JSON.parse(budgetResult.content[0].text),
    accounts: JSON.parse(accountsResult.content[0].text),
    categories: JSON.parse(categoriesResult.content[0].text),
    payees: JSON.parse(payeesResult.content[0].text)
  };
}

// Performance comparison (example measurements):
// v0.7.x: ~800ms (4 API calls)
// v0.8.x first call: ~800ms (4 API calls, cache population)
// v0.8.x subsequent calls: ~50ms (4 cache hits)
```

### 5. Cache-Conscious Data Strategy

Design data access patterns to maximize cache effectiveness:

```javascript
class PerformantBudgetManager {
  constructor(budgetId) {
    this.budgetId = budgetId;
  }

  async initialize() {
    // Warm cache proactively
    await client.callTool('set_default_budget', { budget_id: this.budgetId });

    // Cache warming happens in background, continue with other setup
    this.setupComplete = true;
  }

  async getFrequentData() {
    // These benefit from long cache TTL (accounts, categories rarely change)
    const [accounts, categories] = await Promise.all([
      client.callTool('list_accounts', { budget_id: this.budgetId }),
      client.callTool('list_categories', { budget_id: this.budgetId })
    ]);

    return {
      accounts: JSON.parse(accounts.content[0].text),
      categories: JSON.parse(categories.content[0].text)
    };
  }

  async getRecentTransactions(accountId = null) {
    // Transactions change frequently - shorter cache TTL
    const params = { budget_id: this.budgetId };
    if (accountId) params.account_id = accountId;

    const result = await client.callTool('list_transactions', params);
    return JSON.parse(result.content[0].text);
  }

  async getCachePerformance() {
    const result = await client.callTool('diagnostic_info');
    const data = JSON.parse(result.content[0].text);

    return {
      hitRate: data.diagnostics.cache_stats.hit_rate,
      totalEntries: data.diagnostics.cache_stats.total_entries,
      performance: data.diagnostics.cache_stats.hit_rate > 0.6 ? 'Good' : 'Needs optimization'
    };
  }
}
```

### 6. Modular Architecture Performance Benefits

The v0.8.x modular architecture provides performance improvements through:

**Reduced Memory Footprint:**
- Service modules load only when needed
- Better garbage collection due to focused responsibility
- Efficient dependency injection

**Faster Error Handling:**
- Pre-formatted error responses
- Reduced error processing overhead
- Consistent error message generation

**Optimized Tool Execution:**
- Registry-based tool dispatch
- Reduced code path complexity
- Faster schema validation

```javascript
// v0.8.x performance monitoring
class PerformanceMonitor {
  async getSystemMetrics() {
    const result = await client.callTool('diagnostic_info');
    const data = JSON.parse(result.content[0].text);

    return {
      cache: {
        hitRate: data.diagnostics.cache_stats.hit_rate,
        avgResponseTime: this.calculateAverageResponseTime(),
        memoryEfficiency: data.diagnostics.server_info.memory_usage
      },
      architecture: {
        toolRegistryOverhead: 'Minimal (<1ms)',
        dependencyInjectionCost: 'Negligible',
        modularLoadTime: 'Optimized'
      }
    };
  }

  calculateAverageResponseTime() {
    // In practice, cache hits: ~5-50ms, cache misses: ~200-800ms
    return 'Cache hits: ~10ms, Cache misses: ~400ms';
  }
}
```

### Performance Best Practices Summary

1. **Leverage Automatic Caching**: Let v0.8.x's enhanced caching handle performance optimization
2. **Monitor Cache Performance**: Use diagnostic tools to track hit rates and optimize access patterns
3. **Warm Cache Proactively**: Use `set_default_budget` to trigger cache warming
4. **Design for Cache Effectiveness**: Group related operations to maximize cache hits
5. **Use Parallel Operations**: Combined with caching, parallel calls provide dramatic speedups
6. **Monitor Memory Usage**: The new LRU eviction prevents memory growth while maintaining performance

## Security Considerations

### 1. Token Management

```javascript
class SecureTokenManager {
  constructor() {
    this.token = process.env.YNAB_ACCESS_TOKEN;
    this.validateToken();
  }
  
  validateToken() {
    if (!this.token) {
      throw new Error('YNAB_ACCESS_TOKEN environment variable is required');
    }
    
    if (this.token.length < 64) {
      console.warn('YNAB token appears to be too short');
    }
    
    // Never log the actual token
    console.log(`Token loaded: ${this.token.substring(0, 8)}...`);
  }
  
  // Never expose the token in error messages or logs
  sanitizeError(error) {
    const errorStr = error.toString();
    return errorStr.replace(this.token, '[REDACTED]');
  }
}
```

### 2. Input Sanitization

```javascript
class InputSanitizer {
  static sanitizeString(input, maxLength = 200) {
    if (typeof input !== 'string') {
      return '';
    }
    
    // Remove potentially dangerous characters
    const sanitized = input
      .replace(/[<>]/g, '') // Remove HTML tags
      .replace(/['"]/g, '') // Remove quotes
      .trim();
    
    return sanitized.substring(0, maxLength);
  }
  
  static sanitizeAmount(input) {
    const amount = parseFloat(input);
    if (isNaN(amount)) {
      throw new Error('Invalid amount');
    }
    
    // Limit to reasonable range
    if (Math.abs(amount) > 1000000) {
      throw new Error('Amount exceeds maximum allowed value');
    }
    
    return amount;
  }
}
```

## Common Pitfalls

### 1. Milliunits Confusion

**Problem**: Forgetting to convert between dollars and milliunits

```javascript
// ❌ Wrong - using dollars directly
await client.callTool('create_transaction', {
  budget_id: budgetId,
  account_id: accountId,
  amount: -25.50, // This will be interpreted as -25.50 milliunits ($-0.02550)
  date: '2024-01-15'
});

// ✅ Correct - convert to milliunits
const milliunits = await AmountConverter.toMilliunits(25.50);
await client.callTool('create_transaction', {
  budget_id: budgetId,
  account_id: accountId,
  amount: -milliunits, // -25500 milliunits ($-25.50)
  date: '2024-01-15'
});
```

### 2. Date Format Issues

**Problem**: Using incorrect date formats

```javascript
// ❌ Wrong - various incorrect formats
const badDates = [
  '01/15/2024',    // US format
  '15/01/2024',    // European format
  '2024-1-15',     // Missing zero padding
  '2024-01-15T10:30:00Z' // ISO with time
];

// ✅ Correct - ISO date format (YYYY-MM-DD)
const goodDate = '2024-01-15';
```

### 3. Ignoring Account Types

**Problem**: Not considering account types when creating transactions

```javascript
// ❌ Wrong - positive amount for credit card payment
await client.callTool('create_transaction', {
  budget_id: budgetId,
  account_id: creditCardAccountId,
  amount: 50000, // This increases credit card debt
  date: '2024-01-15',
  memo: 'Payment'
});

// ✅ Correct - negative amount for credit card payment
await client.callTool('create_transaction', {
  budget_id: budgetId,
  account_id: creditCardAccountId,
  amount: -50000, // This reduces credit card debt
  date: '2024-01-15',
  memo: 'Payment'
});
```

### 4. Not Handling Deleted/Hidden Items

**Problem**: Including deleted or hidden categories/accounts in operations

```javascript
// ❌ Wrong - including all categories
const allCategories = categories.category_groups
  .flatMap(group => group.categories);

// ✅ Correct - filter out deleted/hidden items
const activeCategories = categories.category_groups
  .filter(group => !group.hidden && !group.deleted)
  .flatMap(group => group.categories.filter(cat => !cat.hidden && !cat.deleted));
```

## Example Workflows

### 1. Complete Transaction Creation Workflow

```javascript
async function createTransactionWorkflow(userInput) {
  try {
    // 1. Validate input
    YNABValidator.validateTransaction(userInput);
    
    // 2. Get budget
    const budgets = await cache.getBudgets();
    const budget = budgets.budgets[0]; // Use first budget or let user choose
    
    // 3. Find account
    const lazyData = new LazyYNABData(budget.id);
    const account = await lazyData.findAccountByName(userInput.accountName);
    if (!account) {
      throw new Error(`Account "${userInput.accountName}" not found`);
    }
    
    // 4. Find category (optional)
    let categoryId = null;
    if (userInput.categoryName) {
      const category = await lazyData.findCategoryByName(userInput.categoryName);
      if (category) {
        categoryId = category.id;
      }
    }
    
    // 5. Convert amount
    const milliunits = await AmountConverter.toMilliunits(Math.abs(userInput.amount));
    const amount = userInput.amount < 0 ? -milliunits : milliunits;
    
    // 6. Create transaction
    const result = await RetryHandler.withRetry(async () => {
      return await client.callTool('create_transaction', {
        budget_id: budget.id,
        account_id: account.id,
        amount: amount,
        date: userInput.date,
        payee_name: userInput.payeeName,
        category_id: categoryId,
        memo: InputSanitizer.sanitizeString(userInput.memo),
        cleared: 'uncleared',
        approved: true
      });
    });
    
    const transaction = JSON.parse(result.content[0].text);
    return {
      success: true,
      transaction: transaction.transaction,
      message: `Transaction created successfully: ${userInput.payeeName} for $${Math.abs(userInput.amount)}`
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Usage
const result = await createTransactionWorkflow({
  accountName: 'Checking',
  amount: -25.50,
  date: '2024-01-15',
  payeeName: 'Coffee Shop',
  categoryName: 'Dining Out',
  memo: 'Morning coffee'
});
```

### 2. Budget Analysis Workflow

```javascript
async function analyzeBudgetWorkflow(budgetId, month = null) {
  try {
    // Use current month if not specified
    if (!month) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    
    // Get monthly data
    const monthResult = await client.callTool('get_month', {
      budget_id: budgetId,
      month: month
    });
    const monthData = JSON.parse(monthResult.content[0].text);
    
    // Analyze categories
    const analysis = {
      month: month,
      totalBudgeted: 0,
      totalActivity: 0,
      totalAvailable: 0,
      overspentCategories: [],
      underspentCategories: [],
      categoryBreakdown: []
    };
    
    for (const category of monthData.month.categories) {
      if (category.hidden || category.deleted) continue;
      
      const budgeted = category.budgeted / 1000;
      const activity = category.activity / 1000;
      const balance = category.balance / 1000;
      
      analysis.totalBudgeted += budgeted;
      analysis.totalActivity += Math.abs(activity);
      analysis.totalAvailable += balance;
      
      const categoryInfo = {
        name: category.name,
        budgeted: budgeted,
        activity: activity,
        balance: balance,
        percentUsed: budgeted !== 0 ? (Math.abs(activity) / budgeted) * 100 : 0
      };
      
      analysis.categoryBreakdown.push(categoryInfo);
      
      // Identify overspent categories
      if (balance < 0) {
        analysis.overspentCategories.push(categoryInfo);
      }
      
      // Identify significantly underspent categories
      if (budgeted > 0 && categoryInfo.percentUsed < 50) {
        analysis.underspentCategories.push(categoryInfo);
      }
    }
    
    return analysis;
    
  } catch (error) {
    throw new Error(`Budget analysis failed: ${error.message}`);
  }
}
```

## Troubleshooting

### Common Issues and Solutions

#### 1. "Invalid or expired YNAB access token"

**Symptoms**: 401 authentication errors
**Solutions**:
- Check if `YNAB_ACCESS_TOKEN` environment variable is set
- Verify token in YNAB Developer Settings
- Generate new token if expired
- Ensure token has no extra spaces or characters

#### 2. "Rate limit exceeded"

**Symptoms**: 429 errors, especially during bulk operations
**Solutions**:
- Implement retry logic with exponential backoff
- Add delays between API calls
- Use batch processing with smaller batch sizes
- Cache frequently accessed data

#### 3. "Resource not found" errors

**Symptoms**: 404 errors when accessing budgets, accounts, or transactions
**Solutions**:
- Verify IDs are correct and current
- Check if resources have been deleted
- Use list operations to discover valid IDs
- Handle deleted/hidden items in your code

#### 4. Incorrect transaction amounts

**Symptoms**: Transactions appear with wrong amounts
**Solutions**:
- Always convert dollars to milliunits before API calls
- Use the conversion utility for accuracy
- Remember negative amounts for outflows
- Consider account types (credit cards, etc.)

#### 5. Date-related errors

**Symptoms**: Validation errors or unexpected behavior with dates
**Solutions**:
- Use ISO format (YYYY-MM-DD) for all dates
- Validate date format before API calls
- Consider timezone differences
- Use first day of month for monthly operations

### Debug Techniques

```javascript
// Enable detailed logging
class DebugLogger {
  static logAPICall(toolName, params, result) {
    console.log(`[API] ${toolName}:`, {
      params: this.sanitizeParams(params),
      resultSize: JSON.stringify(result).length,
      timestamp: new Date().toISOString()
    });
  }
  
  static sanitizeParams(params) {
    // Remove sensitive data from logs
    const sanitized = { ...params };
    if (sanitized.budget_id) {
      sanitized.budget_id = sanitized.budget_id.substring(0, 8) + '...';
    }
    return sanitized;
  }
  
  static logError(error, context) {
    console.error(`[ERROR] ${context}:`, {
      message: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
  }
}

// Usage in your code
const result = await client.callTool('list_budgets', {});
DebugLogger.logAPICall('list_budgets', {}, result);
```

## Recent Improvements & Key Features

### 🔍 Accurate Overspending Detection

The financial analysis now correctly identifies overspending using YNAB's definition:

**✅ Correct Approach (Current)**
```javascript
// Overspending occurs when Available balance goes negative
const overspentCategories = categories.filter(cat => cat.balance < 0);
```

**❌ Previous Incorrect Approach** 
```javascript
// This incorrectly flagged categories as overspent
const incorrect = categories.filter(cat => Math.abs(cat.activity) > cat.budgeted);
```

**Key Understanding:**
- `balance` = Available amount = previous balance + budgeted + activity
- Overspending = `balance < 0` (Available goes negative)
- Spending more than monthly budgeted ≠ overspending if funds carried forward

### 📊 Statistical Spending Trends

The new trend analysis uses linear regression for reliable pattern detection:

```javascript
// Example of enhanced trend data
{
  "category": "Groceries",
  "trend": "increasing", 
  "percentChange": 15.2,
  "explanation": "Based on 6 months of data, spending in Groceries has been increasing by 15.2% over the analysis period. This is a moderate trend (65% confidence).",
  "data_points": 6,
  "reliability_score": 65,
  "significance": "medium"
}
```

**Key Features:**
- Linear regression over multiple months (minimum 3 months required)
- Confidence scores (0-100%) for trend reliability
- User-friendly explanations for each trend
- Statistical significance levels (high/medium/low)

### 💡 Comprehensive Budget Optimization

Three types of optimization insights are now provided:

1. **Historical Pattern Analysis** - Multi-month trends with statistical backing
2. **Current Month Analysis** - Monthly spending vs assignments  
3. **Balance Analysis** - Unused funds identification

```javascript
// Example budget optimization insight
{
  "type": "success",
  "title": "Consistently Under-Spent Categories (Historical Pattern)",
  "description": "3 categories show reliable decreasing spending trends over 6 months",
  "suggestions": [
    "Review if reduced spending reflects changed needs",
    "Consider reallocating excess budget to savings goals",
    "Categories: Dining Out, Entertainment, Shopping"
  ]
}
```

### 🎯 Clear Analysis Scope

All insights now clearly indicate their analysis scope:
- **Historical Pattern**: Multi-month trends with reliability scores
- **Current Month**: This month's spending vs assignments
- **Balance Analysis**: Available funds across categories

This eliminates confusion about whether insights are based on current-month data or historical patterns.

---

This developer guide provides practical patterns and solutions for common scenarios. For complete API documentation, see the [API Reference](API.md).
