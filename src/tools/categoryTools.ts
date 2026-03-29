import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import { CacheKeys } from "../server/cacheKeys.js";
import {
	CACHE_TTLS,
	CacheManager,
	cacheManager,
} from "../server/cacheManager.js";
import type { DeltaCache } from "../server/deltaCache.js";
import type { ErrorHandler } from "../server/errorHandler.js";
import {
	formatCategoriesList,
	formatCategoryDetail,
} from "../server/markdownFormatter.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ServerKnowledgeStore } from "../server/serverKnowledgeStore.js";
import { withToolErrorHandling } from "../types/index.js";
import type { ToolFactory } from "../types/toolRegistration.js";
import { milliunitsToAmount } from "../utils/amountUtils.js";
import { createAdapters, createBudgetResolver } from "./adapters.js";
import type { DeltaFetcher } from "./deltaFetcher.js";
import {
	resolveDeltaFetcherArgs,
	resolveDeltaWriteArgs,
} from "./deltaSupport.js";
import {
	GetCategoryOutputSchema,
	ListCategoriesOutputSchema,
	UpdateCategoryOutputSchema,
} from "./schemas/outputs/index.js";
import { ToolAnnotationPresets } from "./toolCategories.js";

/**
 * Schema for ynab:list_categories tool parameters
 */
export const ListCategoriesSchema = z
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

export type ListCategoriesParams = z.infer<typeof ListCategoriesSchema>;

/**
 * Schema for ynab:get_category tool parameters
 */
export const GetCategorySchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required"),
		category_id: z.string().min(1, "Category ID is required"),
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type GetCategoryParams = z.infer<typeof GetCategorySchema>;

/**
 * Schema for ynab:update_category tool parameters
 */
export const UpdateCategorySchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required"),
		category_id: z.string().min(1, "Category ID is required"),
		budgeted: z
			.number()
			.int("Budgeted amount must be an integer in milliunits"),
		dry_run: z.boolean().optional(),
	})
	.strict();

export type UpdateCategoryParams = z.infer<typeof UpdateCategorySchema>;

/**
 * Convert goal-related monetary fields from milliunits to dollars.
 * Returns an object with the four converted goal fields.
 */
function convertGoalFields(category: ynab.Category) {
	return {
		goal_target:
			category.goal_target != null
				? milliunitsToAmount(category.goal_target)
				: undefined,
		goal_under_funded:
			category.goal_under_funded != null
				? milliunitsToAmount(category.goal_under_funded)
				: undefined,
		goal_overall_funded:
			category.goal_overall_funded != null
				? milliunitsToAmount(category.goal_overall_funded)
				: undefined,
		goal_overall_left:
			category.goal_overall_left != null
				? milliunitsToAmount(category.goal_overall_left)
				: undefined,
	};
}

/**
 * Handles the ynab:list_categories tool call
 * Lists all categories for a specific budget
 */
export async function handleListCategories(
	ynabAPI: ynab.API,
	deltaFetcher: DeltaFetcher,
	params: ListCategoriesParams,
): Promise<CallToolResult>;
export async function handleListCategories(
	ynabAPI: ynab.API,
	params: ListCategoriesParams,
): Promise<CallToolResult>;
export async function handleListCategories(
	ynabAPI: ynab.API,
	deltaFetcherOrParams: DeltaFetcher | ListCategoriesParams,
	maybeParams?: ListCategoriesParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaFetcher, params } = resolveDeltaFetcherArgs(
		ynabAPI,
		deltaFetcherOrParams,
		maybeParams,
	);
	return await withToolErrorHandling(
		async () => {
			const result = await deltaFetcher.fetchCategories(params.budget_id);
			const categoryGroups = result.data;
			const wasCached = result.wasCached;

			// Flatten categories from all category groups
			const flatCategories = categoryGroups.flatMap((group) =>
				group.categories.map((category) => ({
					id: category.id,
					category_group_id: category.category_group_id,
					category_group_name: group.name,
					name: category.name,
					hidden: category.hidden,
					original_category_group_id: category.original_category_group_id,
					note: category.note,
					budgeted: milliunitsToAmount(category.budgeted),
					activity: milliunitsToAmount(category.activity),
					balance: milliunitsToAmount(category.balance),
					goal_type: category.goal_type,
					goal_creation_month: category.goal_creation_month,
					...convertGoalFields(category),
					goal_target_month: category.goal_target_month,
					goal_percentage_complete: category.goal_percentage_complete,
				})),
			);

			// Apply pagination to the flat categories list
			const limit = params.limit ?? 50;
			const offset = params.offset ?? 0;
			const categories = flatCategories.slice(offset, offset + limit);
			const hasMore = offset + limit < flatCategories.length;

			const fmt = params.response_format ?? "markdown";
			const dataObject = {
				categories,
				category_groups: categoryGroups.map((group) => ({
					id: group.id,
					name: group.name,
					hidden: group.hidden,
					deleted: group.deleted,
				})),
				total_count: flatCategories.length,
				returned_count: categories.length,
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
								? formatCategoriesList(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:list_categories",
		"listing categories",
		errorHandler,
	);
}

/**
 * Handles the ynab:get_category tool call
 * Gets detailed information for a specific category
 */
export async function handleGetCategory(
	ynabAPI: ynab.API,
	params: GetCategoryParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	return await withToolErrorHandling(
		async () => {
			// Use enhanced CacheManager wrap method
			const cacheKey = CacheManager.generateKey(
				CacheKeys.CATEGORIES,
				"get",
				params.budget_id,
				params.category_id,
			);
			const wasCached = cacheManager.has(cacheKey);
			const category = await cacheManager.wrap<ynab.Category>(cacheKey, {
				ttl: CACHE_TTLS.CATEGORIES,
				loader: async () => {
					const response = await ynabAPI.categories.getCategoryById(
						params.budget_id,
						params.category_id,
					);
					return response.data.category;
				},
			});

			const fmt = params.response_format ?? "markdown";
			const dataObject = {
				category: {
					id: category.id,
					category_group_id: category.category_group_id,
					name: category.name,
					hidden: category.hidden,
					original_category_group_id: category.original_category_group_id,
					note: category.note,
					budgeted: milliunitsToAmount(category.budgeted),
					activity: milliunitsToAmount(category.activity),
					balance: milliunitsToAmount(category.balance),
					goal_type: category.goal_type,
					goal_creation_month: category.goal_creation_month,
					...convertGoalFields(category),
					goal_target_month: category.goal_target_month,
					goal_percentage_complete: category.goal_percentage_complete,
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
								? formatCategoryDetail(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:get_category",
		"getting category",
		errorHandler,
	);
}

/**
 * Handles the ynab:update_category tool call
 * Updates the budgeted amount for a category in the current month
 */
export async function handleUpdateCategory(
	ynabAPI: ynab.API,
	deltaCache: DeltaCache,
	knowledgeStore: ServerKnowledgeStore,
	params: UpdateCategoryParams,
): Promise<CallToolResult>;
export async function handleUpdateCategory(
	ynabAPI: ynab.API,
	params: UpdateCategoryParams,
): Promise<CallToolResult>;
export async function handleUpdateCategory(
	ynabAPI: ynab.API,
	deltaCacheOrParams: DeltaCache | UpdateCategoryParams,
	knowledgeStoreOrParams?: ServerKnowledgeStore | UpdateCategoryParams,
	maybeParams?: UpdateCategoryParams,
	_errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaCache, knowledgeStore, params } = resolveDeltaWriteArgs(
		deltaCacheOrParams,
		knowledgeStoreOrParams,
		maybeParams,
	);
	try {
		if (params.dry_run) {
			const currentDate = new Date();
			const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-01`;
			const dryRunData = {
				dry_run: true as const,
				action: "ynab_update_category" as const,
				request: {
					budget_id: params.budget_id,
					category_id: params.category_id,
					budgeted: milliunitsToAmount(params.budgeted),
					month: currentMonth,
				},
			};
			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(dryRunData),
					},
				],
				structuredContent: dryRunData,
			};
		}
		// Get current month in YNAB format (YYYY-MM-01)
		const currentDate = new Date();
		const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-01`;

		const response = await ynabAPI.categories.updateMonthCategory(
			params.budget_id,
			currentMonth,
			params.category_id,
			{ category: { budgeted: params.budgeted } },
		);

		const category = response.data.category;

		// Invalidate category-related caches after successful update
		const categoriesListCacheKey = CacheManager.generateKey(
			CacheKeys.CATEGORIES,
			"list",
			params.budget_id,
		);
		const specificCategoryCacheKey = CacheManager.generateKey(
			CacheKeys.CATEGORIES,
			"get",
			params.budget_id,
			params.category_id,
		);
		cacheManager.delete(categoriesListCacheKey);
		cacheManager.delete(specificCategoryCacheKey);

		// Invalidate month-related caches as category budget changes affect month data
		const monthsListCacheKey = CacheManager.generateKey(
			CacheKeys.MONTHS,
			"list",
			params.budget_id,
		);
		const currentMonthCacheKey = CacheManager.generateKey(
			CacheKeys.MONTHS,
			"get",
			params.budget_id,
			currentMonth,
		);
		cacheManager.delete(monthsListCacheKey);
		cacheManager.delete(currentMonthCacheKey);

		deltaCache.invalidate(params.budget_id, CacheKeys.CATEGORIES);
		deltaCache.invalidate(params.budget_id, CacheKeys.MONTHS);
		const serverKnowledge = response.data.server_knowledge;
		if (typeof serverKnowledge === "number") {
			knowledgeStore.update(categoriesListCacheKey, serverKnowledge);
			knowledgeStore.update(monthsListCacheKey, serverKnowledge);
		}

		const updatedCategoryData = {
			category: {
				id: category.id,
				category_group_id: category.category_group_id,
				name: category.name,
				hidden: category.hidden,
				original_category_group_id: category.original_category_group_id,
				note: category.note,
				budgeted: milliunitsToAmount(category.budgeted),
				activity: milliunitsToAmount(category.activity),
				balance: milliunitsToAmount(category.balance),
				goal_type: category.goal_type,
				goal_creation_month: category.goal_creation_month,
				...convertGoalFields(category),
				goal_target_month: category.goal_target_month,
				goal_percentage_complete: category.goal_percentage_complete,
			},
			updated_month: currentMonth,
		};
		return {
			content: [
				{
					type: "text",
					text: responseFormatter.format(updatedCategoryData),
				},
			],
			structuredContent: updatedCategoryData,
		};
	} catch (error) {
		return handleCategoryError(error, "Failed to update category");
	}
}

/**
 * Registers all category-related tools with the registry.
 */
export const registerCategoryTools: ToolFactory = (registry, context) => {
	const { adapt, adaptWithDelta, adaptWrite } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);

	registry.register({
		name: "ynab_list_categories",
		description: `List all budget categories for a budget with pagination.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - limit (int, optional): Max results per page. Default: 50.
  - offset (int, optional): Zero-based offset for pagination. Default: 0.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: categories[], category_groups[], total_count, returned_count, offset, has_more, next_offset, cached, cache_info

Examples:
  - List categories (default budget): call with no args
  - Page 2: set limit=50, offset=50

Errors:
  - "No default budget set" → run ynab_set_default_budget first`,
		inputSchema: ListCategoriesSchema,
		outputSchema: ListCategoriesOutputSchema,
		handler: adaptWithDelta(handleListCategories),
		defaultArgumentResolver: budgetResolver<ListCategoriesParams>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: List Categories",
			},
		},
	});

	registry.register({
		name: "ynab_get_category",
		description: `Get current month details for a specific budget category.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - category_id (string, optional): Category UUID.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: category (id, name, budgeted, activity, balance, goal_type, goal_target, goal_percentage_complete), cached, cache_info

Errors:
  - "No default budget set" → run ynab_set_default_budget first
  - "Category not found" → invalid category_id`,
		inputSchema: GetCategorySchema,
		outputSchema: GetCategoryOutputSchema,
		handler: adapt(handleGetCategory),
		defaultArgumentResolver: budgetResolver<GetCategoryParams>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Get Category Details",
			},
		},
	});

	registry.register({
		name: "ynab_update_category",
		description: `Update the budgeted amount for a category in the current month.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - category_id (string, required): Category UUID.
  - budgeted (int, required): New budgeted amount in milliunits (dollars × 1000).
  - dry_run (boolean, optional): Preview without saving. Default: false.

Returns: updated category with new budgeted, activity, balance.

Examples:
  - Budget $100: set budgeted=100000 (milliunits)
  - Dry run: set dry_run=true

Errors:
  - "No default budget set" → run ynab_set_default_budget first`,
		inputSchema: UpdateCategorySchema,
		outputSchema: UpdateCategoryOutputSchema,
		handler: adaptWrite(handleUpdateCategory),
		defaultArgumentResolver: budgetResolver<UpdateCategoryParams>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
				title: "YNAB: Update Category Budget",
			},
		},
	});
};

/**
 * Handles errors from category-related API calls
 */
function handleCategoryError(
	error: unknown,
	defaultMessage: string,
): CallToolResult {
	let errorMessage = defaultMessage;

	if (error instanceof Error) {
		if (
			error.message.includes("401") ||
			error.message.includes("Unauthorized")
		) {
			errorMessage = "Invalid or expired YNAB access token";
		} else if (
			error.message.includes("403") ||
			error.message.includes("Forbidden")
		) {
			errorMessage = "Insufficient permissions to access YNAB data";
		} else if (
			error.message.includes("404") ||
			error.message.includes("Not Found")
		) {
			errorMessage = "Budget or category not found";
		} else if (
			error.message.includes("429") ||
			error.message.includes("Too Many Requests")
		) {
			errorMessage = "Rate limit exceeded. Please try again later";
		} else if (
			error.message.includes("500") ||
			error.message.includes("Internal Server Error")
		) {
			errorMessage = "YNAB service is currently unavailable";
		}
	}

	return {
		content: [
			{
				type: "text",
				text: responseFormatter.format({
					error: {
						message: errorMessage,
					},
				}),
			},
		],
	};
}
