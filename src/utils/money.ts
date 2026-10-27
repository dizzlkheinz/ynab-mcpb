// money.ts
import * as ynab from "ynab";

export type Milli = number; // integer milliunits (no bigint)

export type MoneyDirection = "credit" | "debit" | "balanced";

export interface MoneyValue {
	value_milliunits: Milli;
	value: number;
	value_display: string;
	currency: string;
	direction: MoneyDirection;
}

const DEFAULT_CURRENCY = "USD";
const DEFAULT_DECIMAL_DIGITS = 2;

export const toMilli = (x: number | string): Milli => {
	const n = Number(x);
	const m = Math.round(n * 1000);
	if (!Number.isFinite(n) || !Number.isSafeInteger(m)) {
		throw new Error(`Invalid/unsafe amount: ${x}`);
	}
	return m;
};

/**
 * Convert milliunits to currency amount using proper decimal digits
 * Uses YNAB SDK's conversion logic which handles different currency formats
 * @param m - Milliunits value
 * @param decimalDigits - Number of decimal digits for the currency (default: 2 for USD/EUR, 0 for JPY, 3 for BHD, etc.)
 */
export const fromMilli = (
	m: Milli,
	decimalDigits: number = DEFAULT_DECIMAL_DIGITS,
): number => {
	return ynab.utils.convertMilliUnitsToCurrencyAmount(m, decimalDigits);
};

export const addMilli = (a: Milli, b: Milli): Milli => {
	const s = a + b;
	if (!Number.isSafeInteger(s)) throw new Error("Milliunit sum overflow");
	return s;
};

export const moneyDirection = (value: Milli): MoneyDirection => {
	if (value === 0) return "balanced";
	return value > 0 ? "credit" : "debit";
};

const makeFormatter = (
	currency: string,
	decimalDigits: number = DEFAULT_DECIMAL_DIGITS,
) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: decimalDigits,
		maximumFractionDigits: decimalDigits,
	});

/**
 * Format milliunits as currency string with proper decimal digits
 * @param value - Milliunits value
 * @param currency - ISO currency code (default: USD)
 * @param decimalDigits - Number of decimal digits (default: 2)
 */
export const formatMoney = (
	value: Milli,
	currency: string = DEFAULT_CURRENCY,
	decimalDigits: number = DEFAULT_DECIMAL_DIGITS,
): string =>
	makeFormatter(currency, decimalDigits).format(
		fromMilli(value, decimalDigits),
	);

/**
 * Convert milliunits to MoneyValue with proper currency format
 * @param value - Milliunits value
 * @param currency - ISO currency code (default: USD)
 * @param decimalDigits - Number of decimal digits (default: 2)
 */
export const toMoneyValue = (
	value: Milli,
	currency: string = DEFAULT_CURRENCY,
	decimalDigits: number = DEFAULT_DECIMAL_DIGITS,
): MoneyValue => ({
	value_milliunits: value,
	value: fromMilli(value, decimalDigits),
	value_display: formatMoney(value, currency, decimalDigits),
	currency,
	direction: moneyDirection(value),
});

/**
 * Convert decimal amount to MoneyValue
 * @param amount - Decimal amount
 * @param currency - ISO currency code (default: USD)
 * @param decimalDigits - Number of decimal digits (default: 2)
 */
export const toMoneyValueFromDecimal = (
	amount: number,
	currency: string = DEFAULT_CURRENCY,
	decimalDigits: number = DEFAULT_DECIMAL_DIGITS,
): MoneyValue => toMoneyValue(toMilli(amount), currency, decimalDigits);

/**
 * Converts an amount from milliunits to a currency amount (major units).
 * Uses the milliunit boundary of the input value; see `fromMilli` for
 * currency-aware decimal-digit conversion.
 */
export const milliunitsToAmount = (milliunits: number): number => {
	return Math.round(milliunits) / 1000;
};

/**
 * Converts a currency amount (major units) to integer milliunits.
 * Rounds half away from zero for positive amounts and truncates toward
 * zero for negative amounts, matching YNAB's stored-milliunit behavior.
 */
export const amountToMilliunits = (amount: number): number => {
	if (!Number.isFinite(amount)) {
		throw new Error(`Invalid amount: ${amount} is not a finite number`);
	}
	return Math.round(amount * 1000);
};
