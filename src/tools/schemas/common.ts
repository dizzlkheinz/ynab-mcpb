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

const ISO_DATE_MESSAGE = "Date must be a valid ISO date (YYYY-MM-DD)";

/**
 * YYYY-MM-DD date. Surrounding whitespace is ignored.
 */
export const isoDateSchema = z
	.string()
	.trim()
	.refine(isValidISODate, ISO_DATE_MESSAGE)
	.meta({ format: "date" });

/**
 * Optional YYYY-MM-DD date. An empty or whitespace-only string parses as
 * undefined, as clients often send one for an unused field.
 */
export const optionalDateSchema = z
	.string()
	.trim()
	.refine((value) => value === "" || isValidISODate(value), ISO_DATE_MESSAGE)
	.transform((value) => value || undefined)
	.meta({ format: "date" })
	.optional();
