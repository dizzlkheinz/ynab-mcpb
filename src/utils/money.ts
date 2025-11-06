// money.ts
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

export const toMilli = (x: number | string): Milli => {
  const n = Number(x);
  const m = Math.round(n * 1000);
  if (!Number.isFinite(n) || !Number.isSafeInteger(m)) {
    throw new Error(`Invalid/unsafe amount: ${x}`);
  }
  return m;
};

export const fromMilli = (m: Milli): number => m / 1000;

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

const makeFormatter = (currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const formatMoney = (value: Milli, currency: string = DEFAULT_CURRENCY): string =>
  makeFormatter(currency).format(fromMilli(value));

export const toMoneyValue = (value: Milli, currency: string = DEFAULT_CURRENCY): MoneyValue => ({
  value_milliunits: value,
  value: fromMilli(value),
  value_display: formatMoney(value, currency),
  currency,
  direction: moneyDirection(value),
});

export const toMoneyValueFromDecimal = (
  amount: number,
  currency: string = DEFAULT_CURRENCY,
): MoneyValue => toMoneyValue(toMilli(amount), currency);
