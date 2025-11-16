# Cache Test Expectation Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the tool unit tests to reflect the new delta-aware caching behavior so `npm run test:unit` passes cleanly.

**Architecture:** Tests should inject deterministic delta fetcher doubles instead of relying on implicit shared instances and should use cache manager spies that execute loaders so assertions cover the real response payloads. Error assertions must validate the standardized error handler output rather than legacy messages.

**Tech Stack:** TypeScript, Vitest, Zod, YNAB SDK mock objects.

### Task 1: Refresh account tool tests

**Files:**
- Modify: `src/tools/__tests__/accountTools.test.ts`

**Step 1: Add helpers for delta fetchers and cache mocks**

```ts
interface MockDeltaResult<T> {
  data: T[];
  wasCached?: boolean;
  usedDelta?: boolean;
}

function buildDeltaFetcher<T>(field: keyof DeltaFetcher, result: MockDeltaResult<T>) {
  return { [field]: vi.fn().mockResolvedValue({ wasCached: false, usedDelta: false, ...result }) } as unknown as DeltaFetcher;
}
```

**Step 2: Remove obsolete “bypass cache in test” expectations and update list tests to pass explicit delta fetchers**

```ts
const fetcher = buildDeltaFetcher('fetchAccounts', { data: mockAccounts });
const result = await handleListAccounts(mockYnabAPI, fetcher, { budget_id: 'budget-1' });
```

`expect(parsedContent.cached).toBe(fetchResult.wasCached)` etc.

**Step 3: Update error-path tests to have the mock fetcher reject with errors that include HTTP codes so error handler assertions keep full context**

```ts
const fetcher = {
  fetchAccounts: vi.fn().mockRejectedValue(new Error('404 Not Found')),
} as unknown as DeltaFetcher;
```

**Step 4: Rework `handleGetAccount` tests to let `cacheManager.wrap` execute the provided loader and capture cache-hit metadata**

```ts
cacheManager.wrap.mockImplementation(async (_key, { loader }) => loader());
cacheManager.has.mockReturnValueOnce(false);
```

**Step 5: Run targeted account tool tests**

Run: `npx vitest run --project unit src/tools/__tests__/accountTools.test.ts`

Expected: PASS

### Task 2: Refresh budget tool tests

**Files:**
- Modify: `src/tools/__tests__/budgetTools.test.ts`

**Step 1: Import the new delta fetcher helper or add a local equivalent for budget data**

```ts
const mockFetcher = {
  fetchBudgets: vi.fn().mockResolvedValue({ data: mockBudgets, wasCached: false, usedDelta: false }),
} as unknown as DeltaFetcher;
```

**Step 2: Update success and error tests to call `handleListBudgets(mockYnabAPI, mockFetcher)` and assert on `cache_info` derived from the mock result**

**Step 3: Delete or rewrite any NODE_ENV-based cache bypass expectations; instead, assert the handler surfaces the mock delta metadata**

**Step 4: Execute the suite**

Run: `npx vitest run --project unit src/tools/__tests__/budgetTools.test.ts`

Expected: PASS

### Task 3: Refresh category tool tests

**Files:**
- Modify: `src/tools/__tests__/categoryTools.test.ts`

**Step 1: Provide a mock delta fetcher with `fetchCategories` returning grouped categories so flattening logic remains covered**

```ts
const fetcher = {
  fetchCategories: vi.fn().mockResolvedValue({ data: mockCategoryGroups, wasCached: true, usedDelta: true }),
} as unknown as DeltaFetcher;
```

**Step 2: Remove cache-bypass assertions and instead verify the formatted response mirrors the delta payload and metadata**

**Step 3: Update error tests to reject through the mock fetcher so `withToolErrorHandling` receives recognizable HTTP codes**

**Step 4: Keep the category update tests but adjust any cache assertions to match the new cache keys/behavior if necessary**

**Step 5: Execute**

Run: `npx vitest run --project unit src/tools/__tests__/categoryTools.test.ts`

Expected: PASS

### Task 4: Refresh month tool tests

**Files:**
- Modify: `src/tools/__tests__/monthTools.test.ts`

**Step 1: Stub `handleGetMonth`’s cache manager interactions similarly to the account tests so the loader executes and returns deterministic data**

**Step 2: For list tests, pass an explicit delta fetcher stub for `fetchMonths` and assert on flattened output plus cached metadata**

**Step 3: Replace cache-bypass assertions with expectations about the `cached`/`cache_info` flags**

**Step 4: Run the file-specific tests**

Run: `npx vitest run --project unit src/tools/__tests__/monthTools.test.ts`

Expected: PASS

### Task 5: Verify the full unit test suite

**Step 1: Execute all unit tests**

Run: `npm run test:unit`

Expected: PASS with zero failures.

**Step 2: Capture reporter summary for reference (if CI requires)**

Record `test-results/unit-tests.json` for verification.
