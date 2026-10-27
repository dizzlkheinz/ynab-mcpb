/**
 * @fileoverview Output schemas for transaction-related tools.
 *
 * Defines Zod schemas and TypeScript types for responses from transaction tools:
 * - `list_transactions`: Returns transactions with two modes (normal and preview for large responses)
 * - `get_transaction`: Returns a single transaction with cache metadata
 *
 * The list_transactions tool implements special handling for large responses:
 * - Normal mode: Returns all transactions with cache metadata
 * - Preview mode: Returns a preview of first 10 transactions when count > 100
 *
 * @see src/tools/transactionTools.ts:745-864 for list_transactions handler
 * @see src/tools/transactionTools.ts:870-944 for get_transaction handler
 *
 * @example
 * ```typescript
 * // Normal mode (count <= 100)
 * const listOutput: ListTransactionsOutput = {
 *   total_count: 50,
 *   cached: true,
 *   cache_info: {
 *     cache_key: 'transactions:budget-123:2025-11-01',
 *     age_ms: 2000,
 *     stale: false
 *   },
 *   transactions: [
 *     {
 *       id: 'txn-123',
 *       date: '2025-11-17',
 *       amount: -45.50,
 *       memo: 'Grocery shopping',
 *       cleared: 'cleared',
 *       approved: true,
 *       flag_color: 'red',
 *       account_id: 'account-123',
 *       payee_id: 'payee-456',
 *       category_id: 'category-789',
 *       deleted: false,
 *       account_name: 'Checking',
 *       payee_name: 'Whole Foods',
 *       category_name: 'Groceries'
 *     }
 *   ]
 * };
 *
 * // Preview mode (count > 100)
 * const previewOutput: ListTransactionsOutput = {
 *   message: 'Large result set detected',
 *   suggestion: 'Use filter parameters to narrow results',
 *   showing: 'First 50 transactions:',
 *   total_count: 250,
 *   estimated_size_kb: 150,
 *   preview_transactions: [
 *     {
 *       id: 'txn-123',
 *       date: '2025-11-17',
 *       amount: -45.50,
 *       memo: 'Grocery shopping',
 *       payee_name: 'Whole Foods',
 *       category_name: 'Groceries'
 *     }
 *   ]
 * };
 *
 * // Get single transaction
 * const getOutput: GetTransactionOutput = {
 *   transaction: {
 *     id: 'txn-123',
 *     date: '2025-11-17',
 *     amount: -45.50,
 *     memo: 'Grocery shopping',
 *     cleared: 'cleared',
 *     approved: true,
 *     account_id: 'account-123',
 *     payee_id: 'payee-456',
 *     category_id: 'category-789',
 *     deleted: false,
 *     account_name: 'Checking',
 *     payee_name: 'Whole Foods',
 *     category_name: 'Groceries'
 *   },
 *   cached: false,
 *   cache_info: {
 *     cache_key: 'transaction:budget-123:txn-123',
 *     age_ms: 0,
 *     stale: false
 *   }
 * };
 * ```
 */

import { z } from "zod/v4";
import {
	CacheMetadataSchema,
	PaginationMetadataSchema,
} from "../shared/commonOutputs.js";

export { TransactionOutputSchema as TransactionSchema } from "../../transactionModel.js";

import { TransactionOutputSchema as TransactionSchema } from "../../transactionModel.js";

/** Preview fields are a projection of the shared transaction response. */
export const TransactionPreviewSchema = TransactionSchema.partial().required({
	id: true,
	date: true,
	amount: true,
	account_id: true,
});

/**
 * Schema for `list_transactions` tool output (normal mode).
 *
 * Returns all transactions when count <= 100.
 */
const ListTransactionsNormalSchema = CacheMetadataSchema.merge(
	PaginationMetadataSchema,
).extend({
	/** Array of complete transaction objects */
	transactions: z.array(TransactionSchema).describe("List of transactions"),
});

/**
 * Schema for `list_transactions` tool output (preview mode).
 *
 * Returns a preview when count > 100 to avoid overwhelming responses.
 */
const ListTransactionsPreviewSchema = z.object({
	/** Message explaining large result set */
	message: z.string().describe("Large result set message"),

	/** Suggestion to narrow results */
	suggestion: z.string().describe("Suggestion to narrow results"),

	/** Human-readable summary of transactions shown in preview (e.g., "First 50 transactions:") */
	showing: z.string().describe("Human-readable summary of transactions shown"),

	/** Total number of transactions */
	total_count: z.number().int().describe("Total transaction count"),

	/** Estimated response size in KB if all transactions returned */
	estimated_size_kb: z.number().describe("Estimated response size in KB"),

	/** Array of preview transaction objects */
	preview_transactions: z
		.array(TransactionPreviewSchema)
		.describe("Preview transactions"),
});

/**
 * Schema for `list_transactions` tool output.
 *
 * Discriminated union supporting both normal and preview response modes.
 */
export const ListTransactionsOutputSchema = z.union([
	ListTransactionsNormalSchema,
	ListTransactionsPreviewSchema,
]);

/**
 * Schema for `get_transaction` tool output.
 *
 * Returns a single transaction by ID with cache metadata.
 */
export const GetTransactionOutputSchema = CacheMetadataSchema.extend({
	/** Single transaction object */
	transaction: TransactionSchema.describe("Transaction details"),
});
