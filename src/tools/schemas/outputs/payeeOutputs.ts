/**
 * @fileoverview Output schemas for payee-related tools.
 *
 * Defines Zod schemas and TypeScript types for responses from payee tools:
 * - `list_payees`: Returns all payees with pagination and cache metadata
 * - `get_payee`: Returns a single payee with cache metadata
 *
 * @see src/tools/payeeTools.ts:38-94 for list_payees handler
 * @see src/tools/payeeTools.ts:100-140 for get_payee handler
 *
 * @example
 * ```typescript
 * const listOutput: ListPayeesOutput = {
 *   payees: [
 *     {
 *       id: 'payee-123',
 *       name: 'Whole Foods',
 *       transfer_account_id: undefined,
 *       deleted: false
 *     },
 *     {
 *       id: 'payee-456',
 *       name: 'Transfer: Savings Account',
 *       transfer_account_id: 'account-789',
 *       deleted: false
 *     }
 *   ],
 *   total_count: 50,
 *   returned_count: 50,
 *   cached: true,
 *   cache_info: {
 *     cache_key: 'payees:budget-123',
 *     age_ms: 10000,
 *     stale: false
 *   }
 * };
 *
 * const getOutput: GetPayeeOutput = {
 *   payee: {
 *     id: 'payee-123',
 *     name: 'Whole Foods',
 *     deleted: false
 *   },
 *   cached: false,
 *   cache_info: {
 *     cache_key: 'payee:budget-123:payee-123',
 *     age_ms: 0,
 *     stale: false
 *   }
 * };
 * ```
 */

import { z } from 'zod/v4';
import { CacheMetadataSchema } from '../shared/commonOutputs.js';

/**
 * Schema for a payee object.
 *
 * Represents payee data including transfer account linkage.
 */
export const PayeeSchema = z.object({
  /** Unique identifier for the payee */
  id: z.string().describe('Payee ID'),

  /** Human-readable payee name */
  name: z.string().describe('Payee name'),

  /** Transfer account ID if this payee represents a transfer (optional) */
  transfer_account_id: z.string().optional().describe('Transfer account ID'),

  /** Whether payee is deleted */
  deleted: z.boolean().describe('Deleted flag'),
});

/**
 * Schema for `list_payees` tool output.
 *
 * Returns all payees for a budget with pagination and cache metadata.
 */
export const ListPayeesOutputSchema = CacheMetadataSchema.extend({
  /** Array of payee objects */
  payees: z.array(PayeeSchema).describe('List of payees'),

  /** Total number of payees in budget */
  total_count: z.number().int().describe('Total payee count'),

  /** Number of payees returned in this response */
  returned_count: z.number().int().describe('Returned payee count'),
});

/**
 * Schema for `get_payee` tool output.
 *
 * Returns a single payee by ID with cache metadata.
 */
export const GetPayeeOutputSchema = CacheMetadataSchema.extend({
  /** Single payee object */
  payee: PayeeSchema.describe('Payee details'),
});

// Export inferred TypeScript types
export type Payee = z.infer<typeof PayeeSchema>;
export type ListPayeesOutput = z.infer<typeof ListPayeesOutputSchema>;
export type GetPayeeOutput = z.infer<typeof GetPayeeOutputSchema>;
