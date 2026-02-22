/**
 * @fileoverview Markdown format functions for YNAB MCP tool responses.
 * Each function accepts the assembled data object from a tool handler and returns
 * a human-readable markdown string. Used when response_format="markdown".
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Format a dollar amount to two decimal places with $ prefix. */
function fmtAmt(val: unknown): string {
	if (typeof val !== "number") return String(val ?? "—");
	const formatted = Math.abs(val).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	return val < 0 ? `-$${formatted}` : `$${formatted}`;
}

/** Pagination footer line. */
function fmtPagination(data: {
	total_count?: number;
	returned_count?: number;
	offset?: number;
	has_more?: boolean;
	next_offset?: number | undefined;
}): string {
	const parts: string[] = [];
	if (data.total_count !== undefined) {
		parts.push(`Showing ${data.returned_count ?? 0} of ${data.total_count}`);
	}
	if (data.has_more && data.next_offset !== undefined) {
		parts.push(`next page: \`offset=${data.next_offset}\``);
	}
	return parts.length > 0 ? `\n> ${parts.join(" · ")}` : "";
}

/** Cache info footer line. */
function fmtCache(data: { cache_info?: string }): string {
	return data.cache_info ? `\n> _${data.cache_info}_` : "";
}

// ─── budget formatters ────────────────────────────────────────────────────────

export interface BudgetsListData {
	budgets: Array<{
		id: string;
		name: string;
		last_modified_on?: string | undefined;
		first_month?: string | undefined;
		last_month?: string | undefined;
		currency_format?: { iso_code?: string | undefined } | null | undefined;
	}>;
	cached?: boolean;
	cache_info?: string;
}

export function formatBudgetsList(data: BudgetsListData): string {
	const count = data.budgets.length;
	const lines: string[] = [
		`## YNAB Budgets (${count} total)`,
		"",
		"| Name | ID | Currency | Modified |",
		"|------|-----|---------|---------|",
	];
	for (const b of data.budgets) {
		const currency = b.currency_format?.iso_code ?? "";
		const modified = b.last_modified_on ? b.last_modified_on.slice(0, 10) : "—";
		lines.push(`| ${b.name} | \`${b.id}\` | ${currency} | ${modified} |`);
	}
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

export interface BudgetDetailData {
	budget: {
		id: string;
		name: string;
		first_month?: string | undefined;
		last_month?: string | undefined;
		last_modified_on?: string | undefined;
		currency_format?: { iso_code?: string | undefined } | undefined;
		accounts_count?: number;
		categories_count?: number;
		payees_count?: number;
		months_count?: number;
		message?: string;
	};
}

export function formatBudgetDetail(data: BudgetDetailData): string {
	const b = data.budget;
	const lines: string[] = [
		`## Budget: ${b.name}`,
		"",
		`- **ID:** \`${b.id}\``,
		`- **Currency:** ${b.currency_format?.iso_code ?? "—"}`,
		`- **Period:** ${b.first_month ?? "—"} → ${b.last_month ?? "—"}`,
		`- **Last modified:** ${b.last_modified_on?.slice(0, 10) ?? "—"}`,
	];
	if (b.accounts_count !== undefined)
		lines.push(`- **Accounts:** ${b.accounts_count}`);
	if (b.categories_count !== undefined)
		lines.push(`- **Categories:** ${b.categories_count}`);
	if (b.payees_count !== undefined)
		lines.push(`- **Payees:** ${b.payees_count}`);
	if (b.months_count !== undefined)
		lines.push(`- **Months:** ${b.months_count}`);
	if (b.message) {
		lines.push("", `_${b.message}_`);
	}
	return lines.join("\n");
}

// ─── account formatters ───────────────────────────────────────────────────────

export interface AccountRecord {
	id: string;
	name: string;
	type: string;
	on_budget?: boolean;
	closed?: boolean;
	balance?: number;
	cleared_balance?: number;
	uncleared_balance?: number;
	note?: string | null | undefined;
}

export interface AccountsListData {
	accounts: AccountRecord[];
	total_count?: number;
	returned_count?: number;
	offset?: number;
	has_more?: boolean;
	next_offset?: number | undefined;
	cached?: boolean;
	cache_info?: string;
}

export function formatAccountsList(data: AccountsListData): string {
	const lines: string[] = [
		`## Accounts`,
		"",
		"| Name | Type | Balance | Cleared | Uncleared | On Budget | Status |",
		"|------|------|---------|---------|-----------|-----------|--------|",
	];
	for (const a of data.accounts) {
		const status = a.closed ? "Closed" : "Active";
		const onBudget = a.on_budget ? "✓" : "—";
		lines.push(
			`| ${a.name} | ${a.type} | ${fmtAmt(a.balance)} | ${fmtAmt(a.cleared_balance)} | ${fmtAmt(a.uncleared_balance)} | ${onBudget} | ${status} |`,
		);
	}
	lines.push(fmtPagination(data));
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

export interface AccountDetailData {
	account: AccountRecord;
	cached?: boolean;
	cache_info?: string;
}

export function formatAccountDetail(data: AccountDetailData): string {
	const a = data.account;
	const lines: string[] = [
		`## Account: ${a.name}`,
		"",
		`- **ID:** \`${a.id}\``,
		`- **Type:** ${a.type}`,
		`- **Balance:** ${fmtAmt(a.balance)}`,
		`- **Cleared:** ${fmtAmt(a.cleared_balance)}`,
		`- **Uncleared:** ${fmtAmt(a.uncleared_balance)}`,
		`- **On Budget:** ${a.on_budget ? "Yes" : "No"}`,
		`- **Status:** ${a.closed ? "Closed" : "Active"}`,
	];
	if (a.note) lines.push(`- **Note:** ${a.note}`);
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

// ─── transaction formatters ───────────────────────────────────────────────────

export interface TransactionRecord {
	id: string;
	date?: string;
	amount?: number;
	memo?: string | null | undefined;
	cleared?: string;
	approved?: boolean;
	payee_name?: string | null | undefined;
	category_name?: string | null | undefined;
	account_id?: string;
	deleted?: boolean;
}

export interface TransactionsListData {
	transactions?: TransactionRecord[];
	preview_transactions?: TransactionRecord[];
	total_count?: number;
	returned_count?: number;
	offset?: number;
	has_more?: boolean;
	next_offset?: number | undefined;
	cached?: boolean;
	cache_info?: string;
	message?: string;
	suggestion?: string;
	showing?: string;
	estimated_size_kb?: number;
}

export function formatTransactionsList(data: TransactionsListData): string {
	// Size-limited preview mode
	if (data.preview_transactions) {
		const lines: string[] = [
			`## Transactions (Preview)`,
			"",
			`> ⚠️ ${data.message ?? "Too large to display all."}`,
			`> ${data.suggestion ?? "Use ynab_export_transactions to save all to file."}`,
			"",
			`### ${data.showing ?? `Most recent ${data.preview_transactions.length} transactions`}`,
			"",
			"| Date | Amount | Payee | Category | Memo |",
			"|------|--------|-------|----------|------|",
		];
		for (const t of data.preview_transactions) {
			const memo = t.memo ? t.memo.slice(0, 30) : "—";
			const payee = t.payee_name ?? "—";
			const cat = t.category_name ?? "—";
			lines.push(
				`| ${t.date ?? "—"} | ${fmtAmt(t.amount)} | ${payee} | ${cat} | ${memo} |`,
			);
		}
		return lines.join("\n");
	}

	// Normal paginated mode
	const txns = data.transactions ?? [];
	const lines: string[] = [
		`## Transactions`,
		"",
		"| Date | Amount | Payee | Category | Memo | Status |",
		"|------|--------|-------|----------|------|--------|",
	];
	for (const t of txns) {
		const memo = t.memo ? t.memo.slice(0, 30) : "—";
		const payee = t.payee_name ?? "—";
		const cat = t.category_name ?? "—";
		const status = t.cleared ?? "—";
		lines.push(
			`| ${t.date ?? "—"} | ${fmtAmt(t.amount)} | ${payee} | ${cat} | ${memo} | ${status} |`,
		);
	}
	lines.push(fmtPagination(data));
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

export interface TransactionDetailData {
	transaction: {
		id: string;
		date?: string;
		amount?: number;
		memo?: string | null | undefined;
		cleared?: string;
		approved?: boolean;
		payee_id?: string | null | undefined;
		payee_name?: string | null | undefined;
		category_id?: string | null | undefined;
		category_name?: string | null | undefined;
		account_id?: string;
		account_name?: string;
		deleted?: boolean;
		subtransactions?: Array<{
			id?: string;
			amount?: number;
			memo?: string | null | undefined;
			category_name?: string | null | undefined;
		}>;
	};
	cached?: boolean;
	cache_info?: string;
}

export function formatTransactionDetail(data: TransactionDetailData): string {
	const t = data.transaction;
	const lines: string[] = [
		`## Transaction: ${t.date ?? "—"} — ${fmtAmt(t.amount)}`,
		"",
		`- **ID:** \`${t.id}\``,
		`- **Date:** ${t.date ?? "—"}`,
		`- **Amount:** ${fmtAmt(t.amount)}`,
		`- **Payee:** ${t.payee_name ?? "—"}`,
		`- **Category:** ${t.category_name ?? "—"}`,
		`- **Account:** ${t.account_name ?? t.account_id ?? "—"}`,
		`- **Status:** ${t.cleared ?? "—"} / ${t.approved ? "approved" : "unapproved"}`,
	];
	if (t.memo) lines.push(`- **Memo:** ${t.memo}`);
	if (t.subtransactions && t.subtransactions.length > 0) {
		lines.push("", "### Split Items", "");
		lines.push("| Amount | Category | Memo |");
		lines.push("|--------|----------|------|");
		for (const s of t.subtransactions) {
			lines.push(
				`| ${fmtAmt(s.amount)} | ${s.category_name ?? "—"} | ${s.memo ?? "—"} |`,
			);
		}
	}
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

// ─── category formatters ──────────────────────────────────────────────────────

export interface CategoryRecord {
	id: string;
	name: string;
	category_group_id?: string | undefined;
	category_group_name?: string | undefined;
	budgeted?: number;
	activity?: number;
	balance?: number;
	goal_type?: string | null | undefined;
	goal_percentage_complete?: number | null | undefined;
	hidden?: boolean;
	note?: string | null | undefined;
}

export interface CategoriesListData {
	categories: CategoryRecord[];
	total_count?: number;
	returned_count?: number;
	offset?: number;
	has_more?: boolean;
	next_offset?: number | undefined;
	cached?: boolean;
	cache_info?: string;
}

export function formatCategoriesList(data: CategoriesListData): string {
	const lines: string[] = [
		`## Categories`,
		"",
		"| Group | Name | Budgeted | Activity | Balance | Goal |",
		"|-------|------|----------|----------|---------|------|",
	];
	for (const c of data.categories) {
		if (c.hidden) continue;
		const goal =
			c.goal_percentage_complete !== null &&
			c.goal_percentage_complete !== undefined
				? `${c.goal_percentage_complete}%`
				: (c.goal_type ?? "—");
		lines.push(
			`| ${c.category_group_name ?? "—"} | ${c.name} | ${fmtAmt(c.budgeted)} | ${fmtAmt(c.activity)} | ${fmtAmt(c.balance)} | ${goal} |`,
		);
	}
	lines.push(fmtPagination(data));
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

export interface CategoryDetailData {
	category: CategoryRecord & {
		goal_target?: number | null | undefined;
		goal_creation_month?: string | null | undefined;
		goal_target_month?: string | null | undefined;
	};
	cached?: boolean;
	cache_info?: string;
}

export function formatCategoryDetail(data: CategoryDetailData): string {
	const c = data.category;
	const lines: string[] = [
		`## Category: ${c.name}`,
		"",
		`- **ID:** \`${c.id}\``,
		`- **Group:** ${c.category_group_name ?? "—"}`,
		`- **Budgeted:** ${fmtAmt(c.budgeted)}`,
		`- **Activity:** ${fmtAmt(c.activity)}`,
		`- **Balance:** ${fmtAmt(c.balance)}`,
	];
	if (c.goal_type) {
		lines.push(`- **Goal type:** ${c.goal_type}`);
		if (c.goal_target !== null && c.goal_target !== undefined)
			lines.push(`- **Goal target:** ${fmtAmt(c.goal_target)}`);
		if (
			c.goal_percentage_complete !== null &&
			c.goal_percentage_complete !== undefined
		)
			lines.push(`- **Goal progress:** ${c.goal_percentage_complete}%`);
	}
	if (c.note) lines.push(`- **Note:** ${c.note}`);
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

// ─── payee formatters ─────────────────────────────────────────────────────────

export interface PayeeRecord {
	id: string;
	name: string;
	transfer_account_id?: string | null | undefined;
	deleted?: boolean;
}

export interface PayeesListData {
	payees: PayeeRecord[];
	total_count?: number;
	returned_count?: number;
	offset?: number;
	has_more?: boolean;
	next_offset?: number | undefined;
	cached?: boolean;
	cache_info?: string;
}

export function formatPayeesList(data: PayeesListData): string {
	const lines: string[] = [
		`## Payees`,
		"",
		"| Name | ID | Transfer Account |",
		"|------|----|-----------------|",
	];
	for (const p of data.payees) {
		if (p.deleted) continue;
		const transfer = p.transfer_account_id
			? `\`${p.transfer_account_id}\``
			: "—";
		lines.push(`| ${p.name} | \`${p.id}\` | ${transfer} |`);
	}
	lines.push(fmtPagination(data));
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

export interface PayeeDetailData {
	payee: PayeeRecord;
	cached?: boolean;
	cache_info?: string;
}

export function formatPayeeDetail(data: PayeeDetailData): string {
	const p = data.payee;
	const lines: string[] = [
		`## Payee: ${p.name}`,
		"",
		`- **ID:** \`${p.id}\``,
		`- **Name:** ${p.name}`,
	];
	if (p.transfer_account_id) {
		lines.push(`- **Transfer account:** \`${p.transfer_account_id}\``);
	}
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

// ─── month formatters ─────────────────────────────────────────────────────────

export interface MonthDetailData {
	month: {
		month?: string;
		note?: string | null | undefined;
		income?: number;
		budgeted?: number;
		activity?: number;
		to_be_budgeted?: number;
		age_of_money?: number | null | undefined;
		deleted?: boolean;
		categories?: CategoryRecord[];
	};
	cached?: boolean;
	cache_info?: string;
}

export function formatMonthDetail(data: MonthDetailData): string {
	const m = data.month;
	const lines: string[] = [
		`## Budget Month: ${m.month ?? "—"}`,
		"",
		`| Metric | Amount |`,
		`|--------|--------|`,
		`| Income | ${fmtAmt(m.income)} |`,
		`| Budgeted | ${fmtAmt(m.budgeted)} |`,
		`| Activity | ${fmtAmt(m.activity)} |`,
		`| To Be Budgeted | ${fmtAmt(m.to_be_budgeted)} |`,
	];
	if (m.age_of_money !== null && m.age_of_money !== undefined) {
		lines.push(`| Age of Money | ${m.age_of_money} days |`);
	}
	if (m.note) {
		lines.push("", `_${m.note}_`);
	}
	if (m.categories && m.categories.length > 0) {
		const withBalance = m.categories.filter(
			(c) => !c.hidden && (c.balance ?? 0) !== 0,
		);
		if (withBalance.length > 0) {
			lines.push("", `### Category Balances (${withBalance.length} active)`);
			lines.push("");
			lines.push("| Group | Category | Budgeted | Activity | Balance |");
			lines.push("|-------|----------|----------|----------|---------|");
			for (const c of withBalance) {
				lines.push(
					`| ${c.category_group_name ?? "—"} | ${c.name} | ${fmtAmt(c.budgeted)} | ${fmtAmt(c.activity)} | ${fmtAmt(c.balance)} |`,
				);
			}
		}
	}
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

export interface MonthRecord {
	month?: string;
	income?: number;
	budgeted?: number;
	activity?: number;
	to_be_budgeted?: number;
	age_of_money?: number | null | undefined;
}

export interface MonthsListData {
	months: MonthRecord[];
	total_count?: number;
	returned_count?: number;
	offset?: number;
	has_more?: boolean;
	next_offset?: number | undefined;
	cached?: boolean;
	cache_info?: string;
}

export function formatMonthsList(data: MonthsListData): string {
	const lines: string[] = [
		`## Budget Months`,
		"",
		"| Month | Income | Budgeted | Activity | TBB | AoM |",
		"|-------|--------|----------|----------|-----|-----|",
	];
	for (const m of data.months) {
		const aom =
			m.age_of_money !== null && m.age_of_money !== undefined
				? `${m.age_of_money}d`
				: "—";
		lines.push(
			`| ${m.month ?? "—"} | ${fmtAmt(m.income)} | ${fmtAmt(m.budgeted)} | ${fmtAmt(m.activity)} | ${fmtAmt(m.to_be_budgeted)} | ${aom} |`,
		);
	}
	lines.push(fmtPagination(data));
	lines.push(fmtCache(data));
	return lines.filter((l) => l !== undefined).join("\n");
}

// ─── utility formatters ───────────────────────────────────────────────────────

export interface UserInfoData {
	user: { id: string };
}

export function formatUserInfo(data: UserInfoData): string {
	return [`## YNAB User`, "", `- **ID:** \`${data.user.id}\``].join("\n");
}

export interface DefaultBudgetData {
	default_budget_id?: string | null;
	has_default?: boolean;
	message?: string;
}

export function formatDefaultBudget(data: DefaultBudgetData): string {
	const lines: string[] = ["## Default Budget", ""];
	if (data.has_default && data.default_budget_id) {
		lines.push(`- **Set:** \`${data.default_budget_id}\``);
	} else {
		lines.push("_No default budget is currently set._");
		lines.push("");
		lines.push("Use `ynab_set_default_budget` to configure one.");
	}
	return lines.join("\n");
}

export interface DiagnosticInfoData {
	[key: string]: unknown;
}

export function formatDiagnosticInfo(data: DiagnosticInfoData): string {
	const lines: string[] = ["## MCP Server Diagnostics", ""];

	// Iterate top-level sections
	for (const [key, value] of Object.entries(data)) {
		if (value === undefined || value === null) continue;
		lines.push(`### ${key}`);
		lines.push("");
		if (typeof value === "object" && !Array.isArray(value)) {
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				lines.push(`- **${k}:** ${JSON.stringify(v)}`);
			}
		} else {
			lines.push(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
		}
		lines.push("");
	}
	return lines.join("\n");
}
