import { readFileSync } from "node:fs";
import { parse as parseDateFns } from "date-fns";
import Papa from "papaparse";
import { formatISODate } from "../../utils/dateUtils.js";
import type { Milli } from "../../utils/money.js";
import { toMilli } from "../../utils/money.js";
import { resolveCsvPathCandidates } from "../csvFilePath.js";
import type { BankTransaction, CSVFormat } from "./types.js";

/**
 * Parse date string using date-fns for better reliability
 */
export function parseDate(dateStr: string, format: string): Date {
	const cleanDate = dateStr.trim();

	// Map our format strings to date-fns format patterns
	const formatMap: Record<string, string> = {
		"MM/DD/YYYY": "MM/dd/yyyy",
		"M/D/YYYY": "M/d/yyyy",
		"DD/MM/YYYY": "dd/MM/yyyy",
		"D/M/YYYY": "d/M/yyyy",
		"YYYY-MM-DD": "yyyy-MM-dd",
		"MM-DD-YYYY": "MM-dd-yyyy",
		"MMM dd, yyyy": "MMM dd, yyyy",
		"MMM d, yyyy": "MMM d, yyyy",
	};

	const dateFnsFormat = formatMap[format];
	if (dateFnsFormat) {
		try {
			const parsed = parseDateFns(cleanDate, dateFnsFormat, new Date());
			if (!Number.isNaN(parsed.getTime())) {
				return parsed;
			}
		} catch {
			// Fall through to generic parsing
		}
	}

	// Fallback to native Date parsing for any unrecognized formats
	const parsed = new Date(cleanDate);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Unable to parse date: ${dateStr} with format: ${format}`);
	}
	return parsed;
}

/**
 * Convert dollar amount to milliunits
 */
export function amountToMilliunits(amountStr: string): Milli {
	const cleaned = amountStr.replace(/[$,\s]/g, "").trim();
	let s = cleaned;
	let neg = false;
	if (s.startsWith("(") && s.endsWith(")")) {
		neg = true;
		s = s.slice(1, -1);
	}
	if (s.startsWith("+")) s = s.slice(1);

	const n = Number(s);
	if (Number.isNaN(n) || !Number.isFinite(n)) {
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
	if (!dateStr) return "MM/DD/YYYY";
	const cleaned = dateStr.trim();

	if (cleaned.includes("/")) {
		return "MM/DD/YYYY";
	}
	if (cleaned.includes("-")) {
		if (/^\d{4}-/.test(cleaned)) {
			return "YYYY-MM-DD";
		}
		return "MM-DD-YYYY";
	}
	if (/^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}$/.test(cleaned)) {
		// Detect "Sep 18, 2025" format
		return "MMM dd, yyyy";
	}
	return "MM/DD/YYYY";
}

/**
 * Detect the most likely delimiter by evaluating candidates across sample lines
 */
function detectDelimiter(lines: string[]): string {
	const candidates = [",", ";", "\t", "|"];
	const sampleLines = lines.slice(0, 3).filter((line) => line.trim()); // Use first 2-3 non-empty lines

	if (sampleLines.length === 0) {
		return ","; // Default fallback
	}

	let bestDelimiter = ",";
	let bestScore = -1;

	for (const delimiter of candidates) {
		let score = 0;
		const columnCounts: number[] = [];
		let parseFailed = false;

		for (const line of sampleLines) {
			try {
				const result = Papa.parse<string[]>(line, {
					delimiter,
					quoteChar: '"',
					skipEmptyLines: true,
				});

				const firstRow = result.data?.[0];
				if (Array.isArray(firstRow)) {
					columnCounts.push(firstRow.length);
				} else {
					// If parsing failed or returned empty, fall back to simple split
					const columns = line.split(delimiter);
					columnCounts.push(columns.length);
				}
			} catch {
				// If parsing fails, fall back to simple split method
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
				if (delimiter === ",") score += 0.5;
				if (delimiter === ";") score += 0.3;

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
	const descriptionPattern =
		/^(description|desc|memo|transaction.*description|payee|merchant)$/i;
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

	return {
		dateColumn,
		amountColumn,
		descriptionColumn,
		debitColumn,
		creditColumn,
	};
}

/**
 * Auto-detect CSV format by analyzing the first few rows
 */
export function autoDetectCSVFormat(csvContent: string): CSVFormat {
	const linesRaw = csvContent.trim().split("\n").slice(0, 3);
	if (linesRaw.length === 0) {
		throw new Error("CSV file is empty");
	}

	// Safely handle the first line - check if it exists and is not empty after trimming
	const firstLineRaw = linesRaw[0];
	if (!firstLineRaw?.trim()) {
		throw new Error("CSV file contains empty first line");
	}

	// Detect delimiter across sample lines
	const delimiter = detectDelimiter(linesRaw);

	const firstLine = firstLineRaw.split(delimiter);
	const hasHeader = !isDateLike(firstLine[0] || "");

	// Check for separate debit/credit columns by looking for empty cells pattern
	let hasDebitCredit = false;
	if (linesRaw.length > 1) {
		const dataLines = hasHeader ? linesRaw.slice(1) : linesRaw;
		hasDebitCredit = dataLines.some((line) => {
			const cols = line.split(delimiter);
			// Look for pattern: amount in col2 OR col3, but not both
			return (
				cols.length >= 4 &&
				((cols[2]?.trim() && !cols[3]?.trim()) ||
					(!cols[2]?.trim() && cols[3]?.trim()))
			);
		});
	}

	if (hasHeader) {
		const {
			dateColumn,
			amountColumn,
			descriptionColumn,
			debitColumn,
			creditColumn,
		} = analyzeHeaders(firstLine);

		const safe = (v?: string) => (v?.trim() ? v : undefined);

		if (hasDebitCredit && debitColumn && creditColumn) {
			const dateCol = safe(dateColumn ?? undefined) ?? safe(firstLine[0]);
			if (!dateCol)
				throw new Error("Unable to detect date column name from header");
			const descCol =
				safe(descriptionColumn ?? undefined) ?? safe(firstLine[1]);
			if (!descCol)
				throw new Error("Unable to detect description column name from header");

			return {
				date_column: dateCol,
				description_column: descCol,
				debit_column: debitColumn,
				credit_column: creditColumn,
				date_format: detectDateFormat(linesRaw[1]?.split(delimiter)[0]),
				has_header: hasHeader,
				delimiter: delimiter,
			};
		}
		const dateCol = safe(dateColumn ?? undefined) ?? safe(firstLine[0]);
		if (!dateCol)
			throw new Error("Unable to detect date column name from header");
		const amountCol = safe(amountColumn ?? undefined) ?? safe(firstLine[1]);
		if (!amountCol)
			throw new Error("Unable to detect amount column name from header");
		const descCol =
			safe(descriptionColumn ?? undefined) ??
			safe(firstLine.length >= 3 ? firstLine[2] : firstLine[1]);
		if (!descCol)
			throw new Error("Unable to detect description column name from header");

		return {
			date_column: dateCol,
			amount_column: amountCol,
			description_column: descCol,
			date_format: detectDateFormat(linesRaw[1]?.split(delimiter)[0]),
			has_header: hasHeader,
			delimiter: delimiter,
		};
	}
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
	}
	return {
		date_column: 0,
		amount_column: 1,
		description_column: firstLine.length >= 3 ? 2 : 1,
		date_format: detectDateFormat(firstLine[0]),
		has_header: hasHeader,
		delimiter: delimiter,
	};
}

/**
 * Automatically fix common CSV issues like unquoted dates with commas
 */
function preprocessCSV(csvContent: string, format: CSVFormat): string {
	// Check if we're dealing with MMM dd, yyyy format dates that might need quoting
	if (
		format.date_format?.includes("MMM") &&
		format.date_format?.includes(",")
	) {
		const lines = csvContent.split("\n");
		const fixedLines = lines.map((line, index) => {
			// Skip header row
			if (format.has_header && index === 0) return line;
			if (!line.trim()) return line;

			// Check if this line has unquoted dates (more commas than expected)
			const parts = line.split(format.delimiter);
			const expectedColumns = format.has_header
				? lines[0]?.split(format.delimiter).length || 3
				: 3;

			if (parts.length > expectedColumns) {
				// Check if we have a date pattern split across first two parts (like "Sep 18, 2025")
				const potentialDate = parts.slice(0, 2).join(",");
				if (/^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}/.test(potentialDate)) {
					// This looks like "Sep 18, 2025" - quote it
					const dateField = parts.slice(0, 2).join(","); // "Sep 18, 2025"
					const remainingFields = parts.slice(2);
					return `"${dateField}"${format.delimiter}${remainingFields.join(format.delimiter)}`;
				}
			}

			return line;
		});

		return fixedLines.join("\n");
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
	assertIndexedDebitCreditColumns(format);

	// Preprocess CSV to fix common issues like unquoted dates
	const processedCSV = preprocessCSV(csvContent, format);

	const parsed = Papa.parse<string[] | Record<string, string>>(processedCSV, {
		delimiter: format.delimiter,
		header: format.has_header,
		skipEmptyLines: true,
		transformHeader: (header) => header.trim(),
		transform: (value) => value.trim(),
		quoteChar: '"',
	});
	const records = parsed.data.filter((record) => record != null);

	const transactions: BankTransaction[] = [];

	for (const [i, record] of records.entries()) {
		const rowNumber = format.has_header ? i + 2 : i + 1; // Account for header row

		try {
			const transaction = parseBankRow(record, format, rowNumber, options);
			if (transaction) {
				transactions.push(transaction);
			}
		} catch (error) {
			if (options.debug) {
				console.warn(`Error parsing row ${rowNumber}:`, error);
			}
		}
	}

	return transactions;
}

interface RawRowFields {
	rawDate: string;
	rawAmount: string;
	description: string;
}

/**
 * Parse a single CSV record, returning null for rows that should be skipped.
 * @throws {Error} when no amount column is configured or the date is unparseable
 */
function parseBankRow(
	record: string[] | Record<string, string>,
	format: CSVFormat,
	rowNumber: number,
	options: { debug?: boolean },
): BankTransaction | null {
	const { rawDate, rawAmount, description } = format.has_header
		? // Record is an object when using headers
			extractHeaderedFields(record as Record<string, string>, format)
		: // Record is an array when not using headers, so use column indices
			extractIndexedFields(record as string[], format);

	if (!rawDate || !rawAmount) {
		if (options.debug) {
			console.warn(`Skipping row ${rowNumber}: missing date or amount`);
		}
		return null;
	}

	const date = parseDate(rawDate, format.date_format);
	let amount: Milli;
	try {
		amount = amountToMilliunits(rawAmount);
	} catch (error) {
		if (options.debug) {
			console.warn(
				`Skipping row ${rowNumber}: ${error instanceof Error ? error.message : "Invalid amount"}`,
			);
		}
		return null;
	}

	return {
		date,
		amount,
		description: description.trim(),
		raw_amount: rawAmount,
		raw_date: rawDate,
		row_number: rowNumber,
	};
}

function extractHeaderedFields(
	record: Record<string, string>,
	format: CSVFormat,
): RawRowFields {
	const rawDate = record[format.date_column as string] || "";

	let rawAmount: string;
	if (format.amount_column) {
		rawAmount = record[format.amount_column as string] || "";
	} else if (
		format.debit_column !== undefined &&
		format.credit_column !== undefined
	) {
		rawAmount = combineDebitCredit(
			record[format.debit_column as string] || "",
			record[format.credit_column as string] || "",
		);
	} else {
		throw new Error("No amount column configuration found");
	}

	const description = record[format.description_column as string] || "";
	return { rawDate, rawAmount, description };
}

function extractIndexedFields(
	record: string[],
	format: CSVFormat,
): RawRowFields {
	const dateIndex = toColumnIndex(format.date_column);
	const descIndex = toColumnIndex(format.description_column);

	// Validate indices are valid numbers (fallback to defaults if invalid)
	const safeDateIndex = Number.isNaN(dateIndex) ? 0 : dateIndex;
	const safeDescIndex = Number.isNaN(descIndex) ? 2 : descIndex;

	const rawDate = record[safeDateIndex] || "";

	let rawAmount: string;
	if (format.amount_column !== undefined) {
		const amountIndex = toColumnIndex(format.amount_column);
		const safeAmountIndex = Number.isNaN(amountIndex) ? 1 : amountIndex;
		rawAmount = record[safeAmountIndex] || "";
	} else if (
		format.debit_column !== undefined &&
		format.credit_column !== undefined
	) {
		rawAmount = combineDebitCredit(
			record[toColumnIndex(format.debit_column)] || "",
			record[toColumnIndex(format.credit_column)] || "",
		);
	} else {
		throw new Error("No amount column configuration found");
	}

	const description = record[safeDescIndex] || "";
	return { rawDate, rawAmount, description };
}

function toColumnIndex(column: string | number): number {
	return typeof column === "number" ? column : Number.parseInt(column, 10);
}

/**
 * Convert separate debit/credit values into one signed raw amount: debits
 * negative and credits positive, whatever sign or parentheses the bank used.
 * Explicit zeros give "0"; "" only when neither cell holds a number, so blank
 * rows such as "balance forward" lines are skipped.
 */
function combineDebitCredit(debitVal: string, creditVal: string): string {
	const debitMagnitude = debitVal.replace(/[^\d.]/g, "");
	const creditMagnitude = creditVal.replace(/[^\d.]/g, "");
	const debitNum = Number.parseFloat(debitMagnitude);
	const creditNum = Number.parseFloat(creditMagnitude);
	if (!Number.isNaN(debitNum) && debitNum !== 0) {
		return `-${debitMagnitude}`;
	}
	if (!Number.isNaN(creditNum) && creditNum !== 0) {
		return creditMagnitude;
	}
	return Number.isNaN(debitNum) && Number.isNaN(creditNum) ? "" : "0";
}

/**
 * Without a header row, debit/credit columns must be numeric indices; a
 * column name would read record[NaN] on every row and silently drop them all.
 * @throws {Error} when a configured debit/credit column is not an index
 */
function assertIndexedDebitCreditColumns(format: CSVFormat): void {
	if (format.has_header || format.amount_column !== undefined) return;
	for (const [label, column] of [
		["debit_column", format.debit_column],
		["credit_column", format.credit_column],
	] as const) {
		if (column !== undefined && Number.isNaN(toColumnIndex(column))) {
			throw new Error(
				`${label} "${column}" must be a column index when has_header is false`,
			);
		}
	}
}

/**
 * Read CSV file safely with error handling
 */
export function readCSVFile(filePath: string): string {
	const pathCandidates = resolveCsvPathCandidates(filePath);
	let lastReadError: unknown;

	for (const candidatePath of pathCandidates) {
		try {
			return readFileSync(candidatePath, "utf-8");
		} catch (error) {
			lastReadError = error;
		}
	}

	const attemptedPaths =
		pathCandidates.length > 0 ? pathCandidates.join(", ") : filePath;
	throw new Error(
		`Unable to read CSV file. Tried path(s): ${attemptedPaths}. ${
			lastReadError instanceof Error ? lastReadError.message : "Unknown error"
		}`,
	);
}

/**
 * Extract date range from CSV bank statement
 * Returns min and max dates in YYYY-MM-DD format
 */
export function extractDateRangeFromCSV(
	csvContent: string,
	format: CSVFormat,
): { minDate: string; maxDate: string } {
	const transactions = parseBankCSV(csvContent, format);

	if (transactions.length === 0) {
		throw new Error("No transactions found in CSV");
	}

	// Extract all dates (already Date objects from parseBankCSV)
	const dates = transactions.map((txn) => txn.date.getTime());

	// Find min and max
	const minDateObj = new Date(Math.min(...dates));
	const maxDateObj = new Date(Math.max(...dates));

	return {
		minDate: formatISODate(minDateObj),
		maxDate: formatISODate(maxDateObj),
	};
}
