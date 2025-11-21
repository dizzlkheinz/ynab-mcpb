import 'dotenv/config';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { ValidationError } from '../utils/errors.js';

const envSchema = z.object({
  YNAB_ACCESS_TOKEN: z
    .string()
    .trim()
    .min(1, 'YNAB_ACCESS_TOKEN must be a non-empty string'),
  MCP_PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const validationError = fromZodError(result.error);
    throw new ValidationError(validationError.toString());
  }
  return result.data;
}

export const config = loadConfig();
