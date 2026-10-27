/**
 * Date validation utilities for YNAB MCP Server (date-fns based)
 */

import { isValid, parse } from "date-fns";

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
 * Formats a date as YYYY-MM-DD in UTC, so the result does not depend on the
 * host time zone
 */
export function formatISODate(date: Date): string {
	return date.toISOString().slice(0, 10);
}
