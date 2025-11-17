/**
 * Type definitions for YNAB MCP Server
 */

export interface AuthenticationConfig {
  accessToken: string;
  validateToken(): Promise<boolean>;
}

export interface ServerConfig {
  accessToken: string;
  defaultBudgetId?: string;
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// Re-export error handling types for convenience
export {
  ErrorHandler,
  YNABAPIError,
  ValidationError,
  YNABErrorCode,
  SecurityErrorCode,
  type ErrorResponse,
  handleToolError,
  withToolErrorHandling,
} from '../server/errorHandler.js';

// Re-export security modules
export {
  RateLimiter,
  RateLimitError,
  globalRateLimiter,
  type RateLimitConfig,
  type RateLimitInfo,
} from '../server/rateLimiter.js';

export {
  RequestLogger,
  globalRequestLogger,
  type LogEntry,
  type LoggerConfig,
} from '../server/requestLogger.js';

export {
  SecurityMiddleware,
  withSecurityWrapper,
  type SecurityContext,
} from '../server/securityMiddleware.js';

// Re-export tool annotation types
export type { MCPToolAnnotations } from './toolAnnotations.js';
