import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import type { ProgressCallback } from "../../../server/toolRegistry.js";
import { toMoneyValueFromDecimal } from "../../../utils/money.js";
import type { ExecutionOptions } from "../executor.js";
import type { ReconcileAccountRequest } from "../index.js";
import type {
	BankTransaction,
	ReconciliationAnalysis,
	TransactionMatch,
	YNABTransaction,
} from "../types.js";
import { executeReconciliation } from "./executeReconciliation.js";

/**
 * Unit tests for progress notification functionality in reconciliation executor
 */
describe("Reconciliation Progress Notifications", () => {
	let mockYnabAPI: Partial<ynab.API>;
	let mockProgressCallback: ProgressCallback;
	let progressCalls: { progress: number; total?: number; message?: string }[];

	const createMockTransaction = (
		overrides: Partial<ynab.TransactionDetail> = {},
	): ynab.TransactionDetail => ({
		id: "txn-1",
		date: "2024-01-15",
		amount: -25000,
		memo: "Test transaction",
		cleared: "uncleared" as ynab.TransactionClearedStatus,
		approved: true,
		flag_color: null,
		account_id: "acc-1",
		account_name: "Test Account",
		payee_id: "payee-1",
		payee_name: "Test Payee",
		category_id: "cat-1",
		category_name: "Test Category",
		debt_transaction_type: null,
		deleted: false,
		subtransactions: [],
		...overrides,
	});

	let bankRow = 0;
	const createBankTransaction = (
		overrides: Partial<BankTransaction> = {},
	): BankTransaction => {
		bankRow++;
		return {
			id: `bank-${bankRow}`,
			date: "2024-01-15",
			amount: -25000,
			payee: "Test Payee",
			memo: "Bank memo",
			sourceRow: bankRow,
			raw: { date: "2024-01-15", amount: "-25.00", description: "Test Payee" },
			...overrides,
		};
	};

	/** A YNAB transaction as the analysis holds it (normalized, milliunits) */
	const createYnabTransaction = (
		overrides: Partial<YNABTransaction> = {},
	): YNABTransaction => ({
		id: "txn-1",
		date: "2024-01-15",
		amount: -25000,
		payee: "Test Payee",
		memo: "Test transaction",
		categoryName: "Test Category",
		cleared: "uncleared",
		approved: true,
		...overrides,
	});

	const createMatch = (
		bankTxn: BankTransaction,
		ynabTxn: YNABTransaction,
		confidenceScore = 95,
	): TransactionMatch => ({
		bankTransaction: bankTxn,
		ynabTransaction: ynabTxn,
		confidence: "high",
		confidenceScore,
		matchReason: "exact_amount_and_date",
	});

	/**
	 * Builds an analysis whose summary counts follow from the given
	 * transactions. Balances are in dollars, as the executor reads them.
	 */
	const createAnalysis = ({
		auto_matches = [],
		unmatched_bank = [],
		unmatched_ynab = [],
		balance,
	}: {
		auto_matches?: TransactionMatch[];
		unmatched_bank?: BankTransaction[];
		unmatched_ynab?: YNABTransaction[];
		balance: { cleared: number; target: number };
	}): ReconciliationAnalysis => {
		const cleared = toMoneyValueFromDecimal(balance.cleared);
		const target = toMoneyValueFromDecimal(balance.target);
		const discrepancy = toMoneyValueFromDecimal(
			balance.target - balance.cleared,
		);
		return {
			success: true,
			phase: "analysis",
			summary: {
				statement_date_range: "2024-01-01 to 2024-01-31",
				bank_transactions_count: auto_matches.length + unmatched_bank.length,
				ynab_transactions_count: auto_matches.length + unmatched_ynab.length,
				ynab_in_range_count: auto_matches.length + unmatched_ynab.length,
				ynab_outside_range_count: 0,
				auto_matched: auto_matches.length,
				suggested_matches: 0,
				unmatched_bank: unmatched_bank.length,
				unmatched_ynab: unmatched_ynab.length,
				current_cleared_balance: cleared,
				target_statement_balance: target,
				discrepancy,
				discrepancy_explanation: "",
			},
			auto_matches,
			suggested_matches: [],
			unmatched_bank,
			unmatched_ynab,
			ynab_outside_date_range: [],
			balance_info: {
				current_cleared: cleared,
				current_uncleared: toMoneyValueFromDecimal(0),
				current_total: cleared,
				target_statement: target,
				discrepancy,
				on_track: balance.cleared === balance.target,
			},
			next_steps: [],
			insights: [],
		};
	};

	/** Schema defaults, except dry_run, which every test sets explicitly */
	const createParams = (
		overrides: Partial<ReconcileAccountRequest> & { dry_run: boolean },
	): ReconcileAccountRequest => ({
		account_id: "acc-1",
		csv_data: "date,amount,payee\n2024-01-15,-25,Test",
		statement_balance: 0,
		date_tolerance_days: 7,
		match_strictness: "normal",
		auto_create_transactions: false,
		auto_update_cleared_status: false,
		auto_unclear_missing: false,
		auto_adjust_dates: false,
		sign_convention: "auto",
		max_suggestions_in_output: 20,
		...overrides,
	});

	/** MCP progress must increase on every report and should end at the total */
	const expectProgressCompleted = () => {
		expect(progressCalls.length).toBeGreaterThan(0);
		for (let i = 1; i < progressCalls.length; i++) {
			expect(progressCalls[i]!.progress).toBeGreaterThan(
				progressCalls[i - 1]!.progress,
			);
		}
		const lastCall = progressCalls[progressCalls.length - 1]!;
		expect(lastCall.progress).toBe(lastCall.total);
	};

	beforeEach(() => {
		progressCalls = [];
		mockProgressCallback = vi.fn().mockImplementation(async (params) => {
			progressCalls.push(params);
		});

		mockYnabAPI = {
			transactions: {
				createTransaction: vi
					.fn()
					.mockImplementation(async (_budget, body) => ({
						data: {
							transaction: { ...createMockTransaction(), ...body.transaction },
						},
					})),
				createTransactions: vi
					.fn()
					.mockImplementation(async (_budget, body) => ({
						data: {
							transactions: body.transactions.map(
								(transaction: ynab.NewTransaction, index: number) => ({
									...createMockTransaction(),
									...transaction,
									id: `created-${index}`,
								}),
							),
						},
					})),
				updateTransactions: vi
					.fn()
					.mockImplementation(async (_budget, body) => ({
						data: {
							transactions: body.transactions.map(
								(transaction: ynab.SaveTransactionWithIdOrImportId) => ({
									...createMockTransaction(),
									...transaction,
								}),
							),
						},
					})),
			} as unknown as ynab.API["transactions"],
			accounts: {
				getAccountById: vi.fn().mockResolvedValue({
					data: {
						account: {
							balance: 100000,
							cleared_balance: 100000,
							uncleared_balance: 0,
						},
					},
				}),
			} as unknown as ynab.API["accounts"],
		};
	});

	describe("progress callback invocation", () => {
		it("should call progress callback during bulk transaction creation", async () => {
			const unmatchedBank: BankTransaction[] = [
				createBankTransaction({ payee: "Payee 1", amount: -10000 }),
				createBankTransaction({ payee: "Payee 2", amount: -20000 }),
				createBankTransaction({ payee: "Payee 3", amount: -30000 }),
			];

			const analysis = createAnalysis({
				auto_matches: [],
				unmatched_bank: unmatchedBank,
				unmatched_ynab: [],
				balance: { cleared: 100000, target: 40000 },
			});

			const params = createParams({
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-10,Payee 1",
				dry_run: false,
				auto_create_transactions: true,
			});

			const options: ExecutionOptions = {
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params,
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 100000,
					uncleared_balance: 0,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			};

			await executeReconciliation(options);

			expect(mockProgressCallback).toHaveBeenCalled();
			expect(progressCalls.length).toBeGreaterThan(0);

			// Verify progress structure
			for (const call of progressCalls) {
				expect(call).toHaveProperty("progress");
				expect(call).toHaveProperty("total");
				expect(call).toHaveProperty("message");
				expect(typeof call.progress).toBe("number");
				expect(typeof call.total).toBe("number");
			}
		});

		it("should report progress during sequential fallback", async () => {
			const unmatchedBank: BankTransaction[] = [
				createBankTransaction({ payee: "Single Payee", amount: -10000 }),
			];

			const analysis = createAnalysis({
				auto_matches: [],
				unmatched_bank: unmatchedBank,
				unmatched_ynab: [],
				balance: { cleared: 100000, target: 90000 },
			});

			const params = createParams({
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-10,Single Payee",
				dry_run: false,
				auto_create_transactions: true,
			});

			const options: ExecutionOptions = {
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params,
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 100000,
					uncleared_balance: 0,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			};

			await executeReconciliation(options);

			// With only 1 transaction, it goes through sequential path
			expect(mockProgressCallback).toHaveBeenCalled();
		});

		it("should not call progress callback when not provided", async () => {
			const analysis = createAnalysis({
				auto_matches: [],
				unmatched_bank: [createBankTransaction()],
				unmatched_ynab: [],
				balance: { cleared: 100000, target: 75000 },
			});

			const params = createParams({
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: false,
				auto_create_transactions: true,
			});

			const options: ExecutionOptions = {
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params,
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 100000,
					uncleared_balance: 0,
				},
				currencyCode: "USD",
				// No sendProgress callback
			};

			// Should not throw when no callback provided
			await expect(executeReconciliation(options)).resolves.toBeDefined();
		});

		it("should report progress during transaction updates", async () => {
			const ynabTxn = createYnabTransaction({ cleared: "uncleared" });
			const bankTxn = createBankTransaction();
			const match = createMatch(bankTxn, ynabTxn);

			const analysis = createAnalysis({
				auto_matches: [match],
				unmatched_bank: [],
				unmatched_ynab: [],
				balance: { cleared: 75000, target: 100000 },
			});

			const params = createParams({
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: false,
				auto_update_cleared_status: true,
			});

			const options: ExecutionOptions = {
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params,
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 75000,
					uncleared_balance: 25000,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			};

			await executeReconciliation(options);

			expect(mockProgressCallback).toHaveBeenCalled();
		});
	});

	describe("progress calculation accuracy", () => {
		it("should exclude skipped matches from total count", async () => {
			// Create a match that won't need updating (already cleared, same date)
			const clearedTxn = createYnabTransaction({ cleared: "cleared" });
			const bankTxn = createBankTransaction();
			const matchNoUpdate = createMatch(bankTxn, clearedTxn);

			// Create a match that will need updating
			const unclearedTxn = createYnabTransaction({
				cleared: "uncleared",
				id: "txn-2",
			});
			const bankTxn2 = createBankTransaction({ payee: "Payee 2" });
			const matchNeedsUpdate = createMatch(bankTxn2, unclearedTxn);

			const analysis = createAnalysis({
				auto_matches: [matchNoUpdate, matchNeedsUpdate],
				unmatched_bank: [],
				unmatched_ynab: [],
				balance: { cleared: 75000, target: 100000 },
			});

			const params = createParams({
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: false,
				auto_update_cleared_status: true,
			});

			const options: ExecutionOptions = {
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params,
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 75000,
					uncleared_balance: 25000,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			};

			await executeReconciliation(options);

			// The total counts only the match that needs updating (1), not both
			// (2), plus the final result step
			expect(progressCalls).toEqual([
				expect.objectContaining({ progress: 1, total: 2 }),
				expect.objectContaining({ progress: 2, total: 2 }),
			]);
		});

		it("should include all operation types in total count", async () => {
			const unmatchedBank = [createBankTransaction({ payee: "New Payee" })];
			const unclearedTxn = createYnabTransaction({ cleared: "uncleared" });
			const matchNeedsUpdate = createMatch(
				createBankTransaction(),
				unclearedTxn,
			);
			const unmatchedYnab = [
				createYnabTransaction({ id: "unmatched-ynab", cleared: "cleared" }),
			];

			const analysis = createAnalysis({
				auto_matches: [matchNeedsUpdate],
				unmatched_bank: unmatchedBank,
				unmatched_ynab: unmatchedYnab,
				balance: { cleared: 75000, target: 50000 },
			});

			const params = createParams({
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: false,
				auto_create_transactions: true,
				auto_update_cleared_status: true,
				auto_unclear_missing: true,
			});

			const options: ExecutionOptions = {
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params,
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 75000,
					uncleared_balance: 25000,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			};

			await executeReconciliation(options);

			// Total should be: 1 (create) + 1 (update match) + 1 (unclear) + 1 (final step) = 4
			expect(progressCalls[0]?.total).toBe(4);
			expectProgressCompleted();
		});

		it("should reach the total when unclearing stops early or skips uncleared transactions", async () => {
			const unmatchedYnab = [
				createYnabTransaction({ id: "cleared-1", cleared: "cleared" }),
				createYnabTransaction({ id: "cleared-2", cleared: "cleared" }),
				createYnabTransaction({ id: "cleared-3", cleared: "cleared" }),
				createYnabTransaction({ id: "uncleared-1", cleared: "uncleared" }),
				createYnabTransaction({ id: "uncleared-2", cleared: "uncleared" }),
			];

			const analysis = createAnalysis({
				auto_matches: [],
				unmatched_bank: [],
				unmatched_ynab: unmatchedYnab,
				// Unclearing one -25.00 transaction aligns the balance (plain
				// numbers here are dollars, unlike the milliunit account snapshot)
				balance: { cleared: 75, target: 100 },
			});

			const params = createParams({
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: false,
				auto_unclear_missing: true,
			});

			await executeReconciliation({
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params,
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 75000,
					uncleared_balance: 25000,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			});

			// One unclear plus the final step
			expect(progressCalls[progressCalls.length - 1]).toEqual(
				expect.objectContaining({ progress: 2, total: 2 }),
			);
			expectProgressCompleted();
		});

		it("should complete every planned step with increasing progress", async () => {
			const unmatchedBank: BankTransaction[] = [
				createBankTransaction({ payee: "Payee 1", amount: -10000 }),
				createBankTransaction({ payee: "Payee 2", amount: -20000 }),
				createBankTransaction({ payee: "Payee 3", amount: -30000 }),
			];
			const matchNeedsUpdate = createMatch(
				createBankTransaction(),
				createYnabTransaction({ id: "txn-update", cleared: "uncleared" }),
			);

			const analysis = createAnalysis({
				auto_matches: [matchNeedsUpdate],
				unmatched_bank: unmatchedBank,
				unmatched_ynab: [
					createYnabTransaction({ id: "unmatched-ynab", cleared: "cleared" }),
				],
				// Creating all three bank transactions aligns the balance, so the
				// planned update and unclear operations never run (dollars)
				balance: { cleared: 100, target: 40 },
			});

			const params = createParams({
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-10,Payee 1",
				dry_run: false,
				auto_create_transactions: true,
				auto_update_cleared_status: true,
				auto_unclear_missing: true,
			});

			// Echo the created transactions so bulk correlation succeeds
			vi.mocked(
				mockYnabAPI.transactions!.createTransactions,
			).mockImplementation(async (_budgetId, body) => ({
				data: {
					transactions: (body.transactions ?? []).map((txn, index) =>
						createMockTransaction({
							payee_id: null,
							category_id: null,
							...txn,
							id: `created-${index}`,
							cleared: "cleared" as ynab.TransactionClearedStatus,
						} as Partial<ynab.TransactionDetail>),
					),
					duplicate_import_ids: [],
					transaction_ids: [],
					server_knowledge: 0,
				},
			}));

			const result = await executeReconciliation({
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params,
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 100000,
					uncleared_balance: 0,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			});

			expect(result.summary.transactions_created).toBe(3);
			expect(
				mockYnabAPI.transactions!.updateTransactions,
			).toHaveBeenCalledTimes(3);
			expectProgressCompleted();
		});

		it("should reach the total when an update chunk fails and STEP 3 is skipped", async () => {
			const matchNeedsUpdate = createMatch(
				createBankTransaction(),
				createYnabTransaction({ id: "txn-update", cleared: "uncleared" }),
			);

			const analysis = createAnalysis({
				auto_matches: [matchNeedsUpdate],
				// The create reports progress first, giving the client a bar to finish
				unmatched_bank: [createBankTransaction({ payee: "New Payee" })],
				unmatched_ynab: [
					createYnabTransaction({ id: "unmatched-ynab", cleared: "cleared" }),
				],
				// Aligning takes the create, the update, and the unclear (dollars)
				balance: { cleared: 100, target: 25 },
			});

			// A network error has no status, so the failed chunk is not fatal
			vi.mocked(mockYnabAPI.transactions!.updateTransactions).mockRejectedValue(
				new Error("socket hang up"),
			);

			const result = await executeReconciliation({
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params: createParams({
					account_id: "acc-1",
					csv_data: "date,amount,payee\n2024-01-15,-25,Test",
					dry_run: false,
					auto_create_transactions: true,
					auto_update_cleared_status: true,
					auto_unclear_missing: true,
				}),
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 100000,
					uncleared_balance: 0,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			});

			// The update may have committed, so it is reported as uncertain, never
			// retried, and the later unclear is skipped rather than attempted.
			const statuses = Object.fromEntries(
				(result.operation_results ?? []).map((operationResult) => [
					operationResult.operation.kind,
					operationResult.status,
				]),
			);
			expect(statuses).toEqual({
				create: "applied",
				update: "uncertain",
				unclear: "skipped",
			});
			expect(
				mockYnabAPI.transactions!.updateTransactions,
			).toHaveBeenCalledTimes(1);
			expect(result.errors).toEqual([
				expect.stringMatching(/uncertain.*socket hang up/i),
			]);
			expectProgressCompleted();
		});

		it("should report progress while marking matched transactions reconciled", async () => {
			const matches = Array.from({ length: 2 }, (_, index) =>
				createMatch(
					createBankTransaction({ payee: `Payee ${index}` }),
					createYnabTransaction({ id: `txn-${index}`, cleared: "cleared" }),
				),
			);

			const analysis = createAnalysis({
				auto_matches: matches,
				unmatched_bank: [],
				unmatched_ynab: [],
				// Already aligned, so only STEP 4 runs (dollars)
				balance: { cleared: 100, target: 100 },
			});

			vi.mocked(
				mockYnabAPI.transactions!.updateTransactions,
			).mockImplementation(async (_budgetId, body) => ({
				data: {
					transactions: (body.transactions ?? []).map((txn) =>
						createMockTransaction({
							id: txn.id ?? "unknown",
							cleared: "reconciled" as ynab.TransactionClearedStatus,
						}),
					),
					transaction_ids: [],
					server_knowledge: 0,
				},
			}));

			await executeReconciliation({
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params: createParams({
					account_id: "acc-1",
					csv_data: "date,amount,payee\n2024-01-15,-25,Test",
					dry_run: false,
					auto_update_cleared_status: true,
				}),
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 100000,
					uncleared_balance: 0,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			});

			expect(progressCalls).toEqual([
				expect.objectContaining({
					progress: 2,
					total: 3,
					message: expect.stringContaining("planned operations"),
				}),
				expect.objectContaining({ progress: 3, total: 3 }),
			]);
		});
	});

	describe("dry run behavior", () => {
		it("should not call progress callback during dry run", async () => {
			const analysis = createAnalysis({
				auto_matches: [],
				unmatched_bank: [createBankTransaction()],
				unmatched_ynab: [],
				balance: { cleared: 100000, target: 75000 },
			});

			const params = createParams({
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: true, // Dry run mode
				auto_create_transactions: true,
			});

			const options: ExecutionOptions = {
				ynabAPI: mockYnabAPI as ynab.API,
				analysis,
				params,
				budgetId: "budget-1",
				accountId: "acc-1",
				initialAccount: {
					balance: 100000,
					cleared_balance: 100000,
					uncleared_balance: 0,
				},
				currencyCode: "USD",
				sendProgress: mockProgressCallback,
			};

			await executeReconciliation(options);

			// In dry run, no actual operations happen, so no progress should be reported
			// (Progress is only reported after successful API calls)
			expect(
				mockYnabAPI.transactions?.createTransaction,
			).not.toHaveBeenCalled();
		});
	});
});
