import type * as ynab from "ynab";
import { addMilli, fromMilli, toMilli } from "../../utils/money.js";
import type { ReconciliationAnalysis } from "./types.js";

export async function buildBalanceReconciliation(args: {
	ynabAPI: ynab.API;
	budgetId: string;
	accountId: string;
	statementDate: string;
	statementBalanceMilli: number;
	decimalDigits?: number;
	analysis: ReconciliationAnalysis;
}) {
	const {
		ynabAPI,
		budgetId,
		accountId,
		statementDate,
		statementBalanceMilli,
		decimalDigits = 2,
	} = args;
	const ynabMilli = await clearedBalanceAsOf(
		ynabAPI,
		budgetId,
		accountId,
		statementDate,
	);
	return balanceResult(statementBalanceMilli, ynabMilli, decimalDigits);
}

/** The same balance calculation is used for projections and verified execution. */
export function balanceResult(
	statementBalanceMilli: number,
	ynabMilli: number,
	decimalDigits = 2,
) {
	const bankMilli = statementBalanceMilli;
	const discrepancy = bankMilli - ynabMilli;

	const precisionCalculations = {
		bank_statement_balance_milliunits: bankMilli,
		ynab_calculated_balance_milliunits: ynabMilli,
		discrepancy_milliunits: discrepancy,
		discrepancy_dollars: fromMilli(discrepancy, decimalDigits),
		currency_decimal_digits: decimalDigits,
	};

	const discrepancyAnalysis =
		discrepancy === 0 ? undefined : buildLikelyCauses(discrepancy);

	const result: {
		status: "balanced" | "unbalanced";
		precision_calculations: typeof precisionCalculations;
		discrepancy_analysis?: ReturnType<typeof buildLikelyCauses>;
		final_verification: {
			balance_matches_exactly: boolean;
			all_transactions_accounted: boolean;
			audit_trail_complete: boolean;
			reconciliation_complete: boolean;
		};
	} = {
		status: discrepancy === 0 ? "balanced" : "unbalanced",
		precision_calculations: precisionCalculations,
		final_verification: {
			balance_matches_exactly: discrepancy === 0,
			// Equal balances alone do not prove every transaction was accounted for.
			all_transactions_accounted: false,
			audit_trail_complete: false,
			reconciliation_complete: false,
		},
	};

	if (discrepancyAnalysis !== undefined) {
		result.discrepancy_analysis = discrepancyAnalysis;
	}

	return result;
}

async function clearedBalanceAsOf(
	api: ynab.API,
	budgetId: string,
	accountId: string,
	dateISO: string,
): Promise<number> {
	const response = await api.transactions.getTransactionsByAccount(
		budgetId,
		accountId,
	);
	const asOf = new Date(dateISO);
	const cleared = response.data.transactions.filter(
		(txn) =>
			!txn.deleted &&
			(txn.cleared === "cleared" || txn.cleared === "reconciled") &&
			new Date(txn.date) <= asOf,
	);
	const sum = cleared.reduce((acc, txn) => addMilli(acc, txn.amount ?? 0), 0);
	return sum;
}

export function buildLikelyCauses(discrepancyMilli: number) {
	const causes = [] as {
		cause_type: string;
		description: string;
		confidence: number;
		amount_milliunits: number;
		suggested_resolution: string;
		evidence: unknown[];
	}[];

	const abs = Math.abs(discrepancyMilli);
	if (abs % 500 === 0) {
		causes.push({
			cause_type: "bank_fee",
			description: "Round amount suggests a bank fee or interest adjustment.",
			confidence: 0.8,
			amount_milliunits: discrepancyMilli,
			suggested_resolution:
				discrepancyMilli < 0
					? "Create bank fee transaction and mark cleared"
					: "Record interest income",
			evidence: [],
		});
	}

	return causes.length > 0
		? {
				confidence_level: Math.max(...causes.map((cause) => cause.confidence)),
				likely_causes: causes,
				risk_assessment: "LOW",
			}
		: undefined;
}

export function resolveStatementBalanceMilli(
	balanceInfo: ReconciliationAnalysis["balance_info"],
): number {
	return (
		extractMoneyValue(balanceInfo?.target_statement) ??
		extractMoneyValue(balanceInfo?.current_cleared) ??
		0
	);
}

function extractMoneyValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return toMilli(value);
	}
	if (
		value &&
		typeof value === "object" &&
		"value_milliunits" in value &&
		typeof (value as { value_milliunits: unknown }).value_milliunits ===
			"number"
	) {
		return (value as { value_milliunits: number }).value_milliunits;
	}
	return undefined;
}
