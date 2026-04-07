import type * as ynab from "ynab";

export interface BudgetSummaryLike {
	id: string;
	name: string;
	last_modified_on?: string;
	first_month?: string;
	last_month?: string;
	date_format?: unknown;
	currency_format?: unknown;
	deleted?: boolean;
}

export interface BudgetDetailLike extends BudgetSummaryLike {
	accounts?: unknown[];
	categories?: unknown[];
	category_groups?: unknown[];
	payees?: unknown[];
	months?: unknown[];
}

export async function listBudgetsCompat(
	api: ynab.API,
): Promise<{ budgets: ynab.PlanSummary[]; serverKnowledge: number }> {
	const compatApi = api as ynab.API & {
		budgets?: {
			getBudgets?: () => Promise<{
				data?: { budgets?: unknown[]; server_knowledge?: number };
			}>;
		};
		plans?: {
			getPlans?: () => Promise<{
				data?: { plans?: ynab.PlanSummary[]; server_knowledge?: number };
			}>;
		};
	};

	if (typeof compatApi.budgets?.getBudgets === "function") {
		const response = await compatApi.budgets.getBudgets();
		return {
			budgets: (response.data?.budgets ?? []) as ynab.PlanSummary[],
			serverKnowledge: response.data?.server_knowledge ?? 0,
		};
	}

	if (typeof compatApi.plans?.getPlans === "function") {
		const response = await compatApi.plans.getPlans();
		return {
			budgets: response.data?.plans ?? [],
			serverKnowledge:
				(response.data as { server_knowledge?: number }).server_knowledge ?? 0,
		};
	}

	throw new Error(
		"YNAB API does not expose budgets.getBudgets() or plans.getPlans()",
	);
}

export async function getBudgetByIdCompat(
	api: ynab.API,
	budgetId: string,
): Promise<BudgetDetailLike> {
	const compatApi = api as ynab.API & {
		budgets?: {
			getBudgetById?: (id: string) => Promise<{
				data?: { budget?: BudgetDetailLike };
			}>;
		};
		plans?: {
			getPlanById?: (id: string) => Promise<{
				data?: { plan?: BudgetDetailLike };
			}>;
		};
	};

	if (typeof compatApi.budgets?.getBudgetById === "function") {
		const response = await compatApi.budgets.getBudgetById(budgetId);
		return response.data?.budget as BudgetDetailLike;
	}

	if (typeof compatApi.plans?.getPlanById === "function") {
		const response = await compatApi.plans.getPlanById(budgetId);
		return response.data?.plan as BudgetDetailLike;
	}

	throw new Error(
		"YNAB API does not expose budgets.getBudgetById() or plans.getPlanById()",
	);
}

export async function listMonthsCompat(
	api: ynab.API,
	budgetId: string,
	lastKnowledge?: number,
): Promise<{ months: ynab.MonthSummary[]; serverKnowledge: number }> {
	const compatApi = api as ynab.API & {
		months?: {
			getBudgetMonths?: (
				id: string,
				serverKnowledge?: number,
			) => Promise<{
				data?: { months?: ynab.MonthSummary[]; server_knowledge?: number };
			}>;
			getPlanMonths?: (
				id: string,
				serverKnowledge?: number,
			) => Promise<{
				data?: { months?: ynab.MonthSummary[]; server_knowledge?: number };
			}>;
		};
	};

	if (typeof compatApi.months?.getBudgetMonths === "function") {
		const response =
			lastKnowledge !== undefined
				? await compatApi.months.getBudgetMonths(budgetId, lastKnowledge)
				: await compatApi.months.getBudgetMonths(budgetId);
		return {
			months: response.data?.months ?? [],
			serverKnowledge: response.data?.server_knowledge ?? 0,
		};
	}

	if (typeof compatApi.months?.getPlanMonths === "function") {
		const response =
			lastKnowledge !== undefined
				? await compatApi.months.getPlanMonths(budgetId, lastKnowledge)
				: await compatApi.months.getPlanMonths(budgetId);
		return {
			months: response.data?.months ?? [],
			serverKnowledge: response.data?.server_knowledge ?? 0,
		};
	}

	throw new Error(
		"YNAB API does not expose months.getBudgetMonths() or months.getPlanMonths()",
	);
}

export async function getMonthCompat(
	api: ynab.API,
	budgetId: string,
	month: string,
): Promise<ynab.MonthDetail> {
	const compatApi = api as ynab.API & {
		months?: {
			getBudgetMonth?: (
				id: string,
				month: string,
			) => Promise<{ data?: { month?: ynab.MonthDetail } }>;
			getPlanMonth?: (
				id: string,
				month: string,
			) => Promise<{ data?: { month?: ynab.MonthDetail } }>;
		};
	};

	if (typeof compatApi.months?.getBudgetMonth === "function") {
		const response = await compatApi.months.getBudgetMonth(budgetId, month);
		return response.data?.month as ynab.MonthDetail;
	}

	if (typeof compatApi.months?.getPlanMonth === "function") {
		const response = await compatApi.months.getPlanMonth(budgetId, month);
		return response.data?.month as ynab.MonthDetail;
	}

	throw new Error(
		"YNAB API does not expose months.getBudgetMonth() or months.getPlanMonth()",
	);
}
