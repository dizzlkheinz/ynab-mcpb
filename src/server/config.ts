import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { ValidationError } from '../utils/errors.js';

const envSchema = z.object({
  YNAB_ACCESS_TOKEN: z
    .string()
    .min(1, 'YNAB_ACCESS_TOKEN is required. Please provide it in your .env file.'),
  MCP_PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

function parseConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const validationError = fromZodError(result.error);
    throw new ValidationError(validationError.toString());
  }
  return result.data;
}

export const config = parseConfig();
