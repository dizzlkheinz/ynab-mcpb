import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { z, toJSONSchema } from 'zod/v4';
import type { MCPToolAnnotations } from '../types/toolAnnotations.js';

export type SecurityWrapperFactory = <T extends Record<string, unknown>>(
  namespace: string,
  operation: string,
  schema: z.ZodSchema<T>,
) => (
  accessToken: string,
) => (
  params: Record<string, unknown>,
) => (handler: (validated: T) => Promise<CallToolResult>) => Promise<CallToolResult>;

export interface ErrorHandlerContract {
  handleError(error: unknown, context: string): CallToolResult;
  createValidationError(message: string, details?: string, suggestions?: string[]): CallToolResult;
}

export interface ResponseFormatterContract {
  runWithMinifyOverride<T>(minifyOverride: boolean | undefined, fn: () => T): T;
}

export interface ToolRegistryCacheHelpers {
  generateKey?: (...segments: unknown[]) => string;
  invalidate?: (key: string) => void | Promise<void>;
  clear?: () => void | Promise<void>;
}

export interface DefaultArgumentResolverContext {
  name: string;
  accessToken: string;
  rawArguments: Record<string, unknown>;
}
export class DefaultArgumentResolutionError extends Error {
  constructor(public readonly result: CallToolResult) {
    super('Default argument resolution failed');
    this.name = 'DefaultArgumentResolutionError';
  }
}

export type DefaultArgumentResolver<TInput extends Record<string, unknown>> = (
  context: DefaultArgumentResolverContext,
) => Partial<TInput> | Promise<Partial<TInput> | undefined> | undefined;

export interface ToolSecurityOptions {
  namespace?: string;
  operation?: string;
}

export interface ToolMetadataOptions {
  inputJsonSchema?: Record<string, unknown>;
  annotations?: MCPToolAnnotations;
}

export interface ToolExecutionContext {
  accessToken: string;
  name: string;
  operation: string;
  rawArguments: Record<string, unknown>;
  cache?: ToolRegistryCacheHelpers;
}

export interface ToolExecutionPayload<TInput extends Record<string, unknown>> {
  input: TInput;
  context: ToolExecutionContext;
}

export type ToolHandler<TInput extends Record<string, unknown>> = (
  payload: ToolExecutionPayload<TInput>,
) => Promise<CallToolResult>;

export interface ToolDefinition<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema?: z.ZodSchema<TOutput>;
  handler: ToolHandler<TInput>;
  security?: ToolSecurityOptions;
  metadata?: ToolMetadataOptions;
  defaultArgumentResolver?: DefaultArgumentResolver<TInput>;
}

interface RegisteredTool<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
> extends ToolDefinition<TInput, TOutput> {
  readonly security: Required<ToolSecurityOptions>;
}

export interface ToolExecutionOptions {
  name: string;
  accessToken: string;
  arguments?: Record<string, unknown>;
  minifyOverride?: boolean;
}

export interface ToolRegistryDependencies {
  withSecurityWrapper: SecurityWrapperFactory;
  errorHandler: ErrorHandlerContract;
  responseFormatter: ResponseFormatterContract;
  cacheHelpers?: ToolRegistryCacheHelpers;
  validateAccessToken?: (token: string) => Promise<void> | void;
}

const MINIFY_HINT_KEYS = ['minify', '_minify', '__minify'] as const;

export class ToolRegistry {
  private readonly tools = new Map<
    string,
    RegisteredTool<Record<string, unknown>, Record<string, unknown>>
  >();
  private readonly outputValidators = new Map<string, z.ZodSchema<Record<string, unknown>>>();

  constructor(private readonly deps: ToolRegistryDependencies) {}

  register<TInput extends Record<string, unknown>, TOutput extends Record<string, unknown>>(
    definition: ToolDefinition<TInput, TOutput>,
  ): void {
    this.assertValidDefinition(definition);

    if (this.tools.has(definition.name)) {
      throw new Error(`Tool '${definition.name}' is already registered`);
    }

    const resolved: RegisteredTool<TInput, TOutput> = {
      ...definition,
      security: {
        namespace: definition.security?.namespace ?? 'ynab',
        operation: definition.security?.operation ?? definition.name,
      },
    };

    // Type assertion is safe here because TInput/TOutput extend Record<string, unknown>
    // and RegisteredTool is covariant in its type parameters for storage purposes
    const registeredTool = resolved as RegisteredTool<
      Record<string, unknown>,
      Record<string, unknown>
    >;
    this.tools.set(definition.name, registeredTool);

    // Cache output validator if present
    if (definition.outputSchema) {
      this.outputValidators.set(
        definition.name,
        definition.outputSchema as z.ZodSchema<Record<string, unknown>>,
      );
    }
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values()).map((tool) => {
      const inputSchema =
        (tool.metadata?.inputJsonSchema as Tool['inputSchema'] | undefined) ??
        (this.generateJsonSchema(tool.inputSchema) as Tool['inputSchema']);
      const result: Tool = {
        name: tool.name,
        description: tool.description,
        inputSchema,
      };
      if (tool.outputSchema) {
        const outputSchema = this.generateJsonSchema(tool.outputSchema) as Tool['outputSchema'];
        result.outputSchema = outputSchema;
      }
      if (tool.metadata?.annotations) {
        result.annotations = tool.metadata.annotations;
      }
      return result;
    });
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => {
      const definition: ToolDefinition = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        handler: tool.handler,
        security: tool.security,
      };
      if (tool.outputSchema) {
        definition.outputSchema = tool.outputSchema;
      }
      if (tool.metadata) {
        definition.metadata = tool.metadata;
      }
      if (tool.defaultArgumentResolver) {
        definition.defaultArgumentResolver = tool.defaultArgumentResolver;
      }
      return definition;
    });
  }

  async executeTool(options: ToolExecutionOptions): Promise<CallToolResult> {
    const tool = this.tools.get(options.name);
    if (!tool) {
      return this.deps.errorHandler.createValidationError(
        `Unknown tool: ${options.name}`,
        'The requested tool is not registered with the server',
      );
    }

    if (this.deps.validateAccessToken) {
      try {
        await this.deps.validateAccessToken(options.accessToken);
      } catch (error) {
        if (this.isCallToolResult(error)) {
          return error;
        }
        return this.deps.errorHandler.handleError(error, `authenticating ${tool.name}`);
      }
    }

    let defaults: Partial<Record<string, unknown>> | undefined;

    if (tool.defaultArgumentResolver) {
      try {
        defaults = await tool.defaultArgumentResolver({
          name: tool.name,
          accessToken: options.accessToken,
          rawArguments: options.arguments ?? {},
        });
      } catch (error) {
        if (error instanceof DefaultArgumentResolutionError) {
          return error.result;
        }
        if (this.isCallToolResult(error)) {
          return error;
        }
        return this.deps.errorHandler.createValidationError(
          'Invalid parameters',
          error instanceof Error
            ? error.message
            : 'Unknown error during default argument resolution',
        );
      }
    }

    const rawArguments: Record<string, unknown> = {
      ...(defaults ?? {}),
      ...(options.arguments ?? {}),
    };

    const minifyOverride = this.extractMinifyOverride(options, rawArguments);

    const run = async (): Promise<CallToolResult> => {
      try {
        const secured = this.deps.withSecurityWrapper(
          tool.security.namespace,
          tool.security.operation,
          tool.inputSchema,
        )(options.accessToken)(rawArguments);

        return await secured(async (validated) => {
          try {
            const context: ToolExecutionContext = {
              accessToken: options.accessToken,
              name: tool.name,
              operation: tool.security.operation,
              rawArguments,
            };
            if (this.deps.cacheHelpers) {
              context.cache = this.deps.cacheHelpers;
            }
            const handlerResult = await tool.handler({
              input: validated,
              context,
            });
            // Validate output against schema if present
            // Skip validation if handler returned an error
            if (handlerResult.isError) {
              return handlerResult;
            }
            return this.validateOutput(tool.name, handlerResult);
          } catch (handlerError) {
            return this.deps.errorHandler.handleError(
              handlerError,
              `executing ${tool.name} - ${tool.security.operation}`,
            );
          }
        });
      } catch (securityError) {
        return this.normalizeSecurityError(securityError, tool);
      }
    };

    try {
      return await this.deps.responseFormatter.runWithMinifyOverride(minifyOverride, run);
    } catch (formatterError) {
      return this.deps.errorHandler.handleError(
        formatterError,
        `formatting response for ${tool.name}`,
      );
    }
  }

  private isCallToolResult(value: unknown): value is CallToolResult {
    return (
      typeof value === 'object' &&
      value !== null &&
      'content' in (value as Record<string, unknown>) &&
      Array.isArray((value as { content?: unknown }).content)
    );
  }

  private normalizeSecurityError(
    error: unknown,
    tool: RegisteredTool<Record<string, unknown>, Record<string, unknown>>,
  ): CallToolResult {
    if (error instanceof z.ZodError) {
      return this.deps.errorHandler.createValidationError(
        `Invalid parameters for ${tool.name}`,
        error.message,
      );
    }

    if (error instanceof Error && error.message.includes('Validation failed')) {
      return this.deps.errorHandler.createValidationError(
        `Invalid parameters for ${tool.name}`,
        error.message,
      );
    }

    return this.deps.errorHandler.handleError(error, `executing ${tool.name}`);
  }

  private extractMinifyOverride(
    options: ToolExecutionOptions,
    args: Record<string, unknown>,
  ): boolean | undefined {
    if (typeof options.minifyOverride === 'boolean') {
      return options.minifyOverride;
    }

    for (const key of MINIFY_HINT_KEYS) {
      const value = args[key];
      if (typeof value === 'boolean') {
        // Remove the minify hint key from args
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete args[key];
        return value;
      }
    }

    return undefined;
  }

  private assertValidDefinition<
    TInput extends Record<string, unknown>,
    TOutput extends Record<string, unknown>,
  >(definition: ToolDefinition<TInput, TOutput>): void {
    if (!definition || typeof definition !== 'object') {
      throw new Error('Tool definition must be an object');
    }

    if (!definition.name || typeof definition.name !== 'string') {
      throw new Error('Tool definition requires a non-empty name');
    }

    if (!definition.description || typeof definition.description !== 'string') {
      throw new Error(`Tool '${definition.name}' requires a description`);
    }

    if (!definition.inputSchema || typeof definition.inputSchema.parse !== 'function') {
      throw new Error(`Tool '${definition.name}' requires a valid Zod schema`);
    }

    if (definition.outputSchema && typeof definition.outputSchema.parse !== 'function') {
      throw new Error(
        `Tool '${definition.name}' outputSchema must be a valid Zod schema when provided`,
      );
    }

    if (typeof definition.handler !== 'function') {
      throw new Error(`Tool '${definition.name}' requires a handler function`);
    }

    if (
      definition.defaultArgumentResolver &&
      typeof definition.defaultArgumentResolver !== 'function'
    ) {
      throw new Error(
        `Tool '${definition.name}' defaultArgumentResolver must be a function when provided`,
      );
    }
  }

  private generateJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    try {
      return toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' });
    } catch (error) {
      console.warn(`Failed to generate JSON schema for tool: ${error}`);
      return { type: 'object', additionalProperties: true };
    }
  }

  /**
   * Validates handler output against the tool's output schema if present
   */
  private validateOutput(toolName: string, output: CallToolResult): CallToolResult {
    const validator = this.outputValidators.get(toolName);
    if (!validator) {
      // No output schema defined, skip validation
      return output;
    }

    // Extract the actual data from the CallToolResult
    // CallToolResult is { content: Array<{ type: string, text: string, ... }> }
    // We need to parse the text content and validate it
    if (!output.content || output.content.length === 0) {
      return this.deps.errorHandler.createValidationError(
        `Output validation failed for ${toolName}`,
        'Handler returned empty content',
        ['Ensure the handler returns valid content in the response'],
      );
    }

    // Validate all content items (not just the first one)
    const invalidItems: { index: number; reason: string }[] = [];

    for (let i = 0; i < output.content.length; i++) {
      const item = output.content[i];
      if (!item) {
        invalidItems.push({ index: i, reason: 'item is null or undefined' });
      } else if (item.type !== 'text') {
        invalidItems.push({ index: i, reason: `type is "${item.type}" instead of "text"` });
      } else if (typeof item.text !== 'string') {
        invalidItems.push({
          index: i,
          reason: `text property is ${typeof item.text} instead of string`,
        });
      }
    }

    if (invalidItems.length > 0) {
      const invalidItemsDetails = invalidItems
        .map((inv) => `  - Item ${inv.index}: ${inv.reason}`)
        .join('\n');

      return this.deps.errorHandler.createValidationError(
        `Output validation failed for ${toolName}`,
        `Handler returned invalid content items (${invalidItems.length} of ${output.content.length} failed):\n${invalidItemsDetails}`,
        ['Ensure all content items have type="text" and a valid text property'],
      );
    }

    const firstContent = output.content[0]!;
    // TypeScript: After validation above, we know firstContent.type === 'text'
    if (firstContent.type !== 'text') {
      throw new Error('Unexpected: firstContent is not text after validation');
    }

    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(firstContent.text);
    } catch (parseError) {
      return this.deps.errorHandler.createValidationError(
        `Output validation failed for ${toolName}`,
        `Invalid JSON in handler output: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        ['Ensure the handler returns valid JSON'],
      );
    }

    // Validate against schema
    const result = validator.safeParse(parsedOutput);
    if (!result.success) {
      const validationErrors = result.error.issues
        .map((err) => {
          const path = err.path.join('.');
          return path ? `${path}: ${err.message}` : err.message;
        })
        .join('; ');
      return this.deps.errorHandler.createValidationError(
        `Output validation failed for ${toolName}`,
        `Handler output does not match declared output schema: ${validationErrors}`,
        [
          'Check that the handler returns data matching the output schema',
          'Review the tool definition output schema',
        ],
      );
    }

    // Validation passed, return original output
    return output;
  }
}
