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
		this.name = "AuthenticationError";
	}
}

export class ConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationError";
	}
}

// Re-export error handling types for convenience
export {
	ErrorHandler,
	type ErrorResponse,
	handleToolError,
	SecurityErrorCode,
	ValidationError,
	withToolErrorHandling,
	YNABAPIError,
	YNABErrorCode,
} from "../server/errorHandler.js";

// Re-export security modules
export {
	globalRateLimiter,
	type RateLimitConfig,
	RateLimitError,
	RateLimiter,
	type RateLimitInfo,
} from "../server/rateLimiter.js";

export {
	globalRequestLogger,
	type LogEntry,
	type LoggerConfig,
	RequestLogger,
} from "../server/requestLogger.js";

export {
	type SecurityContext,
	SecurityMiddleware,
	withSecurityWrapper,
} from "../server/securityMiddleware.js";
// Re-export tool registry types for convenience
export type { ToolDefinition } from "../server/toolRegistry.js";
// Re-export tool annotation types
export type { MCPToolAnnotations } from "./toolAnnotations.js";

// Re-export tool registration factory types
export type {
	BudgetIdResolverFactory,
	ToolContext,
	ToolFactory,
} from "./toolRegistration.js";
