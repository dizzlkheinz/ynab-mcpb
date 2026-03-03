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

/**
 * Normalize user-provided statement dates to YYYY-MM-DD.
 * Returns undefined for empty or invalid values.
 */
export function normalizeStatementDate(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return trimmed;
	}

	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) {
		return undefined;
	}

	return parsed.toISOString().split("T")[0];
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

	const transactions = parseResult.transactions.filter((txn) => {
		const date = txn.date;
		if (start && date < start) {
			return false;
		}
		if (end && date > end) {
			return false;
		}
		return true;
	});

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
