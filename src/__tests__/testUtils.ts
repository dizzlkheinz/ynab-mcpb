import type { ToolRegistry } from '../server/toolRegistry.js';
/**
 * Test utilities for comprehensive testing suite
 */

import { expect } from 'vitest';
import { YNABMCPServer } from '../server/YNABMCPServer.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Test environment configuration
 */
export interface TestConfig {
  hasRealApiKey: boolean;
  testBudgetId: string | undefined;
  testAccountId: string | undefined;
  skipE2ETests: boolean;
}

/**
 * Get test configuration from environment
 */
export function getTestConfig(): TestConfig {
  const hasRealApiKey = !!process.env['YNAB_ACCESS_TOKEN'];
  const skipE2ETests = process.env['SKIP_E2E_TESTS'] === 'true' || !hasRealApiKey;

  return {
    hasRealApiKey,
    testBudgetId: process.env['TEST_BUDGET_ID'],
    testAccountId: process.env['TEST_ACCOUNT_ID'],
    skipE2ETests,
  };
}

/**
 * Create a test server instance
 */
export async function createTestServer(): Promise<YNABMCPServer> {
  if (!process.env['YNAB_ACCESS_TOKEN']) {
    throw new Error('YNAB_ACCESS_TOKEN is required for testing');
  }

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
  const accessToken = process.env['YNAB_ACCESS_TOKEN'];
  if (!accessToken) {
    throw new Error('YNAB_ACCESS_TOKEN is required for tool execution');
  }

  const registry = (server as unknown as { toolRegistry: ToolRegistry }).toolRegistry;
  const normalizedName = toolName.startsWith('ynab:')
    ? toolName.slice(toolName.indexOf(':') + 1)
    : toolName;

  return await registry.executeTool({
    name: normalizedName,
    accessToken,
    arguments: args,
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
    expect(content.type).toBe('text');
    expect(typeof content.text).toBe('string');
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
  if (!content || content.type !== 'text') {
    return false;
  }

  try {
    const parsed = JSON.parse(content.text);
    return parsed && typeof parsed === 'object' && 'error' in parsed;
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
    return '';
  }

  const content = result.content[0];
  if (!content || content.type !== 'text') {
    return '';
  }

  try {
    const parsed = JSON.parse(content.text);
    const error = parsed?.error;
    if (typeof error === 'string' && error.length > 0) {
      return error;
    }
    if (error && typeof error === 'object') {
      const {
        message,
        userMessage,
        details,
        suggestions,
        name,
      } = error as Record<string, unknown>;

      let errorMessage = '';
      if (typeof message === 'string' && message.length > 0) {
        errorMessage = message;
      } else if (typeof userMessage === 'string' && userMessage.length > 0) {
        errorMessage = userMessage;
      } else if (typeof name === 'string' && name.length > 0) {
        errorMessage = name;
      }

      // Include details if available
      if (typeof details === 'string' && details.length > 0) {
        errorMessage += `\n\n${details}`;
      }

      // Include suggestions if available
      if (Array.isArray(suggestions) && suggestions.length > 0) {
        const suggestionsText = suggestions
          .filter((s) => typeof s === 'string')
          .map((s, i) => `${i + 1}. ${s}`)
          .join('\n');
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
  if (!content || content.type !== 'text') {
    throw new Error('No text content in tool result');
  }

  const text = content.text;
  if (typeof text !== 'string') {
    throw new Error('Tool result text is not a string');
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | T;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;

      // Handle backward compatibility - ensure both success and data properties exist
      if ('data' in record) {
        // Response already has data property, add success if missing
        if (!('success' in record)) {
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
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100,
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
      date: new Date().toISOString().split('T')[0], // Today's date
      cleared: 'uncleared' as const,
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
 * Test data cleanup utilities
 */
export class TestDataCleanup {
  private createdAccountIds: string[] = [];
  private createdTransactionIds: string[] = [];

  /**
   * Track created account for cleanup
   */
  trackAccount(accountId: string): void {
    this.createdAccountIds.push(accountId);
  }

  /**
   * Track created transaction for cleanup
   */
  trackTransaction(transactionId: string): void {
    this.createdTransactionIds.push(transactionId);
  }

  /**
   * Clean up all tracked test data
   */
  async cleanup(server: YNABMCPServer, budgetId: string): Promise<void> {
    // Clean up transactions first (they depend on accounts)
    for (const transactionId of this.createdTransactionIds) {
      try {
        await executeToolCall(server, 'ynab:delete_transaction', {
          budget_id: budgetId,
          transaction_id: transactionId,
        });
      } catch (error) {
        console.warn(`Failed to cleanup transaction ${transactionId}:`, error);
      }
    }

    // Note: YNAB API doesn't support deleting accounts via API
    // Accounts created during testing will need manual cleanup
    if (this.createdAccountIds.length > 0) {
      console.warn(
        `Created ${this.createdAccountIds.length} test accounts that need manual cleanup:`,
        this.createdAccountIds,
      );
    }

    this.createdAccountIds = [];
    this.createdTransactionIds = [];
  }
}

/**
 * Assertion helpers for YNAB data
 */
export const YNABAssertions = {
  /**
   * Assert budget structure
   */
  assertBudget(budget: any): void {
    expect(budget).toBeDefined();
    expect(typeof budget.id).toBe('string');
    expect(typeof budget.name).toBe('string');
    expect(typeof budget.last_modified_on).toBe('string');
  },

  /**
   * Assert account structure
   */
  assertAccount(account: any): void {
    expect(account).toBeDefined();
    expect(typeof account.id).toBe('string');
    expect(typeof account.name).toBe('string');
    expect(typeof account.type).toBe('string');
    expect(typeof account.on_budget).toBe('boolean');
    expect(typeof account.closed).toBe('boolean');
    expect(typeof account.balance).toBe('number');
  },

  /**
   * Assert transaction structure
   */
  assertTransaction(transaction: any): void {
    expect(transaction).toBeDefined();
    expect(typeof transaction.id).toBe('string');
    expect(typeof transaction.date).toBe('string');
    expect(typeof transaction.amount).toBe('number');
    expect(typeof transaction.account_id).toBe('string');
    expect(['cleared', 'uncleared', 'reconciled']).toContain(transaction.cleared);
  },

  /**
   * Assert category structure
   */
  assertCategory(category: any): void {
    expect(category).toBeDefined();
    expect(typeof category.id).toBe('string');
    expect(typeof category.name).toBe('string');
    expect(typeof category.category_group_id).toBe('string');
    expect(typeof category.budgeted).toBe('number');
    expect(typeof category.activity).toBe('number');
    expect(typeof category.balance).toBe('number');
  },

  /**
   * Assert payee structure
   */
  assertPayee(payee: any): void {
    expect(payee).toBeDefined();
    expect(typeof payee.id).toBe('string');
    expect(typeof payee.name).toBe('string');
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
  const errorString = error.toString ? error.toString().toLowerCase() : String(error).toLowerCase();
  const hasRateLimitMessage =
    errorString.includes('rate limit') ||
    errorString.includes('too many requests') ||
    errorString.includes('429');

  // Check error object properties
  if (error && typeof error === 'object') {
    const statusCode = error.status || error.statusCode || error.error?.id;
    if (statusCode === 429 || statusCode === '429') return true;

    const errorName = error.name || error.error?.name || '';
    if (errorName.toLowerCase().includes('too_many_requests')) return true;

    // Check nested error objects
    if (error.error && typeof error.error === 'object') {
      const nestedId = error.error.id;
      const nestedName = error.error.name;
      if (nestedId === '429' || nestedName === 'too_many_requests') return true;
    }
  }

  return hasRateLimitMessage;
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
  context?: { skip: () => void }
): Promise<T | undefined> {
  try {
    return await testFn();
  } catch (error) {
    if (isRateLimitError(error)) {
      // Log the skip reason
      console.warn('⏭️  Skipping test due to YNAB API rate limit');

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