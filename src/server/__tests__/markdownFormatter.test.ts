import { describe, expect, it } from "vitest";
import {
	formatAccountDetail,
	formatAccountsList,
	formatBudgetDetail,
	formatBudgetsList,
	formatCategoriesList,
	formatCategoryDetail,
	formatDefaultBudget,
	formatDiagnosticInfo,
	formatMonthDetail,
	formatMonthsList,
	formatPayeeDetail,
	formatPayeesList,
	formatTransactionDetail,
	formatTransactionsList,
	formatUserInfo,
} from "../markdownFormatter.js";

describe("markdownFormatter", () => {
	it("formats rich domain records and optional sections", () => {
		expect(
			formatBudgetsList({
				budgets: [
					{
						id: "budget-1",
						name: "Main",
						last_modified_on: "2026-07-09T00:00:00Z",
						currency_format: { iso_code: "CAD" },
					},
				],
				cache_info: "cached for 10m",
			}),
		).toContain("| Main | `budget-1` | CAD | 2026-07-09 |");

		const budget = formatBudgetDetail({
			budget: {
				id: "budget-1",
				name: "Main",
				first_month: "2025-01-01",
				last_month: "2026-12-01",
				last_modified_on: "2026-07-09T00:00:00Z",
				currency_format: { iso_code: "CAD" },
				accounts_count: 3,
				categories_count: 10,
				payees_count: 20,
				months_count: 24,
				message: "Complete",
			},
		});
		expect(budget).toContain("**Accounts:** 3");
		expect(budget).toContain("_Complete_");

		const accounts = formatAccountsList({
			accounts: [
				{
					id: "a1",
					name: "Checking",
					type: "checking",
					balance: -1234.5,
					cleared_balance: 100,
					uncleared_balance: 0,
					on_budget: true,
					closed: false,
				},
				{
					id: "a2",
					name: "Old",
					type: "savings",
					closed: true,
					on_budget: false,
				},
			],
			total_count: 5,
			returned_count: 2,
			offset: 0,
			has_more: true,
			next_offset: 2,
			cache_info: "fresh",
		});
		expect(accounts).toContain("-$1,234.50");
		expect(accounts).toContain("next page: `offset=2`");

		const account = formatAccountDetail({
			account: {
				id: "a1",
				name: "Checking",
				type: "checking",
				balance: 10,
				cleared_balance: 8,
				uncleared_balance: 2,
				on_budget: true,
				closed: false,
				note: "Primary",
			},
			cache_info: "fresh",
		});
		expect(account).toContain("**Note:** Primary");

		const transactions = formatTransactionsList({
			transactions: [
				{
					id: "t1",
					date: "2026-07-09",
					amount: -25.5,
					payee_name: "Cafe",
					category_name: "Dining",
					memo: "A memo longer than thirty characters should be sliced",
					cleared: "cleared",
				},
			],
			total_count: 1,
			returned_count: 1,
			has_more: false,
		});
		expect(transactions).toContain("Cafe");
		expect(transactions).toContain("cleared");

		const preview = formatTransactionsList({
			preview_transactions: [{ id: "t2", amount: 1 }],
			message: "Large response",
			suggestion: "Export it",
			showing: "Newest one",
		});
		expect(preview).toContain("Large response");
		expect(preview).toContain("Newest one");

		const detail = formatTransactionDetail({
			transaction: {
				id: "t1",
				date: "2026-07-09",
				amount: -15,
				payee_name: "Store",
				category_name: "Split",
				account_name: "Checking",
				cleared: "cleared",
				approved: true,
				memo: "Receipt",
				subtransactions: [
					{ amount: -10, category_name: "Food", memo: "Items" },
					{ amount: -5, category_name: null, memo: null },
				],
			},
			cache_info: "fresh",
		});
		expect(detail).toContain("### Split Items");
		expect(detail).toContain("approved");

		const categories = formatCategoriesList({
			categories: [
				{
					id: "c1",
					name: "Food",
					category_group_name: "Living",
					budgeted: 100,
					activity: -25,
					balance: 75,
					goal_percentage_complete: 75,
				},
				{ id: "c2", name: "Hidden", hidden: true, goal_type: "TB" },
			],
			total_count: 2,
			returned_count: 2,
		});
		expect(categories).toContain("75%");
		expect(categories).not.toContain("Hidden");

		const category = formatCategoryDetail({
			category: {
				id: "c1",
				name: "Food",
				category_group_name: "Living",
				budgeted: 100,
				activity: -25,
				balance: 75,
				goal_type: "TB",
				goal_target: 150,
				goal_percentage_complete: 75,
				note: "Keep steady",
			},
		});
		expect(category).toContain("**Goal target:** $150.00");
		expect(category).toContain("Keep steady");

		const payees = formatPayeesList({
			payees: [
				{ id: "p1", name: "Transfer", transfer_account_id: "a2" },
				{ id: "p2", name: "Deleted", deleted: true },
			],
			total_count: 2,
			returned_count: 2,
		});
		expect(payees).toContain("`a2`");
		expect(payees).not.toContain("Deleted");
		expect(
			formatPayeeDetail({
				payee: { id: "p1", name: "Transfer", transfer_account_id: "a2" },
			}),
		).toContain("Transfer account");

		const month = formatMonthDetail({
			month: {
				month: "2026-07-01",
				income: 5000,
				budgeted: 4000,
				activity: -3000,
				to_be_budgeted: 1000,
				age_of_money: 30,
				note: "July",
				categories: [
					{
						id: "c1",
						name: "Food",
						category_group_name: "Living",
						balance: 75,
					},
					{ id: "c2", name: "Zero", balance: 0 },
				],
			},
		});
		expect(month).toContain("Age of Money | 30 days");
		expect(month).toContain("Category Balances (1 active)");

		expect(
			formatMonthsList({
				months: [
					{ month: "2026-07-01", age_of_money: 30 },
					{ month: "2026-08-01", age_of_money: null },
				],
				total_count: 2,
				returned_count: 2,
			}),
		).toContain("30d");
		expect(formatUserInfo({ user: { id: "user-1" } })).toContain("user-1");
		expect(
			formatDefaultBudget({ has_default: true, default_budget_id: "budget-1" }),
		).toContain("budget-1");
		expect(
			formatDiagnosticInfo({
				server: { version: "1.0.0", healthy: true },
				logs: ["one"],
				none: null,
			}),
		).toContain("### server");
	});

	it("formats sparse and fallback values without throwing", () => {
		expect(formatBudgetsList({ budgets: [{ id: "b", name: "B" }] })).toContain(
			"| B | `b` |  | — |",
		);
		expect(formatBudgetDetail({ budget: { id: "b", name: "B" } })).toContain(
			"**Currency:** —",
		);
		expect(
			formatAccountDetail({
				account: { id: "a", name: "A", type: "cash", closed: true },
			}),
		).toContain("**Balance:** —");
		expect(formatTransactionsList({})).toContain("## Transactions");
		expect(
			formatTransactionsList({ preview_transactions: [{ id: "t" }] }),
		).toContain("Too large to display all");
		expect(
			formatTransactionDetail({ transaction: { id: "t", approved: false } }),
		).toContain("unapproved");
		expect(
			formatCategoriesList({
				categories: [{ id: "c", name: "C", goal_type: "TB" }],
			}),
		).toContain("TB");
		expect(
			formatCategoryDetail({ category: { id: "c", name: "C" } }),
		).not.toContain("Goal type");
		expect(formatPayeesList({ payees: [{ id: "p", name: "P" }] })).toContain(
			"| P | `p` | — |",
		);
		expect(formatPayeeDetail({ payee: { id: "p", name: "P" } })).not.toContain(
			"Transfer account",
		);
		expect(formatMonthDetail({ month: { categories: [] } })).not.toContain(
			"Category Balances",
		);
		expect(formatMonthsList({ months: [{}] })).toContain("| — |");
		expect(formatDefaultBudget({ has_default: false })).toContain(
			"No default budget",
		);
		expect(formatDiagnosticInfo({ value: 1, missing: undefined })).toContain(
			"```json",
		);
	});
});
