import { z } from "zod/v4";
import { amountToMilliunits } from "../../utils/amountUtils.js";

export const amountInputShape = {
	amount_decimal: z
		.number()
		.finite("Decimal amount must be finite")
		.optional()
		.describe(
			"Preferred: amount in decimal currency units (for example, -12.34). Rounded exactly to the nearest YNAB milliunit.",
		),
	amount_milliunits: z
		.number()
		.int("amount_milliunits must be an integer")
		.optional()
		.describe(
			"Raw YNAB milliunits. Use only when the value is already converted.",
		),
	amount: z
		.number()
		.int("Amount must be an integer in milliunits")
		.optional()
		.describe(
			"Deprecated legacy alias for amount_milliunits. Use amount_decimal for currency input or amount_milliunits for raw YNAB values.",
		),
} as const;

export const budgetedInputShape = {
	budgeted_decimal: z
		.number()
		.finite("Decimal budgeted amount must be finite")
		.optional()
		.describe(
			"Preferred: category funding amount in decimal currency units (for example, 100.00).",
		),
	budgeted_milliunits: z
		.number()
		.int("budgeted_milliunits must be an integer")
		.optional()
		.describe("Raw YNAB category funding amount in milliunits."),
	budgeted: z
		.number()
		.int("Legacy budgeted amount must be an integer in milliunits")
		.optional()
		.describe(
			"Deprecated legacy alias for budgeted_milliunits. Use budgeted_decimal or budgeted_milliunits.",
		),
} as const;

type AmountFields = {
	amount_decimal?: number | undefined;
	amount_milliunits?: number | undefined;
	amount?: number | undefined;
};

type BudgetedFields = {
	budgeted_decimal?: number | undefined;
	budgeted_milliunits?: number | undefined;
	budgeted?: number | undefined;
};

function definedCount(values: readonly unknown[]): number {
	return values.filter((value) => value !== undefined).length;
}

export function validateRequiredAmount(
	data: AmountFields,
	ctx: z.RefinementCtx,
	path: PropertyKey[] = [],
): void {
	if (
		definedCount([data.amount_decimal, data.amount_milliunits, data.amount]) !==
		1
	) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"Provide exactly one of amount_decimal, amount_milliunits, or deprecated amount",
			path,
		});
	}
}

export function validateOptionalAmount(
	data: AmountFields,
	ctx: z.RefinementCtx,
	path: PropertyKey[] = [],
): void {
	if (
		definedCount([data.amount_decimal, data.amount_milliunits, data.amount]) > 1
	) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"Provide at most one of amount_decimal, amount_milliunits, or deprecated amount",
			path,
		});
	}
}

export function normalizeRequiredAmount<T extends AmountFields>(
	data: T,
): Omit<T, "amount_decimal" | "amount_milliunits" | "amount"> & {
	amount: number;
} {
	const { amount_decimal, amount_milliunits, amount, ...rest } = data;
	return {
		...rest,
		amount:
			amount_decimal !== undefined
				? amountToMilliunits(amount_decimal)
				: (amount_milliunits ?? amount ?? 0),
	};
}

export function normalizeOptionalAmount<T extends AmountFields>(
	data: T,
): Omit<T, "amount_decimal" | "amount_milliunits" | "amount"> & {
	amount?: number | undefined;
} {
	const { amount_decimal, amount_milliunits, amount, ...rest } = data;
	const normalized =
		amount_decimal !== undefined
			? amountToMilliunits(amount_decimal)
			: (amount_milliunits ?? amount);
	return normalized === undefined ? rest : { ...rest, amount: normalized };
}

export function validateRequiredBudgeted(
	data: BudgetedFields,
	ctx: z.RefinementCtx,
): void {
	if (
		definedCount([
			data.budgeted_decimal,
			data.budgeted_milliunits,
			data.budgeted,
		]) !== 1
	) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"Provide exactly one of budgeted_decimal, budgeted_milliunits, or deprecated budgeted",
			path: ["budgeted_decimal"],
		});
	}
}

export function normalizeRequiredBudgeted<T extends BudgetedFields>(
	data: T,
): Omit<T, "budgeted_decimal" | "budgeted_milliunits" | "budgeted"> & {
	budgeted: number;
} {
	const { budgeted_decimal, budgeted_milliunits, budgeted, ...rest } = data;
	return {
		...rest,
		budgeted:
			budgeted_decimal !== undefined
				? amountToMilliunits(budgeted_decimal)
				: (budgeted_milliunits ?? budgeted ?? 0),
	};
}
