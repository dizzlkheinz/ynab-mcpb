# Utilities - YNAB MCP Server

This directory contains pure utility functions for common operations like money conversion, date formatting, validation, and error handling.

## Purpose & Responsibilities

The `src/utils/` directory provides:

1. **Money Conversion** - Convert between dollars and YNAB milliunits (CRITICAL)
2. **Date Utilities** - Format, validate, and parse dates
3. **Amount Validation** - Validate monetary amounts
4. **Error Classes** - Custom error types with context
5. **Pure Functions** - No side effects, easy to test

## Key Files & Responsibilities

| File | Responsibility | Lines | Critical |
|------|---------------|-------|----------|
| **money.ts** | Milliunits ↔ dollars conversion (CRITICAL!) | ~100 | CRITICAL |
| **dateUtils.ts** | Date formatting, validation, parsing | ~150 | HIGH |
| **amountUtils.ts** | Amount validation and utilities | ~100 | MEDIUM |
| **baseError.ts** | Base error class for custom errors | ~50 | HIGH |
| **errors.ts** | Custom error classes and utilities | ~200 | HIGH |
| **validationError.ts** | Validation-specific error handling | ~100 | MEDIUM |

## Critical Patterns & Conventions

### 1. Money Conversion (CRITICAL!)

**YNAB uses milliunits internally: 1 dollar = 1000 milliunits**

This is the **most critical** utility in the entire codebase. Getting this wrong means amounts are 1000x off.

```typescript
// money.ts
export function amountToMilliunits(dollars: number): number {
  return Math.round(dollars * 1000);
}

export function milliunitsToAmount(milliunits: number): number {
  return milliunits / 1000;
}
```

**Usage Examples**:

```typescript
// User provides $25.50 → Convert to milliunits for YNAB API
const userInput = 25.5;
const milliunits = amountToMilliunits(userInput); // 25500

// YNAB API returns 25500 milliunits → Convert to dollars for display
const apiResponse = 25500;
const dollars = milliunitsToAmount(apiResponse); // 25.5
```

**Why CRITICAL**: All YNAB API calls require milliunits. Missing conversion means amounts are 1000x wrong.

**What Breaks**:
- Sending dollars to API → amounts are 1000x too small (e.g., $25.50 becomes $0.02550)
- Not converting API response → amounts are 1000x too large (e.g., 25500 milliunits displayed as $25,500.00)
- Rounding errors → transactions don't balance

**Testing**:

```typescript
describe('amountToMilliunits', () => {
  it('should convert dollars to milliunits', () => {
    expect(amountToMilliunits(25.5)).toBe(25500);
    expect(amountToMilliunits(0.01)).toBe(10); // 1 cent
    expect(amountToMilliunits(-50.25)).toBe(-50250); // Negative (credit)
  });

  it('should round to nearest milliunit', () => {
    expect(amountToMilliunits(25.5555)).toBe(25556); // Rounds up
    expect(amountToMilliunits(25.5554)).toBe(25555); // Rounds down
  });
});
```

### 2. Date Formatting and Validation

YNAB requires ISO date format: `YYYY-MM-DD`

```typescript
// dateUtils.ts
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]; // "2025-01-31"
}

export function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

export function parseDate(dateString: string): Date | null {
  if (!isValidDate(dateString)) return null;
  return new Date(dateString);
}
```

**Why Important**: YNAB API rejects non-ISO dates. Date parsing errors cause transaction failures.

**What Breaks**:
- Non-ISO format (e.g., "01/31/2025") → API rejection
- Invalid dates (e.g., "2025-02-30") → API errors
- Timezone issues → wrong date stored

### 3. Amount Validation

Validate monetary amounts before API calls:

```typescript
// amountUtils.ts
export function validateAmount(amount: number): boolean {
  // Check for finite number
  if (!Number.isFinite(amount)) return false;

  // Check for reasonable range (±$1 billion in milliunits)
  const maxMilliunits = 1_000_000_000_000; // $1 billion
  if (Math.abs(amount) > maxMilliunits) return false;

  return true;
}

export function isValidMilliunits(milliunits: number): boolean {
  // Must be integer (no fractions of milliunits)
  return Number.isInteger(milliunits) && validateAmount(milliunits);
}
```

**Why Important**: Prevents invalid amounts from reaching API, catches data corruption early.

**What Breaks**:
- NaN amounts → API errors
- Infinity amounts → API errors
- Non-integer milliunits → precision loss

### 4. Pure Functions (No Side Effects)

All utility functions are **pure**: same input → same output, no side effects.

```typescript
// GOOD: Pure function
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// BAD: Impure function (mutates input)
export function formatDateImpure(date: Date): string {
  date.setHours(0, 0, 0, 0); // Mutation!
  return date.toISOString().split('T')[0];
}

// BAD: Impure function (depends on external state)
let counter = 0;
export function getNextIdImpure(): number {
  return ++counter; // Side effect!
}
```

**Why Important**: Pure functions are:
- Easy to test (no mocks needed)
- Easy to reason about (predictable)
- Safe to parallelize (no shared state)

**What Breaks**: Impure utilities → unpredictable behavior, test failures, race conditions.

### 5. Error Classes with Context

Custom error classes provide structured error information:

```typescript
// baseError.ts
export class BaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// errors.ts
export class ValidationError extends BaseError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
  }
}

// Usage
throw new ValidationError('Invalid amount', {
  amount: userInput,
  expectedRange: '0-1000000',
});
```

**Why Important**: Structured errors enable better error handling, logging, and debugging.

**What Breaks**: Generic errors → poor error messages, no context, hard to debug.

## Common Development Tasks

### Adding a New Money Utility

When adding money-related utilities:

1. **Ensure purity** - No side effects
2. **Handle edge cases** - NaN, Infinity, negative numbers
3. **Use existing utilities** - Build on `amountToMilliunits`/`milliunitsToAmount`
4. **Add comprehensive tests** - Edge cases, rounding, precision

Example:

```typescript
export function addAmounts(amount1: number, amount2: number): number {
  // Convert to milliunits for precision
  const milliunits1 = amountToMilliunits(amount1);
  const milliunits2 = amountToMilliunits(amount2);

  // Add milliunits (integers, no precision loss)
  const totalMilliunits = milliunits1 + milliunits2;

  // Convert back to dollars
  return milliunitsToAmount(totalMilliunits);
}
```

### Adding a New Date Utility

When adding date-related utilities:

1. **Use ISO format** - `YYYY-MM-DD`
2. **Use `Date.UTC()`** for timezone safety
3. **Validate inputs** - Use `isValidDate()`
4. **Add tests** - Edge cases, timezone boundaries, leap years

Example:

```typescript
export function addDays(dateString: string, days: number): string {
  const date = parseDate(dateString);
  if (!date) throw new ValidationError('Invalid date', { dateString });

  // Use UTC to avoid timezone issues
  const utcDate = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  utcDate.setUTCDate(utcDate.getUTCDate() + days);

  return formatDate(utcDate);
}
```

### Adding a New Error Class

When adding error types:

1. **Extend BaseError** - Consistent structure
2. **Provide error code** - Machine-readable identifier
3. **Include context** - Relevant debugging information
4. **Export from types** - Make available to entire codebase

Example:

```typescript
export class AmountOutOfRangeError extends BaseError {
  constructor(amount: number, min: number, max: number) {
    super(
      `Amount ${amount} is out of range [${min}, ${max}]`,
      'AMOUNT_OUT_OF_RANGE',
      { amount, min, max }
    );
  }
}
```

## Testing Approach

All utilities should have comprehensive unit tests:

### Money Conversion Tests

```typescript
describe('amountToMilliunits', () => {
  it('should convert positive amounts', () => {
    expect(amountToMilliunits(25.5)).toBe(25500);
    expect(amountToMilliunits(0.01)).toBe(10);
  });

  it('should convert negative amounts', () => {
    expect(amountToMilliunits(-25.5)).toBe(-25500);
  });

  it('should handle zero', () => {
    expect(amountToMilliunits(0)).toBe(0);
  });

  it('should round to nearest milliunit', () => {
    expect(amountToMilliunits(25.5555)).toBe(25556);
  });
});

describe('milliunitsToAmount', () => {
  it('should convert back to dollars', () => {
    expect(milliunitsToAmount(25500)).toBe(25.5);
    expect(milliunitsToAmount(10)).toBe(0.01);
  });

  it('should be reversible', () => {
    const dollars = 25.5;
    const roundTrip = milliunitsToAmount(amountToMilliunits(dollars));
    expect(roundTrip).toBe(dollars);
  });
});
```

### Date Utility Tests

```typescript
describe('formatDate', () => {
  it('should format date as ISO string', () => {
    const date = new Date('2025-01-31T12:00:00Z');
    expect(formatDate(date)).toBe('2025-01-31');
  });
});

describe('isValidDate', () => {
  it('should accept valid ISO dates', () => {
    expect(isValidDate('2025-01-31')).toBe(true);
  });

  it('should reject invalid dates', () => {
    expect(isValidDate('2025-02-30')).toBe(false); // Feb 30 doesn't exist
    expect(isValidDate('01/31/2025')).toBe(false); // Wrong format
  });
});
```

## What Will Break If Violated

### 1. Dollar Amounts to YNAB API

**Problem**: Sending dollar amounts directly to YNAB API instead of converting to milliunits.

**Impact**: Amounts are 1000x too small. User enters $25.50, YNAB records $0.02550.

**Fix**: Always convert dollars to milliunits:

```typescript
// BAD
await ynabAPI.createTransaction({
  amount: 25.5, // Wrong! This is dollars, not milliunits
});

// GOOD
await ynabAPI.createTransaction({
  amount: amountToMilliunits(25.5), // 25500 milliunits
});
```

### 2. Not Converting API Response

**Problem**: Displaying YNAB API milliunits as dollars without conversion.

**Impact**: Amounts are 1000x too large. API returns 25500, displayed as $25,500.00.

**Fix**: Always convert milliunits to dollars for display:

```typescript
// BAD
const displayAmount = transaction.amount; // 25500 milliunits displayed as $25,500.00

// GOOD
const displayAmount = milliunitsToAmount(transaction.amount); // 25.5 dollars
```

### 3. Impure Utility Functions

**Problem**: Utility functions with side effects or external dependencies.

**Impact**: Unpredictable behavior, test failures, race conditions, hard to reason about.

**Fix**: Keep utilities pure:

```typescript
// BAD (mutates input)
export function normalizeDate(date: Date): Date {
  date.setHours(0, 0, 0, 0); // Mutation!
  return date;
}

// GOOD (pure, no mutation)
export function normalizeDate(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}
```

### 4. Non-ISO Date Format

**Problem**: Using non-ISO date formats (e.g., "01/31/2025").

**Impact**: YNAB API rejection, transaction failures.

**Fix**: Always use ISO format (`YYYY-MM-DD`):

```typescript
// BAD
const date = '01/31/2025';

// GOOD
const date = '2025-01-31';
```

### 5. Missing Amount Validation

**Problem**: Not validating amounts before API calls.

**Impact**: NaN, Infinity, or out-of-range amounts reach API → errors.

**Fix**: Validate before API calls:

```typescript
// BAD
await createTransaction({ amount: userInput });

// GOOD
if (!validateAmount(userInput)) {
  throw new ValidationError('Invalid amount', { amount: userInput });
}
await createTransaction({ amount: amountToMilliunits(userInput) });
```

### 6. Timezone Issues in Date Handling

**Problem**: Using local time instead of UTC for date comparisons.

**Impact**: Dates on timezone boundaries incorrectly handled.

**Fix**: Always use `Date.UTC()` for date comparisons:

```typescript
// BAD (local time, timezone-dependent)
const time1 = new Date(date1).getTime();
const time2 = new Date(date2).getTime();

// GOOD (UTC, timezone-safe)
const time1 = Date.UTC(
  date1.getFullYear(),
  date1.getMonth(),
  date1.getDate()
);
const time2 = Date.UTC(
  date2.getFullYear(),
  date2.getMonth(),
  date2.getDate()
);
```

## Best Practices

1. **Pure Functions Only** - No side effects, no external dependencies
2. **Comprehensive Tests** - Cover edge cases, boundary conditions
3. **Type Safety** - Use TypeScript types, avoid `any`
4. **Input Validation** - Validate before processing
5. **Error Context** - Provide debugging information in errors
6. **Documentation** - JSDoc comments for public functions

## Integration Points

### With Tools (`src/tools/`)

- **Money Conversion**: All transaction tools use `amountToMilliunits`/`milliunitsToAmount`
- **Date Formatting**: All date fields use `formatDate`
- **Validation**: Input validation before API calls

### With Server (`src/server/`)

- **Error Classes**: Used by errorHandler for consistent responses
- **Validation**: Used by security middleware

### With Types (`src/types/`)

- **Error Classes**: Defined in utils, exported from types
- **Type Definitions**: Utility return types

## Performance Considerations

Utilities are called frequently, so performance matters:

1. **Avoid Unnecessary Allocations** - Reuse objects when safe
2. **Optimize Hot Paths** - Profile money conversion, date formatting
3. **Memoization** - Cache expensive computations (if pure)
4. **Avoid Regex in Hot Paths** - Pre-compile regular expressions

## Related Documentation

- [Root CLAUDE.md](../../CLAUDE.md) - Project overview
- [Tools CLAUDE.md](../tools/CLAUDE.md) - Tool implementation using these utilities
- [Types CLAUDE.md](../types/CLAUDE.md) - Type definitions
- [Server CLAUDE.md](../server/CLAUDE.md) - Server components
