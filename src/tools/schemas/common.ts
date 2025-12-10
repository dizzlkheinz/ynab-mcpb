/**
 * @fileoverview Shared Zod schemas used across multiple tool domains.
 * @module tools/schemas/common
 */

import { z } from 'zod/v4';

/**
 * Strict empty object schema used for tools that do not accept input params.
 * Examples: list_budgets, get_user, get_default_budget, clear_cache
 */
export const emptyObjectSchema = z.object({}).strict();

/**
 * Permissive object schema used when hosts require a top-level object but we
 * intentionally allow passthrough properties (e.g., mutation tool outputs).
 */
export const LooseObjectSchema = z.object({}).passthrough();
