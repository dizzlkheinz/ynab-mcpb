import { beforeEach, describe, expect, test, vi } from "vitest";
import type * as ynab from "ynab";
import {
	type CompareTransactionsParams,
	CompareTransactionsSchema,
	formatDateOnly,
	handleCompareTransactions,
} from "../../compareTransactions/index.js";

// Create hoisted mock functions
const mockParseBankCSV = vi.hoisted(() => vi.fn());
const mockReadCSVFile = vi.hoisted(() => vi.fn());
const mockAutoDetectCSVFormat = vi.hoisted(() => vi.fn());
const mockFindMatches = vi.hoisted(() => vi.fn());
const mockBuildComparisonResult = vi.hoisted(() => vi.fn());

// Mock all the sub-modules with hoisted mocks wired directly
vi.mock("../../compareTransactions/parser.js", () => ({
	parseBankCSV: mockParseBankCSV,
	readCSVFile: mockReadCSVFile,
	autoDetectCSVFormat: mockAutoDetectCSVFormat,
}));

vi.mock("../../compareTransactions/matcher.js", () => ({
	findMatches: mockFindMatches,
}));

vi.mock("../../compareTransactions/formatter.js", () => ({
	buildComparisonResult: mockBuildComparisonResult,
}));

vi.mock("fs", () => ({
	readFileSync: vi.fn(),
}));

vi.mock("../../../types/index.js", () => ({
	withToolErrorHandling: vi.fn((fn) => fn()),
}));

// Create mock YNAB API
const mockYnabAPI = {
	payees: {
		getPayees: vi.fn(),
	},
	transactions: {
		getTransactionsByAccount: vi.fn(),
	},
} as unknown as ynab.API;

describe("compareTransactions index (main handler)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("CompareTransactionsSchema", () => {
		test("should export schema correctly", () => {
			const validParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test",
			};

			const result = CompareTransactionsSchema.safeParse(validParams);
			expect(result.success).toBe(true);
		});

		test("should apply default values through schema", () => {
			const params = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test",
			};

			const parsed = CompareTransactionsSchema.parse(params);
			expect(parsed.amount_tolerance).toBe(0.01);
			expect(parsed.date_tolerance_days).toBe(5);
			expect(parsed.auto_detect_format).toBe(false);
		});

		test("formatDateOnly does not depend on UTC serialization", () => {
			const toISOString = vi
				.spyOn(Date.prototype, "toISOString")
				.mockImplementation(() => {
					throw new Error(
						"toISOString should not be used for date-only output",
					);
				});

			try {
				expect(formatDateOnly(new Date(2024, 0, 1))).toBe("2024-01-01");
			} finally {
				toISOString.mockRestore();
			}
		});
	});

	describe("handleCompareTransactions orchestration", () => {
		const mockBankTransactions = [
			{
				date: new Date(2024, 0, 1),
				amount: 100000,
				description: "Test Transaction",
				raw_amount: "100.00",
				raw_date: "2024-01-01",
				row_number: 1,
			},
		];

		const mockYnabTransactions = [
			{
				id: "ynab-1",
				date: new Date(2024, 0, 1),
				amount: 100000,
				payee_name: "Test Payee",
				memo: null,
				cleared: "cleared",
				original: {} as any,
			},
		];

		const mockMatches = [
			{
				bank_transaction: mockBankTransactions[0],
				ynab_transaction: mockYnabTransactions[0],
				match_score: 90,
				match_reasons: ["Test match"],
			},
		];

		const mockPayees = [
			{
				id: "payee-1",
				name: "Test Payee",
				transfer_account_id: null,
				deleted: false,
			},
		];

		beforeEach(() => {
			// Reset and configure hoisted mock instances
			mockParseBankCSV.mockReset();
			mockReadCSVFile.mockReset();
			mockAutoDetectCSVFormat.mockReset();
			mockFindMatches.mockReset();
			mockBuildComparisonResult.mockReset();

			// Setup default mock responses
			mockYnabAPI.payees.getPayees = vi.fn().mockResolvedValue({
				data: { payees: mockPayees },
			});

			mockYnabAPI.transactions.getTransactionsByAccount = vi
				.fn()
				.mockResolvedValue({
					data: {
						transactions: [
							{
								id: "ynab-1",
								date: "2024-01-01",
								amount: 100000,
								payee_name: "Test Payee",
								memo: null,
								cleared: "cleared",
								deleted: false,
							},
						],
					},
				});

			mockParseBankCSV.mockReturnValue(mockBankTransactions);
			mockFindMatches.mockReturnValue({
				matches: mockMatches,
				unmatched_bank: [],
				unmatched_ynab: [],
			});
			mockBuildComparisonResult.mockReturnValue({
				content: [{ type: "text", text: "Mock result" }],
			});
		});

		test("should orchestrate CSV data processing correctly", async () => {
			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
			};

			await handleCompareTransactions(mockYnabAPI, params);

			// Verify that parser was called with CSV data
			expect(mockParseBankCSV).toHaveBeenCalledWith(
				params.csv_data,
				expect.objectContaining({
					date_column: "Date",
					amount_column: "Amount",
					description_column: "Description",
					has_header: true,
				}),
				{ debug: false },
			);
		});

		test("should orchestrate CSV file processing correctly", async () => {
			const csvContent =
				"Date,Amount,Description\n2024-01-01,100.00,Test Transaction";
			mockReadCSVFile.mockReturnValue(csvContent);

			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_file_path: "/path/to/file.csv",
			};

			await handleCompareTransactions(mockYnabAPI, params);

			// Verify file reading and parsing
			expect(mockReadCSVFile).toHaveBeenCalledWith("/path/to/file.csv");
			expect(mockParseBankCSV).toHaveBeenCalledWith(
				csvContent,
				expect.any(Object),
				{
					debug: false,
				},
			);
		});

		test("should handle auto-detection correctly", async () => {
			const autoDetectedFormat = {
				date_column: 0,
				amount_column: 1,
				description_column: 2,
				has_header: false,
				delimiter: ",",
				date_format: "YYYY-MM-DD",
			};
			mockAutoDetectCSVFormat.mockReturnValue(autoDetectedFormat);

			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "2024-01-01,100.00,Test Transaction",
				auto_detect_format: true,
			};

			await handleCompareTransactions(mockYnabAPI, params);

			// Verify auto-detection was called and used
			expect(mockAutoDetectCSVFormat).toHaveBeenCalledWith(params.csv_data);
			expect(mockParseBankCSV).toHaveBeenCalledWith(
				params.csv_data,
				autoDetectedFormat,
				{
					debug: false,
				},
			);
		});

		test("should call YNAB API correctly", async () => {
			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
			};

			await handleCompareTransactions(mockYnabAPI, params);

			// Verify YNAB API calls
			expect(mockYnabAPI.payees.getPayees).toHaveBeenCalledWith("budget-123");
			expect(
				mockYnabAPI.transactions.getTransactionsByAccount,
			).toHaveBeenCalledWith(
				"budget-123",
				"account-456",
				expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // ISO date format
			);
		});

		test("should calculate date range correctly", async () => {
			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n01/15/2024,100.00,Test Transaction",
				date_tolerance_days: 3,
			};

			await handleCompareTransactions(mockYnabAPI, params);

			// Verify YNAB API was called with extended date range
			// The exact date will depend on date parsing logic - verify the call was made
			expect(
				mockYnabAPI.transactions.getTransactionsByAccount,
			).toHaveBeenCalledWith(
				"budget-123",
				"account-456",
				expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // Any valid ISO date format
			);
		});

		test("uses local date-only formatting for the YNAB sinceDate", async () => {
			mockParseBankCSV.mockReturnValue([
				{
					...mockBankTransactions[0],
					date: new Date(2024, 0, 1),
				},
			]);
			const toISOString = vi
				.spyOn(Date.prototype, "toISOString")
				.mockImplementation(() => {
					throw new Error("toISOString should not be used for sinceDate");
				});
			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
				date_tolerance_days: 0,
			};

			try {
				await handleCompareTransactions(mockYnabAPI, params);
			} finally {
				toISOString.mockRestore();
			}

			expect(
				mockYnabAPI.transactions.getTransactionsByAccount,
			).toHaveBeenCalledWith("budget-123", "account-456", "2024-01-01");
		});

		test("should pass filtered transactions to matcher", async () => {
			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
				amount_tolerance: 0.02,
				date_tolerance_days: 7,
			};

			await handleCompareTransactions(mockYnabAPI, params);

			// Verify matcher was called with correct parameters
			expect(mockFindMatches).toHaveBeenCalledWith(
				mockBankTransactions, // Parsed bank transactions
				expect.arrayContaining([
					expect.objectContaining({
						id: "ynab-1",
						amount: 100000,
					}),
				]), // Filtered YNAB transactions
				0.02, // Amount tolerance
				7, // Date tolerance
				false, // Enable chronology bonus (default)
			);
		});

		test("should apply statement window filtering", async () => {
			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
				statement_start_date: "2024-01-01",
				statement_date: "2024-01-31",
			};

			await handleCompareTransactions(mockYnabAPI, params);

			// The matcher should be called (statement window filtering happens before this)
			expect(mockFindMatches).toHaveBeenCalled();

			// Verify that the transactions passed to matcher would be within the window
			const [bankTxns, ynabTxns] = mockFindMatches.mock.calls[0];
			expect(bankTxns).toEqual(mockBankTransactions);
			expect(ynabTxns).toHaveLength(1); // Should include YNAB transaction within window
		});

		test("should build final result correctly", async () => {
			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
			};

			const result = await handleCompareTransactions(mockYnabAPI, params);

			// Verify formatter was called with correct structure
			expect(mockBuildComparisonResult).toHaveBeenCalledWith(
				expect.objectContaining({
					matches: mockMatches,
					unmatched_bank: [],
					unmatched_ynab: [],
				}),
				mockBankTransactions,
				expect.any(Array), // Filtered YNAB transactions
				mockPayees,
				expect.objectContaining({
					amount_tolerance: 0.01,
					date_tolerance_days: 5,
				}),
				expect.objectContaining({
					start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
					end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
				}),
			);

			// Verify return value
			expect(result).toEqual({
				content: [{ type: "text", text: "Mock result" }],
			});
		});

		test("should handle empty bank transactions correctly", async () => {
			mockParseBankCSV.mockReturnValue([]);

			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description", // Header only
			};

			await expect(
				handleCompareTransactions(mockYnabAPI, params),
			).rejects.toThrow("No valid transactions found in CSV data");
		});

		test("should handle auto-detection errors gracefully", async () => {
			mockAutoDetectCSVFormat.mockImplementation(() => {
				throw new Error("Auto-detection failed");
			});

			const params: CompareTransactionsParams = {
				budget_id: "budget-123",
				account_id: "account-456",
				csv_data: "Date,Amount,Description\n2024-01-01,100.00,Test Transaction",
				auto_detect_format: true,
			};

			// Should not throw, should fall back to provided format
			await handleCompareTransactions(mockYnabAPI, params);

			// Should have tried auto-detection but used fallback
			expect(mockAutoDetectCSVFormat).toHaveBeenCalled();
			expect(mockParseBankCSV).toHaveBeenCalledWith(
				params.csv_data,
				expect.objectContaining({
					date_column: "Date", // Default format
				}),
				{ debug: false },
			);
		});
	});
});
