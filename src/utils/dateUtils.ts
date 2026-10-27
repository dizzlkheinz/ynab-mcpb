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
