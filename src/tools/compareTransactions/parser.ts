/** Compatibility adapters: all parsing is owned by reconciliation/csvParser. */
import { readFileSync } from "node:fs";
import { resolveCsvPathCandidates } from "../csvFilePath.js";

import { type ParseCSVOptions, parseCSV } from "../reconciliation/csvParser.js";
import type { BankTransaction, CSVFormat } from "./types.js";

export function dateFormatHint(
	format?: string,
): NonNullable<ParseCSVOptions["dateFormat"]> {
	const normalized = format?.toUpperCase().replace(/[^YMD]/g, "");
	return normalized?.startsWith("Y")
		? "YMD"
		: normalized?.startsWith("D")
			? "DMY"
			: "MDY";
}
export function detectDateFormat(date?: string): string {
	return date?.match(/^\d{4}-/)
		? "YYYY-MM-DD"
		: date?.match(/^[A-Za-z]{3}/)
			? "MMM dd, yyyy"
			: date?.includes("-")
				? "MM-DD-YYYY"
				: "MM/DD/YYYY";
}
export function toParseOptions(format?: CSVFormat): ParseCSVOptions {
	if (!format) return {};
	const columns: NonNullable<ParseCSVOptions["columns"]> = {};
	for (const [source, target] of [
		["date_column", "date"],
		["amount_column", "amount"],
		["debit_column", "debit"],
		["credit_column", "credit"],
		["description_column", "description"],
	] as const) {
		const value = format[source];
		if (value !== undefined) columns[target] = String(value);
	}
	return {
		columns,
		...(format.delimiter ? { delimiter: format.delimiter } : {}),
		...(format.has_header !== undefined ? { header: format.has_header } : {}),
		dateFormat: dateFormatHint(format.date_format),
	};
}
export function autoDetectCSVFormat(content: string): CSVFormat {
	if (!content.trim()) throw new Error("CSV file contains empty first line");
	const result = parseCSV(content);
	const format = result.meta.format;
	if (!format) throw new Error("Could not auto-detect CSV format");
	const column = (value: string | null, fallback: number) =>
		format.header
			? (value ?? result.meta.detectedColumns[fallback] ?? "")
			: Number(value ?? fallback);
	return {
		date_column: column(format.columns.dateCol, 0),
		description_column: column(format.columns.descCol, 2),
		...(!format.columns.debitCol
			? { amount_column: column(format.columns.amountCol, 1) }
			: {}),
		...(format.columns.debitCol
			? { debit_column: format.columns.debitCol }
			: {}),
		...(format.columns.creditCol
			? { credit_column: format.columns.creditCol }
			: {}),
		has_header: format.header,
		delimiter: result.meta.detectedDelimiter,
		date_format:
			format.dateFormat === "YMD"
				? "YYYY-MM-DD"
				: format.dateFormat === "DMY"
					? "DD/MM/YYYY"
					: detectDateFormat(result.transactions[0]?.raw.date),
	};
}
export function parseBankCSV(
	content: string,
	format: CSVFormat,
	_options: { debug?: boolean } = {},
): BankTransaction[] {
	for (const name of ["debit_column", "credit_column"] as const) {
		if (
			!format.has_header &&
			format[name] !== undefined &&
			!/^\d+$/.test(String(format[name]))
		)
			throw new Error(
				`${name} "${format[name]}" must be a column index when there is no header`,
			);
	}
	const result = parseCSV(content, toParseOptions(format));
	return result.transactions.map((transaction) => ({
		date: new Date(`${transaction.date}T00:00:00Z`),
		amount: transaction.amount,
		description: transaction.raw.description,
		raw_amount:
			format.debit_column !== undefined
				? String(transaction.amount / 1000)
				: transaction.raw.amount,
		raw_date: transaction.raw.date,
		row_number: transaction.sourceRow,
	}));
}

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
