import { milliunitsToAmount } from "../../utils/money.js";
import type {
	ReceiptCategoryCalculation,
	SubtransactionInput,
} from "../transactionSchemas.js";

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
export function applySmartCollapseLogic(
	categoryCalculations: ReceiptCategoryCalculation[],
	taxMilliunits: number,
	/** Smallest currency unit in milliunits (10 for cents). Default: 1. */
	step = 1,
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
	const taxSubtransactions = allocateTax(
		categoryCalculations,
		taxMilliunits,
		step,
	);
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
 * Splits a positive total in proportion to positive weights, in whole
 * multiples of step, using the largest-remainder method: every share is
 * floored to a step, then the leftover steps go to the largest fractional
 * remainders. Shares are never negative and always sum to the total; if the
 * total is not itself a multiple of step, the residue joins the largest share.
 * @internal Exported for tests.
 */
export function allocateProportionally(
	total: number,
	weights: readonly number[],
	step = 1,
): number[] {
	const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
	if (total <= 0 || weightSum <= 0) return weights.map(() => 0);
	const units = Math.floor(total / step);
	const exact = weights.map((weight) => (units * weight) / weightSum);
	const shares = exact.map(Math.floor);
	let leftover = units - shares.reduce((sum, share) => sum + share, 0);
	const byRemainder = exact
		.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
		.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
	for (const { index } of byRemainder) {
		if (leftover <= 0) break;
		shares[index] = (shares[index] ?? 0) + 1;
		leftover--;
	}
	const amounts = shares.map((share) => share * step);
	const residue = total - units * step;
	if (residue !== 0) {
		const largest = amounts.indexOf(Math.max(...amounts));
		amounts[largest] = (amounts[largest] ?? 0) + residue;
	}
	return amounts;
}

/**
 * Positive tax allocated to each category, aligned with categoryCalculations,
 * in proportion to each category's positive items. Categories with no
 * positive items get 0; if no category has any, the first gets all the tax. Used for both the tax split lines and the receipt
 * summary, so the two always agree.
 */
export function allocateReceiptTax(
	categoryCalculations: readonly ReceiptCategoryCalculation[],
	taxMilliunits: number,
	step = 1,
): number[] {
	const positiveSubtotals = categoryCalculations.map((category) =>
		category.items
			.filter((item) => item.amount_milliunits > 0)
			.reduce((sum, item) => sum + item.amount_milliunits, 0),
	);
	if (
		taxMilliunits > 0 &&
		categoryCalculations.length > 0 &&
		positiveSubtotals.every((subtotal) => subtotal <= 0)
	) {
		// Nothing to weight by (only free or returned items): keep the split
		// balanced by putting all the tax on the first category.
		return positiveSubtotals.map((_, index) =>
			index === 0 ? taxMilliunits : 0,
		);
	}
	return allocateProportionally(taxMilliunits, positiveSubtotals, step);
}

/**
 * Allocates tax across categories
 * - Positive categories get proportional tax subtransactions
 * - Negative tax creates a single tax refund subtransaction
 */
function allocateTax(
	categoryCalculations: ReceiptCategoryCalculation[],
	taxMilliunits: number,
	step: number,
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
	const allocations = allocateReceiptTax(
		categoryCalculations,
		taxMilliunits,
		step,
	);
	allocations.forEach((taxAmount, index) => {
		const category = categoryCalculations[index];
		if (!category || taxAmount <= 0) return;
		subtransactions.push({
			amount: -taxAmount,
			category_id: category.category_id,
			memo: `Tax - ${category.category_name ?? "Uncategorized"}`,
		});
	});

	return subtransactions;
}
