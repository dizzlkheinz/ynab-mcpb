import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import type { ErrorHandler } from "../server/errorHandler.js";
import {
	formatBudgetDetail,
	formatBudgetsList,
} from "../server/markdownFormatter.js";
import { responseFormatter } from "../server/responseFormatter.js";
import { withToolErrorHandling } from "../types/index.js";
import type { ToolFactory } from "../types/toolRegistration.js";
import { getBudgetByIdCompat } from "../utils/ynabApiCompat.js";
import { createAdapters } from "./adapters.js";
import type { DeltaFetcher } from "./deltaFetcher.js";
import { resolveDeltaFetcherArgs } from "./deltaSupport.js";
import {
	GetBudgetOutputSchema,
	ListBudgetsOutputSchema,
} from "./schemas/outputs/index.js";
import { ToolAnnotationPresets } from "./toolCategories.js";

/**
 * Schema for ynab:list_budgets tool parameters
 */
export const ListBudgetsSchema = z
	.object({
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type ListBudgetsParams = z.infer<typeof ListBudgetsSchema>;

/**
 * Schema for ynab:get_budget tool parameters
 */
export const GetBudgetSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required"),
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type GetBudgetParams = z.infer<typeof GetBudgetSchema>;

/**
 * Handles the ynab:list_budgets tool call
 * Lists all budgets associated with the user's account
 */
export async function handleListBudgets(
	ynabAPI: ynab.API,
	deltaFetcherOrParams?: DeltaFetcher | Record<string, unknown>,
	maybeParams?: Record<string, unknown>,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaFetcher } = resolveDeltaFetcherArgs(
		ynabAPI,
		(deltaFetcherOrParams ?? {}) as DeltaFetcher | Record<string, unknown>,
		maybeParams,
	);
	return await withToolErrorHandling(
		async () => {
			// Always use cache unless explicitly disabled
			const result = await deltaFetcher.fetchBudgets();
			const budgets = result.data;
			const wasCached = result.wasCached;

			const dataObject = {
				budgets: budgets.map((budget) => ({
					id: budget.id,
					name: budget.name,
					last_modified_on: budget.last_modified_on,
					first_month: budget.first_month,
					last_month: budget.last_month,
					date_format: budget.date_format,
					currency_format: budget.currency_format ?? undefined,
				})),
				cached: wasCached,
				cache_info: wasCached
					? `Data retrieved from cache for improved performance${result.usedDelta ? " (delta merge applied)" : ""}`
					: "Fresh data retrieved from YNAB API",
			};
			const fmt =
				((maybeParams as Record<string, unknown>)?.["response_format"] as
					| string
					| undefined) ?? "markdown";
			return {
				content: [
					{
						type: "text",
						text:
							fmt === "markdown"
								? formatBudgetsList(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:list_budgets",
		"listing budgets",
		errorHandler,
	);
}

/**
 * Handles the ynab:get_budget tool call
 * Gets detailed information for a specific budget
 */
export async function handleGetBudget(
	ynabAPI: ynab.API,
	params: GetBudgetParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	return await withToolErrorHandling(
		async () => {
			const budget = await getBudgetByIdCompat(ynabAPI, params.budget_id);

			const dataObject = {
				budget: {
					id: budget.id,
					name: budget.name,
					last_modified_on: budget.last_modified_on,
					first_month: budget.first_month,
					last_month: budget.last_month,
					date_format: budget.date_format,
					currency_format: budget.currency_format ?? undefined,
					// Return counts instead of full arrays to avoid massive responses
					accounts_count: budget.accounts?.length ?? 0,
					categories_count:
						budget.category_groups?.length ?? budget.categories?.length ?? 0,
					payees_count: budget.payees?.length ?? 0,
					months_count: budget.months?.length ?? 0,
					// Include helpful message
					message:
						"Use list_accounts, list_categories, list_payees, and list_months to get detailed lists",
				},
			};
			const fmt = params.response_format ?? "markdown";
			return {
				content: [
					{
						type: "text",
						text:
							fmt === "markdown"
								? formatBudgetDetail(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:get_budget",
		"getting budget details",
		errorHandler,
	);
}

/**
 * Registers all budget-related tools with the provided registry.
 */
export const registerBudgetTools: ToolFactory = (registry, context) => {
	const { adapt, adaptWithDelta } = createAdapters(context);

	registry.register({
		name: "ynab_list_budgets",
		description: `List all YNAB budgets for the authenticated user.

Args:
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: budgets[], cached, cache_info

Examples:
  - List all budgets: call with no args

Errors:
  - "UNAUTHORIZED" → YNAB token expired or invalid`,
		inputSchema: ListBudgetsSchema,
		outputSchema: ListBudgetsOutputSchema,
		handler: adaptWithDelta(handleListBudgets),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: List Budgets",
			},
		},
	});

	registry.register({
		name: "ynab_get_budget",
		description: `Get summary information for a specific YNAB budget.

Args:
  - budget_id (string, required): Budget UUID.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: budget (id, name, currency_format, accounts_count, categories_count, payees_count, months_count)

Examples:
  - Get budget details: set budget_id to the UUID from ynab_list_budgets

Errors:
  - "Budget not found" → invalid or inaccessible budget_id`,
		inputSchema: GetBudgetSchema,
		outputSchema: GetBudgetOutputSchema,
		handler: adapt(handleGetBudget),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Get Budget Details",
			},
		},
	});
};
