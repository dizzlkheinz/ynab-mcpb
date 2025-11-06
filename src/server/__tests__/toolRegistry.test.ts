import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod/v4';
import type * as ynab from 'ynab';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ToolRegistry,
  ToolDefinition,
  ToolRegistryDependencies,
  ToolExecutionPayload,
} from '../toolRegistry.js';
import {
  handleReconcileAccountV2,
  ReconcileAccountV2Schema,
} from '../../tools/reconciliation/index.js';

function createResult(label: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: label,
      },
    ],
  };
}

function makeTestDeps() {
  const securityInvocations: {
    namespace: string;
    operation: string;
    accessToken: string;
    params: Record<string, unknown>;
  }[] = [];

  const responseFormatter = {
    runWithMinifyOverride: vi.fn(<T>(minifyOverride: boolean | undefined, fn: () => T): T => fn()),
    format: vi.fn((value) => JSON.stringify(value)),
  };

  const errorHandler = {
    createValidationError: vi.fn((message: string, details?: string) => ({
      content: [{
        type: 'text',
        text: `validation:${message}${details ? `:${details}` : ''}`
      }]
    })),
    handleError: vi.fn((error: unknown, context: string) => ({
      content: [{
        type: 'text',
        text: `handled:${context}:${error instanceof Error ? error.message : String(error)}`
      }]
    }))
  };

  const withSecurityWrapper = vi.fn(
    <T extends Record<string, unknown>>(
      namespace: string,
      operation: string,
      schema: z.ZodSchema<T>,
    ) =>
      (accessToken: string) =>
      (params: Record<string, unknown>) =>
      async (handler: (validated: T) => Promise<CallToolResult>) => {
        securityInvocations.push({ namespace, operation, accessToken, params });
        try {
          const validated = schema.parse(params ?? {});
          return await handler(validated);
        } catch (error) {
          return errorHandler.createValidationError(
            `Invalid parameters for ${operation}`,
            error instanceof Error ? error.message : undefined,
          );
        }
      },
  );

  const dependencies: ToolRegistryDependencies = {
    errorHandler,
    responseFormatter,
    withSecurityWrapper,
  };

  return {
    dependencies,
    securityInvocations,
    errorHandler,
    responseFormatter,
    withSecurityWrapper,
  };
}

describe('ToolRegistry', () => {
  let dependencies: ToolRegistryDependencies;
  let registry: ToolRegistry;
  let securityInvocations: {
    namespace: string;
    operation: string;
    accessToken: string;
    params: Record<string, unknown>;
  }[];
  let responseFormatter: ReturnType<typeof makeTestDeps>['responseFormatter'];

  const handlerResult = createResult('handler-success');

  beforeEach(() => {
    const setup = makeTestDeps();
    ({ dependencies, securityInvocations, responseFormatter } = setup);
    registry = new ToolRegistry(dependencies);

    // Spy on error handler methods for testing
    vi.spyOn(dependencies.errorHandler, 'createValidationError');
    vi.spyOn(dependencies.errorHandler, 'handleError');
  });

  const registerSampleTool = (definition?: Partial<ToolDefinition>) => {
    const base: ToolDefinition = {
      name: 'sample_tool',
      description: 'Test tool for registry',
      inputSchema: z.object({
        id: z.string().min(1, 'id required'),
        minify: z.boolean().optional(),
      }),
      handler: vi.fn(async ({ input }: ToolExecutionPayload<{ id: string }>) => {
        return createResult(`handled:${input.id}`);
      }),
      ...definition,
    };

    registry.register(base);
    return base;
  };

  it('registers a tool and exposes it through getToolDefinitions', () => {
    registerSampleTool();

    const definitions = registry.getToolDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.name).toBe('sample_tool');
    expect(definitions[0]?.description).toBe('Test tool for registry');
  });

  it('throws when registering duplicate tool names', () => {
    registerSampleTool();

    expect(() => registerSampleTool()).toThrowError("Tool 'sample_tool' is already registered");
  });

  it('rejects invalid tool definitions', () => {
    expect(() =>
      registry.register({
        // @ts-expect-error intentionally malformed
        name: '',
        description: 'invalid',
        inputSchema: z.object({}),
        handler: null,
      }),
    ).toThrowError('Tool definition requires a non-empty name');
  });

  it('lists tools with generated JSON schema when metadata missing', () => {
    registerSampleTool();

    const tools = registry.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('sample_tool');
    const schema = tools[0]?.inputSchema as Record<string, unknown> | undefined;
    expect(schema).toBeDefined();
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: expect.objectContaining({
        id: expect.objectContaining({ type: 'string' }),
        minify: expect.objectContaining({ type: 'boolean' }),
      }),
      required: ['id'],
    });
    expect(typeof schema?.['$schema']).toBe('string');
  });

  it('prefers custom metadata JSON schema when provided', () => {
    const customSchema = { type: 'object', properties: { foo: { type: 'string' } } };
    registry.register({
      name: 'meta_tool',
      description: 'Has metadata schema',
      inputSchema: z.object({ foo: z.string() }),
      handler: async () => handlerResult,
      metadata: { inputJsonSchema: customSchema },
    });

    const tools = registry.listTools();
    const found = tools.find((tool) => tool.name === 'meta_tool');
    expect(found?.inputSchema).toEqual(customSchema);
  });

  it('executes a registered tool via security wrapper and handler', async () => {
    const handler = vi.fn(async () => handlerResult);
    registry.register({
      name: 'exec_tool',
      description: 'Execute tool',
      inputSchema: z.object({ id: z.string().min(1) }),
      handler,
    });

    const result = await registry.executeTool({
      name: 'exec_tool',
      accessToken: 'token-123',
      arguments: { id: 'abc' },
    });

    expect(result).toEqual(handlerResult);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(securityInvocations).toHaveLength(1);
    expect(securityInvocations[0]).toMatchObject({
      namespace: 'ynab',
      operation: 'exec_tool',
      accessToken: 'token-123',
      params: { id: 'abc' },
    });
  });

  it('routes reconcile_account tools to the v2 handler emitting dual-channel output', async () => {
    const mockYnabAPI = {
      accounts: {
        getAccount: vi.fn().mockResolvedValue({
          data: {
            account: {
              name: 'Checking',
              balance: 0,
              cleared_balance: 0,
              uncleared_balance: 0,
            },
          },
        }),
      },
      budgets: {
        getBudgetById: vi.fn().mockResolvedValue({
          data: { budget: { currency_format: { currency_code: 'USD' } } },
        }),
      },
      transactions: {
        getTransactionsByAccount: vi.fn().mockResolvedValue({ data: { transactions: [] } }),
      },
    } as unknown as ynab.API;

    const adapt = <TInput extends Record<string, unknown>>(
      handler: (api: ynab.API, params: TInput) => Promise<CallToolResult>,
    ) => async ({ input }: ToolExecutionPayload<TInput>) => handler(mockYnabAPI, input);

    registry.register({
      name: 'reconcile_account',
      description: 'Guided reconciliation workflow (v2)',
      inputSchema: ReconcileAccountV2Schema,
      handler: adapt(handleReconcileAccountV2),
    });

    registry.register({
      name: 'reconcile_account_v2',
      description: 'Alias for reconcile_account',
      inputSchema: ReconcileAccountV2Schema,
      handler: adapt(handleReconcileAccountV2),
    });

    const result = await registry.executeTool({
      name: 'reconcile_account',
      accessToken: 'token-xyz',
      arguments: {
        budget_id: 'budget-1',
        account_id: 'account-1',
        csv_data: 'Date,Description,Amount\n2025-10-01,Sample,-1.23',
        statement_balance: -1.23,
      },
    });

    expect(result.content).toHaveLength(2);
    expect(result.content.every((entry) => entry.type === 'text')).toBe(true);
    expect(mockYnabAPI.accounts.getAccount).toHaveBeenCalled();

    const toolNames = registry.listTools().map((tool) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining(['reconcile_account', 'reconcile_account_v2']));
  });

  it('merges default arguments before validation', async () => {
    registry.register({
      name: 'defaulted_tool',
      description: 'Has defaults',
      inputSchema: z.object({ id: z.string() }),
      defaultArgumentResolver: vi.fn(async () => ({ id: 'resolved-id' })),
      handler: vi.fn(async () => handlerResult),
    });

    await registry.executeTool({ name: 'defaulted_tool', accessToken: 'token-1' });

    expect(securityInvocations[0]?.params).toEqual({ id: 'resolved-id' });
  });

  it('passes cache helpers to the handler context when injected', async () => {
    const cacheHelpers = {
      generateKey: vi.fn((...segments: unknown[]) => segments.join(':')),
    };

    dependencies.cacheHelpers = cacheHelpers;
    registry = new ToolRegistry(dependencies);

    const handler = vi.fn(async (payload: ToolExecutionPayload<{ id: string }>) => {
      expect(payload.context.cache).toBe(cacheHelpers);
      expect(payload.context.rawArguments).toEqual({ id: '42' });
      return handlerResult;
    });

    registry.register({
      name: 'cache_tool',
      description: 'Needs cache',
      inputSchema: z.object({ id: z.string() }),
      handler,
    });

    await registry.executeTool({
      name: 'cache_tool',
      accessToken: 'token',
      arguments: { id: '42' },
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('extracts minify override from arguments when not explicitly provided', async () => {
    const handler = vi.fn(async () => handlerResult);
    registry.register({
      name: 'minify_hint_tool',
      description: 'Uses argument minify hint',
      inputSchema: z.object({ id: z.string(), _minify: z.boolean().optional() }),
      handler,
    });

    let capturedFn: (() => Promise<CallToolResult>) | undefined;
    let release: ((value: CallToolResult) => void) | undefined;
    const formatterResolution = new Promise<CallToolResult>((resolve) => {
      release = resolve;
    });

    responseFormatter.runWithMinifyOverride.mockImplementationOnce((minify, fn) => {
      capturedFn = fn;
      return formatterResolution;
    });

    const execution = registry.executeTool({
      name: 'minify_hint_tool',
      accessToken: 'token',
      arguments: { id: 'abc', _minify: false },
    });

    expect(responseFormatter.runWithMinifyOverride).toHaveBeenCalledWith(
      false,
      expect.any(Function),
    );
    expect(capturedFn).toBeDefined();

    const manualResult = await capturedFn!();
    expect(manualResult).toEqual(handlerResult);
    expect(handler).toHaveBeenCalledTimes(1);

    release?.(manualResult);

    const finalResult = await execution;
    expect(finalResult).toEqual(handlerResult);
  });

  it('prefers explicit minify override option over argument hints', async () => {
    const handler = vi.fn(async () => handlerResult);
    registry.register({
      name: 'minify_option_tool',
      description: 'Uses option minify',
      inputSchema: z.object({ id: z.string(), minify: z.boolean().optional() }),
      handler,
    });

    let capturedFn: (() => Promise<CallToolResult>) | undefined;
    let release: ((value: CallToolResult) => void) | undefined;
    const formatterResolution = new Promise<CallToolResult>((resolve) => {
      release = resolve;
    });

    responseFormatter.runWithMinifyOverride.mockImplementationOnce((minify, fn) => {
      capturedFn = fn;
      return formatterResolution;
    });

    const execution = registry.executeTool({
      name: 'minify_option_tool',
      accessToken: 'token',
      arguments: { id: 'abc', minify: false },
      minifyOverride: true,
    });

    expect(responseFormatter.runWithMinifyOverride).toHaveBeenCalledWith(
      true,
      expect.any(Function),
    );
    expect(capturedFn).toBeDefined();

    const manualResult = await capturedFn!();
    expect(manualResult).toEqual(handlerResult);
    expect(handler).toHaveBeenCalledTimes(1);

    release?.(manualResult);

    const finalResult = await execution;
    expect(finalResult).toEqual(handlerResult);
  });

  it('returns validation error result for unknown tools', async () => {
    const result = await registry.executeTool({ name: 'missing_tool', accessToken: 'token' });

    expect(result).toEqual(
      createResult(
        'validation:Unknown tool: missing_tool:The requested tool is not registered with the server',
      ),
    );
    expect(dependencies.errorHandler.createValidationError).toHaveBeenCalledTimes(1);
  });

  it('surfaces validation failures from security wrapper', async () => {
    registerSampleTool();

    const result = await registry.executeTool({
      name: 'sample_tool',
      accessToken: 'token',
      arguments: {},
    });

    expect(
      result.content[0]?.text?.startsWith('validation:Invalid parameters for sample_tool:'),
    ).toBe(true);
    expect(dependencies.errorHandler.createValidationError).toHaveBeenCalled();
  });

  it('routes handler exceptions to error handler', async () => {
    const handlerError = new Error('boom');
    const handler = vi.fn(async () => {
      throw handlerError;
    });

    registry.register({
      name: 'error_tool',
      description: 'Throws',
      inputSchema: z.object({ id: z.string() }),
      handler,
    });

    const result = await registry.executeTool({
      name: 'error_tool',
      accessToken: 'token',
      arguments: { id: 'abc' },
    });

    expect(result).toEqual(createResult('handled:executing error_tool - error_tool:boom'));
    expect(dependencies.errorHandler.handleError).toHaveBeenCalledWith(
      handlerError,
      'executing error_tool - error_tool',
    );
  });

  it('normalizes unexpected security errors', async () => {
    const error = new Error('rate limit');
    const customDeps: ToolRegistryDependencies = {
      ...dependencies,
      withSecurityWrapper: vi.fn(() => () => () => {
        throw error;
      }),
    };

    const customRegistry = new ToolRegistry(customDeps);

    // Spy on custom error handler methods for testing
    vi.spyOn(customDeps.errorHandler, 'handleError');

    customRegistry.register({
      name: 'security_tool',
      description: 'Security throws',
      inputSchema: z.object({}),
      handler: vi.fn(async () => handlerResult),
    });

    const result = await customRegistry.executeTool({
      name: 'security_tool',
      accessToken: 'token',
    });

    expect(result).toEqual(createResult('handled:executing security_tool:rate limit'));
    expect(customDeps.errorHandler.handleError).toHaveBeenCalledWith(
      error,
      'executing security_tool',
    );
  });

  it('returns permissive schema when conversion fails', () => {
    registry.register({
      name: 'any_tool',
      description: 'Any schema',
      // z.any is not supported by converter and should fallback
      inputSchema: z.any(),
      handler: vi.fn(async () => handlerResult),
    });

    const tool = registry.listTools().find((item) => item.name === 'any_tool');
    const schema = tool?.inputSchema as Record<string, unknown> | undefined;
    expect(schema).toBeDefined();
    expect(typeof schema?.['$schema']).toBe('string');
  });

  it('supports empty registry listings', () => {
    const emptyRegistry = new ToolRegistry(dependencies);
    expect(emptyRegistry.listTools()).toEqual([]);
    expect(emptyRegistry.getToolDefinitions()).toEqual([]);
  });

  describe('ErrorHandler integration', () => {
    it('should use injected ErrorHandler instance', async () => {
      const mockErrorHandler = {
        handleError: vi.fn(() => ({ content: [{ type: 'text', text: 'Mock error' }] })),
        createValidationError: vi.fn(() => ({
          content: [{ type: 'text', text: 'Mock validation error' }],
        })),
      };

      const customDeps = {
        ...dependencies,
        errorHandler: mockErrorHandler,
      };

      const customRegistry = new ToolRegistry(customDeps);

      // Test that the registry uses the injected error handler
      const result = await customRegistry.executeTool({
        name: 'nonexistent_tool',
        accessToken: 'test-token',
      });

      expect(mockErrorHandler.createValidationError).toHaveBeenCalled();
      expect(result.content[0]?.text).toBe('Mock validation error');
    });

    it('should use the same formatter instance for both ErrorHandler and ToolRegistry', () => {
      const { dependencies: deps, responseFormatter: formatter, errorHandler } = makeTestDeps();

      // Both should use the same formatter
      expect(deps.errorHandler).toBe(errorHandler);
      expect(deps.responseFormatter).toBe(formatter);
    });

    it('should implement ErrorHandler contract interface', () => {
      const { errorHandler } = makeTestDeps();

      expect(typeof errorHandler.handleError).toBe('function');
      expect(typeof errorHandler.createValidationError).toBe('function');
    });
  });
});
