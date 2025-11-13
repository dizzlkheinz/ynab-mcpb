// money.ts
import * as ynab from 'ynab';

export type Milli = number; // integer milliunits (no bigint)

export type MoneyDirection = 'credit' | 'debit' | 'balanced';

export interface MoneyValue {
  value_milliunits: Milli;
  value: number;
  value_display: string;
  currency: string;
  direction: MoneyDirection;
}

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_DECIMAL_DIGITS = 2;

/**
 * Extract decimal digits from YNAB CurrencyFormat
 */
export const getDecimalDigits = (
  currencyFormat: ynab.CurrencyFormat | null | undefined,
): number => {
  return currencyFormat?.decimal_digits ?? DEFAULT_DECIMAL_DIGITS;
};

/**
 * Extract ISO currency code from YNAB CurrencyFormat
 */
export const getCurrencyCode = (
  currencyFormat: ynab.CurrencyFormat | null | undefined,
): string => {
  return currencyFormat?.iso_code ?? DEFAULT_CURRENCY;
};

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
export const fromMilli = (m: Milli, decimalDigits: number = DEFAULT_DECIMAL_DIGITS): number => {
  return ynab.utils.convertMilliUnitsToCurrencyAmount(m, decimalDigits);
};

export const assertMilli = (m: number, msg = 'Expected safe integer milliunits') => {
  if (!Number.isSafeInteger(m)) throw new Error(msg);
};

export const addMilli = (a: Milli, b: Milli): Milli => {
  const s = a + b;
  if (!Number.isSafeInteger(s)) throw new Error('Milliunit sum overflow');
  return s;
};

export const inWindow = (
  iso: string,
  start: string | undefined = undefined,
  end: string | undefined = undefined,
) => (!start || iso >= start) && (!end || iso <= end);

export const moneyDirection = (value: Milli): MoneyDirection => {
  if (value === 0) return 'balanced';
  return value > 0 ? 'credit' : 'debit';
};

const makeFormatter = (currency: string, decimalDigits: number = DEFAULT_DECIMAL_DIGITS) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
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
): string => makeFormatter(currency, decimalDigits).format(fromMilli(value, decimalDigits));

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
