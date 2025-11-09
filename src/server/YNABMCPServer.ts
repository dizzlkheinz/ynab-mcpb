import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ReadResourceRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import {
  AuthenticationError,
  ConfigurationError,
  ServerConfig,
  ErrorHandler,
  YNABErrorCode,
  ValidationError,
} from '../types/index.js';
import { createErrorHandler } from './errorHandler.js';
import { BudgetResolver } from './budgetResolver.js';
import { SecurityMiddleware, withSecurityWrapper } from './securityMiddleware.js';
import { handleListBudgets, handleGetBudget, GetBudgetSchema } from '../tools/budgetTools.js';
import {
  handleListAccounts,
  handleGetAccount,
  handleCreateAccount,
  ListAccountsSchema,
  GetAccountSchema,
  CreateAccountSchema,
} from '../tools/accountTools.js';
import {
  handleListTransactions,
  handleGetTransaction,
  handleCreateTransaction,
  handleCreateReceiptSplitTransaction,
  handleUpdateTransaction,
  handleDeleteTransaction,
  ListTransactionsSchema,
  GetTransactionSchema,
  CreateTransactionSchema,
  CreateReceiptSplitTransactionSchema,
  UpdateTransactionSchema,
  DeleteTransactionSchema,
} from '../tools/transactionTools.js';
import { handleExportTransactions, ExportTransactionsSchema } from '../tools/exportTransactions.js';
import {
  handleCompareTransactions,
  CompareTransactionsSchema,
} from '../tools/compareTransactions/index.js';
import {
  handleReconcileAccount,
  ReconcileAccountSchema,
} from '../tools/reconciliation/index.js';
import {
  handleListCategories,
  handleGetCategory,
  handleUpdateCategory,
  ListCategoriesSchema,
  GetCategorySchema,
  UpdateCategorySchema,
} from '../tools/categoryTools.js';
import {
  handleListPayees,
  handleGetPayee,
  ListPayeesSchema,
  GetPayeeSchema,
} from '../tools/payeeTools.js';
import {
  handleGetMonth,
  handleListMonths,
  GetMonthSchema,
  ListMonthsSchema,
} from '../tools/monthTools.js';
import { handleGetUser, handleConvertAmount, ConvertAmountSchema } from '../tools/utilityTools.js';
import { cacheManager, CacheManager, CACHE_TTLS } from './cacheManager.js';
import { responseFormatter } from './responseFormatter.js';
import {
  ToolRegistry,
  DefaultArgumentResolutionError,
  type ToolDefinition,
  type DefaultArgumentResolver,
  type ToolExecutionPayload,
} from './toolRegistry.js';
import { validateEnvironment } from './config.js';
import { ResourceManager } from './resources.js';
import { PromptManager } from './prompts.js';
import { DiagnosticManager } from './diagnostics.js';

/**
 * YNAB MCP Server class that provides integration with You Need A Budget API
 */
export class YNABMCPServer {
  private server: Server;
  private ynabAPI: ynab.API;
  private config: ServerConfig;
  private exitOnError: boolean;
  private defaultBudgetId: string | undefined;
  private serverVersion: string;
  private toolRegistry: ToolRegistry;
  private resourceManager: ResourceManager;
  private promptManager: PromptManager;
  private diagnosticManager: DiagnosticManager;
  private errorHandler: ErrorHandler;

  constructor(exitOnError: boolean = true) {
    this.exitOnError = exitOnError;
    // Validate environment variables
    this.config = validateEnvironment();
    if (this.config.defaultBudgetId !== undefined) {
      this.defaultBudgetId = this.config.defaultBudgetId;
    }

    // Initialize YNAB API
    this.ynabAPI = new ynab.API(this.config.accessToken);

    // Determine server version (prefer package.json)
    this.serverVersion = this.readPackageVersion() ?? '0.0.0';

    // Initialize MCP Server
    this.server = new Server(
      {
        name: 'ynab-mcp-server',
        version: this.serverVersion,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );

    // Create ErrorHandler instance with formatter injection
    this.errorHandler = createErrorHandler(responseFormatter);

    // Set the global default for backward compatibility with static usage
    ErrorHandler.setFormatter(responseFormatter);

    this.toolRegistry = new ToolRegistry({
      withSecurityWrapper,
      errorHandler: this.errorHandler,
      responseFormatter,
      cacheHelpers: {
        generateKey: (...segments: unknown[]) => {
          const normalized = segments.map((segment) => {
            if (
              typeof segment === 'string' ||
              typeof segment === 'number' ||
              typeof segment === 'boolean' ||
              segment === undefined
            ) {
              return segment;
            }
            return JSON.stringify(segment);
          }) as (string | number | boolean | undefined)[];
          return CacheManager.generateKey('tool', ...normalized);
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
            console.error('Failed to clear cache:', error);
          }
        },
      },
      validateAccessToken: (token: string) => {
        const expected = this.config.accessToken.trim();
        const provided = typeof token === 'string' ? token.trim() : '';
        if (!provided) {
          throw this.errorHandler.createYNABError(
            YNABErrorCode.UNAUTHORIZED,
            'validating access token',
            new Error('Missing access token'),
          );
        }
        if (provided !== expected) {
          throw this.errorHandler.createYNABError(
            YNABErrorCode.UNAUTHORIZED,
            'validating access token',
            new Error('Access token mismatch'),
          );
        }
      },
    });

    // Initialize service modules
    this.resourceManager = new ResourceManager({
      ynabAPI: this.ynabAPI,
      responseFormatter,
    });

    this.promptManager = new PromptManager();

    this.diagnosticManager = new DiagnosticManager({
      securityMiddleware: SecurityMiddleware,
      cacheManager,
      responseFormatter,
      serverVersion: this.serverVersion,
    });

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
      if (error instanceof Error) {
        // Check for authentication-related errors
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          throw new AuthenticationError('Invalid or expired YNAB access token');
        }
        if (error.message.includes('403') || error.message.includes('Forbidden')) {
          throw new AuthenticationError('YNAB access token has insufficient permissions');
        }
      }
      throw new AuthenticationError(`Token validation failed: ${error}`);
    }
  }

  /**
   * Sets up MCP server request handlers
   */
  private setupHandlers(): void {
    // Handle list resources requests
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return this.resourceManager.listResources();
    });

    // Handle read resource requests
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      try {
        return await this.resourceManager.readResource(uri);
      } catch (error) {
        return this.errorHandler.handleError(error, `reading resource: ${uri}`);
      }
    });

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
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const rawArgs = (request.params.arguments ?? undefined) as
        | Record<string, unknown>
        | undefined;
      const minifyOverride = this.extractMinifyOverride(rawArgs);

      const sanitizedArgs = rawArgs
        ? (() => {
            const clone: Record<string, unknown> = { ...rawArgs };
            delete clone['minify'];
            delete clone['_minify'];
            delete clone['__minify'];
            return clone;
          })()
        : undefined;

      const executionOptions: {
        name: string;
        accessToken: string;
        arguments: Record<string, unknown>;
        minifyOverride?: boolean;
      } = {
        name: request.params.name,
        accessToken: this.config.accessToken,
        arguments: sanitizedArgs ?? {},
      };

      if (minifyOverride !== undefined) {
        executionOptions.minifyOverride = minifyOverride;
      }

      return await this.toolRegistry.executeTool(executionOptions);
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

    const adapt =
      <TInput extends Record<string, unknown>>(
        handler: (ynabAPI: ynab.API, params: TInput) => Promise<CallToolResult>,
      ) =>
      async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
        handler(this.ynabAPI, input);

    const adaptNoInput =
      (handler: (ynabAPI: ynab.API) => Promise<CallToolResult>) =>
      async (_payload: ToolExecutionPayload<Record<string, unknown>>): Promise<CallToolResult> =>
        handler(this.ynabAPI);

    const resolveBudgetId = <
      TInput extends { budget_id?: string | undefined },
    >(): DefaultArgumentResolver<TInput> => {
      return ({ rawArguments }) => {
        const provided =
          typeof rawArguments['budget_id'] === 'string' && rawArguments['budget_id'].length > 0
            ? (rawArguments['budget_id'] as string)
            : undefined;
        const result = BudgetResolver.resolveBudgetId(provided, this.defaultBudgetId);
        if (typeof result === 'string') {
          return { budget_id: result } as Partial<TInput>;
        }
        throw new DefaultArgumentResolutionError(result);
      };
    };

    const emptyObjectSchema = z.object({}).strict();
    const setDefaultBudgetSchema = z.object({ budget_id: z.string().min(1) }).strict();
    const diagnosticInfoSchema = z
      .object({
        include_memory: z.boolean().default(true),
        include_environment: z.boolean().default(true),
        include_server: z.boolean().default(true),
        include_security: z.boolean().default(true),
        include_cache: z.boolean().default(true),
      })
      .strict();
    const setOutputFormatSchema = z
      .object({
        default_minify: z.boolean().optional(),
        pretty_spaces: z.number().int().min(0).max(10).optional(),
      })
      .strict();

    register({
      name: 'list_budgets',
      description: "List all budgets associated with the user's account",
      inputSchema: emptyObjectSchema,
      handler: adaptNoInput(handleListBudgets),
    });

    register({
      name: 'get_budget',
      description: 'Get detailed information for a specific budget',
      inputSchema: GetBudgetSchema,
      handler: adapt(handleGetBudget),
    });

    register({
      name: 'set_default_budget',
      description: 'Set the default budget for subsequent operations',
      inputSchema: setDefaultBudgetSchema,
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
              type: 'text',
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
    });

    register({
      name: 'get_default_budget',
      description: 'Get the currently set default budget',
      inputSchema: emptyObjectSchema,
      handler: async () => {
        try {
          const defaultBudget = this.getDefaultBudget();
          return {
            content: [
              {
                type: 'text',
                text: responseFormatter.format({
                  default_budget_id: defaultBudget ?? null,
                  has_default: !!defaultBudget,
                  message: defaultBudget
                    ? `Default budget is set to: ${defaultBudget}`
                    : 'No default budget is currently set',
                }),
              },
            ],
          };
        } catch (error) {
          return this.errorHandler.createValidationError(
            'Error getting default budget',
            error instanceof Error ? error.message : 'Unknown error',
          );
        }
      },
    });

    register({
      name: 'list_accounts',
      description: 'List all accounts for a specific budget (uses default budget if not specified)',
      inputSchema: ListAccountsSchema,
      handler: adapt(handleListAccounts),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListAccountsSchema>>(),
    });

    register({
      name: 'get_account',
      description: 'Get detailed information for a specific account',
      inputSchema: GetAccountSchema,
      handler: adapt(handleGetAccount),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetAccountSchema>>(),
    });

    register({
      name: 'create_account',
      description: 'Create a new account in the specified budget',
      inputSchema: CreateAccountSchema,
      handler: adapt(handleCreateAccount),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof CreateAccountSchema>>(),
    });

    register({
      name: 'list_transactions',
      description: 'List transactions for a budget with optional filtering',
      inputSchema: ListTransactionsSchema,
      handler: adapt(handleListTransactions),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListTransactionsSchema>>(),
    });

    register({
      name: 'export_transactions',
      description: 'Export all transactions to a JSON file with descriptive filename',
      inputSchema: ExportTransactionsSchema,
      handler: adapt(handleExportTransactions),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ExportTransactionsSchema>>(),
    });

    register({
      name: 'compare_transactions',
      description:
        'Compare bank transactions from CSV with YNAB transactions to find missing entries',
      inputSchema: CompareTransactionsSchema,
      handler: adapt(handleCompareTransactions),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof CompareTransactionsSchema>>(),
    });

    register({
      name: 'reconcile_account',
      description:
        'Guided reconciliation workflow with human narrative + structured JSON output, insight detection, and optional execution (create/update/unclear).',
      inputSchema: ReconcileAccountSchema,
      handler: adapt(handleReconcileAccount),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ReconcileAccountSchema>>(),
    });

    register({
      name: 'get_transaction',
      description: 'Get detailed information for a specific transaction',
      inputSchema: GetTransactionSchema,
      handler: adapt(handleGetTransaction),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetTransactionSchema>>(),
    });

    register({
      name: 'create_transaction',
      description: 'Create a new transaction in the specified budget and account',
      inputSchema: CreateTransactionSchema,
      handler: adapt(handleCreateTransaction),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof CreateTransactionSchema>>(),
    });

    register({
      name: 'create_receipt_split_transaction',
      description: 'Create a split transaction from receipt items with proportional tax allocation',
      inputSchema: CreateReceiptSplitTransactionSchema,
      handler: adapt(handleCreateReceiptSplitTransaction),
      defaultArgumentResolver:
        resolveBudgetId<z.infer<typeof CreateReceiptSplitTransactionSchema>>(),
    });

    register({
      name: 'update_transaction',
      description: 'Update an existing transaction',
      inputSchema: UpdateTransactionSchema,
      handler: adapt(handleUpdateTransaction),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof UpdateTransactionSchema>>(),
    });

    register({
      name: 'delete_transaction',
      description: 'Delete a transaction from the specified budget',
      inputSchema: DeleteTransactionSchema,
      handler: adapt(handleDeleteTransaction),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof DeleteTransactionSchema>>(),
    });

    register({
      name: 'list_categories',
      description: 'List all categories for a specific budget',
      inputSchema: ListCategoriesSchema,
      handler: adapt(handleListCategories),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListCategoriesSchema>>(),
    });

    register({
      name: 'get_category',
      description: 'Get detailed information for a specific category',
      inputSchema: GetCategorySchema,
      handler: adapt(handleGetCategory),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetCategorySchema>>(),
    });

    register({
      name: 'update_category',
      description: 'Update the budgeted amount for a category in the current month',
      inputSchema: UpdateCategorySchema,
      handler: adapt(handleUpdateCategory),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof UpdateCategorySchema>>(),
    });

    register({
      name: 'list_payees',
      description: 'List all payees for a specific budget',
      inputSchema: ListPayeesSchema,
      handler: adapt(handleListPayees),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListPayeesSchema>>(),
    });

    register({
      name: 'get_payee',
      description: 'Get detailed information for a specific payee',
      inputSchema: GetPayeeSchema,
      handler: adapt(handleGetPayee),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetPayeeSchema>>(),
    });

    register({
      name: 'get_month',
      description: 'Get budget data for a specific month',
      inputSchema: GetMonthSchema,
      handler: adapt(handleGetMonth),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetMonthSchema>>(),
    });

    register({
      name: 'list_months',
      description: 'List all months summary data for a budget',
      inputSchema: ListMonthsSchema,
      handler: adapt(handleListMonths),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListMonthsSchema>>(),
    });

    register({
      name: 'get_user',
      description: 'Get information about the authenticated user',
      inputSchema: emptyObjectSchema,
      handler: adaptNoInput(handleGetUser),
    });

    register({
      name: 'convert_amount',
      description: 'Convert between dollars and milliunits with integer arithmetic for precision',
      inputSchema: ConvertAmountSchema,
      handler: async ({ input }) => handleConvertAmount(input),
    });

    register({
      name: 'diagnostic_info',
      description: 'Get comprehensive diagnostic information about the MCP server',
      inputSchema: diagnosticInfoSchema,
      handler: async ({ input }) => {
        return this.diagnosticManager.collectDiagnostics(input);
      },
    });

    register({
      name: 'clear_cache',
      description: 'Clear the in-memory cache (safe, no YNAB data is modified)',
      inputSchema: emptyObjectSchema,
      handler: async () => {
        cacheManager.clear();
        return {
          content: [{ type: 'text', text: responseFormatter.format({ success: true }) }],
        };
      },
    });

    register({
      name: 'set_output_format',
      description: 'Configure default JSON output formatting (minify or pretty spaces)',
      inputSchema: setOutputFormatSchema,
      handler: async ({ input }) => {
        const options: { defaultMinify?: boolean; prettySpaces?: number } = {};
        if (typeof input.default_minify === 'boolean') {
          options.defaultMinify = input.default_minify;
        }
        if (typeof input.pretty_spaces === 'number') {
          options.prettySpaces = Math.max(0, Math.min(10, Math.floor(input.pretty_spaces)));
        }
        responseFormatter.configure(options);
        return {
          content: [
            {
              type: 'text',
              text: responseFormatter.format({ success: true, options }),
            },
          ],
        };
      },
    });
  }

  private extractMinifyOverride(args: Record<string, unknown> | undefined): boolean | undefined {
    if (!args) {
      return undefined;
    }

    for (const key of ['minify', '_minify', '__minify'] as const) {
      const value = args[key];
      if (typeof value === 'boolean') {
        return value;
      }
    }

    return undefined;
  }

  /**
   * Starts the MCP server with stdio transport
   */
  async run(): Promise<void> {
    try {
      // Validate token before starting server
      await this.validateToken();

      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      console.error('YNAB MCP Server started successfully');
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof ConfigurationError) {
        console.error(`Server startup failed: ${error.message}`);
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
   * Gets the budget ID to use - either provided or default
   *
   * @deprecated This method is deprecated and should not be used.
   * Use BudgetResolver.resolveBudgetId() directly instead, which returns
   * a CallToolResult for errors rather than throwing exceptions.
   *
   * @returns The resolved budget ID string or throws ValidationError
   */
  getBudgetId(providedBudgetId?: string): string {
    const result = BudgetResolver.resolveBudgetId(providedBudgetId, this.defaultBudgetId);
    if (typeof result === 'string') {
      return result;
    }

    // Convert CallToolResult to ValidationError for consistency with ErrorHandler
    const errorText =
      result.content?.[0]?.type === 'text' ? result.content[0].text : 'Budget resolution failed';
    const parsedError = (() => {
      try {
        return JSON.parse(errorText);
      } catch {
        return { error: { message: errorText } };
      }
    })();

    const message = parsedError.error?.message || 'Budget resolution failed';
    throw new ValidationError(message);
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
        // Warm accounts cache
        cacheManager.wrap(CacheManager.generateKey('accounts', 'list', budgetId), {
          ttl: CACHE_TTLS.ACCOUNTS,
          loader: async () => {
            const response = await this.ynabAPI.accounts.getAccounts(budgetId);
            return response.data.accounts;
          },
        }),

        // Warm categories cache
        cacheManager.wrap(CacheManager.generateKey('categories', 'list', budgetId), {
          ttl: CACHE_TTLS.CATEGORIES,
          loader: async () => {
            const response = await this.ynabAPI.categories.getCategories(budgetId);
            return response.data.category_groups;
          },
        }),

        // Warm payees cache
        cacheManager.wrap(CacheManager.generateKey('payees', 'list', budgetId), {
          ttl: CACHE_TTLS.PAYEES,
          loader: async () => {
            const response = await this.ynabAPI.payees.getPayees(budgetId);
            return response.data.payees;
          },
        }),
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
  public async handleGetPrompt(params: { name: string; arguments?: Record<string, unknown> }) {
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
    const candidates = [path.resolve(process.cwd(), 'package.json')];
    try {
      // May fail in bundled CJS builds; guard accordingly
      const metaUrl = (import.meta as unknown as { url?: string })?.url;
      if (metaUrl) {
        const maybe = path.resolve(path.dirname(new URL(metaUrl).pathname), '../../package.json');
        candidates.push(maybe);
      }
    } catch {
      // ignore
    }
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf8');
          const pkg = JSON.parse(raw) as { version?: string };
          if (pkg.version && typeof pkg.version === 'string') return pkg.version;
        }
      } catch {
        // ignore and try next
      }
    }
    return null;
  }
}
