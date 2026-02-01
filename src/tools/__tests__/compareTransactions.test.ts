import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import {
	CompareTransactionsSchema,
	handleCompareTransactions,
} from "../compareTransactions/index.js";

// Mock filesystem
vi.mock("fs", () => ({
	readFileSync: vi.fn(),
}));

// Mock the YNAB API
const mockYnabAPI = {
	transactions: {
		getTransactionsByAccount: vi.fn(),
	},
} as unknown as ynab.API;

describe("compareTransactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("CompareTransactionsSchema", () => {
		it("should validate valid parameters", () => {
			const validParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
			};

			const result = CompareTransactionsSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		it("should require budget_id and account_id", () => {
			const invalidParams = {
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
			};

			const result = CompareTransactionsSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});

		it("should require either csv_file_path or csv_data", () => {
			const invalidParams = {
				budget_id: "budget-123",
				account_id: "account-456",
			};

			const result = CompareTransactionsSchema.safeParse(invalidParams);
			expect(result.success).toBe(false);
		});

		it("should apply default values", () => {
			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
			};

			const parsed = CompareTransactionsSchema.parse(params);
			expect(parsed.amount_tolerance).toBe(0.01);
			expect(parsed.date_tolerance_days).toBe(5);
			expect(parsed.csv_format.date_column).toBe("Date");
			expect(parsed.csv_format.amount_column).toBe("Amount");
			expect(parsed.csv_format.description_column).toBe("Description");
		});
	});

	describe("handleCompareTransactions", () => {
		const mockTransactions = [
			{
				id: "ynab-1",
				date: "2024-01-01",
				amount: 100000, // $100.00 in milliunits
				payee_name: "Test Payee",
				memo: "Test memo",
				cleared: "cleared",
				approved: true,
				deleted: false,
				account_id: "account-456",
				account_name: "Test Account",
			},
			{
				id: "ynab-2",
				date: "2024-01-02",
				amount: -50000, // -$50.00 in milliunits
				payee_name: "Another Payee",
				memo: null,
				cleared: "uncleared",
				approved: false,
				deleted: false,
				account_id: "account-456",
				account_name: "Test Account",
			},
		];

		it("should compare CSV data with YNAB transactions", async () => {
			const csvData =
				"Date,Amount,Description\n2024-01-01,100.00,Test Payee\n2024-01-03,25.00,Missing Transaction";

			(
				mockYnabAPI.transactions.getTransactionsByAccount as any
			).mockResolvedValue({
				data: { transactions: mockTransactions },
			});

			// Mock payees endpoint
			(mockYnabAPI as any).payees = {
				getPayees: vi.fn().mockResolvedValue({
					data: { payees: [{ id: "payee-1", name: "Test Payee" }] },
				}),
			};

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: csvData,
			};

			const result = await handleCompareTransactions(mockYnabAPI, params);

			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("text");

			const response = JSON.parse(result.content[0].text);
			expect(response.summary).toBeDefined();
			expect(response.summary.bank_transactions_count).toBe(2);
			expect(response.summary.ynab_transactions_count).toBe(2);
			expect(response.matches).toBeDefined();
			expect(response.missing_in_ynab).toBeDefined();
			expect(response.missing_in_bank).toBeDefined();
		});

		it("should handle CSV file path", async () => {
			const csvData = "Date,Amount,Description\n2024-01-01,100.00,Test Payee";
			(readFileSync as any).mockReturnValue(csvData);

			(
				mockYnabAPI.transactions.getTransactionsByAccount as any
			).mockResolvedValue({
				data: { transactions: mockTransactions },
			});

			// Mock payees endpoint
			(mockYnabAPI as any).payees = {
				getPayees: vi.fn().mockResolvedValue({
					data: { payees: [{ id: "payee-1", name: "Test Payee" }] },
				}),
			};

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_file_path: "/path/to/transactions.csv",
			};

			const result = await handleCompareTransactions(mockYnabAPI, params);

			expect(readFileSync).toHaveBeenCalledWith(
				"/path/to/transactions.csv",
				"utf-8",
			);
			expect(result.content).toHaveLength(1);
		});

		it("should handle custom CSV format", async () => {
			const csvData =
				"Transaction Date|Dollar Amount|Memo\n01/01/2024|$100.00|Test Payee";

			(
				mockYnabAPI.transactions.getTransactionsByAccount as any
			).mockResolvedValue({
				data: { transactions: mockTransactions },
			});

			// Mock payees endpoint
			(mockYnabAPI as any).payees = {
				getPayees: vi.fn().mockResolvedValue({
					data: { payees: [{ id: "payee-1", name: "Test Payee" }] },
				}),
			};

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: csvData,
				csv_format: {
					date_column: "Transaction Date",
					amount_column: "Dollar Amount",
					description_column: "Memo",
					delimiter: "|",
					has_header: true,
					date_format: "MM/DD/YYYY",
				},
			};

			const result = await handleCompareTransactions(mockYnabAPI, params);

			expect(result.content).toHaveLength(1);
			const response = JSON.parse(result.content[0].text);
			expect(response.summary.bank_transactions_count).toBe(1);
		});

		it("should handle CSV without headers using column indices", async () => {
			const csvData =
				"2024-01-01,100.00,Test Transaction\n2024-01-02,-25.50,Another Transaction";

			(
				mockYnabAPI.transactions.getTransactionsByAccount as any
			).mockResolvedValue({
				data: { transactions: mockTransactions },
			});

			// Mock payees endpoint
			(mockYnabAPI as any).payees = {
				getPayees: vi.fn().mockResolvedValue({
					data: { payees: [{ id: "payee-1", name: "Test Payee" }] },
				}),
			};

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: csvData,
				csv_format: {
					date_column: "0",
					amount_column: "1",
					description_column: "2",
					delimiter: ",",
					has_header: false,
					date_format: "YYYY-MM-DD",
				},
			};

			const result = await handleCompareTransactions(mockYnabAPI, params);

			expect(result.content).toHaveLength(1);
			const response = JSON.parse(result.content[0].text);
			expect(response.summary.bank_transactions_count).toBe(2);
		});

		it("should handle MMM dd, yyyy date format (bank statement format)", async () => {
			const csvData =
				"Date,Amount,Description\nSep 18, 2025,-62.82,Amazon.ca\nSep 17, 2025,-24.63,AMZN Mktp CA";

			(
				mockYnabAPI.transactions.getTransactionsByAccount as any
			).mockResolvedValue({
				data: { transactions: mockTransactions },
			});

			// Mock payees endpoint
			(mockYnabAPI as any).payees = {
				getPayees: vi.fn().mockResolvedValue({
					data: { payees: [{ id: "payee-1", name: "Amazon" }] },
				}),
			};

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: csvData,
				csv_format: {
					date_column: "Date",
					amount_column: "Amount",
					description_column: "Description",
					delimiter: ",",
					has_header: true,
					date_format: "MMM dd, yyyy",
				},
			};

			const result = await handleCompareTransactions(mockYnabAPI, params);

			expect(result.content).toHaveLength(1);
			const response = JSON.parse(result.content[0].text);
			expect(response.summary.bank_transactions_count).toBe(2);
			// Should successfully parse the date format and process the transactions
			expect(response.missing_in_ynab).toHaveLength(2); // No matches with mock transactions
		});

		it("should maintain backward compatibility with modular structure", async () => {
			// This test verifies that the modular refactor maintains exact backward compatibility
			const csvData =
				"Date,Amount,Description\n2024-01-01,100.00,Test Transaction";

			(
				mockYnabAPI.transactions.getTransactionsByAccount as any
			).mockResolvedValue({
				data: { transactions: mockTransactions },
			});

			(mockYnabAPI as any).payees = {
				getPayees: vi.fn().mockResolvedValue({
					data: { payees: [{ id: "payee-1", name: "Test" }] },
				}),
			};

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: csvData,
			};

			const result = await handleCompareTransactions(mockYnabAPI, params);

			// Verify response structure matches original exactly
			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("text");

			const response = JSON.parse(result.content[0].text);
			expect(response).toHaveProperty("summary");
			expect(response).toHaveProperty("matches");
			expect(response).toHaveProperty("missing_in_ynab");
			expect(response).toHaveProperty("missing_in_bank");

			// Verify summary structure
			expect(response.summary).toHaveProperty("bank_transactions_count");
			expect(response.summary).toHaveProperty("ynab_transactions_count");
			expect(response.summary).toHaveProperty("matches_found");
			expect(response.summary).toHaveProperty("missing_in_ynab");
			expect(response.summary).toHaveProperty("missing_in_bank");
			expect(response.summary).toHaveProperty("date_range");
			expect(response.summary).toHaveProperty("parameters");
		});

		it("should handle auto-detection correctly through modular structure", async () => {
			const csvData =
				"Date,Description,Debit,Credit\n2024-01-01,Test Transaction,100.00,\n2024-01-02,Credit Transaction,,50.00";

			(
				mockYnabAPI.transactions.getTransactionsByAccount as any
			).mockResolvedValue({
				data: { transactions: mockTransactions },
			});

			(mockYnabAPI as any).payees = {
				getPayees: vi.fn().mockResolvedValue({
					data: { payees: [] },
				}),
			};

			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: csvData,
				auto_detect_format: true,
			};

			const result = await handleCompareTransactions(mockYnabAPI, params);

			expect(result.content).toHaveLength(1);
			const response = JSON.parse(result.content[0].text);
			expect(response.summary.bank_transactions_count).toBe(2);
			// Should correctly detect debit/credit format and parse both transactions
		});
	});
});
