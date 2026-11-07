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
import type { ErrorHandler } from "../server/errorHandler.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ToolHandler } from "../server/toolRegistry.js";
import type { ToolContext } from "../types/toolRegistration.js";
import { milliunitsToAmount } from "../utils/money.js";
import type { DeltaFetcher } from "./deltaFetcher.js";

/** References and amounts from one transaction in a write request. */
export interface PreflightTransaction {
	/** Location in the request, e.g. "transactions[2]". Empty for single writes. */
	path: string;
	account_id?: string | undefined;
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
	ynabAPI: ynab.API;
	deltaFetcher: DeltaFetcher;
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function at(path: string, field: string): string {
	return path ? `${path}.${field}` : field;
}

/** HTTP status of a YNAB SDK error, from its payload, response, or message. */
function errorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const record = error as Record<string, unknown>;
	const nested = record["error"] as Record<string, unknown> | undefined;
	const candidates = [
		nested?.["id"],
		record["status"],
		(record["response"] as { status?: unknown } | undefined)?.status,
	];
	for (const candidate of candidates) {
		const status = Number(candidate);
		if (Number.isInteger(status) && status >= 100 && status < 600) {
			return status;
		}
	}
	if (nested?.["name"] === "not_found") return 404;
	const match =
		error instanceof Error ? /\b([45]\d\d)\b/.exec(error.message) : null;
	return match ? Number(match[1]) : undefined;
}

/**
 * Whether YNAB rejected the ID itself. YNAB answers an unknown but
 * well-formed category ID with 400 "must be formatted as a uuid", so 400 and
 * 422 count as well as 404. Auth, rate-limit, server, and network failures
 * do not, so they never block a valid write.
 */
function isRejectedId(error: unknown): boolean {
	const status = errorStatus(error);
	return status === 400 || status === 404 || status === 422;
}

/**
 * Returns the ids that are neither in the cached list nor found by a direct
 * lookup. The direct lookup covers entities created since the cache was
 * filled; only a lookup that YNAB rejects for the ID itself counts as
 * missing (see isRejectedId).
 */
async function findMissing(
	ids: Set<string>,
	known: Set<string>,
	lookup: (id: string) => Promise<{ deleted?: boolean }>,
): Promise<Set<string>> {
	const missing = new Set<string>();
	for (const id of ids) {
		if (known.has(id)) continue;
		if (!UUID_PATTERN.test(id)) {
			missing.add(id);
			continue;
		}
		try {
			const entity = await lookup(id);
			if (entity.deleted) missing.add(id);
		} catch (error) {
			if (isRejectedId(error)) missing.add(id);
		}
	}
	return missing;
}

async function checkCategories(
	deps: PreflightDeps,
	budgetId: string,
	transactions: readonly PreflightTransaction[],
	errors: string[],
): Promise<void> {
	const references: { path: string; id: string }[] = [];
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

	const groups = (await deps.deltaFetcher.fetchCategories(budgetId)).data;
	const known = new Set<string>();
	for (const group of groups) {
		if (group.deleted) continue;
		for (const category of group.categories ?? []) {
			if (!category.deleted) known.add(category.id);
		}
	}
	const missing = await findMissing(
		new Set(references.map((reference) => reference.id)),
		known,
		async (id) =>
			(await deps.ynabAPI.categories.getCategoryById(budgetId, id)).data
				.category,
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
	const references = transactions.flatMap((transaction) =>
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

	const accounts = (await deps.deltaFetcher.fetchAccounts(budgetId)).data;
	const known = new Set(
		accounts.filter((account) => !account.deleted).map((account) => account.id),
	);
	const missing = await findMissing(
		new Set(references.map((reference) => reference.id)),
		known,
		async (id) =>
			(await deps.ynabAPI.accounts.getAccountById(budgetId, id)).data.account,
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
 * Decimal places of the budget's currency, or undefined when the budget
 * list does not report it.
 */
async function currencyDecimalDigits(
	deps: PreflightDeps,
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
	if (amounts.length === 0) return;

	const knownDigits = await currencyDecimalDigits(deps, budgetId);
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
	const collisions: string[] = [];
	for (const [accountId, importIds] of byAccount) {
		let existing: ynab.TransactionDetail[];
		try {
			existing = (
				await deps.deltaFetcher.fetchTransactionsByAccount(budgetId, accountId)
			).data;
		} catch {
			continue; // An unknown account is already reported by checkAccounts.
		}
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

/** Runs every preview check for the given transactions. */
export async function runTransactionPreflight(
	deps: PreflightDeps,
	budgetId: string,
	transactions: readonly PreflightTransaction[],
): Promise<PreflightReport> {
	const report: PreflightReport = { errors: [], warnings: [] };
	const checks = {
		account_id: () =>
			checkAccounts(deps, budgetId, transactions, report.errors),
		category_id: () =>
			checkCategories(deps, budgetId, transactions, report.errors),
		amount: () => checkAmountPrecision(deps, budgetId, transactions, report),
		import_id: () => checkImportIds(deps, budgetId, transactions, report),
	};
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
): CallToolResult {
	return errorHandler.createValidationError(
		"Preview rejected: the request does not match this budget",
		errors.join("\n"),
		[
			"Fix the listed fields and preview again",
			"Prefer amount_decimal for currency amounts",
		],
	);
}

/**
 * Wraps a transaction write handler so its dry runs (including every
 * preview-mode preview) run the preflight checks first. Errors reject the
 * preview, so no confirmation token is issued; warnings are added to the
 * dry-run output. Real writes pass straight through.
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
		if (payload.input["dry_run"] !== true || typeof budgetId !== "string") {
			return handler(payload);
		}
		const report = await runTransactionPreflight(
			context,
			budgetId,
			collect(payload.input),
		);
		if (report.errors.length > 0) {
			return rejection(context.errorHandler, report.errors);
		}
		return withWarnings(await handler(payload), report.warnings);
	};
}
