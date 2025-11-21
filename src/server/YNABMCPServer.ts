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
import { AuthenticationError, ConfigurationError } from '../utils/errors.js';
import { YNABErrorCode, ValidationError } from '../types/index.js';
import { config } from './config.js';
import { createErrorHandler, ErrorHandler } from './errorHandler.js';
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
  handleCreateTransactions,
  handleCreateReceiptSplitTransaction,
  handleUpdateTransaction,
  handleUpdateTransactions,
  handleDeleteTransaction,
  ListTransactionsSchema,
  GetTransactionSchema,
  CreateTransactionSchema,
  CreateTransactionsSchema,
  CreateReceiptSplitTransactionSchema,
  UpdateTransactionSchema,
  UpdateTransactionsSchema,
  DeleteTransactionSchema,
} from '../tools/transactionTools.js';
import { handleExportTransactions, ExportTransactionsSchema } from '../tools/exportTransactions.js';
import {
  handleCompareTransactions,
  CompareTransactionsSchema,
} from '../tools/compareTransactions/index.js';
import { handleReconcileAccount, ReconcileAccountSchema } from '../tools/reconciliation/index.js';
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
import { cacheManager, CacheManager } from './cacheManager.js';
import { responseFormatter } from './responseFormatter.js';
import {
  ToolRegistry,
  DefaultArgumentResolutionError,
  type ToolDefinition,
  type DefaultArgumentResolver,
  type ToolExecutionPayload,
} from './toolRegistry.js';
import { ResourceManager } from './resources.js';
import { PromptManager } from './prompts.js';
import { DiagnosticManager } from './diagnostics.js';
import { ServerKnowledgeStore } from './serverKnowledgeStore.js';
import { DeltaCache } from './deltaCache.js';
import { DeltaFetcher } from '../tools/deltaFetcher.js';
import { ToolAnnotationPresets } from '../tools/toolCategories.js';
import {
  GetUserOutputSchema,
  ConvertAmountOutputSchema,
  GetDefaultBudgetOutputSchema,
  SetDefaultBudgetOutputSchema,
  ClearCacheOutputSchema,
  SetOutputFormatOutputSchema,
  DiagnosticInfoOutputSchema,
  GetBudgetOutputSchema,
  ListBudgetsOutputSchema,
  ListAccountsOutputSchema,
  GetAccountOutputSchema,
  CreateAccountOutputSchema,
  ListTransactionsOutputSchema,
  GetTransactionOutputSchema,
  ExportTransactionsOutputSchema,
  CompareTransactionsOutputSchema,
  CreateTransactionOutputSchema,
  CreateTransactionsOutputSchema,
  UpdateTransactionOutputSchema,
  UpdateTransactionsOutputSchema,
  DeleteTransactionOutputSchema,
  CreateReceiptSplitTransactionOutputSchema,
  ListCategoriesOutputSchema,
  GetCategoryOutputSchema,
  UpdateCategoryOutputSchema,
  ListPayeesOutputSchema,
  GetPayeeOutputSchema,
  GetMonthOutputSchema,
  ListMonthsOutputSchema,
  ReconcileAccountOutputSchema,
} from '../tools/schemas/outputs/index.js';

/**
 * YNAB MCP Server class that provides integration with You Need A Budget API
 */
export class YNABMCPServer {
  private server: Server;
  private ynabAPI: ynab.API;
  private exitOnError: boolean;
  private defaultBudgetId: string | undefined;
  private serverVersion: string;
  private toolRegistry: ToolRegistry;
  private resourceManager: ResourceManager;
  private promptManager: PromptManager;
  private serverKnowledgeStore: ServerKnowledgeStore;
  private deltaCache: DeltaCache;
  private deltaFetcher: DeltaFetcher;
  private diagnosticManager: DiagnosticManager;
  private errorHandler: ErrorHandler;

  constructor(exitOnError: boolean = true) {
    this.exitOnError = exitOnError;
    // Config is now imported and validated at startup
    this.defaultBudgetId = process.env['YNAB_DEFAULT_BUDGET_ID'];

    // Initialize YNAB API
    this.ynabAPI = new ynab.API(config.YNAB_ACCESS_TOKEN);

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
        const expected = config.YNAB_ACCESS_TOKEN.trim();
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
        accessToken: config.YNAB_ACCESS_TOKEN,
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

    const adaptWithDelta =
      <TInput extends Record<string, unknown>>(
        handler: (
          ynabAPI: ynab.API,
          deltaFetcher: DeltaFetcher,
          params: TInput,
        ) => Promise<CallToolResult>,
      ) =>
      async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
        handler(this.ynabAPI, this.deltaFetcher, input);

    const adaptWrite =
      <TInput extends Record<string, unknown>>(
        handler: (
          ynabAPI: ynab.API,
          deltaCache: DeltaCache,
          knowledgeStore: ServerKnowledgeStore,
          params: TInput,
        ) => Promise<CallToolResult>,
      ) =>
      async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
        handler(this.ynabAPI, this.deltaCache, this.serverKnowledgeStore, input);

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
        include_delta: z.boolean().default(true),
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
      outputSchema: ListBudgetsOutputSchema,
      handler: adaptWithDelta(handleListBudgets),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: List Budgets',
        },
      },
    });

    register({
      name: 'get_budget',
      description: 'Get detailed information for a specific budget',
      inputSchema: GetBudgetSchema,
      outputSchema: GetBudgetOutputSchema,
      handler: adapt(handleGetBudget),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: Get Budget Details',
        },
      },
    });

    register({
      name: 'set_default_budget',
      description: 'Set the default budget for subsequent operations',
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
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
          title: 'YNAB: Set Default Budget',
        },
      },
    });

    register({
      name: 'get_default_budget',
      description: 'Get the currently set default budget',
      inputSchema: emptyObjectSchema,
      outputSchema: GetDefaultBudgetOutputSchema,
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
      metadata: {
        annotations: {
          // Intentionally categorized as UTILITY_LOCAL (not READ_ONLY_EXTERNAL) because
          // this tool only reads local server state without making any YNAB API calls.
          // Compare with set_default_budget which calls ynabAPI.budgets.getBudgetById().
          ...ToolAnnotationPresets.UTILITY_LOCAL,
          title: 'YNAB: Get Default Budget',
        },
      },
    });

    register({
      name: 'list_accounts',
      description: 'List all accounts for a specific budget (uses default budget if not specified)',
      inputSchema: ListAccountsSchema,
      outputSchema: ListAccountsOutputSchema,
      handler: adaptWithDelta(handleListAccounts),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListAccountsSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: List Accounts',
        },
      },
    });

    register({
      name: 'get_account',
      description: 'Get detailed information for a specific account',
      inputSchema: GetAccountSchema,
      outputSchema: GetAccountOutputSchema,
      handler: adapt(handleGetAccount),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetAccountSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: Get Account Details',
        },
      },
    });

    register({
      name: 'create_account',
      description: 'Create a new account in the specified budget',
      inputSchema: CreateAccountSchema,
      outputSchema: CreateAccountOutputSchema,
      handler: adaptWrite(handleCreateAccount),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof CreateAccountSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_CREATE,
          title: 'YNAB: Create Account',
        },
      },
    });

    register({
      name: 'list_transactions',
      description: 'List transactions for a budget with optional filtering',
      inputSchema: ListTransactionsSchema,
      outputSchema: ListTransactionsOutputSchema,
      handler: adaptWithDelta(handleListTransactions),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListTransactionsSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: List Transactions',
        },
      },
    });

    register({
      name: 'export_transactions',
      description: 'Export all transactions to a JSON file with descriptive filename',
      inputSchema: ExportTransactionsSchema,
      outputSchema: ExportTransactionsOutputSchema,
      handler: adapt(handleExportTransactions),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ExportTransactionsSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: Export Transactions',
        },
      },
    });

    register({
      name: 'compare_transactions',
      description:
        'Compare bank transactions from CSV with YNAB transactions to find missing entries',
      inputSchema: CompareTransactionsSchema,
      outputSchema: CompareTransactionsOutputSchema,
      handler: adapt(handleCompareTransactions),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof CompareTransactionsSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: Compare Transactions',
        },
      },
    });

    register({
      name: 'reconcile_account',
      description:
        'Guided reconciliation workflow with human narrative, insight detection, and optional execution (create/update/unclear). Set include_structured_data=true to also get full JSON output (large).',
      inputSchema: ReconcileAccountSchema,
      outputSchema: ReconcileAccountOutputSchema,
      handler: adaptWithDelta(handleReconcileAccount),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ReconcileAccountSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
          title: 'YNAB: Reconcile Account',
        },
      },
    });

    register({
      name: 'get_transaction',
      description: 'Get detailed information for a specific transaction',
      inputSchema: GetTransactionSchema,
      outputSchema: GetTransactionOutputSchema,
      handler: adapt(handleGetTransaction),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetTransactionSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: Get Transaction Details',
        },
      },
    });

    register({
      name: 'create_transaction',
      description: 'Create a new transaction in the specified budget and account',
      inputSchema: CreateTransactionSchema,
      outputSchema: CreateTransactionOutputSchema,
      handler: adaptWrite(handleCreateTransaction),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof CreateTransactionSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_CREATE,
          title: 'YNAB: Create Transaction',
        },
      },
    });

    register({
      name: 'create_transactions',
      description:
        'Create multiple transactions in a single batch (1-100 items) with duplicate detection, dry-run validation, and automatic response size management with correlation metadata.',
      inputSchema: CreateTransactionsSchema,
      outputSchema: CreateTransactionsOutputSchema,
      handler: adaptWrite(handleCreateTransactions),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof CreateTransactionsSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_CREATE,
          title: 'YNAB: Create Multiple Transactions',
        },
      },
    });

    register({
      name: 'update_transactions',
      description:
        'Update multiple transactions in a single batch (1-100 items) with dry-run validation, automatic cache invalidation, and response size management. Supports optional original_account_id and original_date metadata for efficient cache invalidation.',
      inputSchema: UpdateTransactionsSchema,
      outputSchema: UpdateTransactionsOutputSchema,
      handler: adaptWrite(handleUpdateTransactions),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof UpdateTransactionsSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
          title: 'YNAB: Update Multiple Transactions',
        },
      },
    });

    register({
      name: 'create_receipt_split_transaction',
      description: 'Create a split transaction from receipt items with proportional tax allocation',
      inputSchema: CreateReceiptSplitTransactionSchema,
      outputSchema: CreateReceiptSplitTransactionOutputSchema,
      handler: adaptWrite(handleCreateReceiptSplitTransaction),
      defaultArgumentResolver:
        resolveBudgetId<z.infer<typeof CreateReceiptSplitTransactionSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_CREATE,
          title: 'YNAB: Create Split Transaction from Receipt',
        },
      },
    });

    register({
      name: 'update_transaction',
      description: 'Update an existing transaction',
      inputSchema: UpdateTransactionSchema,
      outputSchema: UpdateTransactionOutputSchema,
      handler: adaptWrite(handleUpdateTransaction),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof UpdateTransactionSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
          title: 'YNAB: Update Transaction',
        },
      },
    });

    register({
      name: 'delete_transaction',
      description: 'Delete a transaction from the specified budget',
      inputSchema: DeleteTransactionSchema,
      outputSchema: DeleteTransactionOutputSchema,
      handler: adaptWrite(handleDeleteTransaction),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof DeleteTransactionSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_DELETE,
          title: 'YNAB: Delete Transaction',
        },
      },
    });

    register({
      name: 'list_categories',
      description: 'List all categories for a specific budget',
      inputSchema: ListCategoriesSchema,
      outputSchema: ListCategoriesOutputSchema,
      handler: adaptWithDelta(handleListCategories),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListCategoriesSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: List Categories',
        },
      },
    });

    register({
      name: 'get_category',
      description: 'Get detailed information for a specific category',
      inputSchema: GetCategorySchema,
      outputSchema: GetCategoryOutputSchema,
      handler: adapt(handleGetCategory),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetCategorySchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: Get Category Details',
        },
      },
    });

    register({
      name: 'update_category',
      description: 'Update the budgeted amount for a category in the current month',
      inputSchema: UpdateCategorySchema,
      outputSchema: UpdateCategoryOutputSchema,
      handler: adaptWrite(handleUpdateCategory),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof UpdateCategorySchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
          title: 'YNAB: Update Category Budget',
        },
      },
    });

    register({
      name: 'list_payees',
      description: 'List all payees for a specific budget',
      inputSchema: ListPayeesSchema,
      outputSchema: ListPayeesOutputSchema,
      handler: adaptWithDelta(handleListPayees),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListPayeesSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: List Payees',
        },
      },
    });

    register({
      name: 'get_payee',
      description: 'Get detailed information for a specific payee',
      inputSchema: GetPayeeSchema,
      outputSchema: GetPayeeOutputSchema,
      handler: adapt(handleGetPayee),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetPayeeSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: Get Payee Details',
        },
      },
    });

    register({
      name: 'get_month',
      description: 'Get budget data for a specific month',
      inputSchema: GetMonthSchema,
      outputSchema: GetMonthOutputSchema,
      handler: adapt(handleGetMonth),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof GetMonthSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: Get Month Budget Data',
        },
      },
    });

    register({
      name: 'list_months',
      description: 'List all months summary data for a budget',
      inputSchema: ListMonthsSchema,
      outputSchema: ListMonthsOutputSchema,
      handler: adaptWithDelta(handleListMonths),
      defaultArgumentResolver: resolveBudgetId<z.infer<typeof ListMonthsSchema>>(),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: List Months',
        },
      },
    });

    register({
      name: 'get_user',
      description: 'Get information about the authenticated user',
      inputSchema: emptyObjectSchema,
      outputSchema: GetUserOutputSchema,
      handler: adaptNoInput(handleGetUser),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
          title: 'YNAB: Get User Information',
        },
      },
    });

    register({
      name: 'convert_amount',
      description: 'Convert between dollars and milliunits with integer arithmetic for precision',
      inputSchema: ConvertAmountSchema,
      outputSchema: ConvertAmountOutputSchema,
      handler: async ({ input }) => handleConvertAmount(input),
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.UTILITY_LOCAL,
          title: 'YNAB: Convert Amount',
        },
      },
    });

    register({
      name: 'diagnostic_info',
      description: 'Get comprehensive diagnostic information about the MCP server',
      inputSchema: diagnosticInfoSchema,
      outputSchema: DiagnosticInfoOutputSchema,
      handler: async ({ input }) => {
        return this.diagnosticManager.collectDiagnostics(input);
      },
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.UTILITY_LOCAL,
          title: 'YNAB: Diagnostic Information',
        },
      },
    });

    register({
      name: 'clear_cache',
      description: 'Clear the in-memory cache (safe, no YNAB data is modified)',
      inputSchema: emptyObjectSchema,
      outputSchema: ClearCacheOutputSchema,
      handler: async () => {
        cacheManager.clear();
        return {
          content: [{ type: 'text', text: responseFormatter.format({ success: true }) }],
        };
      },
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.UTILITY_LOCAL,
          title: 'YNAB: Clear Cache',
        },
      },
    });

    register({
      name: 'set_output_format',
      description: 'Configure default JSON output formatting (minify or pretty spaces)',
      inputSchema: setOutputFormatSchema,
      outputSchema: SetOutputFormatOutputSchema,
      handler: async ({ input }) => {
        const options: { defaultMinify?: boolean; prettySpaces?: number } = {};
        if (typeof input.default_minify === 'boolean') {
          options.defaultMinify = input.default_minify;
        }
        if (typeof input.pretty_spaces === 'number') {
          options.prettySpaces = Math.max(0, Math.min(10, Math.floor(input.pretty_spaces)));
        }
        responseFormatter.configure(options);

        // Build human-readable message describing the new configuration
        const parts: string[] = [];
        if (options.defaultMinify !== undefined) {
          parts.push(`minify=${options.defaultMinify}`);
        }
        if (options.prettySpaces !== undefined) {
          parts.push(`spaces=${options.prettySpaces}`);
        }
        const message =
          parts.length > 0
            ? `Output format configured: ${parts.join(', ')}`
            : 'Output format configured';

        return {
          content: [
            {
              type: 'text',
              text: responseFormatter.format({ success: true, message, options }),
            },
          ],
        };
      },
      metadata: {
        annotations: {
          ...ToolAnnotationPresets.UTILITY_LOCAL,
          title: 'YNAB: Set Output Format',
        },
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
