# Bulk Transaction Operations - Implementation Plan

## Overview

Add support for bulk transaction operations to improve efficiency when creating or updating multiple transactions. The YNAB SDK provides `createTransactions()` and `updateTransactions()` methods that we currently don't expose.

## Motivation

### Current Limitations
- Users must create/update transactions one at a time
- Reconciliation executor makes N API calls for N missing transactions
- Importing bank statements requires sequential API calls
- Higher risk of rate limiting with many individual requests
- Poor performance for batch operations

### Benefits of Bulk Operations
- **API Efficiency**: Single API call for multiple transactions
- **Rate Limiting**: Fewer requests = lower rate limit consumption
- **Performance**: Faster batch operations (10 transactions: 7s sequential → <2s bulk)
- **Batch Efficiency with Duplicate-Safe Partial Reporting**: YNAB SDK handles duplicates gracefully via import_id, skipping duplicates while creating valid transactions
- **Better UX**: Simpler workflow for bulk imports

## New Tools

### 1. `create_transactions` (Bulk Create)

#### Input Schema
```typescript
{
  budget_id: string;
  transactions: Array<{
    account_id: string;              // Required
    date: string;                    // Required, ISO format YYYY-MM-DD
    amount: number;                  // Required, milliunits (integer), e.g., -25500 for -$25.50
    payee_name?: string;             // Optional, if both provided, payee_id takes precedence
    payee_id?: string;               // Optional, preferred over payee_name if both provided
    category_id?: string;            // Optional
    memo?: string;                   // Optional
    cleared?: 'cleared' | 'uncleared' | 'reconciled';  // Optional, defaults to 'uncleared'
    approved?: boolean;              // Optional, defaults to false
    flag_color?: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';  // Optional
    import_id?: string;              // Optional but HIGHLY RECOMMENDED for duplicate detection
  }>;
  dry_run?: boolean;
}
```

**Design Decisions (Finalized):**
- **Transaction Schema**: Uses YNAB SaveTransaction format, matching single `create_transaction` for consistency
- **Batch Size Limit**: Min 1, max 100 transactions per request (YNAB SDK supports up to 200, but 100 is safer to avoid timeout and response size issues; large imports should be chunked)
- **Validation**: Each transaction validated via shared Zod schema (reuse existing `CreateTransactionSchema` base) before API call; fail-fast if any transaction fails validation
- **Payee Precedence**: If both `payee_id` and `payee_name` provided, `payee_id` takes precedence (matches YNAB API behavior)
- **Import ID**: **OPTIONAL but HIGHLY RECOMMENDED**; YNAB uses import_id for duplicate detection and result correlation. Transactions without import_id will use a deterministic hash fallback (see "Correlation Strategy" below) to guarantee correlation, but will not benefit from YNAB's built-in duplicate detection.
- **Subtransactions**: NOT supported in v1 (deferred to future enhancement); reject requests containing subtransactions with clear error
- **Transfer Transactions**: Allowed but will auto-create matching transfer in destination account (document this behavior clearly)

#### Response Format

**YNAB SDK Response Structure (for reference):**
```typescript
// Source: node_modules/ynab/dist/models/SaveTransactionsResponseData.d.ts
interface SaveTransactionsResponseData {
  transaction_ids: Array<string>;                // Only successfully created IDs
  transaction?: TransactionDetail;               // Single transaction (optional)
  transactions?: Array<TransactionDetail>;       // Multiple transactions (optional)
  duplicate_import_ids?: Array<string>;          // Import IDs that were duplicates
  server_knowledge: number;
}
// NOTE: No 'bulk' array - correlation relies on import_id matching
```

**MCP Response Transformation:**
The MCP response adapts the YNAB SDK response for clarity and size management:

**Success Response (all transactions created):**
```json
{
  "success": true,
  "server_knowledge": 12345,
  "summary": {
    "total_requested": 5,
    "created": 5,
    "duplicates": 0
  },
  "results": [
    {
      "request_index": 0,
      "status": "created",
      "transaction_id": "trans-id-1",
      "correlation_key": "import-123"
    },
    {
      "request_index": 1,
      "status": "created",
      "transaction_id": "trans-id-2",
      "correlation_key": "import-456"
    }
    // ... more results
  ],
  "transactions": [
    // Full TransactionDetail objects from YNAB SDK (all fields)
    // Only included if total response size < 64KB
    // See YNAB API docs for complete TransactionDetail schema
  ]
}
```

**Partial Success Response (duplicates skipped):**
```json
{
  "success": true,
  "server_knowledge": 12345,
  "summary": {
    "total_requested": 5,
    "created": 4,
    "duplicates": 1
  },
  "results": [
    {
      "request_index": 0,
      "status": "created",
      "transaction_id": "trans-id-1",
      "correlation_key": "import-456"
    },
    {
      "request_index": 1,
      "status": "duplicate",
      "correlation_key": "import-123"
    }
    // ... more results
  ],
  "transactions": [
    // Full TransactionDetail objects for the 4 created transactions
    // (omitted if response size > 64KB)
  ],
  "duplicate_import_ids": ["import-123"],
  "message": "1 transaction skipped due to duplicate import_id"
}
```

**Dry Run Response:**
```json
{
  "dry_run": true,
  "action": "create_transactions",
  "validation": "passed",
  "summary": {
    "total_transactions": 5,
    "total_amount": -125500,
    "accounts_affected": ["account-1", "account-2"],
    "date_range": {
      "earliest": "2025-01-10",
      "latest": "2025-01-13"
    }
  },
  "transactions_preview": [
    // First 10 transactions with key details (milliunits)
  ],
  "note": "Dry run complete. No transactions created. No caches invalidated. No server_knowledge updated."
}
```

**Error Handling:**
- Validation errors: Fail-fast before API call, return which transaction(s) failed validation
- API errors: Return YNAB API error with context about batch operation
- Rate limiting: Standard rate limit error handling

### 2. `update_transactions` (Bulk Update)

#### Input Schema
```typescript
{
  budget_id: string;
  transactions: Array<{
    id: string;             // Required for updates
    date?: string;          // Optional, ISO format YYYY-MM-DD
    amount?: number;        // Optional, milliunits (integer), e.g., -25500 for -$25.50
    payee_name?: string;    // Optional, payee_id takes precedence if both provided
    payee_id?: string;      // Optional, preferred over payee_name
    category_id?: string;   // Optional
    memo?: string;          // Optional
    cleared?: 'cleared' | 'uncleared' | 'reconciled';  // Optional
    approved?: boolean;     // Optional
    flag_color?: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';  // Optional
    original_account_id?: string; // Optional metadata used for cache invalidation/dry-run previews
    original_date?: string;       // Optional metadata (YYYY-MM-DD) describing the persisted date
  }>;
  dry_run?: boolean;
}
```

**Design Decisions (Finalized):**
- **Transaction ID**: Required for each update; YNAB will return 404 if ID doesn't exist
- **Partial Updates**: All fields except `id` are optional; only provided fields will be updated
- **Account ID**: NOT updatable (YNAB API does not support moving transactions between accounts via update; schema intentionally omits this field)
- **Batch Size Limit**: Min 1, max 100 transactions per batch (same rationale as create_transactions)
- **Validation**: Fail-fast before API call using Zod schema validation
- **Payee Precedence**: Same as create_transactions - payee_id preferred over payee_name
- **Amount Format**: Always milliunits (integer); handler must not accept or convert decimals
- **Metadata Requirements**: Clients SHOULD include `original_account_id` and `original_date` gathered from list/get responses. The handler falls back to cache lookups (and, only if necessary, limited API fetches) when metadata is missing so cache invalidation and dry-run previews never require N additional network requests by default.

#### Response Format

**Success Response (all transactions updated):**
```json
{
  "success": true,
  "server_knowledge": 12345,
  "summary": {
    "total_requested": 5,
    "updated": 5
  },
  "results": [
    {
      "request_index": 0,
      "status": "updated",
      "transaction_id": "trans-id-1",
      "correlation_key": "trans-id-1"
    }
    // ... more results
  ],
  "transactions": [
    // Updated transaction objects (if response <64KB)
  ]
}
```

**Dry Run Response:**
```json
{
  "dry_run": true,
  "action": "update_transactions",
  "validation": "passed",
  "summary": {
    "total_transactions": 5,
    "accounts_affected": ["account-1", "account-2"],
    "fields_to_update": ["category_id", "memo", "cleared"]
  },
  "transactions_preview": [
    // Preview of first 10 updates (before/after comparison)
    // Requires fetching existing transactions to show before state
    {
      "transaction_id": "trans-1",
      "before": { "category_id": "old-cat", "memo": "Old memo" },
      "after": { "category_id": "new-cat", "memo": "New memo" }
    }
  ],
  "note": "Dry run complete. No transactions updated. No caches invalidated."
}
```

**Dry Run Pipeline:**
1. Validate all updates (same schema as live runs).
2. Build the metadata map using `original_*` fields → cache lookup → limited API fetch (same order as real execution).
3. Use metadata to populate the `before` snapshot. Dry runs are intentionally lenient: if metadata is missing, include `{ "before": "unavailable" }`, increment a `missing_metadata_count`, and add a warning entry such as `"warnings": [{ "code": "metadata_unavailable", "count": missing_metadata_count, "message": "Unable to fetch prior state for N transactions" }]` in the preview.
4. Limit `transactions_preview` to 10 entries to cap payload size; include diffed fields only, not the full transaction payload.
5. Skip cache invalidation/server_knowledge updates entirely.

## Implementation Details

### File Structure
```
src/tools/
  transactionTools.ts              # Add new schemas and handlers here
  __tests__/
    transactionTools.test.ts       # Add unit tests
    transactionTools.integration.test.ts  # Add integration tests
```

### Validation Strategy

1. **Schema Validation** (Zod)
   - Validate entire request structure
   - Validate each transaction in array
   - Check array length constraints (1-100)
   - Custom refinements for business rules

2. **Pre-flight Checks**
   - Check for duplicate import_ids within batch
   - Validate date formats
   - **Note:** Account ID validation is intentionally omitted; YNAB API validates and returns clear errors, avoiding unnecessary API calls and cache staleness risks

3. **Error Reporting**
   ```typescript
   {
     "error": {
       "message": "Validation failed for 2 transactions",
       "validation_errors": [
         {
           "index": 0,
           "field": "amount",
           "message": "Amount must be an integer in milliunits"
         },
         {
           "index": 3,
           "field": "date",
           "message": "Date must be in ISO format (YYYY-MM-DD)"
         }
       ]
     }
   }
   ```

### Cache Invalidation Strategy

Bulk operations affect many cache keys. Use a targeted strategy to avoid over-invalidation.

**IMPORTANT**: Update operations rely on either caller-provided `original_*` metadata, cached transaction data, or (only when unavoidable) targeted fetches to determine affected accounts/months. This keeps cache invalidation accurate without turning every update batch into N additional network calls.

**For Create Operations:**
```typescript
// After successful bulk create:
// 1. Collect unique affected keys directly from request
const affectedAccountIds = new Set<string>();
const affectedMonths = new Set<string>();

requestTransactions.forEach(tx => {
  affectedAccountIds.add(tx.account_id);
  affectedMonths.add(tx.date.slice(0, 7) + '-01'); // Extract YYYY-MM-01
});
```

**For Update Operations:**
```typescript
// 1. Seed metadata map with client-provided context
const metadataById = new Map<string, { account_id: string; date: string }>();
const failedMetadataById = new Map<string, string>(); // id -> sanitized error detail

updateRequest.transactions.forEach(tx => {
  if (tx.original_account_id && tx.original_date) {
    metadataById.set(tx.id, {
      account_id: tx.original_account_id,
      date: tx.original_date,
    });
  }
});

// 2. Hydrate missing entries from cache (no network requests)
const missingIds = updateRequest.transactions
  .filter(tx => !metadataById.has(tx.id))
  .map(tx => tx.id);

const cachedMetadata = await cacheManager.getMany(
  missingIds.map(id => CacheManager.generateKey('transaction', 'get', budget_id, id))
);

cachedMetadata.forEach((maybeTx, index) => {
  if (!maybeTx) return;
  const id = missingIds[index];
  metadataById.set(id, {
    account_id: maybeTx.account_id,
    date: maybeTx.date,
  });
});

// 3. Only fetch from YNAB for the handful of IDs still missing
const stillMissing = missingIds.filter(id => !metadataById.has(id));
const {
  success: fetchedMetadata,
  failed: failedMetadata,
} = await fetchTransactionsMetadataBatch({
  budgetId,
  transactionIds: stillMissing,
  concurrency: 5,
  timeoutMs: 10_000,
  retries: 2,
  retryDelayMs: 100,
});

fetchedMetadata.forEach(tx => {
  metadataById.set(tx.id, {
    account_id: tx.account_id,
    date: tx.date,
  });
});

failedMetadata.forEach(({ id, error }) => {
  failedMetadataById.set(id, error); // used for warnings + strict threshold checks
});

// fetchTransactionsMetadataBatch contract:
// - Applies per-request timeouts & bounded retries with jitter to avoid pileups
// - Never rejects the whole batch; instead, surfaces partial failures in `failed`
// - 404s land in `failed` so we can flag specific transactions later

type FetchTransactionsMetadataBatchOptions = {
  budgetId: string;
  transactionIds: string[];
  concurrency: number;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
};

type FetchTransactionsMetadataBatchResult = {
  success: Array<{ id: string; account_id: string; date: string }>;
  failed: Array<{ id: string; error: string }>;
};

const unresolvedIds = stillMissing.filter(id => !metadataById.has(id));

// 4. After successful update, derive invalidation targets from the API response
const affectedAccountIds = new Set<string>();
const affectedMonths = new Set<string>();

const updatedTransactions = response.data.transactions ?? [];
updatedTransactions.forEach(tx => {
  affectedAccountIds.add(tx.account_id);
  affectedMonths.add(tx.date.slice(0, 7) + '-01');
  metadataById.set(tx.id, {
    account_id: tx.account_id,
    date: tx.date,
  });
});

updateRequest.transactions.forEach(tx => {
  if (!metadataById.has(tx.id)) {
    // Last-resort safe invalidation when metadata unavailable even after response merge
    fallbackInvalidationTargets.add('transactions:list');
  }

  if (tx.date) {
    affectedMonths.add(tx.date.slice(0, 7) + '-01');
  }
});

const transactionIds = new Set(updatedTransactions.map(tx => tx.id));
```

**Failure Handling (Live Runs Only):**
- After cache + batch fetch, compute `missingMetadataCount = unresolvedIds.length + failedMetadataById.size`. If `!dry_run` and `missingMetadataCount / totalTransactions > 0.05`, short-circuit with `VALIDATION_ERROR` instructing the caller to supply `original_account_id`/`original_date` (prevents silent cache desync).
- When a single metadata fetch returns 404, mark just that transaction as failed in the results array and continue processing the rest (consistent with partial-success behavior).
- `cacheManager.getMany` remains a thin convenience wrapper (parallelized `get` + map) so metadata lookups stay O(1) per batch without spamming the cache backend.

**Common Cache Invalidation (both create and update):**
```typescript

// 2. Build targeted cache key list
// NOTE: Avoid invalidating high-level caches (accounts:list, months:list, categories:list)
// unless the operation actually creates/deletes accounts/months/categories
const keysToDelete = [
  CacheManager.generateKey('transactions', 'list', budget_id),
  // Only invalidate affected account caches (not accounts:list)
  ...Array.from(affectedAccountIds).map(id =>
    CacheManager.generateKey('account', 'get', budget_id, id)
  ),
  // Only invalidate affected month caches (not months:list)
  ...Array.from(affectedMonths).map(month =>
    CacheManager.generateKey('month', 'get', budget_id, month)
  ),
  // Invalidate specific transaction caches for updates
  ...Array.from(transactionIds).map(id =>
    CacheManager.generateKey('transaction', 'get', budget_id, id)
  ),
];

// 3. Batch delete
cacheManager.deleteMany(keysToDelete);
```

**Rationale for Narrow Invalidation:**
- Creating/updating transactions does NOT change the set of accounts, months, or categories
- Invalidating `accounts:list`, `months:list`, `categories:list` defeats caching and increases load on follow-up requests
- Only invalidate affected account balances and month summaries (which DO change)

> **Phase 1 Requirement:** `cacheManager.deleteMany(keys: string[])` must exist so bulk operations can clear caches in O(1) calls even when 100+ entries are affected.

### Response Size Management

**Problem:** Creating 100 transactions could return ~100KB+ of data, exceeding MCP message limits (typically 100KB).

**Solution: Automatic Size-Based Downgrade with Correlation**

```typescript
// Correlation Strategy:
// 1. Primary: Match by import_id (if provided)
// 2. Fallback: Match by deterministic hash of transaction fields (multi-bucket)
// 3. Never drop request_index so clients can still align results deterministically
const results: BulkTransactionResult[] = [];

function generateCorrelationKey(tx: SaveTransaction | TransactionDetail): string {
  if (tx.import_id) return tx.import_id;

  const normalized = [
    tx.account_id,
    tx.date,
    tx.amount,
    'payee:' + (tx.payee_id || tx.payee_name || ''),
    'category:' + (tx.category_id || ''),
    'memo:' + (tx.memo || ''),
    'cleared:' + (tx.cleared || 'uncleared'),
    'approved:' + String(typeof tx.approved === 'boolean' ? tx.approved : ''),
    'flag:' + (tx.flag_color || ''),
  ].join('|');

  return `hash:${sha256(normalized).substring(0, 16)}`;
}

const duplicateSet = new Set(response.data.duplicate_import_ids || []);

const createdByImportId = new Map<string, string[]>();
const createdByHash = new Map<string, string[]>();

response.data.transactions?.forEach(tx => {
  const key = generateCorrelationKey(tx);
  const targetMap = tx.import_id ? createdByImportId : createdByHash;
  const bucket = targetMap.get(key) || [];
  bucket.push(tx.id);
  targetMap.set(key, bucket);
});

const popId = (map: Map<string, string[]>, key: string | undefined) => {
  if (!key) return undefined;
  const bucket = map.get(key);
  if (!bucket?.length) return undefined;
  const id = bucket.shift();
  if (!bucket.length) {
    map.delete(key);
  }
  return id;
};

params.transactions.forEach((req, index) => {
  const correlationKey = generateCorrelationKey(req);

  if (req.import_id && duplicateSet.has(req.import_id)) {
    results.push({
      request_index: index,
      status: 'duplicate',
      correlation_key: correlationKey,
    });
    return;
  }

  const transactionId = req.import_id
    ? popId(createdByImportId, correlationKey)
    : popId(createdByHash, correlationKey);

  if (transactionId) {
    results.push({
      request_index: index,
      status: 'created',
      transaction_id: transactionId,
      correlation_key: correlationKey,
    });
    return;
  }

  globalRequestLogger?.logError(
    'ynab:create_transactions',
    'correlate_transactions',
    {
      request_index: index,
      correlation_key: correlationKey,
      request: {
        account_id: req.account_id,
        amount: req.amount,
        date: req.date,
        import_id: req.import_id,
      },
    },
    'correlation_failed',
  );

  results.push({
    request_index: index,
    status: 'failed',
    correlation_key: correlationKey,
    error_code: 'correlation_failed',
    error: 'Unable to reconcile YNAB response with this request',
  });
});

const fullResponse = buildFullResponse(createdTransactions, results);
return finalizeResponse(fullResponse);
```

**TypeScript Interfaces:**
```typescript
interface BulkTransactionResult {
  request_index: number;
  status: 'created' | 'duplicate' | 'failed' | 'updated';
  transaction_id?: string;  // Only for 'created' or 'updated'
  correlation_key: string;  // import_id or hash of transaction fields
  error?: string;           // Only for 'failed'
}

interface BulkCreateResponse {
  success: boolean;
  server_knowledge: number;
  summary: {
    total_requested: number;
    created: number;
    duplicates: number;
    failed?: number;
  };
  results: BulkTransactionResult[];  // Always present for correlation
  transactions?: TransactionDetail[];  // Raw YNAB SDK TransactionDetail[] objects
                                        // Only included if response <64KB
                                        // Contains ALL fields from YNAB API
  duplicate_import_ids?: string[];
  message?: string;
}
```

**Thresholds (measured via UTF-8 byte length):**
- **Full Response**: <64KB - Return complete transaction objects with all fields + results array
- **Summary Mode**: 64KB–96KB - Return results array + summary statistics + guidance message (transactions field omitted)
- **IDs-Only Mode**: 96KB–100KB - Keep summary + `results` stripped down to `{request_index,status,transaction_id,correlation_key}`
- **Hard Limit**: 100KB - Absolute MCP message limit; tool throws an explicit `RESPONSE_TOO_LARGE` error instructing the caller to reduce batch size if even the IDs-only payload would exceed this boundary (extremely unlikely with 100-item limit)

```typescript
const FULL_THRESHOLD = 64 * 1024;
const SUMMARY_THRESHOLD = 96 * 1024;
const MAX_RESPONSE_BYTES = 100 * 1024;

const estimateSize = (payload: object) =>
  Buffer.byteLength(JSON.stringify(payload), 'utf8');

function finalizeResponse(fullPayload: BulkResponsePayload) {
  if (estimateSize(fullPayload) <= FULL_THRESHOLD) return fullPayload;

  const summaryPayload = omit(fullPayload, ['transactions']);
  if (estimateSize(summaryPayload) <= SUMMARY_THRESHOLD) {
    summaryPayload.message = 'Response downgraded to summary mode due to size.';
    return summaryPayload;
  }

  const idsOnlyPayload = {
    ...summaryPayload,
    results: summaryPayload.results.map(({ request_index, status, transaction_id, correlation_key }) => ({
      request_index,
      status,
      transaction_id,
      correlation_key,
    })),
    message: 'Response downgraded to ids_only mode due to size. Use list_transactions for full details.',
  } satisfies BulkResponsePayload;

  if (estimateSize(idsOnlyPayload) > MAX_RESPONSE_BYTES) {
    throw ErrorHandler.createErrorResponse('RESPONSE_TOO_LARGE',
      'Even the ids_only payload would exceed MCP limits. Reduce the batch size and retry.');
  }

  return idsOnlyPayload;
}
```

**Summary Mode Format with Correlation:**
```json
{
  "success": true,
  "server_knowledge": 12345,
  "summary": { "created": 75, "duplicates": 0 },
  "results": [
    {
      "request_index": 0,
      "status": "created",
      "transaction_id": "trans-id-1",
      "correlation_key": "import-123"
    },
    {
      "request_index": 1,
      "status": "duplicate",
      "correlation_key": "import-456"
    }
    // ... 75 total entries, ~12KB total
  ],
  "duplicate_import_ids": ["import-456"],
  "message": "Response downgraded to summary mode (estimated 87KB). Use list_transactions to retrieve full details."
}
```

If the summary payload still exceeds 96KB, the handler trims each `result` entry down to `{request_index,status,transaction_id,correlation_key}` and updates `message` to indicate `ids_only` mode before returning.

**Correlation Benefits:**
- Clients can map results back to original request using `request_index`
- `correlation_key` enables matching by `import_id` or transaction fields
- Enables retry logic for failed transactions
- Supports duplicate/error handling without full transaction objects
- Multi-bucket lookups ensure that repeated transactions with identical payloads (e.g., multiple grocery runs on the same day) still correlate one-to-one rather than clobbering each other's status

### Dry Run Implementation

```typescript
if (params.dry_run) {
  // Validate all transactions
  const validationResults = validateAllTransactions(params.transactions);

  if (validationResults.errors.length > 0) {
    return validationErrorResponse(validationResults.errors);
  }

  // Calculate summary statistics
  const summary = {
    total_transactions: params.transactions.length,
    total_amount: sumAmounts(params.transactions),
    accounts_affected: uniqueAccounts(params.transactions),
    date_range: calculateDateRange(params.transactions),
    categories_affected: uniqueCategories(params.transactions),
  };

  return {
    dry_run: true,
    action: 'create_transactions',
    summary,
    transactions_preview: params.transactions.slice(0, 10),
  };
}
```

## Integration with Existing Code

### Reconciliation Executor Enhancement

**Current Implementation (src/tools/reconciliation/executor.ts:142):**
```typescript
// Sequential creation - one API call per transaction
for (const action of actions) {
  if (action.type === 'create') {
    const response = await ynabAPI.transactions.createTransaction(budgetId, {
      transaction: action.transaction
    });
    results.push({ type: 'create', transaction_id: response.data.transaction.id });
  }
}
```

**Proposed Enhancement:**
```typescript
const createActions = actions.filter(a => a.type === 'create');
const MAX_CHUNK = 100;

for (const chunk of chunkArray(createActions, MAX_CHUNK)) {
  if (chunk.length === 1) {
    // Preserve existing sequential behavior for singletons
    const response = await ynabAPI.transactions.createTransaction(budgetId, {
      transaction: chunk[0].transaction,
    });
    results.push({ type: 'create', transaction_id: response.data.transaction.id });
    continue;
  }

  try {
    const response = await handleCreateTransactions({
      budget_id: budgetId,
      transactions: chunk.map(action => action.transaction),
      response_mode: 'summary',
    });

    response.results.forEach(res => {
      results.push({
        type: 'create',
        transaction_id: res.transaction_id,
        request_index: res.request_index,
        status: res.status,
        correlation_key: res.correlation_key,
      });
    });

    // Surface duplicates/partial failures directly in reconciliation output
    response.results
      .filter(res => res.status !== 'created')
      .forEach(res => warnings.push(res));
  } catch (error: any) {
    const status = error?.statusCode ?? error?.response?.status;

    if (status === 429) {
      // Rate limit: honor retry-after header and retry the bulk chunk
      await backoffWait(error?.retryAfter ?? DEFAULT_RETRY_AFTER_MS);
      retryChunk(chunk);
      continue;
    }

    if (status === 422) {
      // Validation errors will not succeed sequentially either; surface immediately
      throw error;
    }

    if (status >= 500 || !status) {
      console.warn('Bulk create chunk failed with server/network error, falling back sequentially:', error);
      for (const action of chunk) {
        const response = await ynabAPI.transactions.createTransaction(budgetId, {
          transaction: action.transaction,
        });
        results.push({ type: 'create', transaction_id: response.data.transaction.id });
      }
      continue;
    }

    // Auth/not-found/permission errors should bubble up so the caller can resolve them
    throw error;
  }
}
```

`handleCreateTransactions` is the same internal helper that powers the MCP tool, so reconciliation automatically inherits validation, response-size downgrades, duplicate detection, and correlation behavior. That keeps the executor thin while guaranteeing parity between manual bulk operations and reconciliation-driven batches.

- `backoffWait` respects the Retry-After header (if present) and otherwise applies capped exponential backoff with jitter so retries do not stampede the API.
- `retryChunk` requeues the same chunk with an incremented attempt counter and stops retrying after N attempts (default 3) to avoid infinite loops.

**Benefits:**
- Reconciliation 3-5x faster for accounts with 10+ missing transactions
- Fewer API calls = better rate limit handling
- Fallback ensures robustness

**Risks & Mitigation:**
- **Risk**: Bulk failure loses partial progress
- **Mitigation**: Automatic fallback to sequential mode per chunk + chunk size ≤100 guarded by shared helper
- **Risk**: Bulk mode hides duplicate/failed transactions from reconciliation output
  - **Mitigation**: Surface `results` array entries (including duplicates/errors) directly in reconciliation response and instructions so the user can resolve them without re-running the entire executor
- **Risk**: Different error messages confuse users
  - **Mitigation**: Log fallback events, maintain consistent result format

**Decision:** Implement in Phase 3 as optional enhancement (default enabled with automatic fallback)

## Testing Strategy

### Unit Tests

1. **Schema Validation Tests**
   - Valid bulk request with multiple transactions
   - Invalid transaction in batch (should fail validation)
   - Empty transactions array (should fail)
   - Too many transactions (>100, should fail)
   - Missing required fields
   - Invalid field types

2. **Dry Run Tests**
   - Dry run returns summary without creating
   - Dry run validates all transactions
   - Dry run calculates correct statistics

3. **Response Formatting Tests**
   - Success response format
   - Partial success response format
   - Error response format with validation errors
   - Correlation fallback when `import_id` is omitted (ensures multi-bucket hashing works)
   - Response size downgrade path exercises (full → summary → ids_only)

### Integration Tests

1. **Bulk Create Tests**
   - Create 1 transaction successfully
   - Create 5 transactions successfully
   - Create 50 transactions successfully
   - Create 100 transactions (verify automatic downgrade to summary mode when response >64KB)
   - Create transactions across multiple accounts
   - Create with duplicate import_ids (should skip duplicates)
   - Create 10 transactions without import_id but identical amounts/dates to prove correlation buckets do not collide
   - Force ids_only response by stubbing 120KB transaction payload and ensure `results` still aligns
   - Verify cache invalidation

2. **Bulk Update Tests**
   - Update 3 transactions successfully
   - Update with invalid transaction ID (should fail)
   - Update transactions in different accounts
   - Update batch where only half the items supply `original_*` metadata (ensures cache + limited fetch path works)
   - Force summary mode + ids_only mode for update responses
   - Verify cache invalidation and fallback invalidation when metadata missing

3. **Error Handling Tests**
   - YNAB API returns error for batch
   - Network timeout during bulk operation
   - Rate limiting during bulk operation

4. **Reconciliation Integration Tests**
   - Reconciliation uses bulk create when appropriate
   - Chunking respects 100-transaction limit (e.g., 250 pending actions → 3 chunks)
   - Duplicate statuses surfaced to the caller
   - Fallback to sequential mode on bulk failure

### E2E Tests (with real YNAB API)

1. Create 10 real transactions in test budget
2. Create 80 real transactions to test summary mode (with cleanup)
3. Update 5 real transactions in test budget
4. Verify transactions appear in YNAB web app
5. Verify account balances updated correctly

## Implementation Phases

### Phase 1: Core Functionality (`create_transactions`)
**Estimated Effort:** 4-6 hours  
**Status:** Completed (2025-11-13)
**Completion Date:** 2025-11-13
**Notes:** Implementation followed the original plan with deterministic hash fallbacks for correlation and no deviations beyond omitting unsupported subtransactions.

**Implementation Tasks:**
- [x] Add `CreateTransactionsSchema` to transactionTools.ts (reuse CreateTransactionSchema base)
- [x] Implement `handleCreateTransactions()` handler with SDK integration
- [x] Add response size detection with automatic summary/ids_only downgrades
- [x] Implement efficient cache invalidation (collect unique account/month keys, batch delete)
- [x] Register tool in YNABMCPServer.ts with budget_id auto-resolution
- [x] Add unit tests for create_transactions (validation, dry-run, error handling, cache invalidation)
- [x] Add integration tests (real YNAB API, multi-size batches, duplicates, dry-run)
- [x] Update docs/API.md with tool documentation

**Definition of Done (Exit Criteria):**
- [x] Tool accepts 1-100 transactions, rejects 0 or >100
- [x] Dry-run validates without creating, reports statistics, avoids cache/server knowledge impact
- [x] Happy path creates all valid transactions, returns `results` array with correlation keys
- [x] Duplicate import_id handling works (skips duplicates, reports status='duplicate')
- [x] Response size >64KB automatically downgrades to summary; >96KB downgrades to ids_only
- [x] `results` array always present with `request_index`, `status`, `transaction_id`, `correlation_key`
- [x] Cache invalidation targets only affected accounts/months (no blanket list clears)
- [x] All unit tests covering new logic pass (≥80% coverage on affected modules)
- [x] Integration tests validate multiple batch sizes, duplicates, dry-run, cache invalidation, and response mode transitions
- [x] Real API exercised through Vitest integration suite (creates batches and cleans up)
- [x] API documentation refreshed with milliunit examples and correlation guidance

**Performance Baseline (post-implementation):**
- Sequential create 10 transactions: ~7 seconds (reference)
- Bulk create 10 transactions: <2 seconds observed locally
### Phase 2: Bulk Update (`update_transactions`)
**Estimated Effort:** 4-5 hours (includes fetch-before-update logic for cache invalidation)
**Status:** Completed (2025-11-13)
**Completion Date:** 2025-11-13

**Implementation Tasks:**
- [x] Add `UpdateTransactionsSchema` to transactionTools.ts (require id, all else optional)
- [x] Implement `handleUpdateTransactions()` handler with SDK integration
- [x] Add three-tier metadata resolution: client-provided original_* → cache lookup → limited API fetch
- [x] Accept `original_account_id` / `original_date` metadata fields (optional but recommended for efficiency)
- [x] Reuse response size detection from Phase 1 (full → summary → ids_only downgrades)
- [x] Implement update-specific cache invalidation using resolved metadata
- [x] Register tool in YNABMCPServer.ts with budget_id auto-resolution
- [x] Add comprehensive unit tests (schema validation, partial updates, metadata resolution, dry-run, cache invalidation)
- [x] Validated implementation with existing integration test infrastructure

**Definition of Done (Exit Criteria):**
- [x] Tool accepts 1-100 transactions with required `id` field, rejects missing id
- [x] Partial updates work (only provided fields updated)
- [x] Dry-run validates without updating, reports statistics and transaction preview
- [x] Happy path updates all transactions, returns `results` array with per-transaction status
- [x] Response size >64KB automatically downgrades to summary mode (omits `transactions` field, keeps `results` array)
- [x] `results` array always present with `request_index`, `status='updated'`, `transaction_id` for all transactions
- [x] Three-tier metadata resolution implemented: original_* metadata → cache → limited API fetch with 5-concurrent limit
- [x] Cache invalidation targets affected accounts and months using resolved metadata
- [x] All unit tests pass covering schema, handler logic, metadata resolution paths, and error handling
- [x] UpdateTransactionsSchema validation tests cover batch limits, required id, optional fields, date formats, and metadata fields
- [x] handleUpdateTransactions tests cover dry-run, partial updates, metadata resolution (all three tiers), error handling, cache invalidation, and response size management

**Notes:**
- Metadata resolution uses a three-tier approach to avoid N additional API calls:
  1. First checks client-provided `original_account_id` and `original_date`
  2. Falls back to cache lookup for missing metadata
  3. Finally makes limited concurrent API fetches (max 5 concurrent) only for unresolved cases
- Gracefully handles metadata resolution failures without crashing the update operation
- Cache invalidation uses `deleteMany` when available, falls back to individual deletes
- Response size management reuses existing `finalizeBulkUpdateResponse` helper
- Unit tests validate all metadata resolution paths and cache invalidation scenarios

**Performance Baseline:**
- Sequential update 10 transactions: ~7 seconds (reference)
- Bulk update 10 transactions: <2 seconds (target achieved)

### Phase 3: Reconciliation Integration (Optional Enhancement)
**Estimated Effort:** 2-3 hours

**Implementation Tasks:**
- [ ] Refactor reconciliation executor (src/tools/reconciliation/executor.ts:142)
- [ ] Implement chunked bulk create (≤100 per chunk) with automatic fallback to sequential on error per chunk
- [ ] Update reconciliation tests to cover bulk and fallback paths
- [ ] Performance benchmark: reconcile account with 20 missing transactions
- [ ] Update reconciliation documentation

**Definition of Done (Exit Criteria):**
- ✅ Reconciliation uses bulk create for 2+ transactions
- ✅ Single transaction still uses createTransaction (no regression)
- ✅ Automatic fallback to sequential mode if bulk create fails
- ✅ Tests cover: bulk success, single transaction, bulk failure → fallback
- ✅ Duplicate/failed entries from `results` are surfaced back to the reconciliation caller
- ✅ Performance improvement measured and documented
- ✅ No breaking changes to reconciliation API or response format

**Performance Baseline:**
- Reconcile 20 missing transactions (sequential): ~30 seconds
- Reconcile 20 missing transactions (bulk): <8 seconds (target)

### Phase 4: Configurable Response Detail (Optional Enhancement)
**Estimated Effort:** 2 hours

**Note:** Response size detection and automatic summary mode are **mandatory in Phase 1**. This phase adds user-configurable detail levels.

- [ ] Add optional `response_mode` parameter: 'full' | 'summary' | 'ids_only'
- [ ] Implement manual detail level override (bypasses automatic size detection)
- [ ] Update dry-run to preview based on selected response mode
- [ ] Add tests for all response mode combinations
- [ ] Document trade-offs in API.md

**Deliverables:**
- Users can explicitly request summary mode for large batches
- Users can force full mode for small batches (override auto-detection)

## API Documentation

### Tool: `create_transactions`

**Description:** Creates multiple transactions in a single operation for improved efficiency.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `transactions` (array, required, 1-100 items): Array of transaction objects to create
  - `account_id` (string, required): Account ID for the transaction
  - `date` (string, required): Date in ISO format (YYYY-MM-DD)
  - `amount` (integer, required): Amount in milliunits (e.g., -25500 for -$25.50)
  - `payee_name` (string, optional): Payee name
  - `payee_id` (string, optional): Payee ID
  - `category_id` (string, optional): Category ID
  - `memo` (string, optional): Memo/note for the transaction
  - `cleared` (enum, optional): Status - 'cleared', 'uncleared', or 'reconciled'
  - `approved` (boolean, optional): Whether transaction is approved
  - `flag_color` (enum, optional): Flag color - 'red', 'orange', 'yellow', 'green', 'blue', 'purple'
  - `import_id` (string, optional): Unique import ID for duplicate detection
- `dry_run` (boolean, optional): Preview the operation without creating transactions

**Returns:**
- `success` (boolean): Whether operation succeeded
- `server_knowledge` (number): YNAB server knowledge value
- `summary` (object): Summary statistics
  - `total_requested` (number): Number of transactions requested
  - `created` (number): Number of transactions created
  - `duplicates` (number): Number of transactions skipped as duplicates
- `results` (array): Per-transaction correlation results (always present)
  - `request_index` (number): Index in original request array
  - `status` (string): 'created', 'duplicate', or 'failed'
  - `transaction_id` (string, optional): Created transaction ID (only for 'created')
  - `correlation_key` (string): import_id or hash for matching
  - `error` (string, optional): Error message (only for 'failed')
- `transactions` (array, optional): Full transaction objects (omitted if response >64KB)
- `duplicate_import_ids` (array, optional): Import IDs that were skipped
- `message` (string, optional): Additional information (e.g., "Response downgraded to summary mode")

**Example:**
```json
{
  "budget_id": "12345678-1234-1234-1234-123456789012",
  "transactions": [
    {
      "account_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "date": "2025-01-13",
      "amount": -25500,
      "payee_name": "Grocery Store",
      "category_id": "cccccccc-dddd-eeee-ffff-000000000000",
      "cleared": "cleared"
    },
    {
      "account_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "date": "2025-01-13",
      "amount": -15000,
      "payee_name": "Gas Station",
      "category_id": "cccccccc-dddd-eeee-ffff-111111111111",
      "cleared": "cleared"
    }
  ]
}
```

### Tool: `update_transactions`

**Description:** Updates multiple existing transactions in a single operation.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `transactions` (array, required, 1-100 items): Array of transaction updates
  - `id` (string, required): Transaction ID to update
  - All other fields from create (optional): Only provided fields will be updated
  - `original_account_id` (string, optional but strongly recommended): Account ID the transaction currently belongs to (used for cache invalidation + dry-run previews; ignored by YNAB API)
  - `original_date` (string, optional but strongly recommended): Persisted transaction date in ISO format (used for cache invalidation + dry-run previews)
- `dry_run` (boolean, optional): Preview the operation without updating transactions

**Returns:**
Similar structure to `create_transactions` with `updated` count instead of `created`. `results` entries use `status: 'updated' | 'failed'` and retain `correlation_key` so clients can match each update.

> **Note:** If more than 5% of update entries arrive without `original_*` metadata and no cached values exist, the tool returns a `VALIDATION_ERROR` instructing the caller to include the missing fields. This keeps cache invalidation deterministic without issuing dozens of best-effort metadata fetches.

## Risks and Mitigation

### Risk 1: Response Size Exceeds MCP Limits
**Likelihood:** High (for 50+ transactions)
**Impact:** High (tool unusable for large batches)
**Mitigation:**
- Implement summary response format (Phase 1)
- Add response size detection and automatic summarization
- Document recommended batch sizes (25-50 transactions)

### Risk 2: Partial Failures
**Likelihood:** Medium
**Impact:** Medium (some transactions created, some not)
**Mitigation:**
- YNAB API handles duplicates gracefully via import_id
- Return detailed success/failure status per transaction
- Document that users should use import_id for safe retries
- Use multi-bucket correlation so repeated transactions without import_id still map back to the correct request indices

### Risk 3: Cache Invalidation Performance
**Likelihood:** Low
**Impact:** Low (slight performance degradation)
**Mitigation:**
- Batch cache deletions
- Use Set to deduplicate cache keys
- Consider adding deletePattern() method to CacheManager

### Risk 4: Breaking Reconciliation
**Likelihood:** Low (if Phase 3 implemented)
**Impact:** High
**Mitigation:**
- Make Phase 3 opt-in with feature flag
- Keep sequential mode as fallback
- Extensive testing before enabling by default

### Risk 5: YNAB API Changes
**Likelihood:** Low
**Impact:** Medium
**Mitigation:**
- Follow YNAB SDK patterns closely
- Add integration tests that will catch API changes
- Monitor YNAB API changelog

## Success Metrics

1. **Functionality**
   - ✅ Both tools work with 1-100 transactions
   - ✅ All tests passing with 80%+ coverage
   - ✅ Response size under MCP limits for max batch size

2. **Performance** (vs baseline)
   - ✅ Bulk create 10 transactions: <2 seconds (baseline: 7s sequential)
   - ✅ Bulk update 10 transactions: <2 seconds (baseline: 7s sequential)
   - ✅ Reconciliation 70% faster (bulk: <8s for 20 tx, baseline: 30s sequential)

3. **API Efficiency**
   - ✅ Single API call per batch (vs N calls)
   - ✅ Reduced rate limit consumption

4. **Developer Experience**
   - ✅ Clear error messages for validation failures
   - ✅ Dry run provides useful preview
   - ✅ Documentation complete and accurate

## Design Decisions (Finalized)

All open questions have been resolved:

1. **Transaction Count Warnings**
   - **Decision**: Warn at 100 transactions (hard limit), suggest batching above 50
   - **Rationale**: 100 is YNAB SDK limit; 50 keeps response size manageable
   - **Implementation**: Add warning in response message when count >50

2. **Transfer Transactions in Bulk**
   - **Decision**: Allow transfer transactions, document auto-creation behavior in API.md
   - **Rationale**: Blocking transfers would limit functionality; users can handle auto-created transfers
   - **Implementation**: Add prominent note in docs: "Transfer transactions auto-create matching transfer in destination account"

3. **Subtransactions Support**
   - **Decision**: NOT supported in v1 (reject requests with subtransactions)
   - **Rationale**: High complexity, unclear use case for bulk split transactions
   - **Implementation**: Schema validation rejects subtransactions; return clear error message
   - **Future**: Create GitHub issue to track feature request

4. **import_transactions Tool**
   - **Decision**: NOT adding as separate tool
   - **Rationale**: `create_transactions` with `import_id` achieves the same result (idempotent imports with automatic duplicate detection). Adding a separate tool would:
     - Duplicate functionality
     - Increase maintenance burden
     - Confuse users about which tool to use
   - **Implementation**: Document the recommended pattern in API.md:
     ```markdown
     ### Idempotent Transaction Imports

     To safely import transactions without creating duplicates, use `create_transactions`
     with the `import_id` field. YNAB automatically detects duplicates and skips them.

     Example import_id format: `YNAB:[milliunit_amount]:[iso_date]:[occurrence]`

     For external bank imports, use your own format: `BANK:ACCT:TXID:...`
     ```

5. **Rate Limiting Strategy**
   - **Decision**: No artificial delays; rely on YNAB API rate limiting
   - **Rationale**: YNAB SDK handles rate limits via 429 responses; adding delays would degrade performance
   - **Implementation**: Standard error handling for 429 responses (already exists in codebase)

## Follow-Up Issues (Deferred Features)

Create GitHub issues to track these enhancements after v1 ships:

1. **Subtransactions Support in Bulk Operations**
   - Add support for creating/updating transactions with subtransactions
   - Complex validation: subtransaction amounts must sum to parent amount
   - Use case: bulk import of split transactions

2. **CacheManager.deleteMany() Method**
   - Add batch deletion method to CacheManager for atomic bulk operations
   - Performance optimization for bulk transaction cache invalidation
   - Signature: `deleteMany(keys: string[]): void`

3. **Configurable Response Detail Level**
   - Add `response_mode` parameter: 'full' | 'summary' | 'ids_only'
   - Allows user control over response size vs detail trade-off
   - Default: auto-detect based on size

4. **Bulk Delete Transactions**
   - Add `delete_transactions` tool for bulk deletion
   - Use case: clean up imported transactions, bulk data management
   - Similar pattern to create/update

## References

- [YNAB API Documentation](https://api.ynab.com/)
- [YNAB SDK TransactionsApi.ts](https://github.com/ynab/ynab-sdk-js/blob/main/src/apis/TransactionsApi.ts)
- Current implementation: `src/tools/transactionTools.ts`
- Reconciliation executor: `src/tools/reconciliation/executor.ts`

## Resolved Open Questions

### Question 1: Per-Transaction Correlation in Summary Mode

**Problem:** How should per-transaction results be correlated back to inputs when response downgrades to summary mode?

**Resolution:** Add a lightweight `results` array that is **always present** in all response modes:

```typescript
interface BulkTransactionResult {
  request_index: number;           // Absolute position in request array
  status: 'created' | 'duplicate' | 'failed' | 'updated';
  transaction_id?: string;         // Only for 'created' or 'updated'
  correlation_key: string;         // import_id or hash of transaction fields
  error?: string;                  // Only for 'failed'
}
```

**Size Impact:** ~120 bytes per entry = ~12KB for 100 transactions (well within 64KB → 100KB margin)

**Correlation Strategy:**
1. **Primary:** Use `import_id` if provided (enables YNAB duplicate detection + client-side matching)
2. **Fallback:** Generate deterministic SHA-256 hash (first 16 chars, prefixed with `hash:`) of `{account_id,date,amount,payee_id,payee_name,category_id,memo,cleared,approved,flag_color}` for transactions without import_id
3. **Multi-Bucket Matching:** Store every response transaction in a queue keyed by the correlation string so multiple identical transactions are popped in order rather than overwritten
4. **Always include:** `request_index` for absolute position matching

**Guarantees:** Requests without import_id correlate deterministically even when multiple entries are identical, because the handler pops from the appropriate queue in the same sequence the API returns rows. Remaining mismatches fall back to explicit error entries so clients can retry the affected items only.

**Benefits:**
- Perfect correlation even in summary mode
- Enables retry logic for failed/duplicate transactions
- Clients can map status back to original input
- Minimal overhead (~12KB for max batch size)

**Implementation:** See "Response Size Management" section above for full code example.

### Question 2: Account ID Validation Data Source

**Problem:** What data source should power the proposed "Ensure all account_ids are valid" check without extra API calls?

**Resolution:** **Remove pre-flight account_id validation entirely** (Option 1).

**Rationale:**
- YNAB API already validates account IDs and returns clear errors
- Pre-flight validation adds complexity and cache staleness risks
- Bulk operation fails fast anyway if any account_id is invalid
- Rate limit savings come from batching creates, not from preventing failed requests
- Making extra API calls per account defeats the purpose of bulk operations

**Alternative Considered (Rejected):**
- Cache-only validation (Option 2): Inconsistent behavior on cache miss, false negatives/positives from stale cache
- Fetch accounts on demand (Option 3): Adds 1 API call on cache miss, defeats rate-limit goal

**Documentation Update:** Pre-flight validation section now states:
> **Note:** Account ID validation is intentionally omitted; YNAB API validates and returns clear errors, avoiding unnecessary API calls and cache staleness risks

**Error Handling:** Rely on YNAB API errors for invalid account_id:
```typescript
try {
  const response = await ynabAPI.transactions.createTransactions(budgetId, {
    transactions: params.transactions
  });
} catch (error) {
  if (error.error?.detail?.includes('account_id')) {
    return ErrorHandler.createErrorResponse('VALIDATION_ERROR',
      'One or more transactions have invalid account_id', {
        ynab_error: error.error.detail
      });
  }
  throw error;
}
```

## Appendix A: YNAB SDK Method Signatures

```typescript
// From ynab-sdk-js
class TransactionsApi {
  // Create single transaction
  createTransaction(
    budgetId: string,
    data: SaveTransactionWrapper
  ): Promise<TransactionResponse>

  // Create multiple transactions (bulk)
  createTransactions(
    budgetId: string,
    data: SaveTransactionsWrapper
  ): Promise<SaveTransactionsResponse>

  // Update single transaction
  updateTransaction(
    budgetId: string,
    transactionId: string,
    data: SaveTransactionWrapper
  ): Promise<TransactionResponse>

  // Update multiple transactions (bulk)
  updateTransactions(
    budgetId: string,
    data: UpdateTransactionsWrapper
  ): Promise<SaveTransactionsResponse>

  // Import transactions (specialized bulk create)
  importTransactions(
    accountId: string,
    transactions: Transaction[]
  ): Promise<TransactionsImportResponse>
}
```

## Implementation Notes

- **Correlation Implementation:** The `correlateResults()` helper builds separate FIFO buckets for `import_id` and hash-based keys, then walks requests in order to pop the next matching transaction ID. Identical transactions naturally resolve because each bucket shift consumes only one ID, and duplicates are short-circuited whenever the API surfaces the `duplicate_import_ids` list.
- **Response Size Thresholds:** Full payloads are returned when the serialized body is ≤64KB, summary mode (no `transactions` array) is enforced between 64KB and 96KB, and ids-only mode (minimal `results` entries) is used between 96KB and the hard 100KB ceiling. Attempting to exceed 100KB raises a `RESPONSE_TOO_LARGE` error so the MCP transport never overruns limits.
- **Cache Invalidation Strategy:** After each successful bulk create the server invalidates `transactions:list`, every affected `account:get` key, and each impacted `month:get` key derived from `YYYY-MM-01`. No other caches are touched, keeping the blast radius focused on data that actually changed.
- **Hash Algorithm:** When no `import_id` is supplied, correlation uses a SHA-256 hash over normalized account/date/amount/payee/category/memo/cleared/approved/flag fields. The first 16 hex characters (prefixed with `hash:`) are sufficient for deterministic matching while keeping response metadata compact.
- **Testing Coverage:** Vitest unit suites cover validation boundaries, dry-run summaries, hash correlation, duplicate handling, response mode downgrades, and cache invalidation. Integration suites exercise real YNAB budgets for small and large batches, duplicates, multi-account batches, cache warming/invalidation, dry runs, and error scenarios, cleaning up created transactions automatically.
- **Known Limitations:** Subtransactions are intentionally blocked in Phase 1, ids-only responses omit detailed transaction data when payloads are large, real rate-limit scenarios remain manually documented, and hash collisions—while unlikely—would surface as `status='failed'` entries requiring manual reconciliation.

## Appendix B: Example Use Cases

### Use Case 1: Import Bank Statement
```typescript
// User downloads CSV with 25 transactions
// AI assistant parses CSV and calls create_transactions
{
  "budget_id": "...",
  "transactions": [
    { /* transaction 1 */ },
    { /* transaction 2 */ },
    // ... 25 transactions total
  ]
}
```

### Use Case 2: Batch Categorization
```typescript
// User: "Categorize all uncategorized transactions from Walmart as Groceries"
// AI assistant:
// 1. list_transactions(type='uncategorized')
// 2. Filter for Walmart payee
// 3. update_transactions with category_id
{
  "budget_id": "...",
  "transactions": [
    {
      "id": "trans-1",
      "category_id": "groceries-category-id"
    },
    {
      "id": "trans-2",
      "category_id": "groceries-category-id"
    }
    // ... more
  ]
}
```

### Use Case 3: Reconciliation Efficiency
```typescript
// Reconciliation finds 15 missing bank transactions
// Instead of 15 API calls, make 1:
create_transactions({
  budget_id: "...",
  transactions: [/* 15 missing transactions */]
})
```

### Use Case 4: Recurring Transaction Setup
```typescript
// User: "Create my recurring bills for the next 3 months"
// AI assistant calculates dates and calls create_transactions
{
  "budget_id": "...",
  "transactions": [
    { "date": "2025-01-15", "payee_name": "Rent", "amount": -150000 },
    { "date": "2025-02-15", "payee_name": "Rent", "amount": -150000 },
    { "date": "2025-03-15", "payee_name": "Rent", "amount": -150000 },
    // ... more recurring bills
  ]
}
```

---

**Document Version:** 1.3
**Last Updated:** 2025-11-13
**Author:** Claude Code
**Status:** Phase 2 Complete

**Changes in v1.3:**
- Marked Phase 2 (update_transactions) as completed (2025-11-13)
- Documented three-tier metadata resolution implementation
- Added comprehensive unit test coverage details
- Updated all exit criteria to reflect successful implementation
- Performance targets achieved for bulk update operations

**Changes in v1.2:**
- Captured create_transactions completion details plus completion date in the phase tracker
- Added Implementation Notes covering correlation, caching, sizing, hashing, testing, and limitations
- Refreshed document metadata to reflect November 2025 status
