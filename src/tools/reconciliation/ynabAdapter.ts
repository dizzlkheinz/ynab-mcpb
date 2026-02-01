import type * as ynab from "ynab";
import type { NormalizedYNABTransaction } from "../../types/reconciliation.js";

/**
 * Convert YNAB SDK transaction to normalized format for matching.
 *
 * This adapter keeps the YNAB SDK dependency isolated from the
 * reconciliation core logic.
 *
 * NOTE: Amount stays in milliunits - no conversion needed since
 * YNAB API already uses milliunits natively.
 */
export function normalizeYNABTransaction(
	txn: ynab.TransactionDetail,
): NormalizedYNABTransaction {
	return {
		id: txn.id,
		date: txn.date,
		amount: txn.amount, // Already in milliunits - no conversion!
		payee: txn.payee_name ?? null,
		memo: txn.memo ?? null,
		categoryName: txn.category_name ?? null,
		cleared: txn.cleared,
		approved: txn.approved,
	};
}

/**
 * Batch convert YNAB transactions.
 */
export function normalizeYNABTransactions(
	txns: ynab.TransactionDetail[],
): NormalizedYNABTransaction[] {
	return txns.map(normalizeYNABTransaction);
}
