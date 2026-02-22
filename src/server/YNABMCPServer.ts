import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
	CallToolRequestSchema,
	CompleteRequestSchema,
	ErrorCode,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListResourceTemplatesRequestSchema,
	ListToolsRequestSchema,
	McpError,
	ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as ynab from "ynab";
import { z } from "zod";
import { registerAccountTools } from "../tools/accountTools.js";
import { registerBudgetTools } from "../tools/budgetTools.js";
import { registerCategoryTools } from "../tools/categoryTools.js";
import { DeltaFetcher } from "../tools/deltaFetcher.js";
import { registerMonthTools } from "../tools/monthTools.js";
import { registerPayeeTools } from "../tools/payeeTools.js";
import { registerReconciliationTools } from "../tools/reconciliation/index.js";
import { emptyObjectSchema } from "../tools/schemas/common.js";
import {
	ClearCacheOutputSchema,
	DiagnosticInfoOutputSchema,
	GetDefaultBudgetOutputSchema,
	SetDefaultBudgetOutputSchema,
} from "../tools/schemas/outputs/index.js";
import { ToolAnnotationPresets } from "../tools/toolCategories.js";
import { registerTransactionTools } from "../tools/transactionTools.js";
import { registerUtilityTools } from "../tools/utilityTools.js";
import { ValidationError, YNABErrorCode } from "../types/index.js";
import type { ToolContext } from "../types/toolRegistration.js";
import {
	AuthenticationError,
	ConfigurationError,
	ValidationError as ConfigValidationError,
} from "../utils/errors.js";
import { CacheManager, cacheManager } from "./cacheManager.js";
import { CompletionsManager } from "./completions.js";
import { type AppConfig, loadConfig } from "./config.js";
import { DeltaCache } from "./deltaCache.js";
import { DiagnosticManager } from "./diagnostics.js";
import { createErrorHandler, type ErrorHandler } from "./errorHandler.js";
import {
	formatDefaultBudget,
	formatDiagnosticInfo,
} from "./markdownFormatter.js";
import { PromptManager } from "./prompts.js";
import { ResourceManager } from "./resources.js";
import { responseFormatter } from "./responseFormatter.js";
import {
	SecurityMiddleware,
	withSecurityWrapper,
} from "./securityMiddleware.js";
import { ServerKnowledgeStore } from "./serverKnowledgeStore.js";
import {
	type ProgressCallback,
	type ToolDefinition,
	ToolRegistry,
} from "./toolRegistry.js";

/**
 * YNAB MCP Server class that provides integration with You Need A Budget API
 */
export class YNABMCPServer {
	private server: Server;
	private ynabAPI: ynab.API;
	private exitOnError: boolean;
	private defaultBudgetId: string | undefined;
	private configInstance: AppConfig;
	private serverVersion: string;
	private toolRegistry: ToolRegistry;
	private resourceManager: ResourceManager;
	private promptManager: PromptManager;
	private serverKnowledgeStore: ServerKnowledgeStore;
	private deltaCache: DeltaCache;
	private deltaFetcher: DeltaFetcher;
	private diagnosticManager: DiagnosticManager;
	private errorHandler: ErrorHandler;
	private completionsManager: CompletionsManager;

	constructor(exitOnError = true) {
		this.exitOnError = exitOnError;
		this.configInstance = loadConfig();
		// Config is now imported and validated at startup
		this.defaultBudgetId = this.configInstance.YNAB_DEFAULT_BUDGET_ID;

		// Initialize YNAB API
		this.ynabAPI = new ynab.API(this.configInstance.YNAB_ACCESS_TOKEN);

		// Determine server version (prefer package.json)
		this.serverVersion = this.readPackageVersion() ?? "0.0.0";

		// Initialize MCP Server
		this.server = new Server(
			{
				name: "ynab-mcp-server",
				title: "YNAB MCP Server",
				version: this.serverVersion,
				description:
					"MCP server for YNAB (You Need A Budget) integration — budgets, accounts, transactions, categories, and reconciliation",
				websiteUrl: "https://github.com/dizzlkheinz/ynab-mcpb",
			},
			{
				capabilities: {
					tools: { listChanged: false },
					resources: {
						subscribe: false, // YNAB API has no webhooks; subscriptions not applicable
						listChanged: false,
					},
					prompts: { listChanged: false },
					completions: {},
					logging: {},
				},
			},
		);

		// Create ErrorHandler instance with formatter injection
		this.errorHandler = createErrorHandler(responseFormatter);

		this.toolRegistry = new ToolRegistry({
			withSecurityWrapper,
			errorHandler: this.errorHandler,
			responseFormatter,
			cacheHelpers: {
				generateKey: (...segments: unknown[]) => {
					const normalized = segments.map((segment) => {
						if (
							typeof segment === "string" ||
							typeof segment === "number" ||
							typeof segment === "boolean" ||
							segment === undefined
						) {
							return segment;
						}
						return JSON.stringify(segment);
					}) as (string | number | boolean | undefined)[];
					return CacheManager.generateKey("tool", ...normalized);
				},
				invalidate: (key: string) => {
					try {
						cacheManager.delete(key);
					} catch (error) {
						console.error(`Failed to invalidate cache key "${key}":`, error);
					}
				},
				clear: () => {
					try {
						cacheManager.clear();
					} catch (error) {
						console.error("Failed to clear cache:", error);
					}
				},
			},
			validateAccessToken: (token: string) => {
				const expected = this.configInstance.YNAB_ACCESS_TOKEN.trim();
				const provided = typeof token === "string" ? token.trim() : "";
				if (!provided) {
					throw this.errorHandler.createYNABError(
						YNABErrorCode.UNAUTHORIZED,
						"validating access token",
						new Error("Missing access token"),
					);
				}
				if (provided !== expected) {
					throw this.errorHandler.createYNABError(
						YNABErrorCode.UNAUTHORIZED,
						"validating access token",
						new Error("Access token mismatch"),
					);
				}
			},
		});

		// Initialize service modules
		this.resourceManager = new ResourceManager({
			ynabAPI: this.ynabAPI,
			responseFormatter,
			cacheManager,
		});

		this.promptManager = new PromptManager();

		this.serverKnowledgeStore = new ServerKnowledgeStore();
		this.deltaCache = new DeltaCache(cacheManager, this.serverKnowledgeStore);
		this.deltaFetcher = new DeltaFetcher(this.ynabAPI, this.deltaCache);

		this.diagnosticManager = new DiagnosticManager({
			securityMiddleware: SecurityMiddleware,
			cacheManager,
			responseFormatter,
			serverVersion: this.serverVersion,
			serverKnowledgeStore: this.serverKnowledgeStore,
			deltaCache: this.deltaCache,
		});

		this.completionsManager = new CompletionsManager(
			this.ynabAPI,
			cacheManager,
			() => this.defaultBudgetId,
		);

		this.setupToolRegistry();
		this.setupHandlers();
	}

	/**
	 * Validates the YNAB access token by making a test API call
	 */
	async validateToken(): Promise<boolean> {
		try {
			await this.ynabAPI.user.getUser();
			return true;
		} catch (error) {
			if (this.isMalformedTokenResponse(error)) {
				throw new AuthenticationError(
					"Unexpected response from YNAB during token validation",
				);
			}

			if (error instanceof Error) {
				// Check for authentication-related errors
				if (
					error.message.includes("401") ||
					error.message.includes("Unauthorized")
				) {
					throw new AuthenticationError("Invalid or expired YNAB access token");
				}
				if (
					error.message.includes("403") ||
					error.message.includes("Forbidden")
				) {
					throw new AuthenticationError(
						"YNAB access token has insufficient permissions",
					);
				}

				const reason = error.message || String(error);
				throw new AuthenticationError(`Token validation failed: ${reason}`);
			}

			throw new AuthenticationError(
				`Token validation failed: ${String(error)}`,
			);
		}
	}

	private isMalformedTokenResponse(error: unknown): boolean {
		if (error instanceof SyntaxError) {
			return true;
		}

		const message =
			typeof error === "string"
				? error
				: typeof (error as { message?: unknown })?.message === "string"
					? String((error as { message: unknown }).message)
					: null;

		if (!message) {
			return false;
		}

		const normalized = message.toLowerCase();
		return (
			normalized.includes("unexpected token") ||
			normalized.includes("unexpected end of json") ||
			normalized.includes("<html")
		);
	}

	/**
	 * Sets up MCP server request handlers
	 */
	private setupHandlers(): void {
		// Handle list resources requests
		this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
			return this.resourceManager.listResources();
		});

		// Handle list resource templates requests
		this.server.setRequestHandler(
			ListResourceTemplatesRequestSchema,
			async () => {
				return this.resourceManager.listResourceTemplates();
			},
		);

		// Handle read resource requests
		this.server.setRequestHandler(
			ReadResourceRequestSchema,
			async (request) => {
				const { uri } = request.params;
				return await this.resourceManager.readResource(uri);
			},
		);

		// Handle list prompts requests
		this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
			return this.promptManager.listPrompts();
		});

		// Handle get prompt requests
		this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;
			const result = await this.promptManager.getPrompt(name, args);
			// The SDK expects the result to match the protocol's PromptResponse shape
			return result as unknown as { description?: string; messages: unknown[] };
		});

		// Handle list tools requests
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return {
				tools: this.toolRegistry.listTools(),
			};
		});

		// Handle tool call requests
		this.server.setRequestHandler(
			CallToolRequestSchema,
			async (request, extra) => {
				if (!this.toolRegistry.hasTool(request.params.name)) {
					throw new McpError(
						ErrorCode.InvalidParams,
						`Unknown tool: ${request.params.name}`,
					);
				}
				const rawArgs = (request.params.arguments ?? undefined) as
					| Record<string, unknown>
					| undefined;

				const executionOptions: {
					name: string;
					accessToken: string;
					arguments: Record<string, unknown>;
					sendProgress?: ProgressCallback;
				} = {
					name: request.params.name,
					accessToken: this.configInstance.YNAB_ACCESS_TOKEN,
					arguments: rawArgs ?? {},
				};

				// Create progress callback if client provided a progressToken
				const progressToken = (
					request.params as { _meta?: { progressToken?: string | number } }
				)._meta?.progressToken;
				if (progressToken !== undefined && extra.sendNotification) {
					executionOptions.sendProgress = async (params) => {
						try {
							await extra.sendNotification({
								method: "notifications/progress",
								params: {
									progressToken,
									progress: params.progress,
									...(params.total !== undefined && { total: params.total }),
									...(params.message !== undefined && {
										message: params.message,
									}),
								},
							});
						} catch {
							// Progress notifications are non-critical; allow tool execution to continue.
						}
					};
				}

				return await this.toolRegistry.executeTool(executionOptions);
			},
		);

		// Handle completion requests for autocomplete
		this.server.setRequestHandler(CompleteRequestSchema, async (request) => {
			const { argument, context } = request.params;

			// Get completions from the manager, handling optional context
			const completionContext = context?.arguments
				? { arguments: context.arguments }
				: undefined;
			const result = await this.completionsManager.getCompletions(
				argument.name,
				argument.value,
				completionContext,
			);

			// Return in MCP-compliant format
			return {
				completion: result.completion,
			};
		});
	}

	/**
	 * Registers all tools with the registry to centralize handler execution
	 */
	private setupToolRegistry(): void {
		const register = <TInput extends Record<string, unknown>>(
			definition: ToolDefinition<TInput>,
		): void => {
			this.toolRegistry.register(definition);
		};

		const toolContext: ToolContext = {
			ynabAPI: this.ynabAPI,
			deltaFetcher: this.deltaFetcher,
			deltaCache: this.deltaCache,
			serverKnowledgeStore: this.serverKnowledgeStore,
			getDefaultBudgetId: () => this.defaultBudgetId,
			setDefaultBudget: (budgetId: string) => this.setDefaultBudget(budgetId),
			cacheManager,
			errorHandler: this.errorHandler,
			diagnosticManager: this.diagnosticManager,
		};

		const setDefaultBudgetSchema = z
			.object({ budget_id: z.string().min(1) })
			.strict();
		const diagnosticInfoSchema = z
			.object({
				include_memory: z.boolean().default(true),
				include_environment: z.boolean().default(true),
				include_server: z.boolean().default(true),
				include_security: z.boolean().default(true),
				include_cache: z.boolean().default(true),
				include_delta: z.boolean().default(true),
				response_format: z
					.enum(["json", "markdown"])
					.default("markdown")
					.optional(),
			})
			.strict();
		registerBudgetTools(this.toolRegistry, toolContext);
		registerPayeeTools(this.toolRegistry, toolContext);
		registerCategoryTools(this.toolRegistry, toolContext);
		registerAccountTools(this.toolRegistry, toolContext);
		registerMonthTools(this.toolRegistry, toolContext);
		registerTransactionTools(this.toolRegistry, toolContext);
		registerReconciliationTools(this.toolRegistry, toolContext);
		registerUtilityTools(this.toolRegistry, toolContext);

		// Server-owned inline tools stay here because they depend on instance state (default budget,
		// diagnostics manager, cache manager, response formatter) rather than the factory context.
		register({
			name: "ynab_set_default_budget",
			description: `Set a default budget so other tools don't require budget_id every call.

Args:
  - budget_id (string, required): Budget UUID to set as default. Validates against YNAB API.

Returns: success, default_budget_id, cache_warm_started.

Examples:
  - Set default: provide the UUID from ynab_list_budgets

Errors:
  - "Budget not found" → invalid budget_id`,
			inputSchema: setDefaultBudgetSchema,
			outputSchema: SetDefaultBudgetOutputSchema,
			handler: async ({ input }) => {
				const { budget_id } = input;
				await this.ynabAPI.budgets.getBudgetById(budget_id);
				this.setDefaultBudget(budget_id);

				// Cache warming for frequently accessed data (fire-and-forget)
				this.warmCacheForBudget(budget_id).catch(() => {
					// Silently handle cache warming errors to not affect main operation
				});

				return {
					content: [
						{
							type: "text",
							text: responseFormatter.format({
								success: true,
								message: `Default budget set to: ${budget_id}`,
								default_budget_id: budget_id,
								cache_warm_started: true,
							}),
						},
					],
				};
			},
			metadata: {
				annotations: {
					...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
					title: "YNAB: Set Default Budget",
				},
			},
		});

		const getDefaultBudgetSchema = z
			.object({
				response_format: z
					.enum(["json", "markdown"])
					.default("markdown")
					.optional(),
			})
			.strict();

		register({
			name: "ynab_get_default_budget",
			description: `Get the currently configured default budget ID.

Args:
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: default_budget_id (null if not set), has_default.`,
			inputSchema: getDefaultBudgetSchema,
			outputSchema: GetDefaultBudgetOutputSchema,
			handler: async ({ input }) => {
				try {
					const defaultBudget = this.getDefaultBudget();
					const fmtGDB =
						((input as Record<string, unknown>)["response_format"] as string) ??
						"markdown";
					const dataObjectGDB = {
						default_budget_id: defaultBudget ?? null,
						has_default: !!defaultBudget,
						message: defaultBudget
							? `Default budget is set to: ${defaultBudget}`
							: "No default budget is currently set",
					};
					return {
						content: [
							{
								type: "text",
								text:
									fmtGDB === "markdown"
										? formatDefaultBudget(dataObjectGDB)
										: responseFormatter.format(dataObjectGDB),
							},
						],
					};
				} catch (error) {
					return this.errorHandler.createValidationError(
						"Error getting default budget",
						error instanceof Error ? error.message : "Unknown error",
					);
				}
			},
			metadata: {
				annotations: {
					// Intentionally categorized as local read-only (not READ_ONLY_EXTERNAL) because
					// this tool only reads local server state without making any YNAB API calls.
					// Compare with set_default_budget which calls ynabAPI.budgets.getBudgetById().
					...ToolAnnotationPresets.UTILITY_LOCAL_READ_ONLY,
					title: "YNAB: Get Default Budget",
				},
			},
		});

		register({
			name: "ynab_diagnostic_info",
			description: `Get comprehensive diagnostic information about the MCP server (health, cache, delta, security).

Args:
  - include_memory (boolean, optional): Include memory usage. Default: true.
  - include_environment (boolean, optional): Include env info. Default: true.
  - include_server (boolean, optional): Include server info. Default: true.
  - include_security (boolean, optional): Include security stats. Default: true.
  - include_cache (boolean, optional): Include cache metrics. Default: true.
  - include_delta (boolean, optional): Include delta cache info. Default: true.
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: diagnostics object with requested sections.`,
			inputSchema: diagnosticInfoSchema,
			outputSchema: DiagnosticInfoOutputSchema,
			handler: async ({ input }) => {
				const diagnosticsResult =
					await this.diagnosticManager.collectDiagnostics(input);
				const fmtDiag =
					(input as Record<string, unknown>)["response_format"] ?? "markdown";
				if (fmtDiag === "markdown") {
					const textContent = diagnosticsResult.content.find(
						(c) => c.type === "text",
					);
					if (textContent && "text" in textContent) {
						try {
							const diagData = JSON.parse(textContent.text) as Record<
								string,
								unknown
							>;
							return {
								content: [
									{
										type: "text" as const,
										text: formatDiagnosticInfo(diagData),
									},
								],
							};
						} catch {
							// Fall through to return original
						}
					}
				}
				return diagnosticsResult;
			},
			metadata: {
				annotations: {
					...ToolAnnotationPresets.UTILITY_LOCAL_READ_ONLY,
					title: "YNAB: Diagnostic Information",
				},
			},
		});

		register({
			name: "ynab_clear_cache",
			description: `Clear all in-memory caches. Safe operation — no YNAB data is modified.

Args: (none)

Returns: success.

Use when: you need fresh data after external YNAB changes, or to free memory.`,
			inputSchema: emptyObjectSchema,
			outputSchema: ClearCacheOutputSchema,
			handler: async () => {
				cacheManager.clear();
				return {
					content: [
						{ type: "text", text: responseFormatter.format({ success: true }) },
					],
				};
			},
			metadata: {
				annotations: {
					...ToolAnnotationPresets.UTILITY_LOCAL_MUTATION,
					title: "YNAB: Clear Cache",
				},
			},
		});
	}

	/**
	 * Starts the MCP server with stdio transport
	 */
	async run(): Promise<void> {
		try {
			// Connect transport first so the server can respond to MCP ping/inspect
			// (required for Docker-based registries like Glama that probe the server)
			const transport = new StdioServerTransport();
			await this.server.connect(transport);

			// Validate token after transport is connected (non-fatal)
			try {
				await this.validateToken();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`⚠️ Token validation warning: ${message}`);
				console.error(
					"Server is running but YNAB API calls will fail until a valid token is provided.",
				);
			}

			console.error("YNAB MCP Server started successfully");
		} catch (error) {
			if (
				error instanceof ConfigurationError ||
				error instanceof ConfigValidationError ||
				error instanceof ValidationError ||
				(error as { name?: string })?.name === "ValidationError"
			) {
				console.error(
					`Server startup failed: ${error instanceof Error ? error.message : error}`,
				);
				if (this.exitOnError) {
					process.exit(1);
				} else {
					throw error;
				}
			}
			throw error;
		}
	}

	/**
	 * Gets the YNAB API instance (for testing purposes)
	 */
	getYNABAPI(): ynab.API {
		return this.ynabAPI;
	}

	/**
	 * Gets the MCP server instance (for testing purposes)
	 */
	getServer(): Server {
		return this.server;
	}

	/**
	 * Sets the default budget ID for operations
	 */
	setDefaultBudget(budgetId: string): void {
		this.defaultBudgetId = budgetId;
	}

	/**
	 * Gets the default budget ID
	 */
	getDefaultBudget(): string | undefined {
		return this.defaultBudgetId;
	}

	/**
	 * Clears the default budget ID (primarily for testing purposes)
	 */
	clearDefaultBudget(): void {
		this.defaultBudgetId = undefined;
	}

	/**
	 * Gets the tool registry instance (for testing purposes)
	 */
	getToolRegistry(): ToolRegistry {
		return this.toolRegistry;
	}

	/**
	 * Warm cache for frequently accessed data after setting default budget
	 * Uses fire-and-forget pattern to avoid blocking the main operation
	 * Runs cache warming operations in parallel for faster completion
	 */
	private async warmCacheForBudget(budgetId: string): Promise<void> {
		try {
			// Run all cache warming operations in parallel
			await Promise.all([
				this.deltaFetcher.fetchAccounts(budgetId, { forceFullRefresh: true }),
				this.deltaFetcher.fetchCategories(budgetId, { forceFullRefresh: true }),
				this.deltaFetcher.fetchPayees(budgetId, { forceFullRefresh: true }),
			]);
		} catch {
			// Cache warming failures should not affect the main operation
			// Errors are handled by the caller with a catch block
		}
	}

	/**
	 * Public handler methods for testing and external access
	 */

	/**
	 * Handle list tools request - public method for testing
	 */
	public async handleListTools() {
		return {
			tools: this.toolRegistry.listTools(),
		};
	}

	/**
	 * Handle list resources request - public method for testing
	 */
	public async handleListResources() {
		return this.resourceManager.listResources();
	}

	/**
	 * Handle read resource request - public method for testing
	 */
	public async handleReadResource(params: { uri: string }) {
		const { uri } = params;
		try {
			return await this.resourceManager.readResource(uri);
		} catch (error) {
			return this.errorHandler.handleError(error, `reading resource: ${uri}`);
		}
	}

	/**
	 * Handle list prompts request - public method for testing
	 */
	public async handleListPrompts() {
		return this.promptManager.listPrompts();
	}

	/**
	 * Handle get prompt request - public method for testing
	 */
	public async handleGetPrompt(params: {
		name: string;
		arguments?: Record<string, unknown>;
	}) {
		const { name, arguments: args } = params;
		try {
			const prompt = await this.promptManager.getPrompt(name, args);
			const tools = Array.isArray((prompt as { tools?: unknown[] }).tools)
				? ((prompt as { tools?: unknown[] }).tools as Tool[])
				: undefined;
			return tools ? { ...prompt, tools } : prompt;
		} catch (error) {
			return this.errorHandler.handleError(error, `getting prompt: ${name}`);
		}
	}

	/**
	 * Try to read the package version for accurate server metadata
	 */
	private readPackageVersion(): string | null {
		const candidates = [path.resolve(process.cwd(), "package.json")];
		try {
			// May fail in bundled CJS builds; guard accordingly
			const metaUrl = (import.meta as unknown as { url?: string })?.url;
			if (metaUrl) {
				const maybe = path.resolve(
					path.dirname(new URL(metaUrl).pathname),
					"../../package.json",
				);
				candidates.push(maybe);
			}
		} catch {
			// ignore
		}
		try {
			// CJS bundles can rely on __dirname being defined; add nearby package.json fallbacks
			const dir = typeof __dirname === "string" ? __dirname : undefined;
			if (dir) {
				candidates.push(
					path.resolve(dir, "../../package.json"),
					path.resolve(dir, "../package.json"),
					path.resolve(dir, "package.json"),
				);
			}
		} catch {
			// ignore additional fallbacks
		}
		for (const p of candidates) {
			try {
				if (fs.existsSync(p)) {
					const raw = fs.readFileSync(p, "utf8");
					const pkg = JSON.parse(raw) as { version?: string };
					if (pkg.version && typeof pkg.version === "string")
						return pkg.version;
				}
			} catch {
				// ignore and try next
			}
		}
		return null;
	}
}
