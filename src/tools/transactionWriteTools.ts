import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import type { ExistingTransaction, NewTransaction } from "ynab";
import type { SaveSubTransaction } from "ynab/dist/models/SaveSubTransaction.js";
import type { SaveTransactionWithIdOrImportId } from "ynab/dist/models/SaveTransactionWithIdOrImportId.js";
import type { z } from "zod/v4";
import type { ErrorHandler } from "../server/errorHandler.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ToolRegistry } from "../server/toolRegistry.js";
import { ValidationError, withToolErrorHandling } from "../types/index.js";
import type { ToolContext } from "../types/toolRegistration.js";
import { formatLocalISODate, formatUTCISODate } from "../utils/dateUtils.js";
import { amountToMilliunits, milliunitsToAmount } from "../utils/money.js";
import {
	createAdapters,
	createBudgetResolver,
	requireResolvedBudgetId,
} from "./adapters.js";
import { applySmartCollapseLogic } from "./receiptSplit/collapseLogic.js";
import {
	CreateReceiptSplitTransactionOutputSchema,
	CreateTransactionOutputSchema,
	CreateTransactionsOutputSchema,
	DeleteTransactionOutputSchema,
	UpdateTransactionOutputSchema,
	UpdateTransactionsOutputSchema,
} from "./schemas/outputs/index.js";
import { ToolAnnotationPresets } from "./toolCategories.js";
import {
	type TransactionFields,
	type TransactionModel,
	toTransactionOutput,
} from "./transactionModel.js";

import {
	type BulkCreateResponse,
	type BulkUpdateResponse,
	type BulkUpdateResult,
	type BulkUpdateTransactionInput,
	type CreateReceiptSplitTransactionParams,
	CreateReceiptSplitTransactionSchema,
	type CreateTransactionParams,
	CreateTransactionSchema,
	type CreateTransactionsParams,
	CreateTransactionsSchema,
	type DeleteTransactionParams,
	DeleteTransactionSchema,
	type ReceiptCategoryCalculation,
	type UpdateTransactionParams,
	UpdateTransactionSchema,
	type UpdateTransactionsParams,
	UpdateTransactionsSchema,
} from "./transactionSchemas.js";

import {
	correlateResults,
	ensureTransaction,
	finalizeBulkUpdateResponse,
	finalizeResponse,
	handleTransactionError,
} from "./transactionUtils.js";

type SubtransactionPayload = {
	amount: number;
	payee_name?: string | null | undefined;
	payee_id?: string | null | undefined;
	category_id?: string | null | undefined;
	memo?: string | null | undefined;
};

function toSaveSubtransactions(
	subtransactions: readonly SubtransactionPayload[],
): SaveSubTransaction[] {
	return subtransactions.map((subtransaction) => {
		const mapped: SaveSubTransaction = {
			amount: subtransaction.amount,
		};
		if (subtransaction.payee_name !== undefined) {
			mapped.payee_name = subtransaction.payee_name;
		}
		if (subtransaction.payee_id !== undefined) {
			mapped.payee_id = subtransaction.payee_id;
		}
		if (subtransaction.category_id !== undefined) {
			mapped.category_id = subtransaction.category_id;
		}
		if (subtransaction.memo !== undefined) {
			mapped.memo = subtransaction.memo;
		}
		return mapped;
	});
}

function toUnavailableUpdatePreview(transaction: BulkUpdateTransactionInput) {
	const {
		id: _id,
		original_account_id: _account,
		original_date: _date,
		...changes
	} = transaction;
	return toTransactionOutput(changes);
}

/**
 * Handles the ynab:create_transaction tool call
 * Creates a new transaction in the specified budget and account
 */
export async function handleCreateTransaction(
	ynabAPI: ynab.API,
	params: CreateTransactionParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		if (params.dry_run) {
			const dryRunData = {
				dry_run: true as const,
				action: "ynab_create_transaction" as const,
				request: toTransactionOutput(params),
			};
			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(dryRunData),
					},
				],
				structuredContent: dryRunData,
			};
		}
		const budgetId = requireResolvedBudgetId(params.budget_id);
		// Prepare transaction data
		const transactionData: NewTransaction = {
			account_id: params.account_id,
			amount: params.amount, // Already validated as integer milliunits
			date: params.date,
			cleared: params.cleared as ynab.TransactionClearedStatus,
			flag_color: params.flag_color as ynab.TransactionFlagColor,
		};
		if (params.payee_name !== undefined)
			transactionData.payee_name = params.payee_name;
		if (params.payee_id !== undefined)
			transactionData.payee_id = params.payee_id;
		if (params.category_id !== undefined)
			transactionData.category_id = params.category_id;
		if (params.memo !== undefined) transactionData.memo = params.memo;
		if (params.approved !== undefined)
			transactionData.approved = params.approved;
		if (params.import_id !== undefined)
			transactionData.import_id = params.import_id;
		if (params.subtransactions && params.subtransactions.length > 0) {
			transactionData.subtransactions = toSaveSubtransactions(
				params.subtransactions,
			);
		}

		const response = await ynabAPI.transactions.createTransaction(budgetId, {
			transaction: transactionData,
		});

		const transaction = ensureTransaction(
			response.data.transaction,
			"Transaction creation failed",
		);

		const createdTxData = { transaction: toTransactionOutput(transaction) };
		return {
			content: [
				{
					type: "text",
					text: responseFormatter.format(createdTxData),
				},
			],
			structuredContent: createdTxData,
		};
	} catch (error) {
		return handleTransactionError(
			error,
			"Failed to create transaction",
			errorHandler,
			"creating transaction",
		);
	}
}

/**
 * Today's date for a transaction, as the earlier of the local and UTC dates.
 * The UTC date is tomorrow for users west of UTC late in the evening, and the
 * local date is ahead of UTC east of it early in the morning; YNAB rejects
 * future dates and does not document which time zone it judges them in.
 */
function defaultTransactionDate(): string {
	const now = new Date();
	const local = formatLocalISODate(now);
	const utc = formatUTCISODate(now);
	// biome-ignore lint/complexity/useMathMinMax: Math.min would turn these date strings into NaN
	return local < utc ? local : utc;
}

export async function handleCreateReceiptSplitTransaction(
	ynabAPI: ynab.API,
	params: CreateReceiptSplitTransactionParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const date = params.date ?? defaultTransactionDate();

	const categoryCalculations: ReceiptCategoryCalculation[] =
		params.categories.map((category) => {
			const items = category.items.map((item) => ({
				name: item.name,
				amount_milliunits: amountToMilliunits(item.amount),
				quantity: item.quantity,
				memo: item.memo,
			}));
			const subtotalMilliunits = items.reduce(
				(sum, item) => sum + item.amount_milliunits,
				0,
			);
			return {
				category_id: category.category_id,
				category_name: category.category_name,
				subtotal_milliunits: subtotalMilliunits,
				tax_milliunits: 0,
				items,
			};
		});

	const subtotalMilliunits = categoryCalculations.reduce(
		(sum, category) => sum + category.subtotal_milliunits,
		0,
	);

	const declaredSubtotalMilliunits =
		params.receipt_subtotal !== undefined
			? amountToMilliunits(params.receipt_subtotal)
			: undefined;
	if (
		declaredSubtotalMilliunits !== undefined &&
		Math.abs(declaredSubtotalMilliunits - subtotalMilliunits) > 1
	) {
		throw new Error(
			`Categorized items subtotal (${milliunitsToAmount(subtotalMilliunits)}) does not match receipt subtotal (${milliunitsToAmount(declaredSubtotalMilliunits)})`,
		);
	}

	const taxMilliunits = amountToMilliunits(params.receipt_tax);
	const totalMilliunits = amountToMilliunits(params.receipt_total);
	const computedTotal = subtotalMilliunits + taxMilliunits;
	if (Math.abs(computedTotal - totalMilliunits) > 1) {
		throw new Error(
			`Receipt total (${milliunitsToAmount(totalMilliunits)}) does not equal subtotal plus tax (${milliunitsToAmount(computedTotal)})`,
		);
	}

	// Apply smart collapse logic
	const subtransactions = applySmartCollapseLogic(
		categoryCalculations,
		taxMilliunits,
	);

	// Distribute tax proportionally for receipt_summary (only for positive categories)
	if (taxMilliunits > 0) {
		const positiveSubtotal = categoryCalculations.reduce(
			(sum, cat) => sum + Math.max(0, cat.subtotal_milliunits),
			0,
		);
		if (positiveSubtotal > 0) {
			let remainingTax = taxMilliunits;
			const positiveCats = categoryCalculations.filter(
				(cat) => cat.subtotal_milliunits > 0,
			);
			positiveCats.forEach((cat, index) => {
				if (index === positiveCats.length - 1) {
					cat.tax_milliunits = remainingTax;
				} else {
					const share = Math.round(
						(cat.subtotal_milliunits / positiveSubtotal) * taxMilliunits,
					);
					cat.tax_milliunits = share;
					remainingTax -= share;
				}
			});
		}
	}

	const receiptSummary = {
		subtotal: milliunitsToAmount(subtotalMilliunits),
		tax: milliunitsToAmount(taxMilliunits),
		total: milliunitsToAmount(totalMilliunits),
		categories: categoryCalculations.map((category) => ({
			category_id: category.category_id,
			category_name: category.category_name,
			items: category.items.map((item) => ({
				name: item.name,
				quantity: item.quantity,
				amount: milliunitsToAmount(item.amount_milliunits),
				memo: item.memo,
			})),
			subtotal: milliunitsToAmount(category.subtotal_milliunits),
			tax: milliunitsToAmount(category.tax_milliunits),
			total: milliunitsToAmount(
				category.subtotal_milliunits + category.tax_milliunits,
			),
		})),
	};

	if (params.dry_run) {
		const receiptDryRunData = {
			dry_run: true as const,
			action: "ynab_create_receipt_split_transaction" as const,
			transaction_preview: toTransactionOutput({
				account_id: params.account_id,
				payee_name: params.payee_name,
				date,
				amount: -totalMilliunits,
				cleared: params.cleared ?? "uncleared",
			}),
			receipt_summary: receiptSummary,
			subtransactions: subtransactions.map(toTransactionOutput),
		};
		return {
			content: [
				{
					type: "text",
					text: responseFormatter.format(receiptDryRunData),
				},
			],
			structuredContent: receiptDryRunData,
		};
	}

	const createTransactionParams: CreateTransactionParams = {
		budget_id: requireResolvedBudgetId(params.budget_id),
		account_id: params.account_id,
		amount: -totalMilliunits,
		date,
		payee_name: params.payee_name,
		memo: params.memo,
		cleared: params.cleared ?? "uncleared",
		flag_color: params.flag_color,
		subtransactions: subtransactions,
	};

	if (params.approved !== undefined) {
		createTransactionParams.approved = params.approved;
	}

	const baseResult = await handleCreateTransaction(
		ynabAPI,
		createTransactionParams,
		errorHandler,
	);

	if (baseResult.isError || !baseResult.structuredContent) return baseResult;
	const data = {
		...baseResult.structuredContent,
		receipt_summary: receiptSummary,
	};
	return {
		content: [{ type: "text", text: responseFormatter.format(data) }],
		structuredContent: data,
	};
}

/**
 * Handles the ynab:update_transaction tool call
 * Updates an existing transaction with the provided fields
 */
export async function handleUpdateTransaction(
	ynabAPI: ynab.API,
	params: UpdateTransactionParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		if (params.dry_run) {
			const updateDryRunData = {
				dry_run: true as const,
				action: "ynab_update_transaction" as const,
				request: toTransactionOutput(params),
			};
			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(updateDryRunData),
					},
				],
				structuredContent: updateDryRunData,
			};
		}
		const budgetId = requireResolvedBudgetId(params.budget_id);

		// Prepare transaction update data - only include fields that are provided
		const transactionData: ExistingTransaction = {};

		// Only include fields that are provided in the update
		if (params.account_id !== undefined) {
			transactionData.account_id = params.account_id;
		}
		if (params.amount !== undefined) {
			transactionData.amount = params.amount;
		}
		if (params.date !== undefined) {
			transactionData.date = params.date;
		}
		if (params.payee_name !== undefined) {
			transactionData.payee_name = params.payee_name;
		}
		if (params.payee_id !== undefined) {
			transactionData.payee_id = params.payee_id;
		}
		if (params.category_id !== undefined) {
			transactionData.category_id = params.category_id;
		}
		if (params.memo !== undefined) {
			transactionData.memo = params.memo;
		}
		if (params.cleared !== undefined) {
			transactionData.cleared = params.cleared as ynab.TransactionClearedStatus;
		}
		if (params.approved !== undefined) {
			transactionData.approved = params.approved;
		}
		if (params.flag_color !== undefined) {
			transactionData.flag_color =
				params.flag_color as ynab.TransactionFlagColor;
		}
		if (params.subtransactions && params.subtransactions.length > 0) {
			transactionData.subtransactions = toSaveSubtransactions(
				params.subtransactions,
			);
		}

		const response = await ynabAPI.transactions.updateTransaction(
			budgetId,
			params.transaction_id,
			{
				transaction: transactionData,
			},
		);

		const transaction = ensureTransaction(
			response.data.transaction,
			"Transaction update failed",
		);

		const updatedTxData = { transaction: toTransactionOutput(transaction) };
		return {
			content: [
				{
					type: "text",
					text: responseFormatter.format(updatedTxData),
				},
			],
			structuredContent: updatedTxData,
		};
	} catch (error) {
		return handleTransactionError(
			error,
			"Failed to update transaction",
			errorHandler,
			"updating transaction",
		);
	}
}

/**
 * Handles the ynab:delete_transaction tool call
 * Deletes a transaction from the specified budget
 */
export async function handleDeleteTransaction(
	ynabAPI: ynab.API,
	params: DeleteTransactionParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		if (params.dry_run) {
			const deleteDryRunData = {
				dry_run: true as const,
				action: "ynab_delete_transaction" as const,
				request: params,
			};
			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(deleteDryRunData),
					},
				],
				structuredContent: deleteDryRunData,
			};
		}
		const budgetId = requireResolvedBudgetId(params.budget_id);
		const response = await ynabAPI.transactions.deleteTransaction(
			budgetId,
			params.transaction_id,
		);

		const transaction = ensureTransaction(
			response.data.transaction,
			"Transaction deletion failed",
		);

		const deletedTxData = {
			message: "Transaction deleted successfully",
			transaction: toTransactionOutput(transaction),
		};
		return {
			content: [
				{
					type: "text",
					text: responseFormatter.format(deletedTxData),
				},
			],
			structuredContent: deletedTxData,
		};
	} catch (error) {
		return handleTransactionError(
			error,
			"Failed to delete transaction",
			errorHandler,
			"deleting transaction",
		);
	}
}

export async function handleCreateTransactions(
	ynabAPI: ynab.API,
	params: CreateTransactionsParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	return (await withToolErrorHandling(
		async () => {
			const validationResult = CreateTransactionsSchema.safeParse(params);
			if (!validationResult.success) {
				type TransactionIssueIndex = number | null;
				const issuesByIndex = new Map<TransactionIssueIndex, string[]>();
				const validationIssues = validationResult.error.issues ?? [];
				for (const issue of validationIssues) {
					const transactionIndex = issue.path.find(
						(segment): segment is number => typeof segment === "number",
					);
					const message = issue.message;
					const issueIndex: TransactionIssueIndex =
						transactionIndex !== undefined ? transactionIndex : null;
					const existing = issuesByIndex.get(issueIndex) ?? [];
					existing.push(message);
					issuesByIndex.set(issueIndex, existing);
				}

				const details = Array.from(issuesByIndex.entries()).map(
					([index, errors]) => ({
						transaction_index: index,
						errors,
					}),
				);

				throw new ValidationError(
					"Bulk transaction validation failed",
					JSON.stringify(details, null, 2),
					[
						"Ensure each transaction includes required fields",
						"Limit batches to 100 items",
					],
				);
			}

			const { budget_id, transactions, dry_run } = validationResult.data;

			// Pre-flight duplicate import_id detection within batch
			const importIdMap = new Map<string, number[]>();
			for (const [index, transaction] of transactions.entries()) {
				if (transaction.import_id && transaction.import_id.trim().length > 0) {
					const existing = importIdMap.get(transaction.import_id);
					if (existing) {
						existing.push(index);
					} else {
						importIdMap.set(transaction.import_id, [index]);
					}
				}
			}

			const duplicates = Array.from(importIdMap.entries())
				.filter(([, indices]) => indices.length > 1)
				.map(([importId, indices]) => ({ import_id: importId, indices }));

			if (duplicates.length > 0) {
				const details = duplicates.map(({ import_id, indices }) => ({
					import_id,
					transaction_indices: indices,
					count: indices.length,
				}));

				throw new ValidationError(
					"Duplicate import_id values detected within batch",
					JSON.stringify(details, null, 2),
					[
						"Ensure each transaction has a unique import_id within the batch",
						"Remove duplicate import_id values or omit import_id to use hash-based correlation",
					],
				);
			}

			if (dry_run) {
				const totalAmount = transactions.reduce(
					(sum, transaction) => sum + transaction.amount,
					0,
				);
				const accountsAffected = Array.from(
					new Set(transactions.map((transaction) => transaction.account_id)),
				);
				const categoriesAffected = Array.from(
					new Set(
						transactions
							.map((transaction) => transaction.category_id)
							.filter((id): id is string => id !== undefined),
					),
				);
				const sortedDates = [
					...transactions.map((transaction) => transaction.date),
				].sort();
				const dateRange =
					sortedDates.length > 0
						? {
								earliest: sortedDates[0],
								latest: sortedDates[sortedDates.length - 1],
							}
						: undefined;

				const transactionsPreview = transactions
					.slice(0, 10)
					.map((transaction, index) => ({
						request_index: index,
						...toTransactionOutput(transaction),
					}));

				const bulkCreateDryRunData = {
					dry_run: true as const,
					action: "ynab_create_transactions" as const,
					validation: "passed" as const,
					summary: {
						total_transactions: transactions.length,
						total_amount: milliunitsToAmount(totalAmount),
						accounts_affected: accountsAffected,
						date_range: dateRange,
						categories_affected: categoriesAffected,
					},
					transactions_preview: transactionsPreview,
					note: "Dry run complete. No transactions created. No caches invalidated. No server_knowledge updated.",
				};
				return {
					content: [
						{
							type: "text",
							text: responseFormatter.format(bulkCreateDryRunData),
						},
					],
					structuredContent: bulkCreateDryRunData,
				};
			}
			const budgetId = requireResolvedBudgetId(budget_id);

			const saveTransactions: NewTransaction[] = transactions.map(
				(transaction) => {
					const payload: NewTransaction = {
						account_id: transaction.account_id,
						amount: transaction.amount,
						date: transaction.date,
					};

					if (transaction.payee_id !== undefined)
						payload.payee_id = transaction.payee_id;
					if (transaction.payee_name !== undefined)
						payload.payee_name = transaction.payee_name;
					if (transaction.category_id !== undefined)
						payload.category_id = transaction.category_id;
					if (transaction.memo !== undefined) payload.memo = transaction.memo;
					if (transaction.cleared !== undefined)
						payload.cleared = transaction.cleared;
					if (transaction.approved !== undefined)
						payload.approved = transaction.approved;
					if (transaction.flag_color !== undefined)
						payload.flag_color = transaction.flag_color;
					if (transaction.import_id !== undefined)
						payload.import_id = transaction.import_id;

					return payload;
				},
			);

			const response = await ynabAPI.transactions.createTransactions(budgetId, {
				transactions: saveTransactions,
			});

			const responseData = response.data;
			const duplicateImportIds = new Set(
				responseData.duplicate_import_ids ?? [],
			);
			const results = correlateResults(
				transactions,
				responseData,
				duplicateImportIds,
			);

			const summary = {
				total_requested: transactions.length,
				created: responseData.transaction_ids?.length ?? 0,
				duplicates: duplicateImportIds.size,
				failed: results.filter((result) => result.status === "failed").length,
			};

			const baseResponse: BulkCreateResponse = {
				success: summary.failed === 0,
				server_knowledge: responseData.server_knowledge,
				summary,
				results,
				transactions: (responseData.transactions ?? []).map(
					toTransactionOutput,
				),
				duplicate_import_ids: responseData.duplicate_import_ids ?? [],
				message: `Processed ${summary.total_requested} transactions: ${summary.created} created, ${summary.duplicates} duplicates, ${summary.failed} failed.`,
			};

			const finalizedResponse = finalizeResponse(baseResponse);

			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(finalizedResponse),
					},
				],
				structuredContent: finalizedResponse as unknown as Record<
					string,
					unknown
				>,
			};
		},
		"ynab:create_transactions",
		"bulk transaction creation",
		errorHandler,
	)) as CallToolResult;
}

/** Fetch only the transactions displayed by the preview, with bounded concurrency. */
async function fetchPreviewTransactions(
	api: ynab.API,
	budgetId: string,
	ids: string[],
) {
	const details = new Map<string, TransactionModel>();
	for (let offset = 0; offset < ids.length; offset += 5) {
		await Promise.all(
			ids.slice(offset, offset + 5).map(async (id) => {
				try {
					const response = await api.transactions.getTransactionById(
						budgetId,
						id,
					);
					if (response.data.transaction)
						details.set(id, response.data.transaction);
				} catch {
					/* The preview reports unavailable before values without issuing writes. */
				}
			}),
		);
	}
	return details;
}

/**
 * Throws a ValidationError grouping schema issues by transaction index
 */
function throwBulkUpdateValidationError(error: z.ZodError): never {
	type TransactionIssueIndex = number | null;
	const issuesByIndex = new Map<TransactionIssueIndex, string[]>();
	const validationIssues = error.issues ?? [];
	for (const issue of validationIssues) {
		const transactionIndex = issue.path.find(
			(segment): segment is number => typeof segment === "number",
		);
		const message = issue.message;
		const issueIndex: TransactionIssueIndex =
			transactionIndex !== undefined ? transactionIndex : null;
		const existing = issuesByIndex.get(issueIndex) ?? [];
		existing.push(message);
		issuesByIndex.set(issueIndex, existing);
	}

	const details = Array.from(issuesByIndex.entries()).map(
		([index, errors]) => ({
			transaction_index: index,
			errors,
		}),
	);

	throw new ValidationError(
		"Bulk transaction update validation failed",
		JSON.stringify(details, null, 2),
		[
			"Ensure each transaction includes an id field",
			"Limit batches to 100 items",
		],
	);
}

/**
 * Scalar fields compared one-to-one between the update and the current state
 */
const PREVIEW_SCALAR_FIELDS = [
	"date",
	"memo",
	"payee_id",
	"payee_name",
	"category_id",
	"cleared",
	"approved",
	"flag_color",
] as const;

/**
 * Every updatable field, in the order reported by dry-run summaries
 */
const UPDATABLE_FIELDS = [
	"amount",
	...PREVIEW_SCALAR_FIELDS,
	"subtransactions",
] as const;

interface MetadataWarning {
	code: string;
	count: number;
	message: string;
	sample_ids?: string[];
}

/**
 * Builds the dry-run response for ynab:update_transactions without writing anything
 */
async function previewBulkUpdate(
	ynabAPI: ynab.API,
	budget_id: UpdateTransactionsParams["budget_id"],
	transactions: BulkUpdateTransactionInput[],
): Promise<CallToolResult> {
	const previewTransactions = transactions.slice(0, 10);
	const previewTransactionIds = previewTransactions.map(
		(transaction) => transaction.id,
	);
	const budgetId = requireResolvedBudgetId(budget_id);
	const previewDetails = await fetchPreviewTransactions(
		ynabAPI,
		budgetId,
		previewTransactionIds,
	);

	const transactionsPreview = [];
	const unavailablePreviewIds: string[] = [];

	for (const transaction of previewTransactions) {
		const currentState = previewDetails.get(transaction.id);
		if (!currentState) {
			unavailablePreviewIds.push(transaction.id);
			transactionsPreview.push({
				transaction_id: transaction.id,
				before: "unavailable",
				after: toUnavailableUpdatePreview(transaction),
			});
			continue;
		}

		transactionsPreview.push({
			transaction_id: transaction.id,
			...buildUpdateDiff(transaction, currentState),
		});
	}

	const warnings = buildPreviewWarnings(unavailablePreviewIds);

	// Collect summary statistics
	const accountsAffected = Array.from(
		new Set(Array.from(previewDetails.values()).map((m) => m.account_id)),
	);

	const response: Record<string, unknown> = {
		dry_run: true,
		action: "ynab_update_transactions",
		validation: "passed",
		summary: {
			total_transactions: transactions.length,
			accounts_affected: accountsAffected,
			fields_to_update: collectFieldsToUpdate(transactions),
		},
		transactions_preview: transactionsPreview,
		note: "Dry run complete. No transactions updated. No caches invalidated. No server_knowledge updated.",
	};

	if (warnings.length > 0) {
		response["warnings"] = warnings;
	}

	return {
		content: [
			{
				type: "text",
				text: responseFormatter.format(response),
			},
		],
		structuredContent: response,
	};
}

/**
 * Returns before/after values for each field the update would actually change
 */
function buildUpdateDiff(
	transaction: BulkUpdateTransactionInput,
	currentState: TransactionModel,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
	const before: TransactionFields & Record<string, unknown> = {};
	const after: TransactionFields & Record<string, unknown> = {};

	if (
		transaction.amount !== undefined &&
		transaction.amount !== currentState.amount
	) {
		before["amount"] = currentState.amount;
		after["amount"] = transaction.amount;
	}
	for (const field of PREVIEW_SCALAR_FIELDS) {
		const nextValue = transaction[field];
		if (nextValue !== undefined && nextValue !== currentState[field]) {
			before[field] = currentState[field];
			after[field] = nextValue;
		}
	}
	if (transaction.subtransactions !== undefined) {
		before["subtransactions"] = (currentState.subtransactions ?? []).filter(
			(subtransaction) => !subtransaction.deleted,
		);
		after["subtransactions"] = transaction.subtransactions;
	}

	return {
		before: toTransactionOutput(before),
		after: toTransactionOutput(after),
	};
}

function buildPreviewWarnings(unavailableIds: string[]): MetadataWarning[] {
	if (!unavailableIds.length) return [];
	return [
		{
			code: "metadata_unavailable",
			count: unavailableIds.length,
			message: `Unable to fetch prior state for ${unavailableIds.length} transactions`,
			sample_ids: unavailableIds.slice(0, 10),
		},
	];
}

function collectFieldsToUpdate(
	transactions: BulkUpdateTransactionInput[],
): string[] {
	const fieldsToUpdate = new Set<string>();
	for (const transaction of transactions) {
		for (const field of UPDATABLE_FIELDS) {
			if (transaction[field] !== undefined) fieldsToUpdate.add(field);
		}
	}
	return Array.from(fieldsToUpdate);
}

/**
 * Prepares a bulk update entry for the YNAB API, including only provided fields
 */
function toSaveTransactionUpdate(
	transaction: BulkUpdateTransactionInput,
): SaveTransactionWithIdOrImportId {
	const transactionData: SaveTransactionWithIdOrImportId = {
		id: transaction.id,
	};

	// Note: account_id is intentionally excluded as account moves are not supported
	if (transaction.amount !== undefined) {
		transactionData.amount = transaction.amount;
	}
	if (transaction.date !== undefined) {
		transactionData.date = transaction.date;
	}
	if (transaction.payee_name !== undefined) {
		transactionData.payee_name = transaction.payee_name;
	}
	if (transaction.payee_id !== undefined) {
		transactionData.payee_id = transaction.payee_id;
	}
	if (transaction.category_id !== undefined) {
		transactionData.category_id = transaction.category_id;
	}
	if (transaction.memo !== undefined) {
		transactionData.memo = transaction.memo;
	}
	if (transaction.cleared !== undefined) {
		transactionData.cleared =
			transaction.cleared as ynab.TransactionClearedStatus;
	}
	if (transaction.approved !== undefined) {
		transactionData.approved = transaction.approved;
	}
	if (transaction.flag_color !== undefined) {
		transactionData.flag_color =
			transaction.flag_color as ynab.TransactionFlagColor;
	}
	if (transaction.subtransactions && transaction.subtransactions.length > 0) {
		transactionData.subtransactions = toSaveSubtransactions(
			transaction.subtransactions,
		);
	}

	return transactionData;
}

function buildBulkUpdateResults(
	transactions: BulkUpdateTransactionInput[],
	updatedTransactions: ynab.TransactionDetail[],
): BulkUpdateResult[] {
	const results: BulkUpdateResult[] = [];
	const updatedIds = new Set(updatedTransactions.map((t) => t.id));

	for (const [index, transaction] of transactions.entries()) {
		if (updatedIds.has(transaction.id)) {
			results.push({
				request_index: index,
				status: "updated",
				transaction_id: transaction.id,
				correlation_key: transaction.id,
			});
		} else {
			results.push({
				request_index: index,
				status: "failed",
				transaction_id: transaction.id,
				correlation_key: transaction.id,
				error_code: "update_failed",
				error: "Transaction was not updated by YNAB API",
			});
		}
	}

	return results;
}

/**
 * Determines which accounts, months, and categories a bulk update touched
 */
/**
 * Handles the ynab:update_transactions tool call
 * Updates multiple transactions in a single batch operation
 */
export async function handleUpdateTransactions(
	ynabAPI: ynab.API,
	params: UpdateTransactionsParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	return (await withToolErrorHandling(
		async () => {
			const validationResult = UpdateTransactionsSchema.safeParse(params);
			if (!validationResult.success) {
				throwBulkUpdateValidationError(validationResult.error);
			}

			const { budget_id, transactions, dry_run } = validationResult.data;

			if (dry_run) {
				return previewBulkUpdate(ynabAPI, budget_id, transactions);
			}
			const budgetId = requireResolvedBudgetId(budget_id);

			// Execute bulk update
			const response = await ynabAPI.transactions.updateTransactions(budgetId, {
				transactions: transactions.map(toSaveTransactionUpdate),
			});

			const responseData = response.data;
			const updatedTransactions = responseData.transactions ?? [];
			const results = buildBulkUpdateResults(transactions, updatedTransactions);

			const summary = {
				total_requested: transactions.length,
				updated: updatedTransactions.length,
				failed: results.filter((r) => r.status === "failed").length,
			};

			const baseResponse: BulkUpdateResponse = {
				success: summary.failed === 0,
				server_knowledge: responseData.server_knowledge,
				summary,
				results,
				transactions: updatedTransactions.map(toTransactionOutput),
				message: `Processed ${summary.total_requested} transactions: ${summary.updated} updated, ${summary.failed} failed.`,
			};

			const finalizedResponse = finalizeBulkUpdateResponse(baseResponse);

			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(finalizedResponse),
					},
				],
				structuredContent: finalizedResponse as unknown as Record<
					string,
					unknown
				>,
			};
		},
		"ynab:update_transactions",
		"bulk transaction update",
		errorHandler,
	)) as CallToolResult;
}

/**
 * Registers write transaction tools with the provided registry.
 */
export function registerTransactionWriteTools(
	registry: ToolRegistry,
	context: ToolContext,
): void {
	const { adapt } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);

	registry.register({
		name: "ynab_create_transaction",
		description: `Create a single transaction in YNAB.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - account_id (string, required): Account UUID.
  - amount_decimal (number, preferred): Amount in decimal currency units (for example, -50.00). Negative for expenses.
  - amount_milliunits (int, alternative): Explicit raw YNAB milliunits (for example, -50000).
  - amount (int, deprecated): Backward-compatible alias for amount_milliunits. Values are never guessed by magnitude.
  - date (string, required): ISO date YYYY-MM-DD.
  - payee_name (string, optional): Payee name (creates new payee if not found).
  - payee_id (string, optional): Existing payee UUID (alternative to payee_name).
  - category_id (string, optional): Category UUID.
  - memo (string, optional): Memo text.
  - cleared (string, optional): "cleared", "uncleared", or "reconciled". Default: "uncleared".
  - approved (boolean, optional): Mark as approved. Default: false.
  - flag_color (string, optional): Transaction flag color ("red", "orange", "yellow", "green", "blue", "purple").
  - dry_run (boolean, optional): Preview without saving. Default: false.
  - subtransactions (array, optional): Manual split lines. Each entry uses exactly one of amount_decimal, amount_milliunits, or deprecated amount, plus optional "memo", "category_id", "payee_id", and "payee_name".

Use "subtransactions" for manual split transactions. Use "ynab_create_receipt_split_transaction" when you have itemized receipt data and want proportional tax allocation handled for you.
Advanced: "import_id" is supported, but it is intentionally not part of normal guidance. Usually omit it if you want the transaction to remain eligible for later bank-import matching.

Returns: the created transaction, including split lines and explicit amount_milliunits.

Examples:
  - $50 expense: set amount_decimal=-50.00
  - Already-converted data: set amount_milliunits=-50000`,
		inputSchema: CreateTransactionSchema,
		outputSchema: CreateTransactionOutputSchema,
		handler: adapt(handleCreateTransaction),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof CreateTransactionSchema>>(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_CREATE,
				title: "YNAB: Create Transaction",
			},
		},
	});

	registry.register({
		name: "ynab_create_transactions",
		description: `Create 1–100 transactions in a single batch with duplicate detection and dry-run support.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - transactions (array, required): Up to 100 transaction objects. Each requires account_id, date, and exactly one of amount_decimal (preferred), amount_milliunits, or deprecated amount.
  - dry_run (boolean, optional): Validate without saving. Default: false.

Returns: summary (created, duplicates, failed), results[], transactions[].

Examples:
  - Dry run first: set dry_run=true to validate before committing
  - If you explicitly want YNAB-side duplicate import detection, set import_id on each transaction`,
		inputSchema: CreateTransactionsSchema,
		outputSchema: CreateTransactionsOutputSchema,
		handler: adapt(handleCreateTransactions),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof CreateTransactionsSchema>>(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_CREATE,
				title: "YNAB: Create Multiple Transactions",
			},
		},
	});

	registry.register({
		name: "ynab_create_receipt_split_transaction",
		description: `Create a split transaction from itemized receipt data with proportional tax allocation.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - account_id (string, required): Account UUID.
  - payee_name (string, required): Store/payee name.
  - receipt_total (number, required): Total amount in dollars (positive).
  - receipt_tax (number, required): Tax amount in dollars (0 if none).
  - categories (array, required): Category groups with items. Each item needs name, amount.
  - date (string, optional): ISO date. Default: today.
  - memo (string, optional): Memo applied to the parent transaction.
  - receipt_subtotal (number, optional): Pre-tax subtotal for validation.
  - cleared (string, optional): "cleared", "uncleared", or "reconciled". Default: "uncleared".
  - approved (boolean, optional): Mark as approved. Default: false.
  - flag_color (string, optional): Transaction flag color ("red", "orange", "yellow", "green", "blue", "purple").
  - dry_run (boolean, optional): Preview subtransactions without saving. Default: false.

Use this helper when you have receipt line items and want tax allocated across categories automatically. For generic manual split transactions without receipt/tax logic, use "ynab_create_transaction" with "subtransactions".

Returns: transaction with subtransactions and receipt_summary.`,
		inputSchema: CreateReceiptSplitTransactionSchema,
		outputSchema: CreateReceiptSplitTransactionOutputSchema,
		handler: adapt(handleCreateReceiptSplitTransaction),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof CreateReceiptSplitTransactionSchema>>(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_CREATE,
				title: "YNAB: Create Split Transaction from Receipt",
			},
		},
	});

	registry.register({
		name: "ynab_update_transaction",
		description: `Update fields on an existing YNAB transaction.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - transaction_id (string, required): Transaction UUID to update.
  - amount_decimal (number, preferred): New amount in decimal currency units.
  - amount_milliunits (int, alternative): Explicit raw YNAB milliunits.
  - amount (int, deprecated): Backward-compatible alias for amount_milliunits.
  - date (string, optional): New date YYYY-MM-DD.
  - payee_name / payee_id (string, optional): New payee.
  - category_id (string, optional): New category UUID.
  - memo (string, optional): New memo.
  - cleared (string, optional): "cleared", "uncleared", or "reconciled".
  - approved (boolean, optional): Approval status.
  - subtransactions (array, optional): Convert a non-split transaction into a split. Supply the parent amount and split lines using amount_decimal, amount_milliunits, or deprecated amount; split amounts must sum to the parent and category_id must be omitted on the parent. YNAB does not support replacing lines on an existing split.
  - dry_run (boolean, optional): Preview without saving.

Returns: the updated transaction, including split lines and explicit amount_milliunits.`,
		inputSchema: UpdateTransactionSchema,
		outputSchema: UpdateTransactionOutputSchema,
		handler: adapt(handleUpdateTransaction),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof UpdateTransactionSchema>>(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
				title: "YNAB: Update Transaction",
			},
		},
	});

	registry.register({
		name: "ynab_update_transactions",
		description: `Update 1–100 transactions in a single batch with dry-run preview.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - transactions (array, required): Up to 100 objects, each requires id plus fields to update. Amount updates use one of amount_decimal (preferred), amount_milliunits, or deprecated amount. A non-split transaction can be converted to a split by supplying the parent amount plus subtransactions that sum to it; YNAB does not support replacing lines on an existing split.
  - dry_run (boolean, optional): Preview changes without saving. Default: false.

Returns: summary (updated, failed), results[], transactions[].

Examples:
  - Dry run: set dry_run=true to preview before/after for first 10 items`,
		inputSchema: UpdateTransactionsSchema,
		outputSchema: UpdateTransactionsOutputSchema,
		handler: adapt(handleUpdateTransactions),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof UpdateTransactionsSchema>>(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
				title: "YNAB: Update Multiple Transactions",
			},
		},
	});

	registry.register({
		name: "ynab_delete_transaction",
		description: `Delete a transaction from YNAB. This action is irreversible.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - transaction_id (string, required): Transaction UUID to delete.
  - dry_run (boolean, optional): Preview without deleting. Default: false.

Returns: the deleted transaction with its ID and deletion status.

Errors:
  - "Transaction not found" → invalid transaction_id`,
		inputSchema: DeleteTransactionSchema,
		outputSchema: DeleteTransactionOutputSchema,
		handler: adapt(handleDeleteTransaction),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof DeleteTransactionSchema>>(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_DELETE,
				title: "YNAB: Delete Transaction",
			},
		},
	});
}
