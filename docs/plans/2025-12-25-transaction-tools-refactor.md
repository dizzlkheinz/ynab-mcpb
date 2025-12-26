# TransactionTools Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the 2,995-line `transactionTools.ts` into 3 focused files for better maintainability.

**Status:** ✅ Completed (2025-12-25)

**Architecture:** Extract Zod schemas/types to `transactionSchemas.ts`, cache/correlation utilities to `transactionUtils.ts`, keep all handlers in `transactionTools.ts`. No circular dependencies since handlers stay together.

**Outcome:**
- transactionTools.ts: 2,274 lines (24% reduction from original 2,995 lines)
- transactionSchemas.ts: 453 lines
- transactionUtils.ts: 536 lines
- Total: 3,263 lines (9% overhead from imports/exports)

**Tech Stack:** TypeScript, Zod v4, YNAB API types, Vitest

---

## Task 1: Create transactionSchemas.ts

**Files:**
- Create: `src/tools/transactionSchemas.ts`

**Step 1: Create the schemas file with all Zod schemas and types**

```typescript
// src/tools/transactionSchemas.ts
import { z } from 'zod/v4';

// =============================================================================
// LIST TRANSACTIONS
// =============================================================================

export const ListTransactionsSchema = z
  .object({
    budget_id: z.string().optional(),
    account_id: z.string().optional(),
    since_date: z.string().optional(),
    type: z.enum(['uncategorized', 'unapproved']).optional(),
    last_knowledge_of_server: z.number().optional(),
  })
  .strict();

export type ListTransactionsParams = z.infer<typeof ListTransactionsSchema>;

// =============================================================================
// GET TRANSACTION
// =============================================================================

export const GetTransactionSchema = z
  .object({
    budget_id: z.string().optional(),
    transaction_id: z.string(),
  })
  .strict();

export type GetTransactionParams = z.infer<typeof GetTransactionSchema>;

// =============================================================================
// CREATE TRANSACTION
// =============================================================================

export const CreateTransactionSchema = z
  .object({
    budget_id: z.string().optional(),
    account_id: z.string(),
    amount: z.number(),
    date: z.string().optional(),
    payee_id: z.string().optional(),
    payee_name: z.string().optional(),
    category_id: z.string().optional(),
    memo: z.string().optional(),
    cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
    approved: z.boolean().optional(),
    flag_color: z
      .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'none'])
      .optional()
      .nullable(),
    flag_name: z.string().optional().nullable(),
    import_id: z.string().optional(),
    subtransactions: z
      .array(
        z.object({
          amount: z.number(),
          payee_id: z.string().optional(),
          payee_name: z.string().optional(),
          category_id: z.string().optional(),
          memo: z.string().optional(),
        }),
      )
      .optional(),
  })
  .strict();

export type CreateTransactionParams = z.infer<typeof CreateTransactionSchema>;

// =============================================================================
// CREATE TRANSACTIONS (BULK)
// =============================================================================

type BulkTransactionInput = Omit<
  z.infer<typeof CreateTransactionSchema>,
  'budget_id' | 'subtransactions'
>;

export const CreateTransactionsSchema = z
  .object({
    budget_id: z.string().optional(),
    transactions: z.array(CreateTransactionSchema.omit({ budget_id: true, subtransactions: true })),
  })
  .strict();

export type CreateTransactionsParams = z.infer<typeof CreateTransactionsSchema>;

export interface BulkTransactionResult {
  transaction_id: string;
  date: string;
  amount: number;
  payee_name: string | null | undefined;
  category_name: string | null | undefined;
  memo: string | null | undefined;
}

export interface BulkCreateResponse {
  action: 'create_transactions';
  created_count: number;
  duplicate_count: number;
  transactions: BulkTransactionResult[];
  duplicates: BulkTransactionResult[];
  correlation?: {
    matched: number;
    unmatched: number;
    details: Array<{
      input_index: number;
      status: 'created' | 'duplicate' | 'unmatched';
      transaction?: BulkTransactionResult;
    }>;
  };
  warnings?: string[];
}

// =============================================================================
// CREATE RECEIPT SPLIT TRANSACTION
// =============================================================================

export const CreateReceiptSplitTransactionSchema = z
  .object({
    budget_id: z.string().optional(),
    account_id: z.string(),
    payee_name: z.string(),
    date: z.string().optional(),
    memo: z.string().optional(),
    cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
    approved: z.boolean().optional(),
    flag_color: z
      .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'none'])
      .optional()
      .nullable(),
    receipt_subtotal: z.number().optional(),
    receipt_tax: z.number(),
    receipt_total: z.number(),
    categories: z.array(
      z.object({
        category_id: z.string(),
        category_name: z.string().optional(),
        items: z.array(
          z.object({
            name: z.string(),
            amount: z.number(),
            quantity: z.number().optional(),
            memo: z.string().optional(),
          }),
        ),
      }),
    ),
    dry_run: z.boolean().optional(),
  })
  .strict();

export type CreateReceiptSplitTransactionParams = z.infer<
  typeof CreateReceiptSplitTransactionSchema
>;

// =============================================================================
// UPDATE TRANSACTION
// =============================================================================

export const UpdateTransactionSchema = z
  .object({
    budget_id: z.string().optional(),
    transaction_id: z.string(),
    account_id: z.string().optional(),
    amount: z.number().optional(),
    date: z.string().optional(),
    payee_id: z.string().optional().nullable(),
    payee_name: z.string().optional().nullable(),
    category_id: z.string().optional().nullable(),
    memo: z.string().optional().nullable(),
    cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
    approved: z.boolean().optional(),
    flag_color: z
      .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'none'])
      .optional()
      .nullable(),
    flag_name: z.string().optional().nullable(),
  })
  .strict();

export type UpdateTransactionParams = z.infer<typeof UpdateTransactionSchema>;

// =============================================================================
// UPDATE TRANSACTIONS (BULK)
// =============================================================================

export const BulkUpdateTransactionInputSchema = z.object({
  transaction_id: z.string(),
  account_id: z.string().optional(),
  amount: z.number().optional(),
  date: z.string().optional(),
  payee_id: z.string().optional().nullable(),
  payee_name: z.string().optional().nullable(),
  category_id: z.string().optional().nullable(),
  memo: z.string().optional().nullable(),
  cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional(),
  approved: z.boolean().optional(),
  flag_color: z
    .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'none'])
    .optional()
    .nullable(),
  flag_name: z.string().optional().nullable(),
});

export type BulkUpdateTransactionInput = z.infer<typeof BulkUpdateTransactionInputSchema>;

export const UpdateTransactionsSchema = z
  .object({
    budget_id: z.string().optional(),
    transactions: z.array(BulkUpdateTransactionInputSchema),
  })
  .strict();

export type UpdateTransactionsParams = z.infer<typeof UpdateTransactionsSchema>;

export interface BulkUpdateResult {
  transaction_id: string;
  date: string;
  amount: number;
  payee_name: string | null | undefined;
  category_name: string | null | undefined;
  memo: string | null | undefined;
  updated_fields: string[];
}

export interface BulkUpdateResponse {
  action: 'update_transactions';
  updated_count: number;
  not_found_count: number;
  transactions: BulkUpdateResult[];
  not_found: string[];
  correlation?: {
    matched: number;
    unmatched: number;
    details: Array<{
      input_index: number;
      transaction_id: string;
      status: 'updated' | 'not_found' | 'unmatched';
      transaction?: BulkUpdateResult;
    }>;
  };
  warnings?: string[];
}

// =============================================================================
// DELETE TRANSACTION
// =============================================================================

export const DeleteTransactionSchema = z
  .object({
    budget_id: z.string().optional(),
    transaction_id: z.string(),
  })
  .strict();

export type DeleteTransactionParams = z.infer<typeof DeleteTransactionSchema>;

// =============================================================================
// CORRELATION TYPES
// =============================================================================

export type CorrelationPayload = {
  date: string;
  amount: number;
  payee_name?: string | null;
  memo?: string | null;
  account_id: string;
};

export interface CorrelationPayloadInput {
  date?: string;
  amount: number;
  payee_name?: string | null;
  memo?: string | null;
  account_id: string;
}

// =============================================================================
// INTERNAL INTERFACES (used by handlers)
// =============================================================================

export interface CategorySource {
  category_id?: string | null;
  subtransactions?: { category_id?: string | null }[] | null | undefined;
}

export interface TransactionCacheInvalidationOptions {
  affectedCategoryIds?: Set<string>;
  invalidateAllCategories?: boolean;
  accountTotalsChanged?: boolean;
  invalidateMonths?: boolean;
}

export interface ReceiptCategoryCalculation {
  category_id: string;
  category_name?: string;
  subtotal_milliunits: number;
  tax_milliunits: number;
  items: Array<{
    name: string;
    amount_milliunits: number;
    quantity?: number;
    memo?: string;
  }>;
}

export interface SubtransactionInput {
  amount: number;
  category_id?: string;
  memo?: string;
  payee_id?: string;
  payee_name?: string;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run type-check`
Expected: No errors related to transactionSchemas.ts

✅ **Completed**

**Step 3: Commit**

```bash
git add src/tools/transactionSchemas.ts
git commit -m "refactor: extract transaction schemas to dedicated file"
```

✅ **Completed** (Commit: f24e28c)

---

## Task 2: Create transactionUtils.ts

**Files:**
- Create: `src/tools/transactionUtils.ts`

**Step 1: Create the utils file with cache and correlation functions**

```typescript
// src/tools/transactionUtils.ts
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import type { DeltaCache } from '../server/deltaCache.js';
import type { ServerKnowledgeStore } from '../server/serverKnowledgeStore.js';
import { cacheManager, CACHE_TTLS, CacheManager } from '../server/cacheManager.js';
import { responseFormatter } from '../server/responseFormatter.js';
import type {
  CategorySource,
  TransactionCacheInvalidationOptions,
  CorrelationPayload,
  CorrelationPayloadInput,
  BulkTransactionResult,
  BulkCreateResponse,
  BulkUpdateResponse,
} from './transactionSchemas.js';

// =============================================================================
// TRANSACTION HELPERS
// =============================================================================

/**
 * Utility function to ensure transaction is not null/undefined
 */
export function ensureTransaction<T>(transaction: T | undefined, errorMessage: string): T {
  if (!transaction) {
    throw new Error(errorMessage);
  }
  return transaction;
}

// =============================================================================
// CATEGORY HELPERS
// =============================================================================

export function appendCategoryIds(source: CategorySource | undefined, target: Set<string>): void {
  if (!source) {
    return;
  }
  if (source.category_id) {
    target.add(source.category_id);
  }
  if (Array.isArray(source.subtransactions)) {
    for (const sub of source.subtransactions) {
      if (sub?.category_id) {
        target.add(sub.category_id);
      }
    }
  }
}

export function collectCategoryIdsFromSources(
  ...sources: (CategorySource | undefined)[]
): Set<string> {
  const result = new Set<string>();
  for (const source of sources) {
    appendCategoryIds(source, result);
  }
  return result;
}

export function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

// =============================================================================
// CACHE INVALIDATION
// =============================================================================

const toMonthKey = (date: string): string => `${date.slice(0, 7)}-01`;

export function invalidateTransactionCaches(
  deltaCache: DeltaCache,
  knowledgeStore: ServerKnowledgeStore,
  budgetId: string,
  serverKnowledge: number | undefined,
  affectedAccountIds: Set<string>,
  affectedMonths: Set<string>,
  options: TransactionCacheInvalidationOptions = {},
): void {
  deltaCache.invalidate(budgetId, 'transactions');
  cacheManager.delete(CacheManager.generateKey('transactions', 'list', budgetId));

  for (const accountId of affectedAccountIds) {
    const accountPrefix = CacheManager.generateKey('transactions', 'account', budgetId, accountId);
    cacheManager.deleteByPrefix(accountPrefix);
  }

  const invalidateAccountsList = options.accountTotalsChanged ?? true;
  if (invalidateAccountsList) {
    deltaCache.invalidate(budgetId, 'accounts');
    cacheManager.delete(CacheManager.generateKey('accounts', 'list', budgetId));
    for (const accountId of affectedAccountIds) {
      cacheManager.delete(CacheManager.generateKey('accounts', 'get', budgetId, accountId));
    }
  }

  const shouldInvalidateMonths = options.invalidateMonths ?? true;
  if (shouldInvalidateMonths) {
    cacheManager.delete(CacheManager.generateKey('months', 'list', budgetId));
    for (const month of affectedMonths) {
      cacheManager.delete(CacheManager.generateKey('months', 'get', budgetId, month));
    }
  }

  const categoryIds = options.affectedCategoryIds ?? new Set<string>();
  const invalidateAllCategories = options.invalidateAllCategories ?? false;

  if (invalidateAllCategories) {
    deltaCache.invalidate(budgetId, 'categories');
    cacheManager.delete(CacheManager.generateKey('categories', 'list', budgetId));
    cacheManager.deleteByPrefix(CacheManager.generateKey('categories', 'get', budgetId));
  } else if (categoryIds.size > 0) {
    for (const categoryId of categoryIds) {
      cacheManager.delete(CacheManager.generateKey('categories', 'get', budgetId, categoryId));
    }
    cacheManager.delete(CacheManager.generateKey('categories', 'list', budgetId));
    deltaCache.invalidate(budgetId, 'categories');
  }

  if (serverKnowledge !== undefined) {
    knowledgeStore.set(`transactions:${budgetId}`, serverKnowledge);
  }
}

// =============================================================================
// CORRELATION UTILITIES
// =============================================================================

export function generateCorrelationKey(transaction: CorrelationPayload): string {
  const normalized = {
    date: transaction.date,
    amount: transaction.amount,
    payee: (transaction.payee_name ?? '').toLowerCase().trim(),
    memo: (transaction.memo ?? '').toLowerCase().trim(),
    account: transaction.account_id,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 16);
}

export function toCorrelationPayload(transaction: CorrelationPayloadInput): CorrelationPayload {
  return {
    date: transaction.date ?? new Date().toISOString().slice(0, 10),
    amount: transaction.amount,
    payee_name: transaction.payee_name,
    memo: transaction.memo,
    account_id: transaction.account_id,
  };
}

export function correlateResults(
  inputs: CorrelationPayloadInput[],
  results: BulkTransactionResult[],
  duplicates: BulkTransactionResult[] = [],
): Map<
  string,
  { input_index: number; status: 'created' | 'duplicate' | 'unmatched'; transaction?: BulkTransactionResult }
> {
  const correlation = new Map<
    string,
    { input_index: number; status: 'created' | 'duplicate' | 'unmatched'; transaction?: BulkTransactionResult }
  >();

  const resultsByKey = new Map<string, BulkTransactionResult>();
  for (const result of results) {
    const key = generateCorrelationKey({
      date: result.date,
      amount: result.amount,
      payee_name: result.payee_name,
      memo: result.memo,
      account_id: '', // Results don't have account_id, match without it
    });
    resultsByKey.set(key, result);
  }

  const duplicatesByKey = new Map<string, BulkTransactionResult>();
  for (const dup of duplicates) {
    const key = generateCorrelationKey({
      date: dup.date,
      amount: dup.amount,
      payee_name: dup.payee_name,
      memo: dup.memo,
      account_id: '',
    });
    duplicatesByKey.set(key, dup);
  }

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (!input) continue;

    const inputKey = generateCorrelationKey(toCorrelationPayload(input));

    const createdMatch = resultsByKey.get(inputKey);
    if (createdMatch) {
      correlation.set(inputKey, { input_index: i, status: 'created', transaction: createdMatch });
      continue;
    }

    const duplicateMatch = duplicatesByKey.get(inputKey);
    if (duplicateMatch) {
      correlation.set(inputKey, { input_index: i, status: 'duplicate', transaction: duplicateMatch });
      continue;
    }

    correlation.set(inputKey, { input_index: i, status: 'unmatched' });
  }

  return correlation;
}

// =============================================================================
// RESPONSE UTILITIES
// =============================================================================

export function estimatePayloadSize(payload: BulkCreateResponse | BulkUpdateResponse): number {
  return JSON.stringify(payload).length;
}

export function finalizeResponse(response: BulkCreateResponse): BulkCreateResponse {
  const MAX_RESPONSE_SIZE = 100_000;
  const estimated = estimatePayloadSize(response);

  if (estimated <= MAX_RESPONSE_SIZE) {
    return response;
  }

  const truncated = { ...response };
  truncated.warnings = truncated.warnings ?? [];
  truncated.warnings.push(
    `Response truncated: ${response.transactions.length} transactions, ${response.duplicates.length} duplicates`,
  );

  const transactionLimit = Math.min(50, response.transactions.length);
  const duplicateLimit = Math.min(20, response.duplicates.length);

  truncated.transactions = response.transactions.slice(0, transactionLimit);
  truncated.duplicates = response.duplicates.slice(0, duplicateLimit);

  if (truncated.correlation) {
    const detailLimit = Math.min(50, truncated.correlation.details.length);
    truncated.correlation = {
      ...truncated.correlation,
      details: truncated.correlation.details.slice(0, detailLimit),
    };
  }

  return truncated;
}

export function finalizeBulkUpdateResponse(response: BulkUpdateResponse): BulkUpdateResponse {
  const MAX_RESPONSE_SIZE = 100_000;
  const estimated = estimatePayloadSize(response);

  if (estimated <= MAX_RESPONSE_SIZE) {
    return response;
  }

  const truncated = { ...response };
  truncated.warnings = truncated.warnings ?? [];
  truncated.warnings.push(
    `Response truncated: ${response.transactions.length} transactions, ${response.not_found.length} not found`,
  );

  const transactionLimit = Math.min(50, response.transactions.length);
  const notFoundLimit = Math.min(20, response.not_found.length);

  truncated.transactions = response.transactions.slice(0, transactionLimit);
  truncated.not_found = response.not_found.slice(0, notFoundLimit);

  if (truncated.correlation) {
    const detailLimit = Math.min(50, truncated.correlation.details.length);
    truncated.correlation = {
      ...truncated.correlation,
      details: truncated.correlation.details.slice(0, detailLimit),
    };
  }

  return truncated;
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

export function handleTransactionError(error: unknown, defaultMessage: string): CallToolResult {
  const message = error instanceof Error ? error.message : defaultMessage;
  return {
    content: [
      {
        type: 'text',
        text: responseFormatter.format({
          error: true,
          message,
        }),
      },
    ],
    isError: true,
  };
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run type-check`
Expected: No errors

✅ **Completed**

**Step 3: Commit**

```bash
git add src/tools/transactionUtils.ts
git commit -m "refactor: extract transaction utilities to dedicated file"
```

✅ **Completed** (Commit: bbc0d76)

---

## Task 3: Update transactionTools.ts imports

**Files:**
- Modify: `src/tools/transactionTools.ts`

**Step 1: Replace inline schemas/types with imports from transactionSchemas.ts**

At the top of `transactionTools.ts`, replace the schema definitions (lines 143-722) with imports:

```typescript
// Add these imports after line 20 (after the existing imports)
import {
  ListTransactionsSchema,
  ListTransactionsParams,
  GetTransactionSchema,
  GetTransactionParams,
  CreateTransactionSchema,
  CreateTransactionParams,
  CreateTransactionsSchema,
  CreateTransactionsParams,
  CreateReceiptSplitTransactionSchema,
  CreateReceiptSplitTransactionParams,
  UpdateTransactionSchema,
  UpdateTransactionParams,
  UpdateTransactionsSchema,
  UpdateTransactionsParams,
  BulkUpdateTransactionInputSchema,
  BulkUpdateTransactionInput,
  DeleteTransactionSchema,
  DeleteTransactionParams,
  BulkTransactionResult,
  BulkCreateResponse,
  BulkUpdateResult,
  BulkUpdateResponse,
  CorrelationPayload,
  CorrelationPayloadInput,
  CategorySource,
  TransactionCacheInvalidationOptions,
  ReceiptCategoryCalculation,
  SubtransactionInput,
} from './transactionSchemas.js';

import {
  ensureTransaction,
  appendCategoryIds,
  collectCategoryIdsFromSources,
  setsEqual,
  invalidateTransactionCaches,
  generateCorrelationKey,
  toCorrelationPayload,
  correlateResults,
  estimatePayloadSize,
  finalizeResponse,
  finalizeBulkUpdateResponse,
  handleTransactionError,
} from './transactionUtils.js';
```

**Step 2: Remove the inline definitions**

Delete the following sections from `transactionTools.ts`:
- Lines 25-140: Utility functions (`ensureTransaction`, `appendCategoryIds`, `collectCategoryIdsFromSources`, `setsEqual`, `invalidateTransactionCaches`)
- Lines 143-722: All schema and type definitions
- Lines 284-477: Correlation functions (`generateCorrelationKey`, `toCorrelationPayload`, `correlateResults`, `estimatePayloadSize`, `finalizeResponse`)
- Line 2337: `finalizeBulkUpdateResponse` function
- Line 2830: `handleTransactionError` function

Keep:
- All handler functions (`handleListTransactions`, `handleGetTransaction`, etc.)
- Receipt split helper functions (`truncateToLength`, `buildItemMemo`, `applySmartCollapseLogic`, etc.)
- `registerTransactionTools` factory

**Step 3: Re-export schemas for backward compatibility**

At the bottom of `transactionTools.ts`, add re-exports:

```typescript
// Re-export schemas and types for backward compatibility
export {
  ListTransactionsSchema,
  ListTransactionsParams,
  GetTransactionSchema,
  GetTransactionParams,
  CreateTransactionSchema,
  CreateTransactionParams,
  CreateTransactionsSchema,
  CreateTransactionsParams,
  CreateReceiptSplitTransactionSchema,
  CreateReceiptSplitTransactionParams,
  UpdateTransactionSchema,
  UpdateTransactionParams,
  UpdateTransactionsSchema,
  UpdateTransactionsParams,
  DeleteTransactionSchema,
  DeleteTransactionParams,
  BulkTransactionResult,
  BulkCreateResponse,
  BulkUpdateResult,
  BulkUpdateResponse,
} from './transactionSchemas.js';

export {
  generateCorrelationKey,
  toCorrelationPayload,
  correlateResults,
} from './transactionUtils.js';
```

**Step 4: Verify TypeScript compiles**

Run: `npm run type-check`
Expected: No errors

**Step 5: Commit**

```bash
git add src/tools/transactionTools.ts
git commit -m "refactor: update transactionTools to use extracted modules"
```

✅ **Completed** (Commit: 6788c84)

---

## Task 4: Run full test suite

**Files:**
- Test: `src/tools/__tests__/transactionTools.test.ts`
- Test: `src/tools/__tests__/transactionTools.integration.test.ts`

**Step 1: Run unit tests**

Run: `npm run test:unit`
Expected: All tests pass

**Step 2: Run integration tests**

Run: `npm run test:integration:transactions`
Expected: All tests pass

**Step 3: Run full test suite**

Run: `npm test`
Expected: All 5,212+ lines of transaction tests pass

**Step 4: Commit test verification**

No changes needed if tests pass. If any test imports need updating:

```bash
git add -A
git commit -m "test: update imports for refactored transaction modules"
```

---

## Task 5: Verify build and lint

**Step 1: Run linter**

Run: `npm run lint`
Expected: No errors

**Step 2: Run full build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Verify line counts**

Run: `wc -l src/tools/transactionTools.ts src/tools/transactionSchemas.ts src/tools/transactionUtils.ts`

Expected output (approximate):
```
  ~2000 src/tools/transactionTools.ts
  ~600 src/tools/transactionSchemas.ts
  ~200 src/tools/transactionUtils.ts
  ~2800 total
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "refactor: complete transactionTools modularization

Split 2,995-line transactionTools.ts into 3 focused files:
- transactionSchemas.ts (~600 lines) - Zod schemas and types
- transactionUtils.ts (~200 lines) - Cache/correlation utilities
- transactionTools.ts (~2,000 lines) - Handlers + registration

30% reduction in main file size. All tests passing."
```

---

## Success Criteria

- [x] `transactionTools.ts` reduced from 2,995 to ~2,000 lines - **Actual: 2,274 lines (24% reduction)**
- [x] `transactionSchemas.ts` contains all schemas (~600 lines) - **Actual: 453 lines**
- [x] `transactionUtils.ts` contains utilities (~200 lines) - **Actual: 536 lines**
- [x] All unit tests pass
- [x] All integration tests pass
- [x] `npm run build` succeeds
- [x] `npm run lint` passes
- [x] No circular dependency warnings
