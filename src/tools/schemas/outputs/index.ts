/**
 * @fileoverview Central export point for all output schemas
 *
 * This file provides a single import location for all output validation schemas
 * used throughout the YNAB MCP server. Import from this file rather than
 * individual schema files for convenience and consistency.
 *
 * This file will be extended in future phases with additional output schema files
 * (e.g., budgetOutputs.ts, accountOutputs.ts, transactionOutputs.ts, etc.) as
 * other engineers implement output schemas for their respective tool domains.
 *
 * @example
 * ```typescript
 * import { GetUserOutputSchema, type GetUserOutput } from './schemas/outputs/index.js';
 * ```
 */

// ============================================================================
// UTILITY TOOL OUTPUT SCHEMAS
// ============================================================================

// Main output schemas
export {
  GetUserOutputSchema,
  type GetUserOutput,
  ConvertAmountOutputSchema,
  type ConvertAmountOutput,
  GetDefaultBudgetOutputSchema,
  type GetDefaultBudgetOutput,
  SetDefaultBudgetOutputSchema,
  type SetDefaultBudgetOutput,
  ClearCacheOutputSchema,
  type ClearCacheOutput,
  SetOutputFormatOutputSchema,
  type SetOutputFormatOutput,
  DiagnosticInfoOutputSchema,
  type DiagnosticInfoOutput,
  GetBudgetOutputSchema,
  type GetBudgetOutput,
} from './utilityOutputs.js';

// Nested schemas that may be useful independently
export {
  UserSchema,
  ConversionSchema,
  DateFormatSchema,
  CurrencyFormatSchema,
  BudgetDetailSchema,
  ServerInfoSchema,
  MemoryInfoSchema,
  EnvironmentInfoSchema,
  CacheInfoSchema,
  DeltaInfoSchema,
} from './utilityOutputs.js';
