/**
 * @fileoverview Shared Zod schemas used across multiple tool domains.
 * @module tools/schemas/common
 */

import { z } from "zod/v4";
import { isValidISODate } from "../../utils/dateUtils.js";

/**
 * Strict empty object schema used for tools that do not accept input params.
 * Examples: list_budgets, get_user, get_default_budget, clear_cache
 */
export const emptyObjectSchema = z.object({}).strict();

/**
 * Optional YYYY-MM-DD date. An empty string means no date, as clients often
 * send one for an unused field.
 */
export const optionalDateSchema = z
	.string()
	.refine(isValidISODate, "Date must be a valid ISO date (YYYY-MM-DD)")
	.or(z.literal(""))
	.optional();
