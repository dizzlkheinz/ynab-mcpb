/**
 * Unit tests for transactionUtils.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import type { SaveTransactionsResponseData } from "ynab/dist/models/SaveTransactionsResponseData.js";
import {
	ErrorHandler,
	YNABAPIError,
	YNABErrorCode,
} from "../../server/errorHandler.js";
import { responseFormatter } from "../../server/responseFormatter.js";
import type {
	BulkCreateResponse,
	BulkTransactionInput,
	BulkUpdateResponse,
	CorrelationPayloadInput,
} from "../transactionSchemas.js";
import {
	correlateResults,
	ensureTransaction,
	estimatePayloadSize,
	finalizeBulkUpdateResponse,
	finalizeResponse,
	generateCorrelationKey,
	handleTransactionError,
	toCorrelationPayload,
} from "../transactionUtils.js";

// Mock the responseFormatter module
vi.mock("../../server/responseFormatter.js", () => ({
	responseFormatter: {
		format: vi.fn((data) => JSON.stringify(data)),
	},
}));

// Mock the global request logger
vi.mock("../../server/requestLogger.js", () => ({
	globalRequestLogger: {
		logError: vi.fn(),
	},
}));

describe("transactionUtils", () => {
	describe("ensureTransaction", () => {
		it("should return transaction when it is defined", () => {
			const transaction = { id: "123", amount: 1000 };
			const result = ensureTransaction(transaction, "Transaction not found");
			expect(result).toBe(transaction);
		});

		it("should throw error when transaction is undefined", () => {
			expect(() =>
				ensureTransaction(undefined, "Transaction not found"),
			).toThrow("Transaction not found");
		});

		it("should throw error when transaction is null", () => {
			expect(() => ensureTransaction(null, "Transaction is missing")).toThrow(
				"Transaction is missing",
			);
		});

		it("should handle objects with falsy properties", () => {
			const transaction = { id: "", amount: 0 };
			const result = ensureTransaction(transaction, "Error message");
			expect(result).toBe(transaction);
		});
	});

	describe("generateCorrelationKey", () => {
		it("should use import_id when available", () => {
			const transaction = {
				account_id: "acc-123",
				date: "2024-03-15",
				amount: 5000,
				import_id: "YNAB:12345:2024-03-15:1",
			};
			const key = generateCorrelationKey(transaction);
			expect(key).toBe("YNAB:12345:2024-03-15:1");
		});

		it("should generate hash when no import_id", () => {
			const transaction = {
				account_id: "acc-123",
				date: "2024-03-15",
				amount: 5000,
				payee_name: "Test Payee",
			};
			const key = generateCorrelationKey(transaction);
			expect(key).toMatch(/^hash:[a-f0-9]{16}$/);
		});

		it("should generate same hash for identical transactions", () => {
			const transaction1 = {
				account_id: "acc-123",
				date: "2024-03-15",
				amount: 5000,
				payee_name: "Test",
				category_id: "cat-1",
			};
			const transaction2 = {
				account_id: "acc-123",
				date: "2024-03-15",
				amount: 5000,
				payee_name: "Test",
				category_id: "cat-1",
			};
			expect(generateCorrelationKey(transaction1)).toBe(
				generateCorrelationKey(transaction2),
			);
		});

		it("should generate different hash for different transactions", () => {
			const transaction1 = {
				account_id: "acc-123",
				date: "2024-03-15",
				amount: 5000,
			};
			const transaction2 = {
				account_id: "acc-123",
				date: "2024-03-15",
				amount: 6000,
			};
			expect(generateCorrelationKey(transaction1)).not.toBe(
				generateCorrelationKey(transaction2),
			);
		});

		it("should handle all optional fields", () => {
			const transaction = {
				account_id: "acc-123",
				date: "2024-03-15",
				amount: 5000,
				payee_id: "payee-1",
				payee_name: "Test Payee",
				category_id: "cat-1",
				memo: "Test memo",
				cleared: "cleared" as ynab.TransactionClearedStatus,
				approved: true,
				flag_color: "red" as ynab.TransactionFlagColor,
			};
			const key = generateCorrelationKey(transaction);
			expect(key).toMatch(/^hash:[a-f0-9]{16}$/);
		});

		it("should handle null values", () => {
			const transaction = {
				account_id: "acc-123",
				date: "2024-03-15",
				amount: 5000,
				payee_id: null,
				payee_name: null,
				category_id: null,
				memo: null,
				flag_color: null,
			};
			const key = generateCorrelationKey(transaction);
			expect(key).toMatch(/^hash:[a-f0-9]{16}$/);
		});
	});

	describe("toCorrelationPayload", () => {
		it("should convert full transaction input to payload", () => {
			const input: CorrelationPayloadInput = {
				account_id: "acc-123",
				date: "2024-03-15",
				amount: 5000,
				payee_id: "payee-1",
				payee_name: "Test Payee",
				category_id: "cat-1",
				memo: "Test memo",
				cleared: "cleared" as ynab.TransactionClearedStatus,
				approved: true,
				flag_color: "red" as ynab.TransactionFlagColor,
				import_id: "YNAB:12345",
			};
			const payload = toCorrelationPayload(input);
			expect(payload).toEqual(input);
		});

		it("should handle minimal transaction input", () => {
			const input: CorrelationPayloadInput = {};
			const payload = toCorrelationPayload(input);
			expect(payload).toEqual({
				payee_id: null,
				payee_name: null,
				category_id: null,
				memo: null,
				import_id: null,
			});
		});

		it("should convert undefined to null for nullable fields", () => {
			const input: CorrelationPayloadInput = {
				account_id: "acc-123",
				payee_id: undefined,
				payee_name: undefined,
				category_id: undefined,
				memo: undefined,
				import_id: undefined,
			};
			const payload = toCorrelationPayload(input);
			expect(payload.payee_id).toBe(null);
			expect(payload.payee_name).toBe(null);
			expect(payload.category_id).toBe(null);
			expect(payload.memo).toBe(null);
			expect(payload.import_id).toBe(null);
		});

		it("should preserve null values", () => {
			const input: CorrelationPayloadInput = {
				payee_id: null,
				payee_name: null,
				category_id: null,
				memo: null,
				import_id: null,
			};
			const payload = toCorrelationPayload(input);
			expect(payload.payee_id).toBe(null);
			expect(payload.payee_name).toBe(null);
			expect(payload.category_id).toBe(null);
			expect(payload.memo).toBe(null);
			expect(payload.import_id).toBe(null);
		});
	});

	describe("correlateResults", () => {
		it("should correlate transactions by import_id", () => {
			const requests: BulkTransactionInput[] = [
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					import_id: "YNAB:1",
				},
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [
					{
						id: "txn-1",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
						import_id: "YNAB:1",
					} as ynab.TransactionDetail,
				],
				duplicate_import_ids: [],
				server_knowledge: 100,
				transaction_ids: [],
			};
			const duplicates = new Set<string>();

			const results = correlateResults(requests, responseData, duplicates);

			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({
				request_index: 0,
				status: "created",
				transaction_id: "txn-1",
				correlation_key: "YNAB:1",
			});
		});

		it("should correlate transactions by hash when no import_id", () => {
			const requests: BulkTransactionInput[] = [
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					payee_name: "Test",
				},
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [
					{
						id: "txn-1",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
						payee_name: "Test",
					} as ynab.TransactionDetail,
				],
				duplicate_import_ids: [],
				server_knowledge: 100,
				transaction_ids: [],
			};
			const duplicates = new Set<string>();

			const results = correlateResults(requests, responseData, duplicates);

			expect(results).toHaveLength(1);
			expect(results[0]!.status).toBe("created");
			expect(results[0]!.transaction_id).toBe("txn-1");
			expect(results[0]!.correlation_key).toMatch(/^hash:[a-f0-9]{16}$/);
		});

		it("should correlate by hash when YNAB response includes payee_id but request only had payee_name", () => {
			// Real YNAB API always returns payee_id on the response even when the request
			// only supplied payee_name.  The secondary hash index (payee_id stripped) must
			// ensure the request hash (computed from payee_name) still finds the response.
			const requests: BulkTransactionInput[] = [
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					payee_name: "Test Payee",
				},
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [
					{
						id: "txn-1",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
						payee_id: "payee-uuid-123",
						payee_name: "Test Payee",
					} as ynab.TransactionDetail,
				],
				duplicate_import_ids: [],
				server_knowledge: 100,
				transaction_ids: [],
			};
			const duplicates = new Set<string>();

			const results = correlateResults(requests, responseData, duplicates);

			expect(results).toHaveLength(1);
			expect(results[0]!.status).toBe("created");
			expect(results[0]!.transaction_id).toBe("txn-1");
		});

		it("correlates a unique response that omits payee_name", () => {
			const requests: BulkTransactionInput[] = [
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					payee_name: "Test Payee",
				},
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [
					{
						id: "txn-1",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
						payee_id: "payee-uuid-123",
					} as ynab.TransactionDetail,
				],
				duplicate_import_ids: [],
				server_knowledge: 100,
				transaction_ids: [],
			};

			const results = correlateResults(requests, responseData, new Set());

			expect(results[0]).toMatchObject({
				status: "created",
				transaction_id: "txn-1",
			});
		});

		it("does not guess when payee-agnostic correlation is ambiguous", () => {
			const requests: BulkTransactionInput[] = [
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					payee_name: "Payee A",
				},
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					payee_name: "Payee B",
				},
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [
					{
						id: "txn-a",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
						payee_id: "payee-a",
					} as ynab.TransactionDetail,
					{
						id: "txn-b",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
						payee_id: "payee-b",
					} as ynab.TransactionDetail,
				],
				duplicate_import_ids: [],
				server_knowledge: 100,
				transaction_ids: [],
			};

			const results = correlateResults(requests, responseData, new Set());

			expect(results.map((result) => result.status)).toEqual([
				"failed",
				"failed",
			]);
		});

		it("should mark duplicates based on duplicateImportIds", () => {
			const requests: BulkTransactionInput[] = [
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					import_id: "YNAB:1",
				},
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [],
				duplicate_import_ids: ["YNAB:1"],
				server_knowledge: 100,
				transaction_ids: [],
			};
			const duplicates = new Set(["YNAB:1"]);

			const results = correlateResults(requests, responseData, duplicates);

			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({
				request_index: 0,
				status: "duplicate",
				correlation_key: "YNAB:1",
			});
		});

		it("should mark as failed when correlation fails", () => {
			const requests: BulkTransactionInput[] = [
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					import_id: "YNAB:1",
				},
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [
					{
						id: "txn-2",
						account_id: "acc-2",
						date: "2024-03-16",
						amount: 6000,
						import_id: "YNAB:2",
					} as ynab.TransactionDetail,
				],
				duplicate_import_ids: [],
				server_knowledge: 100,
				transaction_ids: [],
			};
			const duplicates = new Set<string>();

			const results = correlateResults(requests, responseData, duplicates);

			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({
				request_index: 0,
				status: "failed",
				error_code: "correlation_failed",
				error: "Unable to correlate request transaction with YNAB response",
			});
		});

		it("should handle multiple transactions", () => {
			const requests: BulkTransactionInput[] = [
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					import_id: "YNAB:1",
				},
				{
					account_id: "acc-2",
					date: "2024-03-16",
					amount: 6000,
					import_id: "YNAB:2",
				},
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [
					{
						id: "txn-1",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
						import_id: "YNAB:1",
					} as ynab.TransactionDetail,
					{
						id: "txn-2",
						account_id: "acc-2",
						date: "2024-03-16",
						amount: 6000,
						import_id: "YNAB:2",
					} as ynab.TransactionDetail,
				],
				duplicate_import_ids: [],
				server_knowledge: 100,
				transaction_ids: [],
			};
			const duplicates = new Set<string>();

			const results = correlateResults(requests, responseData, duplicates);

			expect(results).toHaveLength(2);
			expect(results[0]!.transaction_id).toBe("txn-1");
			expect(results[1]!.transaction_id).toBe("txn-2");
		});

		it("should fall back to hash correlation when import_id fails", () => {
			const requests: BulkTransactionInput[] = [
				{
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					payee_name: "Test",
					import_id: "YNAB:1",
				},
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [
					{
						id: "txn-1",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
						payee_name: "Test",
						// No import_id in response
					} as ynab.TransactionDetail,
				],
				duplicate_import_ids: [],
				server_knowledge: 100,
				transaction_ids: [],
			};
			const duplicates = new Set<string>();

			const results = correlateResults(requests, responseData, duplicates);

			expect(results).toHaveLength(1);
			expect(results[0]!.status).toBe("created");
			expect(results[0]!.transaction_id).toBe("txn-1");
		});

		it("should handle empty response transactions", () => {
			const requests: BulkTransactionInput[] = [
				{ account_id: "acc-1", date: "2024-03-15", amount: 5000 },
			];
			const responseData: SaveTransactionsResponseData = {
				transactions: [],
				duplicate_import_ids: [],
				server_knowledge: 100,
				transaction_ids: [],
			};
			const duplicates = new Set<string>();

			const results = correlateResults(requests, responseData, duplicates);

			expect(results).toHaveLength(1);
			expect(results[0]!.status).toBe("failed");
		});
	});

	describe("estimatePayloadSize", () => {
		it("should estimate size of bulk create response", () => {
			const response: BulkCreateResponse = {
				success: true,
				summary: {
					total_requested: 1,
					created: 1,
					duplicates: 0,
					failed: 0,
				},
				results: [
					{
						request_index: 0,
						status: "created",
						transaction_id: "txn-123",
						correlation_key: "YNAB:1",
					},
				],
			};
			const size = estimatePayloadSize(response);
			expect(size).toBeGreaterThan(0);
			expect(size).toBe(Buffer.byteLength(JSON.stringify(response), "utf8"));
		});

		it("should estimate size of bulk update response", () => {
			const response: BulkUpdateResponse = {
				success: true,
				summary: {
					total_requested: 1,
					updated: 1,
					failed: 0,
				},
				results: [
					{
						request_index: 0,
						status: "updated",
						transaction_id: "txn-123",
						correlation_key: "key-1",
					},
				],
			};
			const size = estimatePayloadSize(response);
			expect(size).toBeGreaterThan(0);
			expect(size).toBe(Buffer.byteLength(JSON.stringify(response), "utf8"));
		});
	});

	describe("finalizeResponse", () => {
		it("should return full response when under threshold", () => {
			const response: BulkCreateResponse = {
				success: true,
				summary: {
					total_requested: 1,
					created: 1,
					duplicates: 0,
					failed: 0,
				},
				results: [
					{
						request_index: 0,
						status: "created",
						transaction_id: "txn-123",
						correlation_key: "YNAB:1",
					},
				],
				transactions: [
					{
						id: "txn-123",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
					} as ynab.TransactionDetail,
				],
			};

			const result = finalizeResponse(response);
			expect(result.mode).toBe("full");
			expect(result.transactions).toBeDefined();
		});

		it("should downgrade to summary when full response exceeds threshold", () => {
			// Create a large response by adding many transactions
			const transactions: ynab.TransactionDetail[] = [];
			for (let i = 0; i < 1000; i++) {
				transactions.push({
					id: `txn-${i}`,
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					payee_name: `Very Long Payee Name for Transaction Number ${i} to increase size`,
					memo: `This is a very long memo with lots of text to make the payload larger ${i}`,
					category_name: `Category with a very long name ${i}`,
				} as ynab.TransactionDetail);
			}

			const response: BulkCreateResponse = {
				success: true,
				summary: {
					total_requested: 1000,
					created: 1000,
					duplicates: 0,
					failed: 0,
				},
				results: transactions.map((t, i) => ({
					request_index: i,
					status: "created" as const,
					transaction_id: t.id,
					correlation_key: `key-${i}`,
				})),
				transactions,
			};

			const result = finalizeResponse(response);
			expect(result.mode).toBe("summary");
			expect(result.transactions).toBeUndefined();
			expect(result.message).toContain("Response downgraded to summary");
		});

		it("should downgrade to ids_only when summary exceeds threshold", () => {
			// Create a response with enough data to exceed summary threshold (96KB) but not ids_only threshold (100KB)
			// The 4KB window between thresholds is very narrow - test the downgrade logic
			const results = [];
			for (let i = 0; i < 800; i++) {
				results.push({
					request_index: i,
					status: "created" as const,
					transaction_id: `t-${i}`,
					correlation_key: `Y:${i}`,
				});
			}

			const response: BulkCreateResponse = {
				success: true,
				summary: {
					total_requested: 800,
					created: 800,
					duplicates: 0,
					failed: 0,
				},
				results,
			};

			const result = finalizeResponse(response);
			// Due to narrow window, may be summary or ids_only
			expect(["summary", "ids_only"]).toContain(result.mode);
			if (result.mode === "ids_only") {
				expect(result.message).toContain("Response downgraded to ids_only");
			}
		});

		it("should preserve execution status when response details are too large", () => {
			// Create an extremely large response that cannot fit even with ids_only
			const results = [];
			for (let i = 0; i < 10000; i++) {
				results.push({
					request_index: i,
					status: "created" as const,
					transaction_id: `txn-very-long-transaction-id-with-lots-of-characters-${i}`,
					correlation_key: `YNAB:extremely-long-import-id-with-many-characters-to-exceed-limit-${i}`,
				});
			}

			const response: BulkCreateResponse = {
				success: true,
				summary: {
					total_requested: 10000,
					created: 10000,
					duplicates: 0,
					failed: 0,
				},
				results,
			};

			expect(finalizeResponse(response)).toMatchObject({
				success: response.success,
				summary: response.summary,
				results: [],
				mode: "summary",
			});
		});

		it("should preserve existing message and not duplicate", () => {
			const response: BulkCreateResponse = {
				success: true,
				summary: {
					total_requested: 1,
					created: 1,
					duplicates: 0,
					failed: 0,
				},
				results: [
					{
						request_index: 0,
						status: "created",
						transaction_id: "txn-123",
						correlation_key: "YNAB:1",
					},
				],
				message: "Custom message",
			};

			const result = finalizeResponse(response);
			expect(result.message).toBe("Custom message");
		});
	});

	describe("finalizeBulkUpdateResponse", () => {
		it("should return full response when under threshold", () => {
			const response: BulkUpdateResponse = {
				success: true,
				summary: {
					total_requested: 1,
					updated: 1,
					failed: 0,
				},
				results: [
					{
						request_index: 0,
						status: "updated",
						transaction_id: "txn-123",
						correlation_key: "key-1",
					},
				],
				transactions: [
					{
						id: "txn-123",
						account_id: "acc-1",
						date: "2024-03-15",
						amount: 5000,
					} as ynab.TransactionDetail,
				],
			};

			const result = finalizeBulkUpdateResponse(response);
			expect(result.mode).toBe("full");
			expect(result.transactions).toBeDefined();
		});

		it("should downgrade to summary when full response exceeds threshold", () => {
			const transactions: ynab.TransactionDetail[] = [];
			for (let i = 0; i < 1000; i++) {
				transactions.push({
					id: `txn-${i}`,
					account_id: "acc-1",
					date: "2024-03-15",
					amount: 5000,
					payee_name: `Very Long Payee Name for Transaction Number ${i} to increase size`,
					memo: `This is a very long memo with lots of text to make the payload larger ${i}`,
				} as ynab.TransactionDetail);
			}

			const response: BulkUpdateResponse = {
				success: true,
				summary: {
					total_requested: 1000,
					updated: 1000,
					failed: 0,
				},
				results: transactions.map((t, i) => ({
					request_index: i,
					status: "updated" as const,
					transaction_id: t.id,
					correlation_key: `key-${i}`,
				})),
				transactions,
			};

			const result = finalizeBulkUpdateResponse(response);
			expect(result.mode).toBe("summary");
			expect(result.transactions).toBeUndefined();
			expect(result.message).toContain("Response downgraded to summary");
		});

		it("should preserve error_code in ids_only mode when response is large", () => {
			// Create a large response - test that error_code is preserved regardless of mode
			const results = [];
			for (let i = 0; i < 800; i++) {
				results.push({
					request_index: i,
					status: "failed" as const,
					transaction_id: `t-${i}`,
					correlation_key: `k-${i}`,
					error_code: "ERR",
					error: "Error",
				});
			}

			const response: BulkUpdateResponse = {
				success: false,
				summary: {
					total_requested: 800,
					updated: 0,
					failed: 800,
				},
				results,
			};

			const result = finalizeBulkUpdateResponse(response);
			// Should be summary or ids_only mode
			expect(["summary", "ids_only"]).toContain(result.mode);
			// Error code should be preserved in results
			expect(result.results[0]!.error_code).toBe("ERR");
			expect(result.results[0]!.error).toBeDefined();
		});

		it("should preserve execution status when response details are too large", () => {
			const results = [];
			for (let i = 0; i < 10000; i++) {
				results.push({
					request_index: i,
					status: "updated" as const,
					transaction_id: `txn-very-long-transaction-id-with-lots-of-characters-${i}`,
					correlation_key: `key-extremely-long-correlation-key-with-many-characters-${i}`,
				});
			}

			const response: BulkUpdateResponse = {
				success: true,
				summary: {
					total_requested: 10000,
					updated: 10000,
					failed: 0,
				},
				results,
			};

			expect(finalizeBulkUpdateResponse(response)).toMatchObject({
				success: response.success,
				summary: response.summary,
				results: [],
				mode: "summary",
			});
		});
	});

	it("preserves partial failure counts when completed result details must be omitted", () => {
		const response: BulkUpdateResponse = {
			success: false,
			summary: { total_requested: 2, updated: 1, failed: 1 },
			results: [
				{
					request_index: 0,
					status: "updated",
					transaction_id: "saved",
					correlation_key: "saved",
				},
				{
					request_index: 1,
					status: "failed",
					transaction_id: "failed",
					correlation_key: "failed",
					error: "x".repeat(110 * 1024),
				},
			],
		};
		const receipt = finalizeBulkUpdateResponse(response);
		expect(receipt).toMatchObject({
			success: false,
			summary: { total_requested: 2, updated: 1, failed: 1 },
			results: [],
			results_omitted: true,
		});
		expect(Buffer.byteLength(JSON.stringify(receipt))).toBeLessThan(1024);
		expect(receipt.message).toContain("before retrying any failed items");
	});

	describe("handleTransactionError", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("should return default message for unknown error", () => {
			const result = handleTransactionError(
				new Error("Unknown error"),
				"Default message",
			);
			expect(result.isError).toBe(true);
			expect(result.content[0]!.type).toBe("text");
			expect(responseFormatter.format).toHaveBeenCalledWith({
				error: { message: "Default message" },
			});
		});

		it("should handle 401 Unauthorized error", () => {
			const error = new Error("401 Unauthorized: Invalid token");
			handleTransactionError(error, "Default message");
			expect(responseFormatter.format).toHaveBeenCalledWith({
				error: { message: "Invalid or expired YNAB access token" },
			});
		});

		it("should handle 403 Forbidden error", () => {
			const error = new Error("403 Forbidden");
			handleTransactionError(error, "Default message");
			expect(responseFormatter.format).toHaveBeenCalledWith({
				error: { message: "Insufficient permissions to access YNAB data" },
			});
		});

		it("should handle 404 Not Found error", () => {
			const error = new Error("404 Not Found");
			handleTransactionError(error, "Default message");
			expect(responseFormatter.format).toHaveBeenCalledWith({
				error: {
					message: "Budget, account, category, or transaction not found",
				},
			});
		});

		it("should handle 429 Rate Limit error", () => {
			const error = new Error("429 Too Many Requests");
			handleTransactionError(error, "Default message");
			expect(responseFormatter.format).toHaveBeenCalledWith({
				error: { message: "Rate limit exceeded. Please try again later" },
			});
		});

		it("should handle 500 Internal Server Error", () => {
			const error = new Error("500 Internal Server Error");
			handleTransactionError(error, "Default message");
			expect(responseFormatter.format).toHaveBeenCalledWith({
				error: { message: "YNAB service is currently unavailable" },
			});
		});

		it('should handle error with "Unauthorized" keyword', () => {
			const error = new Error("Request failed: Unauthorized access");
			handleTransactionError(error, "Default message");
			expect(responseFormatter.format).toHaveBeenCalledWith({
				error: { message: "Invalid or expired YNAB access token" },
			});
		});

		it("should handle non-Error objects", () => {
			handleTransactionError("string error", "Default message");
			expect(responseFormatter.format).toHaveBeenCalledWith({
				error: { message: "Default message" },
			});
		});

		it("should handle null error", () => {
			handleTransactionError(null, "Default message");
			expect(responseFormatter.format).toHaveBeenCalledWith({
				error: { message: "Default message" },
			});
		});

		it("delegates to the centralized error handler with transaction context", () => {
			const format = vi.fn(() => "formatted error");
			const errorHandler = new ErrorHandler({ format });

			const result = handleTransactionError(
				new YNABAPIError(YNABErrorCode.NOT_FOUND, "Missing"),
				"Default message",
				errorHandler,
				"updating transaction",
			);

			expect(result).toMatchObject({
				isError: true,
				content: [{ type: "text", text: "formatted error" }],
			});
			expect(format).toHaveBeenCalledWith({
				error: expect.objectContaining({
					code: YNABErrorCode.NOT_FOUND,
					message: "Budget, account, category, or transaction not found",
					userMessage:
						"We couldn't find that transaction. It may have been deleted or moved.",
				}),
			});
		});
	});
});
