import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { toJSONSchema, z } from "zod/v4";
import { fromZodError } from "zod-validation-error";
import type { MCPToolAnnotations } from "../types/toolAnnotations.js";

export type SecurityWrapperFactory = <T extends Record<string, unknown>>(
	namespace: string,
	operation: string,
	schema: z.ZodSchema<T>,
) => (
	accessToken: string,
) => (
	params: Record<string, unknown>,
) => (
	handler: (validated: T) => Promise<CallToolResult>,
) => Promise<CallToolResult>;

export interface ErrorHandlerContract {
	handleError(error: unknown, context: string): CallToolResult;
	createValidationError(
		message: string,
		details?: string,
		suggestions?: string[],
	): CallToolResult;
}

export interface ResponseFormatterContract {
	format(value: unknown): string;
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
		super("Default argument resolution failed");
		this.name = "DefaultArgumentResolutionError";
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

/**
 * Progress notification callback for long-running operations.
 * Follows MCP spec: notifications/progress
 */
export type ProgressCallback = (params: {
	progress: number;
	total?: number;
	message?: string;
}) => Promise<void>;

export interface ToolExecutionContext {
	accessToken: string;
	name: string;
	operation: string;
	rawArguments: Record<string, unknown>;
	cache?: ToolRegistryCacheHelpers;
	/**
	 * Optional progress callback for emitting MCP progress notifications.
	 * Available when the client provides a progressToken in the request.
	 */
	sendProgress?: ProgressCallback;
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
	/**
	 * Optional progress callback for emitting MCP progress notifications.
	 * Should be provided when the request includes a progressToken.
	 */
	sendProgress?: ProgressCallback;
}

export interface ToolRegistryDependencies {
	withSecurityWrapper: SecurityWrapperFactory;
	errorHandler: ErrorHandlerContract;
	responseFormatter: ResponseFormatterContract;
	cacheHelpers?: ToolRegistryCacheHelpers;
	validateAccessToken?: (token: string) => Promise<void> | void;
}

export class ToolRegistry {
	private readonly tools = new Map<
		string,
		RegisteredTool<Record<string, unknown>, Record<string, unknown>>
	>();
	private readonly outputValidators = new Map<
		string,
		z.ZodSchema<Record<string, unknown>>
	>();

	constructor(private readonly deps: ToolRegistryDependencies) {}

	register<
		TInput extends Record<string, unknown>,
		TOutput extends Record<string, unknown>,
	>(definition: ToolDefinition<TInput, TOutput>): void {
		this.assertValidDefinition(definition);

		if (this.tools.has(definition.name)) {
			throw new Error(`Tool '${definition.name}' is already registered`);
		}

		const resolved: RegisteredTool<TInput, TOutput> = {
			...definition,
			security: {
				namespace: definition.security?.namespace ?? "ynab",
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
			const inputSchema = this.ensureRootObjectJsonSchema(
				(tool.metadata?.inputJsonSchema as Tool["inputSchema"] | undefined) ??
					(this.generateJsonSchema(tool.inputSchema) as Tool["inputSchema"]),
				"input",
				tool.name,
			) as Tool["inputSchema"];
			const result: Tool = {
				name: tool.name,
				description: tool.description,
				inputSchema,
			};
			if (tool.outputSchema) {
				const outputSchema = this.ensureRootObjectJsonSchema(
					this.generateJsonSchema(tool.outputSchema, "output"),
					"output",
					tool.name,
				) as Tool["outputSchema"];
				result.outputSchema = outputSchema;
			}
			if (tool.metadata?.annotations) {
				result.annotations = tool.metadata.annotations;
			}
			return result;
		});
	}

	hasTool(name: string): boolean {
		return this.tools.has(name);
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
				"The requested tool is not registered with the server",
			);
		}

		if (this.deps.validateAccessToken) {
			try {
				await this.deps.validateAccessToken(options.accessToken);
			} catch (error) {
				if (this.isCallToolResult(error)) {
					return error;
				}
				return this.deps.errorHandler.handleError(
					error,
					`authenticating ${tool.name}`,
				);
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
					"Invalid parameters",
					error instanceof Error
						? error.message
						: "Unknown error during default argument resolution",
				);
			}
		}

		const rawArguments: Record<string, unknown> = {
			...(defaults ?? {}),
			...(options.arguments ?? {}),
		};

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
					if (options.sendProgress) {
						context.sendProgress = options.sendProgress;
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
	}

	private isCallToolResult(value: unknown): value is CallToolResult {
		return (
			typeof value === "object" &&
			value !== null &&
			"content" in (value as Record<string, unknown>) &&
			Array.isArray((value as { content?: unknown }).content)
		);
	}

	private normalizeSecurityError(
		error: unknown,
		tool: RegisteredTool<Record<string, unknown>, Record<string, unknown>>,
	): CallToolResult {
		if (error instanceof z.ZodError) {
			const validationError = fromZodError(error);
			return this.deps.errorHandler.createValidationError(
				`Invalid parameters for ${tool.name}`,
				validationError.message,
			);
		}

		if (error instanceof Error && error.message.includes("Validation failed")) {
			return this.deps.errorHandler.createValidationError(
				`Invalid parameters for ${tool.name}`,
				error.message,
			);
		}

		return this.deps.errorHandler.handleError(error, `executing ${tool.name}`);
	}

	/**
	 * Regex pattern for MCP-compliant tool names.
	 * Tool names SHOULD be 1-128 chars, case-sensitive, only [a-zA-Z0-9_.-]
	 * @see https://spec.modelcontextprotocol.io/specification/2024-11-05/server/tools/
	 */
	private static readonly MCP_TOOL_NAME_REGEX = /^[a-zA-Z0-9_.-]{1,128}$/;

	private assertValidDefinition<
		TInput extends Record<string, unknown>,
		TOutput extends Record<string, unknown>,
	>(definition: ToolDefinition<TInput, TOutput>): void {
		if (!definition || typeof definition !== "object") {
			throw new Error("Tool definition must be an object");
		}

		if (!definition.name || typeof definition.name !== "string") {
			throw new Error("Tool definition requires a non-empty name");
		}

		// Validate tool name follows MCP specification guidelines
		if (!ToolRegistry.MCP_TOOL_NAME_REGEX.test(definition.name)) {
			throw new Error(
				`Tool name '${definition.name}' violates MCP guidelines: must be 1-128 chars using only [a-zA-Z0-9_.-]`,
			);
		}

		if (!definition.description || typeof definition.description !== "string") {
			throw new Error(`Tool '${definition.name}' requires a description`);
		}

		if (
			!definition.inputSchema ||
			typeof definition.inputSchema.parse !== "function"
		) {
			throw new Error(`Tool '${definition.name}' requires a valid Zod schema`);
		}

		if (
			definition.outputSchema &&
			typeof definition.outputSchema.parse !== "function"
		) {
			throw new Error(
				`Tool '${definition.name}' outputSchema must be a valid Zod schema when provided`,
			);
		}

		if (typeof definition.handler !== "function") {
			throw new Error(`Tool '${definition.name}' requires a handler function`);
		}

		if (
			definition.defaultArgumentResolver &&
			typeof definition.defaultArgumentResolver !== "function"
		) {
			throw new Error(
				`Tool '${definition.name}' defaultArgumentResolver must be a function when provided`,
			);
		}
	}

	private generateJsonSchema(
		schema: z.ZodTypeAny,
		ioMode: "input" | "output" = "input",
	): Record<string, unknown> {
		try {
			return toJSONSchema(schema, { target: "draft-2020-12", io: ioMode });
		} catch (error) {
			console.warn(`Failed to generate JSON schema for tool: ${error}`);
			return { type: "object", additionalProperties: true };
		}
	}

	private ensureRootObjectJsonSchema(
		schema: Record<string, unknown>,
		schemaKind: "input" | "output",
		toolName: string,
	): Record<string, unknown> {
		const candidate = schema;
		if (candidate["type"] === "object") {
			return candidate;
		}

		const hasComposedRoot =
			Array.isArray(candidate["anyOf"]) ||
			Array.isArray(candidate["oneOf"]) ||
			Array.isArray(candidate["allOf"]);
		if (hasComposedRoot) {
			return {
				...candidate,
				type: "object",
			};
		}

		console.warn(
			`Generated ${schemaKind} schema for tool '${toolName}' is not an object root; using permissive object fallback.`,
		);
		return {
			type: "object",
			additionalProperties: true,
		};
	}

	/**
	 * Validates handler output against the tool's output schema if present
	 */
	private validateOutput(
		toolName: string,
		output: CallToolResult,
	): CallToolResult {
		const validator = this.outputValidators.get(toolName);
		if (!validator) {
			// No output schema defined, skip validation
			return output;
		}

		// Validate content items regardless of whether structuredContent is present.
		// This must run before the structuredContent fast-path so that malformed
		// content is caught centrally rather than surfacing as an MCP SDK error later.
		if (!output.content || output.content.length === 0) {
			return this.deps.errorHandler.createValidationError(
				`Output validation failed for ${toolName}`,
				"Handler returned empty content",
				["Ensure the handler returns valid content in the response"],
			);
		}

		// Validate all content items (not just the first one)
		const invalidItems: { index: number; reason: string }[] = [];

		for (let i = 0; i < output.content.length; i++) {
			const item = output.content[i];
			if (!item) {
				invalidItems.push({ index: i, reason: "item is null or undefined" });
			} else if (item.type !== "text") {
				invalidItems.push({
					index: i,
					reason: `type is "${item.type}" instead of "text"`,
				});
			} else if (typeof item.text !== "string") {
				invalidItems.push({
					index: i,
					reason: `text property is ${typeof item.text} instead of string`,
				});
			}
		}

		if (invalidItems.length > 0) {
			const invalidItemsDetails = invalidItems
				.map((inv) => `  - Item ${inv.index}: ${inv.reason}`)
				.join("\n");

			return this.deps.errorHandler.createValidationError(
				`Output validation failed for ${toolName}`,
				`Handler returned invalid content items (${invalidItems.length} of ${output.content.length} failed):\n${invalidItemsDetails}`,
				['Ensure all content items have type="text" and a valid text property'],
			);
		}

		const firstContent = output.content[0];
		if (!firstContent) {
			return this.deps.errorHandler.createValidationError(
				`Output validation failed for ${toolName}`,
				"Handler returned empty content",
				["Ensure the handler returns valid content in the response"],
			);
		}
		// TypeScript: After validation above, we know firstContent.type === 'text'
		if (firstContent.type !== "text") {
			throw new Error("Unexpected: firstContent is not text after validation");
		}

		// Fast-path: handler already provided structuredContent — validate it and
		// replace with result.data so Zod's schema stripping is always authoritative.
		// This must come after content validation so malformed content is still caught.
		if (output.structuredContent !== undefined) {
			const scResult = validator.safeParse(output.structuredContent);
			if (!scResult.success) {
				const validationError = fromZodError(scResult.error);
				return this.deps.errorHandler.createValidationError(
					`Output validation failed for ${toolName}`,
					`Handler output does not match declared output schema: ${validationError.message}`,
					[
						"Check that the handler returns data matching the output schema",
						"Review the tool definition output schema",
					],
				);
			}
			if (
				typeof scResult.data !== "object" ||
				scResult.data === null ||
				Array.isArray(scResult.data)
			) {
				return this.deps.errorHandler.createValidationError(
					`Output validation failed for ${toolName}`,
					"Handler output schema must resolve to a JSON object for structuredContent",
					[
						"Ensure outputSchema root type is object",
						"Return a JSON object from the tool handler",
					],
				);
			}
			return {
				...output,
				structuredContent: scResult.data as Record<string, unknown>,
			};
		}

		let parsedOutput: unknown;
		try {
			parsedOutput = JSON.parse(firstContent.text);
		} catch {
			// Non-JSON response (e.g. markdown) and no structuredContent — pass through.
			return output;
		}

		// Validate against schema
		const result = validator.safeParse(parsedOutput);
		if (!result.success) {
			const validationError = fromZodError(result.error);
			const validationErrors = validationError.message;
			return this.deps.errorHandler.createValidationError(
				`Output validation failed for ${toolName}`,
				`Handler output does not match declared output schema: ${validationErrors}`,
				[
					"Check that the handler returns data matching the output schema",
					"Review the tool definition output schema",
				],
			);
		}

		if (
			typeof result.data !== "object" ||
			result.data === null ||
			Array.isArray(result.data)
		) {
			return this.deps.errorHandler.createValidationError(
				`Output validation failed for ${toolName}`,
				"Handler output schema must resolve to a JSON object for structuredContent",
				[
					"Ensure outputSchema root type is object",
					"Return a JSON object from the tool handler",
				],
			);
		}

		return {
			...output,
			structuredContent: result.data as Record<string, unknown>,
		};
	}
}
