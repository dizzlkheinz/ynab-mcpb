import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ValidationError } from "../utils/errors.js";

export { ValidationError };

/**
 * YNAB API error codes and their corresponding HTTP status codes
 */

export enum YNABErrorCode {
	BAD_REQUEST = 400,
	UNAUTHORIZED = 401,
	FORBIDDEN = 403,
	NOT_FOUND = 404,
	TOO_MANY_REQUESTS = 429,
	INTERNAL_SERVER_ERROR = 500,
}

/**
 * Security-related error codes
 */
export enum SecurityErrorCode {
	RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
	VALIDATION_ERROR = "VALIDATION_ERROR",
	UNKNOWN_ERROR = "UNKNOWN_ERROR",
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
		this.name = "YNABAPIError";
		this.code = code;
		this.originalError = originalError;
	}
}

const GENERIC_ERROR_MESSAGES: ReadonlyArray<readonly [string, string]> = [
	["listing accounts", "Failed to list accounts"],
	["getting account", "Failed to get account"],
	["creating account", "Failed to create account"],
	["listing budgets", "Failed to list budgets"],
	["getting budget", "Failed to get budget"],
	["listing categories", "Failed to list categories"],
	["getting category", "Failed to get category"],
	["updating category", "Failed to update category"],
	["listing months", "Failed to list months"],
	["getting month", "Failed to get month data"],
	["listing payees", "Failed to list payees"],
	["getting payee", "Failed to get payee"],
	["listing transactions", "Failed to list transactions"],
	["getting transaction", "Failed to get transaction"],
	["creating transaction", "Failed to create transaction"],
	["updating transaction", "Failed to update transaction"],
	["deleting transaction", "Failed to delete transaction"],
	["getting user", "Failed to get user information"],
];

const YNAB_ERROR_NAME_CODES: ReadonlyArray<
	readonly [readonly string[], YNABErrorCode]
> = [
	[["unauthorized"], YNABErrorCode.UNAUTHORIZED],
	[["forbidden"], YNABErrorCode.FORBIDDEN],
	[["not_found"], YNABErrorCode.NOT_FOUND],
	[["too_many_requests", "rate_limit"], YNABErrorCode.TOO_MANY_REQUESTS],
	[["internal_server_error"], YNABErrorCode.INTERNAL_SERVER_ERROR],
];

/**
 * Centralized error handling middleware for all YNAB MCP tools
 */
export class ErrorHandler {
	/**
	 * Handles errors from YNAB API calls and returns standardized MCP responses
	 */
	handleError(error: unknown, context: string): CallToolResult {
		const errorResponse = this.createErrorResponse(error, context);

		let formattedText: string;
		try {
			formattedText = JSON.stringify(errorResponse, null, 2);
		} catch {
			// Final fallback if JSON serialization fails (e.g. circular references)
			formattedText = `Error processing request: ${this.getGenericErrorMessage(context)}`;
		}

		return {
			isError: true,
			content: [
				{
					type: "text",
					text: formattedText,
				},
			],
		};
	}

	/**
	 * Creates a standardized error response based on the error type
	 */
	private createErrorResponse(error: unknown, context: string): ErrorResponse {
		if (error instanceof YNABAPIError) {
			const ynabDetails = this.extractYNABApiError(error.originalError);
			const detailsToSanitize = ynabDetails?.details || error.originalError;
			const sanitizedDetails = this.sanitizeErrorDetails(detailsToSanitize);
			return this.buildCodedErrorResponse(
				error.code,
				context,
				sanitizedDetails,
			);
		}

		if (error instanceof ValidationError) {
			return this.buildValidationErrorResponse(error, context);
		}

		const ynabApiError = this.extractYNABApiError(error);
		if (ynabApiError) {
			const sanitizedDetails = ynabApiError.details
				? this.sanitizeErrorDetails(ynabApiError.details)
				: undefined;
			return this.buildCodedErrorResponse(
				ynabApiError.code,
				context,
				sanitizedDetails,
			);
		}

		const httpCode = this.resolveHttpErrorCode(error);
		if (httpCode !== null) {
			return this.buildCodedErrorResponse(
				httpCode,
				context,
				this.extractHttpStatusDetails(error),
			);
		}

		if (error instanceof Error) {
			const detectedCode = this.detectErrorCode(error);
			if (detectedCode) {
				return this.buildCodedErrorResponse(detectedCode, context);
			}
		}

		const sanitizedDetails = this.sanitizeErrorDetails(
			this.formatUnknownErrorMessage(error),
		);
		return {
			error: {
				code: SecurityErrorCode.UNKNOWN_ERROR,
				message: this.getGenericErrorMessage(context),
				userMessage: this.getUserFriendlyGenericMessage(context),
				suggestions: [
					"Try the operation again",
					"Check your internet connection",
					"Contact support if the issue persists",
				],
				...(sanitizedDetails && { details: sanitizedDetails }),
			},
		};
	}

	private buildCodedErrorResponse(
		code: YNABErrorCode,
		context: string,
		details?: string,
	): ErrorResponse {
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

	private buildValidationErrorResponse(
		error: ValidationError,
		context: string,
	): ErrorResponse {
		const sanitizedDetails = error.details
			? this.sanitizeErrorDetails(error.details)
			: undefined;
		const suggestions =
			error.suggestions && error.suggestions.length > 0
				? error.suggestions
				: this.getErrorSuggestions(SecurityErrorCode.VALIDATION_ERROR, context);
		return {
			error: {
				code: SecurityErrorCode.VALIDATION_ERROR,
				message: error.message,
				userMessage: this.getUserFriendlyMessage(
					SecurityErrorCode.VALIDATION_ERROR,
					context,
				),
				suggestions,
				...(sanitizedDetails && { details: sanitizedDetails }),
			},
		};
	}

	private resolveHttpErrorCode(error: unknown): YNABErrorCode | null {
		const httpStatus = this.extractHttpStatus(error);
		return httpStatus !== null
			? this.mapHttpStatusToErrorCode(httpStatus)
			: null;
	}

	private formatUnknownErrorMessage(error: unknown): string {
		if (error instanceof Error) {
			return error.message;
		}
		if (typeof error === "string") {
			return error;
		}
		if (error && typeof error === "object") {
			// Handle plain objects (e.g., YNAB SDK errors that aren't Error instances)
			try {
				return JSON.stringify(error, null, 2);
			} catch {
				// Circular reference or other JSON issue
				return Object.prototype.toString.call(error);
			}
		}
		return String(error);
	}

	/**
	 * Detects YNAB error codes from error messages
	 */
	private detectErrorCode(error: Error): YNABErrorCode | null {
		const message = error.message.toLowerCase();

		if (message.includes("401") || message.includes("unauthorized")) {
			return YNABErrorCode.UNAUTHORIZED;
		}
		if (message.includes("403") || message.includes("forbidden")) {
			return YNABErrorCode.FORBIDDEN;
		}
		if (message.includes("404") || message.includes("not found")) {
			return YNABErrorCode.NOT_FOUND;
		}
		if (message.includes("429") || message.includes("too many requests")) {
			return YNABErrorCode.TOO_MANY_REQUESTS;
		}
		if (message.includes("500") || message.includes("internal server error")) {
			return YNABErrorCode.INTERNAL_SERVER_ERROR;
		}

		return null;
	}

	/**
	 * Returns user-friendly error messages for end users
	 */
	private getUserFriendlyMessage(
		code: YNABErrorCode | SecurityErrorCode,
		context: string,
	): string {
		switch (code) {
			case YNABErrorCode.BAD_REQUEST:
				return "The request was invalid. Please check your input data.";
			case YNABErrorCode.UNAUTHORIZED:
				return "Your YNAB access token is invalid or has expired. Please check your token and try again.";
			case YNABErrorCode.FORBIDDEN:
				return "You don't have permission to access this YNAB data. Please check your account permissions.";
			case YNABErrorCode.NOT_FOUND:
				return this.getUserFriendlyNotFoundMessage(context);
			case YNABErrorCode.TOO_MANY_REQUESTS:
				return "We're making too many requests to YNAB. Please wait a moment and try again.";
			case YNABErrorCode.INTERNAL_SERVER_ERROR:
				return "YNAB's servers are having issues. Please try again in a few minutes.";
			case SecurityErrorCode.VALIDATION_ERROR:
				return "Some of the information provided is invalid. Please check your inputs and try again.";
			case SecurityErrorCode.RATE_LIMIT_EXCEEDED:
				return "Too many requests have been made. Please wait before trying again.";
			default:
				return this.getUserFriendlyGenericMessage(context);
		}
	}

	/**
	 * Returns actionable suggestions for users based on error type
	 */
	private getErrorSuggestions(
		code: YNABErrorCode | SecurityErrorCode,
		context: string,
	): string[] {
		switch (code) {
			case YNABErrorCode.BAD_REQUEST:
				return [
					"Check that all required fields are correct",
					"Verify that dates are in the correct format (ISO 8601)",
					"Ensure amounts are valid numbers",
				];
			case YNABErrorCode.UNAUTHORIZED:
				return [
					"Go to https://app.ynab.com/settings/developer to generate a new access token",
					"Make sure you copied the entire token without any extra spaces",
					"Check that your token hasn't expired",
				];
			case YNABErrorCode.FORBIDDEN:
				return [
					"Verify that your YNAB account has access to the requested budget",
					"Check if your YNAB subscription is active",
					"Try logging into YNAB directly to confirm access",
				];
			case YNABErrorCode.NOT_FOUND:
				return this.getNotFoundSuggestions(context);
			case YNABErrorCode.TOO_MANY_REQUESTS:
				return [
					"Wait 1-2 minutes before trying again",
					"Try making fewer requests at once",
					"YNAB allows 200 requests per hour per token",
				];
			case YNABErrorCode.INTERNAL_SERVER_ERROR:
				return [
					"Check YNAB's status page at https://status.ynab.com",
					"Try again in a few minutes",
					"Contact YNAB support if the issue persists",
				];
			case SecurityErrorCode.VALIDATION_ERROR:
				return [
					"Double-check all required fields are filled out",
					"Verify that amounts are in the correct format",
					"Make sure dates are valid and in the right format",
				];
			default:
				return [
					"Try the operation again",
					"Check your internet connection",
					"Contact support if the issue persists",
				];
		}
	}

	/**
	 * Returns user-friendly not found messages
	 */
	private getUserFriendlyNotFoundMessage(context: string): string {
		if (context.includes("account")) {
			return "We couldn't find the budget or account you're looking for.";
		}
		if (context.includes("budget")) {
			return "We couldn't find that budget. It may have been deleted or you may not have access.";
		}
		if (context.includes("category")) {
			return "We couldn't find that category. It may have been deleted or moved.";
		}
		if (context.includes("transaction")) {
			return "We couldn't find that transaction. It may have been deleted or moved.";
		}
		if (context.includes("payee")) {
			return "We couldn't find that payee in your budget.";
		}
		return "We couldn't find what you're looking for. Please check that all information is correct.";
	}

	/**
	 * Returns suggestions for not found errors
	 */
	private getNotFoundSuggestions(context: string): string[] {
		const baseSuggestions = [
			"Double-check that the name or ID is spelled correctly",
			"Try refreshing your budget data",
			"Make sure you're using the right budget",
		];

		if (context.includes("account")) {
			return [
				...baseSuggestions,
				"Check if the account was recently closed or renamed",
			];
		}
		if (context.includes("category")) {
			return [
				...baseSuggestions,
				"Check if the category was deleted or moved to a different group",
			];
		}
		if (context.includes("transaction")) {
			return [
				...baseSuggestions,
				"Check if the transaction was deleted or is in a different account",
			];
		}

		return baseSuggestions;
	}

	/**
	 * Returns user-friendly generic error message
	 */
	private getUserFriendlyGenericMessage(context: string): string {
		if (context.includes("transaction")) {
			return "There was a problem with your transaction. Please check your information and try again.";
		}
		if (context.includes("budget")) {
			return "There was a problem accessing your budget data. Please try again.";
		}
		if (context.includes("account")) {
			return "There was a problem accessing your account information. Please try again.";
		}
		return "Something went wrong. Please try again in a moment.";
	}

	/**
	 * Returns user-friendly error messages for different error codes
	 */
	private getErrorMessage(code: YNABErrorCode, context: string): string {
		switch (code) {
			case YNABErrorCode.BAD_REQUEST:
				return "Bad request - invalid parameters";
			case YNABErrorCode.UNAUTHORIZED:
				return "Invalid or expired YNAB access token";
			case YNABErrorCode.FORBIDDEN:
				return "Insufficient permissions to access YNAB data";
			case YNABErrorCode.NOT_FOUND:
				return this.getNotFoundMessage(context);
			case YNABErrorCode.TOO_MANY_REQUESTS:
				return "Rate limit exceeded. Please try again later";
			case YNABErrorCode.INTERNAL_SERVER_ERROR:
				return "YNAB service is currently unavailable";
			default:
				return this.getGenericErrorMessage(context);
		}
	}

	/**
	 * Returns context-specific not found error messages
	 */
	private getNotFoundMessage(context: string): string {
		if (context.includes("listing accounts")) {
			return "Failed to list accounts - budget or account not found";
		}
		if (context.includes("getting account")) {
			return "Failed to get account - budget or account not found";
		}
		if (
			context.includes("listing budgets") ||
			context.includes("getting budget")
		) {
			return "Budget not found";
		}
		if (
			context.includes("listing categories") ||
			context.includes("getting category")
		) {
			return "Budget or category not found";
		}
		if (
			context.includes("listing months") ||
			context.includes("getting month")
		) {
			return "Budget or month not found";
		}
		if (
			context.includes("listing payees") ||
			context.includes("getting payee")
		) {
			return "Budget or payee not found";
		}
		if (context.includes("transaction")) {
			return "Budget, account, category, or transaction not found";
		}
		return "The requested resource was not found. Please verify the provided IDs are correct.";
	}

	/**
	 * Returns context-specific generic error messages
	 */
	private getGenericErrorMessage(context: string): string {
		const match = GENERIC_ERROR_MESSAGES.find(([needle]) =>
			context.includes(needle),
		);
		return match ? match[1] : `An error occurred while ${context}`;
	}

	/**
	 * Extracts HTTP status code from various error shapes
	 */
	private extractHttpStatus(
		error: unknown,
		seen = new Set<object>(),
	): number | null {
		if (!error || typeof error !== "object" || seen.has(error)) {
			return null;
		}
		seen.add(error);

		const directStatus = (error as { status?: unknown }).status;
		if (
			typeof directStatus === "number" &&
			Number.isInteger(directStatus) &&
			directStatus > 0
		) {
			return directStatus;
		}

		const response = (error as { response?: unknown }).response;
		if (response && typeof response === "object") {
			const responseStatus = (response as { status?: unknown }).status;
			if (
				typeof responseStatus === "number" &&
				Number.isInteger(responseStatus) &&
				responseStatus > 0
			) {
				return responseStatus;
			}
		}

		// The SDK wraps failures from its fetch hook in FetchError.cause.
		return this.extractHttpStatus((error as { cause?: unknown }).cause, seen);
	}

	/**
	 * Maps HTTP status codes to standardized YNAB error codes
	 */
	private mapHttpStatusToErrorCode(status: number): YNABErrorCode | null {
		switch (status) {
			case YNABErrorCode.BAD_REQUEST:
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
		if (error && typeof error === "object") {
			const response = (error as { response?: unknown }).response;
			if (response && typeof response === "object") {
				const statusText = (response as { statusText?: unknown }).statusText;
				if (typeof statusText === "string" && statusText.trim().length > 0) {
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
	private extractYNABApiError(
		error: unknown,
	): { code: YNABErrorCode; details?: string } | null {
		const payload = this.extractYNABErrorPayload(error);
		if (!payload) {
			return null;
		}

		const code = this.resolveYNABErrorCode(
			(payload as { id?: unknown }).id,
			(payload as { name?: unknown }).name,
		);
		if (!code) {
			return null;
		}

		const detail = (payload as { detail?: unknown }).detail;
		const details = this.formatYNABErrorDetail(detail);
		return details !== undefined ? { code, details } : { code };
	}

	private extractYNABErrorPayload(error: unknown): object | null {
		if (!error || typeof error !== "object") {
			return null;
		}

		let payload = (error as { error?: unknown }).error;
		if (!payload) {
			const responseData = (error as { response?: { data?: unknown } }).response
				?.data;
			if (responseData && typeof responseData === "object") {
				payload = (responseData as { error?: unknown }).error;
			}
		}

		return payload && typeof payload === "object" ? payload : null;
	}

	private resolveYNABErrorCode(
		id: unknown,
		name: unknown,
	): YNABErrorCode | null {
		if (typeof id === "string") {
			const numeric = Number.parseInt(id, 10);
			if (!Number.isNaN(numeric)) {
				const mapped = this.mapHttpStatusToErrorCode(numeric);
				if (mapped) {
					return mapped;
				}
			}
		}

		if (typeof name === "string") {
			const normalized = name.toLowerCase();
			const match = YNAB_ERROR_NAME_CODES.find(([patterns]) =>
				patterns.some((pattern) => normalized.includes(pattern)),
			);
			if (match) {
				return match[1];
			}
		}

		return null;
	}

	private formatYNABErrorDetail(detail: unknown): string | undefined {
		if (typeof detail !== "string") {
			return undefined;
		}
		// YNAB reports an unknown but well-formed ID the same way as a malformed one.
		if (/formatted as a uuid/i.test(detail)) {
			return `${detail} (YNAB also returns this for a valid UUID that does not exist in this budget; check the ID with the matching list tool)`;
		}
		return detail;
	}

	/**
	 * Sanitizes error details to prevent sensitive data leakage
	 */
	private sanitizeErrorDetails(error: unknown): string | undefined {
		if (!error) return undefined;

		let details = "";
		if (error instanceof Error) {
			details = error.message;
		} else if (typeof error === "string") {
			details = error;
		} else {
			details = "Unknown error details";
		}

		// Remove sensitive information patterns
		details = details
			// token=..., token: ..., token ... → redact until delimiter or whitespace
			.replace(/token[s]?[:\s=]+([^\s,"']+)/gi, "token=***")
			.replace(/key[s]?[:\s=]+([^\s,"']+)/gi, "key=***")
			.replace(/password[s]?[:\s=]+([^\s,"']+)/gi, "password=***")
			// Authorization header (any scheme), redact rest of value
			.replace(/authorization[:\s=]+[^\r\n]+/gi, "authorization=***")
			// Common Bearer/JWT forms in free text
			.replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");

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
	 * Creates a validation error for invalid parameters
	 */
	createValidationError(
		message: string,
		details?: string,
		suggestions?: string[],
	): CallToolResult {
		return this.handleError(
			new ValidationError(message, details, suggestions),
			"validating parameters",
		);
	}

	/**
	 * Creates a YNAB API error with specific error code
	 */
	createYNABError(
		code: YNABErrorCode,
		context: string,
		originalError?: unknown,
	): YNABAPIError {
		const message = this.getErrorMessage(code, context);
		return new YNABAPIError(code, message, originalError);
	}
}

export const defaultErrorHandler = new ErrorHandler();

/**
 * Utility function for handling errors in tool handlers
 */
export function handleToolError(
	error: unknown,
	toolName: string,
	operation: string,
	errorHandler?: ErrorHandler,
): CallToolResult {
	const eh = errorHandler ?? defaultErrorHandler;
	return eh.handleError(error, `executing ${toolName} - ${operation}`);
}

/**
 * Utility function for wrapping tool operations with error handling
 */
export async function withToolErrorHandling<T>(
	operation: () => Promise<T>,
	toolName: string,
	operationName: string,
	errorHandler?: ErrorHandler,
): Promise<T | CallToolResult> {
	const eh = errorHandler ?? defaultErrorHandler;
	return eh.withErrorHandling(
		operation,
		`executing ${toolName} - ${operationName}`,
	);
}
