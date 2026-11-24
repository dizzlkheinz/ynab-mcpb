/**
 * Milliunit <-> currency unit conversion helpers.
 * YNAB stores amounts as integer milliunits (1000 = 1.00 currency unit).
 */

/**
 * Converts an amount from milliunits to a currency amount (major units).
 */
export const milliunitsToAmount = (milliunits: number): number => {
	return Math.round(milliunits) / 1000;
};

/**
 * Converts a currency amount (major units) to integer milliunits.
 */
export const amountToMilliunits = (amount: number): number => {
	if (!Number.isFinite(amount)) {
		throw new Error(`Invalid amount: ${amount} is not a finite number`);
	}
	return Math.round(amount * 1000);
};
