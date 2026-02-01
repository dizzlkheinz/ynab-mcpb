import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import type { z } from "zod/v4";
import {
	CACHE_TTLS,
	CacheManager,
	cacheManager,
} from "../server/cacheManager.js";
import type { ErrorHandler } from "../server/errorHandler.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ToolRegistry } from "../server/toolRegistry.js";
import { withToolErrorHandling } from "../types/index.js";
import type { ToolContext } from "../types/toolRegistration.js";
import { milliunitsToAmount } from "../utils/amountUtils.js";
import { createAdapters, createBudgetResolver } from "./adapters.js";
import type { DeltaFetcher } from "./deltaFetcher.js";
import { resolveDeltaFetcherArgs } from "./deltaSupport.js";
import {
	ExportTransactionsSchema,
	handleExportTransactions,
} from "./exportTransactions.js";
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
			// Always use cache
			let transactions: (ynab.TransactionDetail | ynab.HybridTransaction)[];
			let cacheHit = false;
			let usedDelta = false;

			if (params.account_id) {
				// Validate that the account exists before fetching transactions
				// YNAB API returns empty array for invalid account IDs instead of an error
				const accountsResult = await deltaFetcher.fetchAccounts(
					params.budget_id,
				);
				const accountExists = accountsResult.data.some(
					(account) => account.id === params.account_id,
				);
				if (!accountExists) {
					throw new Error(
						`Account ${params.account_id} not found in budget ${params.budget_id}`,
					);
				}

				const result = await deltaFetcher.fetchTransactionsByAccount(
					params.budget_id,
					params.account_id,
					params.since_date,
				);
				transactions = result.data;
				cacheHit = result.wasCached;
				usedDelta = result.usedDelta;
			} else if (params.category_id) {
				const response = await ynabAPI.transactions.getTransactionsByCategory(
					params.budget_id,
					params.category_id,
					params.since_date,
				);
				transactions = response.data.transactions;
			} else {
				const result = await deltaFetcher.fetchTransactions(
					params.budget_id,
					params.since_date,
					params.type as ynab.GetTransactionsTypeEnum | undefined,
				);
				transactions = result.data;
				cacheHit = result.wasCached;
				usedDelta = result.usedDelta;
			}

			// Check if response might be too large for MCP
			const estimatedSize = JSON.stringify(transactions).length;
			const sizeLimit = 90000; // Conservative limit under 100KB

			if (estimatedSize > sizeLimit) {
				// Return summary and suggest export
				const preview = transactions.slice(0, 50);
				return {
					content: [
						{
							type: "text",
							text: responseFormatter.format({
								message: `Found ${transactions.length} transactions (${Math.round(estimatedSize / 1024)}KB). Too large to display all.`,
								suggestion:
									"Use 'export_transactions' tool to save all transactions to a file.",
								showing: `First ${preview.length} transactions:`,
								total_count: transactions.length,
								estimated_size_kb: Math.round(estimatedSize / 1024),
								cached: cacheHit,
								cache_info: cacheHit
									? `Data retrieved from cache for improved performance${usedDelta ? " (delta merge applied)" : ""}`
									: "Fresh data retrieved from YNAB API",
								preview_transactions: preview.map((transaction) => ({
									id: transaction.id,
									date: transaction.date,
									amount: milliunitsToAmount(transaction.amount),
									memo: transaction.memo,
									payee_name: transaction.payee_name,
									category_name: transaction.category_name,
								})),
							}),
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format({
							total_count: transactions.length,
							cached: cacheHit,
							cache_info: cacheHit
								? `Data retrieved from cache for improved performance${usedDelta ? " (delta merge applied)" : ""}`
								: "Fresh data retrieved from YNAB API",
							transactions: transactions.map((transaction) => ({
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
						}),
					},
				],
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
		const useCache = process.env["NODE_ENV"] !== "test";

		let transaction: ynab.TransactionDetail;
		let cacheHit = false;

		if (useCache) {
			// Use enhanced CacheManager wrap method
			const cacheKey = CacheManager.generateKey(
				"transaction",
				"get",
				params.budget_id,
				params.transaction_id,
			);
			cacheHit = cacheManager.has(cacheKey);
			transaction = await cacheManager.wrap<ynab.TransactionDetail>(cacheKey, {
				ttl: CACHE_TTLS.TRANSACTIONS,
				loader: async () => {
					const response = await ynabAPI.transactions.getTransactionById(
						params.budget_id,
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
				params.budget_id,
				params.transaction_id,
			);
			transaction = ensureTransaction(
				response.data.transaction,
				"Transaction not found",
			);
		}

		return {
			content: [
				{
					type: "text",
					text: responseFormatter.format({
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
					}),
				},
			],
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
		name: "list_transactions",
		description: "List transactions for a budget with optional filtering",
		inputSchema: ListTransactionsSchema,
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
		name: "export_transactions",
		description:
			"Export all transactions to a JSON file with descriptive filename",
		inputSchema: ExportTransactionsSchema,
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
		name: "get_transaction",
		description: "Get detailed information for a specific transaction",
		inputSchema: GetTransactionSchema,
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
