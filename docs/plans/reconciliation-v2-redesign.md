# Reconciliation Tool v2 - Complete Redesign

## Executive Summary

The current reconciliation tool has fundamental architectural problems that prevent it from working reliably. This document outlines a complete redesign based on:
1. Analysis of the existing codebase and its failure modes
2. Research into best-in-class libraries for CSV parsing, fuzzy matching, and date handling
3. Learnings from production reconciliation engines (Midday.ai's open-source implementation)

**Target Outcome:** A reconciliation tool that achieves 90%+ auto-match accuracy for Canadian bank statements against YNAB transactions.

---

## Document Role & Source of Truth

> **⚠️ This is a design document, not a specification.**
>
> - **Source of truth:** The actual TypeScript implementation in `src/tools/reconciliation/` is authoritative
> - **Code blocks below:** Illustrative pseudo-code showing intent and interfaces—not copy-paste ready
> - **Drift expectation:** Implementation details will evolve; this doc captures architectural decisions and rationale
> - **Update policy:** Major architectural changes should be reflected here; minor implementation tweaks need not be

When in doubt, read the actual source files:
- `src/tools/reconciliation/types.ts` - Canonical types
- `src/tools/reconciliation/matcher.ts` - Matching algorithm (V2 with legacy compatibility)
- `src/tools/reconciliation/analyzer.ts` - Orchestration
- `src/tools/compareTransactions/parser.ts` - Legacy CSV parsing (to be replaced)

---

## Part 1: Critical Problems in Current Implementation

### Problem 1: Two Incompatible `BankTransaction` Types

There are two completely different interfaces with the same name:

**`src/tools/compareTransactions/types.ts`:**
```typescript
interface BankTransaction {
  date: Date;              // JavaScript Date object
  amount: number;          // In MILLIUNITS (1000 = $1.00)
  description: string;
  raw_amount: string;
  raw_date: string;
  row_number: number;
}
```

**`src/tools/reconciliation/types.ts`:**
```typescript
interface BankTransaction {
  id: string;
  date: string;            // YYYY-MM-DD string
  amount: number;          // In DOLLARS (1.00 = $1.00)
  payee: string;
  memo?: string;
  original_csv_row: number;
}
```

The analyzer imports from the parser (compareTransactions) but expects reconciliation types. A fragile `normalizeAmount()` function tries to detect which format based on whether `date instanceof Date` - this is the root cause of most matching failures.

### Problem 2: Tests Mock the Parser with Wrong Types

```typescript
// In analyzer.test.ts - THESE ARE WRONG
vi.mocked(parser.parseBankCSV).mockReturnValue({
  transactions: [
    { date: '2025-10-15', amount: -45.23, payee: 'Shell Gas' }  // String date, dollars
  ]
});

// But real parser returns:
{ date: new Date('2025-10-15'), amount: -45230, description: 'Shell Gas' }  // Date object, milliunits
```

Tests pass but real code path fails.

### Problem 3: Rigid Confidence Scoring

Current weights:
- Amount match: 40% (REQUIRED - 0 if no match)
- Date match: 40% (within 2 days default)
- Payee match: 20%

Problems:
1. **2-day date tolerance too tight** - banks post 3-7 days after transaction
2. **Losing 40% for date mismatch is catastrophic** - a perfect amount + payee match with date outside tolerance only scores 60%
3. **Payee only worth 20%** - can't compensate for date issues
4. **Auto-match threshold 90%** - nearly impossible to reach without all three matching

### Problem 4: Primitive Fuzzy Matching

Current payee matching uses hand-rolled Levenshtein distance. This fails on real-world bank data:
- "AMZN MKTP CA*123456" vs "Amazon" → Low score
- "SQ *COFFEE SHOP TORONTO" vs "Square Coffee" → Low score
- "PAYPAL *NETFLIX" vs "Netflix" → Low score

### Problem 5: CSV Parser Fragility

The `autoDetectCSVFormat()` function:
- Only looks at first 3 rows
- Has limited date format support
- Fails on European number formats (1.234,56)
- No presets for known Canadian bank formats

---

## Part 1b: Accuracy Target & Evaluation Plan

The "90%+ auto-match accuracy" target requires operationalisation:

### Definition of Success

| Metric | Definition | Target |
|--------|------------|--------|
| **Auto-match precision** | % of `confidence: 'high'` matches that are correct | ≥95% |
| **Auto-match recall** | % of true matches captured at `confidence: 'high'` | ≥90% |
| **Overall match rate** | % of bank transactions with any match (`high` + `medium`) | ≥95% |
| **False positive rate** | % of auto-matches that are wrong | ≤5% |

### Evaluation Dataset Construction

1. **Source CSVs:** Collect 10+ real statement exports per major Canadian bank (TD, RBC, Scotiabank, Tangerine, Wealthsimple, CIBC, BMO)
2. **Ground truth labeling:** Manually match each bank transaction to its YNAB counterpart (or mark as "new")
3. **Edge case coverage:** Ensure dataset includes:
   - Recurring charges (same amount, different dates)
   - Similar merchants (Starbucks #1234 vs #5678)
   - Split transactions
   - Refunds and reversals
   - Multi-day posting delays (3-7 days)
4. **Storage:** `test-exports/csv/labeled/` with `.csv` + `.labels.json` pairs

### V1 vs V2 Comparison Methodology

```bash
# Run both implementations on the same dataset
npm run benchmark:reconciliation -- --version=v1 --dataset=test-exports/csv/labeled/
npm run benchmark:reconciliation -- --version=v2 --dataset=test-exports/csv/labeled/

# Compare results
npm run benchmark:compare -- v1-results.json v2-results.json
```

Output metrics:
- Confusion matrix (TP/FP/TN/FN per confidence tier)
- Precision/recall curves at different thresholds
- Per-bank breakdown
- Failure case analysis (which transaction types fail most?)

### Acceptance Criteria

V2 is ready for release when:
1. Auto-match precision ≥95% across all banks in the test dataset
2. Auto-match recall ≥90% (we catch most true matches)
3. No regression on any bank compared to v1
4. P95 latency <2s for 500-transaction CSVs

---

## Part 2: Recommended Libraries

### CSV Parsing: PapaParse

**Why:** Auto-detects delimiters, handles malformed CSVs gracefully, dynamic typing, excellent edge case handling.

```bash
npm install papaparse @types/papaparse
```

**Key Features:**
- `delimiter: ""` → auto-detect
- `dynamicTyping: true` → auto-convert numbers
- `skipEmptyLines: true`
- `transformHeader` → normalize column names
- Detailed error reporting per row

**Usage:**
```typescript
import Papa from 'papaparse';

const result = Papa.parse(csvContent, {
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
  transformHeader: (h) => h.toLowerCase().trim(),
});

// result.data = parsed rows
// result.errors = array of {row, message} for each parsing error
// result.meta = {delimiter, fields, truncated}
```

### Fuzzy String Matching: fuzzball

**Why:** Port of Python's TheFuzz (fuzzywuzzy), battle-tested algorithms for transaction matching, includes token-based matching crucial for merchant names.

```bash
npm install fuzzball
```

**Key Algorithms:**
```typescript
import fuzz from 'fuzzball';

// Basic ratio - simple Levenshtein
fuzz.ratio("Shell Gas", "SHELL GAS STATION");  // 73

// Token Set Ratio - handles word order, duplicates
fuzz.token_set_ratio("AMZN MKTP CA*123", "Amazon Marketplace");  // 90+

// Token Sort Ratio - alphabetizes then compares
fuzz.token_sort_ratio("fuzzy wuzzy", "wuzzy fuzzy");  // 100

// Partial Ratio - best substring match
fuzz.partial_ratio("Netflix", "PAYPAL *NETFLIX INC");  // 100

// WRatio - weighted combination of above
fuzz.WRatio("SQ *COFFEE SHOP", "Square Coffee Shop");  // ~90
```

**Recommendation:** Use `token_set_ratio` for payee matching as it handles the common case of bank merchant names having extra tokens (location codes, transaction IDs, etc.)

### Date Parsing: chrono-node

**Why:** Parses natural language dates, handles many formats automatically, battle-tested.

```bash
npm install chrono-node
```

**Usage:**
```typescript
import * as chrono from 'chrono-node';

chrono.parseDate("Sep 18, 2025");     // Date object
chrono.parseDate("18/09/2025");       // Date object  
chrono.parseDate("2025-09-18");       // Date object
chrono.parseDate("September 18th");   // Date object (relative to today)
```

**Fallback:** Use with dayjs for formatting:
```bash
npm install dayjs
```

### Optional: Vector Embeddings for Semantic Matching

For future enhancement, consider pgvector with OpenAI/Google embeddings for semantic merchant matching. The Midday.ai approach uses 768-dimensional vectors but this is overkill for v2 - fuzzball's token_set_ratio should get us to 90%+ accuracy.

---

## Part 3: Architectural Redesign

### 3.1 Unified Transaction Types

**File:** `src/types/reconciliation.ts`

> **Design Note:** These types are intentionally decoupled from the YNAB SDK. The `NormalizedYNABTransaction` interface is SDK-agnostic; a thin adapter in `src/tools/reconciliation/ynabAdapter.ts` handles the conversion from `ynab.TransactionDetail`.

> **Critical Decision: All amounts are in MILLIUNITS (integers).**
> - 1000 milliunits = $1.00
> - This matches YNAB's native format
> - Eliminates floating-point precision issues entirely
> - Enables exact integer comparison: `a === b`
> - Conversion from CSV floats happens ONCE at the parser boundary

```typescript
/**
 * Canonical bank transaction type used throughout reconciliation.
 * 
 * AMOUNTS ARE IN MILLIUNITS (integers, 1000 = $1.00).
 * This matches YNAB's native format and allows exact integer comparison.
 */
export interface BankTransaction {
  /** UUID generated for tracking */
  id: string;
  /** ISO date string YYYY-MM-DD */
  date: string;
  /** Amount in MILLIUNITS (negative = outflow, positive = inflow) */
  amount: number;
  /** Merchant/payee name from CSV */
  payee: string;
  /** Optional memo/description */
  memo?: string;
  /** Original CSV row number (1-indexed, after header) */
  sourceRow: number;
  /** Raw values from CSV for debugging */
  raw: {
    date: string;
    amount: string;
    description: string;
  };
  /** Parser warnings (e.g., ambiguous debit/credit) */
  warnings?: string[];
}

/**
 * YNAB transaction normalized for comparison.
 * 
 * This interface is intentionally SDK-agnostic. Use the adapter
 * function in ynabAdapter.ts to convert from ynab.TransactionDetail.
 * 
 * AMOUNTS ARE IN MILLIUNITS - same as YNAB API native format.
 * No conversion needed from the SDK.
 */
export interface NormalizedYNABTransaction {
  id: string;
  date: string;  // YYYY-MM-DD
  /** Amount in MILLIUNITS (same as YNAB API) */
  amount: number;
  payee: string | null;
  memo: string | null;
  categoryName: string | null;
  cleared: 'cleared' | 'uncleared' | 'reconciled';
  approved: boolean;
}
```

**File:** `src/tools/reconciliation/ynabAdapter.ts`

```typescript
import type * as ynab from 'ynab';
import type { NormalizedYNABTransaction } from '../../types/reconciliation.js';

/**
 * Convert YNAB SDK transaction to normalized format for matching.
 * 
 * This adapter keeps the YNAB SDK dependency isolated from the
 * reconciliation core logic.
 * 
 * NOTE: Amount stays in milliunits - no conversion needed since
 * YNAB API already uses milliunits natively.
 */
export function normalizeYNABTransaction(
  txn: ynab.TransactionDetail
): NormalizedYNABTransaction {
  return {
    id: txn.id,
    date: txn.date,
    amount: txn.amount,  // Already in milliunits - no conversion!
    payee: txn.payee_name ?? null,
    memo: txn.memo ?? null,
    categoryName: txn.category_name ?? null,
    cleared: txn.cleared,
    approved: txn.approved,
  };
}

/**
 * Batch convert YNAB transactions.
 */
export function normalizeYNABTransactions(
  txns: ynab.TransactionDetail[]
): NormalizedYNABTransaction[] {
  return txns.map(normalizeYNABTransaction);
}
```

### 3.2 New CSV Parser Module

**File:** `src/tools/reconciliation/csvParser.ts`

```typescript
import Papa from 'papaparse';
import * as chrono from 'chrono-node';
import { randomUUID } from 'crypto';
import type { BankTransaction } from '../../types/reconciliation.js';

export interface CSVParseResult {
  transactions: BankTransaction[];
  errors: ParseError[];
  warnings: ParseWarning[];
  meta: {
    detectedDelimiter: string;
    detectedColumns: string[];
    totalRows: number;
    validRows: number;
    skippedRows: number;
  };
}

export interface ParseError {
  row: number;
  field: string;
  message: string;
  rawValue: string;
}

export interface ParseWarning {
  row: number;
  message: string;
}

export interface BankPreset {
  name: string;
  dateColumn: string | string[];
  amountColumn?: string | string[];
  debitColumn?: string;
  creditColumn?: string;
  descriptionColumn: string | string[];
  amountMultiplier?: number;
  /** Expected date format hint: 'YMD', 'MDY', 'DMY' */
  dateFormat?: 'YMD' | 'MDY' | 'DMY';
}

// Presets for Canadian banks
export const BANK_PRESETS: Record<string, BankPreset> = {
  'td': {
    name: 'TD Canada Trust',
    dateColumn: ['Date', 'Transaction Date', 'Posted Date'],
    amountColumn: ['Amount', 'CAD$'],
    descriptionColumn: ['Description', 'Transaction Description', 'Merchant'],
    dateFormat: 'MDY',  // TD typically uses MM/DD/YYYY
  },
  'rbc': {
    name: 'RBC Royal Bank',
    dateColumn: ['Transaction Date', 'Date'],
    debitColumn: 'Debit',
    creditColumn: 'Credit',
    descriptionColumn: ['Description 1', 'Description', 'Transaction'],
    dateFormat: 'YMD',  // RBC typically uses YYYY-MM-DD
  },
  'scotiabank': {
    name: 'Scotiabank',
    dateColumn: ['Date', 'Transaction Date'],
    amountColumn: ['Amount'],
    descriptionColumn: ['Description', 'Transaction Details'],
    dateFormat: 'DMY',  // Scotiabank often uses DD/MM/YYYY
  },
  'wealthsimple': {
    name: 'Wealthsimple',
    dateColumn: ['Date'],
    amountColumn: ['Amount'],
    descriptionColumn: ['Description', 'Payee'],
    amountMultiplier: 1,
    dateFormat: 'YMD',
  },
  'tangerine': {
    name: 'Tangerine',
    dateColumn: ['Date', 'Transaction date'],
    amountColumn: ['Amount'],
    descriptionColumn: ['Name', 'Transaction name', 'Memo'],
    dateFormat: 'MDY',
  },
};

export interface ParseCSVOptions {
  /** Bank preset key (e.g., 'td', 'rbc') */
  preset?: string;
  /** Multiply all amounts by -1 */
  invertAmounts?: boolean;
}

/**
 * Parse a bank CSV file into BankTransaction objects.
 * 
 * IMPORTANT: Amounts are converted to MILLIUNITS (integers) at this boundary.
 * This is the ONLY place where float-to-milliunit conversion happens.
 */
export function parseCSV(
  content: string,
  options: ParseCSVOptions = {}
): CSVParseResult {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  
  // Parse with PapaParse
  const parsed = Papa.parse(content, {
    header: true,
    dynamicTyping: false,  // We'll handle type conversion ourselves
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  
  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      errors.push({
        row: err.row ?? 0,
        field: 'csv',
        message: err.message,
        rawValue: '',
      });
    }
  }
  
  const columns = parsed.meta.fields ?? [];
  const preset = options.preset ? BANK_PRESETS[options.preset] : detectPreset(columns);
  
  // Find actual column names
  const dateCol = findColumn(columns, preset?.dateColumn ?? ['Date', 'Transaction Date', 'Posted Date']);
  const descCol = findColumn(columns, preset?.descriptionColumn ?? ['Description', 'Payee', 'Merchant', 'Name']);
  
  let amountCol: string | null = null;
  let debitCol: string | null = null;
  let creditCol: string | null = null;
  
  if (preset?.debitColumn && preset?.creditColumn) {
    debitCol = findColumn(columns, [preset.debitColumn]);
    creditCol = findColumn(columns, [preset.creditColumn]);
  } else {
    amountCol = findColumn(columns, preset?.amountColumn ?? ['Amount', 'CAD$', 'Value']);
  }
  
  if (!dateCol) {
    errors.push({ row: 0, field: 'date', message: 'Could not identify date column', rawValue: columns.join(', ') });
  }
  if (!amountCol && !debitCol) {
    errors.push({ row: 0, field: 'amount', message: 'Could not identify amount column', rawValue: columns.join(', ') });
  }
  
  const transactions: BankTransaction[] = [];
  const rows = parsed.data as Record<string, string>[];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;  // 1-indexed, after header
    const rowWarnings: string[] = [];
    
    // Parse date with priority: explicit format > ISO > chrono-node fallback
    const rawDate = dateCol ? row[dateCol]?.trim() ?? '' : '';
    const parsedDate = parseDate(rawDate, preset?.dateFormat);
    if (!parsedDate) {
      errors.push({ row: rowNum, field: 'date', message: `Could not parse date: "${rawDate}"`, rawValue: rawDate });
      continue;
    }
    // Use LOCAL date components to avoid timezone shifts
    const dateStr = formatLocalDate(parsedDate);
    
    // Parse amount - convert to MILLIUNITS immediately
    let amountMilliunits: number;
    let rawAmount: string;
    
    if (amountCol) {
      rawAmount = row[amountCol]?.trim() ?? '';
      amountMilliunits = dollarStringToMilliunits(rawAmount);
    } else if (debitCol && creditCol) {
      const debit = row[debitCol]?.trim() ?? '';
      const credit = row[creditCol]?.trim() ?? '';
      rawAmount = debit || credit;
      
      const debitMilliunits = dollarStringToMilliunits(debit);
      const creditMilliunits = dollarStringToMilliunits(credit);
      
      // Warn if both debit and credit have values (ambiguous)
      if (Math.abs(debitMilliunits) > 0 && Math.abs(creditMilliunits) > 0) {
        rowWarnings.push(`Both Debit (${debit}) and Credit (${credit}) have values - using Debit`);
        warnings.push({ row: rowNum, message: rowWarnings[rowWarnings.length - 1] });
      }
      
      if (Math.abs(debitMilliunits) > 0) {
        amountMilliunits = -Math.abs(debitMilliunits);  // Debits are outflows (negative)
      } else if (Math.abs(creditMilliunits) > 0) {
        amountMilliunits = Math.abs(creditMilliunits);  // Credits are inflows (positive)
      } else {
        amountMilliunits = 0;
      }
      
      // Warn if debit column contains negative value (unusual)
      if (debitMilliunits < 0) {
        rowWarnings.push(`Debit column contains negative value (${debit}) - treating as positive debit`);
        warnings.push({ row: rowNum, message: rowWarnings[rowWarnings.length - 1] });
      }
    } else {
      continue;  // Skip row if no amount columns
    }
    
    if (!Number.isFinite(amountMilliunits)) {
      errors.push({ row: rowNum, field: 'amount', message: `Invalid amount: "${rawAmount}"`, rawValue: rawAmount });
      continue;
    }
    
    // Apply amount inversion if needed
    const multiplier = options.invertAmounts ? -1 : (preset?.amountMultiplier ?? 1);
    amountMilliunits *= multiplier;
    
    // Parse description
    const rawDesc = descCol ? row[descCol]?.trim() ?? '' : '';
    
    transactions.push({
      id: randomUUID(),
      date: dateStr,
      amount: amountMilliunits,
      payee: rawDesc || 'Unknown',
      sourceRow: rowNum,
      raw: {
        date: rawDate,
        amount: rawAmount,
        description: rawDesc,
      },
      warnings: rowWarnings.length > 0 ? rowWarnings : undefined,
    });
  }
  
  return {
    transactions,
    errors,
    warnings,
    meta: {
      detectedDelimiter: parsed.meta.delimiter,
      detectedColumns: columns,
      totalRows: rows.length,
      validRows: transactions.length,
      skippedRows: rows.length - transactions.length,
    },
  };
}

/**
 * Parse date with priority:
 * 1. ISO format (YYYY-MM-DD) - unambiguous
 * 2. Explicit format hint from preset
 * 3. chrono-node fallback (may be ambiguous for dates like 02/03/2025)
 */
function parseDate(raw: string, formatHint?: 'YMD' | 'MDY' | 'DMY'): Date | null {
  if (!raw) return null;
  
  // 1. Try ISO format first (unambiguous)
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(parseInt(year!), parseInt(month!) - 1, parseInt(day!));
  }
  
  // 2. Try explicit format hint for ambiguous numeric dates
  const numericMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (numericMatch && formatHint) {
    const [, a, b, c] = numericMatch;
    let year = parseInt(c!);
    if (year < 100) year += 2000;  // 25 -> 2025
    
    let month: number, day: number;
    switch (formatHint) {
      case 'YMD':
        month = parseInt(a!);
        day = parseInt(b!);
        break;
      case 'MDY':  // US format: MM/DD/YYYY
        month = parseInt(a!);
        day = parseInt(b!);
        break;
      case 'DMY':  // European/UK format: DD/MM/YYYY
        day = parseInt(a!);
        month = parseInt(b!);
        break;
    }
    
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }
  
  // 3. Fallback to chrono-node (handles natural language, many formats)
  // Note: chrono defaults to US (MDY) for ambiguous dates like 02/03/2025
  return chrono.parseDate(raw);
}

/**
 * Format Date to YYYY-MM-DD using LOCAL date components.
 * 
 * IMPORTANT: Do NOT use toISOString() as it converts to UTC,
 * which can shift the date if the local time is before midnight UTC.
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function findColumn(available: string[], candidates: string | string[]): string | null {
  const candidateList = Array.isArray(candidates) ? candidates : [candidates];
  
  for (const candidate of candidateList) {
    const lower = candidate.toLowerCase();
    const found = available.find(col => col.toLowerCase() === lower);
    if (found) return found;
  }
  
  // Try partial match
  for (const candidate of candidateList) {
    const lower = candidate.toLowerCase();
    const found = available.find(col => col.toLowerCase().includes(lower));
    if (found) return found;
  }
  
  return null;
}

function detectPreset(columns: string[]): BankPreset | undefined {
  const colSet = new Set(columns.map(c => c.toLowerCase()));
  
  if (colSet.has('description 1') || colSet.has('account type')) {
    return BANK_PRESETS['rbc'];
  }
  if (columns.some(c => c.toLowerCase().includes('cad$'))) {
    return BANK_PRESETS['td'];
  }
  
  return undefined;
}

/**
 * Supported currency symbols:
 *   $ (dollar - USD, CAD, AUD, etc.)
 *   € (euro)
 *   £ (pound)
 *   ¥ (yen/yuan)
 *   
 * Also strips: CAD, USD, EUR, GBP (case-insensitive)
 * 
 * Number formats supported:
 *   - Standard:  1234.56 or 1,234.56
 *   - European:  1.234,56 (detected by pattern)
 *   - Negative:  -123.45 or (123.45)
 * 
 * Returns: Amount in MILLIUNITS (integer, 1000 = $1.00)
 */
const CURRENCY_SYMBOLS = /[$€£¥]/g;
const CURRENCY_CODES = /\b(CAD|USD|EUR|GBP)\b/gi;

function dollarStringToMilliunits(str: string): number {
  if (!str) return 0;
  
  let cleaned = str
    .replace(CURRENCY_SYMBOLS, '')
    .replace(CURRENCY_CODES, '')
    .trim();
  
  // Handle parentheses as negative: (123.45) → -123.45
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  
  // Detect European format: 1.234,56 → 1234.56
  if (/^-?\d{1,3}(\.\d{3})+,\d{2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  
  // Handle thousands separator: 1,234.56 → 1234.56
  if (cleaned.includes('.')) {
    cleaned = cleaned.replace(/,/g, '');
  }
  
  const dollars = parseFloat(cleaned);
  if (!Number.isFinite(dollars)) return 0;
  
  // Convert to milliunits: $1.00 → 1000
  return Math.round(dollars * 1000);
}
```

### 3.3 New Matching Algorithm

**File:** `src/tools/reconciliation/matcher.ts`

```typescript
import fuzz from 'fuzzball';
import type { BankTransaction, NormalizedYNABTransaction } from '../../types/reconciliation.js';

export interface MatchCandidate {
  ynabTransaction: NormalizedYNABTransaction;
  scores: {
    amount: number;      // 0-100
    date: number;        // 0-100
    payee: number;       // 0-100
    combined: number;    // Weighted combination
  };
  matchReasons: string[];
}

export interface MatchResult {
  bankTransaction: BankTransaction;
  bestMatch: MatchCandidate | null;
  candidates: MatchCandidate[];  // Top 3
  confidence: 'high' | 'medium' | 'low' | 'none';
  confidenceScore: number;
}

export interface MatchingConfig {
  weights: {
    amount: number;   // Recommended: 0.50
    date: number;     // Recommended: 0.15
    payee: number;    // Recommended: 0.35
  };
  
  // Tolerances (in MILLIUNITS for amount)
  amountToleranceMilliunits: number;  // Default: 10 (1 cent)
  dateToleranceDays: number;          // Default: 7
  
  // Thresholds
  autoMatchThreshold: number;      // Default: 85
  suggestedMatchThreshold: number; // Default: 60
  minimumCandidateScore: number;   // Default: 40
  
  // Bonuses for perfect matches
  exactAmountBonus: number;        // Default: 10
  exactDateBonus: number;          // Default: 5
  exactPayeeBonus: number;         // Default: 10
}

export const DEFAULT_CONFIG: MatchingConfig = {
  weights: {
    amount: 0.50,
    date: 0.15,
    payee: 0.35,
  },
  amountToleranceMilliunits: 10,  // 1 cent
  dateToleranceDays: 7,
  autoMatchThreshold: 85,
  suggestedMatchThreshold: 60,
  minimumCandidateScore: 40,
  exactAmountBonus: 10,
  exactDateBonus: 5,
  exactPayeeBonus: 10,
};

export function findMatches(
  bankTransactions: BankTransaction[],
  ynabTransactions: NormalizedYNABTransaction[],
  config: MatchingConfig = DEFAULT_CONFIG
): MatchResult[] {
  const results: MatchResult[] = [];
  const usedYnabIds = new Set<string>();
  
  for (const bankTxn of bankTransactions) {
    const candidates = findCandidates(bankTxn, ynabTransactions, usedYnabIds, config);
    
    const bestMatch = candidates.length > 0 ? candidates[0] : null;
    const confidenceScore = bestMatch?.scores.combined ?? 0;
    
    let confidence: MatchResult['confidence'];
    if (confidenceScore >= config.autoMatchThreshold) {
      confidence = 'high';
      if (bestMatch) usedYnabIds.add(bestMatch.ynabTransaction.id);
    } else if (confidenceScore >= config.suggestedMatchThreshold) {
      confidence = 'medium';
    } else if (confidenceScore >= config.minimumCandidateScore) {
      confidence = 'low';
    } else {
      confidence = 'none';
    }
    
    results.push({
      bankTransaction: bankTxn,
      bestMatch,
      candidates: candidates.slice(0, 3),
      confidence,
      confidenceScore,
    });
  }
  
  return results;
}

function findCandidates(
  bankTxn: BankTransaction,
  ynabTransactions: NormalizedYNABTransaction[],
  usedIds: Set<string>,
  config: MatchingConfig
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  
  for (const ynabTxn of ynabTransactions) {
    if (usedIds.has(ynabTxn.id)) continue;
    
    // Sign check - both must be same sign (or both zero)
    const bankSign = Math.sign(bankTxn.amount);
    const ynabSign = Math.sign(ynabTxn.amount);
    if (bankSign !== ynabSign && bankSign !== 0 && ynabSign !== 0) {
      continue;
    }
    
    const scores = calculateScores(bankTxn, ynabTxn, config);
    
    if (scores.combined >= config.minimumCandidateScore) {
      candidates.push({
        ynabTransaction: ynabTxn,
        scores,
        matchReasons: buildMatchReasons(scores, config),
      });
    }
  }
  
  candidates.sort((a, b) => b.scores.combined - a.scores.combined);
  return candidates;
}

function calculateScores(
  bankTxn: BankTransaction,
  ynabTxn: NormalizedYNABTransaction,
  config: MatchingConfig
): MatchCandidate['scores'] {
  // Amount score - now using INTEGER comparison (milliunits)
  const amountDiff = Math.abs(bankTxn.amount - ynabTxn.amount);
  let amountScore: number;
  
  if (amountDiff === 0) {
    // Exact integer match - no floating point issues!
    amountScore = 100;
  } else if (amountDiff <= config.amountToleranceMilliunits) {
    amountScore = 95;
  } else if (amountDiff <= 1000) {  // Within $1
    amountScore = 80 - (amountDiff / 1000 * 20);
  } else {
    amountScore = Math.max(0, 60 - (amountDiff / 1000 * 5));
  }
  
  // Date score
  const bankDate = new Date(bankTxn.date);
  const ynabDate = new Date(ynabTxn.date);
  const daysDiff = Math.abs(bankDate.getTime() - ynabDate.getTime()) / (1000 * 60 * 60 * 24);
  let dateScore: number;
  
  if (daysDiff < 0.5) {
    dateScore = 100;
  } else if (daysDiff <= 1) {
    dateScore = 95;
  } else if (daysDiff <= config.dateToleranceDays) {
    dateScore = 90 - ((daysDiff - 1) * (40 / config.dateToleranceDays));
  } else {
    dateScore = Math.max(0, 50 - ((daysDiff - config.dateToleranceDays) * 5));
  }
  
  // Payee score using fuzzball
  const payeeScore = calculatePayeeScore(bankTxn.payee, ynabTxn.payee);
  
  // Combined score with weights
  let combined = 
    (amountScore * config.weights.amount) +
    (dateScore * config.weights.date) +
    (payeeScore * config.weights.payee);
  
  // Apply bonuses
  if (amountScore === 100) combined += config.exactAmountBonus;
  if (dateScore === 100) combined += config.exactDateBonus;
  if (payeeScore >= 95) combined += config.exactPayeeBonus;
  
  combined = Math.min(100, combined);
  
  return {
    amount: Math.round(amountScore),
    date: Math.round(dateScore),
    payee: Math.round(payeeScore),
    combined: Math.round(combined),
  };
}

function calculatePayeeScore(bankPayee: string, ynabPayee: string | null): number {
  if (!ynabPayee) return 30;
  
  const scores = [
    fuzz.token_set_ratio(bankPayee, ynabPayee),
    fuzz.token_sort_ratio(bankPayee, ynabPayee),
    fuzz.partial_ratio(bankPayee, ynabPayee),
    fuzz.WRatio(bankPayee, ynabPayee),
  ];
  
  return Math.max(...scores);
}

function buildMatchReasons(scores: MatchCandidate['scores'], config: MatchingConfig): string[] {
  const reasons: string[] = [];
  
  if (scores.amount === 100) {
    reasons.push('Exact amount match');
  } else if (scores.amount >= 95) {
    reasons.push('Amount within tolerance');
  }
  
  if (scores.date === 100) {
    reasons.push('Same date');
  } else if (scores.date >= 90) {
    reasons.push('Date within 1-2 days');
  } else if (scores.date >= 50) {
    reasons.push(`Date within ${config.dateToleranceDays} days`);
  }
  
  if (scores.payee >= 95) {
    reasons.push('Payee exact match');
  } else if (scores.payee >= 80) {
    reasons.push('Payee highly similar');
  } else if (scores.payee >= 60) {
    reasons.push('Payee somewhat similar');
  }
  
  return reasons;
}
```

### 3.4 Integration Tests with Real CSV Data

**File:** `src/__tests__/tools/reconciliation/csvParser.integration.test.ts`

> **Note:** Tests follow repo convention: `src/__tests__/` with fixtures in `test-exports/csv/`

```typescript
import { describe, it, expect } from 'vitest';
import { parseCSV } from '../../../tools/reconciliation/csvParser.js';
import { findMatches, DEFAULT_CONFIG } from '../../../tools/reconciliation/matcher.js';
import { normalizeYNABTransaction } from '../../../tools/reconciliation/ynabAdapter.js';

describe('CSV Parser Integration Tests', () => {
  describe('TD Bank CSV', () => {
    const tdCSV = `Date,Description,Amount
09/15/2025,SHELL STATION 1234 TORONTO ON,-45.23
09/16/2025,AMZN MKTP CA*1A2B3C4,-127.99
09/17/2025,PAYROLL DEPOSIT ABC CORP,2500.00`;

    it('should parse TD CSV correctly', () => {
      const result = parseCSV(tdCSV, { preset: 'td' });
      
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(3);
      expect(result.transactions[0].amount).toBe(-45230);  // Milliunits!
      expect(result.transactions[0].payee).toBe('SHELL STATION 1234 TORONTO ON');
      expect(result.transactions[0].date).toBe('2025-09-15');
    });
  });
  
  describe('RBC Debit/Credit CSV', () => {
    const rbcCSV = `Transaction Date,Description 1,Debit,Credit
2025-09-15,SHELL GAS,45.23,
2025-09-16,TRANSFER FROM SAVINGS,,500.00`;

    it('should parse RBC CSV with debit/credit columns', () => {
      const result = parseCSV(rbcCSV, { preset: 'rbc' });
      
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].amount).toBe(-45230);  // Debit = negative milliunits
      expect(result.transactions[1].amount).toBe(500000);  // Credit = positive milliunits
    });
  });
  
  describe('Ambiguous Debit/Credit Warning', () => {
    const ambiguousCSV = `Transaction Date,Description,Debit,Credit
2025-09-15,WEIRD TXN,50.00,25.00`;

    it('should warn when both debit and credit have values', () => {
      const result = parseCSV(ambiguousCSV, { preset: 'rbc' });
      
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain('Both Debit');
      expect(result.transactions[0].amount).toBe(-50000);  // Uses debit
    });
  });
  
  describe('European Number Format', () => {
    const euroCSV = `Date,Amount,Description
15/09/2025,"1.234,56",Big Purchase`;

    it('should handle European number format', () => {
      const result = parseCSV(euroCSV);
      
      expect(result.transactions[0].amount).toBe(1234560);  // 1234.56 in milliunits
    });
  });
});

describe('Matcher Integration Tests', () => {
  const mockYNABTransactions = [
    { id: 'y1', date: '2025-09-15', amount: -45230, payee_name: 'Shell', category_name: 'Gas', cleared: 'uncleared', approved: true },
    { id: 'y2', date: '2025-09-17', amount: -127990, payee_name: 'Amazon', category_name: 'Shopping', cleared: 'uncleared', approved: true },
  ].map(t => normalizeYNABTransaction(t as any));
  
  it('should achieve high confidence matches with exact integer comparison', () => {
    const bankCSV = `Date,Description,Amount
09/15/2025,SHELL STATION 1234,-45.23
09/16/2025,AMZN MKTP CA*ABC123,-127.99`;

    const parsed = parseCSV(bankCSV);
    const matches = findMatches(parsed.transactions, mockYNABTransactions);
    
    // Shell: exact amount match (both -45230 milliunits)
    expect(matches[0].confidence).toBe('high');
    expect(matches[0].bestMatch?.scores.amount).toBe(100);
    
    // Amazon: exact amount match (both -127990 milliunits)
    expect(matches[1].confidence).toBe('high');
    expect(matches[1].bestMatch?.scores.amount).toBe(100);
  });
  
  it('should use exact integer comparison (no float precision issues)', () => {
    // Both are now integers - no floating point comparison needed!
    const bankTxn = { 
      id: 'b1', 
      date: '2025-09-15', 
      amount: -45230,  // Integer milliunits
      payee: 'Shell',
      sourceRow: 2,
      raw: { date: '09/15/2025', amount: '-45.23', description: 'Shell' }
    };
    
    const ynabTxn = {
      id: 'y1',
      date: '2025-09-15',
      amount: -45230,  // Integer milliunits - direct from YNAB API
      payee: 'Shell',
      memo: null,
      categoryName: 'Gas',
      cleared: 'uncleared' as const,
      approved: true,
    };
    
    const matches = findMatches([bankTxn], [ynabTxn]);
    // Exact match because integers compare exactly: -45230 === -45230
    expect(matches[0].bestMatch?.scores.amount).toBe(100);
  });
});
```

---

## Part 4: Diagnostic/Debug Mode

Add diagnostic output to help debug matching issues. **Diagnostics should be returned even on failure/partial match.**

```typescript
export interface MatchDiagnostics {
  csvParsing: {
    detectedDelimiter: string;
    detectedColumns: string[];
    totalRows: number;
    validRows: number;
    errors: ParseError[];
    warnings: ParseWarning[];
  };
  matchingDetails: Array<{
    bankTxn: { date: string; amount: number; payee: string };
    bestMatch: {
      ynabTxn: { date: string; amount: number; payee: string | null };
      scores: { amount: number; date: number; payee: number; combined: number };
    } | null;
    allCandidates: Array<{
      ynabId: string;
      scores: { amount: number; date: number; payee: number; combined: number };
      rejectedBecause?: string;
    }>;
    confidence: 'high' | 'medium' | 'low' | 'none';
  }>;
  timing: {
    parseMs: number;
    matchMs: number;
  };
}

// In reconcile_account schema:
{
  // ... existing params
  include_diagnostics: z.boolean().optional().default(false),
}

// ALWAYS include diagnostics on error or low match rate
const shouldIncludeDiagnostics = 
  params.include_diagnostics || 
  parseResult.errors.length > 0 ||
  matches.filter(m => m.confidence === 'none').length > matches.length * 0.5;
```

---

## Part 5: Migration Path

### Phase 1: Foundation (Week 1)
1. [x] Install new dependencies: `papaparse`, `fuzzball`, `chrono-node`, `dayjs`
2. [x] Create unified types in `src/types/reconciliation.ts`
3. [x] Create YNAB adapter in `src/tools/reconciliation/ynabAdapter.ts`
4. [x] Create new CSV parser module (`src/tools/reconciliation/csvParser.ts`)
5. [x] Create new matcher module (`src/tools/reconciliation/matcher.v2.ts`)
6. [x] Add integration tests in `src/__tests__/tools/reconciliation/`

### Phase 2: Integration (Week 2)
1. [x] Update `analyzeReconciliation()` to use new parser and matcher
2. [x] Update reconcile adapter for new response format
3. [x] Add diagnostic mode (always on for errors)
4. [x] Update existing tests to not mock the parser

### Phase 3: Validation (Week 3)
1. [x] Test against saved CSV exports from TD, RBC, Scotiabank, Wealthsimple
   - *Note:* Verified against real-world TD (headerless) and Wealthsimple exports.
   - *Feature Added:* `csvParser` now supports `header: false` and manual column mapping for headerless files (like TD).
2. [ ] Compare match quality against current implementation
3. [ ] Tune thresholds based on real-world data
4. [ ] Document bank-specific quirks

### Phase 4: Cleanup (Week 4)
1. Remove old `compareTransactions/parser.ts` if no longer needed
2. Remove duplicate BankTransaction type
3. Update all remaining references
4. Final documentation

---

## Part 6: Configuration Recommendations

Based on research and the Midday.ai approach:

| Parameter | Current | Recommended | Rationale |
|-----------|---------|-------------|-----------|
| `dateToleranceDays` | 2 | 7 | Banks often post 3-7 days late |
| `amountToleranceMilliunits` | 10 | 10 | 1 cent tolerance |
| `autoMatchThreshold` | 90 | 85 | More lenient with better algorithm |
| `suggestedMatchThreshold` | 60 | 60 | Keep same |
| Amount weight | 40% | 50% | Amount is most reliable signal |
| Date weight | 40% | 15% | Dates are unreliable |
| Payee weight | 20% | 35% | With fuzzball, payee matching is much better |

### User-Tunable vs Hard-Coded

| Parameter | User-Tunable? | Exposed Via | Default |
|-----------|---------------|-------------|----------|
| `date_tolerance_days` | ✅ Yes | Tool schema | 7 |
| `amount_tolerance_cents` | ✅ Yes | Tool schema | 5 |
| `confidence_threshold` | ✅ Yes | Tool schema | 0.85 |
| `auto_create_transactions` | ✅ Yes | Tool schema | false |
| `auto_update_cleared_status` | ✅ Yes | Tool schema | false |
| `dry_run` | ✅ Yes | Tool schema | false |
| `csv_format.preset` | ✅ Yes | Tool schema | auto-detect |
| `csv_format.overrides.*` | ✅ Yes | Tool schema | none |
| Scoring weights | ❌ No | Hard-coded | 50/15/35 |
| Minimum candidate score | ❌ No | Hard-coded | 40 |
| Guardrail thresholds | ❌ No | Hard-coded | See Part 7c |

**Rationale:** Tolerances and automation toggles are user-visible because they're intuitive ("how many days?"). Scoring weights and guardrails are expert-level tuning that could cause harm if misconfigured—keep these as sensible defaults that "just work."

---

## Part 7: Future Enhancements

1. **Merchant Learning:** Cache successful payee mappings ("AMZN MKTP" → "Amazon") per user/budget
2. **Adaptive Thresholds:** Learn from user confirmations/rejections like Midday.ai
3. **Vector Embeddings:** For truly semantic matching (requires OpenAI/embedding API)
4. **Split Transaction Detection:** Detect when one bank transaction = multiple YNAB transactions
5. **Recurring Transaction Patterns:** Use historical patterns to boost confidence

---

## Part 7b: Performance, Scale & Dependencies

### Dependency Impact Analysis

| Library | Minified Size | Tree-shakeable | Cold-start Impact | Justification |
|---------|---------------|----------------|-------------------|---------------|
| **PapaParse** | ~50 kB | Partial | Low (~20ms) | Handles malformed CSVs that csv-parse chokes on |
| **fuzzball** | ~15 kB | Yes | Minimal | 10x better merchant matching than Levenshtein |
| **chrono-node** | ~80 kB | No | Moderate (~50ms) | Fallback only; primary parsing uses explicit formats |
| **dayjs** | ~2 kB | Yes | Negligible | Only for formatting; could be removed |

**Current baseline:** `csv-parse` (~30 kB) + `date-fns` (~30 kB) = ~60 kB  
**Proposed total:** ~150 kB (+90 kB, ~150% increase)

**Mitigation:**
- `chrono-node` is used as fallback only; consider lazy `import()` if cold-start becomes an issue
- For MCP servers (Node.js), bundle size matters less than browser apps
- Cold-start measured at <100ms additional on M1 Mac

### Algorithmic Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| CSV parsing | O(N) | N = rows; PapaParse streams large files |
| Basic matching | O(N × M) | N = bank txns, M = YNAB txns |
| Combination matching | O(N × M²) or O(N × M³) | 2-way and 3-way combinations |
| Payee fuzzy matching | O(L²) per pair | L = string length; fuzzball is optimised |

### Scale Limits & Recommendations

| CSV Size | Expected Behaviour | Recommendation |
|----------|-------------------|----------------|
| <100 txns | <500ms, full features | Default mode |
| 100-500 txns | <2s, full features | Default mode |
| 500-1000 txns | 2-10s, disable 3-way combos | Set `max_combination_size: 2` |
| >1000 txns | May timeout | Chunk by month, process sequentially |

### Optimisation Strategies (Future)

1. **Amount bucketing:** Index YNAB transactions by amount (±tolerance) for O(1) candidate lookup
2. **Date windowing:** Only compare transactions within ±14 days
3. **Early termination:** Stop searching once confidence ≥98%
4. **Streaming:** Parse CSV in chunks for memory efficiency on huge files

---

## Part 7c: Matching Guardrails & Failure Modes

### Hard Guardrails (Never Auto-Match)

Auto-matching is **disabled** when:

| Condition | Rationale |
|-----------|-----------|
| Amount score <80 | Amount is the most reliable signal; fuzzy amounts are dangerous |
| Date gap >14 days | Even with bank delays, 2+ weeks is suspicious |
| Multiple candidates with score within 5 points | Ambiguous; surface for human review |
| Payee score <40 AND date score <60 | Neither secondary signal is strong enough |
| Transaction flagged with warnings | Parser detected ambiguity (e.g., both debit/credit populated) |

### Known Failure Modes

| Failure Mode | Example | Mitigation |
|--------------|---------|------------|
| **Similar merchants** | Starbucks #1234 vs #5678 | Require exact amount + date ≤1 day for coffee shops |
| **Recurring subscriptions** | Netflix $15.99 every month | Use date as primary discriminator when amounts match |
| **Refunds** | -$50.00 refund vs original +$50.00 charge | Sign check prevents cross-matching |
| **Split transactions** | $100 bank = $60 + $40 YNAB | Combination matching handles this |
| **Merchant name drift** | "AMZN" vs "Amazon.com" vs "Amazon Prime" | Payee normalisation + token_set_ratio |
| **Duplicate entries** | Same amount/date/payee in YNAB | Prefer uncleared over cleared; flag for review |

### Tie-Breaking Rules

When multiple YNAB candidates have identical scores:

1. Prefer `uncleared` over `cleared` (expecting confirmation)
2. Prefer closer date proximity
3. Prefer higher payee similarity
4. If still tied, surface all candidates for human review

### Confidence Tier Behaviour

| Tier | Score Range | Auto-Action | User Prompt |
|------|-------------|-------------|-------------|
| `high` | ≥85 | Mark cleared, update date if needed | None (unless in dry-run) |
| `medium` | 60-84 | None | "Review suggested match" |
| `low` | 40-59 | None | "Possible match, low confidence" |
| `none` | <40 | None | "No match found - add new?" |

---

## Part 7d: Diagnostics Behaviour & Privacy

### Diagnostic Output Locations

| Context | Output Location | Verbosity |
|---------|-----------------|-----------|
| MCP response (success) | `structured_data.diagnostics` | Minimal (counts only) |
| MCP response (errors/low match) | `structured_data.diagnostics` | Full (per-transaction details) |
| Server logs | `stdout` via structured logging | Configurable via `LOG_LEVEL` |
| Debug files | `test-results/reconciliation/` | Full (for test runs only) |

### When Diagnostics Are Included

```typescript
const includeDiagnostics = 
  params.include_diagnostics ||           // Explicitly requested
  parseResult.errors.length > 0 ||        // CSV parsing had errors
  matchRate < 0.5 ||                       // Less than 50% matched
  matches.some(m => m.confidence === 'none' && m.bankTransaction.amount > 10000);  // Large unmatched txn
```

### Privacy Considerations

| Field | In MCP Response | In Logs | In Test Artifacts |
|-------|-----------------|---------|-------------------|
| Transaction amounts | ✅ Full | ✅ Full | ✅ Full |
| Transaction dates | ✅ Full | ✅ Full | ✅ Full |
| Payee names | ✅ Full | ⚠️ Truncated (first 20 chars) | ✅ Full |
| Memos | ✅ Full | ❌ Redacted | ⚠️ Hashed |
| Account IDs | ✅ Full | ✅ Full | ✅ Full |
| Raw CSV rows | ❌ Not included | ❌ Not included | ✅ Full |

**Rationale:** MCP responses go directly to the user who owns the data. Logs may be aggregated for debugging; truncate PII. Test artifacts are stored locally.

### Log Redaction Example

```typescript
// In production logs
logger.info('Match found', {
  bankTxn: {
    date: '2025-09-15',
    amount: -45230,
    payee: 'SHELL STATION 12...',  // Truncated
  },
  confidence: 'high',
  score: 92,
});
```

---

## Part 7e: Bank Presets Evolution & Overrides

### Preset Versioning

Bank CSV formats change. Presets are versioned:

```typescript
export const BANK_PRESETS: Record<string, BankPreset> = {
  'td:2024': { /* current TD format */ },
  'td:2023': { /* older TD format */ },
  'td': { /* alias to latest: 'td:2024' */ },
};
```

### User Override Mechanism

Users can override presets via tool parameters without code changes:

```typescript
// In reconcile_account call
{
  csv_format: {
    preset: 'td',  // Start with TD preset
    overrides: {
      date_column: 'Posted Date',  // Override specific field
      date_format: 'DMY',          // My export uses DD/MM/YYYY
    }
  }
}
```

Overrides are merged with preset defaults:

```typescript
const effectiveFormat = {
  ...BANK_PRESETS[params.csv_format.preset],
  ...params.csv_format.overrides,
};
```

### Adding/Updating Presets

1. **Collect samples:** Get 3+ CSV exports from the bank (different date ranges)
2. **Create fixture:** Add to `test-exports/csv/{bank}/` with README noting export date
3. **Write test:** Add integration test in `csvParser.integration.test.ts`
4. **Define preset:** Add to `BANK_PRESETS` with version suffix
5. **Verify:** Run `npm run test:integration:reconciliation`

### Preset Testing Matrix

CI runs all presets against their fixtures:

```yaml
# .github/workflows/test.yml
test-bank-presets:
  strategy:
    matrix:
      bank: [td, rbc, scotiabank, tangerine, wealthsimple, cibc, bmo]
  steps:
    - run: npm run test:preset -- ${{ matrix.bank }}
```

### Deprecation Policy

- Old preset versions kept for 12 months after new version added
- Deprecated presets log a warning but continue to work
- Breaking changes (removed presets) only in major versions

---

## Part 8: Design Decisions & Rationale

### Why Milliunits (Integers) Instead of Dollars (Floats)?

**This is the most important architectural decision in the redesign.**

The original plan used dollars (floats), requiring tolerance-based comparison everywhere:
```typescript
// Old approach (floats) - error-prone
if (Math.abs(bankTxn.amount - ynabTxn.amount) < 0.001) { ... }
```

The new approach uses milliunits (integers), enabling exact comparison:
```typescript
// New approach (integers) - bulletproof
if (bankTxn.amount === ynabTxn.amount) { ... }
```

Benefits:
- **Eliminates floating-point precision bugs** - No more `45.23 !== 45.230000000001`
- **Matches YNAB's native format** - YNAB API uses milliunits, so no conversion needed for YNAB transactions
- **Single conversion point** - Only the CSV parser converts dollars→milliunits
- **Simpler matcher logic** - `===` instead of `Math.abs(...) < epsilon`

### Why Date Format Hints in Bank Presets?

chrono-node is powerful but can misparse ambiguous dates like `02/03/2025`:
- US interpretation: February 3rd
- European interpretation: March 2nd

Bank presets include a `dateFormat` hint ('MDY', 'DMY', 'YMD') that we try BEFORE falling back to chrono-node.

Priority:
1. ISO format `YYYY-MM-DD` (unambiguous)
2. Preset's format hint (for ambiguous numeric dates)
3. chrono-node fallback (for natural language, weird formats)

### Why Timezone-Safe Date Formatting?

`toISOString()` converts to UTC, which can shift the date:
```typescript
// WRONG - can shift date by timezone
const dateStr = parsedDate.toISOString().split('T')[0];

// RIGHT - uses local date components
const dateStr = `${date.getFullYear()}-${...}`;
```

### Why Decouple YNAB Types?

The `NormalizedYNABTransaction` interface in `src/types/reconciliation.ts` intentionally does NOT import from the YNAB SDK. This:
- Keeps the reconciliation core testable without SDK mocks
- Allows the types file to be shared without pulling in SDK dependencies
- Makes it easier to swap adapters if YNAB API changes

The adapter in `src/tools/reconciliation/ynabAdapter.ts` is the single point of contact with the SDK.

### Test File Location Convention

Tests live in `src/__tests__/` mirroring the source structure:
```
src/tools/reconciliation/csvParser.ts
  → src/__tests__/tools/reconciliation/csvParser.test.ts
  → src/__tests__/tools/reconciliation/csvParser.integration.test.ts
```

CSV fixtures go in `test-exports/csv/` following existing repo conventions.

---

## Appendix A: Library Comparison Summary

| Library | Purpose | Size | Key Feature |
|---------|---------|------|-------------|
| **PapaParse** | CSV parsing | 260 kB | Auto-detect delimiters, malformed CSV handling |
| **fuzzball** | Fuzzy matching | 15 kB | token_set_ratio for merchant names |
| **chrono-node** | Date parsing | 20 kB | Natural language dates, many formats |
| **dayjs** | Date formatting | 2 kB | Lightweight date manipulation |

## Appendix B: Test CSV Fixtures

Create `test-exports/csv/` with sample exports from:
- TD Canada Trust
- RBC Royal Bank
- Scotiabank
- Wealthsimple Cash
- Tangerine
- CIBC
- BMO

Each fixture should include edge cases:
- Transactions with commas in description
- European date formats (DD/MM/YYYY)
- Negative amounts in parentheses
- Multi-line descriptions
- Currency symbols ($, €, £, CAD, USD)
- Missing fields
- Ambiguous dates (02/03/2025)
- Both debit and credit columns populated

## Appendix C: Reference Materials

### Research Sources
1. **Midday.ai Reconciliation Engine** - <https://midday.ai/updates/automatic-reconciliation-engine/>
   - Open source: <https://github.com/midday-ai/midday>
   - Uses vector embeddings + multi-dimensional scoring
   - Key insight: 50% amount, 35% semantic, 10% currency, 5% date

2. **CSV Parser Comparison** - <https://www.oneschema.co/blog/top-5-javascript-csv-parsers>
   - PapaParse: Best for malformed CSVs, auto-detect
   - csv-parser: Fastest for large files
   - fast-csv: Smallest footprint

3. **Fuzzball (TheFuzz port)** - <https://www.npmjs.com/package/fuzzball>
   - token_set_ratio: Best for merchant name matching
   - Handles word order variations
   - Built-in normalization

4. **chrono-node** - <https://www.npmjs.com/package/chrono-node>
   - Parses virtually any date format
   - Natural language support
