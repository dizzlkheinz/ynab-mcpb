import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Response formatter contract for dependency injection in error handling
 */
interface ErrorResponseFormatter {
  format(value: unknown): string;
}

/**
 * YNAB API error codes and their corresponding HTTP status codes
 */

export const enum YNABErrorCode {
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
}

/**
 * Security-related error codes
 */
export const enum SecurityErrorCode {
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Standardized error response structure
 */
export interface ErrorResponse {
  error: {
    code: YNABErrorCode | SecurityErrorCode;
    message: string;
    userMessage: string; // User-friendly message
    details?: string | Record<string, unknown>;
    suggestions?: string[]; // Actionable suggestions for the user
  };
}

/**
 * Custom error classes for different error types
 */
export class YNABAPIError extends Error {
  public readonly code: YNABErrorCode;
  public readonly originalError?: unknown;

  constructor(code: YNABErrorCode, message: string, originalError?: unknown) {
    super(message);
    this.name = 'YNABAPIError';
    this.code = code;
    this.originalError = originalError;
  }
}

export class ValidationError extends Error {
  public readonly details?: string | undefined;
  public readonly suggestions?: string[] | undefined;

  constructor(message: string, details?: string | undefined, suggestions?: string[] | undefined) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
    this.suggestions = suggestions;
  }
}

/**
 * Centralized error handling middleware for all YNAB MCP tools
 */
export class ErrorHandler {
  private formatter: ErrorResponseFormatter;
  private static defaultInstance: ErrorHandler;

  constructor(formatter: ErrorResponseFormatter) {
    this.formatter = formatter;
  }

  /**
   * Creates a fallback formatter for when no formatter is injected
   */
  private static createFallbackFormatter(): ErrorResponseFormatter {
    return {
      format: (value: unknown) => JSON.stringify(value, null, 2),
    };
  }

  /**
   * Sets the formatter for the default instance (backward compatibility)
   */
  static setFormatter(formatter: ErrorResponseFormatter): void {
    ErrorHandler.defaultInstance = new ErrorHandler(formatter);
  }

  /**
   * Handles errors from YNAB API calls and returns standardized MCP responses
   */
  handleError(error: unknown, context: string): CallToolResult {
    const errorResponse = this.createErrorResponse(error, context);

    let formattedText: string;
    try {
      formattedText = this.formatter.format(errorResponse);
    } catch {
      // Fallback to JSON.stringify if formatter fails
      formattedText = JSON.stringify(errorResponse, null, 2);
    }

    return {
      content: [
        {
          type: 'text',
          text: formattedText,
        },
      ],
    };
  }

  /**
   * Static method for backward compatibility
   */
  static handleError(error: unknown, context: string): CallToolResult {
    if (!ErrorHandler.defaultInstance) {
      ErrorHandler.defaultInstance = new ErrorHandler(ErrorHandler.createFallbackFormatter());
    }
    return ErrorHandler.defaultInstance.handleError(error, context);
  }

  /**
   * Creates a standardized error response based on the error type
   */
  private createErrorResponse(error: unknown, context: string): ErrorResponse {
    // Handle custom error types
    if (error instanceof YNABAPIError) {
      const sanitizedDetails = this.sanitizeErrorDetails(error.originalError);
      return {
        error: {
          code: error.code,
          message: this.getErrorMessage(error.code, context),
          userMessage: this.getUserFriendlyMessage(error.code, context),
          suggestions: this.getErrorSuggestions(error.code, context),
          ...(sanitizedDetails && { details: sanitizedDetails }),
        },
      };
    }

    if (error instanceof ValidationError) {
      const sanitizedDetails = error.details ? this.sanitizeErrorDetails(error.details) : undefined;
      const suggestions =
        error.suggestions && error.suggestions.length > 0
          ? error.suggestions
          : this.getErrorSuggestions(SecurityErrorCode.VALIDATION_ERROR, context);
      return {
        error: {
          code: SecurityErrorCode.VALIDATION_ERROR,
          message: error.message,
          userMessage: this.getUserFriendlyMessage(SecurityErrorCode.VALIDATION_ERROR, context),
          suggestions,
          ...(sanitizedDetails && { details: sanitizedDetails }),
        },
      };
    }

    const ynabApiError = this.extractYNABApiError(error);
    if (ynabApiError) {
      const sanitizedDetails = ynabApiError.details
        ? this.sanitizeErrorDetails(ynabApiError.details)
        : undefined;
      return {
        error: {
          code: ynabApiError.code,
          message: this.getErrorMessage(ynabApiError.code, context),
          userMessage: this.getUserFriendlyMessage(ynabApiError.code, context),
          suggestions: this.getErrorSuggestions(ynabApiError.code, context),
          ...(sanitizedDetails && { details: sanitizedDetails }),
        },
      };
    }

    // Handle generic errors by analyzing the error message

    const httpStatus = this.extractHttpStatus(error);
    if (httpStatus !== null) {
      const code = this.mapHttpStatusToErrorCode(httpStatus);
      if (code) {
        const details = this.extractHttpStatusDetails(error);
        return {
          error: {
            code,
            message: this.getErrorMessage(code, context),
            userMessage: this.getUserFriendlyMessage(code, context),
            suggestions: this.getErrorSuggestions(code, context),
            ...(details && { details }),
          },
        };
      }
    }

    // Handle generic errors by analyzing the error message
    if (error instanceof Error) {
      const detectedCode = this.detectErrorCode(error);
      if (detectedCode) {
        return {
          error: {
            code: detectedCode,
            message: this.getErrorMessage(detectedCode, context),
            userMessage: this.getUserFriendlyMessage(detectedCode, context),
            suggestions: this.getErrorSuggestions(detectedCode, context),
          },
        };
      }
    }

    // Fallback for unknown errors
    return {
      error: {
        code: SecurityErrorCode.UNKNOWN_ERROR,
        message: this.getGenericErrorMessage(context),
        userMessage: this.getUserFriendlyGenericMessage(context),
        suggestions: [
          'Try the operation again',
          'Check your internet connection',
          'Contact support if the issue persists',
        ],
      },
    };
  }

  /**
   * Detects YNAB error codes from error messages
   */
  private detectErrorCode(error: Error): YNABErrorCode | null {
    const message = error.message.toLowerCase();

    if (message.includes('401') || message.includes('unauthorized')) {
      return YNABErrorCode.UNAUTHORIZED;
    }
    if (message.includes('403') || message.includes('forbidden')) {
      return YNABErrorCode.FORBIDDEN;
    }
    if (message.includes('404') || message.includes('not found')) {
      return YNABErrorCode.NOT_FOUND;
    }
    if (message.includes('429') || message.includes('too many requests')) {
      return YNABErrorCode.TOO_MANY_REQUESTS;
    }
    if (message.includes('500') || message.includes('internal server error')) {
      return YNABErrorCode.INTERNAL_SERVER_ERROR;
    }

    return null;
  }

  /**
   * Returns user-friendly error messages for end users
   */
  private getUserFriendlyMessage(code: YNABErrorCode | SecurityErrorCode, context: string): string {
    switch (code) {
      case YNABErrorCode.UNAUTHORIZED:
        return 'Your YNAB access token is invalid or has expired. Please check your token and try again.';
      case YNABErrorCode.FORBIDDEN:
        return "You don't have permission to access this YNAB data. Please check your account permissions.";
      case YNABErrorCode.NOT_FOUND:
        return this.getUserFriendlyNotFoundMessage(context);
      case YNABErrorCode.TOO_MANY_REQUESTS:
        return "We're making too many requests to YNAB. Please wait a moment and try again.";
      case YNABErrorCode.INTERNAL_SERVER_ERROR:
        return "YNAB's servers are having issues. Please try again in a few minutes.";
      case SecurityErrorCode.VALIDATION_ERROR:
        return 'Some of the information provided is invalid. Please check your inputs and try again.';
      case SecurityErrorCode.RATE_LIMIT_EXCEEDED:
        return 'Too many requests have been made. Please wait before trying again.';
      default:
        return this.getUserFriendlyGenericMessage(context);
    }
  }

  /**
   * Returns actionable suggestions for users based on error type
   */
  private getErrorSuggestions(code: YNABErrorCode | SecurityErrorCode, context: string): string[] {
    switch (code) {
      case YNABErrorCode.UNAUTHORIZED:
        return [
          'Go to https://app.youneedabudget.com/settings/developer to generate a new access token',
          'Make sure you copied the entire token without any extra spaces',
          "Check that your token hasn't expired",
        ];
      case YNABErrorCode.FORBIDDEN:
        return [
          'Verify that your YNAB account has access to the requested budget',
          'Check if your YNAB subscription is active',
          'Try logging into YNAB directly to confirm access',
        ];
      case YNABErrorCode.NOT_FOUND:
        return this.getNotFoundSuggestions(context);
      case YNABErrorCode.TOO_MANY_REQUESTS:
        return [
          'Wait 1-2 minutes before trying again',
          'Try making fewer requests at once',
          'The system will automatically retry after a short delay',
        ];
      case YNABErrorCode.INTERNAL_SERVER_ERROR:
        return [
          "Check YNAB's status page at https://status.youneedabudget.com",
          'Try again in a few minutes',
          'Contact YNAB support if the issue persists',
        ];
      case SecurityErrorCode.VALIDATION_ERROR:
        return [
          'Double-check all required fields are filled out',
          'Verify that amounts are in the correct format',
          'Make sure dates are valid and in the right format',
        ];
      default:
        return [
          'Try the operation again',
          'Check your internet connection',
          'Contact support if the issue persists',
        ];
    }
  }

  /**
   * Returns user-friendly not found messages
   */
  private getUserFriendlyNotFoundMessage(context: string): string {
    if (context.includes('account')) {
      return "We couldn't find the budget or account you're looking for.";
    }
    if (context.includes('budget')) {
      return "We couldn't find that budget. It may have been deleted or you may not have access.";
    }
    if (context.includes('category')) {
      return "We couldn't find that category. It may have been deleted or moved.";
    }
    if (context.includes('transaction')) {
      return "We couldn't find that transaction. It may have been deleted or moved.";
    }
    if (context.includes('payee')) {
      return "We couldn't find that payee in your budget.";
    }
    return "We couldn't find what you're looking for. Please check that all information is correct.";
  }

  /**
   * Returns suggestions for not found errors
   */
  private getNotFoundSuggestions(context: string): string[] {
    const baseSuggestions = [
      'Double-check that the name or ID is spelled correctly',
      'Try refreshing your budget data',
      "Make sure you're using the right budget",
    ];

    if (context.includes('account')) {
      return [...baseSuggestions, 'Check if the account was recently closed or renamed'];
    }
    if (context.includes('category')) {
      return [
        ...baseSuggestions,
        'Check if the category was deleted or moved to a different group',
      ];
    }
    if (context.includes('transaction')) {
      return [
        ...baseSuggestions,
        'Check if the transaction was deleted or is in a different account',
      ];
    }

    return baseSuggestions;
  }

  /**
   * Returns user-friendly generic error message
   */
  private getUserFriendlyGenericMessage(context: string): string {
    if (context.includes('transaction')) {
      return 'There was a problem with your transaction. Please check your information and try again.';
    }
    if (context.includes('budget')) {
      return 'There was a problem accessing your budget data. Please try again.';
    }
    if (context.includes('account')) {
      return 'There was a problem accessing your account information. Please try again.';
    }
    return 'Something went wrong. Please try again in a moment.';
  }

  /**
   * Returns user-friendly error messages for different error codes
   */
  private getErrorMessage(code: YNABErrorCode, context: string): string {
    switch (code) {
      case YNABErrorCode.UNAUTHORIZED:
        return 'Invalid or expired YNAB access token';
      case YNABErrorCode.FORBIDDEN:
        return 'Insufficient permissions to access YNAB data';
      case YNABErrorCode.NOT_FOUND:
        return this.getNotFoundMessage(context);
      case YNABErrorCode.TOO_MANY_REQUESTS:
        return 'Rate limit exceeded. Please try again later';
      case YNABErrorCode.INTERNAL_SERVER_ERROR:
        return 'YNAB service is currently unavailable';
      default:
        return this.getGenericErrorMessage(context);
    }
  }

  /**
   * Returns context-specific not found error messages
   */
  private getNotFoundMessage(context: string): string {
    if (context.includes('listing accounts')) {
      return 'Failed to list accounts - budget or account not found';
    }
    if (context.includes('getting account')) {
      return 'Failed to get account - budget or account not found';
    }
    if (context.includes('listing budgets') || context.includes('getting budget')) {
      return 'Budget not found';
    }
    if (context.includes('listing categories') || context.includes('getting category')) {
      return 'Budget or category not found';
    }
    if (context.includes('listing months') || context.includes('getting month')) {
      return 'Budget or month not found';
    }
    if (context.includes('listing payees') || context.includes('getting payee')) {
      return 'Budget or payee not found';
    }
    if (context.includes('listing transactions') || context.includes('getting transaction')) {
      return 'Budget, account, category, or transaction not found';
    }
    return 'The requested resource was not found. Please verify the provided IDs are correct.';
  }

  /**
   * Returns context-specific generic error messages
   */
  private getGenericErrorMessage(context: string): string {
    if (context.includes('listing accounts')) {
      return 'Failed to list accounts';
    }
    if (context.includes('getting account')) {
      return 'Failed to get account';
    }
    if (context.includes('creating account')) {
      return 'Failed to create account';
    }
    if (context.includes('listing budgets')) {
      return 'Failed to list budgets';
    }
    if (context.includes('getting budget')) {
      return 'Failed to get budget';
    }
    if (context.includes('listing categories')) {
      return 'Failed to list categories';
    }
    if (context.includes('getting category')) {
      return 'Failed to get category';
    }
    if (context.includes('updating category')) {
      return 'Failed to update category';
    }
    if (context.includes('listing months')) {
      return 'Failed to list months';
    }
    if (context.includes('getting month')) {
      return 'Failed to get month data';
    }
    if (context.includes('listing payees')) {
      return 'Failed to list payees';
    }
    if (context.includes('getting payee')) {
      return 'Failed to get payee';
    }
    if (context.includes('listing transactions')) {
      return 'Failed to list transactions';
    }
    if (context.includes('getting transaction')) {
      return 'Failed to get transaction';
    }
    if (context.includes('creating transaction')) {
      return 'Failed to create transaction';
    }
    if (context.includes('updating transaction')) {
      return 'Failed to update transaction';
    }
    if (context.includes('getting user')) {
      return 'Failed to get user information';
    }
    return `An error occurred while ${context}`;
  }

  /**
   * Extracts HTTP status code from various error shapes
   */
  private extractHttpStatus(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const directStatus = (error as { status?: unknown }).status;
    if (typeof directStatus === 'number' && Number.isInteger(directStatus) && directStatus > 0) {
      return directStatus;
    }

    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object') {
      const responseStatus = (response as { status?: unknown }).status;
      if (
        typeof responseStatus === 'number' &&
        Number.isInteger(responseStatus) &&
        responseStatus > 0
      ) {
        return responseStatus;
      }
    }

    return null;
  }

  /**
   * Maps HTTP status codes to standardized YNAB error codes
   */
  private mapHttpStatusToErrorCode(status: number): YNABErrorCode | null {
    switch (status) {
      case YNABErrorCode.UNAUTHORIZED:
      case YNABErrorCode.FORBIDDEN:
      case YNABErrorCode.NOT_FOUND:
      case YNABErrorCode.TOO_MANY_REQUESTS:
      case YNABErrorCode.INTERNAL_SERVER_ERROR:
        return status as YNABErrorCode;
      default:
        return null;
    }
  }

  /**
   * Extracts sanitized details from HTTP error responses
   */
  private extractHttpStatusDetails(error: unknown): string | undefined {
    if (error && typeof error === 'object') {
      const response = (error as { response?: unknown }).response;
      if (response && typeof response === 'object') {
        const statusText = (response as { statusText?: unknown }).statusText;
        if (typeof statusText === 'string' && statusText.trim().length > 0) {
          return this.sanitizeErrorDetails(statusText);
        }
      }
    }

    if (error instanceof Error && error.message) {
      return this.sanitizeErrorDetails(error.message);
    }

    return undefined;
  }

  /**
   * Extracts structured YNAB API error information
   */
  private extractYNABApiError(error: unknown): { code: YNABErrorCode; details?: string } | null {
    if (!error || typeof error !== 'object' || !('error' in (error as Record<string, unknown>))) {
      return null;
    }

    const payload = (error as { error?: unknown }).error;
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const id = (payload as { id?: unknown }).id;
    const name = (payload as { name?: unknown }).name;
    const detail = (payload as { detail?: unknown }).detail;

    let code: YNABErrorCode | null = null;

    if (typeof id === 'string') {
      const numeric = parseInt(id, 10);
      if (!Number.isNaN(numeric)) {
        code = this.mapHttpStatusToErrorCode(numeric);
      }
    }

    if (!code && typeof name === 'string') {
      const normalized = name.toLowerCase();
      if (normalized.includes('unauthorized')) {
        code = YNABErrorCode.UNAUTHORIZED;
      } else if (normalized.includes('forbidden')) {
        code = YNABErrorCode.FORBIDDEN;
      } else if (normalized.includes('not_found')) {
        code = YNABErrorCode.NOT_FOUND;
      } else if (normalized.includes('too_many_requests') || normalized.includes('rate_limit')) {
        code = YNABErrorCode.TOO_MANY_REQUESTS;
      } else if (normalized.includes('internal_server_error')) {
        code = YNABErrorCode.INTERNAL_SERVER_ERROR;
      }
    }

    if (!code) {
      return null;
    }

    const details = typeof detail === 'string' ? detail : undefined;
    const result: { code: YNABErrorCode; details?: string } = { code };
    if (details !== undefined) {
      result.details = details;
    }
    return result;
  }

  /**
   * Sanitizes error details to prevent sensitive data leakage
   */
  private sanitizeErrorDetails(error: unknown): string | undefined {
    if (!error) return undefined;

    let details = '';
    if (error instanceof Error) {
      details = error.message;
    } else if (typeof error === 'string') {
      details = error;
    } else {
      details = 'Unknown error details';
    }

    // Remove sensitive information patterns
    details = details
      // token=..., token: ..., token ... → redact until delimiter or whitespace
      .replace(/token[s]?[:\s=]+([^\s,"']+)/gi, 'token=***')
      .replace(/key[s]?[:\s=]+([^\s,"']+)/gi, 'key=***')
      .replace(/password[s]?[:\s=]+([^\s,"']+)/gi, 'password=***')
      // Authorization header (any scheme), redact rest of value
      .replace(/authorization[:\s=]+[^\r\n]+/gi, 'authorization=***')
      // Common Bearer/JWT forms in free text
      .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');

    return details;
  }

  /**
   * Wraps async functions with error handling
   */
  async withErrorHandling<T>(
    operation: () => Promise<T>,
    context: string,
  ): Promise<T | CallToolResult> {
    try {
      return await operation();
    } catch (error) {
      return this.handleError(error, context);
    }
  }

  /**
   * Static method for backward compatibility
   */
  static async withErrorHandling<T>(
    operation: () => Promise<T>,
    context: string,
  ): Promise<T | CallToolResult> {
    if (!ErrorHandler.defaultInstance) {
      ErrorHandler.defaultInstance = new ErrorHandler(ErrorHandler.createFallbackFormatter());
    }
    return ErrorHandler.defaultInstance.withErrorHandling(operation, context);
  }

  /**
   * Creates a validation error for invalid parameters
   */
  createValidationError(message: string, details?: string, suggestions?: string[]): CallToolResult {
    return this.handleError(
      new ValidationError(message, details, suggestions),
      'validating parameters',
    );
  }

  /**
   * Static method for backward compatibility
   */
  static createValidationError(
    message: string,
    details?: string,
    suggestions?: string[],
  ): CallToolResult {
    if (!ErrorHandler.defaultInstance) {
      ErrorHandler.defaultInstance = new ErrorHandler(ErrorHandler.createFallbackFormatter());
    }
    return ErrorHandler.defaultInstance.createValidationError(message, details, suggestions);
  }

  /**
   * Creates a YNAB API error with specific error code
   */
  createYNABError(code: YNABErrorCode, context: string, originalError?: unknown): YNABAPIError {
    const message = this.getErrorMessage(code, context);
    return new YNABAPIError(code, message, originalError);
  }

  /**
   * Static method for backward compatibility
   */
  static createYNABError(
    code: YNABErrorCode,
    context: string,
    originalError?: unknown,
  ): YNABAPIError {
    if (!ErrorHandler.defaultInstance) {
      ErrorHandler.defaultInstance = new ErrorHandler(ErrorHandler.createFallbackFormatter());
    }
    return ErrorHandler.defaultInstance.createYNABError(code, context, originalError);
  }
}

/**
 * Create an ErrorHandler configured with the given response formatter.
 *
 * @param formatter - Formatter used to convert structured error responses into strings for tool output
 * @returns A new ErrorHandler configured to use the provided `formatter`
 */
export function createErrorHandler(formatter: ErrorResponseFormatter): ErrorHandler {
  return new ErrorHandler(formatter);
}

/**
 * Utility function for handling errors in tool handlers
 */
export function handleToolError(
  error: unknown,
  toolName: string,
  operation: string,
): CallToolResult {
  return ErrorHandler.handleError(error, `executing ${toolName} - ${operation}`);
}

/**
 * Utility function for wrapping tool operations with error handling
 */
export async function withToolErrorHandling<T>(
  operation: () => Promise<T>,
  toolName: string,
  operationName: string,
): Promise<T | CallToolResult> {
  return ErrorHandler.withErrorHandling(operation, `executing ${toolName} - ${operationName}`);
}
