/**
 * @fileoverview Output schemas for account-related tools.
 *
 * Defines Zod schemas and TypeScript types for responses from account tools:
 * - `list_accounts`: Returns all accounts with pagination and cache metadata
 * - `get_account`: Returns a single account with cache metadata
 *
 * @see src/tools/accountTools.ts:64-128 for list_accounts handler
 * @see src/tools/accountTools.ts:134-190 for get_account handler
 *
 * @example
 * ```typescript
 * const listOutput: ListAccountsOutput = {
 *   accounts: [
 *     {
 *       id: 'account-123',
 *       name: 'Checking Account',
 *       type: 'checking',
 *       on_budget: true,
 *       closed: false,
 *       note: 'Main checking account',
 *       balance: 2500.50,
 *       cleared_balance: 2400.00,
 *       uncleared_balance: 100.50,
 *       transfer_payee_id: 'payee-456',
 *       direct_import_linked: true,
 *       direct_import_in_error: false
 *     }
 *   ],
 *   total_count: 5,
 *   returned_count: 5,
 *   cached: true,
 *   cache_info: {
 *     cache_key: 'accounts:budget-123',
 *     age_ms: 3000,
 *     stale: false
 *   }
 * };
 *
 * const getOutput: GetAccountOutput = {
 *   account: {
 *     id: 'account-123',
 *     name: 'Checking Account',
 *     type: 'checking',
 *     on_budget: true,
 *     closed: false,
 *     balance: 2500.50,
 *     cleared_balance: 2400.00,
 *     uncleared_balance: 100.50,
 *     transfer_payee_id: 'payee-456'
 *   },
 *   cached: false,
 *   cache_info: {
 *     cache_key: 'account:budget-123:account-123',
 *     age_ms: 0,
 *     stale: false
 *   }
 * };
 * ```
 */

import { z } from 'zod/v4';
import { CacheMetadataSchema } from '../shared/commonOutputs.js';

/**
 * Schema for an account object.
 *
 * Represents account data with balances in dollars (converted from YNAB milliunits).
 */
export const AccountSchema = z.object({
  /** Unique identifier for the account */
  id: z.string().describe('Account ID'),

  /** Human-readable account name */
  name: z.string().describe('Account name'),

  /** Account type (checking, savings, creditCard, etc.) */
  type: z.string().describe('Account type'),

  /** Whether account is on-budget or tracking */
  on_budget: z.boolean().describe('On-budget flag'),

  /** Whether account is closed */
  closed: z.boolean().describe('Closed flag'),

  /** Optional account note */
  note: z.string().optional().describe('Account note'),

  /** Current account balance in dollars */
  balance: z.number().describe('Account balance in dollars'),

  /** Cleared balance in dollars */
  cleared_balance: z.number().describe('Cleared balance in dollars'),

  /** Uncleared balance in dollars */
  uncleared_balance: z.number().describe('Uncleared balance in dollars'),

  /** Payee ID for transfers to this account */
  transfer_payee_id: z.string().describe('Transfer payee ID'),

  /** Whether account is linked for direct import (optional) */
  direct_import_linked: z.boolean().optional().describe('Direct import linked flag'),

  /** Whether direct import is in error state (optional) */
  direct_import_in_error: z.boolean().optional().describe('Direct import error flag'),
});

/**
 * Schema for `list_accounts` tool output.
 *
 * Returns all accounts for a budget with pagination and cache metadata.
 */
export const ListAccountsOutputSchema = CacheMetadataSchema.extend({
  /** Array of account objects */
  accounts: z.array(AccountSchema).describe('List of accounts'),

  /** Total number of accounts in budget */
  total_count: z.number().int().describe('Total account count'),

  /** Number of accounts returned in this response */
  returned_count: z.number().int().describe('Returned account count'),
});

/**
 * Schema for `get_account` tool output.
 *
 * Returns a single account by ID with cache metadata.
 */
export const GetAccountOutputSchema = CacheMetadataSchema.extend({
  /** Single account object */
  account: AccountSchema.describe('Account details'),
});

// Export inferred TypeScript types
export type Account = z.infer<typeof AccountSchema>;
export type ListAccountsOutput = z.infer<typeof ListAccountsOutputSchema>;
export type GetAccountOutput = z.infer<typeof GetAccountOutputSchema>;
