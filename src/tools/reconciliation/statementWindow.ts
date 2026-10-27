import {
	formatLocalISODate,
	formatUTCISODate,
	isDateInRange,
	isValidISODate,
} from "../../utils/dateUtils.js";
import type { CSVParseResult } from "./csvParser.js";

export interface StatementWindowBounds {
	startDate?: string;
	endDate?: string;
}

export interface ClampStatementWindowResult {
	parseResult: CSVParseResult;
	excludedCount: number;
	windowApplied: StatementWindowBounds | null;
}

// Date-only forms without a time or zone, which Date parses as local midnight:
// 01/31/2024, 01-31-2024, 2024/01/31, Jan 31, 2024, 31 Jan 2024, Wed, 31 Jan 2024
const ZONELESS_DATE =
	/^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(?:\d{1,2}([/-])\d{1,2}\1\d{4}|\d{4}\/\d{1,2}\/\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4})$/i;

/**
 * Normalize user-provided statement dates to YYYY-MM-DD.
 * Returns undefined for empty or invalid values.
 */
export function normalizeStatementDate(
	value: string | undefined,
): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	// An ISO date, with or without a time ("T", "t" or RFC 3339's space),
	// already names the calendar date
	const isoDate = /^(\d{4}-\d{2}-\d{2})(?:$|[Tt ])/.exec(trimmed)?.[1];
	if (isoDate) {
		return isValidISODate(isoDate) ? isoDate : undefined;
	}

	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) {
		return undefined;
	}

	// Date-only forms parse as local midnight, so format in local time to keep
	// the written date. Anything else (a time, a zone) keeps the UTC date
	return ZONELESS_DATE.test(trimmed)
		? formatLocalISODate(parsed)
		: formatUTCISODate(parsed);
}

export function formatStatementWindow(bounds: StatementWindowBounds): string {
	const start = bounds.startDate ?? "...";
	const end = bounds.endDate ?? "...";
	return `${start} to ${end}`;
}

/**
 * Clamp parsed CSV transactions to the explicit statement window.
 * If no bounds are provided, this returns the original parse result.
 */
export function clampCSVToStatementWindow(
	parseResult: CSVParseResult,
	bounds: StatementWindowBounds,
): ClampStatementWindowResult {
	const start = bounds.startDate;
	const end = bounds.endDate;

	if (!start && !end) {
		return {
			parseResult,
			excludedCount: 0,
			windowApplied: null,
		};
	}

	const transactions = parseResult.transactions.filter((txn) =>
		isDateInRange(txn.date, start, end),
	);

	const excludedCount = parseResult.transactions.length - transactions.length;
	if (excludedCount <= 0) {
		return {
			parseResult,
			excludedCount: 0,
			windowApplied: bounds,
		};
	}

	return {
		parseResult: {
			...parseResult,
			transactions,
			warnings: [
				...parseResult.warnings,
				{
					row: 0,
					message: `Excluded ${excludedCount} CSV transaction(s) outside statement window ${formatStatementWindow(bounds)}.`,
				},
			],
			meta: {
				...parseResult.meta,
				validRows: transactions.length,
				skippedRows: parseResult.meta.skippedRows + excludedCount,
			},
		},
		excludedCount,
		windowApplied: bounds,
	};
}
