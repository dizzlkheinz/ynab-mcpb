import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import { handleToolError, type ErrorHandler } from "../server/errorHandler.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ToolFactory } from "../types/toolRegistration.js";
import { milliunitsToAmount } from "../utils/amountUtils.js";
import { isValidISODate } from "../utils/dateUtils.js";
import {
	createAdapters,
	createBudgetResolver,
	requireResolvedBudgetId,
} from "./adapters.js";
import type { DeltaFetcher } from "./deltaFetcher.js";
import { ToolAnnotationPresets } from "./toolCategories.js";

const dateSchema = z
	.string()
	.refine(isValidISODate, "Date must be a valid ISO date (YYYY-MM-DD)");
const groupBySchema = z.enum(["category", "payee", "account", "week", "month"]);

export const AnalyzeSpendingSchema = z
	.object({
		budget_id: z.string().min(1).optional(),
		since_date: dateSchema,
		until_date: dateSchema,
		group_by: groupBySchema,
		include_transfers: z.boolean().default(false).optional(),
	})
	.strict()
	.refine((data) => data.since_date <= data.until_date, {
		message: "since_date must be on or before until_date",
		path: ["until_date"],
	});

const PeriodSchema = z
	.object({ since_date: dateSchema, until_date: dateSchema })
	.strict()
	.refine((data) => data.since_date <= data.until_date, {
		message: "since_date must be on or before until_date",
		path: ["until_date"],
	});

export const CompareSpendingPeriodsSchema = z
	.object({
		budget_id: z.string().min(1).optional(),
		period_a: PeriodSchema,
		period_b: PeriodSchema,
		group_by: groupBySchema,
		include_transfers: z.boolean().default(false).optional(),
	})
	.strict();

const TotalsSchema = z.object({
	income: z.number(),
	spending: z.number(),
	net: z.number(),
	income_milliunits: z.number().int(),
	spending_milliunits: z.number().int(),
	net_milliunits: z.number().int(),
	transaction_count: z.number().int(),
});

const GroupSchema = TotalsSchema.extend({ key: z.string(), name: z.string() });

const SpendingAnalysisOutputSchema = z.object({
	period: z.object({ since_date: z.string(), until_date: z.string() }),
	group_by: groupBySchema,
	totals: TotalsSchema,
	groups: z.array(GroupSchema),
	excluded_transfer_count: z.number().int(),
	cached: z.boolean(),
	used_delta: z.boolean(),
});

const ComparisonOutputSchema = z.object({
	group_by: groupBySchema,
	period_a: SpendingAnalysisOutputSchema,
	period_b: SpendingAnalysisOutputSchema,
	difference: TotalsSchema.omit({ transaction_count: true }).extend({
		transaction_count: z.number().int(),
	}),
	groups: z.array(
		z.object({
			key: z.string(),
			name: z.string(),
			period_a: TotalsSchema,
			period_b: TotalsSchema,
			difference: TotalsSchema,
		}),
	),
});

interface Aggregate {
	income: number;
	spending: number;
	net: number;
	transactionCount: number;
}

interface AnalysisData {
	period: { since_date: string; until_date: string };
	group_by: z.infer<typeof groupBySchema>;
	totals: ReturnType<typeof formatAggregate>;
	groups: Array<ReturnType<typeof formatGroup>>;
	excluded_transfer_count: number;
	cached: boolean;
	used_delta: boolean;
}

type AnalyticsTransaction = Pick<
	ynab.TransactionDetail,
	| "date"
	| "amount"
	| "account_id"
	| "account_name"
	| "payee_id"
	| "payee_name"
	| "category_id"
	| "category_name"
	| "subtransactions"
>;

function emptyAggregate(): Aggregate {
	return { income: 0, spending: 0, net: 0, transactionCount: 0 };
}

function addAmount(aggregate: Aggregate, amount: number): void {
	aggregate.net += amount;
	if (amount >= 0) {
		aggregate.income += amount;
	} else {
		aggregate.spending += -amount;
	}
	aggregate.transactionCount += 1;
}

function formatAggregate(aggregate: Aggregate) {
	return {
		income: milliunitsToAmount(aggregate.income),
		spending: milliunitsToAmount(aggregate.spending),
		net: milliunitsToAmount(aggregate.net),
		income_milliunits: aggregate.income,
		spending_milliunits: aggregate.spending,
		net_milliunits: aggregate.net,
		transaction_count: aggregate.transactionCount,
	};
}

function formatGroup(group: {
	key: string;
	name: string;
	aggregate: Aggregate;
}) {
	return {
		key: group.key,
		name: group.name,
		...formatAggregate(group.aggregate),
	};
}

function weekStart(dateString: string): string {
	const date = new Date(`${dateString}T00:00:00Z`);
	const day = date.getUTCDay();
	date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
	return date.toISOString().slice(0, 10);
}

function groupIdentity(
	transaction: AnalyticsTransaction,
	groupBy: z.infer<typeof groupBySchema>,
): { key: string; name: string } {
	switch (groupBy) {
		case "category":
			return {
				key: transaction.category_id ?? "uncategorized",
				name: transaction.category_name ?? "Uncategorized",
			};
		case "payee":
			return {
				key: transaction.payee_id ?? transaction.payee_name ?? "no-payee",
				name: transaction.payee_name ?? "No payee",
			};
		case "account":
			return {
				key: transaction.account_id,
				name: transaction.account_name,
			};
		case "week": {
			const key = weekStart(transaction.date);
			return { key, name: `Week of ${key}` };
		}
		case "month": {
			const key = transaction.date.slice(0, 7);
			return { key, name: key };
		}
	}
}

function categoryEntries(
	transaction: ynab.TransactionDetail,
): AnalyticsTransaction[] {
	if (
		!transaction.subtransactions ||
		transaction.subtransactions.length === 0
	) {
		return [transaction];
	}
	return transaction.subtransactions
		.filter((subtransaction) => !subtransaction.deleted)
		.map((subtransaction) => ({
			date: transaction.date,
			amount: subtransaction.amount,
			account_id: transaction.account_id,
			account_name: transaction.account_name,
			subtransactions: [],
			...(transaction.payee_id !== undefined && {
				payee_id: transaction.payee_id,
			}),
			...(transaction.payee_name !== undefined && {
				payee_name: transaction.payee_name,
			}),
			...(subtransaction.category_id !== undefined && {
				category_id: subtransaction.category_id,
			}),
			...(subtransaction.category_name !== undefined && {
				category_name: subtransaction.category_name,
			}),
		}));
}

async function analyze(
	deltaFetcher: DeltaFetcher,
	budgetId: string,
	period: { since_date: string; until_date: string },
	groupBy: z.infer<typeof groupBySchema>,
	includeTransfers: boolean,
): Promise<AnalysisData> {
	const fetched = await deltaFetcher.fetchTransactions(
		budgetId,
		period.since_date,
	);
	const inRange = fetched.data.filter(
		(transaction) =>
			!transaction.deleted &&
			transaction.date >= period.since_date &&
			transaction.date <= period.until_date,
	);
	const excludedTransferCount = includeTransfers
		? 0
		: inRange.filter((transaction) => transaction.transfer_account_id).length;
	const included = includeTransfers
		? inRange
		: inRange.filter((transaction) => !transaction.transfer_account_id);
	const total = emptyAggregate();
	for (const transaction of included) {
		addAmount(total, transaction.amount);
	}

	const groups = new Map<string, { name: string; aggregate: Aggregate }>();
	for (const transaction of included) {
		const entries =
			groupBy === "category" ? categoryEntries(transaction) : [transaction];
		for (const entry of entries) {
			const identity = groupIdentity(entry, groupBy);
			const existing = groups.get(identity.key) ?? {
				name: identity.name,
				aggregate: emptyAggregate(),
			};
			addAmount(existing.aggregate, entry.amount);
			groups.set(identity.key, existing);
		}
	}

	return {
		period,
		group_by: groupBy,
		totals: formatAggregate(total),
		groups: Array.from(groups, ([key, value]) =>
			formatGroup({ key, name: value.name, aggregate: value.aggregate }),
		).sort(
			(left, right) =>
				right.spending_milliunits - left.spending_milliunits ||
				left.key.localeCompare(right.key),
		),
		excluded_transfer_count: excludedTransferCount,
		cached: fetched.wasCached,
		used_delta: fetched.usedDelta,
	};
}

function asResult(data: object): CallToolResult {
	return {
		content: [{ type: "text", text: responseFormatter.format(data) }],
		structuredContent: data as Record<string, unknown>,
	};
}

export async function handleAnalyzeSpending(
	_api: ynab.API,
	deltaFetcher: DeltaFetcher,
	params: z.infer<typeof AnalyzeSpendingSchema>,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		const data = await analyze(
			deltaFetcher,
			requireResolvedBudgetId(params.budget_id),
			{ since_date: params.since_date, until_date: params.until_date },
			params.group_by,
			params.include_transfers ?? false,
		);
		return asResult(data);
	} catch (error) {
		return handleToolError(
			error,
			"ynab_analyze_spending",
			"analyzing spending",
			errorHandler,
		);
	}
}

function difference(
	left: ReturnType<typeof formatAggregate>,
	right: ReturnType<typeof formatAggregate>,
) {
	return {
		income: right.income - left.income,
		spending: right.spending - left.spending,
		net: right.net - left.net,
		income_milliunits: right.income_milliunits - left.income_milliunits,
		spending_milliunits: right.spending_milliunits - left.spending_milliunits,
		net_milliunits: right.net_milliunits - left.net_milliunits,
		transaction_count: right.transaction_count - left.transaction_count,
	};
}

export async function handleCompareSpendingPeriods(
	_api: ynab.API,
	deltaFetcher: DeltaFetcher,
	params: z.infer<typeof CompareSpendingPeriodsSchema>,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		const budgetId = requireResolvedBudgetId(params.budget_id);
		const [periodA, periodB] = await Promise.all([
			analyze(
				deltaFetcher,
				budgetId,
				params.period_a,
				params.group_by,
				params.include_transfers ?? false,
			),
			analyze(
				deltaFetcher,
				budgetId,
				params.period_b,
				params.group_by,
				params.include_transfers ?? false,
			),
		]);
		const groupsA = new Map(periodA.groups.map((group) => [group.key, group]));
		const groupsB = new Map(periodB.groups.map((group) => [group.key, group]));
		const keys = new Set([...groupsA.keys(), ...groupsB.keys()]);
		const zero = formatAggregate(emptyAggregate());
		const groups = Array.from(keys, (key) => {
			const left = groupsA.get(key) ?? {
				key,
				name: groupsB.get(key)?.name ?? key,
				...zero,
			};
			const right = groupsB.get(key) ?? { key, name: left.name, ...zero };
			return {
				key,
				name: right.name,
				period_a: left,
				period_b: right,
				difference: difference(left, right),
			};
		}).sort(
			(left, right) =>
				Math.abs(right.difference.spending_milliunits) -
					Math.abs(left.difference.spending_milliunits) ||
				left.key.localeCompare(right.key),
		);
		return asResult({
			group_by: params.group_by,
			period_a: periodA,
			period_b: periodB,
			difference: difference(periodA.totals, periodB.totals),
			groups,
		});
	} catch (error) {
		return handleToolError(
			error,
			"ynab_compare_spending_periods",
			"comparing spending periods",
			errorHandler,
		);
	}
}

export const registerSpendingAnalyticsTools: ToolFactory = (
	registry,
	context,
) => {
	const { adaptWithDelta } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);
	registry.register({
		name: "ynab_analyze_spending",
		description:
			"Deterministically calculate income, spending, and net totals for an inclusive date range, grouped by category, payee, account, week, or month. Aggregates always use the complete fetched period before grouping.",
		inputSchema: AnalyzeSpendingSchema,
		outputSchema: SpendingAnalysisOutputSchema,
		handler: adaptWithDelta(handleAnalyzeSpending),
		defaultArgumentResolver: budgetResolver(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Analyze Spending",
			},
		},
	});
	registry.register({
		name: "ynab_compare_spending_periods",
		description:
			"Deterministically compare two complete spending periods and calculate total and per-group differences.",
		inputSchema: CompareSpendingPeriodsSchema,
		outputSchema: ComparisonOutputSchema,
		handler: adaptWithDelta(handleCompareSpendingPeriods),
		defaultArgumentResolver: budgetResolver(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Compare Spending Periods",
			},
		},
	});
};
