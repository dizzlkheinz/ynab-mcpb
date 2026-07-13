import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as ynab from "ynab";
import {
	getTestConfig,
	skipOnRateLimit,
} from "../../../__tests__/testUtils.js";
import { type AccountSnapshot, executeReconciliation } from "../executor.js";
import type { ReconcileAccountRequest } from "../index.js";
import type { ReconciliationAnalysis } from "../types.js";

const config = getTestConfig();
const describeIntegration = config.skipE2ETests ? describe.skip : describe;

describeIntegration("Reconciliation Executor - Live Contract Smoke", () => {
	let ynabAPI: ynab.API;
	const createdTransactionIds: string[] = [];
	const budgetId = config.testBudgetId?.trim();
	const accountId = config.testAccountId?.trim();

	beforeAll(() => {
		ynabAPI = new ynab.API(process.env.YNAB_ACCESS_TOKEN!);
	});

	afterEach(async () => {
		if (!budgetId) return;
		while (createdTransactionIds.length > 0) {
			const transactionId = createdTransactionIds.pop();
			if (!transactionId) continue;
			await ynabAPI.transactions.deleteTransaction(budgetId, transactionId);
		}
	}, 30000);

	it(
		"creates two transactions without import_id through the real bulk API",
		{
			meta: { tier: "domain", domain: "reconciliation" },
		},
		async (ctx) => {
			if (!budgetId || !accountId) {
				ctx.skip();
				return;
			}

			await skipOnRateLimit(async () => {
				const accountSnapshot = await fetchAccountSnapshot(
					ynabAPI,
					budgetId,
					accountId,
				);
				const analysis = buildIntegrationAnalysis(accountSnapshot, 2, 9);
				const params = buildIntegrationParams(
					accountId,
					budgetId,
					analysis.summary.target_statement_balance,
				);

				const result = await executeReconciliation({
					ynabAPI,
					analysis,
					params,
					budgetId,
					accountId,
					initialAccount: accountSnapshot,
					currencyCode: "USD",
				});

				for (const action of result.actions_taken) {
					if (action.type !== "create_transaction") continue;
					const transaction = action.transaction as { id?: string } | null;
					if (transaction?.id) createdTransactionIds.push(transaction.id);
				}

				expect(result.summary.transactions_created).toBe(2);
				expect(result.bulk_operation_details?.bulk_successes).toBe(1);
				expect(result.bulk_operation_details?.chunks_processed).toBe(1);
				expect(result.bulk_operation_details?.duplicates_detected).toBe(0);
			}, ctx);
		},
		30000,
	);
});

async function fetchAccountSnapshot(
	api: ynab.API,
	budgetId: string,
	accountId: string,
): Promise<AccountSnapshot> {
	const response = await api.accounts.getAccountById(budgetId, accountId);
	const account = response.data.account;
	return {
		balance: account.balance,
		cleared_balance: account.cleared_balance ?? account.balance,
		uncleared_balance: account.uncleared_balance ?? 0,
	};
}

function buildIntegrationAnalysis(
	snapshot: AccountSnapshot,
	count: number,
	transactionAmount: number,
): ReconciliationAnalysis {
	const clearedDollars = snapshot.cleared_balance / 1000;
	const totalDelta = transactionAmount * count;
	const statementBalance = clearedDollars + totalDelta;
	const dayMs = 24 * 60 * 60 * 1000;
	const baseDate = Date.now() - (count + 1) * dayMs;
	const runNonce = Date.now().toString();

	return {
		success: true,
		phase: "analysis",
		summary: {
			statement_date_range: "Integration test",
			bank_transactions_count: count,
			ynab_transactions_count: 0,
			auto_matched: 0,
			suggested_matches: 0,
			unmatched_bank: count,
			unmatched_ynab: 0,
			current_cleared_balance: clearedDollars,
			target_statement_balance: statementBalance,
			discrepancy: totalDelta,
			discrepancy_explanation: "Synthetic integration delta",
		},
		auto_matches: [],
		suggested_matches: [],
		unmatched_bank: Array.from({ length: count }, (_, index) => {
			const date = new Date(baseDate + index * dayMs);
			return {
				id: `integration-bank-${index}-${runNonce}`,
				date: date.toISOString().slice(0, 10),
				amount: transactionAmount,
				payee: `Integration Payee ${index}-${runNonce}`,
				memo: `Integration memo ${index}`,
				original_csv_row: index + 1,
			};
		}),
		unmatched_ynab: [],
		balance_info: {
			current_cleared: clearedDollars,
			current_uncleared: snapshot.uncleared_balance / 1000,
			current_total: snapshot.balance / 1000,
			target_statement: statementBalance,
			discrepancy: totalDelta,
			on_track: false,
		},
		next_steps: [],
		insights: [],
	};
}

function buildIntegrationParams(
	accountId: string,
	budgetId: string,
	statementBalance: number,
): ReconcileAccountRequest {
	return {
		budget_id: budgetId,
		account_id: accountId,
		csv_data: "Date,Description,Amount",
		statement_balance: statementBalance,
		statement_end_date: new Date().toISOString().slice(0, 10),
		date_tolerance_days: 1,
		match_strictness: "strict",
		auto_create_transactions: true,
		auto_update_cleared_status: false,
		auto_unclear_missing: false,
		auto_adjust_dates: false,
		dry_run: false,
	};
}
