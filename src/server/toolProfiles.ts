export const TOOL_PROFILES = ["core", "full"] as const;
export type ToolProfile = (typeof TOOL_PROFILES)[number];
export const DEFAULT_TOOL_PROFILE: ToolProfile = "full";

/**
 * Deliberately small, task-oriented surface. Full functionality remains
 * available through the full profile, while core keeps common reads and the
 * project's differentiated safe workflows discoverable.
 */
export const CORE_TOOL_NAMES = new Set([
	"ynab_list_budgets",
	"ynab_get_budget",
	"ynab_list_accounts",
	"ynab_get_account",
	"ynab_list_transactions",
	"ynab_get_transaction",
	"ynab_list_categories",
	"ynab_get_category",
	"ynab_list_payees",
	"ynab_get_month",
	"ynab_get_user",
	"ynab_get_default_budget",
	"ynab_set_default_budget",
	"ynab_create_transaction",
	"ynab_update_transaction",
	"ynab_delete_transaction",
	"ynab_create_receipt_split_transaction",
	"ynab_reconcile_account",
	"ynab_compare_transactions",
	"ynab_analyze_spending",
	"ynab_compare_spending_periods",
	"ynab_list_scheduled_transactions",
]);

export function toolBelongsToProfile(
	profile: ToolProfile,
	name: string,
): boolean {
	return profile === "full" || CORE_TOOL_NAMES.has(name);
}
