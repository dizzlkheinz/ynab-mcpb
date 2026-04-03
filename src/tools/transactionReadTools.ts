import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import type { z } from "zod/v4";
import {
	CACHE_TTLS,
	CacheManager,
	cacheManager,
} from "../server/cacheManager.js";
import { RESPONSE_SIZE_LIMIT_BYTES } from "../server/config.js";
import type { ErrorHandler } from "../server/errorHandler.js";
import {
	formatTransactionDetail,
	formatTransactionsList,
} from "../server/markdownFormatter.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ToolRegistry } from "../server/toolRegistry.js";
import { withToolErrorHandling } from "../types/index.js";
import type { ToolContext } from "../types/toolRegistration.js";
import { milliunitsToAmount } from "../utils/amountUtils.js";
import {
	createAdapters,
	createBudgetResolver,
	requireResolvedBudgetId,
} from "./adapters.js";
import type { DeltaFetcher } from "./deltaFetcher.js";
import { resolveDeltaFetcherArgs } from "./deltaSupport.js";
import {
	ExportTransactionsSchema,
	handleExportTransactions,
} from "./exportTransactions.js";
import {
	ExportTransactionsOutputSchema,
	GetTransactionOutputSchema,
	ListTransactionsOutputSchema,
} from "./schemas/outputs/index.js";
import { ToolAnnotationPresets } from "./toolCategories.js";

import type {
	GetTransactionParams,
	ListTransactionsParams,
} from "./transactionSchemas.js";
import {
	GetTransactionSchema,
	ListTransactionsSchema,
} from "./transactionSchemas.js";

import {
	ensureTransaction,
	handleTransactionError,
} from "./transactionUtils.js";

/**
 * Handles the ynab:list_transactions tool call
 * Lists transactions for a budget with optional filtering
 */

export async function handleListTransactions(
	ynabAPI: ynab.API,
	deltaFetcher: DeltaFetcher,
	params: ListTransactionsParams,
): Promise<CallToolResult>;
export async function handleListTransactions(
	ynabAPI: ynab.API,
	params: ListTransactionsParams,
): Promise<CallToolResult>;
export async function handleListTransactions(
	ynabAPI: ynab.API,
	deltaFetcherOrParams: DeltaFetcher | ListTransactionsParams,
	maybeParams?: ListTransactionsParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaFetcher, params } = resolveDeltaFetcherArgs(
		ynabAPI,
		deltaFetcherOrParams,
		maybeParams,
	);
	return await withToolErrorHandling(
		async () => {
			const budgetId = requireResolvedBudgetId(params.budget_id);
			// Always use cache
			let transactions: (ynab.TransactionDetail | ynab.HybridTransaction)[];
			let cacheHit = false;
			let usedDelta = false;

			if (params.account_id) {
				// Validate that the account exists before fetching transactions
				// YNAB API returns empty array for invalid account IDs instead of an error
				const accountsResult = await deltaFetcher.fetchAccounts(budgetId);
				const accountExists = accountsResult.data.some(
					(account) => account.id === params.account_id,
				);
				if (!accountExists) {
					throw new Error(
						`Account ${params.account_id} not found in budget ${budgetId}`,
					);
				}

				const result = await deltaFetcher.fetchTransactionsByAccount(
					budgetId,
					params.account_id,
					params.since_date,
				);
				transactions = result.data;
				cacheHit = result.wasCached;
				usedDelta = result.usedDelta;
			} else if (params.category_id) {
				const response = await ynabAPI.transactions.getTransactionsByCategory(
					budgetId,
					params.category_id,
					params.since_date,
				);
				transactions = response.data.transactions;
			} else {
				const result = await deltaFetcher.fetchTransactions(
					budgetId,
					params.since_date,
					params.type as ynab.GetTransactionsTypeEnum | undefined,
				);
				transactions = result.data;
				cacheHit = result.wasCached;
				usedDelta = result.usedDelta;
			}

			// Apply cleared filter before pagination to avoid client-side post-filtering.
			if (params.cleared) {
				transactions = transactions.filter(
					(transaction) => transaction.cleared === params.cleared,
				);
			}

			// Apply pagination before size check
			const limit = params.limit ?? 50;
			const offset = params.offset ?? 0;
			const paged = transactions.slice(offset, offset + limit);
			const hasMore = offset + limit < transactions.length;

			// Check if response might be too large for MCP
			const estimatedSize = JSON.stringify(paged).length;
			const sizeLimit = RESPONSE_SIZE_LIMIT_BYTES;

			if (estimatedSize > sizeLimit) {
				// Return summary and suggest export (show most recent entries)
				const preview = [...paged]
					.sort((a, b) => {
						const dateA = a.date ?? "";
						const dateB = b.date ?? "";
						if (dateA === dateB) return 0;
						return dateA < dateB ? 1 : -1;
					})
					.slice(0, 50);
				const fmt = params.response_format ?? "markdown";
				const previewData = {
					message: `Found ${transactions.length} transactions (${Math.round(estimatedSize / 1024)}KB). Too large to display all.`,
					suggestion:
						"Use 'export_transactions' tool to save all transactions to a file.",
					showing: `Most recent ${preview.length} transactions:`,
					total_count: transactions.length,
					estimated_size_kb: Math.round(estimatedSize / 1024),
					preview_transactions: preview.map((transaction) => ({
						id: transaction.id,
						date: transaction.date,
						amount: milliunitsToAmount(transaction.amount),
						memo: transaction.memo,
						account_id: transaction.account_id,
						payee_name: transaction.payee_name,
						category_name: transaction.category_name,
					})),
				};
				return {
					content: [
						{
							type: "text",
							text:
								fmt === "markdown"
									? formatTransactionsList(previewData)
									: responseFormatter.format(previewData),
						},
					],
					structuredContent: previewData,
				};
			}

			const fmtNormal = params.response_format ?? "markdown";
			const normalData = {
				total_count: transactions.length,
				returned_count: paged.length,
				offset,
				has_more: hasMore,
				next_offset: hasMore ? offset + limit : undefined,
				cached: cacheHit,
				cache_info: cacheHit
					? `Data retrieved from cache for improved performance${usedDelta ? " (delta merge applied)" : ""}`
					: "Fresh data retrieved from YNAB API",
				transactions: paged.map((transaction) => ({
					id: transaction.id,
					date: transaction.date,
					amount: milliunitsToAmount(transaction.amount),
					memo: transaction.memo,
					cleared: transaction.cleared,
					approved: transaction.approved,
					flag_color: transaction.flag_color,
					account_id: transaction.account_id,
					payee_id: transaction.payee_id,
					category_id: transaction.category_id,
					transfer_account_id: transaction.transfer_account_id,
					transfer_transaction_id: transaction.transfer_transaction_id,
					matched_transaction_id: transaction.matched_transaction_id,
					import_id: transaction.import_id,
					deleted: transaction.deleted,
				})),
			};
			return {
				content: [
					{
						type: "text",
						text:
							fmtNormal === "markdown"
								? formatTransactionsList(normalData)
								: responseFormatter.format(normalData),
					},
				],
				structuredContent: normalData,
			};
		},
		"ynab:list_transactions",
		"listing transactions",
		errorHandler,
	);
}

/**
 * Handles the ynab:get_transaction tool call
 * Gets detailed information for a specific transaction
 */
export async function handleGetTransaction(
	ynabAPI: ynab.API,
	params: GetTransactionParams,
	_errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		const budgetId = requireResolvedBudgetId(params.budget_id);
		const useCache = process.env["NODE_ENV"] !== "test";

		let transaction: ynab.TransactionDetail;
		let cacheHit = false;

		if (useCache) {
			// Use enhanced CacheManager wrap method
			const cacheKey = CacheManager.generateKey(
				"transaction",
				"get",
				budgetId,
				params.transaction_id,
			);
			cacheHit = cacheManager.has(cacheKey);
			transaction = await cacheManager.wrap<ynab.TransactionDetail>(cacheKey, {
				ttl: CACHE_TTLS.TRANSACTIONS,
				loader: async () => {
					const response = await ynabAPI.transactions.getTransactionById(
						budgetId,
						params.transaction_id,
					);
					return ensureTransaction(
						response.data.transaction,
						"Transaction not found",
					);
				},
			});
		} else {
			// Bypass cache in test environment
			const response = await ynabAPI.transactions.getTransactionById(
				budgetId,
				params.transaction_id,
			);
			transaction = ensureTransaction(
				response.data.transaction,
				"Transaction not found",
			);
		}

		const fmtTx = params.response_format ?? "markdown";
		const txData = {
			transaction: {
				id: transaction.id,
				date: transaction.date,
				amount: milliunitsToAmount(transaction.amount),
				memo: transaction.memo,
				cleared: transaction.cleared,
				approved: transaction.approved,
				flag_color: transaction.flag_color,
				account_id: transaction.account_id,
				payee_id: transaction.payee_id,
				category_id: transaction.category_id,
				transfer_account_id: transaction.transfer_account_id,
				transfer_transaction_id: transaction.transfer_transaction_id,
				matched_transaction_id: transaction.matched_transaction_id,
				import_id: transaction.import_id,
				deleted: transaction.deleted,
				account_name: transaction.account_name,
				payee_name: transaction.payee_name,
				category_name: transaction.category_name,
			},
			cached: cacheHit,
			cache_info: cacheHit
				? "Data retrieved from cache for improved performance"
				: "Fresh data retrieved from YNAB API",
		};
		return {
			content: [
				{
					type: "text",
					text:
						fmtTx === "markdown"
							? formatTransactionDetail(txData)
							: responseFormatter.format(txData),
				},
			],
			structuredContent: txData,
		};
	} catch (error) {
		return handleTransactionError(error, "Failed to get transaction");
	}
}

/**
 * Registers read-only transaction tools with the provided registry.
 */
export function registerTransactionReadTools(
	registry: ToolRegistry,
	context: ToolContext,
): void {
	const { adapt, adaptWithDelta } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);

	registry.register({
		name: "ynab_list_transactions",
		description: `List transactions for a budget with optional filtering and pagination.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - account_id (string, optional): Filter by account.
  - category_id (string, optional): Filter by category.
  - since_date (string, optional): ISO date (YYYY-MM-DD) to filter transactions on or after.
  - type (string, optional): "uncategorized" or "unapproved".
  - cleared (string, optional): "cleared", "uncleared", or "reconciled".
  - limit (int, optional): Max results per page. Default: 50.
  - offset (int, optional): Zero-based offset for pagination. Default: 0.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: transactions[], total_count, returned_count, offset, has_more, next_offset, cached, cache_info

Examples:
  - All transactions: call with no args (uses default budget)
  - Filter by account: set account_id
  - Last 30 days: set since_date to 30 days ago
  - Page 2: set limit=50, offset=50

Errors:
  - "No default budget set" → run ynab_set_default_budget first
  - Large result → use ynab_export_transactions to save to file`,
		inputSchema: ListTransactionsSchema,
		outputSchema: ListTransactionsOutputSchema,
		handler: adaptWithDelta(handleListTransactions),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof ListTransactionsSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: List Transactions",
			},
		},
	});

	registry.register({
		name: "ynab_export_transactions",
		description: `Export all transactions for a budget to a local JSON file.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - account_id (string, optional): Filter by account.
  - since_date (string, optional): ISO date (YYYY-MM-DD) to filter transactions on or after.

Returns: file_path, transaction_count, file_size_kb

Examples:
  - Export all transactions: call with no args
  - Export account: set account_id

Errors:
  - "No default budget set" → run ynab_set_default_budget first`,
		inputSchema: ExportTransactionsSchema,
		outputSchema: ExportTransactionsOutputSchema,
		handler: adapt(handleExportTransactions),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof ExportTransactionsSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Export Transactions",
			},
		},
	});

	registry.register({
		name: "ynab_get_transaction",
		description: `Get full details for a single transaction by ID.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - transaction_id (string, required): Transaction UUID.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: transaction (id, date, amount, memo, cleared, approved, account_id, payee_name, category_name, subtransactions), cached, cache_info

Errors:
  - "No default budget set" → run ynab_set_default_budget first
  - "Transaction not found" → invalid transaction_id`,
		inputSchema: GetTransactionSchema,
		outputSchema: GetTransactionOutputSchema,
		handler: adapt(handleGetTransaction),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof GetTransactionSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Get Transaction Details",
			},
		},
	});
}
