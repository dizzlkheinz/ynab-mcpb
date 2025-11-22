# Reconciliation Error Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix reconciliation integration failures by properly surfacing YNAB API errors (invalid accounts, rate limits) so tests skip or fail appropriately instead of silently returning zero creations.

**Architecture:** Add a small error-normalization layer inside the reconciliation executor to interpret YNAB SDK error payloads, propagate fatal conditions (429/invalid account) as errors, and include actionable reasons in action logs for rate-limit detection. Keep bulk/sequential creation flow intact while improving error transparency.

**Tech Stack:** TypeScript, Vitest, YNAB SDK, Node 22+

### Task 1: Normalize YNAB API errors

**Files:**
- Modify: `src/tools/reconciliation/executor.ts`
- Test: `src/tools/reconciliation/__tests__/executor.test.ts`

**Step 1: Add error normalization utilities**

```ts
// executor.ts (near helper section)
interface NormalizedYnabError { status?: number; name?: string; message: string; detail?: string }
function normalizeYnabError(err: unknown): NormalizedYnabError { /* parse err.error.id/detail/status, strings, Error */ }
function shouldPropagateYnabError(err: NormalizedYnabError): boolean { return [401, 403, 404, 429, 500].includes(err.status ?? 0); }
function attachStatus(err: NormalizedYnabError): Error { const e = new Error(err.message || err.detail || 'YNAB API error'); if (err.status) (e as any).status = err.status; if (err.name) e.name = err.name; return e; }
```

**Step 2: Use normalized errors in bulk chunk handling**

```ts
// executor.ts processBulkChunk catch
const ynabErr = normalizeYnabError(error);
if (shouldPropagateYnabError(ynabErr)) throw attachStatus(ynabErr);
const reason = ynabErr.message;
bulkOperationDetails.bulk_chunk_failures += 1;
actions_taken.push({ type: 'bulk_create_fallback', reason: `Bulk chunk #${chunkIndex} failed (${reason})...` });
```

Expected: rate-limit or invalid-account errors now bubble; other bulk failures still fall back.

### Task 2: Propagate fatal errors during sequential creation

**Files:**
- Modify: `src/tools/reconciliation/executor.ts`
- Test: `src/tools/reconciliation/__tests__/executor.integration.test.ts`

**Step 1: Update sequential catch block**

```ts
const ynabErr = normalizeYnabError(error);
const failureReason = ynabErr.message;
actions_taken.push({ type: 'create_transaction_failed', reason: ...failureReason... });
if (shouldPropagateYnabError(ynabErr)) throw attachStatus(ynabErr);
```

Include status-aware message so `containsRateLimitFailure` sees 429 text.

**Step 2: Ensure transaction failure counters reflect thrown errors**

If fatal error occurs, increment `transaction_failures` before throw to preserve metrics.

### Task 3: Cover new error handling with tests

**Files:**
- Modify: `src/tools/reconciliation/__tests__/executor.test.ts`
- Modify: `src/tools/reconciliation/__tests__/executor.integration.test.ts` (if needed for assertions/fixtures)

**Step 1: Add unit tests for non-Error YNAB payload**

```ts
it('propagates rate-limit error objects with status codes', async () => {
  mockCreateTransactions.rejects({ error: { id: '429', detail: 'Too many requests' } });
  await expect(executeReconciliation(...)).rejects.toMatchObject({ status: 429 });
});
```

**Step 2: Add unit test for invalid account error propagation**

Mock 404 payload and expect rejection; verify action reason contains detail when not thrown.

**Step 3: Adjust integration expectation if fixtures rely on new messaging**

Ensure `containsRateLimitFailure` continues to match updated reason text (no code changes anticipated).

### Task 4: Verify fixes locally

**Commands:**
- `npx vitest run --project unit --runInBand src/tools/reconciliation/__tests__/executor.test.ts`
- `npm run test:integration:core -- --testNamePattern="Reconciliation Executor - Bulk Create Integration"` (rerun the failing suite)

Expected: unit tests pass; integration suite either passes or rate-limit skips instead of failing counts.
