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
	formatPayeeDetail,
	formatPayeesList,
} from "../server/markdownFormatter.js";
import { responseFormatter } from "../server/responseFormatter.js";
import { withToolErrorHandling } from "../types/index.js";
import type { ToolFactory } from "../types/toolRegistration.js";
import {
	createAdapters,
	createBudgetResolver,
	requireResolvedBudgetId,
} from "./adapters.js";
import type { DeltaFetcher } from "./deltaFetcher.js";
import { resolveDeltaFetcherArgs } from "./deltaSupport.js";
import {
	GetPayeeOutputSchema,
	ListPayeesOutputSchema,
} from "./schemas/outputs/index.js";
import { ToolAnnotationPresets } from "./toolCategories.js";

/**
 * Schema for ynab:list_payees tool parameters
 */
export const ListPayeesSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		limit: z.number().int().positive().optional(),
		offset: z.number().int().min(0).optional(),
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type ListPayeesParams = z.infer<typeof ListPayeesSchema>;

/**
 * Schema for ynab:get_payee tool parameters
 */
export const GetPayeeSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		payee_id: z.string().min(1, "Payee ID is required"),
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type GetPayeeParams = z.infer<typeof GetPayeeSchema>;

/**
 * Handles the ynab:list_payees tool call
 * Lists all payees for a specific budget
 */
export async function handleListPayees(
	ynabAPI: ynab.API,
	deltaFetcher: DeltaFetcher,
	params: ListPayeesParams,
): Promise<CallToolResult>;
export async function handleListPayees(
	ynabAPI: ynab.API,
	params: ListPayeesParams,
): Promise<CallToolResult>;
export async function handleListPayees(
	ynabAPI: ynab.API,
	deltaFetcherOrParams: DeltaFetcher | ListPayeesParams,
	maybeParams?: ListPayeesParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaFetcher, params } = resolveDeltaFetcherArgs(
		ynabAPI,
		deltaFetcherOrParams,
		maybeParams,
	);
	return await withToolErrorHandling(
		async () => {
			const budgetId = requireResolvedBudgetId(params.budget_id);
			const result = await deltaFetcher.fetchPayees(budgetId);
			const allPayees = result.data;
			const wasCached = result.wasCached;

			// Apply pagination
			const limit = params.limit ?? 50;
			const offset = params.offset ?? 0;
			const payees = allPayees.slice(offset, offset + limit);
			const hasMore = offset + limit < allPayees.length;

			const fmt = params.response_format ?? "markdown";
			const dataObject = {
				payees: payees.map((payee) => ({
					id: payee.id,
					name: payee.name,
					transfer_account_id: payee.transfer_account_id,
					deleted: payee.deleted,
				})),
				total_count: allPayees.length,
				returned_count: payees.length,
				offset,
				has_more: hasMore,
				next_offset: hasMore ? offset + limit : undefined,
				cached: wasCached,
				cache_info: wasCached
					? `Data retrieved from cache for improved performance${result.usedDelta ? " (delta merge applied)" : ""}`
					: "Fresh data retrieved from YNAB API",
			};
			return {
				content: [
					{
						type: "text",
						text:
							fmt === "markdown"
								? formatPayeesList(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:list_payees",
		"listing payees",
		errorHandler,
	);
}

/**
 * Handles the ynab:get_payee tool call
 * Gets detailed information for a specific payee
 */
export async function handleGetPayee(
	ynabAPI: ynab.API,
	params: GetPayeeParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	return await withToolErrorHandling(
		async () => {
			const budgetId = requireResolvedBudgetId(params.budget_id);
			// Use enhanced CacheManager wrap method
			const cacheKey = CacheManager.generateKey(
				CacheKeys.PAYEES,
				"get",
				budgetId,
				params.payee_id,
			);
			const wasCached = cacheManager.has(cacheKey);
			const payee = await cacheManager.wrap<ynab.Payee>(cacheKey, {
				ttl: CACHE_TTLS.PAYEES,
				loader: async () => {
					const response = await ynabAPI.payees.getPayeeById(
						budgetId,
						params.payee_id,
					);
					return response.data.payee;
				},
			});

			const fmt = params.response_format ?? "markdown";
			const dataObject = {
				payee: {
					id: payee.id,
					name: payee.name,
					transfer_account_id: payee.transfer_account_id,
					deleted: payee.deleted,
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
								? formatPayeeDetail(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:get_payee",
		"getting payee details",
		errorHandler,
	);
}

/**
 * Registers all payee-related tools with the registry.
 */
export const registerPayeeTools: ToolFactory = (registry, context) => {
	const { adapt, adaptWithDelta } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);

	registry.register({
		name: "ynab_list_payees",
		description: `List all payees for a budget with pagination.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - limit (int, optional): Max results per page. Default: 50.
  - offset (int, optional): Zero-based offset for pagination. Default: 0.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: payees[], total_count, returned_count, offset, has_more, next_offset, cached, cache_info

Examples:
  - List all payees: call with no args
  - Page 2: set limit=50, offset=50

Errors:
  - "No default budget set" → run ynab_set_default_budget first`,
		inputSchema: ListPayeesSchema,
		outputSchema: ListPayeesOutputSchema,
		handler: adaptWithDelta(handleListPayees),
		defaultArgumentResolver: budgetResolver<z.infer<typeof ListPayeesSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: List Payees",
			},
		},
	});

	registry.register({
		name: "ynab_get_payee",
		description: `Get details for a specific payee.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - payee_id (string, required): Payee UUID.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: payee (id, name, transfer_account_id, deleted), cached, cache_info

Errors:
  - "No default budget set" → run ynab_set_default_budget first
  - "Payee not found" → invalid payee_id`,
		inputSchema: GetPayeeSchema,
		outputSchema: GetPayeeOutputSchema,
		handler: adapt(handleGetPayee),
		defaultArgumentResolver: budgetResolver<z.infer<typeof GetPayeeSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Get Payee Details",
			},
		},
	});
};
