/**
 * Request logging that sanitizes sensitive data and tracks O(1) usage counters.
 */

import { getRuntimeConfig } from "./config.js";

export interface LoggerConfig {
	enabled: boolean;
	logLevel: "error" | "warn" | "info" | "debug";
}

const LOG_LEVEL_ALIASES: Record<string, LoggerConfig["logLevel"]> = {
	trace: "debug",
	debug: "debug",
	info: "info",
	warn: "warn",
	error: "error",
	fatal: "error",
};

/** Map a configured LOG_LEVEL (including trace and fatal) to a logger level */
export function resolveLogLevel(
	raw: string | undefined,
): LoggerConfig["logLevel"] {
	return LOG_LEVEL_ALIASES[raw ?? "info"] ?? "info";
}

function defaultLogLevel(): LoggerConfig["logLevel"] {
	return resolveLogLevel(getRuntimeConfig().LOG_LEVEL as string | undefined);
}

export class RequestLogger {
	private config: LoggerConfig;
	private totalRequests = 0;
	private successfulRequests = 0;
	private failedRequests = 0;
	private totalDuration = 0;
	private durationCount = 0;
	private toolUsage: Record<string, number> = {};

	constructor(config: Partial<LoggerConfig> = {}) {
		this.config = {
			enabled: true,
			logLevel: config.logLevel ?? defaultLogLevel(),
			...config,
		};
	}

	/**
	 * Update logger configuration
	 */
	setConfig(config: Partial<LoggerConfig>): void {
		this.config = {
			...this.config,
			...config,
		};
	}

	/**
	 * Write a debug line to stderr when the log level is debug. Debug lines are
	 * not counted as request stats, so they do not depend on `enabled`.
	 */
	debug(message: string): void {
		if (this.shouldLog("debug")) {
			console.error(`[DEBUG] ${message}`);
		}
	}

	/**
	 * Log a tool request and update counters
	 */
	logRequest(
		toolName: string,
		operation: string,
		success: boolean,
		duration?: number,
		error?: string,
	): void {
		if (!this.config.enabled) return;

		this.totalRequests++;
		if (success) {
			this.successfulRequests++;
		} else {
			this.failedRequests++;
		}
		if (duration !== undefined) {
			this.totalDuration += duration;
			this.durationCount++;
		}
		this.toolUsage[toolName] = (this.toolUsage[toolName] ?? 0) + 1;

		const sanitizedError = error ? this.sanitizeError(error) : undefined;
		this.outputLog(toolName, operation, success, duration, sanitizedError);
	}

	logSuccess(toolName: string, operation: string, duration?: number): void {
		this.logRequest(toolName, operation, true, duration);
	}

	logError(
		toolName: string,
		operation: string,
		error: string,
		duration?: number,
	): void {
		this.logRequest(toolName, operation, false, duration, error);
	}

	/**
	 * Reset request counters
	 */
	clearLogs(): void {
		this.totalRequests = 0;
		this.successfulRequests = 0;
		this.failedRequests = 0;
		this.totalDuration = 0;
		this.durationCount = 0;
		this.toolUsage = {};
	}

	/**
	 * Get logging statistics
	 */
	getStats(): {
		totalRequests: number;
		successfulRequests: number;
		failedRequests: number;
		averageDuration: number;
		toolUsage: Record<string, number>;
	} {
		return {
			totalRequests: this.totalRequests,
			successfulRequests: this.successfulRequests,
			failedRequests: this.failedRequests,
			averageDuration:
				this.durationCount > 0 ? this.totalDuration / this.durationCount : 0,
			toolUsage: { ...this.toolUsage },
		};
	}

	private sanitizeError(value: string): string {
		return value
			.replace(/[a-zA-Z0-9]{30,}/g, "***")
			.replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, "Bearer ***")
			.replace(/token[s]?[:\s=]+[a-zA-Z0-9_-]+/gi, "token=***")
			.replace(/key[s]?[:\s=]+[a-zA-Z0-9_-]+/gi, "key=***");
	}

	private outputLog(
		toolName: string,
		operation: string,
		success: boolean,
		duration?: number,
		error?: string,
	): void {
		const parts = [`${toolName}:${operation}`, success ? "SUCCESS" : "FAILED"];
		if (duration !== undefined) {
			parts.push(`${duration}ms`);
		}
		if (error) {
			parts.push(`error:"${error}"`);
		}
		const logMessage = parts.join(" | ");

		if (success) {
			if (this.shouldLog("info")) {
				console.error(`[INFO] ${logMessage}`);
			}
		} else if (this.shouldLog("error")) {
			console.error(`[ERROR] ${logMessage}`);
		}
	}

	private shouldLog(level: LoggerConfig["logLevel"]): boolean {
		const levels = ["error", "warn", "info", "debug"];
		const currentLevelIndex = levels.indexOf(this.config.logLevel);
		const requestedLevelIndex = levels.indexOf(level);
		return requestedLevelIndex <= currentLevelIndex;
	}
}

export const globalRequestLogger = new RequestLogger();
