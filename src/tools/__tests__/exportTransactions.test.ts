import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import { textOf } from "../../__tests__/testUtils.js";
import { resetRuntimeConfig } from "../../server/config.js";
import {
	ExportTransactionsSchema,
	handleExportTransactions,
} from "../exportTransactions.js";

// Exports go to a fresh temp directory per test (YNAB_EXPORT_PATH), and tests read
// back the file the handler reports writing.
let exportDir = "";

function exportedFile(result: { content: unknown[] }): {
	path: string;
	content: string;
} {
	const response = JSON.parse(textOf(result.content[0] as object));
	const path: string = response.full_path;
	return { path, content: readFileSync(path, "utf-8") };
}

// Mock the YNAB API
const mockYnabAPI = {
	transactions: {
		getTransactions: vi.fn(),
		getTransactionsByAccount: vi.fn(),
		getTransactionsByCategory: vi.fn(),
	},
} as unknown as ynab.API;

describe("exportTransactions", () => {
	const mockTransactions = [
		{
			id: "txn-1",
			date: "2024-01-01",
			amount: 1000,
			payee_name: "Test Payee 1",
			cleared: "cleared",
			memo: "Test memo 1",
			approved: true,
			flag_color: null,
			account_id: "acc-1",
			payee_id: "pay-1",
			category_id: "cat-1",
			transfer_account_id: null,
			transfer_transaction_id: null,
			matched_transaction_id: null,
			import_id: null,
			deleted: false,
			account_name: "Test Account",
			category_name: "Test Category",
		},
		{
			id: "txn-2",
			date: "2024-01-02",
			amount: -2000,
			payee_name: "Test Payee 2",
			cleared: "uncleared",
			memo: "Test memo 2",
			approved: false,
			flag_color: "red",
			account_id: "acc-2",
			payee_id: "pay-2",
			category_id: "cat-2",
			transfer_account_id: null,
			transfer_transaction_id: null,
			matched_transaction_id: null,
			import_id: null,
			deleted: false,
			account_name: "Test Account 2",
			category_name: "Test Category 2",
		},
	];

	beforeEach(() => {
		vi.clearAllMocks();
		exportDir = mkdtempSync(join(tmpdir(), "ynab-mcpb-export-"));
		vi.stubEnv("YNAB_EXPORT_PATH", exportDir);
		resetRuntimeConfig();
		// Set up successful API response
		(mockYnabAPI.transactions.getTransactions as any).mockResolvedValue({
			data: { transactions: mockTransactions },
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		resetRuntimeConfig();
		rmSync(exportDir, { recursive: true, force: true });
	});

	describe("ExportTransactionsSchema", () => {
		it("should default minimal to true when not provided", () => {
			const params = ExportTransactionsSchema.parse({
				budget_id: "test-budget",
			});
			const parsed = ExportTransactionsSchema.parse(params);
			expect(parsed.minimal).toBe(true);
		});

		it("should preserve minimal: false when explicitly set", () => {
			const params = { budget_id: "test-budget", minimal: false };
			const parsed = ExportTransactionsSchema.parse(params);
			expect(parsed.minimal).toBe(false);
		});

		it("should preserve minimal: true when explicitly set", () => {
			const params = { budget_id: "test-budget", minimal: true };
			const parsed = ExportTransactionsSchema.parse(params);
			expect(parsed.minimal).toBe(true);
		});
	});

	describe("handleExportTransactions", () => {
		it("passes type in the SDK type argument slot", async () => {
			await handleExportTransactions(
				mockYnabAPI,
				ExportTransactionsSchema.parse({
					budget_id: "test-budget",
					type: "unapproved",
				}),
			);

			expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledWith(
				"test-budget",
				undefined,
				undefined,
				"unapproved",
			);
		});

		it("should export minimal fields by default", async () => {
			const params = ExportTransactionsSchema.parse({
				budget_id: "test-budget",
			});

			const result = await handleExportTransactions(mockYnabAPI, params);

			const { content: fileContent } = exportedFile(result);
			const exportData = JSON.parse(fileContent);

			// Check that export_info shows minimal mode
			expect(exportData.export_info.minimal).toBe(true);

			// Check that transactions only have minimal fields
			expect(exportData.transactions).toHaveLength(2);

			const firstTransaction = exportData.transactions[0];
			expect(Object.keys(firstTransaction)).toEqual([
				"id",
				"date",
				"amount",
				"amount_milliunits",
				"payee_name",
				"cleared",
			]);

			expect(firstTransaction).toEqual({
				id: "txn-1",
				date: "2024-01-01",
				amount: 1,
				amount_milliunits: 1000,
				payee_name: "Test Payee 1",
				cleared: "cleared",
			});

			// Verify response message indicates minimal export
			const responseText = textOf(result.content[0]);
			expect(responseText).toContain("(minimal fields)");
			const responseJson = JSON.parse(responseText);
			expect(responseJson.export_mode).toBe("minimal");
			expect(responseJson.minimal_fields).toBe(
				"id, date, amount, amount_milliunits, payee_name, cleared",
			);
		});

		it("should export all fields when minimal is false", async () => {
			const params = { budget_id: "test-budget", minimal: false };

			const result = await handleExportTransactions(mockYnabAPI, params);

			const { content: fileContent } = exportedFile(result);
			const exportData = JSON.parse(fileContent);

			// Check that export_info shows full mode
			expect(exportData.export_info.minimal).toBe(false);

			// Check that transactions have all fields
			expect(exportData.transactions).toHaveLength(2);

			const firstTransaction = exportData.transactions[0];
			expect(Object.keys(firstTransaction).sort()).toEqual(
				[
					"id",
					"date",
					"amount",
					"amount_milliunits",
					"memo",
					"cleared",
					"approved",
					"flag_color",
					"account_id",
					"payee_id",
					"category_id",
					"transfer_account_id",
					"transfer_transaction_id",
					"matched_transaction_id",
					"import_id",
					"deleted",
					"account_name",
					"payee_name",
					"category_name",
				].sort(),
			);
			expect(firstTransaction.amount).toBe(1);

			// Verify response message indicates full export
			const responseText = textOf(result.content[0]);
			expect(responseText).toContain("(full fields)");
			const responseJson = JSON.parse(responseText);
			expect(responseJson.export_mode).toBe("full");
			expect(responseJson.minimal_fields).toBeNull();
			expect(responseJson.preview_transactions[0].amount).toBe(1);
		});

		it("should reject custom filenames that try to escape the export directory", async () => {
			const result = await handleExportTransactions(
				mockYnabAPI,
				ExportTransactionsSchema.parse({
					budget_id: "test-budget",
					filename: "..\\outside",
				}),
			);

			expect(readdirSync(exportDir)).toHaveLength(0);
			const responseJson = JSON.parse(textOf(result.content[0]));
			expect(responseJson.error.message).toContain(
				"Filename must be a file name",
			);
		});

		it('should include "minimal" in filename by default', async () => {
			const params = ExportTransactionsSchema.parse({
				budget_id: "test-budget",
			});

			const result = await handleExportTransactions(mockYnabAPI, params);

			const { path: filePath } = exportedFile(result);
			expect(filePath).toContain("minimal");
		});

		it('should not include "minimal" in filename when minimal is false', async () => {
			const params = { budget_id: "test-budget", minimal: false };

			const result = await handleExportTransactions(mockYnabAPI, params);

			const { path: filePath } = exportedFile(result);
			expect(filePath).not.toContain("minimal");
		});
	});
});
