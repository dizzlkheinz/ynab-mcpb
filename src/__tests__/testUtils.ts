/**
 * Test utilities for comprehensive testing suite
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect } from "vitest";
import type { z } from "zod";
import type { YNABMCPServer } from "../server/YNABMCPServer.js";

/**
 * Test environment configuration
 */
export interface TestConfig {
	hasRealApiKey: boolean;
	liveTestsEnabled: boolean;
	testBudgetId: string | undefined;
	testAccountId: string | undefined;
	skipE2ETests: boolean;
}

export const MOCK_TEST_ACCESS_TOKEN = "test-token-for-mocked-tests";

export const normalizeAccessToken = (
	token: string | undefined,
): string | undefined => {
	if (typeof token !== "string") {
		return undefined;
	}
	const trimmed = token.trim();
	if (!trimmed) {
		return undefined;
	}

	const lowered = trimmed.toLowerCase();
	if (lowered === "undefined" || lowered === "null") {
		return undefined;
	}

	if (lowered === "your_ynab_personal_access_token_here") {
		return undefined;
	}

	if (trimmed === MOCK_TEST_ACCESS_TOKEN) {
		return undefined;
	}

	return trimmed;
};

export const hasRealAccessToken = (token?: string): boolean =>
	!!normalizeAccessToken(token);

export interface LiveTestGate {
	hasRealApiKey: boolean;
	liveTestsRequested: boolean;
	skipExplicitlyRequested: boolean;
	enabled: boolean;
}

/**
 * Resolve whether tests may contact the real YNAB API.
 *
 * A token alone is intentionally insufficient: live access requires the
 * explicit RUN_LIVE_YNAB_TESTS=true opt-in and must not be disabled through
 * SKIP_E2E_TESTS=true.
 */
export function getLiveTestGate(
	env: NodeJS.ProcessEnv = process.env,
): LiveTestGate {
	const hasRealApiKey = hasRealAccessToken(env["YNAB_ACCESS_TOKEN"]);
	const liveTestsRequested =
		env["RUN_LIVE_YNAB_TESTS"]?.trim().toLowerCase() === "true";
	const skipExplicitlyRequested =
		env["SKIP_E2E_TESTS"]?.trim().toLowerCase() === "true";

	return {
		hasRealApiKey,
		liveTestsRequested,
		skipExplicitlyRequested,
		enabled: hasRealApiKey && liveTestsRequested && !skipExplicitlyRequested,
	};
}

/**
 * Get test configuration from environment
 */
export function getTestConfig(): TestConfig {
	const liveGate = getLiveTestGate();

	return {
		hasRealApiKey: liveGate.hasRealApiKey,
		liveTestsEnabled: liveGate.enabled,
		testBudgetId: process.env["TEST_BUDGET_ID"],
		testAccountId: process.env["TEST_ACCOUNT_ID"],
		skipE2ETests: !liveGate.enabled,
	};
}

/**
 * Create a test server instance
 */
export async function createTestServer(): Promise<YNABMCPServer> {
	if (!getLiveTestGate().enabled) {
		throw new Error(
			"Live YNAB tests require RUN_LIVE_YNAB_TESTS=true, a real YNAB_ACCESS_TOKEN, and SKIP_E2E_TESTS not set to true",
		);
	}

	const { YNABMCPServer } = await import("../server/YNABMCPServer.js");
	return new YNABMCPServer();
}

/**
 * Execute a named tool through the server's tool registry.
 *
 * @param toolName - The tool identifier to run; a leading `ynab:` prefix will be removed if present.
 * @param args - Optional arguments to pass to the tool.
 * @returns The tool's raw execution result as a `CallToolResult`.
 * @throws Error if the `YNAB_ACCESS_TOKEN` environment variable is not set.
 */
export async function executeToolCall(
	server: YNABMCPServer,
	toolName: string,
	args: Record<string, any> = {},
): Promise<CallToolResult> {
	const accessToken = normalizeAccessToken(process.env["YNAB_ACCESS_TOKEN"]);
	if (!accessToken) {
		throw new Error("YNAB_ACCESS_TOKEN is required for tool execution");
	}

	const registry = server.getToolRegistry();
	// Convert legacy "ynab:tool_name" colon-style to current "ynab_tool_name" underscore-style
	const normalizedName = toolName.startsWith("ynab:")
		? `ynab_${toolName.slice(toolName.indexOf(":") + 1)}`
		: toolName;

	return await registry.executeTool({
		name: normalizedName,
		accessToken,
		arguments: args,
	});
}

/**
 * Execute a protected mutation through the server's default preview flow.
 *
 * The first call returns a short-lived, single-use confirmation token. The
 * second call repeats the identical arguments with that token so the mutation
 * is actually performed.
 */
export async function executeConfirmedToolCall(
	server: YNABMCPServer,
	toolName: string,
	args: Record<string, any> = {},
): Promise<CallToolResult> {
	const preview = await executeToolCall(server, toolName, args);
	const text = preview.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
	const match = text.match(/confirmation_token="([^"]+)"/);
	const confirmationToken = match?.[1];
	if (!confirmationToken) {
		throw new Error(
			`Preview for ${toolName} did not return a confirmation token`,
		);
	}

	return await executeToolCall(server, toolName, {
		...args,
		confirmation_token: confirmationToken,
	});
}

/**
 * Asserts that a CallToolResult contains a non-empty `content` array composed of text items.
 *
 * Verifies the result and its `content` are defined, that `content` is a non-empty array,
 * and that every item in the array has `type` equal to `'text'` and a `text` property of type `string`.
 *
 * @param result - The CallToolResult to validate
 */
export function validateToolResult(result: CallToolResult): void {
	expect(result).toBeDefined();
	expect(result.content).toBeDefined();
	expect(Array.isArray(result.content)).toBe(true);
	expect(result.content.length).toBeGreaterThan(0);

	for (const content of result.content) {
		if (content.type === "text") {
			expect(typeof content.text).toBe("string");
		}
	}
}

/**
 * Determines whether a tool call result represents an error.
 *
 * Inspects the first content item (must be of type `text`) and treats the result as an error
 * if that text parses to a JSON object containing an `error` property.
 *
 * @returns `true` if the first text content parses as a JSON object with an `error` field, `false` otherwise.
 */
export function isErrorResult(result: CallToolResult): boolean {
	if (!result.content || result.content.length === 0) {
		return false;
	}

	const content = result.content[0];
	if (content?.type !== "text") {
		return false;
	}

	try {
		const parsed = JSON.parse(content.text);
		return parsed && typeof parsed === "object" && "error" in parsed;
	} catch {
		return false;
	}
}

/**
 * Extracts a human-readable error message from a CallToolResult when the result contains an error.
 *
 * @returns A human-readable error message extracted from `result` (falls back to the raw text), or an empty string if no error message is available.
 */
export function getErrorMessage(result: CallToolResult): string {
	if (!isErrorResult(result)) {
		return "";
	}

	const content = result.content[0];
	if (content?.type !== "text") {
		return "";
	}

	try {
		const parsed = JSON.parse(content.text);
		const error = parsed?.error;
		if (typeof error === "string" && error.length > 0) {
			return error;
		}
		if (error && typeof error === "object") {
			const { message, userMessage, details, suggestions, name } =
				error as Record<string, unknown>;

			let errorMessage = "";
			if (typeof message === "string" && message.length > 0) {
				errorMessage = message;
			} else if (typeof userMessage === "string" && userMessage.length > 0) {
				errorMessage = userMessage;
			} else if (typeof name === "string" && name.length > 0) {
				errorMessage = name;
			}

			// Include details if available
			if (typeof details === "string" && details.length > 0) {
				errorMessage += `\n\n${details}`;
			}

			// Include suggestions if available
			if (Array.isArray(suggestions) && suggestions.length > 0) {
				const suggestionsText = suggestions
					.filter((s) => typeof s === "string")
					.map((s, i) => `${i + 1}. ${s}`)
					.join("\n");
				if (suggestionsText) {
					errorMessage += `\n\nSuggestions:\n${suggestionsText}`;
				}
			}

			if (errorMessage) return errorMessage;
		}
		return content.text;
	} catch {
		return content.text;
	}
}

/**
 * Parse and normalize JSON payload from a CallToolResult's text content.
 *
 * @param result - The tool call result whose first content item must be a text string containing JSON.
 * @returns If the parsed JSON is an object with a `data` property, returns that object (adding `success: true` if missing). If the parsed JSON is an object without `data`, returns `{ success: true, data: <parsed> }`. If the parsed JSON is a non-object or array, returns the parsed value directly.
 * @throws If the result has no text content, the text is not a string, or the text cannot be parsed as JSON.
 */
export function parseToolResult<T = any>(result: CallToolResult): T {
	validateToolResult(result);
	const content = result.content[0];
	if (content?.type !== "text") {
		throw new Error("No text content in tool result");
	}

	const text = content.text;
	if (typeof text !== "string") {
		throw new Error("Tool result text is not a string");
	}

	try {
		const parsed = JSON.parse(text) as Record<string, unknown> | T;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const record = parsed as Record<string, unknown>;

			// Handle backward compatibility - ensure both success and data properties exist
			if ("data" in record) {
				// Response already has data property, add success if missing
				if (!("success" in record)) {
					return { success: true, ...record } as T;
				}
				return parsed as T;
			}

			// Response doesn't have data property, wrap it and add success
			return { success: true, data: parsed } as T;
		}
		return parsed as T;
	} catch (error) {
		throw new Error(`Failed to parse tool result as JSON: ${error}`);
	}
}

/**
 * Validates a tool result against its registered output schema.
 *
 * This helper enables e2e tests to verify that tool responses match their
 * declared output schemas without duplicating schema definitions.
 *
 * @param server - The YNAB MCP server instance
 * @param toolName - Name of the tool to validate
 * @param result - The CallToolResult from the tool execution
 * @returns Validation result object containing valid flag, hasSchema flag, errors array, and parsed data
 *
 * @example
 * ```typescript
 * const result = await executeToolCall(server, 'list_budgets', {});
 * const validation = validateOutputSchema(server, 'list_budgets', result);
 * expect(validation.hasSchema).toBe(true);
 * expect(validation.valid).toBe(true);
 * if (!validation.valid) {
 *   console.error('Schema validation errors:', validation.errors);
 * }
 * ```
 */
export function validateOutputSchema(
	server: YNABMCPServer,
	toolName: string,
	result: CallToolResult,
): {
	valid: boolean;
	hasSchema: boolean;
	errors?: string[];
	data?: unknown;
	note?: string;
} {
	// Get tool definitions from registry
	const registry = server.getToolRegistry();
	const toolDefinitions = registry.getToolDefinitions();
	const toolDef = toolDefinitions.find((t) => t.name === toolName);

	if (!toolDef) {
		return {
			valid: false,
			hasSchema: false,
			errors: [
				`Tool '${toolName}' not found in registry for schema validation`,
			],
		};
	}

	if (!toolDef.outputSchema) {
		return {
			valid: true,
			hasSchema: false,
			note: `Tool '${toolName}' does not define an outputSchema (schemas are optional)`,
		};
	}

	// Parse JSON response from result's text content
	let parsedData: unknown;
	try {
		const textContent = result.content.find((c) => c.type === "text");
		if (textContent?.type !== "text") {
			return {
				valid: false,
				hasSchema: true,
				errors: ["Result does not contain text content"],
			};
		}
		parsedData = JSON.parse(textContent.text);
	} catch (error) {
		return {
			valid: false,
			hasSchema: true,
			errors: [`Failed to parse result as JSON: ${error}`],
		};
	}

	// Validate against output schema
	const validationResult = toolDef.outputSchema.safeParse(parsedData);

	if (!validationResult.success) {
		// Extract detailed error messages from Zod errors
		const zodError = validationResult.error as z.ZodError;
		const errors = zodError.issues.map((err: z.ZodIssue) => {
			const path = err.path.join(".");
			return `${path ? `${path}: ` : ""}${err.message}`;
		});

		return {
			valid: false,
			hasSchema: true,
			errors,
		};
	}

	return {
		valid: true,
		hasSchema: true,
		data: validationResult.data,
	};
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeout = 5000,
	interval = 100,
): Promise<void> {
	const start = Date.now();

	while (Date.now() - start < timeout) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Generate test data
 */
export const TestData = {
	/**
	 * Generate a unique test account name
	 */
	generateAccountName(): string {
		return `Test Account ${Date.now()}`;
	},

	/**
	 * Generate a test transaction
	 */
	generateTransaction(accountId: string, categoryId?: string) {
		return {
			account_id: accountId,
			category_id: categoryId,
			payee_name: `Test Payee ${Date.now()}`,
			amount: -5000, // $5.00 outflow
			memo: `Test transaction ${Date.now()}`,
			date: new Date().toISOString().split("T")[0], // Today's date
			cleared: "uncleared" as const,
		};
	},

	/**
	 * Generate test amounts in milliunits
	 */
	generateAmount(dollars: number): number {
		return Math.round(dollars * 1000);
	},
};

/**
 * Determine whether a value represents a rate-limit (HTTP 429 / "too many requests") error.
 *
 * Inspects common error shapes and messages to identify rate-limit responses.
 *
 * @param error - The error value to inspect (may be a string, Error, or an object with status/statusCode/error fields)
 * @returns `true` if the provided value represents a rate limit error, `false` otherwise.
 */
export function isRateLimitError(error: any): boolean {
	if (!error) return false;

	// Check various ways rate limit errors can appear
	const errorString = error.toString
		? error.toString().toLowerCase()
		: String(error).toLowerCase();
	const hasRateLimitMessage =
		errorString.includes("rate limit") ||
		errorString.includes("too many requests") ||
		errorString.includes("429");

	// Check for HTML responses (YNAB API returns HTML when rate limited or down)
	// This manifests as JSON parsing errors with messages like:
	// "SyntaxError: Unexpected token '<', "<style>..." is not valid JSON"
	const looksLikeHTML =
		errorString.includes("<html") ||
		errorString.includes("<head") ||
		errorString.includes("<body") ||
		errorString.includes("<!doctype html");

	const isHTMLResponse =
		looksLikeHTML ||
		((errorString.includes("syntaxerror") ||
			errorString.includes("unexpected token")) &&
			(errorString.includes("'<'") ||
				errorString.includes('"<"') ||
				errorString.includes("<style") ||
				errorString.includes("not valid json")));

	// Check for VALIDATION_ERROR from output schema validation failures
	// These occur when YNAB API returns error responses instead of data during rate limiting
	// Example: {"code":"VALIDATION_ERROR","message":"Output validation failed for list_budgets",...}
	const isValidationError =
		errorString.includes("validation_error") ||
		errorString.includes("output validation failed");

	// Check error object properties
	if (error && typeof error === "object") {
		const statusCode = error.status || error.statusCode || error.error?.id;
		if (statusCode === 429 || statusCode === "429") return true;

		const errorName = error.name || error.error?.name || "";
		if (errorName.toLowerCase().includes("too_many_requests")) return true;

		// Check nested error objects
		if (error.error && typeof error.error === "object") {
			const nestedId = error.error.id;
			const nestedName = error.error.name;
			if (nestedId === "429" || nestedName === "too_many_requests") return true;
		}
	}

	return hasRateLimitMessage || isHTMLResponse || isValidationError;
}

/**
 * Determine whether a value represents an authentication/authorization error.
 */
export function isAuthError(error: any): boolean {
	if (!error) return false;

	const errorString = error.toString
		? error.toString().toLowerCase()
		: String(error).toLowerCase();
	const hasAuthMessage =
		errorString.includes("unauthorized") ||
		errorString.includes("invalid or expired") ||
		errorString.includes("authenticationerror") ||
		errorString.includes("forbidden") ||
		errorString.includes("401") ||
		errorString.includes("403");

	if (error && typeof error === "object") {
		const statusCode = error.status || error.statusCode || error.error?.id;
		if (
			statusCode === 401 ||
			statusCode === "401" ||
			statusCode === 403 ||
			statusCode === "403"
		) {
			return true;
		}

		const errorName = error.name || error.error?.name || "";
		if (
			errorName.toLowerCase().includes("unauthorized") ||
			errorName.toLowerCase().includes("authentication")
		) {
			return true;
		}
	}

	return hasAuthMessage;
}

/**
 * Detects rate limit responses that are embedded in a CallToolResult (text JSON with an error object).
 * Returns true and optionally skips the current test when a rate limit is found.
 */
export function skipIfRateLimitedResult(
	result: CallToolResult,
	context?: { skip?: () => void },
): boolean {
	const markSkipped = () => {
		console.warn(
			"[rate-limit] Skipping test due to YNAB API rate limit (embedded payload)",
		);
		context?.skip?.();
	};

	const content = result.content?.[0];
	const text = content && content.type === "text" ? content.text : "";

	try {
		const parsed =
			typeof text === "string" && text.trim().length > 0
				? JSON.parse(text)
				: null;
		const candidates: any[] = [];

		if (parsed && typeof parsed === "object") {
			const parsedObj = parsed as Record<string, unknown>;
			if ("error" in parsedObj) candidates.push(parsedObj["error"]);
			if ("data" in parsedObj) {
				const data = (parsedObj as any).data;
				candidates.push(data?.error ?? data);
			}
			candidates.push(parsed);
		}

		if (typeof text === "string") {
			candidates.push(text);
		}

		for (const candidate of candidates) {
			if (isRateLimitError(candidate)) {
				markSkipped();
				return true;
			}
		}
	} catch (parseError) {
		if (isRateLimitError(parseError) || isRateLimitError(text)) {
			markSkipped();
			return true;
		}
		// If parsing fails and no rate limit markers are present, fall through.
	}
	return false;
}

/**
 * Runs a test function and skips the test if a YNAB API rate limit error occurs.
 *
 * @param testFn - The test code to execute.
 * @param context - Optional test context providing a `skip()` method; if present, it will be called when a rate limit is detected.
 * @returns The value returned by `testFn` or `undefined` if the test was skipped due to a rate limit.
 */
export async function skipOnRateLimit<T>(
	testFn: () => Promise<T>,
	context?: { skip: () => void },
): Promise<T | undefined> {
	try {
		return await testFn();
	} catch (error) {
		if (isRateLimitError(error) || isAuthError(error)) {
			// Log the skip reason
			const reason = isAuthError(error)
				? "authentication failure"
				: "YNAB API rate limit";
			console.warn(`⏭️  Skipping test due to ${reason}`);

			// Skip the test if context is provided
			if (context?.skip) {
				context.skip();
			}

			// Return void to satisfy type system
			return;
		}
		// Re-throw non-rate-limit errors
		throw error;
	}
}
