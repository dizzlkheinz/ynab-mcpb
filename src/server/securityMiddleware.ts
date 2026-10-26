/**
 * Security middleware that combines request logging and strict input validation
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { fromZodError } from "zod-validation-error";
import { createErrorHandler } from "./errorHandler.js";
import { globalRequestLogger } from "./requestLogger.js";
import { responseFormatter } from "./responseFormatter.js";

/**
 * Security context for requests
 */
export interface SecurityContext {
	accessToken: string;
	toolName: string;
	operation: string;
	parameters: Record<string, unknown>;
	startTime: number;
}

/**
 * Security middleware class that wraps tool operations
 */
// biome-ignore lint/complexity/noStaticOnlyClass: static utility class
export class SecurityMiddleware {
	/**
	 * Wrap a tool operation with security measures
	 */
	static async withSecurity<T extends Record<string, unknown>>(
		context: SecurityContext,
		schema: z.ZodSchema<T>,

		operation: (..._args: unknown[]) => Promise<CallToolResult>,
	): Promise<CallToolResult> {
		const startTime = Date.now();

		try {
			// 1. Input validation
			const validatedParams = await SecurityMiddleware.validateInput(
				schema,
				context.parameters,
			);

			const result = await operation(validatedParams);
			const duration = Date.now() - startTime;
			if (result.isError) {
				globalRequestLogger.logError(
					context.toolName,
					context.operation,
					context.parameters,
					"Tool returned an error",
					duration,
				);
				return result;
			}

			globalRequestLogger.logSuccess(
				context.toolName,
				context.operation,
				context.parameters,
				duration,
			);

			return result;
		} catch (error) {
			// Log failed request
			const duration = Date.now() - startTime;

			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";

			globalRequestLogger.logError(
				context.toolName,
				context.operation,
				context.parameters,
				errorMessage,
				duration,
			);

			// Handle validation errors
			if (
				error instanceof Error &&
				error.message.includes("Validation failed")
			) {
				const errorHandler = createErrorHandler(responseFormatter);
				return errorHandler.createValidationError(
					`Invalid parameters for ${context.toolName}`,
					error.message,
				);
			}

			// Re-throw other errors to be handled by existing error handling
			throw error;
		}
	}

	/**
	 * Validate input parameters using Zod schema
	 */
	private static async validateInput<T>(
		schema: z.ZodSchema<T>,
		parameters: Record<string, unknown>,
	): Promise<T> {
		try {
			return schema.parse(parameters);
		} catch (error) {
			if (error instanceof z.ZodError) {
				const validationError = fromZodError(error);
				throw new Error(`Validation failed: ${validationError.message}`);
			}
			throw error;
		}
	}

	/**
	 * Get security statistics
	 */
	static getSecurityStats(): {
		rateLimitStats: Record<string, unknown>;
		requestStats: Record<string, unknown>;
	} {
		return {
			rateLimitStats: {
				// Rate limiter doesn't expose internal stats, but we can provide basic info
				message:
					"Rate limiting is active with YNAB API limits (200 requests/hour)",
			},
			requestStats: globalRequestLogger.getStats(),
		};
	}

	/**
	 * Reset security state (useful for testing)
	 */
	static reset(): void {
		globalRequestLogger.clearLogs();
	}
}

/**
 * Create a curried wrapper that applies validation and logging to a tool handler.
 *
 * @param toolName - The name of the tool being invoked
 * @param operation - The operation or action name within the tool
 * @param schema - Zod schema used to validate input parameters before the handler runs
 * @returns A function that takes an `accessToken` and returns a function that takes raw `params`, which returns a function that accepts a handler `(validated: T) => Promise<CallToolResult>`; when invoked, the handler is executed under the security middleware and its `CallToolResult` is returned
 */
export function withSecurityWrapper<T extends Record<string, unknown>>(
	toolName: string,
	operation: string,
	schema: z.ZodSchema<T>,
) {
	return (accessToken: string) =>
		(params: Record<string, unknown>) =>
		(handler: (validated: T) => Promise<CallToolResult>) => {
			const context: SecurityContext = {
				accessToken,
				toolName,
				operation,
				parameters: params,
				startTime: Date.now(),
			};

			// Adapt the handler to the generic signature expected by withSecurity
			const operationAdapter = async (validatedParams: unknown) => {
				return handler(validatedParams as T);
			};

			return SecurityMiddleware.withSecurity(context, schema, operationAdapter);
		};
}
