import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import { CacheKeys } from "../server/cacheKeys.js";
import {
	CACHE_TTLS,
	CacheManager,
	cacheManager,
} from "../server/cacheManager.js";
import type { ErrorHandler } from "../server/errorHandler.js";
import {
	formatMonthDetail,
	formatMonthsList,
} from "../server/markdownFormatter.js";
import { responseFormatter } from "../server/responseFormatter.js";
import { withToolErrorHandling } from "../types/index.js";
import type { ToolFactory } from "../types/toolRegistration.js";
import { milliunitsToAmount } from "../utils/amountUtils.js";
import { createAdapters, createBudgetResolver } from "./adapters.js";
import type { DeltaFetcher } from "./deltaFetcher.js";
import { resolveDeltaFetcherArgs } from "./deltaSupport.js";
import {
	GetMonthOutputSchema,
	ListMonthsOutputSchema,
} from "./schemas/outputs/index.js";
import { ToolAnnotationPresets } from "./toolCategories.js";

/**
 * Schema for ynab:get_month tool parameters
 */
export const GetMonthSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required"),
		month: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "Month must be in YYYY-MM-DD format"),
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type GetMonthParams = z.infer<typeof GetMonthSchema>;

/**
 * Schema for ynab:list_months tool parameters
 */
export const ListMonthsSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required"),
		limit: z.number().int().positive().optional(),
		offset: z.number().int().min(0).optional(),
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type ListMonthsParams = z.infer<typeof ListMonthsSchema>;

/**
 * Handles the ynab:get_month tool call
 * Gets budget data for a specific month
 */
export async function handleGetMonth(
	ynabAPI: ynab.API,
	params: GetMonthParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	return await withToolErrorHandling(
		async () => {
			// Always use cache
			const cacheKey = CacheManager.generateKey(
				CacheKeys.MONTHS,
				"get",
				params.budget_id,
				params.month,
			);
			const wasCached = cacheManager.has(cacheKey);
			const month = await cacheManager.wrap<ynab.MonthDetail>(cacheKey, {
				ttl: CACHE_TTLS.MONTHS,
				loader: async () => {
					const response = await ynabAPI.months.getPlanMonth(
						params.budget_id,
						params.month,
					);
					return response.data.month;
				},
			});

			const fmt = params.response_format ?? "markdown";
			const dataObject = {
				month: {
					month: month.month,
					note: month.note,
					income: milliunitsToAmount(month.income),
					budgeted: milliunitsToAmount(month.budgeted),
					activity: milliunitsToAmount(month.activity),
					to_be_budgeted: milliunitsToAmount(month.to_be_budgeted),
					age_of_money: month.age_of_money,
					deleted: month.deleted,
					categories: month.categories?.map((category) => ({
						id: category.id,
						category_group_id: category.category_group_id,
						category_group_name: category.category_group_name,
						name: category.name,
						hidden: category.hidden,
						original_category_group_id: category.original_category_group_id,
						note: category.note,
						budgeted: milliunitsToAmount(category.budgeted),
						activity: milliunitsToAmount(category.activity),
						balance: milliunitsToAmount(category.balance),
						goal_type: category.goal_type,
						goal_creation_month: category.goal_creation_month,
						goal_target: category.goal_target,
						goal_target_month: category.goal_target_month,
						goal_percentage_complete: category.goal_percentage_complete,
						goal_months_to_budget: category.goal_months_to_budget,
						goal_under_funded: category.goal_under_funded,
						goal_overall_funded: category.goal_overall_funded,
						goal_overall_left: category.goal_overall_left,
						deleted: category.deleted,
					})),
				},
				cached: wasCached,
				cache_info: wasCached
					? "Data retrieved from cache for improved performance"
					: "Fresh data retrieved from YNAB API",
			};
			return {
				content: [
					{
						type: "text",
						text:
							fmt === "markdown"
								? formatMonthDetail(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:get_month",
		"getting month data",
		errorHandler,
	);
}

/**
 * Handles the ynab:list_months tool call
 * Lists all months summary data for a budget
 */
export async function handleListMonths(
	ynabAPI: ynab.API,
	deltaFetcher: DeltaFetcher,
	params: ListMonthsParams,
): Promise<CallToolResult>;
export async function handleListMonths(
	ynabAPI: ynab.API,
	params: ListMonthsParams,
): Promise<CallToolResult>;
export async function handleListMonths(
	ynabAPI: ynab.API,
	deltaFetcherOrParams: DeltaFetcher | ListMonthsParams,
	maybeParams?: ListMonthsParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaFetcher, params } = resolveDeltaFetcherArgs(
		ynabAPI,
		deltaFetcherOrParams,
		maybeParams,
	);
	return await withToolErrorHandling(
		async () => {
			// Always use cache
			const result = await deltaFetcher.fetchMonths(params.budget_id);
			const allMonths = result.data;
			const wasCached = result.wasCached;
			const usedDelta = result.usedDelta;

			// Apply pagination
			const limit = params.limit ?? 50;
			const offset = params.offset ?? 0;
			const months = allMonths.slice(offset, offset + limit);
			const hasMore = offset + limit < allMonths.length;

			const fmt = params.response_format ?? "markdown";
			const dataObject = {
				months: months.map((month) => ({
					month: month.month,
					note: month.note,
					income: milliunitsToAmount(month.income),
					budgeted: milliunitsToAmount(month.budgeted),
					activity: milliunitsToAmount(month.activity),
					to_be_budgeted: milliunitsToAmount(month.to_be_budgeted),
					age_of_money: month.age_of_money,
					deleted: month.deleted,
				})),
				total_count: allMonths.length,
				returned_count: months.length,
				offset,
				has_more: hasMore,
				next_offset: hasMore ? offset + limit : undefined,
				cached: wasCached,
				cache_info: wasCached
					? `Data retrieved from cache for improved performance${usedDelta ? " (delta merge applied)" : ""}`
					: "Fresh data retrieved from YNAB API",
			};
			return {
				content: [
					{
						type: "text",
						text:
							fmt === "markdown"
								? formatMonthsList(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:list_months",
		"listing months",
		errorHandler,
	);
}

/**
 * Registers all month-related tools with the registry.
 */
export const registerMonthTools: ToolFactory = (registry, context) => {
	const { adapt, adaptWithDelta } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);

	registry.register({
		name: "ynab_get_month",
		description: `Get full budget data for a specific month including all category balances.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - month (string, required): Month in YYYY-MM-DD format (use first day, e.g. "2025-01-01").
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: month (month, income, budgeted, activity, to_be_budgeted, age_of_money, categories[]), cached, cache_info

Examples:
  - Get January 2025: set month="2025-01-01"

Errors:
  - "No default budget set" → run ynab_set_default_budget first`,
		inputSchema: GetMonthSchema,
		outputSchema: GetMonthOutputSchema,
		handler: adapt(handleGetMonth),
		defaultArgumentResolver: budgetResolver<z.infer<typeof GetMonthSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Get Month Details",
			},
		},
	});

	registry.register({
		name: "ynab_list_months",
		description: `List summary data for all budget months with pagination.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - limit (int, optional): Max results per page. Default: 50.
  - offset (int, optional): Zero-based offset for pagination. Default: 0.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: months[], total_count, returned_count, offset, has_more, next_offset, cached, cache_info

Examples:
  - List recent months: call with no args, months are newest-first
  - Page 2: set limit=12, offset=12

Errors:
  - "No default budget set" → run ynab_set_default_budget first`,
		inputSchema: ListMonthsSchema,
		outputSchema: ListMonthsOutputSchema,
		handler: adaptWithDelta(handleListMonths),
		defaultArgumentResolver: budgetResolver<z.infer<typeof ListMonthsSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: List Months",
			},
		},
	});
};
