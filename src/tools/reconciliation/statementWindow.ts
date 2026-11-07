import { isDateInRange } from "../../utils/dateUtils.js";
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
