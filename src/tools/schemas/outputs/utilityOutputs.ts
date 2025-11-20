/**
 * @fileoverview Output schemas for utility tools
 *
 * This file contains comprehensive Zod schemas for validating the output
 * of utility tools including user info, amount conversion, budget defaults,
 * cache management, output formatting, and diagnostic information.
 *
 * All schemas include TypeScript type inference for type-safe usage throughout
 * the codebase. Reference the corresponding handler implementations for
 * exact response shape details.
 */

import { z } from 'zod/v4';
import { SuccessResponseSchema } from '../shared/commonOutputs.js';

// ============================================================================
// GET USER OUTPUT
// ============================================================================

/**
 * Schema for YNAB user object
 *
 * Represents the authenticated user's information from YNAB API.
 */
export const UserSchema = z.object({
  id: z.string(),
});

/**
 * Output schema for get_user tool
 *
 * Returns information about the authenticated YNAB user.
 *
 * @see src/tools/utilityTools.ts:23-45 - Handler implementation
 *
 * @example
 * ```typescript
 * const output: GetUserOutput = {
 *   user: { id: "abc123" }
 * };
 * ```
 */
export const GetUserOutputSchema = z.object({
  user: UserSchema,
});

export type GetUserOutput = z.infer<typeof GetUserOutputSchema>;

// ============================================================================
// CONVERT AMOUNT OUTPUT
// ============================================================================

/**
 * Schema for amount conversion details
 *
 * Contains the conversion result between dollars and YNAB milliunits.
 */
export const ConversionSchema = z.object({
  original_amount: z.number(),
  converted_amount: z.number(),
  to_milliunits: z.boolean(),
  description: z.string(),
});

/**
 * Output schema for convert_amount tool
 *
 * Converts between dollars and YNAB milliunits (1 dollar = 1000 milliunits).
 *
 * @see src/tools/utilityTools.ts:51-90 - Handler implementation
 *
 * @example
 * ```typescript
 * const output: ConvertAmountOutput = {
 *   conversion: {
 *     original_amount: 25.50,
 *     converted_amount: 25500,
 *     to_milliunits: true,
 *     description: "$25.50 converted to 25500 milliunits"
 *   }
 * };
 * ```
 */
export const ConvertAmountOutputSchema = z.object({
  conversion: ConversionSchema,
});

export type ConvertAmountOutput = z.infer<typeof ConvertAmountOutputSchema>;

// ============================================================================
// GET DEFAULT BUDGET OUTPUT
// ============================================================================

/**
 * Output schema for get_default_budget tool
 *
 * Returns the currently configured default budget ID (if any).
 *
 * @see src/server/YNABMCPServer.ts:474-510 - Handler implementation
 *
 * @example
 * ```typescript
 * const output: GetDefaultBudgetOutput = {
 *   default_budget_id: "abc123",
 *   has_default: true,
 *   message: "Default budget ID: abc123"
 * };
 * ```
 */
export const GetDefaultBudgetOutputSchema = z.object({
  default_budget_id: z.string().nullable(),
  has_default: z.boolean(),
  message: z.string(),
});

export type GetDefaultBudgetOutput = z.infer<typeof GetDefaultBudgetOutputSchema>;

// ============================================================================
// SET DEFAULT BUDGET OUTPUT
// ============================================================================

/**
 * Output schema for set_default_budget tool
 *
 * Confirms the default budget has been set and indicates whether cache warming started.
 *
 * @see src/server/YNABMCPServer.ts:437-471 - Handler implementation
 *
 * @example
 * ```typescript
 * const output: SetDefaultBudgetOutput = {
 *   success: true,
 *   message: "Default budget set to 'My Budget' and cache warming started",
 *   default_budget_id: "abc123",
 *   cache_warm_started: true
 * };
 * ```
 */
export const SetDefaultBudgetOutputSchema = SuccessResponseSchema.extend({
  default_budget_id: z.string(),
  cache_warm_started: z.boolean(),
});

export type SetDefaultBudgetOutput = z.infer<typeof SetDefaultBudgetOutputSchema>;

// ============================================================================
// CLEAR CACHE OUTPUT
// ============================================================================

/**
 * Output schema for clear_cache tool
 *
 * Simple success confirmation for cache clearing operation.
 *
 * @see src/server/YNABMCPServer.ts:852-868 - Handler implementation
 *
 * @example
 * ```typescript
 * const output: ClearCacheOutput = {
 *   success: true
 * };
 * ```
 */
export const ClearCacheOutputSchema = SuccessResponseSchema.pick({ success: true });

export type ClearCacheOutput = z.infer<typeof ClearCacheOutputSchema>;

// ============================================================================
// SET OUTPUT FORMAT OUTPUT
// ============================================================================

/**
 * Output schema for set_output_format tool
 *
 * Confirms output format settings have been updated.
 *
 * @see src/server/YNABMCPServer.ts:870-898 - Handler implementation
 *
 * @example
 * ```typescript
 * const output: SetOutputFormatOutput = {
 *   success: true,
 *   message: "Output format configured: minify=true, spaces=2",
 *   options: { defaultMinify: true, prettySpaces: 2 }
 * };
 * ```
 */
export const SetOutputFormatOutputSchema = SuccessResponseSchema.extend({
  options: z.object({
    defaultMinify: z.boolean().optional(),
    prettySpaces: z.number().optional(),
  }),
});

export type SetOutputFormatOutput = z.infer<typeof SetOutputFormatOutputSchema>;

// ============================================================================
// DIAGNOSTIC INFO OUTPUT
// ============================================================================

/**
 * Schema for server diagnostic information
 *
 * Contains runtime information about the MCP server process.
 */
export const ServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  node_version: z.string(),
  platform: z.string(),
  arch: z.string(),
  pid: z.number(),
  uptime_ms: z.number(),
  uptime_readable: z.string(),
  env: z.record(z.string(), z.unknown()),
});

/**
 * Schema for memory usage information
 *
 * Reports memory consumption of the MCP server process.
 */
export const MemoryInfoSchema = z.object({
  rss_mb: z.number(),
  heap_used_mb: z.number(),
  heap_total_mb: z.number(),
  external_mb: z.number(),
  array_buffers_mb: z.number(),
  description: z.record(z.string(), z.string()),
});

/**
 * Schema for environment configuration information
 *
 * Shows environment variable configuration status.
 */
export const EnvironmentInfoSchema = z.object({
  token_present: z.boolean(),
  token_length: z.number(),
  token_preview: z.string().nullable(),
  ynab_env_keys_present: z.array(z.string()),
  working_directory: z.string(),
});

/**
 * Schema for cache diagnostic information
 *
 * Reports cache status and performance metrics.
 */
export const CacheInfoSchema = z.object({
  entries: z.number(),
  estimated_size_kb: z.number(),
  keys: z.array(z.string()),
  // Optional performance metrics
  hits: z.number().optional(),
  misses: z.number().optional(),
  evictions: z.number().optional(),
  lastCleanup: z.string().nullable().optional(),
  maxEntries: z.number().optional(),
  hitRate: z.string().optional(),
  performance_summary: z.string().optional(),
});

/**
 * Schema for delta request optimization information
 *
 * Reports status of delta request feature and knowledge base.
 */
export const DeltaInfoSchema = z.object({
  enabled: z.boolean(),
  knowledge_entries: z.number(),
  knowledge_stats: z.record(z.string(), z.unknown()),
  feature_flag: z.string(),
  delta_hits: z.number(),
  delta_misses: z.number(),
  delta_hit_rate: z.number(),
  merge_operations: z.number(),
  knowledge_gap_events: z.number(),
});

/**
 * Output schema for diagnostic_info tool
 *
 * Returns comprehensive diagnostic information about the MCP server,
 * including runtime info, memory usage, environment configuration,
 * cache status, and delta request optimization metrics.
 *
 * @see src/server/diagnostics.ts:181-337 - Handler implementation
 *
 * @example
 * ```typescript
 * const output: DiagnosticInfoOutput = {
 *   timestamp: "2025-01-17T12:34:56.789Z",
 *   server: {
 *     name: "ynab-mcp-server",
 *     version: "0.12.0",
 *     node_version: "v20.10.0",
 *     // ... other server info
 *   },
 *   memory: {
 *     rss_mb: 45.2,
 *     heap_used_mb: 32.1,
 *     // ... other memory info
 *   },
 *   // ... other diagnostic sections
 * };
 * ```
 */
export const DiagnosticInfoOutputSchema = z.object({
  timestamp: z.string(),
  server: ServerInfoSchema.optional(),
  memory: MemoryInfoSchema.optional(),
  environment: EnvironmentInfoSchema.optional(),
  cache: CacheInfoSchema.optional(),
  delta: DeltaInfoSchema.optional(),
});

export type DiagnosticInfoOutput = z.infer<typeof DiagnosticInfoOutputSchema>;

// ============================================================================
// GET BUDGET OUTPUT
// ============================================================================

/**
 * Schema for YNAB date format configuration
 *
 * Represents how dates are formatted in the YNAB budget.
 */
export const DateFormatSchema = z.object({
  format: z.string(),
});

/**
 * Schema for YNAB currency format configuration
 *
 * Represents how currency values are formatted in the YNAB budget.
 */
export const CurrencyFormatSchema = z.object({
  iso_code: z.string(),
  example_format: z.string(),
  decimal_digits: z.number(),
  decimal_separator: z.string().optional(),
  symbol_first: z.boolean().optional(),
  group_separator: z.string().optional(),
  currency_symbol: z.string().optional(),
  display_symbol: z.boolean().optional(),
});

/**
 * Schema for detailed budget information
 *
 * Contains comprehensive details about a YNAB budget including
 * format settings and entity counts.
 */
export const BudgetDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  last_modified_on: z.string().optional(),
  first_month: z.string().optional(),
  last_month: z.string().optional(),
  date_format: DateFormatSchema.optional(),
  currency_format: CurrencyFormatSchema.optional(),
  accounts_count: z.number(),
  categories_count: z.number(),
  payees_count: z.number(),
  months_count: z.number(),
  message: z.string(),
});

/**
 * Output schema for get_budget tool
 *
 * Returns detailed information about a specific budget including
 * format settings, date ranges, and counts of budget entities.
 *
 * @see src/tools/budgetTools.ts:73-112 - Handler implementation
 *
 * @example
 * ```typescript
 * const output: GetBudgetOutput = {
 *   budget: {
 *     id: "abc123",
 *     name: "My Budget",
 *     last_modified_on: "2025-01-17T12:00:00Z",
 *     first_month: "2024-01",
 *     last_month: "2025-12",
 *     date_format: { format: "MM/DD/YYYY" },
 *     currency_format: {
 *       iso_code: "USD",
 *       example_format: "$1,234.56",
 *       decimal_digits: 2,
 *       decimal_separator: ".",
 *       symbol_first: true,
 *       group_separator: ",",
 *       currency_symbol: "$",
 *       display_symbol: true
 *     },
 *     accounts_count: 5,
 *     categories_count: 25,
 *     payees_count: 100,
 *     months_count: 24,
 *     message: "Budget 'My Budget' retrieved successfully"
 *   }
 * };
 * ```
 */
export const GetBudgetOutputSchema = z.object({
  budget: BudgetDetailSchema,
});

export type GetBudgetOutput = z.infer<typeof GetBudgetOutputSchema>;
