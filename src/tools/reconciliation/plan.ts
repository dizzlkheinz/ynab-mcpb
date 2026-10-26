import { createHash } from "node:crypto";
import type * as ynab from "ynab";
import { canonicalJson } from "../../server/writeSafety.js";
import { addMilli } from "../../utils/money.js";
import { resolveStatementBalanceMilli } from "./balanceReconciliation.js";
import type { AccountSnapshot, ExecutionOptions } from "./executor.js";
import {
	computeUpdateFlags,
	sortByDateDescending,
	sortMatchesByBankDateDescending,
	truncateMemo,
	updateReason,
} from "./executorHelpers.js";

export interface PlannedOperation {
	readonly kind: "create" | "update" | "unclear" | "reconcile";
	readonly payload: ynab.NewTransaction | ynab.SaveTransactionWithIdOrImportId;
	readonly reason: string;
	readonly changesDate: boolean;
	readonly clearedDelta: number;
}

export interface ReconciliationPlan {
	readonly budgetId: string;
	readonly accountId: string;
	readonly operations: readonly PlannedOperation[];
	readonly statementTargetMilli: number;
	readonly initialClearedMilli: number;
	readonly projectedClearedMilli: number;
	readonly initialAccount: AccountSnapshot;
	/** Active account snapshot, including split details. */
	readonly transactionFingerprint?: string;
}

export function transactionFingerprint(
	transactions: readonly ynab.TransactionDetail[],
): string {
	return createHash("sha256")
		.update(
			canonicalJson(
				transactions
					.filter((transaction) => !transaction.deleted)
					.sort((a, b) => a.id.localeCompare(b.id)),
			),
		)
		.digest("hex");
}

export function freezeSnapshot<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freezeSnapshot(child);
		Object.freeze(value);
	}
	return value;
}

/** Pure planning: no API calls, output formatting, or progress side effects. */
export function buildReconciliationPlan(
	options: ExecutionOptions,
): ReconciliationPlan {
	const { analysis, params, initialAccount, accountId, budgetId } = options;
	const statementTargetMilli = resolveStatementBalanceMilli(
		analysis.balance_info,
	);
	const initialClearedMilli =
		options.statementClearedBalanceMilli ?? initialAccount.cleared_balance;
	let clearedMilli = initialClearedMilli;
	const operations: PlannedOperation[] = [];
	const add = (operation: PlannedOperation) => {
		operations.push(operation);
		clearedMilli = addMilli(clearedMilli, operation.clearedDelta);
	};
	if (params.auto_create_transactions) {
		for (const bank of sortByDateDescending(analysis.unmatched_bank)) {
			if (!Number.isSafeInteger(bank.amount))
				throw new Error("Transaction amount must be safe integer milliunits");
			add({
				kind: "create",
				payload: {
					account_id: accountId,
					date: bank.date,
					amount: bank.amount,
					payee_name: bank.payee,
					memo: truncateMemo(bank.memo),
					cleared: "cleared",
					approved: true,
				},
				reason: `Create missing transaction: ${bank.payee}`,
				changesDate: false,
				clearedDelta: bank.amount,
			});
		}
	}
	const clearedIds = new Set<string>();
	for (const match of sortMatchesByBankDateDescending(analysis.auto_matches)) {
		const transaction = match.ynabTransaction;
		if (!transaction) continue;
		const flags = computeUpdateFlags(match, params);
		if (transaction.cleared === "cleared" || flags.needsClearedUpdate)
			clearedIds.add(transaction.id);
		if (!flags.needsClearedUpdate && !flags.needsDateUpdate) continue;
		add({
			kind: "update",
			payload: {
				id: transaction.id,
				...(flags.needsClearedUpdate ? { cleared: "cleared" as const } : {}),
				...(flags.needsDateUpdate ? { date: match.bankTransaction.date } : {}),
			},
			reason: updateReason(match, flags, options.currencyCode),
			changesDate: flags.needsDateUpdate,
			clearedDelta: flags.needsClearedUpdate ? transaction.amount : 0,
		});
	}
	if (params.auto_unclear_missing) {
		for (const transaction of sortByDateDescending(analysis.unmatched_ynab)) {
			if (Math.abs(clearedMilli - statementTargetMilli) <= 10) break;
			if (
				transaction.cleared !== "cleared" ||
				(params.statement_end_date &&
					transaction.date > params.statement_end_date)
			)
				continue;
			add({
				kind: "unclear",
				payload: { id: transaction.id, cleared: "uncleared" },
				reason: `Mark statement-missing transaction ${transaction.id} uncleared`,
				changesDate: false,
				clearedDelta: -transaction.amount,
			});
		}
	}
	if (
		params.auto_update_cleared_status &&
		clearedMilli === statementTargetMilli
	) {
		for (const id of clearedIds) {
			add({
				kind: "reconcile",
				payload: { id, cleared: "reconciled" },
				reason: `Mark matched transaction ${id} reconciled`,
				changesDate: false,
				clearedDelta: 0,
			});
		}
	}
	return freezeSnapshot({
		budgetId,
		accountId,
		operations,
		statementTargetMilli,
		initialClearedMilli,
		projectedClearedMilli: clearedMilli,
		initialAccount: { ...initialAccount },
		...(options.sourceTransactions
			? {
					transactionFingerprint: transactionFingerprint(
						options.sourceTransactions,
					),
				}
			: {}),
	});
}
