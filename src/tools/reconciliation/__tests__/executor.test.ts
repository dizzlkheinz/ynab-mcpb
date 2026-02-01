import { describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import { toMoneyValue } from "../../../utils/money.js";
import { type AccountSnapshot, executeReconciliation } from "../executor.js";
import type { NormalizedYnabError } from "../executor.js";
import { normalizeYnabError, shouldPropagateYnabError } from "../executor.js";
import type { ReconcileAccountRequest } from "../index.js";
import type { ReconciliationAnalysis } from "../types.js";

const buildAnalysis = (): ReconciliationAnalysis => ({
	success: true,
	phase: "analysis",
	summary: {
		statement_date_range: "2025-10-01 to 2025-10-31",
		bank_transactions_count: 3,
		ynab_transactions_count: 3,
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
	statement_date: "2025-10-31",
	date_tolerance_days: 1,
	amount_tolerance_cents: 1,
	auto_match_threshold: 90,
	suggestion_threshold: 60,
	auto_create_transactions: true,
	auto_update_cleared_status: false,
	auto_unclear_missing: false,
	auto_adjust_dates: false,
	dry_run: false,
	require_exact_match: true,
	confidence_threshold: 0.8,
	max_resolution_attempts: 3,
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

describe("executeReconciliation (dry run)", () => {
	it("produces action plan without calling YNAB APIs when dry_run=true", async () => {
		const analysis = buildAnalysis();
		const params = {
			budget_id: "budget-1",
			account_id: "account-1",
			csv_data: "Date,Description,Amount",
			statement_balance: -921.24,
			date_tolerance_days: 2,
			amount_tolerance_cents: 1,
			auto_match_threshold: 90,
			suggestion_threshold: 60,
			auto_create_transactions: true,
			auto_update_cleared_status: true,
			auto_unclear_missing: true,
			auto_adjust_dates: true,
			dry_run: true,
			require_exact_match: true,
			confidence_threshold: 0.8,
			max_resolution_attempts: 5,
		} satisfies any;

		const initialAccount: AccountSnapshot = {
			balance: -899020,
			cleared_balance: -899020,
			uncleared_balance: 0,
		};

		const result = await executeReconciliation({
			ynabAPI: {} as ynab.API,
			analysis,
			params,
			budgetId: "budget-1",
			accountId: "account-1",
			initialAccount,
			currencyCode: "USD",
		});

		expect(result.summary.transactions_created).toBe(1);
		expect(result.summary.transactions_updated).toBe(2);
		expect(result.summary.dates_adjusted).toBe(1);
		// 3 original actions + 2 diagnostic actions (diagnostic_step3_entry + diagnostic_unmatched_ynab)
		expect(result.actions_taken).toHaveLength(5);
		expect(result.recommendations).toContain(
			"Dry run only — re-run with dry_run=false to apply these changes",
		);
	});
});

describe("executeReconciliation (apply mode)", () => {
	it("creates, updates, and adjusts when dry_run=false", async () => {
		const analysis = buildAnalysis();
		const params = {
			budget_id: "budget-apply",
			account_id: "account-apply",
			csv_data: "Date,Description,Amount",
			statement_balance: -921.24,
			statement_date: "2025-10-31",
			date_tolerance_days: 2,
			amount_tolerance_cents: 1,
			auto_match_threshold: 90,
			suggestion_threshold: 60,
			auto_create_transactions: true,
			auto_update_cleared_status: true,
			auto_unclear_missing: true,
			auto_adjust_dates: true,
			dry_run: false,
			require_exact_match: true,
			confidence_threshold: 0.8,
			max_resolution_attempts: 5,
		} satisfies any;

		const initialAccount: AccountSnapshot = {
			balance: -899020,
			cleared_balance: -899020,
			uncleared_balance: 0,
		};

		const mockCreate = vi
			.fn()
			.mockResolvedValue({ data: { transaction: { id: "created-1" } } });
		const mockUpdate = vi
			.fn()
			.mockResolvedValue({ data: { transaction: { id: "updated-1" } } });
		const mockBatchUpdate = vi.fn().mockResolvedValue({
			data: { transactions: [{ id: "updated-1" }, { id: "updated-2" }] },
		});
		const mockGetAccount = vi.fn().mockResolvedValue({
			data: {
				account: {
					balance: -921240,
					cleared_balance: -921240,
					uncleared_balance: 0,
				},
			},
		});

		const mockTransactionsApi = {
			createTransaction: mockCreate,
			updateTransaction: mockUpdate,
			updateTransactions: mockBatchUpdate,
			getTransactionsByAccount: vi
				.fn()
				.mockResolvedValue({ data: { transactions: [] } }),
		} satisfies Partial<ynab.TransactionsApi>;

		const mockAccountsApi = {
			getAccountById: mockGetAccount,
		} satisfies Partial<ynab.AccountsApi>;

		const ynabAPI = {
			transactions: mockTransactionsApi,
			accounts: mockAccountsApi,
		} as unknown as ynab.API;

		const result = await executeReconciliation({
			ynabAPI,
			analysis,
			params,
			budgetId: "budget-apply",
			accountId: "account-apply",
			initialAccount,
			currencyCode: "USD",
		});

		expect(mockCreate).toHaveBeenCalledTimes(1);
		expect(mockBatchUpdate).toHaveBeenCalled();
		expect(mockGetAccount).toHaveBeenCalled();
		expect(result.summary.transactions_created).toBe(1);
		expect(result.summary.transactions_updated).toBeGreaterThanOrEqual(2);
		expect(result.summary.dates_adjusted).toBe(1);
		expect(result.actions_taken.length).toBeGreaterThanOrEqual(3);
		expect(result.summary.dry_run).toBe(false);
	});
});

describe("executeReconciliation (ordered halting)", () => {
	it("processes newest auto matches first and stops once balances align", async () => {
		const analysis: ReconciliationAnalysis = {
			success: true,
			phase: "analysis",
			summary: {
				statement_date_range: "2025-09-01 to 2025-10-31",
				bank_transactions_count: 2,
				ynab_transactions_count: 2,
				auto_matched: 2,
				suggested_matches: 0,
				unmatched_bank: 0,
				unmatched_ynab: 0,
				current_cleared_balance: toMoneyValue(90000, "USD"),
				target_statement_balance: toMoneyValue(100000, "USD"),
				discrepancy: toMoneyValue(-10000, "USD"),
				discrepancy_explanation: "Awaiting cleared transactions",
			},
			auto_matches: [
				{
					bankTransaction: {
						id: "bank-older",
						date: "2025-09-15",
						amount: 5000,
						payee: "Older",
						sourceRow: 2,
						raw: { date: "2025-09-15", amount: "5.00", description: "Older" },
					},
					ynabTransaction: {
						id: "ynab-older",
						date: "2025-09-14",
						amount: 5000,
						payee: "Older",
						categoryName: null,
						cleared: "uncleared",
						approved: true,
						memo: null,
					},
					candidates: [],
					confidence: "high",
					confidenceScore: 95,
					matchReason: "Exact match",
				},
				{
					bankTransaction: {
						id: "bank-newer",
						date: "2025-10-25",
						amount: 10000,
						payee: "Newer",
						sourceRow: 1,
						raw: { date: "2025-10-25", amount: "10.00", description: "Newer" },
					},
					ynabTransaction: {
						id: "ynab-newer",
						date: "2025-10-24",
						amount: 10000,
						payee: "Newer",
						categoryName: null,
						cleared: "uncleared",
						approved: true,
						memo: null,
					},
					candidates: [],
					confidence: "high",
					confidenceScore: 99,
					matchReason: "Exact match",
				},
			],
			suggested_matches: [],
			unmatched_bank: [],
			unmatched_ynab: [],
			balance_info: {
				current_cleared: toMoneyValue(90000, "USD"),
				current_uncleared: toMoneyValue(0, "USD"),
				current_total: toMoneyValue(90000, "USD"),
				target_statement: toMoneyValue(100000, "USD"),
				discrepancy: toMoneyValue(-10000, "USD"),
				on_track: false,
			},
			next_steps: [],
			insights: [],
		};

		const params = {
			budget_id: "budget-ordered",
			account_id: "account-ordered",
			csv_data: "Date,Description,Amount",
			statement_balance: 100,
			date_tolerance_days: 2,
			amount_tolerance_cents: 1,
			auto_match_threshold: 90,
			suggestion_threshold: 60,
			auto_create_transactions: false,
			auto_update_cleared_status: true,
			auto_unclear_missing: false,
			auto_adjust_dates: false,
			dry_run: true,
			require_exact_match: true,
			confidence_threshold: 0.8,
			max_resolution_attempts: 5,
		} satisfies any;

		const initialAccount: AccountSnapshot = {
			balance: 90000,
			cleared_balance: 90000,
			uncleared_balance: 0,
		};

		const result = await executeReconciliation({
			ynabAPI: {} as ynab.API,
			analysis,
			params,
			budgetId: "budget-ordered",
			accountId: "account-ordered",
			initialAccount,
			currencyCode: "USD",
		});

		const updateActions = result.actions_taken.filter(
			(action) => action.type === "update_transaction",
		);
		expect(updateActions).toHaveLength(1);
		expect((updateActions[0]?.transaction as any)?.transaction_id).toBe(
			"ynab-newer",
		);
		expect(
			result.actions_taken.some(
				(action) => action.type === "balance_checkpoint",
			),
		).toBe(true);
		expect(result.summary.transactions_updated).toBe(1);
		expect(result.summary.dates_adjusted).toBe(0);
	});
});

describe("executeReconciliation - bulk create mode", () => {
	it("uses bulk create API for batches with multiple transactions", async () => {
		const analysis = buildBulkAnalysis(5, 12);
		const params = buildBulkParams(analysis.summary.target_statement_balance);
		const initialAccount = { ...defaultAccountSnapshot };
		const { api, mocks } = createMockYnabAPI(initialAccount);

		mocks.createTransactions.mockImplementation(
			async (_budgetId, body: any) => {
				const transactions = (body.transactions ?? []).map(
					(txn: any, index: number) => ({
						id: `bulk-${index}`,
						account_id: txn.account_id,
						amount: txn.amount,
						date: txn.date,
						payee_name: txn.payee_name,
						memo: txn.memo,
						cleared: "cleared",
						approved: true,
					}),
				);
				return { data: { transactions, duplicate_import_ids: [] } };
			},
		);

		const result = await executeReconciliation({
			ynabAPI: api,
			analysis,
			params,
			budgetId: params.budget_id,
			accountId: params.account_id,
			initialAccount,
			currencyCode: "USD",
		});

		expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
		const payload = mocks.createTransactions.mock.calls[0]?.[1];
		expect(payload?.transactions).toHaveLength(5);
		const createActions = result.actions_taken.filter(
			(action) => action.type === "create_transaction",
		);
		expect(createActions).toHaveLength(5);
		expect(createActions.every((action) => action.correlation_key)).toBe(true);
		expect(result.summary.transactions_created).toBe(5);
		expect(result.bulk_operation_details).toEqual(
			expect.objectContaining({
				chunks_processed: 1,
				bulk_successes: 1,
				sequential_fallbacks: 0,
				bulk_chunk_failures: 0,
				transaction_failures: 0,
			}),
		);
	});

	it("falls back to sequential mode for single transaction scenarios", async () => {
		const analysis = buildBulkAnalysis(1, 15);
		const params = buildBulkParams(analysis.summary.target_statement_balance);
		const initialAccount = { ...defaultAccountSnapshot };
		const { api, mocks } = createMockYnabAPI(initialAccount);

		mocks.createTransaction.mockResolvedValue({
			data: {
				transaction: {
					id: "single-txn",
					amount: 15000,
					date: analysis.unmatched_bank[0]?.date ?? "2025-10-01",
				},
			},
		});

		const result = await executeReconciliation({
			ynabAPI: api,
			analysis,
			params,
			budgetId: params.budget_id,
			accountId: params.account_id,
			initialAccount,
			currencyCode: "USD",
		});

		expect(mocks.createTransactions).not.toHaveBeenCalled();
		expect(mocks.createTransaction).toHaveBeenCalledTimes(1);
		expect(result.summary.transactions_created).toBe(1);
		expect(result.bulk_operation_details).toBeUndefined();
	});

	it("falls back to sequential creation when bulk request fails", async () => {
		const analysis = buildBulkAnalysis(3, 1000);
		const params = buildBulkParams(analysis.summary.target_statement_balance);
		const initialAccount = { ...defaultAccountSnapshot };
		const { api, mocks } = createMockYnabAPI(initialAccount);

		mocks.createTransactions.mockRejectedValue(new Error("500 error"));
		mocks.createTransaction.mockImplementation(async (_budgetId, body: any) => {
			return {
				data: {
					transaction: {
						id: `seq-${body.transaction?.date}`,
						amount: body.transaction?.amount ?? 0,
						date: body.transaction?.date ?? "2025-11-01",
						cleared: "cleared",
						approved: true,
					},
				},
			};
		});

		const result = await executeReconciliation({
			ynabAPI: api,
			analysis,
			params,
			budgetId: params.budget_id,
			accountId: params.account_id,
			initialAccount,
			currencyCode: "USD",
		});

		expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
		expect(mocks.createTransaction).toHaveBeenCalledTimes(3);
		expect(
			result.actions_taken.some(
				(action) => action.type === "bulk_create_fallback",
			),
		).toBe(true);
		expect(result.summary.transactions_created).toBe(3);
		expect(result.bulk_operation_details).toEqual(
			expect.objectContaining({
				chunks_processed: 1,
				bulk_successes: 0,
				sequential_fallbacks: 1,
				bulk_chunk_failures: 1,
				transaction_failures: 0,
			}),
		);
	});

	it("propagates rate-limit error payloads with status codes from bulk create", async () => {
		const analysis = buildBulkAnalysis(3, 7);
		const params = buildBulkParams(analysis.summary.target_statement_balance);
		const initialAccount = { ...defaultAccountSnapshot };
		const { api, mocks } = createMockYnabAPI(initialAccount);

		mocks.createTransactions.mockRejectedValue({
			error: {
				id: "429",
				name: "too_many_requests",
				detail: "Too many requests",
			},
		});

		await expect(
			executeReconciliation({
				ynabAPI: api,
				analysis,
				params,
				budgetId: params.budget_id,
				accountId: params.account_id,
				initialAccount,
				currencyCode: "USD",
			}),
		).rejects.toMatchObject({ status: 429 });
	});

	it("splits large batches into 100-transaction chunks", async () => {
		const analysis = buildBulkAnalysis(150, 1000);
		const params = buildBulkParams(analysis.summary.target_statement_balance);
		const initialAccount = { ...defaultAccountSnapshot };
		const { api, mocks } = createMockYnabAPI(initialAccount);

		let chunkCall = 0;
		mocks.createTransactions.mockImplementation(
			async (_budgetId, body: any) => {
				chunkCall += 1;
				const transactions = (body.transactions ?? []).map(
					(txn: any, index: number) => ({
						id: `chunk-${chunkCall}-${index}`,
						account_id: txn.account_id,
						amount: txn.amount,
						date: txn.date,
						payee_name: txn.payee_name,
						memo: txn.memo,
						cleared: "cleared",
						approved: true,
					}),
				);
				return { data: { transactions, duplicate_import_ids: [] } };
			},
		);

		const result = await executeReconciliation({
			ynabAPI: api,
			analysis,
			params,
			budgetId: params.budget_id,
			accountId: params.account_id,
			initialAccount,
			currencyCode: "USD",
		});

		expect(mocks.createTransactions).toHaveBeenCalledTimes(2);
		expect(result.summary.transactions_created).toBe(150);
		expect(result.bulk_operation_details).toEqual(
			expect.objectContaining({
				chunks_processed: 2,
				bulk_successes: 2,
				bulk_chunk_failures: 0,
				transaction_failures: 0,
			}),
		);
	});

	it("throws on fatal sequential creation errors surfaced as objects", async () => {
		const analysis = buildBulkAnalysis(1, 1000);
		const params = buildBulkParams(analysis.summary.target_statement_balance);
		const initialAccount = { ...defaultAccountSnapshot };
		const { api, mocks } = createMockYnabAPI(initialAccount);

		mocks.createTransaction.mockRejectedValue({
			error: { id: "404", name: "not_found", detail: "Account not found" },
		});

		await expect(
			executeReconciliation({
				ynabAPI: api,
				analysis,
				params,
				budgetId: params.budget_id,
				accountId: params.account_id,
				initialAccount,
				currencyCode: "USD",
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("creates all transactions without import_id (no YNAB-side duplicate detection)", async () => {
		// Note: import_id is intentionally omitted from reconciliation-created transactions
		// so they can match with bank-imported transactions. This means YNAB won't detect
		// duplicates via import_id - the reconciliation matcher is responsible for that.
		// Use amount of 100 to avoid early balance halting (tolerance is 10 milliunits)
		const analysis = buildBulkAnalysis(3, 100);
		const params = buildBulkParams(analysis.summary.target_statement_balance);
		const initialAccount = { ...defaultAccountSnapshot };
		const { api, mocks } = createMockYnabAPI(initialAccount);

		mocks.createTransactions.mockImplementation(
			async (_budgetId, body: any) => {
				const transactions = (body.transactions ?? []).map(
					(txn: any, index: number) => ({
						id: `created-${index}`,
						account_id: txn.account_id,
						amount: txn.amount,
						date: txn.date,
						payee_name: txn.payee_name,
						memo: txn.memo,
						cleared: "cleared",
						approved: true,
					}),
				);
				// Verify no import_id is being sent
				for (const txn of body.transactions ?? []) {
					expect(txn.import_id).toBeUndefined();
				}
				return {
					data: {
						transactions,
						duplicate_import_ids: [],
					},
				};
			},
		);

		const result = await executeReconciliation({
			ynabAPI: api,
			analysis,
			params,
			budgetId: params.budget_id,
			accountId: params.account_id,
			initialAccount,
			currencyCode: "USD",
		});

		// Without import_id, YNAB creates all transactions (no duplicate detection)
		expect(result.bulk_operation_details?.duplicates_detected).toBe(0);
		expect(result.summary.transactions_created).toBe(3);
	});

	it("honors halting logic when balance aligns mid-batch", async () => {
		const analysis = buildBulkAnalysis(10, 1000, 5);
		const params = buildBulkParams(analysis.summary.target_statement_balance);
		const initialAccount = { ...defaultAccountSnapshot };
		const { api, mocks } = createMockYnabAPI(initialAccount);

		mocks.createTransactions.mockImplementation(
			async (_budgetId, body: any) => {
				const transactions = (body.transactions ?? []).map(
					(txn: any, index: number) => ({
						id: `halt-${index}`,
						account_id: txn.account_id,
						amount: txn.amount,
						date: txn.date,
						payee_name: txn.payee_name,
						memo: txn.memo,
						cleared: "cleared",
						approved: true,
					}),
				);
				return { data: { transactions, duplicate_import_ids: [] } };
			},
		);

		const result = await executeReconciliation({
			ynabAPI: api,
			analysis,
			params,
			budgetId: params.budget_id,
			accountId: params.account_id,
			initialAccount,
			currencyCode: "USD",
		});

		expect(result.summary.transactions_created).toBe(5);
		expect(mocks.createTransactions).toHaveBeenCalledTimes(1);
		const payload = mocks.createTransactions.mock.calls[0]?.[1];
		expect(payload?.transactions).toHaveLength(5);
		expect(
			result.actions_taken.some(
				(action) => action.type === "balance_checkpoint",
			),
		).toBe(true);
	});

	it("processes multiple chunks and halts at chunk boundaries when balance aligns", async () => {
		// Create 120 unmatched bank transactions of $10 each = $1200 total available
		// Set target balance to $500 (50 transactions worth)
		// This verifies that when >100 transactions exist but balance aligns after ~50,
		// the batch-building loop stops early and only processes one chunk (not two)
		const count = 120;
		const amountPerTxn = 10;
		const analysis = buildBulkAnalysis(count, amountPerTxn, 50); // statement multiplier = 50
		// This sets target to $500 (50 transactions * $10)
		const initialAccount = { ...defaultAccountSnapshot };
		const params = buildBulkParams(analysis.summary.target_statement_balance);
		const { api, mocks } = createMockYnabAPI(initialAccount);

		let chunkCallCount = 0;
		mocks.createTransactions.mockImplementation(
			async (_budgetId, body: any) => {
				chunkCallCount += 1;
				const transactions = (body.transactions ?? []).map(
					(txn: any, index: number) => ({
						id: `multi-chunk-halt-${chunkCallCount}-${index}`,
						account_id: txn.account_id,
						amount: txn.amount,
						date: txn.date,
						payee_name: txn.payee_name,
						memo: txn.memo,
						cleared: "cleared",
						approved: true,
					}),
				);
				return { data: { transactions, duplicate_import_ids: [] } };
			},
		);

		const result = await executeReconciliation({
			ynabAPI: api,
			analysis,
			params,
			budgetId: params.budget_id,
			accountId: params.account_id,
			initialAccount,
			currencyCode: "USD",
		});

		// Verify that only ~50 transactions were created (not all 120)
		expect(result.summary.transactions_created).toBeLessThan(count);
		expect(result.summary.transactions_created).toBeGreaterThan(0);
		// Only 1 chunk should be processed (not 2), since balance aligns before second chunk
		expect(chunkCallCount).toBe(1);
		expect(
			result.actions_taken.some(
				(action) => action.type === "balance_checkpoint",
			),
		).toBe(true);
		expect(result.bulk_operation_details).toEqual(
			expect.objectContaining({
				chunks_processed: 1,
				bulk_successes: 1,
			}),
		);
	});

	it("simulates bulk preview during dry-run mode", async () => {
		const analysis = buildBulkAnalysis(5, 9);
		const params = buildBulkParams(analysis.summary.target_statement_balance, {
			dry_run: true,
		});
		const initialAccount = { ...defaultAccountSnapshot };
		const { api, mocks } = createMockYnabAPI(initialAccount);

		const result = await executeReconciliation({
			ynabAPI: api,
			analysis,
			params,
			budgetId: params.budget_id,
			accountId: params.account_id,
			initialAccount,
			currencyCode: "USD",
		});

		expect(mocks.createTransactions).not.toHaveBeenCalled();
		const createActions = result.actions_taken.filter(
			(action) => action.type === "create_transaction",
		);
		expect(createActions).toHaveLength(5);
		expect(result.summary.transactions_created).toBe(5);
		expect(result.bulk_operation_details).toBeUndefined();
	});
});
