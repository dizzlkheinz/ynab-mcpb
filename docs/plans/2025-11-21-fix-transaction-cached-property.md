# Fix Missing `cached` Property in Large Transaction Responses

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix GitHub Action test failure by adding the missing `cached` property to large transaction list responses.

**Architecture:** The `handleListTransactions` function in `transactionTools.ts` has two response paths: normal (lines 815+) and large response (lines 788-812). The large response path is missing the `cached` and `cache_info` properties that the normal path includes, causing test assertion failures when transaction data exceeds 90KB.

**Tech Stack:** TypeScript, Vitest, YNAB API integration tests

---

## Background

**Current Issue:**
- GitHub Action failing: `src/tools/__tests__/accountTools.delta.integration.test.ts:94`
- Error: `expected undefined to be false // Object.is equality`
- Test code: `expect(firstPayload.cached).toBe(false);`

**Root Cause:**
File `src/tools/transactionTools.ts` has two response code paths:
1. **Large response path** (lines 788-812): When transactions > 90KB, returns preview + summary
2. **Normal path** (lines 815+): Returns full transaction list

The large response path returns an object WITHOUT the `cached` property.
The normal path returns an object WITH `cached: cacheHit` and `cache_info`.

**Test accounts with many transactions trigger the large response path, causing `cached` to be undefined.**

---

## Task 1: Add Unit Test Coverage for Large Response Path

**Files:**
- Read: `src/tools/__tests__/transactionTools.test.ts`
- Modify: `src/tools/__tests__/transactionTools.test.ts` (add test after existing tests)

**Step 1: Read the existing test file to understand patterns**

```bash
cat src/tools/__tests__/transactionTools.test.ts | head -100
```

Expected: See test structure, mocking patterns, imports

**Step 2: Write failing test for large response cached property**

Add this test to `src/tools/__tests__/transactionTools.test.ts` in the appropriate describe block:

```typescript
it('should include cached property in large response path', async () => {
  // Create large transaction list (> 90KB)
  const largeTransactionList: ynab.TransactionDetail[] = [];
  for (let i = 0; i < 5000; i++) {
    largeTransactionList.push({
      id: `transaction-${i}`,
      date: '2025-01-01',
      amount: -10000,
      memo: 'Test transaction with long memo to increase size '.repeat(10),
      cleared: 'cleared',
      approved: true,
      flag_color: null,
      account_id: 'test-account',
      payee_id: null,
      category_id: null,
      transfer_account_id: null,
      transfer_transaction_id: null,
      matched_transaction_id: null,
      import_id: null,
      import_payee_name: null,
      import_payee_name_original: null,
      debt_transaction_type: null,
      deleted: false,
      account_name: 'Test Account',
      payee_name: 'Test Payee',
      category_name: 'Test Category',
      subtransactions: [],
    } as ynab.TransactionDetail);
  }

  const mockDeltaFetcher = {
    fetchTransactionsByAccount: vi.fn().mockResolvedValue({
      data: largeTransactionList,
      wasCached: false,
      usedDelta: false,
    }),
  } as unknown as DeltaFetcher;

  const result = await handleListTransactions(mockYnabAPI, mockDeltaFetcher, {
    budget_id: 'test-budget',
    account_id: 'test-account',
  });

  const content = result.content?.[0];
  expect(content).toBeDefined();
  expect(content?.type).toBe('text');

  const parsedResponse = JSON.parse(content!.text);

  // Should have cached property even in large response path
  expect(parsedResponse.cached).toBeDefined();
  expect(parsedResponse.cached).toBe(false);
  expect(parsedResponse.cache_info).toBeDefined();
});
```

**Step 3: Run the test to verify it fails**

```bash
npm run test:unit -- src/tools/__tests__/transactionTools.test.ts -t "should include cached property in large response path"
```

Expected: FAIL with error about `cached` being undefined

**Step 4: Commit the failing test**

```bash
git add src/tools/__tests__/transactionTools.test.ts
git commit -m "test: add failing test for cached property in large transaction responses"
```

---

## Task 2: Fix Large Response Path to Include Cached Property

**Files:**
- Modify: `src/tools/transactionTools.ts:788-812`

**Step 1: Read the current large response code**

```bash
cat src/tools/transactionTools.ts | sed -n '788,812p'
```

Expected: See the current implementation missing `cached` and `cache_info`

**Step 2: Add cached properties to large response**

In `src/tools/transactionTools.ts`, replace lines 788-812 with:

```typescript
      if (estimatedSize > sizeLimit) {
        // Return summary and suggest export
        const preview = transactions.slice(0, 50);
        return {
          content: [
            {
              type: 'text',
              text: responseFormatter.format({
                message: `Found ${transactions.length} transactions (${Math.round(estimatedSize / 1024)}KB). Too large to display all.`,
                suggestion: "Use 'export_transactions' tool to save all transactions to a file.",
                showing: `First ${preview.length} transactions:`,
                total_count: transactions.length,
                estimated_size_kb: Math.round(estimatedSize / 1024),
                cached: cacheHit,
                cache_info: cacheHit
                  ? `Data retrieved from cache for improved performance${usedDelta ? ' (delta merge applied)' : ''}`
                  : 'Fresh data retrieved from YNAB API',
                preview_transactions: preview.map((transaction) => ({
                  id: transaction.id,
                  date: transaction.date,
                  amount: milliunitsToAmount(transaction.amount),
                  memo: transaction.memo,
                  payee_name: transaction.payee_name,
                  category_name: transaction.category_name,
                })),
              }),
            },
          ],
        };
      }
```

**Changes:**
- Added `cached: cacheHit,` after `estimated_size_kb`
- Added `cache_info` with same pattern as normal response path

**Step 3: Run unit tests to verify fix**

```bash
npm run test:unit -- src/tools/__tests__/transactionTools.test.ts -t "should include cached property in large response path"
```

Expected: PASS

**Step 4: Run all transaction tool tests**

```bash
npm run test:unit -- src/tools/__tests__/transactionTools.test.ts
```

Expected: All tests PASS

**Step 5: Commit the fix**

```bash
git add src/tools/transactionTools.ts
git commit -m "fix: add cached property to large transaction response path

- Large responses (>90KB) now include cached and cache_info properties
- Maintains consistency with normal response path
- Fixes test failure in delta integration tests"
```

---

## Task 3: Verify Integration Test Now Passes

**Files:**
- Test: `src/tools/__tests__/accountTools.delta.integration.test.ts`

**Step 1: Run the failing integration test locally**

```bash
npm run test:integration -- src/tools/__tests__/accountTools.delta.integration.test.ts -t "reports delta usage for list_transactions after a change"
```

Expected: PASS (requires YNAB_ACCESS_TOKEN environment variable)

Note: If you don't have a YNAB token or want to skip, this is acceptable - the GitHub Action will verify.

**Step 2: Run type checking**

```bash
npm run type-check
```

Expected: No TypeScript errors

**Step 3: Run all unit tests to ensure no regressions**

```bash
npm run test:unit
```

Expected: All tests PASS

**Step 4: Commit verification checkpoint**

```bash
git add -A
git commit -m "test: verify integration test passes with cached property fix"
```

---

## Task 4: Update CHANGELOG and Documentation

**Files:**
- Modify: `CHANGELOG.md` (add entry at top of Unreleased section)

**Step 1: Add CHANGELOG entry**

Add this entry to the `## [Unreleased]` section in `CHANGELOG.md`:

```markdown
### Fixed
- Fixed missing `cached` property in large transaction list responses (>90KB)
  - Large response path now includes `cached` and `cache_info` properties
  - Maintains consistency with normal response path
  - Resolves integration test failures when accounts have many transactions
```

**Step 2: Commit documentation**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG entry for cached property fix"
```

---

## Task 5: Push and Verify GitHub Action

**Files:**
- Remote: GitHub Actions CI

**Step 1: Push all commits to remote**

```bash
git push origin HEAD
```

Expected: Push successful

**Step 2: Monitor GitHub Action**

```bash
gh run watch
```

Expected:
- Job `unit-tests` should PASS
- Job `integration-core` should PASS (was previously failing at accountTools.delta.integration.test.ts)

**Step 3: Verify specific test that was failing**

Check GitHub Action logs for:
```
✓ src/tools/__tests__/accountTools.delta.integration.test.ts > Delta-backed account tool handlers > reports delta usage for list_transactions after a change
```

Expected: Green checkmark, no assertion errors

**Step 4: Create completion summary**

Document verification results:
```markdown
## Verification Complete

- ✅ Unit tests passing locally
- ✅ Integration tests passing locally (if run)
- ✅ Type checking passing
- ✅ GitHub Actions CI passing
- ✅ Specific failing test now passes

The `cached` property is now consistently included in all transaction list responses.
```

---

## Testing Strategy

**Unit Tests:**
- New test verifies large response path includes `cached` property
- Existing tests verify normal response path unchanged

**Integration Tests:**
- `accountTools.delta.integration.test.ts` verifies delta fetcher integration
- Test creates real transaction, expects `cached: false` on first call
- Was failing because large accounts returned `cached: undefined`

**Manual Verification:**
- GitHub Action will run full integration suite with real YNAB API
- Throttled test runner prevents rate limit issues
- Sequential execution ensures reliable results

---

## Rate Limiting Context (For Reference)

**Note:** The GitHub Action failure was NOT a rate limiting issue. The codebase already has excellent rate limiting:

**Existing Rate Limit Infrastructure:**
- `scripts/run-throttled-integration-tests.js` - Sequential test execution with request tracking
- Client-side throttling (200 req/hour with 20 req buffer)
- Request history pruning (60-minute sliding window)
- Intelligent wait logic with min/max bounds
- Per-test estimated API call counts

**No changes needed to rate limiting.** The issue was purely a missing property in the response object.

---

## Success Criteria

- ✅ Unit test passes for large response cached property
- ✅ Integration test `accountTools.delta.integration.test.ts:94` passes
- ✅ GitHub Action CI pipeline passes completely
- ✅ No TypeScript errors
- ✅ CHANGELOG updated
- ✅ All commits follow conventional commit format
