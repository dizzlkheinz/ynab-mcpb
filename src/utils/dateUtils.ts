/**
 * Unified date utilities for YNAB MCP Server
 *
 * All date formatting should use these utilities to ensure consistency
 * and prevent bugs like the duplicate month issue.
 *
 * Uses date-fns internally for robust date operations while providing
 * YNAB-specific business logic.
 */

import { format, isValid, parse, subMonths } from "date-fns";

/**
 * Formats a date as YYYY-MM-01 (YNAB month format)
 * @param date The date to format
 * @returns Formatted date string in YYYY-MM-01 format
 */
export function formatYNABMonth(date: Date): string {
	return format(date, "yyyy-MM-'01'");
}

/**
 * Formats a date as YYYY-MM-DD (ISO date format)
 * @param date The date to format
 * @returns Formatted date string in YYYY-MM-DD format
 */
export function formatISODate(date: Date): string {
	return format(date, "yyyy-MM-dd");
}

/**
 * Gets the current month in YNAB format (YYYY-MM-01)
 * @returns Current month formatted as YYYY-MM-01
 */
export function getCurrentMonth(): string {
	return formatYNABMonth(new Date());
}

/**
 * Gets today's date in ISO format (YYYY-MM-DD)
 * @returns Today's date formatted as YYYY-MM-DD
 */
export function getToday(): string {
	return formatISODate(new Date());
}

/**
 * Generates an array of historical months going backwards from a start date
 * @param monthCount Number of months to generate
 * @param startDate The starting date (defaults to current date)
 * @returns Array of month strings in YYYY-MM-01 format, ordered newest to oldest
 */
export function getHistoricalMonths(
	monthCount: number,
	startDate?: Date,
): string[] {
	const baseDate = startDate || new Date();

	return Array.from({ length: monthCount }, (_, i) => {
		const date = subMonths(baseDate, i);
		return formatYNABMonth(date);
	});
}

/**
 * Subtracts months from a date
 * @param date The base date
 * @param months Number of months to subtract
 * @returns New date with months subtracted
 */
export function subtractMonths(date: Date, months: number): Date {
	return subMonths(date, months);
}

/**
 * Validates if a string is in YYYY-MM-DD format
 * @param dateString The string to validate
 * @returns True if valid ISO date format
 */
export function isValidISODate(dateString: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
		return false;
	}
	const parsed = parse(dateString, "yyyy-MM-dd", new Date());
	return isValid(parsed);
}

/**
 * Validates if a string is in YYYY-MM-01 format (YNAB month format)
 * @param monthString The string to validate
 * @returns True if valid YNAB month format
 */
export function isValidYNABMonth(monthString: string): boolean {
	if (!/^\d{4}-\d{2}-01$/.test(monthString)) {
		return false;
	}
	const parsed = parse(monthString, "yyyy-MM-'01'", new Date());
	return isValid(parsed);
}

/**
 * Converts a YYYY-MM format to YYYY-MM-01 format
 * @param yearMonth String in YYYY-MM format
 * @returns String in YYYY-MM-01 format
 */
export function yearMonthToYNABMonth(yearMonth: string): string {
	if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
		throw new Error("Invalid year-month format. Expected YYYY-MM");
	}
	return `${yearMonth}-01`;
}
