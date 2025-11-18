/**
 * Common/shared Zod schemas for tool output structures
 *
 * Purpose: Provides reusable schema components for composing tool-specific output schemas
 * Usage: Import these schemas to build consistent output structures across tools
 * Pattern: These schemas represent common elements like cache metadata, success responses,
 *          pagination info, and standard response structures
 *
 * References:
 * - MCP Structured Output Specification: https://spec.modelcontextprotocol.io/specification/2025-11-05/server/tools/
 * - Existing cache patterns: src/tools/budgetTools.ts (lines 55-58)
 * - Success response patterns: src/server/YNABMCPServer.ts (lines 456-460)
 */

import { z } from 'zod/v4';

/**
 * CacheMetadataSchema
 *
 * Represents cache-related metadata returned by tools that support caching.
 * Used to provide transparency about whether data was served from cache,
 * cache status, and whether delta merge optimization was applied.
 *
 * Fields:
 * - cached: Boolean indicating if the response data came from cache
 * - cache_info: Human-readable message describing cache status (e.g., "Cache hit", "Cache miss")
 * - usedDelta: Boolean indicating if delta merge was applied (for budgets with delta support)
 *
 * Example usage in tool output:
 * ```typescript
 * {
 *   budgets: [...],
 *   cached: true,
 *   cache_info: "Cache hit",
 *   usedDelta: false
 * }
 * ```
 */
export const CacheMetadataSchema = z.object({
  cached: z.boolean().optional().describe('Indicates if data was served from cache'),
  cache_info: z
    .string()
    .optional()
    .describe('Human-readable cache status message (e.g., "Cache hit", "Cache miss")'),
  usedDelta: z
    .boolean()
    .optional()
    .describe('Indicates if delta merge optimization was applied for budgets'),
});

export type CacheMetadata = z.infer<typeof CacheMetadataSchema>;

/**
 * SuccessResponseSchema
 *
 * Standard schema for simple success confirmation responses.
 * Used by tools that perform operations and need to confirm success
 * with a human-readable message.
 *
 * Fields:
 * - success: Boolean indicating operation success (always true for success responses)
 * - message: Human-readable success message describing what was accomplished
 *
 * Example usage:
 * ```typescript
 * {
 *   success: true,
 *   message: "Default budget set to 'My Budget' (id: abc123)"
 * }
 * ```
 */
export const SuccessResponseSchema = z.object({
  success: z.boolean().describe('Indicates operation success'),
  message: z.string().describe('Human-readable success message'),
});

export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;

/**
 * ConfirmationResponseSchema
 *
 * Extended success response schema with optional additional details.
 * Used by tools that need to return success confirmation along with
 * structured context or metadata about the operation.
 *
 * Fields:
 * - success: Boolean indicating operation success
 * - message: Human-readable success message
 * - details: Optional record of additional confirmation details
 *
 * Example usage:
 * ```typescript
 * {
 *   success: true,
 *   message: "Account reconciled successfully",
 *   details: {
 *     cleared_balance: 1250.50,
 *     reconciliation_date: "2025-01-15"
 *   }
 * }
 * ```
 */
export const ConfirmationResponseSchema = SuccessResponseSchema.extend({
  details: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional confirmation details as key-value pairs'),
});

export type ConfirmationResponse = z.infer<typeof ConfirmationResponseSchema>;

/**
 * ErrorDetailsSchema
 *
 * Structured schema for error responses.
 * Note: Most error handling is done by ErrorHandler (src/server/errorHandler.ts),
 * but this schema provides a standard structure for tools that need to return
 * error information as part of their normal output.
 *
 * Fields:
 * - error: Error message string
 * - code: Optional error code for categorization
 * - details: Optional additional error details or context
 *
 * Example usage:
 * ```typescript
 * {
 *   error: "Transaction not found",
 *   code: "NOT_FOUND",
 *   details: "Transaction ID 'xyz789' does not exist in budget 'abc123'"
 * }
 * ```
 */
export const ErrorDetailsSchema = z.object({
  error: z.string().describe('Error message'),
  code: z.string().optional().describe('Error code for categorization'),
  details: z.string().optional().describe('Additional error context or details'),
});

export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>;
