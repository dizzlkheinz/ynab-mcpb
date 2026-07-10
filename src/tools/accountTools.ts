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
	formatAccountDetail,
	formatAccountsList,
} from "../server/markdownFormatter.js";
import { invalidateBudgetResourceCaches } from "../server/resourceCacheInvalidation.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ServerKnowledgeStore } from "../server/serverKnowledgeStore.js";
import { withToolErrorHandling } from "../types/index.js";
import type { ToolFactory } from "../types/toolRegistration.js";
import {
	amountToMilliunits,
	milliunitsToAmount,
} from "../utils/amountUtils.js";
import {
	createAdapters,
	createBudgetResolver,
	requireResolvedBudgetId,
} from "./adapters.js";
import type { DeltaFetcher } from "./deltaFetcher.js";
import {
	resolveDeltaFetcherArgs,
	resolveDeltaWriteArgs,
} from "./deltaSupport.js";
import {
	CreateAccountOutputSchema,
	GetAccountOutputSchema,
	ListAccountsOutputSchema,
} from "./schemas/outputs/index.js";
import { ToolAnnotationPresets } from "./toolCategories.js";

/**
 * Schema for ynab:list_accounts tool parameters
 */
export const ListAccountsSchema = z
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

export type ListAccountsParams = z.infer<typeof ListAccountsSchema>;

/**
 * Schema for ynab:get_account tool parameters
 */
export const GetAccountSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		account_id: z.string().min(1, "Account ID is required"),
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type GetAccountParams = z.infer<typeof GetAccountSchema>;

/**
 * Schema for ynab:create_account tool parameters
 */
export const CreateAccountSchema = z
	.object({
		budget_id: z.string().min(1, "Budget ID is required").optional(),
		name: z.string().min(1, "Account name is required"),
		type: z.enum([
			"checking",
			"savings",
			"creditCard",
			"cash",
			"lineOfCredit",
			"otherAsset",
			"otherLiability",
		]),
		balance: z.number().optional(),
		dry_run: z.boolean().optional(),
	})
	.strict();

export type CreateAccountParams = z.infer<typeof CreateAccountSchema>;

/**
 * Handles the ynab:list_accounts tool call
 * Lists all accounts for a specific budget
 */
export async function handleListAccounts(
	ynabAPI: ynab.API,
	deltaFetcher: DeltaFetcher,
	params: ListAccountsParams,
): Promise<CallToolResult>;
export async function handleListAccounts(
	ynabAPI: ynab.API,
	params: ListAccountsParams,
): Promise<CallToolResult>;
export async function handleListAccounts(
	ynabAPI: ynab.API,
	deltaFetcherOrParams: DeltaFetcher | ListAccountsParams,
	maybeParams?: ListAccountsParams,
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
			const result = await deltaFetcher.fetchAccounts(budgetId);
			const allAccounts = result.data;
			const wasCached = result.wasCached;

			// Apply pagination
			const limit = params.limit ?? 50;
			const offset = params.offset ?? 0;
			const accounts = allAccounts.slice(offset, offset + limit);
			const hasMore = offset + limit < allAccounts.length;

			const fmt = params.response_format ?? "markdown";
			const dataObject = {
				accounts: accounts.map((account) => ({
					id: account.id,
					name: account.name,
					type: account.type,
					on_budget: account.on_budget,
					closed: account.closed,
					note: account.note,
					balance: milliunitsToAmount(account.balance),
					cleared_balance: milliunitsToAmount(account.cleared_balance),
					uncleared_balance: milliunitsToAmount(account.uncleared_balance),
					transfer_payee_id: account.transfer_payee_id,
					direct_import_linked: account.direct_import_linked,
					direct_import_in_error: account.direct_import_in_error,
				})),
				total_count: allAccounts.length,
				returned_count: accounts.length,
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
								? formatAccountsList(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:list_accounts",
		"listing accounts",
		errorHandler,
	);
}

/**
 * Handles the ynab:get_account tool call
 * Gets detailed information for a specific account
 */
export async function handleGetAccount(
	ynabAPI: ynab.API,
	params: GetAccountParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	return await withToolErrorHandling(
		async () => {
			const budgetId = requireResolvedBudgetId(params.budget_id);
			// Use enhanced CacheManager wrap method
			const cacheKey = CacheManager.generateKey(
				CacheKeys.ACCOUNTS,
				"get",
				budgetId,
				params.account_id,
			);
			const wasCached = cacheManager.has(cacheKey);
			const account = await cacheManager.wrap<ynab.Account>(cacheKey, {
				ttl: CACHE_TTLS.ACCOUNTS,
				loader: async () => {
					const response = await ynabAPI.accounts.getAccountById(
						budgetId,
						params.account_id,
					);
					return response.data.account;
				},
			});

			const fmt = params.response_format ?? "markdown";
			const dataObject = {
				account: {
					id: account.id,
					name: account.name,
					type: account.type,
					on_budget: account.on_budget,
					closed: account.closed,
					note: account.note,
					balance: milliunitsToAmount(account.balance),
					cleared_balance: milliunitsToAmount(account.cleared_balance),
					uncleared_balance: milliunitsToAmount(account.uncleared_balance),
					transfer_payee_id: account.transfer_payee_id,
					direct_import_linked: account.direct_import_linked,
					direct_import_in_error: account.direct_import_in_error,
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
								? formatAccountDetail(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:get_account",
		"getting account details",
		errorHandler,
	);
}

/**
 * Handles the ynab:create_account tool call
 * Creates a new account in the specified budget
 */
export async function handleCreateAccount(
	ynabAPI: ynab.API,
	deltaCache: DeltaCache,
	knowledgeStore: ServerKnowledgeStore,
	params: CreateAccountParams,
): Promise<CallToolResult>;
export async function handleCreateAccount(
	ynabAPI: ynab.API,
	params: CreateAccountParams,
): Promise<CallToolResult>;
export async function handleCreateAccount(
	ynabAPI: ynab.API,
	deltaCacheOrParams: DeltaCache | CreateAccountParams,
	knowledgeStoreOrParams?: ServerKnowledgeStore | CreateAccountParams,
	maybeParams?: CreateAccountParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	const { deltaCache, params } = resolveDeltaWriteArgs(
		deltaCacheOrParams,
		knowledgeStoreOrParams,
		maybeParams,
	);
	return await withToolErrorHandling(
		async () => {
			if (params.dry_run) {
				const dryRunData = {
					dry_run: true as const,
					action: "ynab_create_account" as const,
					request: {
						budget_id: params.budget_id,
						name: params.name,
						type: params.type,
						balance: params.balance ?? 0,
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
			const accountData: ynab.SaveAccount = {
				name: params.name,
				type: params.type as ynab.SaveAccountType,
				balance:
					params.balance !== undefined ? amountToMilliunits(params.balance) : 0,
			};

			const budgetId = requireResolvedBudgetId(params.budget_id);
			const response = await ynabAPI.accounts.createAccount(budgetId, {
				account: accountData,
			});

			const account = response.data.account;

			// Invalidate accounts list cache after successful account creation
			const accountsListCacheKey = CacheManager.generateKey(
				CacheKeys.ACCOUNTS,
				"list",
				budgetId,
			);
			cacheManager.delete(accountsListCacheKey);
			invalidateBudgetResourceCaches(budgetId, {
				invalidateAccountsList: true,
				accountIds: [account.id],
			});

			deltaCache.invalidate(budgetId, CacheKeys.ACCOUNTS);

			const createdAccountData = {
				account: {
					id: account.id,
					name: account.name,
					type: account.type,
					on_budget: account.on_budget,
					closed: account.closed,
					note: account.note,
					balance: milliunitsToAmount(account.balance),
					cleared_balance: milliunitsToAmount(account.cleared_balance),
					uncleared_balance: milliunitsToAmount(account.uncleared_balance),
					transfer_payee_id: account.transfer_payee_id,
					direct_import_linked: account.direct_import_linked,
					direct_import_in_error: account.direct_import_in_error,
				},
			};
			return {
				content: [
					{
						type: "text",
						text: responseFormatter.format(createdAccountData),
					},
				],
				structuredContent: createdAccountData,
			};
		},
		"ynab:create_account",
		"creating account",
		errorHandler,
	);
}

/**
 * Registers all account-related tools with the registry.
 */
export const registerAccountTools: ToolFactory = (registry, context) => {
	const { adapt, adaptWithDelta, adaptWrite } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);

	registry.register({
		name: "ynab_list_accounts",
		description: `List all accounts for a budget.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - limit (int, optional): Max results per page. Default: 50.
  - offset (int, optional): Zero-based offset for pagination. Default: 0.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: accounts[], total_count, returned_count, offset, has_more, next_offset, cached, cache_info

Examples:
  - List all accounts (default budget): call with no args
  - Page 2: set limit=20, offset=20

Errors:
  - "No default budget set" → run ynab_set_default_budget first
  - "UNAUTHORIZED" → YNAB token expired`,
		inputSchema: ListAccountsSchema,
		outputSchema: ListAccountsOutputSchema,
		handler: adaptWithDelta(handleListAccounts),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof ListAccountsSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: List Accounts",
			},
		},
	});

	registry.register({
		name: "ynab_get_account",
		description: `Get details for a single account including current balance.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - account_id (string, required): Account UUID.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: account (id, name, type, balance, cleared_balance, uncleared_balance, on_budget, closed), cached, cache_info

Errors:
  - "No default budget set" → run ynab_set_default_budget first
  - "Account not found" → invalid account_id`,
		inputSchema: GetAccountSchema,
		outputSchema: GetAccountOutputSchema,
		handler: adapt(handleGetAccount),
		defaultArgumentResolver: budgetResolver<z.infer<typeof GetAccountSchema>>(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Get Account Details",
			},
		},
	});

	registry.register({
		name: "ynab_create_account",
		description: `Create a new account in a YNAB budget.

Args:
  - budget_id (string, optional): Budget UUID. Omit to use the default budget.
  - name (string, required): Account name.
  - type (string, required): One of: checking, savings, creditCard, cash, lineOfCredit, otherAsset, otherLiability.
  - balance (number, optional): Opening balance in dollars. Default: 0.
  - dry_run (boolean, optional): Preview the request without creating. Default: false.

Returns: account object with id, name, type, balance fields.

Examples:
  - Create checking account: set name="My Checking", type="checking"
  - Dry run: set dry_run=true to preview without saving`,
		inputSchema: CreateAccountSchema,
		outputSchema: CreateAccountOutputSchema,
		handler: adaptWrite(handleCreateAccount),
		defaultArgumentResolver:
			budgetResolver<z.infer<typeof CreateAccountSchema>>(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_CREATE,
				title: "YNAB: Create Account",
			},
		},
	});
};
