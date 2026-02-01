/**
 * Canonical bank transaction type used throughout reconciliation.
 *
 * AMOUNTS ARE IN MILLIUNITS (integers, 1000 = $1.00).
 * This matches YNAB's native format and allows exact integer comparison.
 */
export interface BankTransaction {
	/** UUID generated for tracking */
	id: string;
	/** ISO date string YYYY-MM-DD */
	date: string;
	/** Amount in MILLIUNITS (negative = outflow, positive = inflow) */
	amount: number;
	/** Merchant/payee name from CSV */
	payee: string;
	/** Optional memo/description */
	memo?: string;
	/** Original CSV row number (1-indexed, after header) */
	sourceRow: number;
	/** Raw values from CSV for debugging */
	raw: {
		date: string;
		amount: string;
		description: string;
	};
	/** Parser warnings (e.g., ambiguous debit/credit) */
	warnings?: string[];
}

/**
 * YNAB transaction normalized for comparison.
 *
 * This interface is intentionally SDK-agnostic. Use the adapter
 * function in ynabAdapter.ts to convert from ynab.TransactionDetail.
 *
 * AMOUNTS ARE IN MILLIUNITS - same as YNAB API native format.
 * No conversion needed from the SDK.
 */
export interface NormalizedYNABTransaction {
	id: string;
	date: string; // YYYY-MM-DD
	/** Amount in MILLIUNITS (same as YNAB API) */
	amount: number;
	payee: string | null;
	memo: string | null;
	categoryName: string | null;
	cleared: "cleared" | "uncleared" | "reconciled";
	approved: boolean;
}
