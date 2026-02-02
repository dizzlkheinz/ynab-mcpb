# Tools - YNAB MCP Server

This directory contains all YNAB operations exposed via MCP tools, organized by domain (budget, account, transaction, category, payee, month, utility, reconciliation).

## Purpose & Responsibilities

The `src/tools/` directory implements:

1. **YNAB Operations** - CRUD operations for budgets, accounts, transactions, categories, payees
2. **Tool Registration** - Domain-specific factory functions that register tools with the ToolRegistry
3. **Input Validation** - Zod schemas for type-safe input validation
4. **Adapter Pattern** - Consistent handler wrapping with dependency injection
5. **Special Operations** - Transaction comparison, export, receipt itemization, reconciliation

## Directory Structure

```
src/tools/
├── budgetTools.ts              # Budget listing and retrieval
├── accountTools.ts             # Account management (list, get, create)
├── transactionTools.ts         # Transaction facade (delegates to read/write modules)
├── transactionReadTools.ts     # Transaction read handlers (list/get/export)
├── transactionWriteTools.ts    # Transaction write handlers (create/update/delete)
├── transactionSchemas.ts       # Transaction Zod schemas (v0.18.4 extraction)
├── transactionUtils.ts         # Transaction utilities (v0.18.4 extraction)
├── categoryTools.ts            # Category management (list, get, update)
├── payeeTools.ts               # Payee listing and retrieval
├── monthTools.ts               # Monthly budget data (get, list)
├── utilityTools.ts             # User info and amount conversion
├── adapters.ts                 # Tool adapter implementations
├── toolCategories.ts           # Tool categorization and annotations
├── compareTransactions.ts      # CSV comparison tool entry point
├── exportTransactions.ts       # Transaction export to JSON files
├── reconcileAdapter.ts         # Legacy adapter for reconciliation tool
├── deltaFetcher.ts             # Delta request utilities
├── deltaSupport.ts             # Delta request support utilities
├── compareTransactions/        # CSV comparison modular components
│   ├── parser.ts               # CSV parsing
│   ├── matcher.ts              # Transaction matching
│   └── formatter.ts            # Report formatting
├── reconciliation/             # Comprehensive reconciliation system (v2)
│   ├── csvParser.ts            # CSV parsing with bank presets
│   ├── matcher.ts              # Fuzzy matching engine
│   ├── analyzer.ts             # Transaction analysis
│   ├── executor.ts             # Bulk transaction operations
│   ├── recommendationEngine.ts # Smart reconciliation recommendations
│   ├── reportFormatter.ts      # Human-readable reports
│   ├── signDetector.ts         # Auto-detection of debit/credit signs
│   ├── payeeNormalizer.ts      # Payee name normalization
│   └── ynabAdapter.ts          # YNAB API integration layer
└── schemas/                    # Zod schemas for input/output validation
    ├── common.ts               # Shared schemas (emptyObject, looseObject)
    └── outputs/                # Output validation schemas (11 files)
```

## Key Patterns & Conventions

### 1. Tool Registration Pattern

All tools use domain-specific factory functions that register with ToolRegistry:

```typescript
// In budgetTools.ts
export function registerBudgetTools(
  registry: ToolRegistry,
  context: ToolContext
): void {
  registry.register({
    name: 'list_budgets',
    description: 'List all budgets',
    inputSchema: emptyObjectSchema,
    handler: adaptNoInput(handleListBudgets, context),
    metadata: {
      annotations: {
        ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
        title: 'YNAB: List Budgets',
      },
    },
  });
}
```

**Why Critical**: Centralized registration enables consistent validation, security, error handling, and progress notifications.

**What Breaks**: Registering tools outside factory functions → bypasses security, no DI, inconsistent error handling.

### 2. Adapter Pattern

Use adapter helpers from `adapters.ts` to wrap handlers with dependency injection:

```typescript
import { adapt, adaptWrite, adaptWithDelta, adaptNoInput } from './adapters.js';

// Read-only tool with input
handler: adapt(handleGetBudget, context);

// Write tool (invalidates cache)
handler: adaptWrite(handleUpdateTransaction, context);

// Delta-aware tool
handler: adaptWithDelta(handleListTransactions, context);

// No-input tool
handler: adaptNoInput(handleGetUser, context);
```

**Adapter Types**:

- `adapt` - Standard read-only handler with input
- `adaptWrite` - Write handler (invalidates cache, supports progress)
- `adaptWithDelta` - Delta-aware handler for efficient updates
- `adaptNoInput` - Handler with no input parameters

**Why Critical**: Adapters inject ToolContext dependencies, enable progress notifications, and ensure consistent error handling.

**What Breaks**: Not using adapters → no DI, missing errorHandler, no progress support, inconsistent behavior.

### 3. Schema Organization

Schemas are organized by domain and strictness:

```typescript
// Input schemas (in tool files)
const CreateTransactionSchema = z
  .object({
    budget_id: z.string().optional(),
    account_id: z.string(),
    amount: z.number(),
    date: z.string(),
    // ...
  })
  .strict(); // CRITICAL: Always use .strict()

// Shared schemas (in schemas/common.ts)
export const emptyObjectSchema = z.object({}).strict();
export const looseObjectSchema = z.object({}).passthrough();

// Output schemas (in schemas/outputs/)
export const BudgetOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  // ...
});
```

**Why Critical**: `.strict()` prevents unknown fields, which is a security concern. Input validation catches errors early.

**What Breaks**: Missing `.strict()` → security vulnerability (unknown fields accepted). Missing validation → runtime errors, data corruption.

### 4. Amount Handling (CRITICAL!)

YNAB uses **milliunits** (1 dollar = 1000 milliunits). Always convert before API calls:

```typescript
import { milliunitsToAmount, amountToMilliunits } from '../utils/amountUtils.js';

// User provides dollars, convert to milliunits for API
const transaction = {
  amount: amountToMilliunits(userInputDollars), // e.g., 25.50 → 25500
  // ...
};

// API returns milliunits, convert to dollars for display
const displayAmount = milliunitsToAmount(transaction.amount); // 25500 → 25.50
```

**Why CRITICAL**: Missing conversion → amounts are 1000x wrong (e.g., $25.50 becomes $0.02550 or $25,500.00).

**What Breaks**: Direct dollar amounts to API → wrong values. Missing conversion from API → wrong display.

### 5. Progress Notifications

Long-running tools (reconciliation, bulk operations) emit progress updates:

```typescript
async function handleReconcileAccount(
  input: ReconcileInput,
  sendProgress?: ProgressCallback
): Promise<ReconcileResult> {
  await sendProgress?.({
    progress: 10,
    total: 100,
    message: 'Parsing CSV...',
  });

  // ... parsing logic ...

  await sendProgress?.({
    progress: 50,
    total: 100,
    message: 'Matching transactions...',
  });

  // ... matching logic ...

  await sendProgress?.({
    progress: 100,
    total: 100,
    message: 'Complete',
  });

  return result;
}
```

**Why Critical**: Operations >5 seconds need progress to prevent timeouts and improve UX.

**What Breaks**: Missing optional chaining (`?.`) → TypeError. Missing progress updates → poor UX, timeouts.

### 6. Cache Invalidation

Write operations must invalidate related caches:

```typescript
// After creating/updating/deleting a transaction
await updateTransaction(transactionId, updates);

// Invalidate related caches
context.cacheManager.delete(`transaction:${transactionId}`);
context.cacheManager.delete(`transactions:${budgetId}`);
context.cacheManager.delete(`account:${accountId}`); // Account balance changed
```

**Why Critical**: Stale cache → users see outdated data, inconsistent state.

**What Breaks**: Missing invalidation → stale data persists until TTL expires (2-10 minutes).

## Transaction Tools (Special Note)

Transaction tooling is split into focused modules for maintainability:

### File Breakdown

1. **transactionSchemas.ts**
   - Zod schemas for all transaction operations
   - Input: `CreateTransactionSchema`, `UpdateTransactionSchema`, etc.
   - Shared types: `TransactionInput`, `BulkTransactionInput`

2. **transactionUtils.ts**
   - Transaction utilities and helpers
   - Receipt itemization logic (smart collapse for 5+ items)
   - Big ticket preservation (items >10% of total)
   - Tax allocation across line items
   - Date validation, amount validation

3. **transactionReadTools.ts**
   - Read-only handlers (`list_transactions`, `get_transaction`, `export_transactions`)
   - Registration factory for read tools

4. **transactionWriteTools.ts**
   - Mutation handlers (`create_transaction`, `update_transaction`, `delete_transaction`, `create_transactions`, `create_receipt_split_transaction`, `update_transactions`)
   - Registration factory for write tools

5. **transactionTools.ts**
   - Facade that calls read/write registration factories
   - Backward-compatible re-exports

### Why Refactored

- **Maintainability**: Smaller, focused modules are easier to review and test
- **Separation of Concerns**: Schemas, utilities, and read/write handlers are distinct responsibilities
- **Testability**: Easier to unit test schemas and utilities separately

## Receipt Itemization (v0.18.2+)

The `create_receipt_split_transaction` tool uses smart itemization logic:

### Features

1. **Smart Collapse**: Collapses 5+ small items into "Other items" memo entry
2. **Big Ticket Preservation**: Items >10% of total are always preserved as separate splits
3. **Tax Allocation**: Distributes tax proportionally across line items
4. **Memo Format**: Each split gets memo like "Item Name ($12.34)" for traceability

### Example

```typescript
// 8-item receipt with $100 total, $10 tax
// Result: 4 big items ($15+ each) + 1 "Other items (4 items, $20.00)" + tax split
```

**Why Important**: Keeps transaction list clean while preserving important line items.

**What Breaks**: Manual memo formatting → inconsistent, hard to parse.

## Common Development Tasks

### Adding a New Tool

1. **Choose domain file** (e.g., `budgetTools.ts` for budget operations)

2. **Create Zod schema** with strict validation:
   ```typescript
   const MyToolSchema = z
     .object({
       budget_id: z.string().optional(),
       my_field: z.string(),
     })
     .strict(); // CRITICAL
   ```

3. **Implement handler function**:
   ```typescript
   async function handleMyTool(
     input: z.infer<typeof MyToolSchema>,
     context: ToolContext
   ): Promise<MyResult> {
     const budgetId = BudgetResolver.resolveBudgetId(
       input.budget_id,
       context.getDefaultBudgetId()
     );
     if (typeof budgetId !== 'string') return budgetId;

     // ... implementation ...

     return result;
   }
   ```

4. **Register in factory function**:
   ```typescript
   export function registerMyDomainTools(
     registry: ToolRegistry,
     context: ToolContext
   ): void {
     registry.register({
       name: 'my_tool',
       description: 'My tool description',
       inputSchema: MyToolSchema,
       handler: adapt(handleMyTool, context),
       metadata: {
         annotations: {
           ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
           title: 'YNAB: My Tool',
         },
       },
     });
   }
   ```

5. **Add unit tests** in `__tests__/myDomainTools.test.ts`

6. **Add integration tests** in `__tests__/myDomainTools.integration.test.ts`

### Modifying Existing Tool

1. **Read the current schema** to understand inputs
2. **Update schema** if adding/changing fields:
   ```typescript
   const UpdatedSchema = ExistingSchema.extend({
     new_field: z.string().optional(),
   });
   ```
3. **Update handler** with new logic
4. **Update tests** to cover new behavior
5. **Invalidate caches** if it's a write operation

### Adding Progress Notifications

1. **Update handler signature**:
   ```typescript
   async function handleMyTool(
     input: MyInput,
     sendProgress?: ProgressCallback
   ): Promise<MyOutput>
   ```

2. **Use `adaptWrite` adapter** (supports progress):
   ```typescript
   handler: adaptWrite(handleMyTool, context);
   ```

3. **Emit progress updates**:
   ```typescript
   await sendProgress?.({
     progress: currentStep,
     total: totalSteps,
     message: 'Processing...',
   });
   ```

### Adding Output Schema

1. **Create schema** in `schemas/outputs/`:
   ```typescript
   export const MyOutputSchema = z.object({
     id: z.string(),
     name: z.string(),
     // ...
   });
   ```

2. **Use in handler**:
   ```typescript
   const result = await fetchData();
   return MyOutputSchema.parse(result); // Validates output
   ```

## Testing Approach

### Unit Tests

- **Location**: `src/tools/__tests__/*.test.ts`
- **Mock**: YNAB API, ToolContext, all external dependencies
- **Coverage**: 80% minimum
- **Focus**: Handler logic, error handling, edge cases

### Integration Tests

- **Location**: `src/tools/__tests__/*.integration.test.ts`
- **Mock**: YNAB API (use realistic fixtures)
- **Real**: ToolContext, cacheManager, errorHandler
- **Focus**: End-to-end tool execution, cache behavior

### Example Unit Test

```typescript
describe('handleCreateTransaction', () => {
  it('should convert dollars to milliunits', async () => {
    const context = createMockContext();
    const input = {
      account_id: 'acc123',
      amount: 25.5, // Dollars
      date: '2025-01-31',
    };

    await handleCreateTransaction(input, context);

    expect(context.ynabAPI.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 25500, // Milliunits!
      })
    );
  });
});
```

## What Will Break If Violated

### 1. Missing Milliunits Conversion

**Problem**: Passing dollar amounts directly to YNAB API.

**Impact**: Amounts are 1000x wrong (e.g., $25.50 → $0.02550 or $25,500.00).

**Fix**: Always use `amountToMilliunits()` before API calls:

```typescript
// BAD
await ynabAPI.createTransaction({
  amount: 25.5, // Wrong!
});

// GOOD
await ynabAPI.createTransaction({
  amount: amountToMilliunits(25.5), // 25500 milliunits
});
```

### 2. Schema Without `.strict()`

**Problem**: Input schemas missing `.strict()` modifier.

**Impact**: Security vulnerability (unknown fields accepted), potential injection attacks.

**Fix**: Always use `.strict()` on input schemas:

```typescript
// BAD
const MySchema = z.object({
  field: z.string(),
}); // Allows unknown fields!

// GOOD
const MySchema = z
  .object({
    field: z.string(),
  })
  .strict(); // Rejects unknown fields
```

### 3. Missing Cache Invalidation

**Problem**: Write operations without cache invalidation.

**Impact**: Users see stale data for 2-10 minutes (until TTL expires).

**Fix**: Invalidate related caches after writes:

```typescript
await updateTransaction(id, updates);

// Invalidate all related caches
context.cacheManager.delete(`transaction:${id}`);
context.cacheManager.delete(`transactions:${budgetId}`);
context.cacheManager.delete(`account:${accountId}`);
```

### 4. Missing `.js` Extensions in Imports

**Problem**: Imports without `.js` extension.

**Impact**: Build failures, runtime errors (ES modules require explicit extensions).

**Fix**: Always use `.js` extensions:

```typescript
// BAD
import { adapt } from './adapters';

// GOOD
import { adapt } from './adapters.js';
```

### 5. Not Using Adapters

**Problem**: Registering handlers directly without adapters.

**Impact**: No dependency injection, missing errorHandler, no progress support, inconsistent error handling.

**Fix**: Always use adapter helpers:

```typescript
// BAD
handler: async (input) => handleMyTool(input);

// GOOD
handler: adapt(handleMyTool, context);
```

### 6. Direct YNAB API Calls

**Problem**: Bypassing ToolContext and calling YNAB API directly.

**Impact**: No caching, no rate limiting, no error handling, test failures.

**Fix**: Always use `context.ynabAPI`:

```typescript
// BAD
const api = new ynab.API(token);
const budgets = await api.budgets.getBudgets();

// GOOD
const budgets = await context.ynabAPI.budgets.getBudgets();
```

## Tool Categories & Annotations

All tools use MCP annotations from `toolCategories.ts`:

### Annotation Presets

- **READ_ONLY_EXTERNAL** - Read-only YNAB API calls (idempotent)
- **WRITE_EXTERNAL_CREATE** - Create operations (non-idempotent)
- **WRITE_EXTERNAL_UPDATE** - Update operations (idempotent)
- **WRITE_EXTERNAL_DELETE** - Delete operations (destructive, idempotent)
- **UTILITY_LOCAL** - Local operations (no external API)

### Usage

```typescript
metadata: {
  annotations: {
    ...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
    title: 'YNAB: Update Transaction',
  },
}
```

## Integration Points

### With Server (`src/server/`)

- **ToolRegistry**: All tools register via `registry.register()`
- **ToolContext**: Injected by adapters, provides ynabAPI, cacheManager, etc.
- **Error Handling**: Uses `errorHandler` from ToolContext

### With Types (`src/types/`)

- **ToolContext**: Central DI object with all shared dependencies
- **Handler Signatures**: Handler, DeltaHandler, WriteHandler, NoInputHandler
- **Reconciliation Types**: ReconcileInput, ReconcileResult, etc.

### With Utils (`src/utils/`)

- **Money Conversion**: `amountToMilliunits()`, `milliunitsToAmount()`
- **Date Utilities**: `formatISODate()`, `isValidISODate()`
- **Validation**: `isValidISODate()` plus Zod input schemas

## Performance Considerations

1. **Use Delta Requests**: For large datasets (transactions), use `adaptWithDelta`
2. **Cache Aggressively**: Read-only tools benefit from long TTLs
3. **Batch Operations**: Use bulk APIs (`create_transactions`, `update_transactions`) for multiple operations
4. **Progress Notifications**: Operations >5 seconds should emit progress
5. **Lazy Loading**: Don't fetch unnecessary related data

## Security Considerations

1. **Strict Schemas**: Always use `.strict()` on input schemas
2. **Input Validation**: Validate all inputs via Zod before processing
3. **Budget ID Validation**: Always resolve and validate budget IDs
4. **Amount Validation**: Validate amounts are reasonable (not negative for debits, etc.)
5. **No Secret Leakage**: Error responses never include API tokens or sensitive data

## Related Documentation

- [Root CLAUDE.md](../../CLAUDE.md) - Project overview and architecture
- [Server CLAUDE.md](../server/CLAUDE.md) - Server components and MCP orchestration
- [Reconciliation CLAUDE.md](reconciliation/CLAUDE.md) - Reconciliation system deep-dive
- [Schemas CLAUDE.md](schemas/CLAUDE.md) - Schema definitions and validation
- [API Documentation](../../docs/reference/API.md) - Complete API reference
