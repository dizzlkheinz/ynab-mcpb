# Reconciliation System - YNAB MCP Server

This directory contains the comprehensive account reconciliation system for matching bank CSV transactions with YNAB transactions using fuzzy matching, bulk operations, and smart recommendations.

## Purpose & Responsibilities

The `src/tools/reconciliation/` directory implements:

1. **CSV Parsing** - Parse bank CSV files with presets for major Canadian banks
2. **Fuzzy Matching** - Match transactions despite merchant name variations
3. **Transaction Analysis** - Detect discrepancies, duplicates, and missing transactions
4. **Bulk Operations** - Create, update, and unclear transactions in bulk with progress tracking
5. **Recommendations** - Smart suggestions for reconciliation actions
6. **Date Range Filtering** (v0.18.4) - Filter YNAB transactions to statement period to prevent false positives

## Architecture

The reconciliation system follows a pipeline architecture:

```
CSV File → Parser → Matcher → Analyzer → Executor → Reporter
              ↓         ↓          ↓          ↓
           Presets  Fuzzy Logic  Rules   Bulk API
```

### Component Flow

1. **CSV Parser** - Parse bank CSV, auto-detect sign convention, normalize payees
2. **Matcher** - Fuzzy match CSV transactions to YNAB transactions (85% threshold)
3. **Analyzer** - Analyze matches, detect discrepancies, duplicates, missing transactions
4. **Executor** - Execute bulk create/update/unclear operations with progress tracking
5. **Reporter** - Format human-readable reconciliation report with statistics

## Key Files & Responsibilities

| File | Responsibility | Lines | Critical |
|------|---------------|-------|----------|
| **csvParser.ts** | CSV parsing with bank presets (TD, RBC, Scotiabank, etc.) | ~400 | HIGH |
| **matcher.ts** | Fuzzy matching engine with configurable scoring | ~500 | CRITICAL |
| **analyzer.ts** | Transaction analysis and discrepancy detection | ~600 | CRITICAL |
| **executor.ts** | Bulk transaction operations (create/update/unclear) | ~580 | HIGH |
| **executorErrors.ts** | YNAB error normalization and propagation | ~120 | HIGH |
| **executorHelpers.ts** | Executor utilities (chunking, sorting, recommendations) | ~150 | MEDIUM |
| **balanceReconciliation.ts** | Balance verification and likely-cause analysis | ~130 | HIGH |
| **outputBuilder.ts** | Dual-channel payload builder (human + structured) | ~370 | MEDIUM |
| **recommendationEngine.ts** | Smart reconciliation recommendations | ~300 | MEDIUM |
| **reportFormatter.ts** | Human-readable reconciliation reports | ~400 | MEDIUM |
| **signDetector.ts** | Auto-detection of debit/credit sign conventions | ~130 | HIGH |
| **payeeNormalizer.ts** | Payee name normalization for matching | ~150 | MEDIUM |
| **ynabAdapter.ts** | YNAB API integration layer | ~300 | HIGH |
| **types.ts** | Reconciliation domain types (BankTransaction, MatchCandidate, MatchingConfig, recommendations) | ~300 | HIGH |

## Critical Patterns & Conventions

### 1. Date Range Filtering (v0.18.4)

**Critical Change**: Reconciliation now filters YNAB transactions to only those within the statement date range.

```typescript
// Extract date range from CSV transactions
const csvDates = csvTransactions.map((t) => new Date(t.date).getTime());
const minDate = new Date(Math.min(...csvDates));
const maxDate = new Date(Math.max(...csvDates));

// Filter YNAB transactions to date range using Date.UTC for timezone safety
const inRangeTransactions = ynabTransactions.filter((t) => {
  const txDate = new Date(t.date);
  const txTime = Date.UTC(
    txDate.getFullYear(),
    txDate.getMonth(),
    txDate.getDate()
  );
  const minTime = Date.UTC(
    minDate.getFullYear(),
    minDate.getMonth(),
    minDate.getDate()
  );
  const maxTime = Date.UTC(
    maxDate.getFullYear(),
    maxDate.getMonth(),
    maxDate.getDate()
  );
  return txTime >= minTime && txTime <= maxTime;
});
```

**Why Critical**: Prevents false "missing from bank" matches for transactions outside the statement period.

**What Breaks**: Not using `Date.UTC()` → timezone bugs. Not filtering → false positives for transactions before/after statement period.

### 2. Matching Algorithm

The matcher requires exact amount matching and uses weighted scoring for date and payee:

```typescript
interface MatchScoring {
  // Amounts must match exactly (milliunits) — no tolerance
  // Base score of 50 is awarded for exact amount match
  payeeWeight: 0.35; // 35% weight on payee match
  dateWeight: 0.15; // 15% weight on date match
  dateTolerance: 7; // 7 days
  autoMatchThreshold: 85; // 85% score for auto-match
}
```

**Matching Logic**:

1. **Amount Filter**: Candidates with different amounts are rejected (exact milliunits match required)
2. **Base Score**: 50 points awarded for exact amount match (replaces weighted amount score)
3. **Payee Score**: Fuzzy token-set-ratio (handles merchant name variations), weighted at 35%
4. **Date Score**: 100% if exact match, linear decay over 7 days, weighted at 15%
5. **Total Score**: `BASE_SCORE(50) + dateScore × 0.15 + payeeScore × 0.35 + bonuses`
6. **Auto-Match**: Score ≥85% automatically matches

**Why Critical**: Exact amount matching eliminates false positives from similar amounts. Scoring range is 50–100.

**What Breaks**: Too low threshold → false matches. Too high threshold → missed matches.

### 3. Bulk Operations with Progress

All bulk operations (create, update, unclear) are chunked with progress tracking:

```typescript
async function bulkCreateTransactions(
  transactions: Transaction[],
  sendProgress?: ProgressCallback
): Promise<BulkResult> {
  const chunks = chunkArray(transactions, 100); // Max 100 per API request
  let completed = 0;

  for (const chunk of chunks) {
    await sendProgress?.({
      progress: completed,
      total: transactions.length,
      message: `Creating transactions ${completed + 1}-${completed + chunk.length}...`,
    });

    await ynabAPI.createTransactions(chunk);
    completed += chunk.length;
  }

  return { created: completed };
}
```

**Why Critical**: YNAB API limits requests to 100 transactions. Progress prevents timeouts for large reconciliations.

**What Breaks**: >100 transactions per request → API rejection. Missing progress → timeouts. Missing optional chaining (`?.`) → TypeError.

### 4. CSV Bank Presets

The CSV parser includes presets for major Canadian banks:

```typescript
const BANK_PRESETS = {
  TD: {
    dateColumn: 'Date',
    amountColumn: 'Amount',
    payeeColumn: 'Description',
    signConvention: 'negative_debit', // Debits are negative
  },
  RBC: {
    dateColumn: 'Transaction Date',
    amountColumn: 'Amount',
    payeeColumn: 'Description',
    signConvention: 'positive_debit', // Debits are positive
  },
  SCOTIABANK: {
    dateColumn: 'Date',
    amountColumn: 'Amount',
    payeeColumn: 'Description',
    signConvention: 'auto', // Auto-detect
  },
  // ... more presets
};
```

**Why Important**: Simplifies CSV parsing for common banks. Auto-detection handles edge cases.

**What Breaks**: Wrong preset → incorrect parsing. Missing preset → manual column mapping required.

### 5. Sign Convention Detection

The sign detector auto-detects whether debits are positive or negative in the CSV:

```typescript
function detectSignConvention(transactions: CSVTransaction[]): SignConvention {
  const positiveCount = transactions.filter((t) => t.amount > 0).length;
  const negativeCount = transactions.filter((t) => t.amount < 0).length;

  // If mostly positive, debits are likely positive (e.g., RBC)
  if (positiveCount > negativeCount * 2) {
    return 'positive_debit';
  }

  // If mostly negative, debits are likely negative (e.g., TD)
  if (negativeCount > positiveCount * 2) {
    return 'negative_debit';
  }

  // Mixed, use heuristics (e.g., check for "debit" in description)
  return detectFromDescriptions(transactions);
}
```

**Why Important**: Different banks use different sign conventions. Auto-detection handles both.

**What Breaks**: Wrong detection → all amounts inverted (debits become credits).

### 6. Payee Normalization

Payee names are normalized for better matching:

```typescript
function normalizePayee(payee: string): string {
  return (
    payee
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special chars
      .replace(/\s+/g, ' ') // Collapse whitespace
      .trim()
  );
}

// Example:
// "AMAZON.CA*2X3Y4Z" → "amazonca2x3y4z"
// "Tim Hortons #1234" → "tim hortons 1234"
```

**Why Important**: Merchant names vary (location codes, punctuation). Normalization improves fuzzy matching.

**What Breaks**: Over-normalization → lost information. Under-normalization → missed matches.

## Configuration

Default configuration values:

```typescript
const DEFAULT_CONFIG = {
  // Amounts must match exactly (no tolerance)
  dateTolerance: 7, // 7 days (accommodates bank posting delays)
  payeeWeight: 0.35, // 35% weight
  dateWeight: 0.15, // 15% weight
  autoMatchThreshold: 85, // 85% score
  exactDateBonus: 5, // Bonus for exact date match
  exactPayeeBonus: 10, // Bonus for payee score ≥95
  maxBulkSize: 100, // Max transactions per API request
};
// BASE_SCORE = 50 is a fixed constant for exact amount match
```

## Common Development Tasks

### Adding a New Bank Preset

1. **Identify CSV format** - Download sample CSV, identify column names
2. **Determine sign convention** - Are debits positive or negative?
3. **Add preset** in `csvParser.ts`:
   ```typescript
   const BANK_PRESETS = {
     MY_BANK: {
       dateColumn: 'Date',
       amountColumn: 'Amount',
       payeeColumn: 'Description',
       signConvention: 'auto', // or 'positive_debit' / 'negative_debit'
     },
   };
   ```
4. **Test with real CSV** - Verify parsing and sign detection

### Adjusting Matching Thresholds

To adjust matching sensitivity:

1. **Update scoring weights** in `matcher.ts` (date + payee only; amount matching is exact):
   ```typescript
   const SCORING = {
     payeeWeight: 0.3, // Decrease payee importance
     dateWeight: 0.2, // Increase date importance
   };
   ```
2. **Update auto-match threshold**:
   ```typescript
   const AUTO_MATCH_THRESHOLD = 90; // Higher = more conservative
   ```
3. **Test with real data** - Verify match quality

### Adding Progress Notifications

Progress is already implemented for bulk operations. To add to new operations:

1. **Accept `sendProgress` callback**:
   ```typescript
   async function myOperation(
     input: Input,
     sendProgress?: ProgressCallback
   ): Promise<Output>
   ```
2. **Emit progress updates**:
   ```typescript
   await sendProgress?.({
     progress: currentStep,
     total: totalSteps,
     message: 'Processing...',
   });
   ```

## Testing Approach

### Unit Tests

- **Location**: `src/tools/reconciliation/__tests__/*.test.ts`
- **Mock**: YNAB API, file system
- **Coverage**: 80% minimum
- **Focus**: Matching logic, sign detection, payee normalization

### Integration Tests

- **Location**: `src/tools/reconciliation/__tests__/*.integration.test.ts`
- **Mock**: YNAB API (realistic fixtures)
- **Real**: CSV parsing, matching, analysis
- **Focus**: End-to-end reconciliation flow

### Example Unit Test

```typescript
describe('matcher', () => {
  it('should match transactions with 85%+ score', () => {
    const csvTx = {
      date: '2025-01-31',
      amount: 25500, // milliunits
      payee: 'AMAZON.CA*2X3Y4Z',
    };

    const ynabTx = {
      date: '2025-01-31',
      amount: 25500,
      payee_name: 'Amazon',
    };

    const score = calculateMatchScore(csvTx, ynabTx);
    expect(score).toBeGreaterThan(85);
  });
});
```

## What Will Break If Violated

### 1. Missing Date Range Filtering (v0.18.4)

**Problem**: Not filtering YNAB transactions to statement date range.

**Impact**: False "missing from bank" matches for transactions outside statement period.

**Fix**: Always filter YNAB transactions to CSV date range:

```typescript
const inRangeTransactions = filterToDateRange(
  ynabTransactions,
  csvMinDate,
  csvMaxDate
);
```

### 2. Not Using `Date.UTC()` for Date Comparison

**Problem**: Using local time for date comparisons.

**Impact**: Timezone bugs → transactions on boundary dates incorrectly included/excluded.

**Fix**: Always use `Date.UTC()` for date comparisons:

```typescript
// BAD
const txTime = new Date(txDate).getTime();

// GOOD
const txTime = Date.UTC(
  txDate.getFullYear(),
  txDate.getMonth(),
  txDate.getDate()
);
```

### 3. Missing Milliunits Conversion

**Problem**: Comparing dollar amounts to YNAB milliunits.

**Impact**: No matches (amounts off by 1000x).

**Fix**: Always convert CSV amounts to milliunits:

```typescript
const csvAmountMilliunits = amountToMilliunits(csvRow.amount);
```

### 4. >100 Transactions Per Bulk Request

**Problem**: Sending >100 transactions in a single API request.

**Impact**: YNAB API rejection (400 error).

**Fix**: Always chunk bulk operations:

```typescript
const chunks = chunkArray(transactions, 100);
for (const chunk of chunks) {
  await ynabAPI.createTransactions(chunk);
}
```

### 5. Missing Progress for Long Operations

**Problem**: Not emitting progress for operations >5 seconds.

**Impact**: Timeouts, poor UX, no visibility into reconciliation status.

**Fix**: Emit progress updates during bulk operations:

```typescript
await sendProgress?.({
  progress: completed,
  total: totalTransactions,
  message: 'Creating transactions...',
});
```

### 6. Wrong Sign Convention

**Problem**: Not detecting or using wrong sign convention.

**Impact**: All amounts inverted (debits become credits, credits become debits).

**Fix**: Use auto-detection or correct preset:

```typescript
const signConvention = detectSignConvention(csvTransactions);
const correctedAmounts = applySignConvention(
  csvTransactions,
  signConvention
);
```

## Reconciliation Report Fields (v0.18.4)

The reconciliation report includes the following statistics:

```typescript
interface ReconciliationReport {
  // Summary statistics
  total_csv_transactions: number;
  total_ynab_transactions: number;
  ynab_in_range_count: number; // NEW (v0.18.4)
  ynab_outside_range_count: number; // NEW (v0.18.4)

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
  errors: BulkError[];
}
```

### New Fields (v0.18.4)

- **`ynab_in_range_count`**: Number of YNAB transactions within statement date range (eligible for matching)
- **`ynab_outside_range_count`**: Number of YNAB transactions outside statement date range (excluded from matching)

These fields help users understand why certain YNAB transactions weren't matched (they were outside the statement period).

## Performance Considerations

1. **Chunked Bulk Operations**: Max 100 transactions per API request
2. **Progress Notifications**: Every chunk (100 transactions) emits progress
3. **Date Range Filtering**: Reduces YNAB transaction set for faster matching
4. **Fuzzy Matching**: Uses optimized token-set-ratio algorithm
5. **Payee Normalization**: Caches normalized payees to avoid re-computation

## Integration Points

### With Tools (`src/tools/`)

- **outputBuilder.ts**: Builds dual-channel payload (human narrative + structured JSON)
- **transactionTools.ts**: Uses bulk transaction creation/update

### With Server (`src/server/`)

- **toolRegistry.ts**: Progress notification support
- **cacheManager.ts**: Cache invalidation after bulk operations

### With Utils (`src/utils/`)

- **money.ts**: Milliunits conversion for amount matching
- **dateUtils.ts**: Date formatting and validation

## Related Documentation

- [Root CLAUDE.md](../../../CLAUDE.md) - Project overview
- [Tools CLAUDE.md](../CLAUDE.md) - Tool implementation patterns
- [Server CLAUDE.md](../../server/CLAUDE.md) - Server components
- [Reconciliation Architecture](../../../docs/technical/reconciliation-system-architecture.md) - Detailed system design
