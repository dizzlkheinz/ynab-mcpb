import type * as ynab from "ynab";
import { z } from "zod/v4";

/**
 * Transaction Schemas and Types
 *
 * This module contains all Zod schemas and TypeScript types for transaction-related tools.
 * Extracted from transactionTools.ts for better code organization.
 */

// ============================================================================
// List Transactions
// ============================================================================

/**
 * Schema for ynab:list_transactions tool parameters
 */
export const ListTransactionsSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		account_id: z.string().optional(),
		category_id: z.string().optional(),
		since_date: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in ISO format (YYYY-MM-DD)")
			.optional(),
		type: z.enum(["uncategorized", "unapproved"]).optional(),
		cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional(),
		limit: z.number().int().positive().optional(),
		offset: z.number().int().min(0).optional(),
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type ListTransactionsParams = z.infer<typeof ListTransactionsSchema>;

// ============================================================================
// Get Transaction
// ============================================================================

/**
 * Schema for ynab:get_transaction tool parameters
 */
export const GetTransactionSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		transaction_id: z.string().min(1, "Transaction ID is required"),
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type GetTransactionParams = z.infer<typeof GetTransactionSchema>;

// ============================================================================
// Create Transaction
// ============================================================================

/**
 * Schema for ynab:create_transaction tool parameters
 */
const CreateTransactionBaseSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		account_id: z.string().min(1, "Account ID is required"),
		amount: z.number().int("Amount must be an integer in milliunits"),
		date: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in ISO format (YYYY-MM-DD)"),
		payee_name: z.string().optional(),
		payee_id: z.string().optional(),
		category_id: z.string().optional(),
		memo: z.string().optional(),
		cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional(),
		approved: z.boolean().optional(),
		flag_color: z
			.enum(["red", "orange", "yellow", "green", "blue", "purple"])
			.optional(),
		import_id: z.string().min(1, "Import ID cannot be empty").optional(),
		dry_run: z.boolean().optional(),
		subtransactions: z
			.array(
				z
					.object({
						amount: z
							.number()
							.int("Subtransaction amount must be an integer in milliunits"),
						payee_name: z.string().optional(),
						payee_id: z.string().optional(),
						category_id: z.string().optional(),
						memo: z.string().optional(),
					})
					.strict(),
			)
			.min(1, "At least one subtransaction is required when provided")
			.optional(),
	})
	.strict();

export const CreateTransactionSchema = CreateTransactionBaseSchema.superRefine(
	(data, ctx) => {
		if (data.subtransactions && data.subtransactions.length > 0) {
			const total = data.subtransactions.reduce(
				(sum, sub) => sum + sub.amount,
				0,
			);
			if (total !== data.amount) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Amount must equal the sum of subtransaction amounts",
					path: ["amount"],
				});
			}
		}
	},
);

export type CreateTransactionParams = z.infer<typeof CreateTransactionSchema>;

/**
 * Schema for subtransaction input
 */
export interface SubtransactionInput {
	amount: number;
	payee_name?: string;
	payee_id?: string;
	category_id?: string;
	memo?: string;
}

// ============================================================================
// Create Transactions (Bulk)
// ============================================================================

const BulkTransactionInputSchemaBase = CreateTransactionBaseSchema.pick({
	account_id: true,
	amount: true,
	date: true,
	payee_name: true,
	payee_id: true,
	category_id: true,
	memo: true,
	cleared: true,
	approved: true,
	flag_color: true,
	import_id: true,
});

export type BulkTransactionInput = Omit<
	CreateTransactionParams,
	"budget_id" | "dry_run" | "subtransactions"
>;

// Schema for bulk transaction creation - subtransactions are not supported
// The .strict() modifier automatically rejects any fields not in the schema
const BulkTransactionInputSchema = BulkTransactionInputSchemaBase.strict();

export const CreateTransactionsSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		transactions: z
			.array(BulkTransactionInputSchema)
			.min(1, "At least one transaction is required")
			.max(100, "A maximum of 100 transactions may be created at once"),
		dry_run: z.boolean().optional(),
	})
	.strict();

export type CreateTransactionsParams = z.infer<typeof CreateTransactionsSchema>;

export interface BulkTransactionResult {
	request_index: number;
	status: "created" | "duplicate" | "failed";
	transaction_id?: string | undefined;
	correlation_key: string;
	error_code?: string | undefined;
	error?: string | undefined;
}

export interface BulkCreateResponse {
	success: boolean;
	server_knowledge?: number;
	summary: {
		total_requested: number;
		created: number;
		duplicates: number;
		failed: number;
	};
	results: BulkTransactionResult[];
	transactions?: ynab.TransactionDetail[];
	duplicate_import_ids?: string[];
	message?: string;
	mode?: "full" | "summary" | "ids_only";
}

// ============================================================================
// Create Receipt Split Transaction
// ============================================================================

const ReceiptSplitItemSchema = z
	.object({
		name: z.string().min(1, "Item name is required"),
		amount: z.number().finite("Item amount must be a finite number"),
		quantity: z
			.number()
			.finite("Quantity must be a finite number")
			.positive("Quantity must be greater than zero")
			.optional(),
		memo: z.string().optional(),
	})
	.strict();

const ReceiptSplitCategorySchema = z
	.object({
		category_id: z.string().min(1, "Category ID is required"),
		category_name: z.string().optional(),
		items: z
			.array(ReceiptSplitItemSchema)
			.min(1, "Each category must include at least one item"),
	})
	.strict();

export const CreateReceiptSplitTransactionSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		account_id: z.string().min(1, "Account ID is required"),
		payee_name: z.string().min(1, "Payee name is required"),
		date: z
			.string()
			.regex(
				/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
				"Date must be in ISO format (YYYY-MM-DD)",
			)
			.optional(),
		memo: z.string().optional(),
		receipt_subtotal: z
			.number()
			.finite("Receipt subtotal must be a finite number")
			.refine((value) => value >= 0, "Receipt subtotal must be zero or greater")
			.optional(),
		receipt_tax: z.number().finite("Receipt tax must be a finite number"),
		receipt_total: z
			.number()
			.finite("Receipt total must be a finite number")
			.refine((value) => value > 0, "Receipt total must be greater than zero"),
		categories: z
			.array(ReceiptSplitCategorySchema)
			.min(
				1,
				"At least one categorized group is required to create a split transaction",
			),
		cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional(),
		approved: z.boolean().optional(),
		flag_color: z
			.enum(["red", "orange", "yellow", "green", "blue", "purple"])
			.optional(),
		dry_run: z.boolean().optional(),
	})
	.strict()
	.superRefine((data, ctx) => {
		const itemsSubtotal = data.categories
			.flatMap((category) => category.items)
			.reduce((sum, item) => sum + item.amount, 0);

		if (data.receipt_subtotal !== undefined) {
			const delta = Math.abs(data.receipt_subtotal - itemsSubtotal);
			if (delta > 0.01) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Receipt subtotal (${data.receipt_subtotal.toFixed(2)}) does not match categorized items total (${itemsSubtotal.toFixed(2)})`,
					path: ["receipt_subtotal"],
				});
			}
		}

		const expectedTotal = itemsSubtotal + data.receipt_tax;
		const deltaTotal = Math.abs(expectedTotal - data.receipt_total);
		if (deltaTotal > 0.01) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Receipt total (${data.receipt_total.toFixed(2)}) does not match subtotal plus tax (${expectedTotal.toFixed(2)})`,
				path: ["receipt_total"],
			});
		}
	});

export type CreateReceiptSplitTransactionParams = z.infer<
	typeof CreateReceiptSplitTransactionSchema
>;

/**
 * Interface for receipt category calculation
 */
export interface ReceiptCategoryCalculation {
	category_id: string;
	category_name: string | undefined;
	subtotal_milliunits: number;
	tax_milliunits: number;
	items: {
		name: string;
		amount_milliunits: number;
		quantity: number | undefined;
		memo: string | undefined;
	}[];
}

// ============================================================================
// Update Transaction
// ============================================================================

/**
 * Schema for ynab:update_transaction tool parameters
 */
export const UpdateTransactionSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		transaction_id: z.string().min(1, "Transaction ID is required"),
		account_id: z.string().optional(),
		amount: z
			.number()
			.int("Amount must be an integer in milliunits")
			.optional(),
		date: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in ISO format (YYYY-MM-DD)")
			.optional(),
		payee_name: z.string().optional(),
		payee_id: z.string().optional(),
		category_id: z.string().optional(),
		memo: z.string().optional(),
		cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional(),
		approved: z.boolean().optional(),
		flag_color: z
			.enum(["red", "orange", "yellow", "green", "blue", "purple"])
			.optional(),
		dry_run: z.boolean().optional(),
	})
	.strict();

export type UpdateTransactionParams = z.infer<typeof UpdateTransactionSchema>;

// ============================================================================
// Update Transactions (Bulk)
// ============================================================================

/**
 * Schema for bulk transaction updates - each item in the array
 * Note: account_id is intentionally excluded as account moves are not supported in bulk updates
 */
const BulkUpdateTransactionInputSchema = z
	.object({
		id: z.string().min(1, "Transaction ID is required"),
		amount: z
			.number()
			.int("Amount must be an integer in milliunits")
			.optional(),
		date: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in ISO format (YYYY-MM-DD)")
			.optional(),
		payee_name: z.string().optional(),
		payee_id: z.string().optional(),
		category_id: z.string().optional(),
		memo: z.string().optional(),
		cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional(),
		approved: z.boolean().optional(),
		flag_color: z
			.enum(["red", "orange", "yellow", "green", "blue", "purple"])
			.optional(),
		// Metadata fields for cache invalidation
		original_account_id: z.string().optional(),
		original_date: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in ISO format (YYYY-MM-DD)")
			.optional(),
	})
	.strict();

export type BulkUpdateTransactionInput = z.infer<
	typeof BulkUpdateTransactionInputSchema
>;

/**
 * Schema for ynab:update_transactions tool parameters
 */
export const UpdateTransactionsSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		transactions: z
			.array(BulkUpdateTransactionInputSchema)
			.min(1, "At least one transaction is required")
			.max(100, "A maximum of 100 transactions may be updated at once"),
		dry_run: z.boolean().optional(),
	})
	.strict();

export type UpdateTransactionsParams = z.infer<typeof UpdateTransactionsSchema>;

export interface BulkUpdateResult {
	request_index: number;
	status: "updated" | "failed";
	transaction_id: string;
	correlation_key: string;
	error_code?: string;
	error?: string;
}

export interface BulkUpdateResponse {
	success: boolean;
	server_knowledge?: number;
	summary: {
		total_requested: number;
		updated: number;
		failed: number;
	};
	results: BulkUpdateResult[];
	transactions?: ynab.TransactionDetail[];
	message?: string;
	mode?: "full" | "summary" | "ids_only";
}

// ============================================================================
// Delete Transaction
// ============================================================================

/**
 * Schema for ynab:delete_transaction tool parameters
 */
export const DeleteTransactionSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		transaction_id: z.string().min(1, "Transaction ID is required"),
		dry_run: z.boolean().optional(),
	})
	.strict();

export type DeleteTransactionParams = z.infer<typeof DeleteTransactionSchema>;

// ============================================================================
// Correlation & Utility Types
// ============================================================================

/**
 * Type for correlation payload used in bulk operations
 */
export interface CorrelationPayload {
	account_id?: string;
	date?: string;
	amount?: number;
	payee_id?: string | null;
	payee_name?: string | null;
	category_id?: string | null;
	memo?: string | null;
	cleared?: ynab.TransactionClearedStatus;
	approved?: boolean;
	flag_color?: ynab.TransactionFlagColor | null;
	import_id?: string | null;
}

/**
 * Interface for correlation payload input (with optional fields)
 */
export interface CorrelationPayloadInput {
	account_id?: string | undefined;
	date?: string | undefined;
	amount?: number | undefined;
	payee_id?: string | null | undefined;
	payee_name?: string | null | undefined;
	category_id?: string | null | undefined;
	memo?: string | null | undefined;
	cleared?: ynab.TransactionClearedStatus | undefined;
	approved?: boolean | undefined;
	flag_color?: ynab.TransactionFlagColor | null | undefined;
	import_id?: string | null | undefined;
}

/**
 * Interface for category source (used in cache invalidation)
 */
export interface CategorySource {
	category_id?: string | null;
	subtransactions?: { category_id?: string | null }[] | null | undefined;
}

/**
 * Interface for transaction cache invalidation options
 */
export interface TransactionCacheInvalidationOptions {
	affectedCategoryIds?: Set<string>;
	invalidateAllCategories?: boolean;
	accountTotalsChanged?: boolean;
	invalidateMonths?: boolean;
}
