/**
 * Resources module for YNAB MCP Server
 *
 * Handles MCP resource definitions, templates, and handlers.
 * Extracted from YNABMCPServer to provide focused, testable resource management.
 */

import {
	ErrorCode,
	type Resource as MCPResource,
	type ResourceTemplate as MCPResourceTemplate,
	McpError,
	type ResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { CACHE_TTLS, CacheManager } from "./cacheManager.js";

/**
 * Custom MCP error code for resource not found.
 * Uses JSON-RPC reserved range (-32000 to -32099) for server errors.
 * @see https://www.jsonrpc.org/specification#error_object
 */
const RESOURCE_NOT_FOUND_ERROR_CODE = -32002;

/**
 * Response formatter interface to avoid direct dependency on concrete implementation
 */
interface ResponseFormatter {
	format(data: unknown): string;
}

/**
 * Resource handler function signature
 */
export type ResourceHandler = (
	uri: string,
	dependencies: ResourceDependencies,
) => Promise<ResourceContents[]>;

/**
 * Template handler function signature
 */
export type TemplateHandler = (
	uri: string,
	params: Record<string, string>,
	dependencies: ResourceDependencies,
) => Promise<ResourceContents[]>;

/**
 * MCP resource annotations for audience, priority, and freshness hints
 */
export interface ResourceAnnotations {
	/** Who this resource is intended for */
	audience?: ("user" | "assistant")[];
	/** Relative priority hint (0.0 = lowest, 1.0 = highest) */
	priority?: number;
}

/**
 * Resource definition structure
 */
export interface ResourceDefinition {
	uri: string;
	name: string;
	description: string;
	mimeType: string;
	annotations?: ResourceAnnotations;
}

/**
 * Resource Template definition structure
 */
export interface ResourceTemplateDefinition extends MCPResourceTemplate {
	handler: TemplateHandler;
}

/**
 * Injectable dependencies for resource handlers
 */
export interface ResourceDependencies {
	ynabAPI: ynab.API;
	responseFormatter: ResponseFormatter;
	cacheManager: CacheManager;
}

/**
 * Default resource handlers
 */
const defaultResourceHandlers: Record<string, ResourceHandler> = {
	"ynab://budgets": async (
		uri,
		{ ynabAPI, responseFormatter, cacheManager },
	) => {
		const cacheKey = CacheManager.generateKey("resources", "budgets", "list");
		return cacheManager.wrap<ResourceContents[]>(cacheKey, {
			ttl: CACHE_TTLS.BUDGETS,
			loader: async () => {
				try {
					const response = await ynabAPI.budgets.getBudgets();
					const budgets = response.data.budgets.map((budget) => ({
						id: budget.id,
						name: budget.name,
						last_modified_on: budget.last_modified_on,
						first_month: budget.first_month,
						last_month: budget.last_month,
						currency_format: budget.currency_format,
					}));

					return [
						{
							uri: uri,
							mimeType: "application/json",
							text: responseFormatter.format({ budgets }),
						},
					];
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to fetch budgets: ${message}`);
				}
			},
		});
	},

	"ynab://user": async (uri, { ynabAPI, responseFormatter, cacheManager }) => {
		const cacheKey = CacheManager.generateKey("resources", "user");
		return cacheManager.wrap<ResourceContents[]>(cacheKey, {
			ttl: CACHE_TTLS.USER_INFO,
			loader: async () => {
				try {
					const response = await ynabAPI.user.getUser();
					const userInfo = response.data.user;
					const user = {
						id: userInfo.id,
					};

					return [
						{
							uri: uri,
							mimeType: "application/json",
							text: responseFormatter.format({ user }),
						},
					];
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					throw new Error(`Failed to fetch user info: ${message}`);
				}
			},
		});
	},
};

/**
 * Default resource definitions
 */
const defaultResourceDefinitions: ResourceDefinition[] = [
	{
		uri: "ynab://budgets",
		name: "YNAB Budgets",
		description: "List of all available budgets",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.8 },
	},
	{
		uri: "ynab://user",
		name: "YNAB User Info",
		description: "Current user information including ID and email address",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.3 },
	},
];

/**
 * Default resource templates
 */
const defaultResourceTemplates: ResourceTemplateDefinition[] = [
	{
		uriTemplate: "ynab://budgets/{budget_id}",
		name: "Budget Details",
		description: "Detailed information for a specific budget",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.7 },
		handler: async (
			uri,
			params,
			{ ynabAPI, responseFormatter, cacheManager },
		) => {
			const budget_id = params["budget_id"];
			if (!budget_id) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Missing budget_id parameter",
				);
			}
			const cacheKey = CacheManager.generateKey(
				"resources",
				"budgets",
				"get",
				budget_id,
			);
			return cacheManager.wrap<ResourceContents[]>(cacheKey, {
				ttl: CACHE_TTLS.BUDGETS,
				loader: async () => {
					try {
						const response = await ynabAPI.budgets.getBudgetById(budget_id);
						return [
							{
								uri,
								mimeType: "application/json",
								text: responseFormatter.format(response.data.budget),
							},
						];
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						throw new Error(`Failed to fetch budget ${budget_id}: ${message}`);
					}
				},
			});
		},
	},
	{
		uriTemplate: "ynab://budgets/{budget_id}/accounts",
		name: "Budget Accounts",
		description: "List of accounts for a specific budget",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.7 },
		handler: async (
			uri,
			params,
			{ ynabAPI, responseFormatter, cacheManager },
		) => {
			const budget_id = params["budget_id"];
			if (!budget_id) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Missing budget_id parameter",
				);
			}
			const cacheKey = CacheManager.generateKey(
				"resources",
				"accounts",
				"list",
				budget_id,
			);
			return cacheManager.wrap<ResourceContents[]>(cacheKey, {
				ttl: CACHE_TTLS.ACCOUNTS,
				loader: async () => {
					try {
						const response = await ynabAPI.accounts.getAccounts(budget_id);
						return [
							{
								uri,
								mimeType: "application/json",
								text: responseFormatter.format(response.data.accounts),
							},
						];
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						throw new Error(
							`Failed to fetch accounts for budget ${budget_id}: ${message}`,
						);
					}
				},
			});
		},
	},
	{
		uriTemplate: "ynab://budgets/{budget_id}/categories",
		name: "Budget Categories",
		description: "Flattened list of all categories for a specific budget",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.6 },
		handler: async (
			uri,
			params,
			{ ynabAPI, responseFormatter, cacheManager },
		) => {
			const budget_id = params["budget_id"];
			if (!budget_id) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Missing budget_id parameter",
				);
			}
			const cacheKey = CacheManager.generateKey(
				"resources",
				"categories",
				"list",
				budget_id,
			);
			return cacheManager.wrap<ResourceContents[]>(cacheKey, {
				ttl: CACHE_TTLS.CATEGORIES,
				loader: async () => {
					try {
						const response = await ynabAPI.categories.getCategories(budget_id);
						const groups = response.data.category_groups;
						const categories = groups.flatMap((group) =>
							group.categories.map((cat) => ({
								id: cat.id,
								category_group_id: cat.category_group_id,
								category_group_name: group.name,
								name: cat.name,
								hidden: cat.hidden,
								note: cat.note,
								budgeted: cat.budgeted,
								activity: cat.activity,
								balance: cat.balance,
								goal_type: cat.goal_type,
								deleted: cat.deleted,
							})),
						);
						return [
							{
								uri,
								mimeType: "application/json",
								text: responseFormatter.format({ categories }),
							},
						];
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						throw new Error(
							`Failed to fetch categories for budget ${budget_id}: ${message}`,
						);
					}
				},
			});
		},
	},
	{
		uriTemplate: "ynab://budgets/{budget_id}/months",
		name: "Budget Months",
		description: "List of month summaries for a specific budget",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.5 },
		handler: async (
			uri,
			params,
			{ ynabAPI, responseFormatter, cacheManager },
		) => {
			const budget_id = params["budget_id"];
			if (!budget_id) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Missing budget_id parameter",
				);
			}
			const cacheKey = CacheManager.generateKey(
				"resources",
				"months",
				"list",
				budget_id,
			);
			return cacheManager.wrap<ResourceContents[]>(cacheKey, {
				ttl: CACHE_TTLS.MONTHS,
				loader: async () => {
					try {
						const response = await ynabAPI.months.getBudgetMonths(budget_id);
						return [
							{
								uri,
								mimeType: "application/json",
								text: responseFormatter.format({
									months: response.data.months,
								}),
							},
						];
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						throw new Error(
							`Failed to fetch months for budget ${budget_id}: ${message}`,
						);
					}
				},
			});
		},
	},
	{
		uriTemplate: "ynab://budgets/{budget_id}/months/{month}",
		name: "Budget Month Detail",
		description:
			"Detailed budget data for a specific month (month = YYYY-MM-DD first of month)",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.5 },
		handler: async (
			uri,
			params,
			{ ynabAPI, responseFormatter, cacheManager },
		) => {
			const budget_id = params["budget_id"];
			const month = params["month"];
			if (!budget_id) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Missing budget_id parameter",
				);
			}
			if (!month) {
				throw new McpError(ErrorCode.InvalidParams, "Missing month parameter");
			}
			const cacheKey = CacheManager.generateKey(
				"resources",
				"months",
				"get",
				budget_id,
				month,
			);
			return cacheManager.wrap<ResourceContents[]>(cacheKey, {
				ttl: CACHE_TTLS.MONTHS,
				loader: async () => {
					try {
						const response = await ynabAPI.months.getBudgetMonth(
							budget_id,
							month,
						);
						return [
							{
								uri,
								mimeType: "application/json",
								text: responseFormatter.format(response.data.month),
							},
						];
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						throw new Error(
							`Failed to fetch month ${month} for budget ${budget_id}: ${message}`,
						);
					}
				},
			});
		},
	},
	{
		uriTemplate: "ynab://budgets/{budget_id}/accounts/{account_id}",
		name: "Account Details",
		description: "Detailed information for a specific account within a budget",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.6 },
		handler: async (
			uri,
			params,
			{ ynabAPI, responseFormatter, cacheManager },
		) => {
			const budget_id = params["budget_id"];
			const account_id = params["account_id"];
			if (!budget_id) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Missing budget_id parameter",
				);
			}
			if (!account_id) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Missing account_id parameter",
				);
			}
			const cacheKey = CacheManager.generateKey(
				"resources",
				"accounts",
				"get",
				budget_id,
				account_id,
			);
			return cacheManager.wrap<ResourceContents[]>(cacheKey, {
				ttl: CACHE_TTLS.ACCOUNTS,
				loader: async () => {
					try {
						const response = await ynabAPI.accounts.getAccountById(
							budget_id,
							account_id,
						);
						return [
							{
								uri,
								mimeType: "application/json",
								text: responseFormatter.format(response.data.account),
							},
						];
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						throw new Error(
							`Failed to fetch account ${account_id} in budget ${budget_id}: ${message}`,
						);
					}
				},
			});
		},
	},
];

/**
 * ResourceManager class that handles resource registration and request handling
 */
export class ResourceManager {
	private dependencies: ResourceDependencies;
	private resourceHandlers: Record<string, ResourceHandler>;
	private resourceDefinitions: ResourceDefinition[];
	private resourceTemplates: ResourceTemplateDefinition[];

	constructor(dependencies: ResourceDependencies) {
		this.dependencies = dependencies;
		this.resourceHandlers = { ...defaultResourceHandlers };
		this.resourceDefinitions = [...defaultResourceDefinitions];
		this.resourceTemplates = [];
		for (const template of defaultResourceTemplates) {
			this.registerTemplate(template);
		}
	}

	/**
	 * Register a new resource with its handler at runtime
	 */
	registerResource(
		definition: ResourceDefinition,
		handler: ResourceHandler,
	): void {
		this.resourceDefinitions.push(definition);
		this.resourceHandlers[definition.uri] = handler;
	}

	/**
	 * Register a new resource template
	 */
	registerTemplate(definition: ResourceTemplateDefinition): void {
		this.validateTemplateDefinition(definition);
		this.resourceTemplates.push(definition);
	}

	/**
	 * Returns list of available resources for MCP resource listing
	 */
	listResources(): { resources: MCPResource[] } {
		return {
			resources: this.resourceDefinitions.map((r) => ({
				uri: r.uri,
				name: r.name,
				description: r.description,
				mimeType: r.mimeType,
				...(r.annotations ? { annotations: r.annotations } : {}),
			})),
		};
	}

	/**
	 * Returns list of available resource templates
	 */
	listResourceTemplates(): { resourceTemplates: MCPResourceTemplate[] } {
		return {
			resourceTemplates: this.resourceTemplates.map((t) => ({
				uriTemplate: t.uriTemplate,
				name: t.name,
				description: t.description,
				mimeType: t.mimeType,
				...(t.annotations ? { annotations: t.annotations } : {}),
			})),
		};
	}

	/**
	 * Handles resource read requests
	 */
	async readResource(uri: string): Promise<{
		contents: ResourceContents[];
	}> {
		// 1. Try exact match first
		const handler = this.resourceHandlers[uri];
		if (handler) {
			return {
				contents: await this.executeResourceHandler(
					() => handler(uri, this.dependencies),
					`resource ${uri}`,
				),
			};
		}

		// 2. Try template matching
		for (const template of this.resourceTemplates) {
			const params = this.matchTemplate(template.uriTemplate, uri);
			if (params) {
				return {
					contents: await this.executeResourceHandler(
						() => template.handler(uri, params, this.dependencies),
						`resource ${uri}`,
					),
				};
			}
		}

		throw new McpError(
			RESOURCE_NOT_FOUND_ERROR_CODE,
			`Resource not found: ${uri}`,
		);
	}

	private async executeResourceHandler(
		handler: () => Promise<ResourceContents[]>,
		label: string,
	): Promise<ResourceContents[]> {
		try {
			return await handler();
		} catch (error) {
			if (error instanceof McpError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new McpError(
				ErrorCode.InternalError,
				`Failed to read ${label}: ${message}`,
			);
		}
	}

	/**
	 * Simple URI template matcher
	 * Supports {param} syntax with validation to prevent regex injection
	 *
	 * @param template - URI template with {param} placeholders
	 * @param uri - Actual URI to match against template
	 * @returns Object with extracted parameters or null if no match
	 */
	private matchTemplate(
		template: string,
		uri: string,
	): Record<string, string> | null {
		// Validate template format (only allow safe characters and template syntax)
		if (!/^[a-z0-9:/\-_{}]+$/i.test(template)) {
			throw new Error("Invalid template format: contains unsafe characters");
		}

		// Extract and validate parameter names
		const paramNames: string[] = [];
		const regexPattern = template
			.replace(/[.*+?^$()|[\]\\]/g, "\\$&") // Escape special regex chars
			.replace(/{([a-z_][a-z0-9_]*)}/gi, (_, name) => {
				paramNames.push(name);
				return "([^/]+)"; // Capture group for parameter value
			});

		// Templates are validated at registration and come from trusted internal sources.
		// If external template registration is introduced, consider a ReDoS-safe matcher.
		const regex = new RegExp(`^${regexPattern}$`);
		const match = uri.match(regex);

		if (match) {
			const result: Record<string, string> = {};
			for (const [i, name] of paramNames.entries()) {
				const value = match[i + 1];
				if (value) {
					// Validate parameter values don't contain path traversal or invalid chars
					if (value.includes("..") || value.includes("\\")) {
						throw new Error(`Invalid parameter value: ${name}=${value}`);
					}
					result[name] = value;
				}
			}
			return result;
		}

		return null;
	}

	/**
	 * Validate template format and parameter names at registration time
	 */
	private validateTemplateDefinition(
		definition: ResourceTemplateDefinition,
	): void {
		const { uriTemplate } = definition;
		if (!/^[a-z0-9:/\-_{}]+$/i.test(uriTemplate)) {
			throw new Error(
				`Invalid template format: contains unsafe characters (${uriTemplate})`,
			);
		}

		const placeholderPattern = /{([^}]+)}/g;
		const paramNames: string[] = [];
		let match = placeholderPattern.exec(uriTemplate);
		while (match !== null) {
			const paramName = match[1] ?? "";
			if (!/^[a-z_][a-z0-9_]*$/i.test(paramName)) {
				throw new Error(
					`Invalid template parameter name '${paramName}' in template ${uriTemplate}`,
				);
			}
			paramNames.push(paramName);
			match = placeholderPattern.exec(uriTemplate);
		}

		const uniqueNames = new Set(paramNames);
		if (uniqueNames.size !== paramNames.length) {
			throw new Error(
				`Duplicate parameter names detected in template ${uriTemplate}`,
			);
		}
	}
}
