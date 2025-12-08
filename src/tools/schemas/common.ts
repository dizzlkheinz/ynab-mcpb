import { z } from 'zod/v4';

/**
 * Strict empty object schema used for tools that do not accept input params.
 */
export const emptyObjectSchema = z.object({}).strict();

/**
 * Permissive object schema used when hosts require a top-level object but we
 * intentionally allow passthrough properties (e.g., mutation tool outputs).
 */
export const LooseObjectSchema = z.object({}).passthrough();
