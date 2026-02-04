# Server Components - YNAB MCP Server

This directory contains the core orchestration layer for the YNAB MCP Server, managing the Model Context Protocol interface, caching, error handling, budget resolution, and all server-side coordination.

## Purpose & Responsibilities

The `src/server/` directory implements:

1. **MCP Protocol Orchestration** - Request/response handling, tool registration, resources, prompts, completions
2. **Caching Strategy** - Multi-tier caching with LRU eviction, delta requests, and server knowledge tracking
3. **Error Handling** - Centralized, consistent error responses across all tools
4. **Budget Resolution** - Default budget ID management and resolution
5. **Security** - Input validation, rate limiting, security middleware
6. **Diagnostics** - Health monitoring, cache statistics, system information

## Key Files & Responsibilities

| File | Responsibility | Criticality | Lines |
|------|---------------|-------------|-------|
| **YNABMCPServer.ts** | Main orchestration server, MCP lifecycle, tool/resource/prompt handlers | CRITICAL | ~600 |
| **toolRegistry.ts** | Tool registration, validation, execution, progress notifications | CRITICAL | ~500 |
| **completions.ts** | MCP completions manager for autocomplete (budget_id, account_id, etc.) | HIGH | ~300 |
| **cacheManager.ts** | Enhanced caching with LRU, observability, stale-while-revalidate | CRITICAL | ~400 |
| **deltaCache.ts** | Delta request management, server knowledge tracking, merge operations | HIGH | ~350 |
| **deltaCache.merge.ts** | Entity merging functions for delta responses (transactions, categories, accounts) | HIGH | ~200 |
| **serverKnowledgeStore.ts** | Tracks last known server_knowledge values per cache key | MEDIUM | ~100 |
| **budgetResolver.ts** | Budget ID resolution with default budget support | HIGH | ~150 |
| **errorHandler.ts** | Centralized error handling, consistent error responses | CRITICAL | ~200 |
| **config.ts** | Environment validation, server configuration | CRITICAL | ~150 |
| **resources.ts** | MCP resource definitions and handlers (resource templates) | MEDIUM | ~250 |
| **prompts.ts** | MCP prompt definitions and handlers | LOW | ~150 |
| **diagnostics.ts** | System diagnostics, health monitoring, cache statistics | MEDIUM | ~200 |
| **securityMiddleware.ts** | Security validation, wrapper functions | HIGH | ~150 |
| **responseFormatter.ts** | JSON response formatting (always minified) | LOW | ~10 |
| **rateLimiter.ts** | Rate limiting for YNAB API compliance | MEDIUM | ~150 |
| **requestLogger.ts** | Request/response logging middleware | LOW | ~100 |
| **cacheKeys.ts** | Centralized cache key generation utilities | MEDIUM | ~100 |

## Critical Patterns & Conventions

### 1. Dependency Injection Pattern

All server components use explicit dependency injection for testability and modularity:

```typescript
// In YNABMCPServer.ts
constructor() {
  this.errorHandler = new ErrorHandler();
  this.cacheManager = new CacheManager(config);
  this.budgetResolver = new BudgetResolver(
    () => this.getDefaultBudgetId(),
    this.errorHandler
  );
  // ... inject into other services
}
```

**Why Critical**: Enables unit testing, loose coupling, and clear dependency graphs.

**What Breaks**: If you create services without DI, tests become impossible, circular dependencies emerge, and the system becomes tightly coupled.

### 2. MCP Handler Pattern

All MCP handlers (tools, resources, prompts, completions) follow a consistent pattern:

```typescript
// Tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return this.toolRegistry.executeTool(
    request.params.name,
    request.params.arguments ?? {}
  );
});

// Resource handler
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return this.resourcesManager.handleReadResource(request.params.uri);
});
```

**Why Critical**: Ensures consistent error handling, logging, and security across all MCP operations.

**What Breaks**: Direct implementation without the registry/manager pattern bypasses security, error handling, and caching.

### 3. Cache Wrapper Pattern

Use `cacheManager.wrap()` for automatic caching with observability:

```typescript
return cacheManager.wrap('cache_key', {
  ttl: CACHE_TTLS.ACCOUNTS, // Use predefined TTL constants
  staleWhileRevalidate: 120000, // Optional background refresh
  loader: () => expensiveOperation(),
});
```

**Predefined TTL Constants** (in `cacheManager.ts`):

- `CACHE_TTLS.BUDGETS` - 10 minutes
- `CACHE_TTLS.ACCOUNTS` - 5 minutes
- `CACHE_TTLS.CATEGORIES` - 5 minutes
- `CACHE_TTLS.PAYEES` - 10 minutes
- `CACHE_TTLS.TRANSACTIONS` - 2 minutes
- `CACHE_TTLS.SCHEDULED_TRANSACTIONS` - 5 minutes
- `CACHE_TTLS.USER_INFO` - 30 minutes
- `CACHE_TTLS.MONTHS` - 5 minutes

**Why Critical**: Reduces YNAB API calls, respects rate limits, improves response times.

**What Breaks**: Missing cache invalidation after writes → stale data. Wrong TTLs → excessive API calls or stale data.

### 4. Progress Notification Pattern

Long-running operations emit MCP progress notifications:

```typescript
// In tool handler
async function handleReconciliation(
  input: ReconcileInput,
  sendProgress?: ProgressCallback
): Promise<ReconcileResult> {
  await sendProgress?.({
    progress: 50,
    total: 100,
    message: 'Matching transactions...',
  });
}
```

**Why Critical**: Provides user feedback for operations that take >5 seconds.

**What Breaks**: Missing optional chaining (`?.`) → TypeError if no progress callback. Missing progress updates → poor UX.

### 5. Error Response Pattern

Always use `ErrorHandler.createErrorResponse()` for consistency:

```typescript
return ErrorHandler.createErrorResponse(
  'OPERATION_FAILED',
  'Detailed error message',
  {
    operation: 'tool_name',
    budgetId: input.budget_id,
  }
);
```

**Error Codes**:

- `MISSING_DEFAULT_BUDGET` - No default budget set
- `BUDGET_NOT_FOUND` - Budget ID doesn't exist
- `OPERATION_FAILED` - Generic operation failure
- `VALIDATION_ERROR` - Input validation failure
- `RATE_LIMIT_EXCEEDED` - YNAB API rate limit hit

**Why Critical**: Consistent error format allows clients to parse and handle errors reliably.

**What Breaks**: Throwing raw errors → inconsistent response format, poor error messages, no contextual data.

### 6. Delta Caching Pattern

Use `deltaCache.fetchWithDelta()` for efficient updates:

```typescript
const result = await deltaCache.fetchWithDelta({
  cacheKey: `transactions:${budgetId}`,
  fetchFn: (lastKnowledge) =>
    ynabAPI.getTransactions(budgetId, lastKnowledge),
  mergeFn: DeltaCache.mergeTransactions, // Built-in merge functions
});
```

**Built-in Merge Functions**:

- `DeltaCache.mergeTransactions` - Merge transaction deltas
- `DeltaCache.mergeCategories` - Merge category deltas
- `DeltaCache.mergeAccounts` - Merge account deltas

**Why Critical**: Reduces API bandwidth, faster responses, respects YNAB rate limits.

**What Breaks**: Missing merge function → cache corruption. Incorrect cache keys → stale data. Not using Date.UTC → timezone bugs.

## Dependencies

### Imports From

- `@modelcontextprotocol/sdk` - MCP protocol types and schemas
- `ynab` - YNAB API client
- `zod` - Schema validation
- `../tools/` - Tool implementations
- `../types/` - Type definitions
- `../utils/` - Utility functions

### Imported By

- `../index.ts` - Entry point
- `../tools/` - Tool implementations (via ToolContext)

## Common Development Tasks

### Adding a New MCP Capability

When adding new MCP features (tools, resources, prompts, completions):

1. **Create handler module** in `src/server/` (e.g., `myFeature.ts`)
2. **Implement with DI pattern**:
   ```typescript
   export class MyFeatureManager {
     constructor(
       private cacheManager: CacheManager,
       private errorHandler: ErrorHandler
     ) {}
   }
   ```
3. **Register in YNABMCPServer**:
   ```typescript
   this.myFeatureManager = new MyFeatureManager(
     this.cacheManager,
     this.errorHandler
   );
   ```
4. **Add MCP handler**:
   ```typescript
   server.setRequestHandler(MyFeatureSchema, async (request) => {
     return this.myFeatureManager.handle(request.params);
   });
   ```
5. **Add tests** in `src/server/__tests__/myFeature.test.ts`

### Modifying Cache Behavior

To adjust cache TTLs or strategy:

1. **Update TTL constants** in `cacheManager.ts`:
   ```typescript
   export const CACHE_TTLS = {
     MY_RESOURCE: 5 * 60 * 1000, // 5 minutes
   };
   ```
2. **Adjust stale-while-revalidate** for background refresh:
   ```typescript
   return cacheManager.wrap('key', {
     ttl: CACHE_TTLS.MY_RESOURCE,
     staleWhileRevalidate: 120000, // 2 min background refresh
     loader: () => fetchData(),
   });
   ```
3. **Add cache invalidation** after writes:
   ```typescript
   await updateResource();
   this.cacheManager.delete(`resource:${id}`);
   ```

### Adding Progress Notifications

To add progress to a tool:

1. **Update handler signature** to accept `ProgressCallback`:
   ```typescript
   async function handleMyTool(
     input: MyInput,
     sendProgress?: ProgressCallback
   ): Promise<MyOutput>
   ```
2. **Emit progress updates**:
   ```typescript
   await sendProgress?.({
     progress: currentStep,
     total: totalSteps,
     message: 'Processing...',
   });
   ```
3. **Use optional chaining** (`?.`) to avoid errors when no callback

### Adding MCP Completions

To add autocomplete for a new argument:

1. **Update CompletionsManager** in `completions.ts`:
   ```typescript
   private async getMyFieldCompletions(
     budgetId: string
   ): Promise<Completion[]> {
     const items = await this.fetchItems(budgetId);
     return items.map(item => ({
       label: item.name,
       value: item.id,
     }));
   }
   ```
2. **Register in handleComplete**:
   ```typescript
   if (argument.name === 'my_field') {
     return this.getMyFieldCompletions(budgetId);
   }
   ```

## Testing Approach

### Unit Tests

- **Location**: `src/server/__tests__/*.test.ts`
- **Mock**: All external dependencies (YNAB API, MCP SDK)
- **Coverage**: 80% minimum, 90% for critical files (cacheManager, errorHandler, toolRegistry)
- **Focus**: Business logic, error handling, edge cases

### Integration Tests

- **Location**: `src/server/__tests__/*.integration.test.ts`
- **Mock**: YNAB API (use test fixtures)
- **Real**: MCP protocol flow, cache interactions
- **Focus**: End-to-end MCP request/response cycles

### Example Unit Test

```typescript
describe('CacheManager', () => {
  it('should cache results with TTL', async () => {
    const manager = new CacheManager({ maxEntries: 100 });
    const loader = vi.fn(() => Promise.resolve({ data: 'test' }));

    const result1 = await manager.wrap('key', { ttl: 5000, loader });
    const result2 = await manager.wrap('key', { ttl: 5000, loader });

    expect(result1).toEqual(result2);
    expect(loader).toHaveBeenCalledTimes(1); // Cached!
  });
});
```

## What Will Break If Violated

### 1. Cache Invalidation After Writes

**Problem**: Write operations (create, update, delete) without cache invalidation.

**Impact**: Stale data returned to clients, inconsistent state.

**Fix**: Always invalidate related caches after writes:

```typescript
await updateTransaction(transactionId, updates);
this.cacheManager.delete(`transaction:${transactionId}`);
this.cacheManager.delete(`transactions:${budgetId}`);
```

### 2. Missing ErrorHandler

**Problem**: Throwing raw errors or returning plain objects.

**Impact**: Inconsistent error format, poor error messages, no context.

**Fix**: Always use `ErrorHandler.createErrorResponse()`:

```typescript
// BAD
throw new Error('Budget not found');

// GOOD
return ErrorHandler.createErrorResponse(
  'BUDGET_NOT_FOUND',
  `Budget ${budgetId} not found`,
  { budgetId }
);
```

### 3. Progress Callback Without Optional Chaining

**Problem**: Calling `sendProgress()` without `?.` operator.

**Impact**: TypeError when no progress callback provided.

**Fix**: Always use optional chaining:

```typescript
// BAD
await sendProgress({ progress: 50, total: 100 });

// GOOD
await sendProgress?.({ progress: 50, total: 100 });
```

### 4. MCP Response Format Violations

**Problem**: Returning custom objects instead of MCP-compliant responses.

**Impact**: Protocol violations, client errors, failed requests.

**Fix**: Always return MCP-compliant response objects:

```typescript
// Tool response
return {
  content: [{ type: 'text', text: JSON.stringify(result) }],
};

// Resource response
return {
  contents: [{ uri, mimeType: 'application/json', text: data }],
};
```

### 5. Missing Dependency Injection

**Problem**: Creating dependencies directly in classes (`new YnabAPI()`).

**Impact**: Untestable code, tight coupling, circular dependencies.

**Fix**: Always inject dependencies via constructor:

```typescript
// BAD
class MyService {
  private api = new YnabAPI();
}

// GOOD
class MyService {
  constructor(private api: YnabAPI) {}
}
```

### 6. Hardcoded Configuration

**Problem**: Hardcoded API tokens, URLs, or configuration values.

**Impact**: Security issues, inflexible deployment, test failures.

**Fix**: Always use `config.ts` for environment-based configuration:

```typescript
import { config } from './config.js';

const token = config.ynabAccessToken; // From env var
```

## Integration Points

### With Tools (`src/tools/`)

- **ToolContext**: Injected into all tool factories with shared dependencies
- **Tool Registration**: Tools register via `toolRegistry.register()`
- **Cache Access**: Tools use `cacheManager` via ToolContext
- **Error Handling**: Tools use `errorHandler` via adapters

### With Types (`src/types/`)

- **ToolContext**: Central DI object for tool dependencies
- **Handler Signatures**: Handler, DeltaHandler, WriteHandler, NoInputHandler
- **Error Classes**: BaseError, ValidationError, custom errors

### With Utils (`src/utils/`)

- **Money Conversion**: milliunits ↔ dollars conversion
- **Date Utilities**: ISO date formatting, validation
- **Validation**: Amount validation, error formatting

## Performance Considerations

1. **Cache Aggressively**: Use long TTLs for rarely-changing data (budgets, categories)
2. **Delta Requests**: Always prefer delta requests for large datasets (transactions)
3. **Stale-While-Revalidate**: Use for non-critical data to improve response times
4. **Rate Limiting**: Respect YNAB API limits (200 requests/hour)
5. **Progress Notifications**: Use for operations >5 seconds to prevent timeouts

## Security Considerations

1. **Input Validation**: All tool inputs validated via Zod schemas
2. **Security Middleware**: Wraps all tool handlers for consistent validation
3. **Rate Limiting**: Prevents API abuse and YNAB rate limit violations
4. **Error Sanitization**: Error responses never leak sensitive data (API tokens)
5. **Budget ID Validation**: All budget IDs validated against YNAB API

## Related Documentation

- [Root CLAUDE.md](../../CLAUDE.md) - Project overview and architecture
- [Tools CLAUDE.md](../tools/CLAUDE.md) - Tool implementation patterns
- [Types CLAUDE.md](../types/CLAUDE.md) - Type definitions and interfaces
- [Reconciliation Architecture](../../docs/technical/reconciliation-system-architecture.md) - Reconciliation system deep-dive
