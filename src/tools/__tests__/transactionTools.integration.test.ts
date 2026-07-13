import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as ynab from "ynab";
import {
	getTestConfig,
	isAuthError,
	isRateLimitError,
	skipOnRateLimit,
} from "../../__tests__/testUtils.js";
import { listBudgetsCompat } from "../../utils/ynabApiCompat.js";
import {
	handleCreateTransactions,
	handleGetTransaction,
	handleListTransactions,
	handleUpdateTransactions,
} from "../transactionTools.js";

const config = getTestConfig();
const describeIntegration = config.skipE2ETests ? describe.skip : describe;

/** Throw if the tool result is an error response, so skipOnRateLimit can catch it. */
const throwIfError = (result: {
	isError?: boolean;
	content?: Array<{ type: string; text?: string }>;
}) => {
	const text =
		result.content?.[0]?.type === "text"
			? (result.content[0] as { text: string }).text
			: undefined;

	if (result.isError) {
		throw new Error(text ?? "unknown error");
	}

	if (typeof text !== "string" || text.trim().length === 0) return;

	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && "error" in parsed) {
			throw new Error(text);
		}
	} catch (error) {
		if (error instanceof SyntaxError) return;
		throw error;
	}
};

interface TransactionToolResponse {
	results?: Array<{ status?: string; transaction_id?: string }>;
	summary?: { created?: number; duplicates?: number; updated?: number };
	transaction?: { id?: string; memo?: string };
	transactions?: Array<{ id?: string }>;
	preview_transactions?: Array<{ id?: string }>;
}

const parseToolResult = (result: {
	content?: Array<{ text?: string }>;
}): TransactionToolResponse => {
	const raw = result.content?.[0]?.text ?? "{}";
	return JSON.parse(raw) as TransactionToolResponse;
};

describeIntegration("Transaction Tools - Live Contract Smoke", () => {
	let ynabAPI: ynab.API;
	let testBudgetId: string;
	let setupUnavailable = false;
	let createdTransactionId: string | undefined;

	const dedicatedBudgetId = config.testBudgetId?.trim();
	const dedicatedAccountId = config.testAccountId?.trim();
	const hasDedicatedMutationTarget = Boolean(
		dedicatedBudgetId && dedicatedAccountId,
	);

	beforeAll(async () => {
		try {
			ynabAPI = new ynab.API(process.env.YNAB_ACCESS_TOKEN!);
			testBudgetId =
				dedicatedBudgetId ?? (await listBudgetsCompat(ynabAPI)).budgets[0].id;
		} catch (error) {
			if (isRateLimitError(error) || isAuthError(error)) {
				setupUnavailable = true;
				return;
			}
			throw error;
		}
	});

	afterEach(async () => {
		if (!createdTransactionId) return;
		const transactionId = createdTransactionId;
		createdTransactionId = undefined;
		await ynabAPI.transactions.deleteTransaction(testBudgetId, transactionId);
	}, 30000);

	it("lists transactions and reads one transaction from the real API", {
		meta: { tier: "core", domain: "transactions" },
	}, async (ctx) => {
		if (setupUnavailable) {
			ctx.skip();
			return;
		}

		await skipOnRateLimit(async () => {
			const listResult = await handleListTransactions(ynabAPI, {
				budget_id: testBudgetId,
				response_format: "json",
			});
			throwIfError(listResult);
			const listResponse = parseToolResult(listResult);
			const transactions =
				listResponse.transactions ?? listResponse.preview_transactions ?? [];
			expect(Array.isArray(transactions)).toBe(true);

			const firstTransaction = transactions[0];
			if (!firstTransaction?.id) return;

			const getResult = await handleGetTransaction(ynabAPI, {
				budget_id: testBudgetId,
				transaction_id: firstTransaction.id,
				response_format: "json",
			});
			throwIfError(getResult);
			expect(parseToolResult(getResult).transaction?.id).toBe(
				firstTransaction.id,
			);
		}, ctx);
	});

	it("creates, deduplicates, updates, reads, and deletes one transaction", {
		meta: { tier: "domain", domain: "transactions" },
	}, async (ctx) => {
		if (
			setupUnavailable ||
			!hasDedicatedMutationTarget ||
			!dedicatedAccountId
		) {
			ctx.skip();
			return;
		}

		await skipOnRateLimit(async () => {
			const importId = `MCP:LIVE:${randomUUID().slice(0, 27)}`;
			const date = new Date().toISOString().slice(0, 10);
			const originalMemo = `Live contract ${randomUUID().slice(0, 8)}`;
			const updatedMemo = `${originalMemo} updated`;
			const transaction = {
				account_id: dedicatedAccountId,
				amount: -1234,
				date,
				memo: originalMemo,
				import_id: importId,
			};

			const createResult = await handleCreateTransactions(ynabAPI, {
				budget_id: testBudgetId,
				transactions: [transaction],
			});
			throwIfError(createResult);
			const createResponse = parseToolResult(createResult);
			createdTransactionId = createResponse.results?.[0]?.transaction_id;
			expect(createResponse.summary?.created).toBe(1);
			expect(createdTransactionId).toEqual(expect.any(String));

			const duplicateResult = await handleCreateTransactions(ynabAPI, {
				budget_id: testBudgetId,
				transactions: [transaction],
			});
			throwIfError(duplicateResult);
			const duplicateResponse = parseToolResult(duplicateResult);
			expect(duplicateResponse.summary?.duplicates).toBe(1);

			const updateResult = await handleUpdateTransactions(ynabAPI, {
				budget_id: testBudgetId,
				transactions: [{ id: createdTransactionId!, memo: updatedMemo }],
			});
			throwIfError(updateResult);
			expect(parseToolResult(updateResult).summary?.updated).toBe(1);

			const getResult = await handleGetTransaction(ynabAPI, {
				budget_id: testBudgetId,
				transaction_id: createdTransactionId!,
				response_format: "json",
			});
			throwIfError(getResult);
			expect(parseToolResult(getResult).transaction?.memo).toBe(updatedMemo);
		}, ctx);
	});
});
