# Type Definitions - YNAB MCP Server

This directory contains centralized TypeScript type definitions and interfaces used throughout the YNAB MCP Server codebase.

## Purpose & Responsibilities

The `src/types/` directory provides:

1. **Shared Types** - Common types, interfaces, and enums used across modules
2. **ToolContext** - Central dependency injection object for tool handlers
3. **Handler Signatures** - Type-safe handler function signatures
4. **Error Classes** - Custom error types with context
5. **Domain Types** - Reconciliation, caching, and configuration types

## Key Files & Responsibilities

| File | Responsibility | Lines | Critical |
|------|---------------|-------|----------|
| **index.ts** | Shared types, error classes, server configuration | ~300 | HIGH |
| **toolRegistration.ts** | ToolContext, handler signatures (Handler, DeltaHandler, etc.) | ~200 | CRITICAL |
| **toolAnnotations.ts** | MCP annotation types and interfaces | ~100 | MEDIUM |
| **reconciliation.ts** | Reconciliation-specific type definitions | ~150 | MEDIUM |

## Critical Patterns & Conventions

### 1. ToolContext - Central Dependency Injection Object

`ToolContext` is the heart of the dependency injection pattern, providing all shared dependencies to tool handlers:

```typescript
export interface ToolContext {
  // YNAB API client
  ynabAPI: ynab.API;

  // Delta caching (efficient updates)
  deltaFetcher: DeltaFetcher;
  deltaCache: DeltaCache;
  serverKnowledgeStore: ServerKnowledgeStore;

  // Default budget management
  getDefaultBudgetId: () => string | undefined;
  setDefaultBudget: (budgetId: string) => void;

  // Cache and diagnostics
  cacheManager: CacheManager;
  diagnosticManager?: DiagnosticManager;

  // Error handling
  errorHandler: ErrorHandler;
}
```

**Why Critical**: All tool handlers receive this context via adapters. Any changes to ToolContext affect all tools.

**What Breaks**: Adding required fields → all adapters break. Removing fields → tool handlers fail. Circular dependencies → build errors.

### 2. Handler Signatures

Type-safe handler function signatures ensure consistent tool implementations:

```typescript
// Standard handler (read-only, with input)
export type Handler<TInput extends Record<string, unknown>> = (
  api: ynab.API,
  params: TInput,
  errorHandler?: ErrorHandler
) => Promise<CallToolResult>;

// Delta-aware handler (supports delta caching)
export type DeltaHandler<TInput extends Record<string, unknown>> = (
  api: ynab.API,
  deltaFetcher: DeltaFetcher,
  params: TInput,
  errorHandler?: ErrorHandler
) => Promise<CallToolResult>;

// Write handler (updates delta cache and server knowledge)
export type WriteHandler<TInput extends Record<string, unknown>> = (
  api: ynab.API,
  deltaCache: DeltaCache,
  serverKnowledgeStore: ServerKnowledgeStore,
  params: TInput,
  errorHandler?: ErrorHandler
) => Promise<CallToolResult>;

// No-input handler (e.g., list_budgets, get_user)
export type NoInputHandler = (
  api: ynab.API,
  errorHandler?: ErrorHandler
) => Promise<CallToolResult>;
```

**Why Critical**: Ensures type safety across all tool handlers. TypeScript catches signature mismatches at compile time.

**What Breaks**: Wrong signature → type errors. Missing parameters → runtime errors.

### 3. Error Classes with Context

Custom error classes extend `BaseError` with contextual information:

```typescript
export class BaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends BaseError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
  }
}

export class BudgetNotFoundError extends BaseError {
  constructor(budgetId: string) {
    super(`Budget ${budgetId} not found`, 'BUDGET_NOT_FOUND', { budgetId });
  }
}
```

**Why Important**: Provides structured error information for logging, debugging, and client error handling.

**What Breaks**: Not extending BaseError → inconsistent error format. Missing context → harder debugging.

### 4. MCP Annotation Types

MCP annotation types follow the Model Context Protocol specification:

```typescript
export interface ToolAnnotations {
  // Human-readable title for UI display
  title?: string;

  // Advisory hints (not enforced, AI clients decide)
  readOnlyHint?: boolean; // Tool only reads data
  destructiveHint?: boolean; // Tool performs irreversible operations
  idempotentHint?: boolean; // Repeated calls are safe
  openWorldHint?: boolean; // Tool calls external APIs
}

export const ToolAnnotationPresets = {
  READ_ONLY_EXTERNAL: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  WRITE_EXTERNAL_DELETE: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  // ... more presets
};
```

**Why Important**: Helps AI assistants understand tool safety characteristics and expected behavior.

**What Breaks**: Wrong hints → AI makes poor decisions about tool usage.

### 5. Reconciliation Types

Reconciliation types define the structure of reconciliation inputs, outputs, and intermediate results:

```typescript
export interface ReconcileInput {
  budget_id?: string;
  account_id: string;
  csv_data: string;
  bank_preset?: 'TD' | 'RBC' | 'SCOTIABANK' | 'WEALTHSIMPLE' | 'TANGERINE';
  auto_create?: boolean;
  auto_update?: boolean;
  dry_run?: boolean;
}

export interface ReconcileResult {
  // Summary statistics
  total_csv_transactions: number;
  total_ynab_transactions: number;
  ynab_in_range_count: number;
  ynab_outside_range_count: number;

  // Match statistics
  matched_count: number;
  auto_matched_count: number;
  manual_review_count: number;

  // Discrepancy statistics
  discrepancies_count: number;
  missing_from_bank_count: number;
  missing_from_ynab_count: number;
  duplicates_count: number;

  // Bulk operation results
  created_count: number;
  updated_count: number;
  uncleared_count: number;
  failed_count: number;

  // Detailed results
  matches: Match[];
  discrepancies: Discrepancy[];
  errors: BulkError[];
  recommendations: Recommendation[];

  // Report
  report: string;
}
```

**Why Important**: Defines contract between reconciliation tool and clients.

**What Breaks**: Changing field names → clients break. Missing required fields → validation errors.

## Common Development Tasks

### Adding a New Type to ToolContext

When adding a new shared dependency:

1. **Add to ToolContext interface** in `toolRegistration.ts`:
   ```typescript
   export interface ToolContext {
     // ... existing fields
     myNewService: MyNewService; // Add here
   }
   ```

2. **Update ToolContext creation** in `YNABMCPServer.ts`:
   ```typescript
   const toolContext: ToolContext = {
     // ... existing fields
     myNewService: this.myNewService, // Provide instance
   };
   ```

3. **Update all test mocks**:
   ```typescript
   const mockContext: ToolContext = {
     // ... existing mocks
     myNewService: createMockService(),
   };
   ```

### Adding a New Handler Signature

When adding a new handler pattern:

1. **Define type** in `toolRegistration.ts`:
   ```typescript
   export type MyNewHandler<TInput extends Record<string, unknown>> = (
     api: ynab.API,
     params: TInput,
     myNewParam: MyType,
     errorHandler?: ErrorHandler
   ) => Promise<CallToolResult>;
   ```

2. **Create adapter helper** in `src/tools/adapters.ts`:
   ```typescript
   adaptMyNew:
     <TInput extends Record<string, unknown>>(
       handler: MyNewHandler<TInput>,
       myNewParam: MyType
     ) =>
     async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
       handler(ynabAPI, input, myNewParam, errorHandler),
   ```

3. **Use in tool registration**:
   ```typescript
   registry.register({
     name: 'my_tool',
     handler: adaptMyNew(handleMyTool, myNewParam),
   });
   ```

### Adding a New Error Class

When adding a new error type:

1. **Extend BaseError** in `src/utils/errors.ts`:
   ```typescript
   export class MyNewError extends BaseError {
     constructor(message: string, context?: Record<string, unknown>) {
       super(message, 'MY_NEW_ERROR', context);
     }
   }
   ```

2. **Export from `src/types/index.ts`**:
   ```typescript
   export { MyNewError } from '../utils/errors.js';
   ```

3. **Use in error handling**:
   ```typescript
   throw new MyNewError('Something went wrong', { foo: 'bar' });
   ```

### Adding Domain-Specific Types

When adding types for a specific domain (e.g., new reconciliation types):

1. **Create new file** in `src/types/` (e.g., `myDomain.ts`):
   ```typescript
   export interface MyDomainInput {
     field1: string;
     field2: number;
   }

   export interface MyDomainOutput {
     result: string;
   }
   ```

2. **Export from `index.ts`**:
   ```typescript
   export * from './myDomain.js';
   ```

3. **Use in tool handlers**:
   ```typescript
   import type { MyDomainInput, MyDomainOutput } from '../types/index.js';
   ```

## Testing Approach

Type definitions are tested implicitly through:

1. **TypeScript Compilation** - Type errors caught at compile time
2. **Unit Tests** - Ensure types match runtime behavior
3. **Integration Tests** - Verify type safety across module boundaries

### Example Type Test

```typescript
describe('ToolContext', () => {
  it('should provide all required dependencies', () => {
    const context: ToolContext = createTestContext();

    expect(context.ynabAPI).toBeDefined();
    expect(context.cacheManager).toBeDefined();
    expect(context.errorHandler).toBeDefined();
    expect(context.getDefaultBudgetId).toBeInstanceOf(Function);
  });
});
```

## What Will Break If Violated

### 1. Breaking ToolContext Changes

**Problem**: Adding required fields to ToolContext without updating all usage sites.

**Impact**: All tool factories break, compilation errors, runtime failures.

**Fix**: When adding to ToolContext:

1. Make new fields **optional** initially
2. Update all creation sites
3. Make required after migration

```typescript
// PHASE 1: Add as optional
export interface ToolContext {
  myNewField?: MyType;
}

// PHASE 2: Make required after all sites updated
export interface ToolContext {
  myNewField: MyType;
}
```

### 2. Circular Dependencies

**Problem**: Type files importing from modules that import from types.

**Impact**: Build errors, module resolution failures.

**Fix**: Types should **never** import from implementation files. Only import other types.

```typescript
// BAD (circular dependency)
import { CacheManager } from '../server/cacheManager.js';

// GOOD (type-only import)
import type { CacheManager } from '../server/cacheManager.js';
```

### 3. Inconsistent Handler Signatures

**Problem**: Tool handlers not matching type signatures.

**Impact**: Type errors, adapter failures, runtime errors.

**Fix**: Always use correct handler signature:

```typescript
// BAD (missing context)
async function handleMyTool(input: MyInput): Promise<MyOutput>

// GOOD (matches Handler<TInput>)
async function handleMyTool(
  api: ynab.API,
  params: MyInput,
  errorHandler?: ErrorHandler
): Promise<CallToolResult>
```

### 4. Missing Error Context

**Problem**: Creating errors without context information.

**Impact**: Harder debugging, poor error messages, no traceability.

**Fix**: Always provide context when throwing errors:

```typescript
// BAD (no context)
throw new BudgetNotFoundError('Budget not found');

// GOOD (with context)
throw new BudgetNotFoundError(budgetId);
```

### 5. Type-Runtime Mismatch

**Problem**: TypeScript types don't match actual runtime values.

**Impact**: Type safety illusion, runtime errors despite type checks.

**Fix**: Use Zod schemas for runtime validation:

```typescript
// Define both type and schema
export const MySchema = z.object({
  field: z.string(),
});
export type MyType = z.infer<typeof MySchema>;

// Validate at runtime
const validated = MySchema.parse(input);
```

## Type Safety Best Practices

1. **Use `strict: true`** in tsconfig.json (already enabled)
2. **Avoid `any` type** - Use `unknown` if type is truly unknown
3. **Use type-only imports** - Prevents circular dependencies
4. **Prefer interfaces over types** - Better error messages, easier to extend
5. **Use Zod for runtime validation** - Bridge between types and runtime

## Integration Points

### With Server (`src/server/`)

- **ToolContext**: Created in YNABMCPServer, injected into tools
- **Error Classes**: Used by errorHandler for consistent responses
- **Configuration Types**: Define server configuration structure

### With Tools (`src/tools/`)

- **Handler Signatures**: All tool handlers follow these types
- **ToolContext**: Injected via adapters
- **Domain Types**: Reconciliation, transaction, budget types

### With Utils (`src/utils/`)

- **Error Classes**: Defined in utils, exported from types
- **Shared Interfaces**: Money, date, validation types

## Related Documentation

- [Root CLAUDE.md](../../CLAUDE.md) - Project overview
- [Server CLAUDE.md](../server/CLAUDE.md) - Server components and ToolContext creation
- [Tools CLAUDE.md](../tools/CLAUDE.md) - Tool implementation using these types
- [Utils CLAUDE.md](../utils/CLAUDE.md) - Utility types and helpers
