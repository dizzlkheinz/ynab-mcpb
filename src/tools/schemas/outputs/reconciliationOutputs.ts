import { z } from "zod";

// ============================================================================
// NESTED SCHEMAS FOR COMPOSITION
// ============================================================================

/**
 * Structured monetary value with formatting.
 * Matches the MoneyValue interface from src/utils/money.ts.
 *
 * @see src/utils/money.ts - MoneyValue type definition
 */
export const MoneyValueSchema = z.object({
	value_milliunits: z.number().int(),
	value: z.number().finite(),
	value_display: z.string(),
	currency: z.string(),
	direction: z.enum(["credit", "debit", "balanced"]),
});

/**
 * ISO 8601 date string with calendar validation.
 * Ensures dates are in YYYY-MM-DD format and represent valid calendar dates.
 *
 * @remarks
 * This schema validates both format (regex) and calendar validity (refinement).
 * It catches invalid dates like "2025-02-31" which Date.parse might coerce to "2025-03-03".
 *
 * @example
 * ```typescript
 * IsoDateWithCalendarValidationSchema.parse("2025-01-15"); // ✓ Valid
 * IsoDateWithCalendarValidationSchema.parse("2025-02-31"); // ✗ Invalid (no Feb 31st)
 * IsoDateWithCalendarValidationSchema.parse("2025-13-01"); // ✗ Invalid (month > 12)
 * IsoDateWithCalendarValidationSchema.parse("2025-1-15");  // ✗ Invalid (must be zero-padded)
 * ```
 */
export const IsoDateWithCalendarValidationSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in ISO format (YYYY-MM-DD)")
	.refine(
		(dateStr) => {
			const parsed = Date.parse(dateStr);
			if (Number.isNaN(parsed)) {
				return false;
			}
			// Verify that the parsed date components match the original string
			// This catches cases like "2025-02-31" which Date.parse might coerce to "2025-03-03"
			const date = new Date(parsed);
			const year = date.getUTCFullYear();
			const month = String(date.getUTCMonth() + 1).padStart(2, "0");
			const day = String(date.getUTCDate()).padStart(2, "0");
			const reconstructed = `${year}-${month}-${day}`;
			return reconstructed === dateStr;
		},
		{
			message:
				"Invalid calendar date (e.g., month must be 01-12, day must be valid for the month)",
		},
	);

/**
 * Bank transaction from CSV import (output format with money formatting).
 * Represents a single transaction from the user's bank statement.
 *
 * @remarks
 * The adapter adds `amount_money` field with formatted money value.
 * Date field is always serialized as an ISO 8601 date string (YYYY-MM-DD) in tool output,
 *
 * @see src/tools/reconciliation/types.ts - BankTransaction interface (internal type)
 */
export const BankTransactionSchema = z.object({
	id: z.string().uuid(),
	date: IsoDateWithCalendarValidationSchema,
	amount: z.number(),
	payee: z.string(),
	memo: z.string().optional(),
	sourceRow: z.number().int(),
	raw: z
		.object({
			date: z.string(),
			amount: z.string(),
			description: z.string(),
		})
		.strict(),
	warnings: z.array(z.string()).optional(),
	amount_money: MoneyValueSchema, // Added by adapter
});

/**
 * Simplified YNAB transaction for reconciliation matching (output format with money formatting).
 * Contains essential fields for transaction comparison.
 *
 * @remarks
 * The adapter adds `amount_money` field with formatted money value.
 * Date field is always serialized as an ISO 8601 date string (YYYY-MM-DD) in tool output,
 *
 * @see src/tools/reconciliation/types.ts - YNABTransaction interface (internal type)
 */
export const YNABTransactionSimpleSchema = z.object({
	id: z.string(),
	date: IsoDateWithCalendarValidationSchema,
	amount: z.number(),
	payee: z.string().nullable(),
	categoryName: z.string().nullable(),
	cleared: z.enum(["cleared", "uncleared", "reconciled"]),
	approved: z.boolean(),
	memo: z.string().nullable().optional(),
	amount_money: MoneyValueSchema, // Added by adapter
});

/**
 * Potential match candidate with confidence scoring.
 * Represents a possible match between bank and YNAB transactions.
 *
 * @see src/tools/reconciliation/types.ts - MatchCandidate interface
 */
export const MatchCandidateSchema = z.object({
	ynab_transaction: YNABTransactionSimpleSchema,
	confidence: z.number().min(0).max(100),
	match_reason: z.string(),
	explanation: z.string(),
});

/**
 * Transaction match result with confidence and candidates.
 * Links a bank transaction to a YNAB transaction or suggests candidates.
 *
 * @see src/tools/reconciliation/types.ts - TransactionMatch interface
 *
 * @remarks
 * `confidence` is the semantic auto-match classification ("high" = auto-matched,
 * "medium"/"low" = suggested). It is NOT a strict function of `confidence_score`
 * because the two-pass exact-date logic can promote a lower-scored match to "high"
 * when it is the only candidate for that date.
 */
export const TransactionMatchSchema = z.object({
	bank_transaction: BankTransactionSchema,
	ynab_transaction: YNABTransactionSimpleSchema.optional(),
	candidates: z.array(MatchCandidateSchema).optional(),
	confidence: z.enum(["high", "medium", "low", "none"]),
	confidence_score: z.number().min(0).max(100),
	match_reason: z.string(),
	top_confidence: z.number().optional(),
	action_hint: z.string().optional(),
	recommendation: z.string().optional(),
});

export const ExecutionSummaryOutputSchema = z.object({
	transactions_created: z.number().int(),
	transactions_updated: z.number().int(),
	dates_adjusted: z.number().int(),
	dry_run: z.boolean(),
	balance_status: z.enum(["balanced", "unbalanced", "not_verified"]).optional(),
	recommendations: z.array(z.string()).optional(),
});

export const StructuredReconciliationUnmatchedOnlySchema = z
	.object({
		unmatched_bank: z.array(BankTransactionSchema),
		unmatched_ynab: z.array(YNABTransactionSimpleSchema),
		suggestions: z.array(TransactionMatchSchema),
		execution_summary: ExecutionSummaryOutputSchema.optional(),
		operations: z
			.array(
				z.object({
					operation: z.object({
						kind: z.enum(["create", "update", "unclear", "reconcile"]),
						payload: z.record(z.string(), z.unknown()),
						reason: z.string(),
						changesDate: z.boolean(),
						clearedDelta: z.number().int(),
					}),
					status: z.enum(["planned", "applied", "uncertain", "skipped"]),
					transaction_id: z.string().optional(),
					error: z.string().optional(),
				}),
			)
			.optional(),
		errors: z.array(z.string()).optional(),
	})
	.strict();

export const ReconcileAccountOutputSchema = z
	.object({
		human: z.string(),
		structured: StructuredReconciliationUnmatchedOnlySchema,
	})
	.strict();
