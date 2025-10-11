/**
 * Configuration module for YNAB MCP Server
 *
 * Handles environment validation and server configuration.
 * Extracted from YNABMCPServer to provide focused, testable configuration management.
 */

import { ServerConfig, ConfigurationError } from '../types/index.js';

/**
 * Create a ServerConfig from environment variables after validating required values.
 *
 * @returns The validated ServerConfig.
 * @throws ConfigurationError if `YNAB_ACCESS_TOKEN` is missing or not a non-empty string.
 */
export function validateEnvironment(): ServerConfig {
  const accessToken = process.env['YNAB_ACCESS_TOKEN'];
  const defaultBudgetId = process.env['YNAB_DEFAULT_BUDGET_ID'];

  if (accessToken === undefined) {
    throw new ConfigurationError('YNAB_ACCESS_TOKEN environment variable is required but not set');
  }

  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
    throw new ConfigurationError('YNAB_ACCESS_TOKEN must be a non-empty string');
  }

  const trimmedDefaultBudgetId = defaultBudgetId?.trim();

  const config: ServerConfig = {
    accessToken: accessToken.trim(),
  };

  if (trimmedDefaultBudgetId && trimmedDefaultBudgetId.length > 0) {
    config.defaultBudgetId = trimmedDefaultBudgetId;
  }

  return config;
}

export type { ServerConfig } from '../types/index.js';