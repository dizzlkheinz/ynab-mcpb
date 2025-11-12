# CSV Parser Documentation

## Overview

The CSV parser (`src/tools/compareTransactions/parser.ts`) provides robust parsing of bank statement CSV files for comparison with YNAB transactions. It handles various CSV formats, date formats, amount representations, and encoding issues.

## Amount Parsing

### The `amountToMilliunits` Function

**Location:** `src/tools/compareTransactions/parser.ts:49-65`

The `amountToMilliunits` function converts dollar amount strings from CSV files into YNAB's internal milliunit format (1 dollar = 1000 milliunits).

#### Key Features

1. **Currency Symbol Removal**: Strips `$`, commas, and whitespace
2. **Parentheses Notation**: Handles negative amounts in accounting format `(25.50)` → `-25500` milliunits
3. **Explicit Signs**: Processes `+` and `-` prefixes
4. **Validation**: Ensures parsed values are finite numbers

#### Implementation

```typescript
export function amountToMilliunits(amountStr: string): Milli {
  const cleaned = amountStr.replace(/[$,\s]/g, '').trim();
  let s = cleaned,
    neg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);

  const n = Number(s);
  if (isNaN(n) || !isFinite(n)) {
    throw new Error(`Invalid amount value: "${amountStr}" (cleaned: "${s}")`);
  }

  return toMilli(neg ? -n : n);
}
```

#### Example Conversions

| Input String | Cleaned | Parsed Number | Milliunits |
|--------------|---------|---------------|------------|
| `"$25.50"`   | `"25.50"` | `25.50` | `25500` |
| `"1,234.56"` | `"1234.56"` | `1234.56` | `1234560` |
| `"(42.00)"`  | `"42.00"` | `42.00` (negated) | `-42000` |
| `"+100.00"`  | `"100.00"` | `100.00` | `100000` |
| `"-75.25"`   | `"-75.25"` | `-75.25` | `-75250` |
| `" $ 3.14 "` | `"3.14"` | `3.14` | `3140` |

### Integration with CSV Parsing

The `parseBankCSV` function uses `amountToMilliunits` to convert amount strings from CSV rows:

```typescript
const amount: Milli;
try {
  amount = amountToMilliunits(rawAmount);
} catch (error) {
  if (options.debug) {
    console.warn(`Skipping row ${rowNumber}: ${error.message}`);
  }
  continue; // Skip invalid rows
}
```

**Key Points:**
- Invalid amounts cause the row to be skipped (with optional debug logging)
- Errors include both the original string and cleaned value for debugging
- The function never silently coerces invalid data to zero

## CSV Format Detection

### Auto-Detection (`autoDetectCSVFormat`)

The parser automatically detects:
- **Delimiter**: `,`, `;`, `\t`, `|`
- **Headers**: Presence/absence and column names
- **Date Format**: `MM/DD/YYYY`, `YYYY-MM-DD`, `MMM dd, yyyy`, etc.
- **Amount Columns**: Single `Amount` column vs separate `Debit`/`Credit` columns

> ℹ️ When `reconcile_account` (v2) consumes a CSV, the normalized detection result is echoed back in the structured response under `csv_format`, alongside the `schema_url` referencing the master-branch schema.

### Supported CSV Formats

#### Standard Format (Single Amount Column)

```csv
Date,Amount,Description
09/18/2025,$25.50,Coffee Shop
09/19/2025,(42.00),Grocery Store
```

#### Debit/Credit Format

```csv
Date,Description,Debit,Credit
09/18/2025,Coffee Shop,25.50,
09/19/2025,Paycheck Deposit,,1500.00
```

**Note:** Debits are automatically negated, credits remain positive.

#### No-Header Format

```csv
09/18/2025,25.50,Coffee Shop
09/19/2025,-42.00,Grocery Store
```

Uses column indices (0=date, 1=amount, 2=description by default).

### Date Format Support

Supported formats with examples:
- `MM/DD/YYYY` → `09/18/2025`
- `M/D/YYYY` → `9/18/2025`
- `YYYY-MM-DD` → `2025-09-18`
- `MM-DD-YYYY` → `09-18-2025`
- `MMM dd, yyyy` → `Sep 18, 2025`
- `MMM d, yyyy` → `Sep 18, 2025`

**Note:** Dates with commas (e.g., `Sep 18, 2025`) are automatically quoted during preprocessing to prevent delimiter conflicts.

## Reconciliation Integration

### Amount Normalization in `reconciliation/analyzer.ts`

The reconciliation analyzer includes a `normalizeAmount` function that handles different amount representations from the CSV parser:

```typescript
function normalizeAmount(record: Record<string, unknown>): number {
  const raw = record['amount'];

  if (typeof raw === 'number') {
    // Check if this is a parser output with milliunits
    if (record['date'] instanceof Date || 'raw_amount' in record || 'raw_date' in record) {
      return Math.round(raw) / 1000; // Convert milliunits to dollars
    }
    return raw; // Already in dollars
  }

  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[$,\s]/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
```

**Key Behavior:**
- **Milliunit Detection**: If the record has `date` as Date object or contains `raw_amount`/`raw_date` fields, the amount is assumed to be in milliunits and is converted to dollars
- **String Parsing**: Handles dollar amounts as strings by removing currency symbols and commas
- **Fallback**: Returns 0 for invalid or missing amounts

### Why Two Parsing Paths?

1. **CSV Parser Path** (`parseBankCSV`):
   - Converts string amounts → milliunits
   - Returns `BankTransaction` objects with `amount` in milliunits
   - Used by `compareTransactions` tool

2. **Reconciliation Path** (`normalizeAmount`):
   - Handles various amount formats from different sources
   - Converts milliunits back to dollars for matching logic
   - Provides compatibility layer for legacy data formats

## Error Handling

### Invalid Amount Handling

```typescript
try {
  amount = amountToMilliunits(rawAmount);
} catch (error) {
  // Row is skipped with optional debug warning
  if (options.debug) {
    console.warn(`Skipping row ${rowNumber}: ${error.message}`);
  }
  continue;
}
```

**Common Errors:**
- Empty amount field → Row skipped
- Non-numeric value (e.g., `"N/A"`) → Row skipped
- Infinity or NaN → Row skipped

### Debugging

Enable debug mode to see detailed error messages:

```typescript
const transactions = parseBankCSV(csvContent, format, { debug: true });
```

This logs:
- Rows with missing date/amount
- Rows with invalid amounts (with original and cleaned values)
- General parsing errors with row numbers

## Testing

### Test Coverage

The amount parsing functionality is thoroughly tested in:
- `src/tools/__tests__/compareTransactions/parser.test.ts`

**Coverage includes:**
- ✅ Positive/negative amounts
- ✅ Currency symbols (`$`)
- ✅ Thousand separators (`,`)
- ✅ Parentheses notation `(25.50)`
- ✅ Explicit signs (`+`, `-`)
- ✅ Whitespace handling
- ✅ Large amounts (millions)
- ✅ Zero amounts
- ✅ Invalid inputs (error handling)

### Example Test Cases

```typescript
expect(amountToMilliunits('$25.50')).toBe(25500);
expect(amountToMilliunits('(42.00)')).toBe(-42000);
expect(amountToMilliunits('1,234.56')).toBe(1234560);
expect(amountToMilliunits('+100')).toBe(100000);
expect(() => amountToMilliunits('invalid')).toThrow();
```

## Migration Notes

### Breaking Changes in v0.9.0

- **Amount Parsing Fix**: The `amountToMilliunits` function now correctly handles dollar amounts by converting them to milliunits using the `toMilli` utility function.
- **TypeScript Strictness**: Reconciliation analyzer now uses bracket notation for index signatures to comply with `exactOptionalPropertyTypes` TypeScript setting.

### Backward Compatibility

- CSV format detection remains unchanged
- Existing CSV files continue to work without modification
- YNAB API integration unchanged (still uses milliunits internally)

## Best Practices

### When Importing CSV Files

1. **Use Auto-Detection**: Let the parser detect format automatically when possible
2. **Enable Debug Mode**: During testing or troubleshooting
3. **Validate Data**: Check that parsed amounts match expected values
4. **Handle Errors**: Be prepared for rows to be skipped due to invalid data

### Custom CSV Formats

If auto-detection fails, specify format explicitly:

```typescript
const format: CSVFormat = {
  date_column: 'Transaction Date',
  amount_column: 'Amount',
  description_column: 'Memo',
  date_format: 'MM/DD/YYYY',
  has_header: true,
  delimiter: ',',
};

const transactions = parseBankCSV(csvContent, format);
```

## Performance

- **Efficient Parsing**: Uses `csv-parse` library with streaming support
- **Lazy Evaluation**: Only processes valid rows
- **Memory Footprint**: Minimal (processes line by line)
- **Large Files**: Tested with 1000+ row CSVs without issues

## Related Documentation

- [API.md](./API.md) - Complete tool API reference
- [EXAMPLES.md](./EXAMPLES.md) - Usage examples
- [TESTING.md](./TESTING.md) - Testing guidelines
- [tool-module-decomposition.md](./ADR/tool-module-decomposition.md) - Architecture decisions

## Troubleshooting

### Issue: Amounts are off by 1000x

**Cause**: Confusion between milliunits and dollars

**Solution**:
- CSV parser returns milliunits (1 dollar = 1000 milliunits)
- Use `milliunitsToAmount()` from `utils/money.ts` to convert back to dollars

### Issue: Negative amounts not recognized

**Cause**: Bank uses unusual notation

**Solution**:
- Check if amounts use parentheses `(25.50)` → supported
- Check if amounts use suffix notation `25.50-` → not supported (file an issue)

### Issue: Parser skips all rows

**Cause**: Format detection failure or all rows invalid

**Solution**:
1. Enable debug mode: `{ debug: true }`
2. Check console warnings for specific errors
3. Manually specify CSV format if auto-detection fails
4. Verify CSV file encoding (should be UTF-8)

### Issue: Date parsing errors

**Cause**: Unsupported date format

**Solution**:
- Check supported date formats above
- Use `detectDateFormat()` to see what format was detected
- Manually specify `date_format` in CSV format configuration

## Future Enhancements

Potential improvements being considered:
- [ ] Support for suffix negative notation (`25.50-`)
- [ ] Currency conversion (multi-currency CSVs)
- [ ] Custom amount transformation hooks
- [ ] Streaming API for very large files
- [ ] CSV validation before parsing
