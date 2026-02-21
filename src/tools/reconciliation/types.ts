/**
 * Type definitions for the reconciliation tool
 * Based on the 2025-10-31 reconciliation redesign specification
 *
 * IMPORTANT UNIT CONVENTION:
 * BankTransaction.amount is in MILLIUNITS (integers) in V2 architecture (formerly dollars).
 * YNABTransaction.amount is in MILLIUNITS (integers).
 * All internal calculations use milliunits to avoid floating-point errors.
 */

import type {
	BankTransaction as CanonicalBankTransaction,
	NormalizedYNABTransaction as CanonicalYNABTransaction,
} from "../../types/reconciliation.js";
import type { MoneyValue } from "../../utils/money.js";

// Re-export canonical types as the standard types
export type BankTransaction = CanonicalBankTransaction;
export type YNABTransaction = CanonicalYNABTransaction;

/**
 * Matching confidence levels
 */
export type MatchConfidence = "high" | "medium" | "low" | "none";

/**
 * Match candidate with confidence score
 */
export interface MatchCandidate {
	ynab_transaction: YNABTransaction;
	confidence: number;
	match_reason: string;
	explanation: string;
}

/**
 * Transaction match result
 */
export interface TransactionMatch {
	bankTransaction: BankTransaction;
	/** Best matched YNAB transaction (if any) */
	ynabTransaction?: YNABTransaction;
	/** Alternative candidates for suggested matches */
	candidates?: MatchCandidate[];
	/** Confidence level */
	confidence: MatchConfidence;
	/** Confidence score 0-100 */
	confidenceScore: number;
	/** Reason for the match */
	matchReason: string;
	/** Top confidence from candidates */
	topConfidence?: number;
	/** Action hint for user */
	actionHint?: string;
	/** Recommendation text */
	recommendation?: string;
}

/**
 * Balance information with structured monetary values
 */
export interface BalanceInfo {
	current_cleared: MoneyValue;
	current_uncleared: MoneyValue;
	current_total: MoneyValue;
	target_statement: MoneyValue;
	discrepancy: MoneyValue;
	on_track: boolean;
}

/**
 * Reconciliation summary statistics with structured monetary values
 */
export interface ReconciliationSummary {
	statement_date_range: string;
	bank_transactions_count: number;
	ynab_transactions_count: number;
	/** YNAB transactions within the statement date range (used for matching) */
	ynab_in_range_count: number;
	/** YNAB transactions outside the statement date range (not compared) */
	ynab_outside_range_count: number;
	auto_matched: number;
	suggested_matches: number;
	unmatched_bank: number;
	unmatched_ynab: number;
	current_cleared_balance: MoneyValue;
	target_statement_balance: MoneyValue;
	discrepancy: MoneyValue;
	discrepancy_explanation: string;
}

/**
 * Insight severity levels
 */
export type InsightSeverity = "info" | "warning" | "critical";

/**
 * Insight types for reconciliation analysis
 */
export type InsightKind = "repeat_amount" | "near_match" | "anomaly";

/**
 * Reconciliation insight - highlights important findings that help explain discrepancies
 */
export interface ReconciliationInsight {
	id: string;
	type: InsightKind;
	severity: InsightSeverity;
	title: string;
	description: string;
	evidence?: Record<string, unknown>;
}

/**
 * Analysis phase result
 */
export interface ReconciliationAnalysis {
	success: true;
	phase: "analysis";
	summary: ReconciliationSummary;
	auto_matches: TransactionMatch[];
	suggested_matches: TransactionMatch[];
	unmatched_bank: BankTransaction[];
	unmatched_ynab: YNABTransaction[];
	/** YNAB transactions outside the statement date range (not compared, expected) */
	ynab_outside_date_range: YNABTransaction[];
	balance_info: BalanceInfo;
	next_steps: string[];
	insights: ReconciliationInsight[];
	recommendations?: ActionableRecommendation[];
}

/**
 * Reconciliation action types
 */
export type ReconciliationActionType =
	| "match"
	| "add"
	| "unclear"
	| "delete"
	| "ignore";

/**
 * Reconciliation action
 */
export interface ReconciliationAction {
	type: ReconciliationActionType;
	bank_txn_id?: string;
	ynab_txn_id?: string;
	mark_cleared?: boolean;
	create_as_cleared?: boolean;
	reason?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Matching algorithm configuration (V2)
 */
export interface MatchingConfig {
	weights: {
		date: number; // Recommended: 0.15
		payee: number; // Recommended: 0.35
	};

	dateToleranceDays: number; // Default: 7

	// Thresholds
	autoMatchThreshold: number; // Default: 85
	suggestedMatchThreshold: number; // Default: 60
	minimumCandidateScore: number; // Default: 40

	// Bonuses for perfect matches
	exactDateBonus: number; // Default: 5
	exactPayeeBonus: number; // Default: 10
}

/**
 * Parsed CSV data from compareTransactions
 */
export interface ParsedCSVData {
	transactions: BankTransaction[];
	format_detected: string;
	delimiter: string;
	total_rows: number;
	valid_rows: number;
	errors: string[];
}

/**
 * Priority levels for actionable recommendations
 */
export type RecommendationPriority = "high" | "medium" | "low";

/**
 * Base fields common to all recommendation types
 */
export interface BaseRecommendation {
	/** Unique identifier for this recommendation */
	id: string;
	/** Priority level for execution */
	priority: RecommendationPriority;
	/** Confidence score 0-1 (higher = more confident) */
	confidence: number;
	/** Human-readable message describing the recommendation */
	message: string;
	/** Explanation of why this recommendation was generated */
	reason: string;
	/** Estimated impact on reconciliation balance */
	estimated_impact: MoneyValue;
	/** YNAB account ID this recommendation applies to */
	account_id: string;
	/** Optional link to the insight that generated this recommendation */
	source_insight_id?: string;
	/** Additional metadata (version, timestamps, etc.) */
	metadata?: Record<string, unknown>;
}

/**
 * Recommendation to create a new YNAB transaction
 */
export interface CreateTransactionRecommendation extends BaseRecommendation {
	action_type: "create_transaction";
	parameters: {
		account_id: string;
		date: string;
		amount: number;
		payee_name: string;
		memo?: string;
		cleared: "cleared" | "uncleared";
		approved: boolean;
		category_id?: string;
	};
}

/**
 * Recommendation to update a transaction's cleared status
 */
export interface UpdateClearedRecommendation extends BaseRecommendation {
	action_type: "update_cleared";
	parameters: {
		transaction_id: string;
		cleared: "cleared" | "uncleared" | "reconciled";
	};
}

/**
 * Recommendation to review potential duplicate transactions
 */
export interface ReviewDuplicateRecommendation extends BaseRecommendation {
	action_type: "review_duplicate";
	parameters: {
		candidate_ids: string[];
		bank_transaction?: BankTransaction;
		suggested_match_id?: string;
	};
}

/**
 * Related transaction reference for manual review
 */
export interface RelatedTransaction {
	source: "bank" | "ynab";
	id: string;
	description: string;
}

/**
 * Recommendation requiring manual investigation
 */
export interface ManualReviewRecommendation extends BaseRecommendation {
	action_type: "manual_review";
	parameters: {
		issue_type: "complex_match" | "large_discrepancy" | "unknown";
		related_transactions?: RelatedTransaction[];
	};
}

/**
 * Union type of all possible recommendation types (discriminated by action_type)
 */
export type ActionableRecommendation =
	| CreateTransactionRecommendation
	| UpdateClearedRecommendation
	| ReviewDuplicateRecommendation
	| ManualReviewRecommendation;

/**
 * Context passed to recommendation engine for generating recommendations
 */
export interface RecommendationContext {
	/** Account ID for the recommendations */
	account_id: string;
	/** Budget ID (reserved for future category suggestions) */
	budget_id: string;
	/** The reconciliation analysis results */
	analysis: ReconciliationAnalysis;
	/** Matching configuration used during analysis */
	matching_config: MatchingConfig;
}
