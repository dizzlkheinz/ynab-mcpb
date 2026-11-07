/**
 * @fileoverview Preview-time checks for transaction writes.
 *
 * A dry run (and therefore every preview-mode write) checks the request
 * against cached budget data before a confirmation token is issued:
 * - category_id and account_id must exist in the budget. YNAB reports an
 *   unknown but well-formed category as "must be formatted as a uuid".
 * - Amounts must fit the budget currency's precision. YNAB accepts -378
 *   milliunits (0.378 in a 2-decimal currency) without complaint, which hides
 *   unit slips.
 * - import_id values already used in the account are reported, since YNAB
 *   skips them as duplicates.
 * @module tools/transactionPreflight
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { CacheManager } from "../server/cacheManager.js";
import type { ErrorHandler } from "../server/errorHandler.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ToolHandler } from "../server/toolRegistry.js";
import type { ToolContext } from "../types/toolRegistration.js";
import { formatUTCISODate } from "../utils/dateUtils.js";
import { milliunitsToAmount } from "../utils/money.js";
import type { DeltaFetcher } from "./deltaFetcher.js";

/** References and amounts from one transaction in a write request. */
export interface PreflightTransaction {
	/** Location in the request, e.g. "transactions[2]". Empty for single writes. */
	path: string;
	account_id?: string | undefined;
	/** YYYY-MM-DD; bounds the import_id history read. */
	date?: string | undefined;
	amount?: number | undefined;
	category_id?: string | null | undefined;
	import_id?: string | undefined;
	subtransactions?:
		| readonly { amount: number; category_id?: string | null | undefined }[]
		| undefined;
}

interface PreflightWarning {
	code: string;
	count: number;
	message: string;
	sample_ids?: string[];
}

interface PreflightReport {
	errors: string[];
	warnings: PreflightWarning[];
}

interface PreflightDeps {
	deltaFetcher: DeltaFetcher;
	cacheManager: CacheManager;
}

function at(path: string, field: string): string {
	return path ? `${path}.${field}` : field;
}

interface Reference {
	path: string;
	id: string;
}

/**
 * Returns the referenced ids absent from the entity list. The cached list is
 * checked first; on any miss the list is read fresh once, which covers
 * entities created since it was cached at a cost of one request, however
 * many ids missed. A failed read throws, so the caller reports the check as
 * unavailable rather than passing it.
 */
async function findMissing(
	references: readonly Reference[],
	cacheKey: string,
	cacheManager: CacheManager,
	loadKnown: () => Promise<Set<string>>,
): Promise<Set<string>> {
	const ids = new Set(references.map((reference) => reference.id));
	let known = await loadKnown();
	if ([...ids].every((id) => known.has(id))) return new Set();
	cacheManager.delete(cacheKey);
	known = await loadKnown();
	return new Set([...ids].filter((id) => !known.has(id)));
}

async function checkCategories(
	deps: PreflightDeps,
	budgetId: string,
	transactions: readonly PreflightTransaction[],
	errors: string[],
): Promise<void> {
	const references: Reference[] = [];
	for (const transaction of transactions) {
		if (transaction.category_id) {
			references.push({
				path: at(transaction.path, "category_id"),
				id: transaction.category_id,
			});
		}
		transaction.subtransactions?.forEach((line, index) => {
			if (line.category_id) {
				references.push({
					path: at(transaction.path, `subtransactions[${index}].category_id`),
					id: line.category_id,
				});
			}
		});
	}
	if (references.length === 0) return;

	const missing = await findMissing(
		references,
		CacheManager.generateKey("categories", "list", budgetId),
		deps.cacheManager,
		async () => {
			const known = new Set<string>();
			const groups = (await deps.deltaFetcher.fetchCategories(budgetId)).data;
			for (const group of groups) {
				if (group.deleted) continue;
				for (const category of group.categories ?? []) {
					if (!category.deleted) known.add(category.id);
				}
			}
			return known;
		},
	);
	for (const reference of references) {
		if (missing.has(reference.id)) {
			errors.push(
				`${reference.path}: category_id "${reference.id}" was not found in this budget (or is deleted). Use ynab_list_categories to find a valid category ID.`,
			);
		}
	}
}

async function checkAccounts(
	deps: PreflightDeps,
	budgetId: string,
	transactions: readonly PreflightTransaction[],
	errors: string[],
): Promise<void> {
	const references: Reference[] = transactions.flatMap((transaction) =>
		transaction.account_id
			? [
					{
						path: at(transaction.path, "account_id"),
						id: transaction.account_id,
					},
				]
			: [],
	);
	if (references.length === 0) return;

	const missing = await findMissing(
		references,
		CacheManager.generateKey("accounts", "list", budgetId),
		deps.cacheManager,
		async () =>
			new Set(
				(await deps.deltaFetcher.fetchAccounts(budgetId)).data
					.filter((account) => !account.deleted)
					.map((account) => account.id),
			),
	);
	for (const reference of references) {
		if (missing.has(reference.id)) {
			errors.push(
				`${reference.path}: account_id "${reference.id}" was not found in this budget (or is deleted). Use ynab_list_accounts to find a valid account ID.`,
			);
		}
	}
}

/**
 * Decimal places of the budget's currency (0-3), or undefined when the
 * cached budget list cannot be read or does not report it.
 */
export async function readCurrencyDecimalDigits(
	deps: Pick<PreflightDeps, "deltaFetcher">,
	budgetId: string,
): Promise<number | undefined> {
	try {
		const budgets = (await deps.deltaFetcher.fetchBudgets()).data;
		const format = budgets.find((budget) => budget.id === budgetId)
			?.currency_format as { decimal_digits?: unknown } | null | undefined;
		const digits = format?.decimal_digits;
		return typeof digits === "number" &&
			Number.isInteger(digits) &&
			digits >= 0 &&
			digits <= 3
			? digits
			: undefined;
	} catch {
		return undefined;
	}
}

function formatAmount(milliunits: number, decimalDigits: number): string {
	return milliunitsToAmount(milliunits).toFixed(decimalDigits);
}

/** Message for an amount finer than the currency's smallest unit. */
function precisionMessage(
	path: string,
	milliunits: number,
	decimalDigits: number,
): string {
	const asEntered = milliunitsToAmount(milliunits);
	const minorUnits = milliunits / 10 ** decimalDigits;
	const alternatives = [
		decimalDigits > 0
			? `if ${milliunits} was in minor units (e.g. cents), use amount_decimal: ${formatAmount(minorUnits * 1000, decimalDigits)}`
			: undefined,
		`if ${milliunits} was in whole currency units, use amount_decimal: ${milliunits}`,
	].filter((text): text is string => text !== undefined);
	return `${path}: ${milliunits} milliunits is ${asEntered}, which has more than the ${decimalDigits} decimal place(s) this budget's currency uses. Did you mean a different unit? ${alternatives.join("; ")}.`;
}

async function checkAmountPrecision(
	deps: PreflightDeps,
	budgetId: string,
	transactions: readonly PreflightTransaction[],
	report: PreflightReport,
): Promise<void> {
	const amounts: { path: string; milliunits: number }[] = [];
	for (const transaction of transactions) {
		if (transaction.amount !== undefined) {
			amounts.push({
				path: at(transaction.path, "amount"),
				milliunits: transaction.amount,
			});
		}
		transaction.subtransactions?.forEach((line, index) => {
			amounts.push({
				path: at(transaction.path, `subtransactions[${index}].amount`),
				milliunits: line.amount,
			});
		});
	}
	// Whole currency units fit every currency, so the budget read is skipped.
	if (amounts.every(({ milliunits }) => milliunits % 1000 === 0)) return;

	const knownDigits = await readCurrencyDecimalDigits(deps, budgetId);
	const decimalDigits = knownDigits ?? 2;
	const step = 10 ** (3 - decimalDigits);
	const offending = amounts.filter(({ milliunits }) => milliunits % step !== 0);
	if (offending.length === 0) return;

	const messages = offending.map(({ path, milliunits }) =>
		precisionMessage(path, milliunits, decimalDigits),
	);
	if (knownDigits !== undefined) {
		report.errors.push(...messages);
		return;
	}
	// Without the budget's currency, a 3-decimal currency cannot be ruled out.
	report.warnings.push({
		code: "amount_precision",
		count: offending.length,
		message: `Assuming 2 decimal places (budget currency unavailable): ${messages.join(" ")}`,
	});
}

/** Days of history before the earliest request date read for import_id collisions. */
const IMPORT_ID_WINDOW_DAYS = 90;

/**
 * Start of the history read for import_id collisions: IMPORT_ID_WINDOW_DAYS
 * before the earliest dated transaction, or undefined (full history) when no
 * transaction carries a date. Bounding the read keeps a preview from pulling
 * an account's whole history each time a write clears the cache; an older
 * collision is still caught by YNAB, which skips the duplicate.
 */
function importIdWindowStart(
	transactions: readonly PreflightTransaction[],
): string | undefined {
	const dates = transactions
		.map((transaction) => transaction.date)
		.filter((date): date is string => typeof date === "string")
		.sort();
	const earliest = dates[0];
	if (earliest === undefined) return undefined;
	const [year, month, day] = earliest.split("-").map(Number);
	if (year === undefined || month === undefined || day === undefined) {
		return undefined;
	}
	return formatUTCISODate(
		new Date(Date.UTC(year, month - 1, day - IMPORT_ID_WINDOW_DAYS)),
	);
}

async function checkImportIds(
	deps: PreflightDeps,
	budgetId: string,
	transactions: readonly PreflightTransaction[],
	report: PreflightReport,
): Promise<void> {
	const byAccount = new Map<string, Set<string>>();
	for (const transaction of transactions) {
		if (!transaction.import_id || !transaction.account_id) continue;
		const ids = byAccount.get(transaction.account_id) ?? new Set<string>();
		ids.add(transaction.import_id);
		byAccount.set(transaction.account_id, ids);
	}
	if (byAccount.size === 0) return;
	const sinceDate = importIdWindowStart(transactions);
	const collisions: string[] = [];
	for (const [accountId, importIds] of byAccount) {
		// A failed read propagates, so the check is reported as unavailable.
		const existing: ynab.TransactionDetail[] = (
			await deps.deltaFetcher.fetchTransactionsByAccount(
				budgetId,
				accountId,
				sinceDate,
			)
		).data;
		for (const transaction of existing) {
			if (
				!transaction.deleted &&
				transaction.import_id &&
				importIds.has(transaction.import_id)
			) {
				collisions.push(transaction.import_id);
			}
		}
	}
	if (collisions.length === 0) return;
	report.warnings.push({
		code: "import_id_exists",
		count: collisions.length,
		message: `${collisions.length} import_id value(s) already exist in the target account. YNAB will treat those transactions as duplicates and not create them.`,
		sample_ids: collisions.slice(0, 10),
	});
}

/**
 * Runs the checks for the given transactions. A "preview" runs every check;
 * a direct "write" runs only the checks that can reject the request, since
 * YNAB itself skips a duplicate import_id.
 */
export async function runTransactionPreflight(
	deps: PreflightDeps,
	budgetId: string,
	transactions: readonly PreflightTransaction[],
	mode: "preview" | "write" = "preview",
): Promise<PreflightReport> {
	const report: PreflightReport = { errors: [], warnings: [] };
	const checks: Record<string, () => Promise<void>> = {
		account_id: () =>
			checkAccounts(deps, budgetId, transactions, report.errors),
		category_id: () =>
			checkCategories(deps, budgetId, transactions, report.errors),
		amount: () => checkAmountPrecision(deps, budgetId, transactions, report),
	};
	if (mode === "preview") {
		checks["import_id"] = () =>
			checkImportIds(deps, budgetId, transactions, report);
	}
	const skipped: string[] = [];
	for (const [field, check] of Object.entries(checks)) {
		try {
			await check();
		} catch {
			// Fail open: YNAB still validates the write itself, and a failed
			// read must not block a valid preview.
			skipped.push(field);
		}
	}
	if (skipped.length > 0) {
		report.warnings.push({
			code: "preflight_unavailable",
			count: skipped.length,
			message: `Could not read budget data to check ${skipped.join(", ")}; those fields were not validated before this preview.`,
		});
	}
	return report;
}

function withWarnings(
	result: CallToolResult,
	warnings: readonly PreflightWarning[],
): CallToolResult {
	if (warnings.length === 0 || result.isError || !result.structuredContent) {
		return result;
	}
	const existing = result.structuredContent["warnings"];
	const structuredContent = {
		...result.structuredContent,
		warnings: [...(Array.isArray(existing) ? existing : []), ...warnings],
	};
	return {
		...result,
		structuredContent,
		content: [
			{ type: "text", text: responseFormatter.format(structuredContent) },
		],
	};
}

function rejection(
	errorHandler: ErrorHandler,
	errors: readonly string[],
	isPreview: boolean,
): CallToolResult {
	return errorHandler.createValidationError(
		isPreview
			? "Preview rejected: the request does not match this budget"
			: "Write rejected before reaching YNAB: the request does not match this budget",
		errors.join("\n"),
		[
			isPreview
				? "Fix the listed fields and preview again"
				: "Fix the listed fields and retry",
			"Prefer amount_decimal for currency amounts",
		],
	);
}

/**
 * Wraps a transaction write handler so requests are checked before they
 * reach YNAB:
 * - A dry run (including every preview-mode preview) runs every check.
 *   Errors reject it, so no confirmation token is issued; warnings are added
 *   to the dry-run output.
 * - A direct write (enabled mode) runs the rejecting checks only, and is
 *   refused on errors.
 * - A write confirmed with a preview token is not checked again: its preview
 *   already was.
 */
export function withTransactionPreflight<
	TInput extends Record<string, unknown>,
>(
	context: ToolContext,
	collect: (input: TInput) => PreflightTransaction[],
	handler: ToolHandler<TInput>,
): ToolHandler<TInput> {
	return async (payload) => {
		const budgetId = payload.input["budget_id"];
		if (payload.context.confirmed === true || typeof budgetId !== "string") {
			return handler(payload);
		}
		const isPreview = payload.input["dry_run"] === true;
		const report = await runTransactionPreflight(
			context,
			budgetId,
			collect(payload.input),
			isPreview ? "preview" : "write",
		);
		if (report.errors.length > 0) {
			return rejection(context.errorHandler, report.errors, isPreview);
		}
		const result = await handler(payload);
		return isPreview ? withWarnings(result, report.warnings) : result;
	};
}
