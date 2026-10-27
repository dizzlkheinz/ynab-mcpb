import type * as ynab from "ynab";
import type { ProgressCallback } from "../../server/toolRegistry.js";
import {
	balanceResult,
	buildBalanceReconciliation,
} from "./balanceReconciliation.js";
import { normalizeYnabError } from "./executorErrors.js";
import {
	buildRecommendations,
	chunkArray,
	type ExecutionSummary,
} from "./executorHelpers.js";
import type { ReconcileAccountRequest } from "./index.js";
import {
	type PlannedOperation,
	type ReconciliationPlan,
	transactionFingerprint,
} from "./plan.js";
import type { ReconciliationAnalysis } from "./types.js";

export type { ExecutionSummary } from "./executorHelpers.js";

export interface OperationResult {
	operation: PlannedOperation;
	status: "planned" | "applied" | "uncertain" | "skipped";
	transaction_id?: string;
	error?: string;
}
export interface AccountSnapshot {
	balance: number; // milliunits
	cleared_balance: number; // milliunits
	uncleared_balance: number; // milliunits
}

export interface ExecutionOptions {
	ynabAPI: ynab.API;
	analysis: ReconciliationAnalysis;
	params: ReconcileAccountRequest;
	budgetId: string;
	accountId: string;
	initialAccount: AccountSnapshot;
	currencyCode: string;
	decimalDigits?: number;
	/**
	 * Optional progress callback for emitting MCP progress notifications.
	 * When provided, progress updates are sent during bulk operations.
	 */
	sendProgress?: ProgressCallback;
	sourceTransactions?: ynab.TransactionDetail[];
	statementClearedBalanceMilli?: number;
}

export interface ExecutionResult {
	summary: ExecutionSummary;
	operation_results?: OperationResult[];
	errors?: string[];
	account_balance: {
		before: AccountSnapshot;
		after: AccountSnapshot;
	};
	recommendations: string[];
	balance_reconciliation?: Awaited<
		ReturnType<typeof buildBalanceReconciliation>
	>;
}

/** Correlate each acknowledgment once, including out-of-order bulk responses. */
function acknowledges(
	operation: PlannedOperation,
	transaction: ynab.TransactionDetail,
): boolean {
	if (!transaction.id || transaction.deleted) return false;
	return Object.entries(operation.payload).every(([key, expected]) => {
		if (expected === undefined) return true;
		const actual = (transaction as unknown as Record<string, unknown>)[key];
		// YNAB represents an empty memo as null in read responses.
		return key === "memo"
			? (actual ?? "") === (expected ?? "")
			: actual === expected;
	});
}

/** Execute only the captured payloads. Never re-read CSV or recompute matching. */
export async function executeReconciliationPlan(
	plan: ReconciliationPlan,
	options: ExecutionOptions,
): Promise<ExecutionResult> {
	const { ynabAPI, params, analysis, currencyCode } = options;
	if (
		plan.budgetId !== options.budgetId ||
		plan.accountId !== options.accountId
	)
		throw new Error("Reconciliation plan scope mismatch");
	const results: OperationResult[] = [];
	const errors: string[] = [];
	if (!params.dry_run && plan.transactionFingerprint) {
		const response = await ynabAPI.transactions.getTransactionsByAccount(
			plan.budgetId,
			plan.accountId,
		);
		if (
			transactionFingerprint(response.data.transactions) !==
			plan.transactionFingerprint
		) {
			throw new Error(
				"Account transactions changed since preview. No changes were applied. Preview reconciliation again.",
			);
		}
	}
	const total = plan.operations.length + 1;
	let completed = 0;
	const progress = async (message: string) => {
		if (params.dry_run || !options.sendProgress) return;
		try {
			await options.sendProgress({ progress: completed, total, message });
		} catch {
			/* Advisory only; never repeat a committed write. */
		}
	};
	let stopped = false;
	const createdIds = new Set<string>();
	// Preserve plan order; each contiguous API operation kind is chunked once.
	let position = 0;
	while (position < plan.operations.length) {
		const kind = plan.operations[position]?.kind;
		const group: PlannedOperation[] = [];
		while (
			position < plan.operations.length &&
			plan.operations[position]?.kind === kind
		) {
			const operation = plan.operations[position++];
			if (operation) group.push(operation);
		}
		for (const chunk of chunkArray(group, 100)) {
			if (stopped || params.dry_run) {
				results.push(
					...chunk.map((operation) => ({
						operation,
						status: params.dry_run
							? ("planned" as const)
							: ("skipped" as const),
					})),
				);
				completed += chunk.length;
				continue;
			}
			// A transport error may occur after YNAB commits. Do not retry or fall back
			// to per-row writes; return uncertain outcomes for explicit inspection.
			try {
				let transactions: ynab.TransactionDetail[];
				if (kind === "create") {
					const payloads = chunk.map(
						(operation) => operation.payload as ynab.NewTransaction,
					);
					if (payloads.length === 1 && payloads[0]) {
						const response = await ynabAPI.transactions.createTransaction(
							plan.budgetId,
							{ transaction: payloads[0] },
						);
						transactions = response.data.transaction
							? [response.data.transaction]
							: [];
					} else {
						const response = await ynabAPI.transactions.createTransactions(
							plan.budgetId,
							{ transactions: payloads },
						);
						transactions = response.data.transactions ?? [];
					}
				} else {
					const response = await ynabAPI.transactions.updateTransactions(
						plan.budgetId,
						{
							transactions: chunk.map(
								(operation) =>
									operation.payload as ynab.SaveTransactionWithIdOrImportId,
							),
						},
					);
					transactions = response.data.transactions ?? [];
				}
				const remaining = [...transactions];
				for (const operation of chunk) {
					const id =
						"id" in operation.payload ? operation.payload.id : undefined;
					const index = remaining.findIndex(
						(transaction) =>
							acknowledges(operation, transaction) &&
							(kind !== "create" || !createdIds.has(transaction.id)),
					);
					const transaction =
						index < 0 ? undefined : remaining.splice(index, 1)[0];
					if (!transaction) {
						const message = `YNAB did not acknowledge ${id ? `transaction ${id}` : operation.reason}. Check YNAB before retrying.`;
						results.push({ operation, status: "uncertain", error: message });
						errors.push(message);
						stopped = true;
						continue;
					}
					if (kind === "create") createdIds.add(transaction.id);
					results.push({
						operation,
						status: "applied",
						transaction_id: transaction.id,
					});
				}
			} catch (error) {
				const message = normalizeYnabError(error).message;
				errors.push(
					`Write outcome uncertain: ${message}. Check YNAB before retrying.`,
				);
				results.push(
					...chunk.map((operation) => ({
						operation,
						status: "uncertain" as const,
						error: message,
					})),
				);
				stopped = true;
			}
			completed += chunk.length;
			await progress(
				`Processed ${completed} of ${plan.operations.length} planned operations`,
			);
		}
	}
	const successful = results.filter(
		(result) => result.status === "applied" || result.status === "planned",
	);
	const summary: ExecutionSummary = {
		bank_transactions_count: analysis.summary.bank_transactions_count,
		ynab_transactions_count: analysis.summary.ynab_transactions_count,
		matches_found: analysis.auto_matches.length,
		missing_in_ynab: analysis.unmatched_bank.length,
		missing_in_bank: analysis.unmatched_ynab.length,
		transactions_created: successful.filter(
			(result) => result.operation.kind === "create",
		).length,
		transactions_updated: successful.filter(
			(result) => result.operation.kind !== "create",
		).length,
		dates_adjusted: successful.filter((result) => result.operation.changesDate)
			.length,
		dry_run: params.dry_run,
	};
	let afterAccount = { ...plan.initialAccount };
	let balance = params.dry_run
		? balanceResult(
				plan.statementTargetMilli,
				plan.projectedClearedMilli,
				options.decimalDigits,
			)
		: undefined;
	if (!params.dry_run) {
		try {
			if (params.statement_end_date) {
				balance = await buildBalanceReconciliation({
					ynabAPI,
					budgetId: plan.budgetId,
					accountId: plan.accountId,
					statementDate: params.statement_end_date,
					statementBalanceMilli: plan.statementTargetMilli,
					analysis,
					...(options.decimalDigits !== undefined
						? { decimalDigits: options.decimalDigits }
						: {}),
				});
			}
			if (successful.length > 0) {
				const response = await ynabAPI.accounts.getAccountById(
					plan.budgetId,
					plan.accountId,
				);
				const account = response.data.account;
				afterAccount = {
					balance: account.balance,
					cleared_balance: account.cleared_balance,
					uncleared_balance: account.uncleared_balance,
				};
			}
		} catch (error) {
			errors.push(
				`Writes are recorded above, but final verification failed: ${normalizeYnabError(error).message}. Check YNAB before retrying.`,
			);
		}
	}
	const recommendations = buildRecommendations({
		summary,
		params,
		analysis,
		balanceChangeMilli: afterAccount.balance - plan.initialAccount.balance,
		currencyCode,
	});
	recommendations.push(...errors);
	completed = total;
	await progress("Reconciliation finished");
	return {
		summary,
		account_balance: {
			before: { ...plan.initialAccount },
			after: afterAccount,
		},
		operation_results: results,
		errors,
		recommendations,
		...(params.statement_end_date && balance
			? { balance_reconciliation: balance }
			: {}),
	};
}
