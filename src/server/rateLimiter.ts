/**
 * Rate limiting implementation for YNAB API compliance
 * YNAB API has a rate limit of 200 requests per hour per access token
 */

export interface RateLimitConfig {
	maxRequests: number;
	windowMs: number;
	enableLogging?: boolean;
}

export interface RateLimitInfo {
	remaining: number;
	resetTime: Date;
	isLimited: boolean;
}

/**
 * Simple in-memory rate limiter for YNAB API compliance
 */
export class RateLimiter {
	private requests: Map<string, number[]> = new Map();
	private config: RateLimitConfig;

	constructor(config: Partial<RateLimitConfig> = {}) {
		this.config = {
			maxRequests: 200, // YNAB API limit
			windowMs: 60 * 60 * 1000, // 1 hour
			enableLogging: false,
			...config,
		};
	}

	/**
	 * Check if a request is allowed for the given identifier. Callers pass an
	 * already-hashed identifier (see hashToken); it is logged as given.
	 */
	isAllowed(identifier: string): RateLimitInfo {
		const info = this.computeStatus(identifier);

		if (this.config.enableLogging) {
			const used = this.requests.get(identifier)?.length ?? 0;
			console.error(
				`Rate limit check for ${identifier}: ${used}/${this.config.maxRequests} requests, remaining: ${info.remaining}, limited: ${info.isLimited}`,
			);
		}

		return info;
	}

	/**
	 * Prune expired requests and compute the identifier's status without logging
	 */
	private computeStatus(identifier: string): RateLimitInfo {
		const now = Date.now();
		const windowStart = now - this.config.windowMs;

		// Get existing requests for this identifier
		let requests = this.requests.get(identifier) || [];

		// Remove requests outside the current window
		requests = requests.filter((timestamp) => timestamp > windowStart);

		// Update the requests array
		this.requests.set(identifier, requests);

		const remaining = Math.max(0, this.config.maxRequests - requests.length);
		const resetTime = new Date((requests[0] ?? now) + this.config.windowMs);
		const isLimited = requests.length >= this.config.maxRequests;

		return {
			remaining,
			resetTime,
			isLimited,
		};
	}

	/**
	 * Record a request for the given identifier
	 */
	recordRequest(identifier: string): void {
		const now = Date.now();
		const requests = this.requests.get(identifier) || [];

		requests.push(now);
		this.requests.set(identifier, requests);

		if (this.config.enableLogging) {
			console.error(
				`Recorded request for ${identifier}:${requests.length}/${this.config.maxRequests} requests`,
			);
		}
	}

	/**
	 * Get current rate limit status for an identifier without logging a check
	 */
	getStatus(identifier: string): RateLimitInfo {
		return this.computeStatus(identifier);
	}

	/**
	 * Atomically check and record a request in one call.
	 * Returns rate limit info; if not limited, the request is recorded.
	 */
	tryAcquire(identifier: string): RateLimitInfo {
		const info = this.isAllowed(identifier);
		if (!info.isLimited) {
			this.recordRequest(identifier);
		}
		return info;
	}

	/**
	 * Mark the identifier's rate limit window as exhausted.
	 * Used when a real YNAB 429 response is received.
	 */
	markExhausted(identifier: string): void {
		const now = Date.now();
		// Fill the current window with maxRequests fresh timestamps to force
		// isLimited = true even if the next check happens a few ms later.
		const timestamps = Array.from(
			{ length: this.config.maxRequests },
			() => now,
		);
		this.requests.set(identifier, timestamps);
		if (this.config.enableLogging) {
			console.error(`Rate limit marked exhausted for ${identifier}`);
		}
	}

	/**
	 * Reset rate limit for a specific identifier (useful for testing)
	 */
	reset(identifier?: string): void {
		if (identifier) {
			this.requests.delete(identifier);
		} else {
			this.requests.clear();
		}
	}

	/**
	 * Clean up old requests (should be called periodically)
	 */
	cleanup(): void {
		const now = Date.now();
		const windowStart = now - this.config.windowMs;

		for (const [identifier, requests] of this.requests.entries()) {
			const validRequests = requests.filter(
				(timestamp) => timestamp > windowStart,
			);

			if (validRequests.length === 0) {
				this.requests.delete(identifier);
			} else {
				this.requests.set(identifier, validRequests);
			}
		}
	}
}

/**
 * Hash an access token for rate limiting and logging (to avoid exposing sensitive tokens)
 */
export function hashToken(token: string): string {
	// Simple hash for logging purposes - not cryptographically secure
	let hash = 0;
	for (let i = 0; i < token.length; i++) {
		const char = token.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return `token_${Math.abs(hash).toString(16)}`;
}

/**
 * Rate limiting error class
 */
export class RateLimitError extends Error {
	readonly status = 429;
	constructor(
		message: string,

		public readonly resetTime: Date,

		public readonly remaining: number = 0,
	) {
		super(message);
		this.name = "RateLimitError";
	}
}
