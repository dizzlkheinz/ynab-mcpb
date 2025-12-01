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
  /** Whether the CSV has a header row */
  header?: boolean;
}

// Presets for Canadian banks
export const BANK_PRESETS: Record<string, BankPreset> = {
  td: {
    name: 'TD Canada Trust',
    // Real TD credit card exports are typically
    // headerless with columns:
    // [Date, Description, Debit, Credit, Balance]
    // but some tools/scrapers produce a
    // headered variant: Date,Description,Amount.
    //
    // We default to headerless here and rely on
    // auto-detection + flexible column candidates
    // so both forms are supported.
    header: false,
    dateColumn: ['0', 'Date'],
    amountColumn: ['Amount'],
    debitColumn: '2',
    creditColumn: '3',
    descriptionColumn: ['1', 'Description'],
    dateFormat: 'MDY', // TD typically uses MM/DD/YYYY
  },
  rbc: {
    name: 'RBC Royal Bank',
    dateColumn: ['Transaction Date', 'Date'],
    debitColumn: 'Debit',
    creditColumn: 'Credit',
    descriptionColumn: ['Description 1', 'Description', 'Transaction'],
    dateFormat: 'YMD', // RBC typically uses YYYY-MM-DD
  },
  scotiabank: {
    name: 'Scotiabank',
    dateColumn: ['Date', 'Transaction Date'],
    amountColumn: ['Amount'],
    descriptionColumn: ['Description', 'Transaction Details'],
    dateFormat: 'DMY', // Scotiabank often uses DD/MM/YYYY
  },
  wealthsimple: {
    name: 'Wealthsimple',
    dateColumn: ['Date'],
    amountColumn: ['Amount'],
    descriptionColumn: ['Description', 'Payee'],
    amountMultiplier: 1,
    dateFormat: 'YMD',
  },
  tangerine: {
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
  /** Manual column overrides */
  columns?: {
    date?: string;
    amount?: string;
    debit?: string;
    credit?: string;
    description?: string;
  };
  /** Date format hint */
  dateFormat?: 'YMD' | 'MDY' | 'DMY';
  /**
   * Whether the CSV has a header row.
   * If false, columns must be specified by index (e.g., "0", "1").
   * Defaults to true.
   */
  header?: boolean;
  /** Maximum number of rows to process (default: 10000) */
  maxRows?: number;
  /** Maximum file size in bytes (default: 10MB) */
  maxBytes?: number;
}

/**
 * Attempt to auto-detect the bank format from raw content.
 * Strategies:
 * 1. Parse first 5 lines.
 * 2. Check for header matches (existing logic).
 * 3. Check for headerless patterns (TD specific: date, desc, debit, credit, balance).
 */
function autoDetectFormat(content: string): { preset?: string; header?: boolean } | undefined {
  const preview = Papa.parse(content, {
    preview: 5,
    header: false, // Parse as array first to inspect structure
    skipEmptyLines: true,
  });

  if (preview.errors.length > 0 || preview.data.length === 0) return undefined;

  const rows = preview.data as string[][];
  const firstRow = rows[0];
  if (!firstRow) return undefined;

  // 1. Check for known headers (RBC, etc.)
  const headerMatch = detectPreset(firstRow);
  if (headerMatch) {
    // Find key in BANK_PRESETS
    const key = Object.keys(BANK_PRESETS).find((k) => BANK_PRESETS[k] === headerMatch);
    if (key) return { preset: key, header: true };
  }

  // 2. Check for TD Headerless Pattern
  // Typical TD row: [Date, Description, Debit, Credit, Balance]
  // Date: MM/DD/YYYY (e.g., 11/21/2025)
  // Debit/Credit: Numbers or empty
  // Balance: Number
  if (checkTDPattern(rows)) {
    return { preset: 'td', header: false };
  }

  return undefined;
}

function checkTDPattern(rows: string[][]): boolean {
  // Needs at least one valid row
  // Headerless TD exports typically have at least
  // Date, Description, Debit, Credit columns. Require
  // 4+ columns to avoid misclassifying generic
  // Date/Description/Amount formats as TD.
  const validRows = rows.filter((r) => r.length >= 4);
  if (validRows.length === 0) return false;

  // Check first few rows for MM/DD/YYYY date in column 0
  // AND numeric values in columns 2, 3, 4 (if present)
  let matchCount = 0;
  for (const row of validRows) {
    // Col 0: Date MM/DD/YYYY
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(row[0] || '')) continue;

    // Col 2 (Debit) or Col 3 (Credit) must be numeric-ish if present
    const isDebitNumeric = !row[2] || /^-?[\d,.]+$/.test(row[2]);
    const isCreditNumeric = !row[3] || /^-?[\d,.]+$/.test(row[3]);

    if (isDebitNumeric && isCreditNumeric) {
      matchCount++;
    }
  }

  // If majority of preview rows match, it's likely TD
  return matchCount > validRows.length / 2;
}

/**
 * Parse a bank CSV file into BankTransaction objects.
 *
 * IMPORTANT: Amounts are converted to MILLIUNITS (integers) at this boundary.
 * This is the ONLY place where float-to-milliunit conversion happens.
 */
export function parseCSV(content: string, options: ParseCSVOptions = {}): CSVParseResult {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];

  // Security: Check file size limit
  const MAX_BYTES = options.maxBytes ?? 10 * 1024 * 1024; // 10MB default
  if (content.length > MAX_BYTES) {
    throw new Error(`File size exceeds limit of ${Math.round(MAX_BYTES / 1024 / 1024)}MB`);
  }

  // Auto-detect format when preset or header are not fully specified
  let detectedPreset: string | undefined = options.preset;
  let detectedHeader: boolean | undefined = options.header;

  if (!detectedPreset || detectedHeader === undefined) {
    const autoResult = autoDetectFormat(content);
    if (autoResult) {
      if (!detectedPreset) {
        detectedPreset = autoResult.preset;
      }
      if (detectedHeader === undefined && autoResult.header !== undefined) {
        detectedHeader = autoResult.header;
      }
    }
  }

  // Determine header setting: Explicit > Detected > Preset > Default (true)
  let hasHeader = true;
  if (detectedHeader !== undefined) {
    hasHeader = detectedHeader;
  } else if (detectedPreset) {
    const preset = BANK_PRESETS[detectedPreset];
    if (preset && preset.header !== undefined) {
      hasHeader = preset.header;
    }
  }

  const maxRows = options.maxRows ?? 10000;

  // Parse with PapaParse
  // Security: Use preview to limit rows parsed into memory (prevents memory exhaustion)
  const parsed = Papa.parse(content, {
    header: hasHeader,
    preview: maxRows + (hasHeader ? 1 : 0), // +1 for header row if present
    dynamicTyping: false, // We'll handle type conversion ourselves
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

  const rows = parsed.data as (Record<string, string> | string[])[];
  let columns: string[] = [];

  if (hasHeader) {
    columns = parsed.meta.fields ?? [];
  } else {
    // If no header, rows are arrays. Create dummy columns based on max length
    const maxLen = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    columns = Array.from({ length: maxLen }, (_, i) => String(i));
  }

  const preset = detectedPreset
    ? BANK_PRESETS[detectedPreset]
    : hasHeader
      ? detectPreset(columns)
      : undefined;

  // Determine column names (Priority: Options > Preset > Defaults)

  const dateCandidates = options.columns?.date
    ? [options.columns.date]
    : (preset?.dateColumn ?? ['Date', 'Transaction Date', 'Posted Date']);
  const descCandidates = options.columns?.description
    ? [options.columns.description]
    : (preset?.descriptionColumn ?? ['Description', 'Payee', 'Merchant', 'Name']);

  const dateCol = findColumn(columns, dateCandidates, !hasHeader);
  const descCol = findColumn(columns, descCandidates, !hasHeader);

  let amountCol: string | null = null;
  let debitCol: string | null = null;
  let creditCol: string | null = null;

  if (options.columns?.debit && options.columns?.credit) {
    debitCol = findColumn(columns, [options.columns.debit], !hasHeader);
    creditCol = findColumn(columns, [options.columns.credit], !hasHeader);
  } else if (
    preset?.debitColumn &&
    preset?.creditColumn &&
    !options.columns?.amount &&
    // If a preset also defines an amount column, prefer that when headers
    // are present. This lets TD support both headerless (debit/credit)
    // and headered (Amount) variants while RBC still uses debit/credit
    // with headers.
    (hasHeader ? !preset?.amountColumn : true)
  ) {
    debitCol = findColumn(columns, [preset.debitColumn], !hasHeader);
    creditCol = findColumn(columns, [preset.creditColumn], !hasHeader);
  } else {
    const amountCandidates = options.columns?.amount
      ? [options.columns.amount]
      : (preset?.amountColumn ?? ['Amount', 'CAD$', 'Value']);
    amountCol = findColumn(columns, amountCandidates, !hasHeader);
  }

  if (!dateCol) {
    errors.push({
      row: 0,
      field: 'date',
      message: `Could not identify date column from: ${columns.join(', ')}. Try using preset option (td, rbc, scotiabank, etc.) or specify columns manually with columns.date`,
      rawValue: columns.join(', '),
    });
  }
  if (!amountCol && (!debitCol || !creditCol)) {
    if (!debitCol && !creditCol) {
      errors.push({
        row: 0,
        field: 'amount',
        message: `Could not identify amount column from: ${columns.join(', ')}. Try using preset option or specify columns manually with columns.amount (or columns.debit/credit for split columns)`,
        rawValue: columns.join(', '),
      });
    } else if (!debitCol || !creditCol) {
      errors.push({
        row: 0,
        field: 'amount',
        message: `Could not identify debit/credit columns pair from: ${columns.join(', ')}. Found ${debitCol ? 'debit' : 'credit'} but missing ${debitCol ? 'credit' : 'debit'}. Specify both with columns.debit and columns.credit`,
        rawValue: columns.join(', '),
      });
    }
  }

  const transactions: BankTransaction[] = [];

  const dateFormat = options.dateFormat ?? preset?.dateFormat;

  // Papa.parse preview already limited rows, but keep defensive check
  for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
    const row = rows[i];
    if (!row) continue;

    // Helper to get value
    const getValue = (colName: string | null): string => {
      if (!colName) return '';
      if (Array.isArray(row)) {
        const idx = parseInt(colName, 10);
        return String(row[idx] ?? '');
      }
      return String(row[colName as keyof typeof row] ?? '');
    };

    const rowNum = i + (hasHeader ? 2 : 1); // 1-indexed. Header consumes line 1.
    const rowWarnings: string[] = [];

    // Parse date
    const rawDate = getValue(dateCol)?.trim() ?? '';
    const parsedDate = parseDate(rawDate, dateFormat);
    if (!parsedDate) {
      errors.push({
        row: rowNum,
        field: 'date',
        message: `Could not parse date: "${rawDate}"`,
        rawValue: rawDate,
      });
      continue;
    }
    // Use LOCAL date components (now derived from UTC date object)
    const dateStr = formatLocalDate(parsedDate);

    // Parse amount
    let amountMilliunits: number;
    let rawAmount: string;

    if (amountCol) {
      rawAmount = getValue(amountCol)?.trim() ?? '';
      const parsedAmount = parseAmount(rawAmount);
      if (!parsedAmount.valid) {
        errors.push({
          row: rowNum,
          field: 'amount',
          message: parsedAmount.reason ?? `Invalid amount: "${rawAmount}"`,
          rawValue: rawAmount,
        });
        continue;
      }
      amountMilliunits = parsedAmount.valueMilliunits;
    } else if (debitCol && creditCol) {
      const debit = getValue(debitCol)?.trim() ?? '';
      const credit = getValue(creditCol)?.trim() ?? '';
      rawAmount = debit || credit;

      const parsedDebit = parseAmount(debit);
      const parsedCredit = parseAmount(credit);

      if (!parsedDebit.valid && debit) {
        errors.push({
          row: rowNum,
          field: 'amount',
          message: parsedDebit.reason ?? `Invalid debit amount: "${debit}"`,
          rawValue: debit,
        });
        continue;
      }
      if (!parsedCredit.valid && credit) {
        errors.push({
          row: rowNum,
          field: 'amount',
          message: parsedCredit.reason ?? `Invalid credit amount: "${credit}"`,
          rawValue: credit,
        });
        continue;
      }

      const debitMilliunits = parsedDebit.valid ? parsedDebit.valueMilliunits : 0;
      const creditMilliunits = parsedCredit.valid ? parsedCredit.valueMilliunits : 0;

      // Warn if both debit and credit have values (ambiguous)
      if (Math.abs(debitMilliunits) > 0 && Math.abs(creditMilliunits) > 0) {
        const warning = `Both Debit (${debit}) and Credit (${credit}) have values - using Debit`;
        rowWarnings.push(warning);
        warnings.push({ row: rowNum, message: warning });
      }

      if (Math.abs(debitMilliunits) > 0) {
        amountMilliunits = -Math.abs(debitMilliunits); // Debits are outflows (negative)
      } else if (Math.abs(creditMilliunits) > 0) {
        amountMilliunits = Math.abs(creditMilliunits); // Credits are inflows (positive)
      } else {
        errors.push({
          row: rowNum,
          field: 'amount',
          message: 'Missing debit/credit amount',
          rawValue: `${debit}|${credit}`,
        });
        continue;
      }

      // Warn if debit column contains negative value (unusual)
      if (debitMilliunits < 0) {
        const warning = `Debit column contains negative value (${debit}) - treating as positive debit`;
        rowWarnings.push(warning);
        warnings.push({ row: rowNum, message: warning });
      }
    } else {
      continue;
    }

    // Apply amount inversion if needed
    const multiplier = options.invertAmounts ? -1 : (preset?.amountMultiplier ?? 1);
    amountMilliunits *= multiplier;

    // Parse description & Sanitize
    let rawDesc = getValue(descCol)?.trim() ?? '';
    // Security: Remove potentially malicious/confusing Unicode characters:
    // - ASCII control chars (0x00-0x1F, 0x7F)
    // - C1 control chars (0x80-0x9F)
    // - Bidirectional text overrides (U+202A-202E, U+2066-2069)
    // - Zero-width characters (U+200B-200D, U+FEFF)
    // - Unicode line/paragraph separators (U+2028-2029)

    rawDesc = rawDesc
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // ASCII + C1 control chars
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '') // Bidirectional overrides
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width chars
      .replace(/[\u2028-\u2029]/g, '') // Line/paragraph separators
      .substring(0, 500);

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
      ...(rowWarnings.length > 0 && { warnings: rowWarnings }),
    });
  }

  return {
    transactions,
    errors,
    warnings,
    meta: {
      detectedDelimiter: parsed.meta.delimiter || ',',
      detectedColumns: columns,
      totalRows: rows.length,
      validRows: transactions.length,
      skippedRows: rows.length - transactions.length,
    },
  };
}

function parseDate(raw: string, formatHint?: 'YMD' | 'MDY' | 'DMY'): Date | null {
  if (!raw) return null;

  // 1. Try ISO format first (unambiguous)
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(Date.UTC(parseInt(year!), parseInt(month!) - 1, parseInt(day!)));
  }

  // 2. Try explicit format hint for ambiguous numeric dates
  // Pattern: X/X/X or X-X-X where X can be 1-4 digits
  const numericMatch = raw.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
  if (numericMatch && formatHint) {
    const [, a, b, c] = numericMatch;

    let year: number, month: number, day: number;
    switch (formatHint) {
      case 'YMD': // YYYY/MM/DD or YY/MM/DD
        year = parseInt(a!);
        month = parseInt(b!);
        day = parseInt(c!);
        break;
      case 'MDY': // US format: MM/DD/YYYY or MM/DD/YY
        month = parseInt(a!);
        day = parseInt(b!);
        year = parseInt(c!);
        break;
      case 'DMY': // European/UK format: DD/MM/YYYY or DD/MM/YY
        day = parseInt(a!);
        month = parseInt(b!);
        year = parseInt(c!);
        break;
    }

    // Handle 2-digit years
    if (year < 100) year += 2000; // 25 -> 2025

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }

  // 3. Fallback to chrono-node (handles natural language, many formats)
  // Timezone strategy: chrono-node returns local time, but we extract only date components
  // and reconstruct as UTC to ensure consistent date handling across all parsing paths.
  // This prevents "off-by-one-day" errors from timezone conversions during date comparison.
  const parsed = chrono.parseDate(raw);
  if (parsed) {
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  }

  return null;
}

function formatLocalDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function findColumn(
  available: string[],
  candidates: string | string[],
  exactIndex: boolean = false,
): string | null {
  const candidateList = Array.isArray(candidates) ? candidates : [candidates];

  for (const candidate of candidateList) {
    if (exactIndex) {
      // If exact index required (no header), check if candidate matches an index
      if (available.includes(candidate)) return candidate;
    } else {
      const lower = candidate.toLowerCase();
      const found = available.find((col) => col.toLowerCase() === lower);
      if (found) return found;
    }
  }

  if (!exactIndex) {
    // Try partial match
    for (const candidate of candidateList) {
      const lower = candidate.toLowerCase();
      const found = available.find((col) => col.toLowerCase().includes(lower));
      if (found) return found;
    }
  }

  return null;
}

function detectPreset(columns: string[]): BankPreset | undefined {
  const colSet = new Set(columns.map((c) => c.toLowerCase()));

  if (colSet.has('description 1') || colSet.has('account type')) {
    return BANK_PRESETS['rbc'];
  }
  if (columns.some((c) => c.toLowerCase().includes('cad$'))) {
    return BANK_PRESETS['td'];
  }

  // Generic headered TD-style exports: Date, Description, Amount
  if (colSet.has('date') && colSet.has('description') && colSet.has('amount')) {
    return BANK_PRESETS['td'];
  }

  return undefined;
}

// Currency helpers remain the same
const CURRENCY_SYMBOLS = /[$€£¥]/g;
const CURRENCY_CODES = /\b(CAD|USD|EUR|GBP)\b/gi;

function parseAmount(str: string): {
  valid: boolean;
  valueMilliunits: number;
  reason?: string;
} {
  if (!str || !str.trim()) {
    return { valid: false, valueMilliunits: 0, reason: 'Missing amount value' };
  }

  let cleaned = str.replace(CURRENCY_SYMBOLS, '').replace(CURRENCY_CODES, '').trim();

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
  if (!Number.isFinite(dollars)) {
    return { valid: false, valueMilliunits: 0, reason: `Invalid amount: "${str}"` };
  }

  // Convert to milliunits: $1.00 → 1000
  return { valid: true, valueMilliunits: Math.round(dollars * 1000) };
}
