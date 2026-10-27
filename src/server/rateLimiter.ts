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
	 * Check if a request is allowed for the given access token. The token is
	 * hashed here (see hashToken); only the hash is stored or logged.
	 */
	isAllowed(token: string): RateLimitInfo {
		return this.check(hashToken(token));
	}

	/**
	 * Record a request for the given access token
	 */
	recordRequest(token: string): void {
		this.record(hashToken(token));
	}

	/**
	 * Get current rate limit status for an access token without logging a check
	 */
	getStatus(token: string): RateLimitInfo {
		return this.computeStatus(hashToken(token));
	}

	/**
	 * Bind the limiter to one access token for the request path. The token is
	 * hashed once here and the handle keeps only the hash.
	 */
	forToken(token: string): {
		tryAcquire(): RateLimitInfo;
		markExhausted(): void;
	} {
		const key = hashToken(token);
		return {
			tryAcquire: () => this.acquire(key),
			markExhausted: () => this.exhaust(key),
		};
	}

	/**
	 * Atomically check and record a request for an already-hashed key.
	 * Returns rate limit info; if not limited, the request is recorded.
	 */
	private acquire(key: string): RateLimitInfo {
		const info = this.check(key);
		if (!info.isLimited) {
			this.record(key);
		}
		return info;
	}

	/**
	 * Mark an already-hashed key's rate limit window as exhausted.
	 * Used when a real YNAB 429 response is received.
	 */
	private exhaust(key: string): void {
		const now = Date.now();
		// Fill the current window with maxRequests fresh timestamps to force
		// isLimited = true even if the next check happens a few ms later.
		const timestamps = Array.from(
			{ length: this.config.maxRequests },
			() => now,
		);
		this.requests.set(key, timestamps);
		if (this.config.enableLogging) {
			console.error(`Rate limit marked exhausted for ${key}`);
		}
	}

	/**
	 * Reset rate limit for a specific access token (useful for testing)
	 */
	reset(token?: string): void {
		if (token) {
			this.requests.delete(hashToken(token));
		} else {
			this.requests.clear();
		}
	}

	/**
	 * Check and log the status of an already-hashed key
	 */
	private check(key: string): RateLimitInfo {
		const info = this.computeStatus(key);

		if (this.config.enableLogging) {
			const used = this.requests.get(key)?.length ?? 0;
			console.error(
				`Rate limit check for ${key}: ${used}/${this.config.maxRequests} requests, remaining: ${info.remaining}, limited: ${info.isLimited}`,
			);
		}

		return info;
	}

	/**
	 * Prune expired requests and compute an already-hashed key's status without logging
	 */
	private computeStatus(key: string): RateLimitInfo {
		const now = Date.now();
		const windowStart = now - this.config.windowMs;

		// Get existing requests for this key
		let requests = this.requests.get(key) || [];

		// Remove requests outside the current window
		requests = requests.filter((timestamp) => timestamp > windowStart);

		// Update the requests array
		this.requests.set(key, requests);

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
	 * Record a request for an already-hashed key
	 */
	private record(key: string): void {
		const now = Date.now();
		const requests = this.requests.get(key) || [];

		requests.push(now);
		this.requests.set(key, requests);

		if (this.config.enableLogging) {
			console.error(
				`Recorded request for ${key}: ${requests.length}/${this.config.maxRequests} requests`,
			);
		}
	}

	/**
	 * Clean up old requests (should be called periodically)
	 */
	cleanup(): void {
		const now = Date.now();
		const windowStart = now - this.config.windowMs;

		for (const [key, requests] of this.requests.entries()) {
			const validRequests = requests.filter(
				(timestamp) => timestamp > windowStart,
			);

			if (validRequests.length === 0) {
				this.requests.delete(key);
			} else {
				this.requests.set(key, validRequests);
			}
		}
	}
}

/**
 * Hash an access token for rate limiting and logging (to avoid exposing sensitive tokens)
 */
function hashToken(token: string): string {
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
