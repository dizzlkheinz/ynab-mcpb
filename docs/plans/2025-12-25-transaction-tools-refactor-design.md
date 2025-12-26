# TransactionTools Refactoring Design

**Date:** 2025-12-25
**Status:** Approved
**Reviewed by:** Claude (Opus 4.5), Gemini CLI

## Problem Statement

`src/tools/transactionTools.ts` is 2,995 lines - the largest file in the codebase by 3x. It mixes multiple concerns:
- Zod schemas and type definitions
- Cache invalidation utilities
- Correlation logic for bulk operations
- 7 CRUD handler functions
- Receipt split transaction logic

This makes the file difficult to navigate and maintain.

## Goals

1. Reduce `transactionTools.ts` to ~2,000 lines (30% reduction)
2. Separate concerns into logical modules
3. Maintain backward compatibility (single consumer: `YNABMCPServer.ts`)
4. Preserve existing test coverage (5,212 lines of tests)
5. Avoid circular dependencies

## Non-Goals

- Full modular directory structure (e.g., `src/tools/transactions/`)
- Extracting receipt split logic (creates circular dependency with `handleCreateTransaction`)
- Moving schemas to `src/tools/schemas/` (existing pattern keeps tool-specific schemas near tools)

## Design

### File Structure

```
src/tools/
├── transactionTools.ts       # Handlers + registration (~2,000 lines)
├── transactionSchemas.ts     # Schemas + types + interfaces (~600 lines)
└── transactionUtils.ts       # Cache utils + correlation + finalizeResponse (~200 lines)
```

### File Contents

#### `transactionSchemas.ts` (~600 lines)

All Zod schemas and their inferred types:

```typescript
// Schemas
export const ListTransactionsSchema = z.object({...});
export const GetTransactionSchema = z.object({...});
export const CreateTransactionSchema = z.object({...});
export const CreateTransactionsSchema = z.object({...});
export const CreateReceiptSplitTransactionSchema = z.object({...});
export const UpdateTransactionSchema = z.object({...});
export const UpdateTransactionsSchema = z.object({...});
export const DeleteTransactionSchema = z.object({...});
export const BulkUpdateTransactionInputSchema = z.object({...});

// Inferred types
export type ListTransactionsParams = z.infer<typeof ListTransactionsSchema>;
export type GetTransactionParams = z.infer<typeof GetTransactionSchema>;
// ... etc

// Interfaces
export interface BulkTransactionResult {...}
export interface BulkCreateResponse {...}
export interface BulkUpdateResult {...}
export interface BulkUpdateResponse {...}
export interface CorrelationPayload {...}
export interface CorrelationPayloadInput {...}
```

#### `transactionUtils.ts` (~200 lines)

Cache invalidation, correlation, and response utilities:

```typescript
// Cache invalidation
export function invalidateTransactionCaches(
  deltaCache: DeltaCache,
  knowledgeStore: ServerKnowledgeStore,
  budgetId: string,
  serverKnowledge: number | undefined,
  affectedAccountIds: Set<string>,
  affectedMonths: Set<string>,
  options: TransactionCacheInvalidationOptions = {},
): void;

// Category helpers
export function appendCategoryIds(source: CategorySource, target: Set<string>): void;
export function collectCategoryIdsFromSources(...sources: CategorySource[]): Set<string>;
export function setsEqual<T>(a: Set<T>, b: Set<T>): boolean;

// Correlation for bulk operations
export function generateCorrelationKey(transaction: {...}): string;
export function toCorrelationPayload(transaction: CorrelationPayloadInput): CorrelationPayload;
export function correlateResults(inputs: CorrelationPayloadInput[], results: BulkTransactionResult[]): Map<string, ...>;

// Response utilities
export function estimatePayloadSize(payload: BulkCreateResponse | BulkUpdateResponse): number;
export function finalizeResponse(response: BulkCreateResponse): BulkCreateResponse;
export function finalizeBulkUpdateResponse(response: BulkUpdateResponse): BulkUpdateResponse;

// Error handling
export function handleTransactionError(error: unknown, defaultMessage: string): CallToolResult;
```

#### `transactionTools.ts` (~2,000 lines)

All handler functions + tool registration:

```typescript
import {
  ListTransactionsSchema,
  CreateTransactionSchema,
  // ... all schemas
} from './transactionSchemas.js';

import {
  invalidateTransactionCaches,
  correlateResults,
  // ... all utils
} from './transactionUtils.js';

// Handler functions (keep all together to avoid circular deps)
export async function handleListTransactions(...);
export async function handleGetTransaction(...);
export async function handleCreateTransaction(...);
export async function handleCreateReceiptSplitTransaction(...);  // Calls handleCreateTransaction
export async function handleUpdateTransaction(...);
export async function handleCreateTransactions(...);
export async function handleUpdateTransactions(...);
export async function handleDeleteTransaction(...);

// Receipt split helpers (pure functions, stay here due to tight coupling)
function truncateToLength(str: string, maxLength: number): string;
function buildItemMemo(item: {...}): string;
function applySmartCollapseLogic(...): SaveSubTransaction[];
function collapseItemsByCategory(...): SaveSubTransaction[];
function truncateItemName(...): string;
function buildCollapsedMemo(...): string;
function allocateTax(...): void;

// Tool registration
export const registerTransactionTools: ToolFactory = (registry, context) => {...};
```

### Import Graph

```
transactionSchemas.ts  ←──┐
         ↓                │
transactionUtils.ts ──────┤ (imports types from schemas)
         ↓                │
transactionTools.ts ──────┘ (imports both, no cycles)
```

## Circular Dependency Avoidance

`handleCreateReceiptSplitTransaction` calls `handleCreateTransaction` at line 1665:

```typescript
const baseResult = await handleCreateTransaction(
  ynabAPI,
  deltaCache,
  knowledgeStore,
  createTransactionParams,
);
```

If receipt split were extracted to its own file, it would need to import `handleCreateTransaction`, while `transactionTools.ts` would import the receipt split handler for registration - creating a cycle.

**Solution:** Keep all handlers in `transactionTools.ts`.

## Migration Strategy

1. Create `transactionSchemas.ts` with all schemas and types
2. Create `transactionUtils.ts` with cache/correlation utilities
3. Update `transactionTools.ts` imports
4. Run tests to verify no regressions
5. Update any imports in `YNABMCPServer.ts` if needed

## Test Impact

- Existing tests import from `transactionTools.ts`
- Most tests should continue working with re-exports
- May need to update imports for tests that directly use schemas/utils
- No logic changes = no new test requirements

## Rollback Plan

If issues arise, revert the 3-file split back to single file. Git makes this trivial.

## Success Criteria

- [ ] `transactionTools.ts` reduced to ~2,000 lines
- [ ] All 5,212 lines of tests pass
- [ ] No circular dependency warnings
- [ ] Build succeeds with no type errors
- [ ] `npm run lint` passes
