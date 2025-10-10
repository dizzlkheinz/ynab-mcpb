/**
 * Security middleware that combines rate limiting, request logging, and input validation
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { globalRateLimiter, RateLimitError } from './rateLimiter.js';
import { globalRequestLogger } from './requestLogger.js';
import { ErrorHandler } from './errorHandler.js';
import { responseFormatter } from './responseFormatter.js';

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
      const validatedParams = await this.validateInput(schema, context.parameters);

      // 2. Rate limiting check
      await this.checkRateLimit(context.accessToken);

      // 3. Record the request for rate limiting
      globalRateLimiter.recordRequest(this.hashToken(context.accessToken));

      // 4. Execute the operation
      const result = await operation(validatedParams);

      // 5. Log successful request
      const duration = Date.now() - startTime;
      const rateLimitInfo = globalRateLimiter.getStatus(this.hashToken(context.accessToken));

      globalRequestLogger.logSuccess(
        context.toolName,
        context.operation,
        context.parameters,
        duration,
        {
          remaining: rateLimitInfo.remaining,
          isLimited: rateLimitInfo.isLimited,
        },
      );

      return result;
    } catch (error) {
      // Log failed request
      const duration = Date.now() - startTime;
      const rateLimitInfo = globalRateLimiter.getStatus(this.hashToken(context.accessToken));

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      globalRequestLogger.logError(
        context.toolName,
        context.operation,
        context.parameters,
        errorMessage,
        duration,
        {
          remaining: rateLimitInfo.remaining,
          isLimited: rateLimitInfo.isLimited,
        },
      );

      // Handle rate limit errors specially
      if (error instanceof RateLimitError) {
        return this.createRateLimitErrorResponse(error);
      }

      // Handle validation errors
      if (error instanceof Error && error.message.includes('Validation failed')) {
        return ErrorHandler.createValidationError(
          'Invalid parameters for ' + context.toolName,
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
        const errorMessage =
          error.issues && error.issues.length > 0
            ? error.issues
                .map((err: z.ZodIssue) => `${err.path.join('.')}: ${err.message}`)
                .join(', ')
            : error.message || 'Validation failed';
        throw new Error(`Validation failed: ${errorMessage}`);
      }
      throw error;
    }
  }

  /**
   * Check rate limit for the given access token
   */
  private static async checkRateLimit(accessToken: string): Promise<void> {
    const tokenHash = this.hashToken(accessToken);
    const rateLimitInfo = globalRateLimiter.isAllowed(tokenHash);

    if (rateLimitInfo.isLimited) {
      throw new RateLimitError(
        'Rate limit exceeded. Please wait before making additional requests.',
        rateLimitInfo.resetTime,
        rateLimitInfo.remaining,
      );
    }
  }

  /**
   * Create a rate limit error response
   */
  private static createRateLimitErrorResponse(error: RateLimitError): CallToolResult {
    return {
      content: [
        {
          type: 'text',
          text: responseFormatter.format({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: error.message,
              details: {
                resetTime: error.resetTime.toISOString(),
                remaining: error.remaining,
              },
            },
          }),
        },
      ],
    };
  }

  /**
   * Hash access token for rate limiting and logging
   */
  private static hashToken(token: string): string {
    // Simple hash for rate limiting - not cryptographically secure
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `token_${Math.abs(hash).toString(16)}`;
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
        message: 'Rate limiting is active with YNAB API limits (200 requests/hour)',
      },
      requestStats: globalRequestLogger.getStats(),
    };
  }

  /**
   * Reset security state (useful for testing)
   */
  static reset(): void {
    globalRateLimiter.reset();
    globalRequestLogger.clearLogs();
  }
}

/**
 * Create a curried wrapper that applies validation, rate limiting, and logging to a tool handler.
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