/**
 * Utility functions for converting between YNAB milliunits and dollars
 */

/**
 * Converts an amount from milliunits to dollars
 * @param milliunits - Amount in milliunits (1000 milliunits = $1.00)
 * @returns Amount in dollars as a number with 2 decimal places
 */
export function milliunitsToAmount(milliunits: number): number {
	return Math.round(milliunits) / 1000;
}

/**
 * Converts an amount from dollars to milliunits
 * @param amount - Amount in dollars
 * @returns Amount in milliunits
 */
export function amountToMilliunits(amount: number): number {
	return Math.round(amount * 1000);
}

/**
 * Formats an amount from milliunits to a currency string
 * @param milliunits - Amount in milliunits
 * @param currencySymbol - Currency symbol (default: '$')
 * @returns Formatted currency string
 */
export function formatAmount(milliunits: number, currencySymbol = "$"): string {
	const amount = milliunitsToAmount(milliunits);
	return `${currencySymbol}${amount.toFixed(2)}`;
}
