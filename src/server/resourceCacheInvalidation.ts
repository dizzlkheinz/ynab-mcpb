import { CacheManager, cacheManager } from "./cacheManager.js";

export interface BudgetResourceCacheInvalidationOptions {
	accountIds?: Iterable<string>;
	invalidateAccountsList?: boolean;
	invalidateCategoriesList?: boolean;
	invalidateMonthsList?: boolean;
	monthKeys?: Iterable<string>;
}

/**
 * Keeps MCP resource caches aligned with write operations that affect budget data.
 */
export function invalidateBudgetResourceCaches(
	budgetId: string,
	options: BudgetResourceCacheInvalidationOptions = {},
): void {
	const keys = new Set<string>([
		CacheManager.generateKey("resources", "budgets", "list"),
		CacheManager.generateKey("resources", "budgets", "get", budgetId),
	]);

	if (options.invalidateAccountsList) {
		keys.add(
			CacheManager.generateKey("resources", "accounts", "list", budgetId),
		);
	}
	for (const accountId of options.accountIds ?? []) {
		keys.add(
			CacheManager.generateKey(
				"resources",
				"accounts",
				"get",
				budgetId,
				accountId,
			),
		);
	}

	if (options.invalidateCategoriesList) {
		keys.add(
			CacheManager.generateKey("resources", "categories", "list", budgetId),
		);
	}

	if (options.invalidateMonthsList) {
		keys.add(CacheManager.generateKey("resources", "months", "list", budgetId));
	}
	for (const monthKey of options.monthKeys ?? []) {
		keys.add(
			CacheManager.generateKey(
				"resources",
				"months",
				"get",
				budgetId,
				monthKey,
			),
		);
	}

	for (const key of keys) {
		cacheManager.delete(key);
	}
}
