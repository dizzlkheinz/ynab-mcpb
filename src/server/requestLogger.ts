/**
 * Request logging functionality that sanitizes sensitive data
 */

export interface LogEntry {
  timestamp: Date;
  toolName: string;
  operation: string;
  parameters: Record<string, unknown>;
  success: boolean;
  duration?: number;
  error?: string;
  rateLimitInfo?: {
    remaining: number;
    isLimited: boolean;
  };
}

export interface LoggerConfig {
  enabled: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  maxLogEntries: number;
  sanitizeParameters: boolean;
}

/**
 * Request logger that sanitizes sensitive information
 */
export class RequestLogger {
  private logs: LogEntry[] = [];
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      enabled: process.env['NODE_ENV'] !== 'production',
      logLevel: (process.env['LOG_LEVEL'] as LoggerConfig['logLevel']) || 'info',
      maxLogEntries: 1000,
      sanitizeParameters: true,
      ...config,
    };
  }

  /**
   * Log a tool request with sanitized parameters
   */
  logRequest(
    toolName: string,
    operation: string,
    parameters: Record<string, unknown>,
    success: boolean,
    duration?: number,
    error?: string,
    rateLimitInfo?: { remaining: number; isLimited: boolean },
  ): void {
    if (!this.config.enabled) return;

    const logEntry: LogEntry = {
      timestamp: new Date(),
      toolName,
      operation,
      parameters: this.config.sanitizeParameters ? this.sanitizeParameters(parameters) : parameters,
      success,
      ...(duration !== undefined && { duration }),
      ...(error && { error: this.sanitizeError(error) }),
      ...(rateLimitInfo && { rateLimitInfo }),
    };

    this.logs.push(logEntry);

    // Maintain log size limit
    if (this.logs.length > this.config.maxLogEntries) {
      this.logs.shift();
    }

    // Output to console based on log level
    this.outputLog(logEntry);
  }

  /**
   * Log a successful request
   */
  logSuccess(
    toolName: string,
    operation: string,
    parameters: Record<string, unknown>,
    duration?: number,
    rateLimitInfo?: { remaining: number; isLimited: boolean },
  ): void {
    this.logRequest(toolName, operation, parameters, true, duration, undefined, rateLimitInfo);
  }

  /**
   * Log a failed request
   */
  logError(
    toolName: string,
    operation: string,
    parameters: Record<string, unknown>,
    error: string,
    duration?: number,
    rateLimitInfo?: { remaining: number; isLimited: boolean },
  ): void {
    this.logRequest(toolName, operation, parameters, false, duration, error, rateLimitInfo);
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Get logs filtered by criteria
   */
  getFilteredLogs(filter: {
    toolName?: string;
    success?: boolean;
    since?: Date;
    limit?: number;
  }): LogEntry[] {
    let filtered = this.logs;

    if (filter.toolName) {
      filtered = filtered.filter((log) => log.toolName === filter.toolName);
    }

    if (filter.success !== undefined) {
      filtered = filtered.filter((log) => log.success === filter.success);
    }

    if (filter.since) {
      filtered = filtered.filter((log) => log.timestamp >= filter.since!);
    }

    if (filter.limit) {
      filtered = filtered.slice(-filter.limit);
    }

    return filtered;
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Get logging statistics
   */
  getStats(): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageDuration: number;
    rateLimitedRequests: number;
    toolUsage: Record<string, number>;
  } {
    const totalRequests = this.logs.length;
    const successfulRequests = this.logs.filter((log) => log.success).length;
    const failedRequests = totalRequests - successfulRequests;

    const durationsWithValues = this.logs
      .filter((log) => log.duration !== undefined)
      .map((log) => log.duration!);

    const averageDuration =
      durationsWithValues.length > 0
        ? durationsWithValues.reduce((sum, duration) => sum + duration, 0) /
          durationsWithValues.length
        : 0;

    const rateLimitedRequests = this.logs.filter((log) => log.rateLimitInfo?.isLimited).length;

    const toolUsage: Record<string, number> = {};
    this.logs.forEach((log) => {
      toolUsage[log.toolName] = (toolUsage[log.toolName] || 0) + 1;
    });

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      averageDuration,
      rateLimitedRequests,
      toolUsage,
    };
  }

  /**
   * Sanitize parameters to remove sensitive information
   */
  private sanitizeParameters(parameters: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(parameters)) {
      // Sanitize sensitive parameter names
      if (this.isSensitiveParameter(key)) {
        sanitized[key] = '***';
      } else if (typeof value === 'string') {
        sanitized[key] = this.sanitizeString(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Check if a parameter name is sensitive
   */
  private isSensitiveParameter(key: string): boolean {
    const sensitiveKeys = [
      'token',
      'access_token',
      'api_key',
      'password',
      'secret',
      'authorization',
      'auth',
      'key',
      'credential',
    ];

    return sensitiveKeys.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey));
  }

  /**
   * Sanitize string values
   */
  private sanitizeString(value: string): string {
    // Remove potential tokens or sensitive data patterns
    return value
      .replace(/[a-zA-Z0-9]{30,}/g, '***') // Long alphanumeric strings (potential tokens)
      .replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer ***')
      .replace(/token[s]?[:\s=]+[a-zA-Z0-9_-]+/gi, 'token=***')
      .replace(/key[s]?[:\s=]+[a-zA-Z0-9_-]+/gi, 'key=***');
  }

  /**
   * Sanitize object values recursively
   */
  private sanitizeObject(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) =>
        typeof item === 'object' && item !== null ? this.sanitizeObject(item) : item,
      );
    }

    if (typeof obj === 'object' && obj !== null) {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.isSensitiveParameter(key)) {
          sanitized[key] = '***';
        } else if (typeof value === 'string') {
          sanitized[key] = this.sanitizeString(value);
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    }

    return obj;
  }

  /**
   * Sanitize error messages
   */
  private sanitizeError(error: string): string {
    return this.sanitizeString(error);
  }

  /**
   * Output log entry to console based on configuration
   */
  private outputLog(logEntry: LogEntry): void {
    const logMessage = this.formatLogMessage(logEntry);

    if (logEntry.success) {
      if (this.shouldLog('info')) {
        console.error(`[INFO] ${logMessage}`);
      }
    } else {
      if (this.shouldLog('error')) {
        console.error(`[ERROR] ${logMessage}`);
      }
    }

    // Always log rate limit warnings
    if (logEntry.rateLimitInfo?.isLimited && this.shouldLog('warn')) {
      console.error(`[WARN] Rate limit exceeded for ${logEntry.toolName}`);
    }
  }

  /**
   * Check if we should log at the given level
   */
  private shouldLog(level: LoggerConfig['logLevel']): boolean {
    const levels = ['error', 'warn', 'info', 'debug'];
    const currentLevelIndex = levels.indexOf(this.config.logLevel);
    const requestedLevelIndex = levels.indexOf(level);

    return requestedLevelIndex <= currentLevelIndex;
  }

  /**
   * Format log message for output
   */
  private formatLogMessage(logEntry: LogEntry): string {
    const parts = [
      `${logEntry.toolName}:${logEntry.operation}`,
      logEntry.success ? 'SUCCESS' : 'FAILED',
    ];

    if (logEntry.duration !== undefined) {
      parts.push(`${logEntry.duration}ms`);
    }

    if (logEntry.rateLimitInfo) {
      parts.push(`rate_limit_remaining:${logEntry.rateLimitInfo.remaining}`);
    }

    if (logEntry.error) {
      parts.push(`error:"${logEntry.error}"`);
    }

    return parts.join(' | ');
  }
}

/**
 * Global request logger instance
 */
export const globalRequestLogger = new RequestLogger();

export default globalRequestLogger;
