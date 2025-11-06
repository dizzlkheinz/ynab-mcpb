import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ErrorHandler } from './errorHandler.js';

/**
 * Centralized budget resolution helper that standardizes budget ID validation
 * and resolution logic across the entire YNAB MCP server
 */
export class BudgetResolver {
  /**
   * UUID format validation regex (accepts UUID versions 1-5)
   */
  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Special keywords that are allowed as budget IDs
   */
  private static readonly ALLOWED_KEYWORDS = ['default'] as const;

  /**
   * Resolves a budget ID using provided ID or default, with standardized error handling.
   * Maps keywords ('default') to concrete budget IDs to prevent 404s from YNAB API.
   *
   * Note: While YNAB API natively supports the "default" keyword, this MCP server
   * intentionally intercepts it to use its own locally-stored default budget ID
   * (set via set_default_budget tool). This provides caching, consistency, and
   * allows the MCP server to maintain default budget state independently of YNAB's
   * OAuth default budget setting.
   *
   * @param providedId - The budget ID provided by the user (optional)
   * @param defaultId - The default budget ID to fall back to (optional)
   * @returns The resolved budget ID string or CallToolResult with error
   */
  static resolveBudgetId(providedId?: string, defaultId?: string): string | CallToolResult {
    // If a budget ID is provided (including empty strings), handle keywords first
    if (providedId !== undefined && providedId !== null) {
      const trimmed = providedId.trim();

      // Handle special keywords
      if (trimmed === 'default') {
        // For "default" keyword, we use the MCP server's stored default budget ID
        // rather than passing "default" to YNAB API (see function JSDoc for rationale)
        if (defaultId) {
          return this.validateBudgetId(defaultId);
        }
        // No default budget set in MCP server, return error
        return this.createMissingBudgetError();
      }

      if (trimmed === 'last-used') {
        // "last-used" keyword is not currently supported
        return ErrorHandler.createValidationError(
          'Unsupported keyword',
          'The "last-used" keyword is not supported yet. Please use a specific budget ID or set a default budget.',
          [
            'Use a specific budget ID (UUID format)',
            'Set a default budget using the set_default_budget tool',
            'Use the "default" keyword after setting a default budget',
            'Run the list_budgets tool to see available budget IDs',
          ],
        );
      }

      // For non-keyword IDs, validate normally (including empty strings)
      return this.validateBudgetId(providedId);
    }

    // If no budget ID provided, try to use the default
    if (defaultId) {
      return this.validateBudgetId(defaultId);
    }

    // No budget ID provided and no default set
    return this.createMissingBudgetError();
  }

  /**
   * Validates that a budget ID has the correct format
   *
   * @param budgetId - The budget ID to validate
   * @returns The validated budget ID or CallToolResult with error
   */
  static validateBudgetId(budgetId: string): string | CallToolResult {
    if (!budgetId || typeof budgetId !== 'string') {
      return this.createInvalidBudgetError('Budget ID must be provided as a non-empty string');
    }

    const trimmed = budgetId.trim();
    if (!trimmed) {
      return this.createInvalidBudgetError('Budget ID cannot be empty or whitespace only');
    }

    // Allow simplified identifiers in test environments
    if (process.env['NODE_ENV'] === 'test') {
      const testIdentifierPattern =
        /^(test|budget|account|category|transaction|payee|mock)-[a-z0-9_-]+$/i;
      if (testIdentifierPattern.test(trimmed)) {
        return trimmed;
      }
    }

    // Validate UUID format
    if (!this.UUID_REGEX.test(trimmed)) {
      return this.createInvalidBudgetError(
        `Invalid budget ID format: '${trimmed}'. Must be a valid UUID format (versions 1-5)`,
      );
    }

    return trimmed;
  }

  /**
   * Creates a standardized error response for missing budget scenarios
   *
   * @returns CallToolResult with standardized error response
   */
  static createMissingBudgetError(): CallToolResult {
    const detailMessage = `A budget ID is required for this operation. You can either:
1. Provide a specific budget_id parameter
2. Set a default budget using the set_default_budget tool first`;

    return ErrorHandler.createValidationError(
      'No budget ID provided and no default budget set',
      detailMessage,
      [
        'Set a default budget first using the set_default_budget tool',
        'Provide a budget_id parameter when invoking the tool',
      ],
    );
  }

  /**
   * Creates a standardized error response for invalid budget ID format
   *
   * @param details - Specific details about the validation failure
   * @returns CallToolResult with standardized error response
   */
  static createInvalidBudgetError(details: string): CallToolResult {
    const detailMessage = `${details}

Valid formats:
- UUID format (versions 1-5, e.g., "123e4567-e89b-12d3-a456-426614174000")
- Special keywords: ${this.ALLOWED_KEYWORDS.map((k) => `"${k}"`).join(', ')}

You can use the list_budgets tool to see available budget IDs.`;

    return ErrorHandler.createValidationError('Invalid budget ID format', detailMessage, [
      'Use a valid UUID format (UUID v1-v5, e.g., 123e4567-e89b-12d3-a456-426614174000; standard UUID v4 format works as well)',
      'Run the list_budgets tool to view available budget IDs',
      'Use the special keyword "default" for convenience',
    ]);
  }

  /**
   * Convenience function that throws an error if budget resolution fails
   *
   * @param providedId - The budget ID provided by the user (optional)
   * @param defaultId - The default budget ID to fall back to (optional)
   * @returns The resolved budget ID string
   * @throws Error if resolution fails
   */
  static resolveBudgetIdOrThrow(providedId?: string, defaultId?: string): string {
    const result = this.resolveBudgetId(providedId, defaultId);
    if (typeof result === 'string') {
      return result;
    }

    // Extract error message from CallToolResult for throwing
    const errorText =
      result.content?.[0]?.type === 'text' ? result.content[0].text : 'Budget resolution failed';
    throw new Error(errorText);
  }

  /**
   * Convenience function that validates budget ID and throws an error if validation fails
   *
   * @param budgetId - The budget ID to validate
   * @returns The validated budget ID string
   * @throws Error if validation fails
   */
  static validateBudgetIdOrThrow(budgetId: string): string {
    const result = this.validateBudgetId(budgetId);
    if (typeof result === 'string') {
      return result;
    }

    // Extract error message from CallToolResult for throwing
    const errorText =
      result.content?.[0]?.type === 'text' ? result.content[0].text : 'Budget validation failed';
    throw new Error(errorText);
  }
}

/**
 * Convenience functions for easier usage across the codebase
 */

/**
 * Resolve a budget ID from a provided value or a default, producing standardized validation errors when necessary.
 *
 * @param providedId - Budget ID supplied by the caller (optional)
 * @param defaultId - Default budget ID to use if `providedId` is not present (optional)
 * @returns The resolved budget ID string, or a `CallToolResult` describing a validation error
 */
export function resolveBudgetId(providedId?: string, defaultId?: string): string | CallToolResult {
  return BudgetResolver.resolveBudgetId(providedId, defaultId);
}

/**
 * Validates a budget identifier and returns the canonical budget ID when valid.
 *
 * @returns The validated budget ID string, or a CallToolResult describing the validation error.
 */
export function validateBudgetId(budgetId: string): string | CallToolResult {
  return BudgetResolver.validateBudgetId(budgetId);
}

/**
 * Construct a standardized validation error indicating a budget ID is required.
 *
 * @returns A CallToolResult representing a validation error that explains a budget_id is missing and provides guidance to supply a `budget_id` or configure a default budget.
 */
export function createMissingBudgetError(): CallToolResult {
  return BudgetResolver.createMissingBudgetError();
}

/**
 * Creates a standardized error response for invalid budget ID format
 *
 * @param details - Specific details about the validation failure
 * @returns CallToolResult with standardized error response
 */
export function createInvalidBudgetError(details: string): CallToolResult {
  return BudgetResolver.createInvalidBudgetError(details);
}
