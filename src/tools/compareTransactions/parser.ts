import { parse } from 'csv-parse/sync';
import { parse as parseDateFns } from 'date-fns';
import { toMilli } from '../../utils/money.js';
import type { Milli } from '../../utils/money.js';
import { BankTransaction, CSVFormat } from './types.js';
import { readFileSync } from 'fs';

/**
 * Parse date string using date-fns for better reliability
 */
export function parseDate(dateStr: string, format: string): Date {
  const cleanDate = dateStr.trim();

  // Map our format strings to date-fns format patterns
  const formatMap: Record<string, string> = {
    'MM/DD/YYYY': 'MM/dd/yyyy',
    'M/D/YYYY': 'M/d/yyyy',
    'DD/MM/YYYY': 'dd/MM/yyyy',
    'D/M/YYYY': 'd/M/yyyy',
    'YYYY-MM-DD': 'yyyy-MM-dd',
    'MM-DD-YYYY': 'MM-dd-yyyy',
    'MMM dd, yyyy': 'MMM dd, yyyy',
    'MMM d, yyyy': 'MMM d, yyyy',
  };

  const dateFnsFormat = formatMap[format];
  if (dateFnsFormat) {
    try {
      const parsed = parseDateFns(cleanDate, dateFnsFormat, new Date());
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    } catch {
      // Fall through to generic parsing
    }
  }

  // Fallback to native Date parsing for any unrecognized formats
  const parsed = new Date(cleanDate);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Unable to parse date: ${dateStr} with format: ${format}`);
  }
  return parsed;
}

/**
 * Convert dollar amount to milliunits
 */
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

/**
 * Check if a string looks like a date
 */
function isDateLike(str: string): boolean {
  if (!str) return false;
  // Common date patterns
  const datePatterns = [
    /^\d{1,2}\/\d{1,2}\/\d{4}$/, // MM/DD/YYYY
    /^\d{4}-\d{1,2}-\d{1,2}$/, // YYYY-MM-DD
    /^\d{1,2}-\d{1,2}-\d{4}$/, // MM-DD-YYYY
    /^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}$/, // MMM dd, yyyy (e.g., "Sep 18, 2025")
  ];
  return datePatterns.some((pattern) => pattern.test(str.trim()));
}

/**
 * Detect date format from a sample date string
 */
export function detectDateFormat(dateStr: string | undefined): string {
  if (!dateStr) return 'MM/DD/YYYY';
  const cleaned = dateStr.trim();

  if (cleaned.includes('/')) {
    return 'MM/DD/YYYY';
  } else if (cleaned.includes('-')) {
    if (/^\d{4}-/.test(cleaned)) {
      return 'YYYY-MM-DD';
    } else {
      return 'MM-DD-YYYY';
    }
  } else if (/^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}$/.test(cleaned)) {
    // Detect "Sep 18, 2025" format
    return 'MMM dd, yyyy';
  }
  return 'MM/DD/YYYY';
}

/**
 * Detect the most likely delimiter by evaluating candidates across sample lines
 */
function detectDelimiter(lines: string[]): string {
  const candidates = [',', ';', '\t', '|'];
  const sampleLines = lines.slice(0, 3).filter((line) => line.trim()); // Use first 2-3 non-empty lines

  if (sampleLines.length === 0) {
    return ','; // Default fallback
  }

  let bestDelimiter = ',';
  let bestScore = -1;

  for (const delimiter of candidates) {
    let score = 0;
    const columnCounts: number[] = [];
    let parseFailed = false;

    for (const line of sampleLines) {
      try {
        const rows = parse(line, {
          delimiter,
          quote: '"',
          escape: '"',
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        });

        // rows should be an array with one row (since we're parsing one line)
        if (rows && rows.length > 0 && rows[0]) {
          const columns = Array.isArray(rows[0]) ? rows[0] : Object.values(rows[0]);
          columnCounts.push(columns.length);
        } else {
          // If parsing failed or returned empty, fall back to simple split
          const columns = line.split(delimiter);
          columnCounts.push(columns.length);
        }
      } catch {
        // If csv-parse fails, fall back to simple split method
        parseFailed = true;
        const columns = line.split(delimiter);
        columnCounts.push(columns.length);
      }
    }

    // Check consistency: all lines should have the same column count
    if (columnCounts.length > 1) {
      const firstCount = columnCounts[0];
      if (firstCount === undefined) continue;
      const isConsistent = columnCounts.every((count) => count === firstCount);

      if (isConsistent && firstCount > 1) {
        // Score based on column count (more columns = better, up to a reasonable limit)
        score = Math.min(firstCount, 10); // Cap at 10 to avoid excessive weight

        // Bonus points for common delimiters
        if (delimiter === ',') score += 0.5;
        if (delimiter === ';') score += 0.3;

        // Bonus points if csv-parse succeeded (indicates proper CSV format)
        if (!parseFailed) score += 0.2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

/**
 * Analyze header names to detect column purposes
 */
function analyzeHeaders(headers: string[]): {
  dateColumn: string | null;
  amountColumn: string | null;
  descriptionColumn: string | null;
  debitColumn: string | null;
  creditColumn: string | null;
} {
  const datePattern = /^(date|trans.*date|transaction.*date|post.*date|dt)$/i;
  const amountPattern = /^(amount|amt|dollar.*amount|transaction.*amount)$/i;
  const descriptionPattern = /^(description|desc|memo|transaction.*description|payee|merchant)$/i;
  const debitPattern = /^(debit|debits|withdrawal|withdrawals|out|outgoing)$/i;
  const creditPattern = /^(credit|credits|deposit|deposits|in|incoming)$/i;

  let dateColumn: string | null = null;
  let amountColumn: string | null = null;
  let descriptionColumn: string | null = null;
  let debitColumn: string | null = null;
  let creditColumn: string | null = null;

  for (const header of headers) {
    const cleanHeader = header.trim();

    if (datePattern.test(cleanHeader)) {
      dateColumn = cleanHeader;
    } else if (amountPattern.test(cleanHeader)) {
      amountColumn = cleanHeader;
    } else if (descriptionPattern.test(cleanHeader)) {
      descriptionColumn = cleanHeader;
    } else if (debitPattern.test(cleanHeader)) {
      debitColumn = cleanHeader;
    } else if (creditPattern.test(cleanHeader)) {
      creditColumn = cleanHeader;
    }
  }

  return { dateColumn, amountColumn, descriptionColumn, debitColumn, creditColumn };
}

/**
 * Auto-detect CSV format by analyzing the first few rows
 */
export function autoDetectCSVFormat(csvContent: string): CSVFormat {
  const linesRaw = csvContent.trim().split('\n').slice(0, 3);
  if (linesRaw.length === 0) {
    throw new Error('CSV file is empty');
  }

  // Safely handle the first line - check if it exists and is not empty after trimming
  const firstLineRaw = linesRaw[0];
  if (!firstLineRaw || !firstLineRaw.trim()) {
    throw new Error('CSV file contains empty first line');
  }

  // Detect delimiter across sample lines
  const delimiter = detectDelimiter(linesRaw);

  const firstLine = firstLineRaw.split(delimiter);
  const hasHeader = !isDateLike(firstLine[0] || '');

  // Check for separate debit/credit columns by looking for empty cells pattern
  let hasDebitCredit = false;
  if (linesRaw.length > 1) {
    const dataLines = hasHeader ? linesRaw.slice(1) : linesRaw;
    hasDebitCredit = dataLines.some((line) => {
      const cols = line.split(delimiter);
      // Look for pattern: amount in col2 OR col3, but not both
      return (
        cols.length >= 4 &&
        ((cols[2]?.trim() && !cols[3]?.trim()) || (!cols[2]?.trim() && cols[3]?.trim()))
      );
    });
  }

  if (hasHeader) {
    const { dateColumn, amountColumn, descriptionColumn, debitColumn, creditColumn } =
      analyzeHeaders(firstLine);

    const safe = (v?: string) => (v && v.trim() ? v : undefined);

    if (hasDebitCredit && debitColumn && creditColumn) {
      const dateCol = safe(dateColumn ?? undefined) ?? safe(firstLine[0]);
      if (!dateCol) throw new Error('Unable to detect date column name from header');
      const descCol = safe(descriptionColumn ?? undefined) ?? safe(firstLine[1]);
      if (!descCol) throw new Error('Unable to detect description column name from header');

      return {
        date_column: dateCol,
        description_column: descCol,
        debit_column: debitColumn,
        credit_column: creditColumn,
        date_format: detectDateFormat(linesRaw[1]?.split(delimiter)[0]),
        has_header: hasHeader,
        delimiter: delimiter,
      };
    } else {
      const dateCol = safe(dateColumn ?? undefined) ?? safe(firstLine[0]);
      if (!dateCol) throw new Error('Unable to detect date column name from header');
      const amountCol = safe(amountColumn ?? undefined) ?? safe(firstLine[1]);
      if (!amountCol) throw new Error('Unable to detect amount column name from header');
      const descCol =
        safe(descriptionColumn ?? undefined) ??
        safe(firstLine.length >= 3 ? firstLine[2] : firstLine[1]);
      if (!descCol) throw new Error('Unable to detect description column name from header');

      return {
        date_column: dateCol,
        amount_column: amountCol,
        description_column: descCol,
        date_format: detectDateFormat(linesRaw[1]?.split(delimiter)[0]),
        has_header: hasHeader,
        delimiter: delimiter,
      };
    }
  } else {
    if (hasDebitCredit && firstLine.length >= 4) {
      return {
        date_column: 0,
        description_column: 1,
        debit_column: 2,
        credit_column: 3,
        date_format: detectDateFormat(firstLine[0]),
        has_header: hasHeader,
        delimiter: delimiter,
      };
    } else {
      return {
        date_column: 0,
        amount_column: 1,
        description_column: firstLine.length >= 3 ? 2 : 1,
        date_format: detectDateFormat(firstLine[0]),
        has_header: hasHeader,
        delimiter: delimiter,
      };
    }
  }
}

/**
 * Automatically fix common CSV issues like unquoted dates with commas
 */
function preprocessCSV(csvContent: string, format: CSVFormat): string {
  // Check if we're dealing with MMM dd, yyyy format dates that might need quoting
  if (format.date_format?.includes('MMM') && format.date_format?.includes(',')) {
    const lines = csvContent.split('\n');
    const fixedLines = lines.map((line, index) => {
      // Skip header row
      if (format.has_header && index === 0) return line;
      if (!line.trim()) return line;

      // Check if this line has unquoted dates (more commas than expected)
      const parts = line.split(format.delimiter);
      const expectedColumns = format.has_header ? lines[0]?.split(format.delimiter).length || 3 : 3;

      if (parts.length > expectedColumns) {
        // Check if we have a date pattern split across first two parts (like "Sep 18, 2025")
        const potentialDate = parts.slice(0, 2).join(',');
        if (/^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}/.test(potentialDate)) {
          // This looks like "Sep 18, 2025" - quote it
          const dateField = parts.slice(0, 2).join(','); // "Sep 18, 2025"
          const remainingFields = parts.slice(2);
          return `"${dateField}"${format.delimiter}${remainingFields.join(format.delimiter)}`;
        }
      }

      return line;
    });

    return fixedLines.join('\n');
  }

  return csvContent;
}

/**
 * Parse CSV data into bank transactions
 */
export function parseBankCSV(
  csvContent: string,
  format: CSVFormat,
  options: { debug?: boolean } = {},
): BankTransaction[] {
  // Preprocess CSV to fix common issues like unquoted dates
  const processedCSV = preprocessCSV(csvContent, format);

  const records = parse(processedCSV, {
    delimiter: format.delimiter,
    columns: format.has_header,
    skip_empty_lines: true,
    trim: true,
    // Enhanced CSV parsing options for robust handling
    quote: '"', // Handle quoted fields (for dates with commas)
    escape: '"', // Handle escaped quotes within fields
    relax_column_count: true, // Handle varying column counts
    // Removed deprecated auto_parse and auto_parse_date options
    // Removed relax_quotes as it may not be supported in current csv-parse version
  });

  const transactions: BankTransaction[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rowNumber = format.has_header ? i + 2 : i + 1; // Account for header row

    try {
      let rawDate: string;
      let rawAmount: string;
      let description: string;

      if (format.has_header) {
        // Record is an object when using headers
        const recordObj = record as unknown as Record<string, string>;
        rawDate = recordObj[format.date_column as string] || '';

        if (format.amount_column) {
          rawAmount = recordObj[format.amount_column as string] || '';
        } else if (format.debit_column !== undefined && format.credit_column !== undefined) {
          const debitVal = recordObj[format.debit_column as string] || '';
          const creditVal = recordObj[format.credit_column as string] || '';
          // Convert: debits negative, credits positive
          // Check if debit has a value and is non-zero
          const debitNum = parseFloat(debitVal.replace(/[^\d.-]/g, ''));
          const creditNum = parseFloat(creditVal.replace(/[^\d.-]/g, ''));
          if (!isNaN(debitNum) && debitNum !== 0) {
            rawAmount = `-${debitVal}`;
          } else if (!isNaN(creditNum) && creditNum !== 0) {
            rawAmount = creditVal;
          } else {
            rawAmount = '0';
          }
        } else {
          throw new Error('No amount column configuration found');
        }

        description = recordObj[format.description_column as string] || '';
      } else {
        // Record is an array when not using headers, so use column indices
        const recordArray = record as string[];
        const dateIndex =
          typeof format.date_column === 'number'
            ? format.date_column
            : parseInt(format.date_column, 10);
        const descIndex =
          typeof format.description_column === 'number'
            ? format.description_column
            : parseInt(format.description_column, 10);

        // Validate indices are valid numbers (fallback to defaults if invalid)
        const safeDateIndex = isNaN(dateIndex) ? 0 : dateIndex;
        const safeDescIndex = isNaN(descIndex) ? 2 : descIndex;

        rawDate = recordArray[safeDateIndex] || '';

        if (format.amount_column !== undefined) {
          const amountIndex =
            typeof format.amount_column === 'number'
              ? format.amount_column
              : parseInt(format.amount_column, 10);
          const safeAmountIndex = isNaN(amountIndex) ? 1 : amountIndex;
          rawAmount = recordArray[safeAmountIndex] || '';
        } else if (format.debit_column !== undefined && format.credit_column !== undefined) {
          const debitIndex =
            typeof format.debit_column === 'number'
              ? format.debit_column
              : parseInt(format.debit_column, 10);
          const creditIndex =
            typeof format.credit_column === 'number'
              ? format.credit_column
              : parseInt(format.credit_column, 10);

          const debitVal = recordArray[debitIndex] || '';
          const creditVal = recordArray[creditIndex] || '';

          // Convert: debits negative, credits positive
          // Check if debit has a value and is non-zero
          const debitNum = parseFloat(debitVal.replace(/[^\d.-]/g, ''));
          const creditNum = parseFloat(creditVal.replace(/[^\d.-]/g, ''));
          if (!isNaN(debitNum) && debitNum !== 0) {
            rawAmount = `-${debitVal}`;
          } else if (!isNaN(creditNum) && creditNum !== 0) {
            rawAmount = creditVal;
          } else {
            rawAmount = '0';
          }
        } else {
          throw new Error('No amount column configuration found');
        }

        description = recordArray[safeDescIndex] || '';
      }

      if (!rawDate || !rawAmount) {
        if (options.debug) {
          console.warn(`Skipping row ${rowNumber}: missing date or amount`);
        }
        continue;
      }

      const date = parseDate(rawDate, format.date_format);
      let amount: Milli;
      try {
        amount = amountToMilliunits(rawAmount);
      } catch (error) {
        if (options.debug) {
          console.warn(
            `Skipping row ${rowNumber}: ${error instanceof Error ? error.message : 'Invalid amount'}`,
          );
        }
        continue;
      }

      transactions.push({
        date,
        amount,
        description: description.trim(),
        raw_amount: rawAmount,
        raw_date: rawDate,
        row_number: rowNumber,
      });
    } catch (error) {
      if (options.debug) {
        console.warn(`Error parsing row ${rowNumber}:`, error);
      }
      continue;
    }
  }

  return transactions;
}

/**
 * Read CSV file safely with error handling
 */
export function readCSVFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Unable to read CSV file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
