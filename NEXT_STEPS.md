# Next Steps for Reconciliation v2 Completion

**Last Updated**: 2025-11-05 (after MoneyValue implementation)
**Current Version**: v0.10.0
**Branch**: master

## What Was Just Completed

✅ **MoneyValue Implementation** - Commit: 0b55cc7

- Implemented structured MoneyValue type throughout reconciliation
- Added currency support to analyzer (threaded from budget settings)
- Updated types (BalanceInfo, ReconciliationSummary) to use MoneyValue
- Updated reconcileV2Adapter to work with MoneyValue objects
- Fixed adapterCurrency scenario test

## Current Test Status

**Test Results**: 8 failures / 1061 tests

- 1053 passing (99.2% pass rate)
- 8 failing tests need fixes

### Failing Tests Breakdown:

#### 1. MoneyValue Test Data Issues (3 tests)

These tests use mock data with old structure (raw numbers instead of MoneyValue):

**File**: `src/tools/reconciliation/__tests__/analyzer.test.ts`

- `should calculate balance information correctly`
  - **Issue**: Test expects `balance_info.current_cleared` to be `-50` (number)
  - **Reality**: Now returns MoneyValue object `{value: -50, value_display: "-$50.00", ...}`
  - **Fix**: Update test to check `balance_info.current_cleared.value` or use MoneyValue matcher

**File**: `src/tools/reconciliation/__tests__/adapter.test.ts`

- `returns human narrative and structured payload with MoneyValue fields`
  - **Issue**: Test expects `value_display` but gets `undefined`
  - **Fix**: Update test mock data to create proper MoneyValue objects using helper function

**File**: `src/tools/reconciliation/__tests__/scenarios/repeatAmount.scenario.test.ts`

- `prioritizes repeat-amount insight when multiple bank rows share totals`
  - **Issue**: Insight not being generated (likely test data issue)
  - **Fix**: Review test data setup and ensure repeat-amount conditions are met

#### 2. Matcher Algorithm Tuning (5 tests)

These are pre-existing failures from confidence scoring calibration:

**File**: `src/tools/reconciliation/__tests__/matcher.test.ts`

- `should return medium confidence for fuzzy payee match`
  - **Issue**: "AMAZON.COM" vs "Amazon Prime" scores HIGH (≥90) instead of MEDIUM (60-89)
  - **Fix**: Adjust payee similarity scoring weights in `matcher.ts`

- `should match within amount tolerance`
  - **Issue**: Amount tolerance not working, returns 'none' instead of match
  - **Fix**: Review amount tolerance logic in `amountsMatch()` function

**File**: `src/tools/reconciliation/__tests__/payeeNormalizer.test.ts`

- `should handle real-world payee variations`
  - **Issue**: "Amazon" vs "Amazon Prime" scores 54.5, expects >60
  - **Fix**: Improve fuzzyMatch algorithm or adjust test expectations

- `should return partial score for partial overlap`
  - **Issue**: tokenBasedSimilarity returns 0, expects >50
  - **Fix**: Review token extraction logic (may be normalizing away all tokens)

## Immediate Next Steps (Priority Order)

### Step 1: Fix MoneyValue Test Data (1-2 hours)

**File**: `src/tools/reconciliation/__tests__/analyzer.test.ts`

Location: Line 297

```typescript
// BEFORE (fails):
expect(result.balance_info.current_cleared).toBe(-50.0);

// AFTER (will pass):
expect(result.balance_info.current_cleared.value).toBe(-50.0);
expect(result.balance_info.current_cleared.currency).toBe('USD');
```

Search for all assertions on `balance_info` and `summary` fields and update them to access `.value` or `.value_display`.

**File**: `src/tools/reconciliation/__tests__/adapter.test.ts`

The test creates mock ReconciliationAnalysis data. Update it to use the same pattern as `adapterCurrency.scenario.test.ts`:

```typescript
// Add this helper at the top of the file:
const makeMoney = (value: number, currency = 'USD') => ({
  value_milliunits: Math.round(value * 1000),
  value,
  value_display: `$${value.toFixed(2)}`,
  currency,
  direction: value === 0 ? 'balanced' : value > 0 ? 'credit' : 'debit',
});

// Then update all mock data creation to use makeMoney()
// Example:
const mockAnalysis: ReconciliationAnalysis = {
  // ...
  balance_info: {
    current_cleared: makeMoney(-899.02),
    current_uncleared: makeMoney(0),
    // ...
  },
  summary: {
    // ...
    current_cleared_balance: makeMoney(-899.02),
    // ...
  },
};
```

### Step 2: Fix Matcher Algorithm Issues (2-3 hours)

**File**: `src/tools/reconciliation/matcher.ts`

The scoring algorithm is too generous. Review lines 59-116 where confidence scores are calculated.

**Current weights**:

- Amount match: 40 points (required)
- Date match: 40 points
- Payee match: 20 points (18 for high similarity, 15 for similar, 10 for somewhat)

**Problem**: "AMAZON.COM" vs "Amazon Prime" gets:

- Amount: 40 (exact match)
- Date: 40 (same day)
- Payee: ~18 (high similarity after normalization)
- **Total: 98 = HIGH** (should be MEDIUM)

**Potential fixes**:

1. Reduce payee similarity scoring (max 15 instead of 20)
2. Increase threshold for "exact" payee match (require 95+ similarity for full points)
3. Add penalty for fuzzy matches

**File**: `src/tools/reconciliation/payeeNormalizer.ts`

Review the fuzzyMatch and tokenBasedSimilarity functions. The Levenshtein distance might be too strict.

### Step 3: Run Tests After Each Fix

```bash
# Test specific files
npm test -- src/tools/reconciliation/__tests__/analyzer.test.ts
npm test -- src/tools/reconciliation/__tests__/adapter.test.ts
npm test -- src/tools/reconciliation/__tests__/matcher.test.ts

# Full reconciliation test suite
npm test -- src/tools/reconciliation/

# All tests
npm test
```

### Step 4: Commit Fixed Tests

Once all tests pass:

```bash
git add src/tools/reconciliation/__tests__/
git commit -m "fix: update reconciliation tests for MoneyValue structure

- Update analyzer.test.ts to check MoneyValue.value instead of raw numbers
- Update adapter.test.ts to use makeMoney() helper for mock data
- Fix matcher confidence scoring to properly classify fuzzy matches
- Fix payee normalizer token extraction

All reconciliation tests now passing (1061/1061)"
git push origin master
```

## After Tests Pass: Next Major Features

### Phase 2: Dual-Channel Output (Week 1-2)

**Goal**: Return human-readable narrative + structured JSON

**Files to modify**:

- `src/tools/reconciliation/reportFormatter.ts` (create new)
- `src/tools/reconcileV2Adapter.ts` (wire up formatter)

**Current state**: Adapter already has narrative builder, just needs to be properly formatted and structured.

**Reference**: See `docs/plans/2025-11-01-reconciliation-output-improvements.md` Phase 3-4

### Phase 3: Execution Phase (Week 3-4)

**Goal**: Allow users to execute approved reconciliation actions

**Files**:

- `src/tools/reconciliation/executor.ts` (already exists, needs debugging)
- `src/tools/reconciliation/index.ts` (add execution logic)

**Current issues**: Type errors in executor.ts (see type-check output)

## Testing Strategy

### Running Specific Tests

```bash
# Single test file
npm test -- src/tools/reconciliation/__tests__/analyzer.test.ts

# Single test case
npm test -- src/tools/reconciliation/__tests__/analyzer.test.ts -t "should calculate balance"

# Watch mode for development
npm test -- --watch src/tools/reconciliation/__tests__/analyzer.test.ts
```

### Type Checking

```bash
# Full type check
npm run type-check

# Watch mode
npm run type-check -- --watch

# Check specific file
npx tsc --noEmit src/tools/reconciliation/analyzer.ts
```

## Quick Reference

### Test File Locations

```
src/tools/reconciliation/__tests__/
├── adapter.test.ts                    # Adapter tests (1 failure)
├── analyzer.test.ts                   # Analyzer tests (1 failure)
├── matcher.test.ts                    # Matcher tests (2 failures)
├── payeeNormalizer.test.ts           # Payee tests (2 failures)
└── scenarios/
    ├── adapterCurrency.scenario.test.ts  # ✅ Fixed
    └── repeatAmount.scenario.test.ts     # 1 failure
```

### Key Files Modified in This Session

```
src/tools/reconciliation/
├── types.ts                          # Added MoneyValue to BalanceInfo/Summary
├── analyzer.ts                       # Added currency parameter
├── index.ts                         # Pass currency to analyzer
└── __tests__/
    └── scenarios/
        └── adapterCurrency.scenario.test.ts  # Fixed

src/tools/reconcileV2Adapter.ts       # Updated for MoneyValue
src/utils/money.ts                    # MoneyValue type (already existed)
```

### Documentation Created

```
CLEANUP_SUMMARY.md           # Repository cleanup documentation
UNIMPLEMENTED_FEATURES.md    # Comprehensive roadmap (6-12 months of work)
NEXT_STEPS.md               # This file
```

## Context for Next Session

When you return to this project:

1. **Start here**: Read this file (NEXT_STEPS.md)
2. **Check test status**: `npm test`
3. **Fix tests in order**: analyzer.test.ts → adapter.test.ts → matcher.test.ts
4. **Commit when passing**: Follow Step 4 above
5. **Then move to**: Dual-channel output or execution phase

## Key Decisions Made

1. **MoneyValue is the standard** - All monetary values use structured MoneyValue type
2. **Currency threaded from budget** - Analyzer receives currency from budget settings
3. **USD default** - If currency not specified, defaults to USD
4. **Backward compatible** - Old code still works, just not taking advantage of MoneyValue

## Known Issues

1. **Type errors in executor.ts** (22 remaining) - Part of unimplemented execution phase
2. **Some tests expect raw numbers** - Need updating to MoneyValue structure
3. **Matcher scoring too generous** - Needs tuning for fuzzy matches

## Success Criteria

✅ MoneyValue implemented
✅ Currency support added
✅ Types updated
✅ Documentation created
⏳ All tests passing (8 failures remaining)
⏳ Dual-channel output
⏳ Execution phase

---

**Good luck with the next session! Start by fixing the 3 MoneyValue test data issues first - they're the easiest wins.**
