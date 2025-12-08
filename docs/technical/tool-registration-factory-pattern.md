# Tool Registration Factory Pattern

## Overview

This document outlines a refactoring plan to migrate tool registration from centralized inline definitions in `YNABMCPServer.ts` to domain-scoped factory functions. This pattern improves encapsulation, scalability, and maintainability.

**Status:** Implemented (Phases 1-4 complete)
**Created:** 2025-12-07
**Last Updated:** 2025-12-08
**Scope:** `src/server/YNABMCPServer.ts`, `src/tools/*.ts`, new shared types

### Revision History

| Date | Changes |
|------|---------|
| 2025-12-07 | Initial proposal + critique corrections: fixed line counts (~610 lines in setupToolRegistry, ~1235 total in YNABMCPServer.ts), added `adaptNoInput` adapter, added Phase 4 for inline schema relocation, added Risks section, added Adapter Type Summary |
| 2025-12-08 | Implemented phases 1-4: ToolContext + adapters + budget resolver, domain factory registrations for all tool domains, shared schemas moved to `src/tools/schemas/common.ts`, server-owned inline tools retained, adapter unit tests added, server file size reduced ~50% |

---

## Problem Statement

### Current State

The `setupToolRegistry()` method in `YNABMCPServer.ts` contains ~610 lines of inline tool registrations (lines 388-999):

```typescript
// Current pattern (simplified)
private setupToolRegistry(): void {
  const adapt = <T>(handler) => async ({ input }) => handler(this.ynabAPI, input);
  const adaptWithDelta = <T>(handler) => async ({ input }) =>
    handler(this.ynabAPI, this.deltaFetcher, input);
  // ... more adapters

  register({
    name: 'list_budgets',
    description: '...',
    inputSchema: emptyObjectSchema,
    handler: adaptWithDelta(handleListBudgets),
    // ...
  });

  register({
    name: 'get_budget',
    // ... 30+ more tools
  });
}
```

### Issues with Current Approach

1. **Coupling**: Server file knows implementation details of every tool
2. **File Size**: `YNABMCPServer.ts` is ~1235 lines, with 50% dedicated to registration boilerplate
3. **Scalability**: Adding a tool requires modifying the server file
4. **Cohesion**: Schemas/handlers in tool files, but registration in server
5. **Testing**: Hard to test registration logic in isolation
6. **Inline Schemas**: Several schemas (`emptyObjectSchema`, `diagnosticInfoSchema`, etc.) are defined inline in setupToolRegistry instead of with their domains

---

## Proposed Solution

### Architecture Overview

```
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

### Current status (2025-12-08)

- Factories implemented for all domains: Budget, Payees, Months, Categories, Accounts, Utility (get_user/convert_amount), Reconciliation (compare + reconcile), Transactions.
- Server-owned inline tools intentionally remain: `set_default_budget`, `get_default_budget`, `diagnostic_info`, `clear_cache`, `set_output_format`.
- Shared schemas: `emptyObjectSchema`, `LooseObjectSchema` live in `src/tools/schemas/common.ts` and are imported by factories and server-owned tools.
- ToolContext + adapter helpers live in `src/types/toolRegistration.ts` and `src/tools/adapters.ts`; adapters are unit-tested (`src/tools/__tests__/adapters.test.ts`).
- `setupToolRegistry` now delegates to register*Tools factories and only registers the five server-owned tools inline.

### Key Components (implemented)

#### 1. ToolContext Interface

```typescript
// src/types/toolRegistration.ts

import { ToolRegistry } from '../server/toolRegistry.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolExecutionPayload, DefaultArgumentResolver } from '../server/toolRegistry.js';
import * as ynab from 'ynab';
import type { DeltaFetcher } from '../tools/deltaFetcher.js';
import type { DeltaCache } from '../server/deltaCache.js';
import type { ServerKnowledgeStore } from '../server/serverKnowledgeStore.js';
import type { DiagnosticManager } from '../server/diagnostics.js';
import type { CacheManager } from '../server/cacheManager.js';

/**
 * Context object passed to tool factory functions.
 * Contains all dependencies tools might need.
 */
export interface ToolContext {
  // Core YNAB API
  ynabAPI: ynab.API;

  // Delta caching infrastructure
  deltaFetcher: DeltaFetcher;
  deltaCache: DeltaCache;
  serverKnowledgeStore: ServerKnowledgeStore;

  // Server state accessors
  getDefaultBudgetId: () => string | undefined;
  setDefaultBudget: (budgetId: string) => void;

  // Cache management
  cacheManager: CacheManager;

  // Diagnostics (optional, for utility tools)
  diagnosticManager?: DiagnosticManager;
}

/**
 * Factory function signature for tool registration.
 */
export type ToolFactory = (registry: ToolRegistry, context: ToolContext) => void;
```

#### 2. Adapter Utilities

```typescript
// src/tools/adapters.ts

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolExecutionPayload, DefaultArgumentResolver } from '../server/toolRegistry.js';
import type { ToolContext } from '../types/toolRegistration.js';
import * as ynab from 'ynab';
import { BudgetResolver } from '../server/budgetResolver.js';
import { DefaultArgumentResolutionError } from '../server/toolRegistry.js';

/**
 * Creates adapter functions bound to the provided context.
 * Reduces boilerplate in tool factory functions.
 */
export function createAdapters(context: ToolContext) {
  const { ynabAPI, deltaFetcher, deltaCache, serverKnowledgeStore } = context;

  return {
    /**
     * Adapter for read-only tools that only need the YNAB API.
     */
    adapt: <TInput extends Record<string, unknown>>(
      handler: (api: ynab.API, params: TInput) => Promise<CallToolResult>,
    ) => async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
      handler(ynabAPI, input),

    /**
     * Adapter for tools with no input parameters (e.g., get_user).
     */
    adaptNoInput: (
      handler: (api: ynab.API) => Promise<CallToolResult>,
    ) => async (_payload: ToolExecutionPayload<Record<string, unknown>>): Promise<CallToolResult> =>
      handler(ynabAPI),

    /**
     * Adapter for read-only tools that need delta fetching.
     */
    adaptWithDelta: <TInput extends Record<string, unknown>>(
      handler: (
        api: ynab.API,
        fetcher: typeof deltaFetcher,
        params: TInput,
      ) => Promise<CallToolResult>,
    ) => async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
      handler(ynabAPI, deltaFetcher, input),

    /**
     * Adapter for write tools that need delta cache and knowledge store.
     */
    adaptWrite: <TInput extends Record<string, unknown>>(
      handler: (
        api: ynab.API,
        cache: typeof deltaCache,
        store: typeof serverKnowledgeStore,
        params: TInput,
      ) => Promise<CallToolResult>,
    ) => async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
      handler(ynabAPI, deltaCache, serverKnowledgeStore, input),

    /**
     * Adapter for tools that require no input parameters (e.g. get_user).
     */
    adaptNoInput: (
      handler: (api: ynab.API) => Promise<CallToolResult>,
    ) => async (_payload: ToolExecutionPayload<Record<string, unknown>>): Promise<CallToolResult> =>
      handler(ynabAPI),
  };
}

/**
 * Creates a budget ID resolver bound to the provided context.
 */
export function createBudgetResolver(
  context: ToolContext,
): <TInput extends { budget_id?: string | undefined }>() => DefaultArgumentResolver<TInput> {
  return <TInput extends { budget_id?: string | undefined }>(): DefaultArgumentResolver<TInput> => {
    return ({ rawArguments }) => {
      const provided =
        typeof rawArguments['budget_id'] === 'string' && rawArguments['budget_id'].length > 0
          ? (rawArguments['budget_id'] as string)
          : undefined;

      const result = BudgetResolver.resolveBudgetId(provided, context.getDefaultBudgetId());

      if (typeof result === 'string') {
        return { budget_id: result } as Partial<TInput>;
      }
      throw new DefaultArgumentResolutionError(result);
    };
  };
}
```

#### 3. Tool Factory Example (Budget Tools)

```typescript
// src/tools/budgetTools.ts
// NOTE: Handlers and schemas already exist in this file.
// The factory function is added alongside existing exports.

import type { ToolRegistry } from '../server/toolRegistry.js';
import type { ToolContext, ToolFactory } from '../types/toolRegistration.js';
import { createAdapters } from './adapters.js';
import { ToolAnnotationPresets } from './toolCategories.js';
import { ListBudgetsOutputSchema, GetBudgetOutputSchema } from './schemas/outputs/index.js';
import { z } from 'zod/v4';

// Existing exports (already in file):
// - GetBudgetSchema
// - handleGetBudget
// - handleListBudgets

/** Shared empty schema for tools with no input parameters */
export const emptyObjectSchema = z.object({}).strict();

/**
 * Registers all budget-related tools with the registry.
 * Called by YNABMCPServer.setupToolRegistry().
 */
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

  registry.register({
    name: 'get_budget',
    description: 'Get detailed information for a specific budget',
    inputSchema: GetBudgetSchema,
    outputSchema: GetBudgetOutputSchema,
    handler: adapt(handleGetBudget),
    metadata: {
      annotations: {
        ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
        title: 'YNAB: Get Budget Details',
      },
    },
  });
};
```

#### 4. Refactored Server

```typescript
// src/server/YNABMCPServer.ts (relevant section)

import { registerBudgetTools } from '../tools/budgetTools.js';
import { registerAccountTools } from '../tools/accountTools.js';
import { registerTransactionTools } from '../tools/transactionTools.js';
import { registerCategoryTools } from '../tools/categoryTools.js';
import { registerPayeeTools } from '../tools/payeeTools.js';
import { registerMonthTools } from '../tools/monthTools.js';
import { registerUtilityTools } from '../tools/utilityTools.js';
import type { ToolContext } from '../types/toolRegistration.js';

private setupToolRegistry(): void {
  // Create shared context for all tool factories
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
  registerCategoryTools(this.toolRegistry, context);
  registerPayeeTools(this.toolRegistry, context);
  registerMonthTools(this.toolRegistry, context);
  registerUtilityTools(this.toolRegistry, context);

  // Server-owned tools (access server internals directly)
  this.registerServerOwnedTools();
}

private registerServerOwnedTools(): void {
  // Tools that access server state directly:
  // - set_default_budget (calls this.setDefaultBudget, this.warmCacheForBudget)
  // - get_default_budget (calls this.getDefaultBudget)
  // - clear_cache (accesses cacheManager directly)
  // - diagnostic_info (accesses multiple server internals)
  // - set_output_format (modifies responseFormatter)

  // These remain inline because they're tightly coupled to server lifecycle
  // ... existing inline registrations for these 5 tools
}
```

---

## Implementation Plan

### Phase 1: Foundation (No Breaking Changes)

**Goal:** Create new types and utilities without modifying existing code.

| Step | Task | Files |
|------|------|-------|
| 1.1 | Create `ToolContext` interface | `src/types/toolRegistration.ts` (new) |
| 1.2 | Create adapter utilities | `src/tools/adapters.ts` (new) |
| 1.3 | Create budget resolver factory | `src/tools/adapters.ts` |
| 1.4 | Add unit tests for adapters | `src/tools/__tests__/adapters.test.ts` (new) |
| 1.5 | Export new types from index | `src/types/index.ts` |

**Verification:** `npm run type-check && npm test`

### Phase 2: Migrate Budget Tools (Pilot)

**Goal:** Migrate one domain as proof-of-concept.

| Step | Task | Files |
|------|------|-------|
| 2.1 | Add `registerBudgetTools` factory | `src/tools/budgetTools.ts` |
| 2.2 | Create context in server | `src/server/YNABMCPServer.ts` |
| 2.3 | Call factory instead of inline registration | `src/server/YNABMCPServer.ts` |
| 2.4 | Remove migrated inline registrations | `src/server/YNABMCPServer.ts` |
| 2.5 | Verify tests pass | Run integration tests |

**Verification:** `npm run test:integration:budgets`

### Phase 3: Migrate Remaining Domains

**Goal:** Apply pattern to all tool domains.

| Domain | Factory Function | Tools Count |
|--------|-----------------|-------------|
| Accounts | `registerAccountTools` | 3 (list, get, create) |
| Transactions | `registerTransactionTools` | 9 (CRUD, batch, receipt split) |
| Categories | `registerCategoryTools` | 3 (list, get, update) |
| Payees | `registerPayeeTools` | 2 (list, get) |
| Months | `registerMonthTools` | 2 (list, get) |
| Reconciliation | `registerReconciliationTools` | 2 (compare, reconcile) |
| Utility | `registerUtilityTools` | 2 (get_user, convert_amount) |

**Order:** Migrate in order of increasing complexity:
1. Payees (simplest, 2 read-only tools)
2. Months (2 read-only tools)
3. Categories (2 read + 1 write)
4. Accounts (2 read + 1 write)
5. Utility (2 tools, no budget resolver)
6. Reconciliation (2 complex tools)
7. Transactions (9 tools, most complex)

### Phase 4: Inline Schema Relocation

**Goal:** Move inline schemas from `setupToolRegistry()` to appropriate domain modules.

| Schema | Current Location | Target Location |
|--------|-----------------|-----------------|
| `emptyObjectSchema` | Inline in setupToolRegistry | `src/tools/schemas/common.ts` (shared) **[done]** |
| `setDefaultBudgetSchema` | Inline in setupToolRegistry | Keep inline (server-owned tool) |
| `diagnosticInfoSchema` | Inline in setupToolRegistry | Keep inline (server-owned tool) |
| `setOutputFormatSchema` | Inline in setupToolRegistry | Keep inline (server-owned tool) |
| `LooseObjectSchema` | Inline in setupToolRegistry | `src/tools/schemas/common.ts` (shared) **[done]** |

**Note:** `emptyObjectSchema` is used by multiple tools across domains (`list_budgets`, `get_user`, `get_default_budget`, `clear_cache`). It should be exported from a shared location.

### Phase 5: Server-Owned Tools

**Goal:** Identify and document tools that remain in server.

| Tool | Reason for Server Ownership |
|------|----------------------------|
| `set_default_budget` | Calls `this.setDefaultBudget()`, `this.warmCacheForBudget()` |
| `get_default_budget` | Calls `this.getDefaultBudget()` |
| `clear_cache` | Direct cache manipulation |
| `diagnostic_info` | Accesses `diagnosticManager`, server internals |
| `set_output_format` | Modifies `responseFormatter` state |

**Options:**
- **A) Keep inline:** Accept these 5 tools stay in server (recommended)
- **B) Extract handlers:** Create handlers that accept callback functions
- **C) Expand context:** Add more methods to `ToolContext`

**Recommendation:** Option A - these tools are inherently server-scoped.

### Phase 6: Cleanup and Documentation

| Step | Task |
|------|------|
| 6.1 | Remove unused imports from `YNABMCPServer.ts` |
| 6.2 | Update `docs/guides/ARCHITECTURE.md` |
| 6.3 | Add inline documentation to new files |
| 6.4 | Update `CLAUDE.md` with new patterns |
| 6.5 | Run full test suite |

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/types/toolRegistration.ts` | `ToolContext`, `ToolFactory` types |
| `src/tools/adapters.ts` | `createAdapters`, `createBudgetResolver` |
| `src/tools/schemas/common.ts` | Shared schemas (`emptyObjectSchema`, `LooseObjectSchema`) |
| `src/tools/__tests__/adapters.test.ts` | Unit tests for adapters |

### Modified Files

| File | Changes |
|------|---------|
| `src/server/YNABMCPServer.ts` | Replace ~610 lines with ~50 lines (setup + server-owned tools) |
| `src/tools/budgetTools.ts` | Add `registerBudgetTools` |
| `src/tools/accountTools.ts` | Add `registerAccountTools` |
| `src/tools/transactionTools.ts` | Add `registerTransactionTools` |
| `src/tools/categoryTools.ts` | Add `registerCategoryTools` |
| `src/tools/payeeTools.ts` | Add `registerPayeeTools` |
| `src/tools/monthTools.ts` | Add `registerMonthTools` |
| `src/tools/utilityTools.ts` | Add `registerUtilityTools` |
| `src/tools/compareTransactions/index.ts` | Add factory or move to comparison module |
| `src/tools/reconciliation/index.ts` | Add factory or move to comparison module |
| `src/types/index.ts` | Export new types |

### Lines of Code Impact

| Location | Before | After | Delta |
|----------|--------|-------|-------|
| `YNABMCPServer.ts` | ~1235 | ~625 | -610 |
| Tool modules (total) | ~2000 | ~2400 | +400 |
| New adapter files | 0 | ~150 | +150 |
| **Net** | ~3235 | ~3175 | -60 |

The slight decrease is primarily from removing inline schema definitions. The main benefit is improved maintainability and cohesion.

---

## Testing Strategy

### Unit Tests

```typescript
// src/tools/__tests__/adapters.test.ts

describe('createAdapters', () => {
  it('adapt() passes ynabAPI to handler', async () => {
    const mockAPI = { budgets: {} } as ynab.API;
    const context = createMockContext({ ynabAPI: mockAPI });
    const { adapt } = createAdapters(context);

    const handler = vi.fn().mockResolvedValue({ content: [] });
    const adapted = adapt(handler);

    await adapted({ input: { foo: 'bar' }, context: {} as any });

    expect(handler).toHaveBeenCalledWith(mockAPI, { foo: 'bar' });
  });

  // ... more tests for adaptWithDelta, adaptWrite, createBudgetResolver
});
```

### Integration Tests

Each domain factory should be tested:

```typescript
// src/tools/__tests__/budgetTools.integration.test.ts

describe('registerBudgetTools', () => {
  it('registers all budget tools', () => {
    const registry = new ToolRegistry({ ... });
    const context = createMockContext();

    registerBudgetTools(registry, context);

    const tools = registry.listTools();
    expect(tools.map(t => t.name)).toContain('list_budgets');
    expect(tools.map(t => t.name)).toContain('get_budget');
  });
});
```

### Regression Tests

Run full test suite after each phase:

```bash
npm run test:all
```

---

## Rollback Plan

Each phase is independently reversible:

1. **Phase 1:** Delete new files, no impact on existing code
2. **Phase 2-3:** Restore inline registrations from git history
3. **Phase 4:** Revert schema relocations from git history
4. **Phase 5:** No changes needed (server tools unchanged)
5. **Phase 6:** Revert documentation changes

Git tags should be created before each phase:
- `pre-factory-pattern`
- `factory-phase-1-complete`
- `factory-phase-2-complete`
- etc.

---

## Success Criteria

1. **All tests pass:** `npm run test:all` green
2. **Type-safe:** `npm run type-check` green
3. **Lint clean:** `npm run lint` green
4. **Server file reduced:** < 650 lines (from ~1235)
5. **Tool count unchanged:** 30 tools registered
6. **No runtime regressions:** E2E tests pass

---

## Risks and Considerations

### Cache Invalidation Complexity

Transaction tools have sophisticated cache invalidation logic in `transactionTools.ts`:

```typescript
function invalidateTransactionCaches(
  deltaCache: DeltaCache,
  knowledgeStore: ServerKnowledgeStore,
  budgetId: string,
  serverKnowledge: number | undefined,
  affectedAccountIds: Set<string>,
  affectedMonths: Set<string>,
  options: TransactionCacheInvalidationOptions = {},
): void
```

**Risk:** This function needs access to `deltaCache`, `knowledgeStore`, and `cacheManager`. The factory context must provide these.

**Mitigation:** The proposed `ToolContext` already includes these dependencies. No additional changes needed.

### Delta Support Adapters

Handler functions use `resolveDeltaFetcherArgs` and `resolveDeltaWriteArgs` from `deltaSupport.ts`:

```typescript
const { deltaFetcher } = resolveDeltaFetcherArgs(ynabAPI, deltaFetcherOrParams, maybeParams);
```

**Risk:** These adapters allow handlers to accept either positional or keyword arguments.

**Mitigation:** The factory adapters already handle this by providing explicit typed parameters.

### Circular Import Prevention

Tool factories will import from `adapters.ts`, which imports from `toolRegistry.ts`.

**Risk:** Circular dependency if `toolRegistry.ts` imports from tool modules.

**Mitigation:** The registry doesn't import tool modules directly; factories push registrations to it.

---

## Open Questions

1. **Should `exportTransactions` get its own module or join transactions?**
   - Recommendation: Keep with transactions (same domain)

2. **Should `compareTransactions` and `reconcile` be a separate "reconciliation" domain?**
   - Recommendation: Yes, create `registerReconciliationTools`

3. **Should `ToolContext` use interface or class?**
   - Recommendation: Interface (simpler, more flexible for testing)

4. **Should adapters be methods on a class or standalone functions?**
   - Recommendation: Standalone factory function returning object (current proposal)

5. **Should `convert_amount` move from Utility to its own inline registration?**
   - It's a pure function with no API calls, could stay inline or move to utility factory
   - Recommendation: Move to `registerUtilityTools` for consistency

---

## Appendix: Current Tool Inventory

| Tool Name | Domain | Adapter Type | Has Resolver |
|-----------|--------|--------------|--------------|
| `list_budgets` | Budget | adaptWithDelta | No |
| `get_budget` | Budget | adapt | No |
| `set_default_budget` | Server | inline | No |
| `get_default_budget` | Server | inline | No |
| `list_accounts` | Account | adaptWithDelta | Yes |
| `get_account` | Account | adapt | Yes |
| `create_account` | Account | adaptWrite | Yes |
| `list_transactions` | Transaction | adaptWithDelta | Yes |
| `export_transactions` | Transaction | adapt | Yes |
| `compare_transactions` | Reconciliation | adapt | Yes |
| `reconcile_account` | Reconciliation | adaptWithDelta | Yes |
| `get_transaction` | Transaction | adapt | Yes |
| `create_transaction` | Transaction | adaptWrite | Yes |
| `create_transactions` | Transaction | adaptWrite | Yes |
| `update_transaction` | Transaction | adaptWrite | Yes |
| `update_transactions` | Transaction | adaptWrite | Yes |
| `delete_transaction` | Transaction | adaptWrite | Yes |
| `create_receipt_split_transaction` | Transaction | adaptWrite | Yes |
| `list_categories` | Category | adaptWithDelta | Yes |
| `get_category` | Category | adapt | Yes |
| `update_category` | Category | adaptWrite | Yes |
| `list_payees` | Payee | adaptWithDelta | Yes |
| `get_payee` | Payee | adapt | Yes |
| `get_month` | Month | adapt | Yes |
| `list_months` | Month | adaptWithDelta | Yes |
| `get_user` | Utility | adaptNoInput | No |
| `convert_amount` | Utility | inline | No |
| `clear_cache` | Server | inline | No |
| `diagnostic_info` | Server | inline | No |
| `set_output_format` | Server | inline | No |

**Total:** 30 tools
- Domain tools: 25 (to be migrated)
- Server-owned: 5 (remain inline)

### Adapter Type Summary

| Adapter | Count | Description |
|---------|-------|-------------|
| `adapt` | 8 | Read-only, YNAB API only |
| `adaptNoInput` | 1 | No input parameters (get_user) |
| `adaptWithDelta` | 9 | Read-only with delta fetching |
| `adaptWrite` | 7 | Write operations with cache invalidation |
| `inline` | 5 | Server-owned, remain in YNABMCPServer.ts |
