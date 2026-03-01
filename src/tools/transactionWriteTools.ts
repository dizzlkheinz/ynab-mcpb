import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import type { SaveSubTransaction } from "ynab/dist/models/SaveSubTransaction.js";
import type { SaveTransaction } from "ynab/dist/models/SaveTransaction.js";
import type { SaveTransactionWithIdOrImportId } from "ynab/dist/models/SaveTransactionWithIdOrImportId.js";
import type { z } from "zod/v4";
import { CacheManager, cacheManager } from "../server/cacheManager.js";
import type { DeltaCache } from "../server/deltaCache.js";
import type { ErrorHandler } from "../server/errorHandler.js";
import { globalRequestLogger } from "../server/requestLogger.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ServerKnowledgeStore } from "../server/serverKnowledgeStore.js";
import type { ToolRegistry } from "../server/toolRegistry.js";
import { ValidationError, withToolErrorHandling } from "../types/index.js";
import type { ToolContext } from "../types/toolRegistration.js";
import {
	amountToMilliunits,
	milliunitsToAmount,
} from "../utils/amountUtils.js";
import { createAdapters, createBudgetResolver } from "./adapters.js";
import { resolveDeltaWriteArgs } from "./deltaSupport.js";
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
	type SubtransactionInput,
	type UpdateTransactionParams,
	UpdateTransactionSchema,
	type UpdateTransactionsParams,
	UpdateTransactionsSchema,
} from "./transactionSchemas.js";

import {
	appendCategoryIds,
	collectCategoryIdsFromSources,
	correlateResults,
	ensureTransaction,
	finalizeBulkUpdateResponse,
	finalizeResponse,
	handleTransactionError,
	invalidateTransactionCaches,
	setsEqual,
	toMonthKey,
} from "./transactionUtils.js";

/**
 * Handles the ynab:create_transaction tool call
 * Creates a new transaction in the specified budget and account
 */
export async function handleCreateTransaction(
	ynabAPI: ynab.API,
	deltaCache: DeltaCache,
	knowledgeStore: ServerKnowledgeStore,
	params: CreateTransactionParams,
): Promise<CallToolResult>;
export async function handleCreateTransaction(
	ynabAPI: ynab.API,
	params: CreateTransactionParams,
): Promise<CallToolResult>;
export async function handleCreateTransaction(
	ynabAPI: ynab.API,
	deltaCacheOrParams: DeltaCache | CreateTransactionParams,
	knowledgeStoreOrParams?: ServerKnowledgeStore | CreateTransactionParams,
	maybeParams?: CreateTransactionParams,
	_errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaCache, knowledgeStore, params } = resolveDeltaWriteArgs(
		deltaCacheOrParams,
		knowledgeStoreOrParams,
		maybeParams,
	);
	try {
		if (params.dry_run) {
			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format({
							dry_run: true,
							action: "ynab_create_transaction",
							request: params,
						}),
					},
				],
			};
		}
		// Prepare transaction data
		const transactionData: SaveTransaction = {
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
			const subtransactions: SaveSubTransaction[] = params.subtransactions.map(
				(subtransaction) => {
					const mapped: SaveSubTransaction = {
						amount: subtransaction.amount,
					};

					if (subtransaction.payee_name !== undefined)
						mapped.payee_name = subtransaction.payee_name;
					if (subtransaction.payee_id !== undefined)
						mapped.payee_id = subtransaction.payee_id;
					if (subtransaction.category_id !== undefined) {
						mapped.category_id = subtransaction.category_id;
					}
					if (subtransaction.memo !== undefined)
						mapped.memo = subtransaction.memo;

					return mapped;
				},
			);

			transactionData.subtransactions = subtransactions;
		}

		const response = await ynabAPI.transactions.createTransaction(
			params.budget_id,
			{
				transaction: transactionData,
			},
		);

		const transaction = ensureTransaction(
			response.data.transaction,
			"Transaction creation failed",
		);

		const affectedAccountIds = new Set<string>([transaction.account_id]);
		const affectedMonths = new Set<string>([toMonthKey(transaction.date)]);
		const affectedCategoryIds = collectCategoryIdsFromSources(transaction);
		invalidateTransactionCaches(
			deltaCache,
			knowledgeStore,
			params.budget_id,
			response.data.server_knowledge,
			affectedAccountIds,
			affectedMonths,
			{
				affectedCategoryIds,
				accountTotalsChanged: true,
				invalidateMonths: true,
			},
		);

		// Get the updated account balance
		const accountResponse = await ynabAPI.accounts.getAccountById(
			params.budget_id,
			transaction.account_id,
		);
		const account = accountResponse.data.account;

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
							// New fields for account balance
							account_balance: account.balance,
							account_cleared_balance: account.cleared_balance,
							subtransactions: transaction.subtransactions?.map(
								(subtransaction) => ({
									id: subtransaction.id,
									transaction_id: subtransaction.transaction_id,
									amount: milliunitsToAmount(subtransaction.amount),
									memo: subtransaction.memo,
									payee_id: subtransaction.payee_id,
									payee_name: subtransaction.payee_name,
									category_id: subtransaction.category_id,
									category_name: subtransaction.category_name,
									transfer_account_id: subtransaction.transfer_account_id,
									transfer_transaction_id:
										subtransaction.transfer_transaction_id,
									deleted: subtransaction.deleted,
								}),
							),
						},
					}),
				},
			],
		};
	} catch (error) {
		return handleTransactionError(error, "Failed to create transaction");
	}
}

/**
 * Constants for smart collapse logic
 */
const BIG_TICKET_THRESHOLD_MILLIUNITS = 50000; // $50.00
const COLLAPSE_THRESHOLD = 5; // Collapse if 5 or more remaining items
const MAX_ITEMS_PER_MEMO = 5;
const MAX_MEMO_LENGTH = 150;

/**
 * Truncates a string to fit within maxLength, adding ellipsis if truncated
 */
function truncateToLength(str: string, maxLength: number): string {
	if (str.length <= maxLength) {
		return str;
	}
	const ellipsis = "...";
	return str.substring(0, maxLength - ellipsis.length) + ellipsis;
}

function buildItemMemo(item: {
	name: string;
	quantity: number | undefined;
	memo: string | undefined;
}): string | undefined {
	const quantitySuffix = item.quantity ? ` (x${item.quantity})` : "";
	let result: string;
	if (item.memo && item.memo.trim().length > 0) {
		result = `${item.name}${quantitySuffix} - ${item.memo}`;
	} else if (quantitySuffix) {
		result = `${item.name}${quantitySuffix}`;
	} else {
		result = item.name;
	}
	// Truncate to MAX_MEMO_LENGTH if needed
	return truncateToLength(result, MAX_MEMO_LENGTH);
}

/**
 * Applies smart collapse logic to receipt items according to the specification:
 * 1. Extract special items (big ticket, returns, discounts)
 * 2. Apply threshold to remaining items
 * 3. Collapse by category if needed
 * 4. Handle tax allocation
 */
function applySmartCollapseLogic(
	categoryCalculations: ReceiptCategoryCalculation[],
	taxMilliunits: number,
): SubtransactionInput[] {
	// Step 1: Extract special items and classify remaining items
	interface SpecialItem {
		item: ReceiptCategoryCalculation["items"][0];
		category_id: string;
		category_name: string | undefined;
	}

	interface CategoryItems {
		category_id: string;
		category_name: string | undefined;
		items: ReceiptCategoryCalculation["items"][0][];
	}

	const specialItems: SpecialItem[] = [];
	const remainingItemsByCategory: CategoryItems[] = [];

	for (const category of categoryCalculations) {
		const categorySpecials: ReceiptCategoryCalculation["items"][0][] = [];
		const categoryRemaining: ReceiptCategoryCalculation["items"][0][] = [];

		for (const item of category.items) {
			const isNegative = item.amount_milliunits < 0;
			const unitPrice = item.quantity
				? item.amount_milliunits / item.quantity
				: item.amount_milliunits;
			const isBigTicket = unitPrice > BIG_TICKET_THRESHOLD_MILLIUNITS;

			if (isNegative || isBigTicket) {
				categorySpecials.push(item);
			} else {
				categoryRemaining.push(item);
			}
		}

		// Add specials to the special items list (preserving category order)
		for (const item of categorySpecials) {
			specialItems.push({
				item,
				category_id: category.category_id,
				category_name: category.category_name,
			});
		}

		// Track remaining items by category
		if (categoryRemaining.length > 0) {
			remainingItemsByCategory.push({
				category_id: category.category_id,
				category_name: category.category_name,
				items: categoryRemaining,
			});
		}
	}

	// Step 2: Count total remaining positive items
	const totalRemainingItems = remainingItemsByCategory.reduce(
		(sum, cat) => sum + cat.items.length,
		0,
	);

	// Step 3: Decide whether to collapse
	const shouldCollapse = totalRemainingItems >= COLLAPSE_THRESHOLD;

	// Build subtransactions
	const subtransactions: SubtransactionInput[] = [];

	// Add special items first (returns, discounts, big tickets)
	for (const special of specialItems) {
		const memo = buildItemMemo({
			name: special.item.name,
			quantity: special.item.quantity,
			memo: special.item.memo,
		});
		const payload: SubtransactionInput = {
			amount: -special.item.amount_milliunits,
			category_id: special.category_id,
		};
		if (memo) payload.memo = memo;
		subtransactions.push(payload);
	}

	// Add remaining items (collapsed or itemized)
	if (shouldCollapse) {
		// Collapse by category
		for (const categoryGroup of remainingItemsByCategory) {
			const collapsedSubtransactions = collapseItemsByCategory(categoryGroup);
			subtransactions.push(...collapsedSubtransactions);
		}
	} else {
		// Itemize each remaining item individually
		for (const categoryGroup of remainingItemsByCategory) {
			for (const item of categoryGroup.items) {
				const memo = buildItemMemo({
					name: item.name,
					quantity: item.quantity,
					memo: item.memo,
				});
				const payload: SubtransactionInput = {
					amount: -item.amount_milliunits,
					category_id: categoryGroup.category_id,
				};
				if (memo) payload.memo = memo;
				subtransactions.push(payload);
			}
		}
	}

	// Step 4: Handle tax allocation
	const taxSubtransactions = allocateTax(categoryCalculations, taxMilliunits);
	subtransactions.push(...taxSubtransactions);

	return subtransactions;
}

/**
 * Collapses items within a category into groups of up to MAX_ITEMS_PER_MEMO
 */
function collapseItemsByCategory(categoryGroup: {
	category_id: string;
	category_name: string | undefined;
	items: ReceiptCategoryCalculation["items"][0][];
}): SubtransactionInput[] {
	const subtransactions: SubtransactionInput[] = [];
	const items = categoryGroup.items;

	let currentBatch: ReceiptCategoryCalculation["items"][0][] = [];
	let currentBatchTotal = 0;

	for (const item of items) {
		// Check if we've hit the max items per memo
		if (currentBatch.length >= MAX_ITEMS_PER_MEMO) {
			// Flush current batch
			const memo = buildCollapsedMemo(currentBatch);
			subtransactions.push({
				amount: -currentBatchTotal,
				category_id: categoryGroup.category_id,
				memo,
			});
			currentBatch = [];
			currentBatchTotal = 0;
		}

		// Try adding this item to the current batch
		const testBatch = [...currentBatch, item];
		const testMemo = buildCollapsedMemo(testBatch);

		if (testMemo.length <= MAX_MEMO_LENGTH) {
			// Fits - add to batch
			currentBatch.push(item);
			currentBatchTotal += item.amount_milliunits;
		} else {
			// Doesn't fit - flush current batch and start new one
			if (currentBatch.length > 0) {
				const memo = buildCollapsedMemo(currentBatch);
				subtransactions.push({
					amount: -currentBatchTotal,
					category_id: categoryGroup.category_id,
					memo,
				});
				currentBatch = [item];
				currentBatchTotal = item.amount_milliunits;
			} else {
				// Edge case: single item is too long, use it anyway
				currentBatch = [item];
				currentBatchTotal = item.amount_milliunits;
			}
		}
	}

	// Flush remaining batch
	if (currentBatch.length > 0) {
		const memo = buildCollapsedMemo(currentBatch);
		subtransactions.push({
			amount: -currentBatchTotal,
			category_id: categoryGroup.category_id,
			memo,
		});
	}

	return subtransactions;
}

/**
 * Truncates an item name to fit within available space
 * Preserves the amount suffix and adds "..." to indicate truncation
 */
function truncateItemName(
	name: string,
	amountSuffix: string,
	maxLength: number,
): string {
	const ellipsis = "...";
	// We need: truncatedName + ellipsis + amountSuffix <= maxLength
	const availableForName = maxLength - ellipsis.length - amountSuffix.length;

	if (availableForName <= 0) {
		// Edge case: amount suffix alone is too long, just return what we can
		return amountSuffix.substring(0, maxLength);
	}

	return name.substring(0, availableForName) + ellipsis + amountSuffix;
}

/**
 * Builds a collapsed memo from a list of items
 * Format: "Item1 $X.XX, Item2 $Y.YY, Item3 $Z.ZZ"
 * Truncates with "..." if needed (either individual items or the list)
 */
function buildCollapsedMemo(
	items: ReceiptCategoryCalculation["items"][0][],
): string {
	const parts: string[] = [];
	let currentLength = 0;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (!item) continue;
		const amount = milliunitsToAmount(item.amount_milliunits);
		const amountSuffix = ` $${amount.toFixed(2)}`;
		let itemStr = `${item.name}${amountSuffix}`;
		const separator = i > 0 ? ", " : "";

		// For the first item, check if it alone exceeds the limit
		if (parts.length === 0 && itemStr.length > MAX_MEMO_LENGTH) {
			itemStr = truncateItemName(item.name, amountSuffix, MAX_MEMO_LENGTH);
		}

		const testLength = currentLength + separator.length + itemStr.length;

		// Check if adding this item would exceed limit
		if (parts.length > 0 && testLength + 4 > MAX_MEMO_LENGTH) {
			// Would exceed - stop here and add "..."
			break;
		}

		parts.push(itemStr);
		currentLength = testLength;
	}

	let result = parts.join(", ");

	// Add "..." if we didn't include all items
	if (parts.length < items.length) {
		result += "...";
	}

	return result;
}

/**
 * Allocates tax across categories
 * - Positive categories get proportional tax subtransactions
 * - Negative tax creates a single tax refund subtransaction
 */
function allocateTax(
	categoryCalculations: ReceiptCategoryCalculation[],
	taxMilliunits: number,
): SubtransactionInput[] {
	const subtransactions: SubtransactionInput[] = [];

	// Handle tax = 0
	if (taxMilliunits === 0) {
		return subtransactions;
	}

	// Handle negative tax (refund)
	if (taxMilliunits < 0) {
		// Find category with largest return
		let largestReturnCategory: ReceiptCategoryCalculation | undefined;
		let largestReturnAmount = 0;

		for (const category of categoryCalculations) {
			const categoryReturnAmount = category.items
				.filter((item) => item.amount_milliunits < 0)
				.reduce((sum, item) => sum + Math.abs(item.amount_milliunits), 0);

			if (categoryReturnAmount > largestReturnAmount) {
				largestReturnAmount = categoryReturnAmount;
				largestReturnCategory = category;
			}
		}

		// Default to first category if no returns found
		if (!largestReturnCategory) {
			largestReturnCategory = categoryCalculations[0];
		}

		if (largestReturnCategory) {
			subtransactions.push({
				amount: -taxMilliunits,
				category_id: largestReturnCategory.category_id,
				memo: "Tax refund",
			});
		}

		return subtransactions;
	}

	// Positive tax - allocate proportionally to positive categories only
	const positiveCategorySubtotals = categoryCalculations
		.map((cat) => ({
			category: cat,
			positiveSubtotal: cat.items
				.filter((item) => item.amount_milliunits > 0)
				.reduce((sum, item) => sum + item.amount_milliunits, 0),
		}))
		.filter((x) => x.positiveSubtotal > 0);

	if (positiveCategorySubtotals.length === 0) {
		// No positive items, no tax allocation
		return subtransactions;
	}

	const totalPositiveSubtotal = positiveCategorySubtotals.reduce(
		(sum, x) => sum + x.positiveSubtotal,
		0,
	);

	// Distribute tax using largest remainder method
	let allocatedTax = 0;
	const taxAllocations: {
		category: ReceiptCategoryCalculation;
		taxAmount: number;
	}[] = [];

	for (let i = 0; i < positiveCategorySubtotals.length; i++) {
		const entry = positiveCategorySubtotals[i];
		if (!entry) continue;

		const { category, positiveSubtotal } = entry;

		if (i === positiveCategorySubtotals.length - 1) {
			// Last category gets remainder
			const taxAmount = taxMilliunits - allocatedTax;
			if (taxAmount > 0) {
				taxAllocations.push({ category, taxAmount });
			}
		} else {
			const taxAmount = Math.round(
				(taxMilliunits * positiveSubtotal) / totalPositiveSubtotal,
			);
			if (taxAmount > 0) {
				taxAllocations.push({ category, taxAmount });
				allocatedTax += taxAmount;
			}
		}
	}

	// Create tax subtransactions
	for (const { category, taxAmount } of taxAllocations) {
		subtransactions.push({
			amount: -taxAmount,
			category_id: category.category_id,
			memo: `Tax - ${category.category_name ?? "Uncategorized"}`,
		});
	}

	return subtransactions;
}

export async function handleCreateReceiptSplitTransaction(
	ynabAPI: ynab.API,
	deltaCache: DeltaCache,
	knowledgeStore: ServerKnowledgeStore,
	params: CreateReceiptSplitTransactionParams,
): Promise<CallToolResult>;
export async function handleCreateReceiptSplitTransaction(
	ynabAPI: ynab.API,
	params: CreateReceiptSplitTransactionParams,
): Promise<CallToolResult>;
export async function handleCreateReceiptSplitTransaction(
	ynabAPI: ynab.API,
	deltaCacheOrParams: DeltaCache | CreateReceiptSplitTransactionParams,
	knowledgeStoreOrParams?:
		| ServerKnowledgeStore
		| CreateReceiptSplitTransactionParams,
	maybeParams?: CreateReceiptSplitTransactionParams,
	_errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaCache, knowledgeStore, params } = resolveDeltaWriteArgs(
		deltaCacheOrParams,
		knowledgeStoreOrParams,
		maybeParams,
	);
	const date = params.date ?? new Date().toISOString().slice(0, 10);

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
		return {
			content: [
				{
					type: "text",
					text: responseFormatter.format({
						dry_run: true,
						action: "ynab_create_receipt_split_transaction",
						transaction_preview: {
							account_id: params.account_id,
							payee_name: params.payee_name,
							date,
							amount: milliunitsToAmount(totalMilliunits),
							cleared: params.cleared ?? "uncleared",
						},
						receipt_summary: receiptSummary,
						subtransactions: subtransactions.map((subtransaction) => ({
							amount: milliunitsToAmount(-subtransaction.amount),
							category_id: subtransaction.category_id,
							memo: subtransaction.memo,
						})),
					}),
				},
			],
		};
	}

	const createTransactionParams: CreateTransactionParams = {
		budget_id: params.budget_id,
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
		deltaCache,
		knowledgeStore,
		createTransactionParams,
	);

	const firstContent = baseResult.content?.[0];
	if (!firstContent || firstContent.type !== "text") {
		return baseResult;
	}

	try {
		const parsed = JSON.parse(firstContent.text) as Record<string, unknown>;
		parsed["receipt_summary"] = receiptSummary;
		firstContent.text = responseFormatter.format(parsed);
	} catch {
		// If parsing fails, return the original result without augmentation.
	}

	return baseResult;
}

/**
 * Handles the ynab:update_transaction tool call
 * Updates an existing transaction with the provided fields
 */
export async function handleUpdateTransaction(
	ynabAPI: ynab.API,
	deltaCache: DeltaCache,
	knowledgeStore: ServerKnowledgeStore,
	params: UpdateTransactionParams,
): Promise<CallToolResult>;
export async function handleUpdateTransaction(
	ynabAPI: ynab.API,
	params: UpdateTransactionParams,
): Promise<CallToolResult>;
export async function handleUpdateTransaction(
	ynabAPI: ynab.API,
	deltaCacheOrParams: DeltaCache | UpdateTransactionParams,
	knowledgeStoreOrParams?: ServerKnowledgeStore | UpdateTransactionParams,
	maybeParams?: UpdateTransactionParams,
	_errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaCache, knowledgeStore, params } = resolveDeltaWriteArgs(
		deltaCacheOrParams,
		knowledgeStoreOrParams,
		maybeParams,
	);
	try {
		if (params.dry_run) {
			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format({
							dry_run: true,
							action: "ynab_update_transaction",
							request: params,
						}),
					},
				],
			};
		}

		// Get the original transaction before updating to capture the original account_id
		const originalTransactionResponse =
			await ynabAPI.transactions.getTransactionById(
				params.budget_id,
				params.transaction_id,
			);
		const originalTransaction = ensureTransaction(
			originalTransactionResponse.data.transaction,
			"Original transaction not found",
		);

		// Prepare transaction update data - only include fields that are provided
		const transactionData: SaveTransaction = {};

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

		const response = await ynabAPI.transactions.updateTransaction(
			params.budget_id,
			params.transaction_id,
			{
				transaction: transactionData,
			},
		);

		const transaction = ensureTransaction(
			response.data.transaction,
			"Transaction update failed",
		);

		const specificTransactionCacheKey = CacheManager.generateKey(
			"transaction",
			"get",
			params.budget_id,
			params.transaction_id,
		);
		cacheManager.delete(specificTransactionCacheKey);

		const affectedAccountIds = new Set<string>([
			originalTransaction.account_id,
			transaction.account_id,
		]);

		if (originalTransaction.transfer_account_id) {
			affectedAccountIds.add(originalTransaction.transfer_account_id);
		}
		if (transaction.transfer_account_id) {
			affectedAccountIds.add(transaction.transfer_account_id);
		}

		const affectedMonths = new Set<string>([
			toMonthKey(originalTransaction.date),
			toMonthKey(transaction.date),
		]);
		const originalCategoryIds =
			collectCategoryIdsFromSources(originalTransaction);
		const updatedCategoryIds = collectCategoryIdsFromSources(transaction);
		const affectedCategoryIds = new Set<string>([
			...originalCategoryIds,
			...updatedCategoryIds,
		]);
		const categoryChanged = !setsEqual(originalCategoryIds, updatedCategoryIds);
		const amountChanged = transaction.amount !== originalTransaction.amount;
		const accountChanged =
			transaction.account_id !== originalTransaction.account_id;
		const clearedChanged = transaction.cleared !== originalTransaction.cleared;
		const transferAccountChanged =
			transaction.transfer_account_id !==
			originalTransaction.transfer_account_id;
		const transferLinkChanged =
			transaction.transfer_transaction_id !==
			originalTransaction.transfer_transaction_id;
		const dateChanged = transaction.date !== originalTransaction.date;

		invalidateTransactionCaches(
			deltaCache,
			knowledgeStore,
			params.budget_id,
			response.data.server_knowledge,
			affectedAccountIds,
			affectedMonths,
			{
				affectedCategoryIds,
				accountTotalsChanged:
					amountChanged ||
					accountChanged ||
					clearedChanged ||
					transferAccountChanged ||
					transferLinkChanged,
				invalidateMonths: amountChanged || categoryChanged || dateChanged,
			},
		);

		// Get the updated account balance
		const accountResponse = await ynabAPI.accounts.getAccountById(
			params.budget_id,
			transaction.account_id,
		);
		const account = accountResponse.data.account;

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
						},
						updated_balance: account.balance,
						updated_cleared_balance: account.cleared_balance,
					}),
				},
			],
		};
	} catch (error) {
		return handleTransactionError(error, "Failed to update transaction");
	}
}

/**
 * Handles the ynab:delete_transaction tool call
 * Deletes a transaction from the specified budget
 */
export async function handleDeleteTransaction(
	ynabAPI: ynab.API,
	deltaCache: DeltaCache,
	knowledgeStore: ServerKnowledgeStore,
	params: DeleteTransactionParams,
): Promise<CallToolResult>;
export async function handleDeleteTransaction(
	ynabAPI: ynab.API,
	params: DeleteTransactionParams,
): Promise<CallToolResult>;
export async function handleDeleteTransaction(
	ynabAPI: ynab.API,
	deltaCacheOrParams: DeltaCache | DeleteTransactionParams,
	knowledgeStoreOrParams?: ServerKnowledgeStore | DeleteTransactionParams,
	maybeParams?: DeleteTransactionParams,
	_errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaCache, knowledgeStore, params } = resolveDeltaWriteArgs(
		deltaCacheOrParams,
		knowledgeStoreOrParams,
		maybeParams,
	);
	try {
		if (params.dry_run) {
			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format({
							dry_run: true,
							action: "ynab_delete_transaction",
							request: params,
						}),
					},
				],
			};
		}
		const response = await ynabAPI.transactions.deleteTransaction(
			params.budget_id,
			params.transaction_id,
		);

		const transaction = ensureTransaction(
			response.data.transaction,
			"Transaction deletion failed",
		);

		const specificTransactionCacheKey = CacheManager.generateKey(
			"transaction",
			"get",
			params.budget_id,
			params.transaction_id,
		);
		cacheManager.delete(specificTransactionCacheKey);

		const affectedAccountIds = new Set<string>([transaction.account_id]);
		if (transaction.transfer_account_id) {
			affectedAccountIds.add(transaction.transfer_account_id);
		}

		const affectedMonths = new Set<string>([toMonthKey(transaction.date)]);
		const affectedCategoryIds = collectCategoryIdsFromSources(transaction);
		invalidateTransactionCaches(
			deltaCache,
			knowledgeStore,
			params.budget_id,
			response.data.server_knowledge,
			affectedAccountIds,
			affectedMonths,
			{
				affectedCategoryIds,
				accountTotalsChanged: true,
				invalidateMonths: true,
			},
		);

		// Get the updated account balance
		const accountResponse = await ynabAPI.accounts.getAccountById(
			params.budget_id,
			transaction.account_id,
		);
		const account = accountResponse.data.account;

		return {
			content: [
				{
					type: "text",
					text: responseFormatter.format({
						message: "Transaction deleted successfully",
						transaction: {
							id: transaction.id,
							deleted: transaction.deleted,
						},
						updated_balance: account.balance,
						updated_cleared_balance: account.cleared_balance,
					}),
				},
			],
		};
	} catch (error) {
		return handleTransactionError(error, "Failed to delete transaction");
	}
}

export async function handleCreateTransactions(
	ynabAPI: ynab.API,
	deltaCache: DeltaCache,
	knowledgeStore: ServerKnowledgeStore,
	params: CreateTransactionsParams,
): Promise<CallToolResult>;
export async function handleCreateTransactions(
	ynabAPI: ynab.API,
	params: CreateTransactionsParams,
): Promise<CallToolResult>;
export async function handleCreateTransactions(
	ynabAPI: ynab.API,
	deltaCacheOrParams: DeltaCache | CreateTransactionsParams,
	knowledgeStoreOrParams?: ServerKnowledgeStore | CreateTransactionsParams,
	maybeParams?: CreateTransactionsParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaCache, knowledgeStore, params } = resolveDeltaWriteArgs(
		deltaCacheOrParams,
		knowledgeStoreOrParams,
		maybeParams,
	);
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
						account_id: transaction.account_id,
						date: transaction.date,
						amount: milliunitsToAmount(transaction.amount),
						memo: transaction.memo,
						payee_id: transaction.payee_id,
						payee_name: transaction.payee_name,
						category_id: transaction.category_id,
						import_id: transaction.import_id,
					}));

				return {
					content: [
						{
							type: "text",
							text: responseFormatter.format({
								dry_run: true,
								action: "ynab_create_transactions",
								validation: "passed",
								summary: {
									total_transactions: transactions.length,
									total_amount: milliunitsToAmount(totalAmount),
									accounts_affected: accountsAffected,
									date_range: dateRange,
									categories_affected: categoriesAffected,
								},
								transactions_preview: transactionsPreview,
								note: "Dry run complete. No transactions created. No caches invalidated. No server_knowledge updated.",
							}),
						},
					],
				};
			}

			const saveTransactions: SaveTransaction[] = transactions.map(
				(transaction) => {
					const payload: SaveTransaction = {
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

			const response = await ynabAPI.transactions.createTransactions(
				budget_id,
				{
					transactions: saveTransactions,
				},
			);

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
				transactions: responseData.transactions ?? [],
				duplicate_import_ids: responseData.duplicate_import_ids ?? [],
				message: `Processed ${summary.total_requested} transactions: ${summary.created} created, ${summary.duplicates} duplicates, ${summary.failed} failed.`,
			};

			const accountIds = new Set<string>(
				transactions.map((transaction) => transaction.account_id),
			);
			const affectedMonths = new Set<string>(
				transactions.map((transaction) => toMonthKey(transaction.date)),
			);
			const affectedCategoryIds = new Set<string>();
			for (const created of responseData.transactions ?? []) {
				appendCategoryIds(created, affectedCategoryIds);
			}
			invalidateTransactionCaches(
				deltaCache,
				knowledgeStore,
				budget_id,
				responseData.server_knowledge,
				accountIds,
				affectedMonths,
				{
					affectedCategoryIds,
					accountTotalsChanged: true,
					invalidateMonths: true,
				},
			);

			const finalizedResponse = finalizeResponse(baseResponse);

			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(finalizedResponse),
					},
				],
			};
		},
		"ynab:create_transactions",
		"bulk transaction creation",
		errorHandler,
	)) as CallToolResult;
}

/**
 * Interface for transaction metadata needed for cache invalidation
 */
interface TransactionMetadata {
	account_id: string;
	date: string;
}

/**
 * Result of metadata resolution including both resolved metadata and unresolved IDs
 */
interface MetadataResolutionResult {
	metadata: Map<string, TransactionMetadata>;
	unresolvedIds: string[];
	previewDetails: Map<string, ynab.TransactionDetail>;
}

interface ResolveMetadataOptions {
	previewTransactionIds?: string[];
}

/**
 * Resolves metadata for bulk update transactions
 * Uses a multi-tier approach: request metadata -> cache -> limited API calls
 * Returns both the resolved metadata and a list of IDs that could not be resolved
 */
async function resolveMetadata(
	ynabAPI: ynab.API,
	budgetId: string,
	transactions: BulkUpdateTransactionInput[],
	options: ResolveMetadataOptions = {},
): Promise<MetadataResolutionResult> {
	const metadata = new Map<string, TransactionMetadata>();
	const needsResolution: string[] = [];
	const previewIds = new Set(options.previewTransactionIds ?? []);
	const previewDetails = new Map<string, ynab.TransactionDetail>();
	const previewIdsNeedingFetch = new Set(previewIds);

	// First pass: Use provided metadata
	for (const transaction of transactions) {
		if (transaction.original_account_id && transaction.original_date) {
			metadata.set(transaction.id, {
				account_id: transaction.original_account_id,
				date: transaction.original_date,
			});
		} else {
			needsResolution.push(transaction.id);
		}
	}

	if (previewIds.size === 0 && needsResolution.length === 0) {
		return { metadata, unresolvedIds: [], previewDetails };
	}

	// Second pass: hydrate from cache for both metadata needs and preview requests
	const needsResolutionSet = new Set(needsResolution);
	const cacheLookupIds = new Set<string>([...needsResolution, ...previewIds]);
	for (const transactionId of cacheLookupIds) {
		const cacheKey = CacheManager.generateKey(
			"transaction",
			"get",
			budgetId,
			transactionId,
		);
		const cached = cacheManager.get<ynab.TransactionDetail>(cacheKey);
		if (!cached) {
			continue;
		}

		if (needsResolutionSet.has(transactionId)) {
			metadata.set(transactionId, {
				account_id: cached.account_id,
				date: cached.date,
			});
			needsResolutionSet.delete(transactionId);
		}
		if (previewIds.has(transactionId) && !previewDetails.has(transactionId)) {
			previewDetails.set(transactionId, cached);
			previewIdsNeedingFetch.delete(transactionId);
		}
	}

	const stillNeedsResolution = Array.from(needsResolutionSet);
	if (stillNeedsResolution.length === 0 && previewIdsNeedingFetch.size === 0) {
		return { metadata, unresolvedIds: [], previewDetails };
	}

	// Third pass: Limited API calls with concurrency limit
	const MAX_CONCURRENT_FETCHES = 5;
	const fetchPromises: Promise<void>[] = [];
	const metadataAwaitingResolution = new Set(stillNeedsResolution);
	const idsNeedingApiFetch = Array.from(
		new Set([...stillNeedsResolution, ...previewIdsNeedingFetch]),
	);

	for (let i = 0; i < idsNeedingApiFetch.length; i += MAX_CONCURRENT_FETCHES) {
		const batch = idsNeedingApiFetch.slice(i, i + MAX_CONCURRENT_FETCHES);
		const batchPromises = batch.map(async (transactionId) => {
			try {
				const response = await ynabAPI.transactions.getTransactionById(
					budgetId,
					transactionId,
				);
				const transaction = response.data.transaction;
				if (transaction) {
					if (metadataAwaitingResolution.has(transactionId)) {
						metadata.set(transactionId, {
							account_id: transaction.account_id,
							date: transaction.date,
						});
						metadataAwaitingResolution.delete(transactionId);
					}
					if (
						previewIdsNeedingFetch.has(transactionId) &&
						!previewDetails.has(transactionId)
					) {
						previewDetails.set(transactionId, transaction);
						previewIdsNeedingFetch.delete(transactionId);
					}
				}
			} catch {
				if (metadataAwaitingResolution.has(transactionId)) {
					globalRequestLogger.logError(
						"ynab:update_transactions",
						"resolve_metadata",
						{ transaction_id: transactionId },
						"Failed to resolve transaction metadata",
					);
				}
			}
		});
		fetchPromises.push(...batchPromises);
	}

	await Promise.all(fetchPromises);
	return {
		metadata,
		unresolvedIds: Array.from(metadataAwaitingResolution),
		previewDetails,
	};
}

/**
 * Handles the ynab:update_transactions tool call
 * Updates multiple transactions in a single batch operation
 */
export async function handleUpdateTransactions(
	ynabAPI: ynab.API,
	deltaCache: DeltaCache,
	knowledgeStore: ServerKnowledgeStore,
	params: UpdateTransactionsParams,
): Promise<CallToolResult>;
export async function handleUpdateTransactions(
	ynabAPI: ynab.API,
	params: UpdateTransactionsParams,
): Promise<CallToolResult>;
export async function handleUpdateTransactions(
	ynabAPI: ynab.API,
	deltaCacheOrParams: DeltaCache | UpdateTransactionsParams,
	knowledgeStoreOrParams?: ServerKnowledgeStore | UpdateTransactionsParams,
	maybeParams?: UpdateTransactionsParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaCache, knowledgeStore, params } = resolveDeltaWriteArgs(
		deltaCacheOrParams,
		knowledgeStoreOrParams,
		maybeParams,
	);
	return (await withToolErrorHandling(
		async () => {
			const validationResult = UpdateTransactionsSchema.safeParse(params);
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
					"Bulk transaction update validation failed",
					JSON.stringify(details, null, 2),
					[
						"Ensure each transaction includes an id field",
						"Limit batches to 100 items",
					],
				);
			}

			const { budget_id, transactions, dry_run } = validationResult.data;

			if (dry_run) {
				const previewTransactions = transactions.slice(0, 10);
				const previewTransactionIds = previewTransactions.map(
					(transaction) => transaction.id,
				);
				// Resolve metadata once and reuse any transaction details for preview rendering
				const { metadata, unresolvedIds, previewDetails } =
					await resolveMetadata(ynabAPI, budget_id, transactions, {
						previewTransactionIds,
					});

				const transactionsPreview = [];
				const unavailablePreviewIds: string[] = [];

				for (const transaction of previewTransactions) {
					const currentState = previewDetails.get(transaction.id);
					if (!currentState) {
						unavailablePreviewIds.push(transaction.id);
						transactionsPreview.push({
							transaction_id: transaction.id,
							before: "unavailable",
							after: transaction,
						});
						continue;
					}

					const before: Record<string, unknown> = {};
					const after: Record<string, unknown> = {};

					if (
						transaction.amount !== undefined &&
						transaction.amount !== currentState.amount
					) {
						before["amount"] = milliunitsToAmount(currentState.amount);
						after["amount"] = milliunitsToAmount(transaction.amount);
					}
					if (
						transaction.date !== undefined &&
						transaction.date !== currentState.date
					) {
						before["date"] = currentState.date;
						after["date"] = transaction.date;
					}
					if (
						transaction.memo !== undefined &&
						transaction.memo !== currentState.memo
					) {
						before["memo"] = currentState.memo;
						after["memo"] = transaction.memo;
					}
					if (
						transaction.payee_id !== undefined &&
						transaction.payee_id !== currentState.payee_id
					) {
						before["payee_id"] = currentState.payee_id;
						after["payee_id"] = transaction.payee_id;
					}
					if (
						transaction.payee_name !== undefined &&
						transaction.payee_name !== currentState.payee_name
					) {
						before["payee_name"] = currentState.payee_name;
						after["payee_name"] = transaction.payee_name;
					}
					if (
						transaction.category_id !== undefined &&
						transaction.category_id !== currentState.category_id
					) {
						before["category_id"] = currentState.category_id;
						after["category_id"] = transaction.category_id;
					}
					if (
						transaction.cleared !== undefined &&
						transaction.cleared !== currentState.cleared
					) {
						before["cleared"] = currentState.cleared;
						after["cleared"] = transaction.cleared;
					}
					if (
						transaction.approved !== undefined &&
						transaction.approved !== currentState.approved
					) {
						before["approved"] = currentState.approved;
						after["approved"] = transaction.approved;
					}
					if (
						transaction.flag_color !== undefined &&
						transaction.flag_color !== currentState.flag_color
					) {
						before["flag_color"] = currentState.flag_color;
						after["flag_color"] = transaction.flag_color;
					}

					transactionsPreview.push({
						transaction_id: transaction.id,
						before,
						after,
					});
				}

				// Build warnings array
				const warnings: {
					code: string;
					count: number;
					message: string;
					sample_ids?: string[];
				}[] = [];
				if (unavailablePreviewIds.length > 0 || unresolvedIds.length > 0) {
					const totalMissing = Math.max(
						unavailablePreviewIds.length,
						unresolvedIds.length,
					);
					const sampleIds =
						unresolvedIds.length > 0
							? unresolvedIds.slice(0, 10)
							: unavailablePreviewIds.slice(0, 10);
					warnings.push({
						code: "metadata_unavailable",
						count: totalMissing,
						message: `Unable to fetch prior state for ${totalMissing} transactions`,
						sample_ids: sampleIds,
					});
				}

				// Collect summary statistics
				const accountsAffected = Array.from(
					new Set(Array.from(metadata.values()).map((m) => m.account_id)),
				);
				const fieldsToUpdate = new Set<string>();
				for (const transaction of transactions) {
					if (transaction.amount !== undefined) fieldsToUpdate.add("amount");
					if (transaction.date !== undefined) fieldsToUpdate.add("date");
					if (transaction.memo !== undefined) fieldsToUpdate.add("memo");
					if (transaction.payee_id !== undefined)
						fieldsToUpdate.add("payee_id");
					if (transaction.payee_name !== undefined)
						fieldsToUpdate.add("payee_name");
					if (transaction.category_id !== undefined)
						fieldsToUpdate.add("category_id");
					if (transaction.cleared !== undefined) fieldsToUpdate.add("cleared");
					if (transaction.approved !== undefined)
						fieldsToUpdate.add("approved");
					if (transaction.flag_color !== undefined)
						fieldsToUpdate.add("flag_color");
				}

				const response: Record<string, unknown> = {
					dry_run: true,
					action: "ynab_update_transactions",
					validation: "passed",
					summary: {
						total_transactions: transactions.length,
						accounts_affected: accountsAffected,
						fields_to_update: Array.from(fieldsToUpdate),
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
				};
			}

			// Resolve metadata for cache invalidation before making updates
			const { metadata, unresolvedIds } = await resolveMetadata(
				ynabAPI,
				budget_id,
				transactions,
			);

			// Check metadata completeness threshold (5%)
			const missingMetadataRatio = unresolvedIds.length / transactions.length;
			const METADATA_THRESHOLD = 0.05; // 5%

			if (missingMetadataRatio > METADATA_THRESHOLD) {
				throw new ValidationError(
					`METADATA_INCOMPLETE: ${(missingMetadataRatio * 100).toFixed(1)}% of transactions have missing metadata (threshold: ${(METADATA_THRESHOLD * 100).toFixed(0)}%)`,
					JSON.stringify(
						{
							unresolved_count: unresolvedIds.length,
							total_transactions: transactions.length,
							ratio: `${(missingMetadataRatio * 100).toFixed(1)}%`,
							threshold: `${(METADATA_THRESHOLD * 100).toFixed(0)}%`,
							sample_unresolved_ids: unresolvedIds.slice(0, 5),
						},
						null,
						2,
					),
					[
						"Provide original_account_id and original_date for all transactions being updated",
						"Ensure transactions exist in YNAB before updating them",
					],
				);
			}

			if (missingMetadataRatio > 0.01) {
				globalRequestLogger.logRequest(
					"ynab:update_transactions",
					"metadata_resolution_warning",
					{
						unresolved_count: unresolvedIds.length,
						total_transactions: transactions.length,
						ratio: missingMetadataRatio.toFixed(3),
						sample_ids: unresolvedIds.slice(0, 5),
						message: "Metadata resolution incomplete for some transactions",
					},
					true,
				);
			}

			// Prepare update transactions for the YNAB API
			const updateTransactions: SaveTransactionWithIdOrImportId[] =
				transactions.map((transaction) => {
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

					return transactionData;
				});

			// Execute bulk update
			const response = await ynabAPI.transactions.updateTransactions(
				budget_id,
				{
					transactions: updateTransactions,
				},
			);

			const responseData = response.data;
			const updatedTransactions = responseData.transactions ?? [];

			// Build results
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
				transactions: updatedTransactions,
				message: `Processed ${summary.total_requested} transactions: ${summary.updated} updated, ${summary.failed} failed.`,
			};

			for (const transaction of transactions) {
				cacheManager.delete(
					CacheManager.generateKey(
						"transaction",
						"get",
						budget_id,
						transaction.id,
					),
				);
			}

			const affectedAccountIds = new Set<string>();
			const affectedMonthKeys = new Set<string>();
			const affectedCategoryIds = new Set<string>();
			let invalidateAllCategories = false;
			let accountTotalsChanged = false;
			let monthsImpacted = false;

			for (const transaction of transactions) {
				const meta = metadata.get(transaction.id);
				const amountChanged = transaction.amount !== undefined;
				const clearedChanged = transaction.cleared !== undefined;
				const categoryChanged = transaction.category_id !== undefined;
				const dateChanged = transaction.date !== undefined;

				if ((amountChanged || clearedChanged) && meta) {
					affectedAccountIds.add(meta.account_id);
				}

				if (amountChanged) {
					monthsImpacted = true;
					accountTotalsChanged = true;
					invalidateAllCategories = true;
					if (meta) {
						affectedMonthKeys.add(toMonthKey(meta.date));
					}
				}

				if (categoryChanged) {
					monthsImpacted = true;
					invalidateAllCategories = true;
					if (transaction.category_id) {
						affectedCategoryIds.add(transaction.category_id);
					}
					if (meta) {
						affectedMonthKeys.add(toMonthKey(meta.date));
					}
				}

				if (dateChanged && meta) {
					monthsImpacted = true;
					affectedMonthKeys.add(toMonthKey(meta.date));
				}
				if (dateChanged && transaction.date) {
					affectedMonthKeys.add(toMonthKey(transaction.date));
				}
			}

			invalidateTransactionCaches(
				deltaCache,
				knowledgeStore,
				budget_id,
				responseData.server_knowledge,
				affectedAccountIds,
				affectedMonthKeys,
				{
					affectedCategoryIds,
					invalidateAllCategories,
					accountTotalsChanged,
					invalidateMonths: monthsImpacted,
				},
			);

			const finalizedResponse = finalizeBulkUpdateResponse(baseResponse);

			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(finalizedResponse),
					},
				],
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
	const { adaptWrite } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);

	registry.register({
		name: "ynab_create_transaction",
		description: `Create a single transaction in YNAB.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - account_id (string, required): Account UUID.
  - amount (int, required): Amount in milliunits (dollars × 1000). Negative for expenses.
  - date (string, required): ISO date YYYY-MM-DD.
  - payee_name (string, optional): Payee name (creates new payee if not found).
  - payee_id (string, optional): Existing payee UUID (alternative to payee_name).
  - category_id (string, optional): Category UUID.
  - memo (string, optional): Memo text.
  - cleared (string, optional): "cleared", "uncleared", or "reconciled". Default: "uncleared".
  - approved (boolean, optional): Mark as approved. Default: false.
  - dry_run (boolean, optional): Preview without saving. Default: false.

Returns: created transaction with account_balance.

Examples:
  - $50 expense: set amount=-50000 (milliunits)`,
		inputSchema: CreateTransactionSchema,
		handler: adaptWrite(handleCreateTransaction),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof CreateTransactionSchema>>(),
		metadata: {
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
  - transactions (array, required): Up to 100 transaction objects (each requires account_id, amount, date).
  - dry_run (boolean, optional): Validate without saving. Default: false.

Returns: summary (created, duplicates, failed), results[], transactions[].

Examples:
  - Dry run first: set dry_run=true to validate before committing
  - Avoid duplicate import: set import_id on each transaction`,
		inputSchema: CreateTransactionsSchema,
		handler: adaptWrite(handleCreateTransactions),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof CreateTransactionsSchema>>(),
		metadata: {
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
  - payee_name (string, optional): Store/payee name.
  - receipt_total (number, required): Total amount in dollars (positive).
  - receipt_tax (number, required): Tax amount in dollars (0 if none).
  - categories (array, required): Category groups with items. Each item needs name, amount.
  - date (string, optional): ISO date. Default: today.
  - dry_run (boolean, optional): Preview subtransactions without saving. Default: false.

Returns: transaction with subtransactions and receipt_summary.`,
		inputSchema: CreateReceiptSplitTransactionSchema,
		handler: adaptWrite(handleCreateReceiptSplitTransaction),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof CreateReceiptSplitTransactionSchema>>(),
		metadata: {
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
  - amount (int, optional): New amount in milliunits.
  - date (string, optional): New date YYYY-MM-DD.
  - payee_name / payee_id (string, optional): New payee.
  - category_id (string, optional): New category UUID.
  - memo (string, optional): New memo.
  - cleared (string, optional): "cleared", "uncleared", or "reconciled".
  - approved (boolean, optional): Approval status.
  - dry_run (boolean, optional): Preview without saving.

Returns: updated transaction with updated_balance.`,
		inputSchema: UpdateTransactionSchema,
		handler: adaptWrite(handleUpdateTransaction),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof UpdateTransactionSchema>>(),
		metadata: {
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
  - transactions (array, required): Up to 100 objects, each requires id plus fields to update.
  - dry_run (boolean, optional): Preview changes without saving. Default: false.

Returns: summary (updated, failed), results[], transactions[].

Examples:
  - Dry run: set dry_run=true to preview before/after for first 10 items`,
		inputSchema: UpdateTransactionsSchema,
		handler: adaptWrite(handleUpdateTransactions),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof UpdateTransactionsSchema>>(),
		metadata: {
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

Returns: deleted transaction id and updated account balance.

Errors:
  - "Transaction not found" → invalid transaction_id`,
		inputSchema: DeleteTransactionSchema,
		handler: adaptWrite(handleDeleteTransaction),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof DeleteTransactionSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_DELETE,
				title: "YNAB: Delete Transaction",
			},
		},
	});
}
