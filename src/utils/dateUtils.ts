/**
 * ISO date (YYYY-MM-DD) validation and formatting for YNAB MCP Server
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates if a string is in YYYY-MM-DD format and represents a real calendar date.
 */
export function isValidISODate(dateString: string): boolean {
	const match = ISO_DATE_PATTERN.exec(dateString);
	if (!match) {
		return false;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === day
	);
}

/**
 * Formats a date as YYYY-MM-DD in UTC, so the result does not depend on the
 * host time zone. Use for dates built with Date.UTC or parsed from date-only
 * strings.
 */
export function formatUTCISODate(date: Date): string {
	const iso = date.toISOString();
	// Not slice(0, 10): years past 9999 are written as +010000
	return iso.slice(0, iso.indexOf("T"));
}

/**
 * Whether a YYYY-MM-DD date falls inside an optional, inclusive [start, end]
 * range. ISO dates sort as text, so this compares strings.
 */
export function isDateInRange(
	isoDate: string,
	start?: string,
	end?: string,
): boolean {
	return (!start || isoDate >= start) && (!end || isoDate <= end);
}

/**
 * Formats a date as YYYY-MM-DD in the host's local time zone. Use for "today"
 * defaults, where the user's calendar date matters rather than UTC's.
 */
export function formatLocalISODate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
