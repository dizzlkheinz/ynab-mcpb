import { describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import { type MoneyValue, toMoneyValue } from "../../../utils/money.js";
import type { NormalizedYnabError } from "../executor.js";
import {
	type AccountSnapshot,
	buildReconciliationPlan,
	type ExecutionOptions,
	executeReconciliation,
	executeReconciliationPlan,
	normalizeYnabError,
	shouldPropagateYnabError,
} from "../executor.js";
import type { ReconcileAccountRequest } from "../index.js";
import type { ReconciliationAnalysis } from "../types.js";

const buildAnalysis = (): ReconciliationAnalysis => ({
	success: true,
	phase: "analysis",
	summary: {
		statement_date_range: "2025-10-01 to 2025-10-31",
		bank_transactions_count: 3,
		ynab_transactions_count: 3,
		ynab_in_range_count: 3,
		ynab_outside_range_count: 0,
		auto_matched: 1,
		suggested_matches: 0,
		unmatched_bank: 1,
		unmatched_ynab: 1,
		current_cleared_balance: toMoneyValue(-899020, "USD"),
		target_statement_balance: toMoneyValue(-921240, "USD"),
		discrepancy: toMoneyValue(22220, "USD"),
		discrepancy_explanation: "Need to add 1 missing transaction",
	},
	auto_matches: [
		{
			bankTransaction: {
				id: "bank-1",
				date: "2025-10-15",
				amount: -45230,
				payee: "Shell Gas",
				sourceRow: 2,
				raw: { date: "2025-10-15", amount: "-45.23", description: "Shell Gas" },
			},
			ynabTransaction: {
				id: "ynab-1",
				date: "2025-10-14",
				amount: -45230,
				payee: "Shell",
				categoryName: "Auto",
				cleared: "uncleared",
				approved: true,
				memo: null,
			},
			candidates: [],
			confidence: "high",
			confidenceScore: 97,
			matchReason: "exact_amount_and_date",
		},
	],
	suggested_matches: [],
	unmatched_bank: [
		{
			id: "bank-2",
			date: "2025-10-25",
			amount: 22220,
			payee: "EvoCarShare",
			sourceRow: 7,
			raw: { date: "2025-10-25", amount: "22.22", description: "EvoCarShare" },
		},
	],
	unmatched_ynab: [
		{
			id: "ynab-2",
			date: "2025-10-10",
			amount: -15000,
			payee: "Coffee Shop",
			categoryName: "Dining",
			cleared: "cleared",
			approved: true,
			memo: null,
		},
	],
	ynab_outside_date_range: [],
	balance_info: {
		current_cleared: toMoneyValue(-899020, "USD"),
		current_uncleared: toMoneyValue(-45230, "USD"),
		current_total: toMoneyValue(-944250, "USD"),
		target_statement: toMoneyValue(-921240, "USD"),
		discrepancy: toMoneyValue(22220, "USD"),
		on_track: false,
	},
	next_steps: ["Review auto matches"],
	insights: [],
});

const defaultAccountSnapshot: AccountSnapshot = {
	balance: 0,
	cleared_balance: 0,
	uncleared_balance: 0,
};

const buildBulkAnalysis = (
	count: number,
	amount = 10000,
	statementMultiplier = count,
): ReconciliationAnalysis => {
	const analysis = buildAnalysis();
	const baseDate = Date.parse("2025-10-01");
	analysis.auto_matches = [];
	analysis.summary.auto_matched = 0;
	analysis.suggested_matches = [];
	analysis.summary.suggested_matches = 0;
	analysis.unmatched_ynab = [];
	analysis.summary.unmatched_ynab = 0;
	analysis.summary.ynab_transactions_count = 0;
	analysis.summary.bank_transactions_count = count;
	analysis.unmatched_bank = Array.from({ length: count }, (_, index) => {
		const date = new Date(baseDate + index * 24 * 60 * 60 * 1000);
		return {
			id: `bank-bulk-${index}`,
			date: date.toISOString().slice(0, 10),
			amount,
			payee: `Bulk Payee ${index}`,
			memo: `Bulk memo ${index}`,
			sourceRow: index + 1,
			raw: {
				date: date.toISOString().slice(0, 10),
				amount: String(amount / 1000),
				description: `Bulk Payee ${index}`,
			},
		};
	});
	analysis.summary.unmatched_bank = analysis.unmatched_bank.length;
	const statementBalance = amount * statementMultiplier;
	analysis.summary.current_cleared_balance = toMoneyValue(0, "USD");
	analysis.summary.target_statement_balance = toMoneyValue(
		statementBalance,
		"USD",
	);
	analysis.summary.discrepancy = toMoneyValue(statementBalance, "USD");
	analysis.summary.discrepancy_explanation = "Bulk test discrepancy";
	analysis.balance_info = {
		current_cleared: toMoneyValue(0, "USD"),
		current_uncleared: toMoneyValue(0, "USD"),
		current_total: toMoneyValue(0, "USD"),
		target_statement: toMoneyValue(statementBalance, "USD"),
		discrepancy: toMoneyValue(statementBalance, "USD"),
		on_track: false,
	};
	analysis.next_steps = [];
	analysis.insights = [];
	return analysis;
};

const buildBulkParams = (
	statementBalance: MoneyValue, // Expects MoneyValue now from buildBulkAnalysis
	overrides: Partial<ReconcileAccountRequest> = {},
): ReconcileAccountRequest => ({
	budget_id: "budget-bulk",
	account_id: "account-bulk",
	csv_data: "Date,Payee,Amount",
	statement_balance: statementBalance.value, // Use decimal value for params
	statement_end_date: "2025-10-31",
	date_tolerance_days: 1,
	match_strictness: "strict" as const,
	sign_convention: "auto" as const,
	max_suggestions_in_output: 20,
	auto_create_transactions: true,
	auto_update_cleared_status: false,
	auto_unclear_missing: false,
	auto_adjust_dates: false,
	dry_run: false,
	...overrides,
});

const createMockYnabAPI = (
	snapshot: AccountSnapshot = defaultAccountSnapshot,
) => {
	const createTransactions = vi.fn();
	const createTransaction = vi.fn();
	const updateTransactions = vi
		.fn()
		.mockResolvedValue({ data: { transactions: [] } });
	const getTransactionsByAccount = vi
		.fn()
		.mockResolvedValue({ data: { transactions: [] } });
	const getAccountById = vi.fn().mockResolvedValue({
		data: {
			account: {
				id: "account-bulk",
				balance: snapshot.balance,
				cleared_balance: snapshot.cleared_balance,
				uncleared_balance: snapshot.uncleared_balance,
			},
		},
	});

	const api = {
		transactions: {
			createTransactions,
			createTransaction,
			updateTransactions,
			getTransactionsByAccount,
		},
		accounts: {
			getAccountById,
		},
	} as unknown as ynab.API;

	return {
		api,
		mocks: {
			createTransactions,
			createTransaction,
			updateTransactions,
			getTransactionsByAccount,
			getAccountById,
		},
	};
};

describe("error normalization helpers", () => {
	it("normalizes YNAB SDK error objects with status and detail", () => {
		const err = normalizeYnabError({
			error: { id: "429", detail: "Too many requests" },
		});
		expect(err.status).toBe(429);
		expect(err.message).toContain("Too many requests");
	});

	it("retains status from Error-like objects and propagates HTTP code decisions", () => {
		const err = normalizeYnabError(
			Object.assign(new Error("Nope"), { status: 503 }),
		);
		expect(err.status).toBe(503);
		expect(shouldPropagateYnabError(err as NormalizedYnabError)).toBe(true);
	});
});

function optionsFor(
	count = 3,
	overrides: Partial<ReconcileAccountRequest> = {},
) {
	const analysis = buildBulkAnalysis(count);
	const { api, mocks } = createMockYnabAPI();
	mocks.createTransactions.mockImplementation(async (_budget, body) => ({
		data: {
			transactions: body.transactions.map(
				(transaction: ynab.NewTransaction, index: number) => ({
					...transaction,
					id: `created-${transaction.date}-${index}`,
				}),
			),
		},
	}));
	mocks.createTransaction.mockImplementation(async (_budget, body) => ({
		data: { transaction: { ...body.transaction, id: "created" } },
	}));
	const options: ExecutionOptions = {
		ynabAPI: api,
		analysis,
		params: buildBulkParams(analysis.balance_info.target_statement, overrides),
		budgetId: "budget-bulk",
		accountId: "account-bulk",
		initialAccount: defaultAccountSnapshot,
		currencyCode: "USD",
	};
	return { options, mocks };
}

describe("immutable reconciliation plans", () => {
	it("previews exact payloads without calling YNAB", async () => {
		const { options, mocks } = optionsFor(3, { dry_run: true });
		const result = await executeReconciliation(options);
		expect(result.summary.transactions_created).toBe(3);
		expect(
			result.operation_results?.every((result) => result.status === "planned"),
		).toBe(true);
		expect(result.balance_reconciliation?.status).toBe("balanced");
		for (const mock of Object.values(mocks))
			expect(mock).not.toHaveBeenCalled();
	});
	it("freezes both the plan and each financial payload", () => {
		const { options } = optionsFor();
		const plan = buildReconciliationPlan(options);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.operations[0]?.payload)).toBe(true);
		options.analysis.unmatched_bank[0]!.amount = 999;
		expect(
			plan.operations.every(
				(operation) =>
					(operation.payload as ynab.NewTransaction).amount === 10000,
			),
		).toBe(true);
	});
	it("executes stored operations without recomputing a mutated analysis", async () => {
		const { options, mocks } = optionsFor();
		const plan = buildReconciliationPlan(options);
		options.analysis.unmatched_bank = [];
		const result = await executeReconciliationPlan(plan, options);
		expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
		expect(
			mocks.createTransactions.mock.calls[0]?.[1].transactions,
		).toHaveLength(3);
		expect(result.summary.transactions_created).toBe(3);
	});
	it("rejects stale account snapshots before any write", async () => {
		const { options, mocks } = optionsFor();
		options.sourceTransactions = [];
		const plan = buildReconciliationPlan(options);
		mocks.getTransactionsByAccount.mockResolvedValue({
			data: { transactions: [{ id: "new", amount: 1 }] },
		});
		await expect(executeReconciliationPlan(plan, options)).rejects.toThrow(
			"changed since preview",
		);
		expect(mocks.createTransactions).not.toHaveBeenCalled();
	});
	it("normalizes deleted tombstones consistently between preview and confirmation", async () => {
		const { options, mocks } = optionsFor();
		options.sourceTransactions = [];
		const plan = buildReconciliationPlan(options);
		mocks.getTransactionsByAccount.mockResolvedValue({
			data: { transactions: [{ id: "deleted", deleted: true, amount: 1000 }] },
		});
		const result = await executeReconciliationPlan(plan, options);
		expect(result.summary.transactions_created).toBe(3);
		expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
	});
	it("retains two missing offsetting transactions even when the balance matches", async () => {
		const { options } = optionsFor(2, { dry_run: true });
		options.analysis.unmatched_bank[0]!.amount = -10000;
		options.analysis.balance_info.target_statement = toMoneyValue(0, "USD");
		const result = await executeReconciliation(options);
		expect(result.summary.transactions_created).toBe(2);
		expect(result.balance_reconciliation?.status).toBe("balanced");
	});
	it("chunks a large plan into requests no larger than 100", async () => {
		const { options, mocks } = optionsFor(205);
		const result = await executeReconciliation(options);
		expect(
			mocks.createTransactions.mock.calls.map(
				(call) => call[1].transactions.length,
			),
		).toEqual([100, 100, 5]);
		expect(result.summary.transactions_created).toBe(205);
	});
	it("preserves bank import matching by omitting import IDs", async () => {
		const { options, mocks } = optionsFor();
		await executeReconciliation(options);
		expect(
			mocks.createTransactions.mock.calls[0]?.[1].transactions.every(
				(transaction: ynab.NewTransaction) =>
					transaction.import_id === undefined,
			),
		).toBe(true);
	});
	it("never replays an uncertain bulk create as sequential writes", async () => {
		const { options, mocks } = optionsFor();
		mocks.createTransactions.mockRejectedValue(new Error("ECONNRESET"));
		const result = await executeReconciliation(options);
		expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
		expect(mocks.createTransaction).not.toHaveBeenCalled();
		expect(result.summary.transactions_created).toBe(0);
		expect(result.errors?.[0]).toContain("uncertain");
		expect(
			result.operation_results?.every(
				(result) => result.status === "uncertain",
			),
		).toBe(true);
	});
	it("returns per-operation failures for SDK errors instead of hiding them", async () => {
		const { options, mocks } = optionsFor(1);
		mocks.createTransaction.mockRejectedValue({
			error: { id: "429", detail: "Too many requests" },
		});
		const result = await executeReconciliation(options);
		expect(result.errors?.join()).toContain("Too many requests");
		expect(result.operation_results?.[0]?.status).toBe("uncertain");
	});
	it("keeps earlier committed chunks and skips later chunks after failure", async () => {
		const { options, mocks } = optionsFor(205);
		mocks.createTransactions
			.mockImplementationOnce(async (_budget, body) => ({
				data: {
					transactions: body.transactions.map(
						(transaction: ynab.NewTransaction, index: number) => ({
							...transaction,
							id: `first-${index}`,
						}),
					),
				},
			}))
			.mockRejectedValueOnce(new Error("network error"));
		const result = await executeReconciliation(options);
		expect(mocks.createTransactions).toHaveBeenCalledTimes(2);
		expect(result.summary.transactions_created).toBe(100);
		expect(
			result.operation_results?.filter(
				(result) => result.status === "uncertain",
			),
		).toHaveLength(100);
		expect(
			result.operation_results?.filter((result) => result.status === "skipped"),
		).toHaveLength(5);
	});
	it("correlates out-of-order partial create responses without inventing success", async () => {
		const { options, mocks } = optionsFor(3);
		mocks.createTransactions.mockImplementationOnce(async (_budget, body) => ({
			data: {
				transactions: [
					{ ...body.transactions[2], id: "last" },
					{ ...body.transactions[0], id: "first" },
				],
			},
		}));
		const result = await executeReconciliation(options);
		expect(result.summary.transactions_created).toBe(2);
		expect(
			result.operation_results?.map((result) => [
				result.status,
				result.transaction_id,
			]),
		).toEqual([
			["applied", "first"],
			["uncertain", undefined],
			["applied", "last"],
		]);
		expect(result.errors?.join()).toContain("did not acknowledge");
	});
	it("requires an acknowledged single create instead of trusting an empty response", async () => {
		const { options, mocks } = optionsFor(1);
		mocks.createTransaction.mockResolvedValueOnce({ data: {} });
		const result = await executeReconciliation(options);
		expect(result.summary.transactions_created).toBe(0);
		expect(result.operation_results?.[0]?.status).toBe("uncertain");
	});
	it("does not count duplicate response IDs as distinct created transactions", async () => {
		const { options, mocks } = optionsFor(2);
		mocks.createTransactions.mockImplementationOnce(async (_budget, body) => ({
			data: {
				transactions: body.transactions.map(
					(transaction: ynab.NewTransaction) => ({
						...transaction,
						id: "same",
					}),
				),
			},
		}));
		const result = await executeReconciliation(options);
		expect(result.summary.transactions_created).toBe(1);
		expect(result.operation_results?.[1]?.status).toBe("uncertain");
	});
	it("requires updates to acknowledge the requested fields and skips dependent changes", async () => {
		const { options, mocks } = optionsFor(0, {
			auto_create_transactions: false,
			auto_update_cleared_status: true,
			auto_unclear_missing: true,
		});
		options.analysis = buildAnalysis();
		mocks.updateTransactions.mockResolvedValueOnce({
			data: { transactions: [] },
		});
		const result = await executeReconciliation(options);
		expect(result.summary.transactions_updated).toBe(0);
		expect(result.operation_results?.[0]?.status).toBe("uncertain");
		expect(mocks.updateTransactions).toHaveBeenCalledTimes(1);
	});
	it("does not compensate for failed clearing updates by unclearing other rows", async () => {
		const { options, mocks } = optionsFor(0, {
			auto_create_transactions: false,
			auto_update_cleared_status: true,
			auto_unclear_missing: true,
		});
		options.analysis = buildAnalysis();
		mocks.updateTransactions.mockRejectedValue(new Error("write failed"));
		const result = await executeReconciliation(options);
		expect(mocks.updateTransactions).toHaveBeenCalledTimes(1);
		expect(
			result.operation_results
				?.filter((result) => result.operation.kind === "unclear")
				.every((result) => result.status === "skipped"),
		).toBe(true);
	});
	it("counts successful writes even if progress delivery fails", async () => {
		const { options, mocks } = optionsFor();
		options.sendProgress = vi
			.fn()
			.mockRejectedValue(new Error("client disconnected"));
		const result = await executeReconciliation(options);
		expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
		expect(result.summary.transactions_created).toBe(3);
		expect(result.errors).toEqual([]);
	});
	it("reports verification failure separately from committed writes", async () => {
		const { options, mocks } = optionsFor();
		mocks.getTransactionsByAccount.mockRejectedValue(new Error("read failed"));
		const result = await executeReconciliation(options);
		expect(result.summary.transactions_created).toBe(3);
		expect(result.errors?.join()).toContain("final verification failed");
		expect(result.balance_reconciliation).toBeUndefined();
	});
	it("plans date changes even if the account balance already matches", async () => {
		const { options } = optionsFor(0, {
			auto_adjust_dates: true,
			dry_run: true,
		});
		options.analysis = buildAnalysis();
		options.initialAccount = {
			balance: -921240,
			cleared_balance: -921240,
			uncleared_balance: 0,
		};
		const result = await executeReconciliation(options);
		expect(result.summary.dates_adjusted).toBe(1);
	});
});
