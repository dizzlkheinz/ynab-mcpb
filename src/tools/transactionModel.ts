import { z } from "zod/v4";
import { milliunitsToAmount } from "../utils/money.js";

const optionalText = z.string().nullish();

/** Shared transaction fields. Domain amounts always remain integer milliunits. */
export const TransactionLineModelSchema = z.object({
	id: z.string().optional(),
	transaction_id: z.string().optional(),
	scheduled_transaction_id: z.string().optional(),
	amount: z.number().int(),
	memo: optionalText,
	payee_id: optionalText,
	payee_name: optionalText,
	category_id: optionalText,
	category_name: optionalText,
	transfer_account_id: optionalText,
	transfer_transaction_id: optionalText,
	deleted: z.boolean().optional(),
});

export const TransactionModelSchema = TransactionLineModelSchema.extend({
	id: z.string(),
	date: z.string(),
	account_id: z.string(),
	account_name: z.string().optional(),
	cleared: z.string(),
	approved: z.boolean(),
	flag_color: optionalText,
	flag_name: optionalText,
	matched_transaction_id: optionalText,
	import_id: optionalText,
	import_payee_name: optionalText,
	import_payee_name_original: optionalText,
	debt_transaction_type: optionalText,
	type: z.enum(["transaction", "subtransaction"]).optional(),
	parent_transaction_id: optionalText,
	deleted: z.boolean(),
	subtransactions: z.array(TransactionLineModelSchema).optional(),
});

export type TransactionModel = z.infer<typeof TransactionModelSchema>;
export type TransactionLineModel = z.infer<typeof TransactionLineModelSchema>;

export const TransactionLineOutputSchema = TransactionLineModelSchema.extend({
	amount: z.number().describe("Amount in decimal currency units"),
	amount_milliunits: z.number().int().optional(),
	amount_formatted: optionalText,
	amount_currency: z.number().optional(),
});

export const TransactionOutputSchema = TransactionModelSchema.extend({
	amount: TransactionLineOutputSchema.shape.amount,
	amount_milliunits: TransactionLineOutputSchema.shape.amount_milliunits,
	amount_formatted: TransactionLineOutputSchema.shape.amount_formatted,
	amount_currency: TransactionLineOutputSchema.shape.amount_currency,
	subtransactions: z.array(TransactionLineOutputSchema).optional(),
});

export type TransactionOutput = z.infer<typeof TransactionOutputSchema>;

/** Also accepts partial updates and scheduled transactions without inventing fields. */
export interface TransactionFields {
	amount?: number | undefined;
	subtransactions?: readonly TransactionFields[] | undefined;
}

export type SerializedTransaction<T extends TransactionFields> = Omit<
	T,
	"amount" | "subtransactions"
> &
	(T extends { amount: number }
		? { amount: number; amount_milliunits: number }
		: { amount?: number; amount_milliunits?: number }) & {
		subtransactions?: SerializedTransaction<TransactionLineModel>[];
	};

/** The single currency conversion boundary for transaction responses and files. */
export function toTransactionOutput<T extends TransactionFields>(
	transaction: T,
): SerializedTransaction<T> {
	const { amount, subtransactions, ...fields } = transaction;
	return {
		...fields,
		...(amount === undefined
			? {}
			: { amount: milliunitsToAmount(amount), amount_milliunits: amount }),
		...(subtransactions === undefined
			? {}
			: { subtransactions: subtransactions.map(toTransactionOutput) }),
	} as SerializedTransaction<T>;
}

/**
 * Expand active split lines once for analytics. Keep the parent's identity for
 * transaction counts, while preserving each line's payee/category/transfer.
 */
export function transactionPostings(
	transaction: TransactionModel,
): TransactionModel[] {
	if (transaction.deleted) return [];
	if (!transaction.subtransactions?.length) return [transaction];
	return transaction.subtransactions
		.filter((line) => !line.deleted)
		.map((line) => ({
			...transaction,
			...line,
			id: transaction.id,
			amount: line.amount,
			payee_id: line.payee_id ?? transaction.payee_id,
			payee_name: line.payee_name ?? transaction.payee_name,
			category_id: line.category_id ?? null,
			category_name: line.category_name ?? null,
			transfer_account_id:
				line.transfer_account_id ?? transaction.transfer_account_id,
			transfer_transaction_id:
				line.transfer_transaction_id ?? transaction.transfer_transaction_id,
			deleted: false,
			subtransactions: [],
		}));
}
