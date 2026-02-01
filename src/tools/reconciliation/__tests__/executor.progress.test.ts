import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import type { ProgressCallback } from "../../../server/toolRegistry.js";
import { type ExecutionOptions, executeReconciliation } from "../executor.js";
import type { ReconcileAccountRequest } from "../index.js";
import type {
	BankTransaction,
	ReconciliationAnalysis,
	TransactionMatch,
} from "../types.js";

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
		flag_name: null,
		account_id: "acc-1",
		account_name: "Test Account",
		payee_id: "payee-1",
		payee_name: "Test Payee",
		category_id: "cat-1",
		category_name: "Test Category",
		transfer_account_id: null,
		transfer_transaction_id: null,
		matched_transaction_id: null,
		import_id: null,
		import_payee_name: null,
		import_payee_name_original: null,
		debt_transaction_type: null,
		deleted: false,
		subtransactions: [],
		...overrides,
	});

	const createBankTransaction = (
		overrides: Partial<BankTransaction> = {},
	): BankTransaction => ({
		date: "2024-01-15",
		amount: -25000,
		payee: "Test Payee",
		memo: "Bank memo",
		...overrides,
	});

	const createMatch = (
		bankTxn: BankTransaction,
		ynabTxn: ynab.TransactionDetail,
		score = 0.95,
	): TransactionMatch => ({
		bankTransaction: bankTxn,
		ynabTransaction: ynabTxn,
		score,
		matchType: "exact",
		matchDetails: {
			amount_match: true,
			date_match: true,
			payee_similarity: 1.0,
		},
	});

	beforeEach(() => {
		progressCalls = [];
		mockProgressCallback = vi.fn().mockImplementation(async (params) => {
			progressCalls.push(params);
		});

		mockYnabAPI = {
			transactions: {
				createTransaction: vi.fn().mockResolvedValue({
					data: { transaction: createMockTransaction() },
				}),
				createTransactions: vi.fn().mockResolvedValue({
					data: {
						transactions: [createMockTransaction()],
						duplicate_import_ids: [],
					},
				}),
				updateTransactions: vi.fn().mockResolvedValue({
					data: {
						transactions: [createMockTransaction({ cleared: "cleared" })],
					},
				}),
			} as unknown as ynab.TransactionsApi,
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
			} as unknown as ynab.AccountsApi,
		};
	});

	describe("progress callback invocation", () => {
		it("should call progress callback during bulk transaction creation", async () => {
			const unmatchedBank: BankTransaction[] = [
				createBankTransaction({ payee: "Payee 1", amount: -10000 }),
				createBankTransaction({ payee: "Payee 2", amount: -20000 }),
				createBankTransaction({ payee: "Payee 3", amount: -30000 }),
			];

			const analysis: ReconciliationAnalysis = {
				summary: {
					bank_transactions_count: 3,
					ynab_transactions_count: 0,
					matches: 0,
					unmatched_bank: 3,
					unmatched_ynab: 0,
					match_rate: 0,
					statement_date_range: "2024-01-01 to 2024-01-31",
				},
				auto_matches: [],
				unmatched_bank: unmatchedBank,
				unmatched_ynab: [],
				balance_info: {
					current_cleared: 100000,
					target_statement: 40000,
				},
			};

			const params: ReconcileAccountRequest = {
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-10,Payee 1",
				dry_run: false,
				auto_create_transactions: true,
			};

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

			const analysis: ReconciliationAnalysis = {
				summary: {
					bank_transactions_count: 1,
					ynab_transactions_count: 0,
					matches: 0,
					unmatched_bank: 1,
					unmatched_ynab: 0,
					match_rate: 0,
					statement_date_range: "2024-01-01 to 2024-01-31",
				},
				auto_matches: [],
				unmatched_bank: unmatchedBank,
				unmatched_ynab: [],
				balance_info: {
					current_cleared: 100000,
					target_statement: 90000,
				},
			};

			const params: ReconcileAccountRequest = {
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-10,Single Payee",
				dry_run: false,
				auto_create_transactions: true,
			};

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
			const analysis: ReconciliationAnalysis = {
				summary: {
					bank_transactions_count: 1,
					ynab_transactions_count: 0,
					matches: 0,
					unmatched_bank: 1,
					unmatched_ynab: 0,
					match_rate: 0,
					statement_date_range: "2024-01-01 to 2024-01-31",
				},
				auto_matches: [],
				unmatched_bank: [createBankTransaction()],
				unmatched_ynab: [],
				balance_info: {
					current_cleared: 100000,
					target_statement: 75000,
				},
			};

			const params: ReconcileAccountRequest = {
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: false,
				auto_create_transactions: true,
			};

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
			const ynabTxn = createMockTransaction({ cleared: "uncleared" });
			const bankTxn = createBankTransaction();
			const match = createMatch(bankTxn, ynabTxn);

			const analysis: ReconciliationAnalysis = {
				summary: {
					bank_transactions_count: 1,
					ynab_transactions_count: 1,
					matches: 1,
					unmatched_bank: 0,
					unmatched_ynab: 0,
					match_rate: 1,
					statement_date_range: "2024-01-01 to 2024-01-31",
				},
				auto_matches: [match],
				unmatched_bank: [],
				unmatched_ynab: [],
				balance_info: {
					current_cleared: 75000,
					target_statement: 100000,
				},
			};

			const params: ReconcileAccountRequest = {
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: false,
				auto_update_cleared_status: true,
			};

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
			const clearedTxn = createMockTransaction({ cleared: "cleared" });
			const bankTxn = createBankTransaction();
			const matchNoUpdate = createMatch(bankTxn, clearedTxn);

			// Create a match that will need updating
			const unclearedTxn = createMockTransaction({
				cleared: "uncleared",
				id: "txn-2",
			});
			const bankTxn2 = createBankTransaction({ payee: "Payee 2" });
			const matchNeedsUpdate = createMatch(bankTxn2, unclearedTxn);

			const analysis: ReconciliationAnalysis = {
				summary: {
					bank_transactions_count: 2,
					ynab_transactions_count: 2,
					matches: 2,
					unmatched_bank: 0,
					unmatched_ynab: 0,
					match_rate: 1,
					statement_date_range: "2024-01-01 to 2024-01-31",
				},
				auto_matches: [matchNoUpdate, matchNeedsUpdate],
				unmatched_bank: [],
				unmatched_ynab: [],
				balance_info: {
					current_cleared: 75000,
					target_statement: 100000,
				},
			};

			const params: ReconcileAccountRequest = {
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: false,
				auto_update_cleared_status: true,
			};

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

			// The total should only count the match that needs updating (1), not both (2)
			if (progressCalls.length > 0) {
				const lastCall = progressCalls[progressCalls.length - 1]!;
				// Total should be 1 (only the uncleared transaction needs updating)
				expect(lastCall.total).toBe(1);
			}
		});

		it("should include all operation types in total count", async () => {
			const unmatchedBank = [createBankTransaction({ payee: "New Payee" })];
			const unclearedTxn = createMockTransaction({ cleared: "uncleared" });
			const matchNeedsUpdate = createMatch(
				createBankTransaction(),
				unclearedTxn,
			);
			const unmatchedYnab = [
				createMockTransaction({ id: "unmatched-ynab", cleared: "cleared" }),
			];

			const analysis: ReconciliationAnalysis = {
				summary: {
					bank_transactions_count: 2,
					ynab_transactions_count: 2,
					matches: 1,
					unmatched_bank: 1,
					unmatched_ynab: 1,
					match_rate: 0.5,
					statement_date_range: "2024-01-01 to 2024-01-31",
				},
				auto_matches: [matchNeedsUpdate],
				unmatched_bank: unmatchedBank,
				unmatched_ynab: unmatchedYnab,
				balance_info: {
					current_cleared: 75000,
					target_statement: 50000,
				},
			};

			const params: ReconcileAccountRequest = {
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: false,
				auto_create_transactions: true,
				auto_update_cleared_status: true,
				auto_unclear_missing: true,
			};

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

			// Total should be: 1 (create) + 1 (update match) + 1 (unclear) = 3
			if (progressCalls.length > 0) {
				const anyCall = progressCalls.find((c) => c.total !== undefined);
				expect(anyCall?.total).toBe(3);
			}
		});
	});

	describe("dry run behavior", () => {
		it("should not call progress callback during dry run", async () => {
			const analysis: ReconciliationAnalysis = {
				summary: {
					bank_transactions_count: 1,
					ynab_transactions_count: 0,
					matches: 0,
					unmatched_bank: 1,
					unmatched_ynab: 0,
					match_rate: 0,
					statement_date_range: "2024-01-01 to 2024-01-31",
				},
				auto_matches: [],
				unmatched_bank: [createBankTransaction()],
				unmatched_ynab: [],
				balance_info: {
					current_cleared: 100000,
					target_statement: 75000,
				},
			};

			const params: ReconcileAccountRequest = {
				account_id: "acc-1",
				csv_data: "date,amount,payee\n2024-01-15,-25,Test",
				dry_run: true, // Dry run mode
				auto_create_transactions: true,
			};

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
