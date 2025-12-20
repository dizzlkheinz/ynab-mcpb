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
   * Check if a request is allowed for the given identifier (typically access token hash)
   */
  isAllowed(identifier: string): RateLimitInfo {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get existing requests for this identifier
    let requests = this.requests.get(identifier) || [];

    // Remove requests outside the current window
    requests = requests.filter((timestamp) => timestamp > windowStart);

    // Update the requests array
    this.requests.set(identifier, requests);

    const remaining = Math.max(0, this.config.maxRequests - requests.length);
    const resetTime = new Date(now + this.config.windowMs);
    const isLimited = requests.length >= this.config.maxRequests;

    if (this.config.enableLogging) {
      console.error(
        `Rate limit check for ${this.hashIdentifier(identifier)}: ${requests.length}/${this.config.maxRequests} requests, remaining: ${remaining}, limited: ${isLimited}`,
      );
    }

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
        `Recorded request for ${this.hashIdentifier(identifier)}: ${requests.length}/${this.config.maxRequests} requests`,
      );
    }
  }

  /**
   * Get current rate limit status for an identifier
   */
  getStatus(identifier: string): RateLimitInfo {
    return this.isAllowed(identifier);
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
      const validRequests = requests.filter((timestamp) => timestamp > windowStart);

      if (validRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, validRequests);
      }
    }
  }

  /**
   * Hash identifier for logging (to avoid exposing sensitive tokens)
   */
  private hashIdentifier(identifier: string): string {
    // Simple hash for logging purposes - not cryptographically secure
    let hash = 0;
    for (let i = 0; i < identifier.length; i++) {
      const char = identifier.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `token_${Math.abs(hash).toString(16)}`;
  }
}

/**
 * Rate limiting error class
 */
export class RateLimitError extends Error {
  constructor(
    message: string,

    public readonly resetTime: Date,

    public readonly remaining: number = 0,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Global rate limiter instance
 */
export const globalRateLimiter = new RateLimiter({
  enableLogging:
    process.env['RATE_LIMIT_LOGGING'] === 'true' ||
    process.env['LOG_LEVEL'] === 'debug' ||
    process.env['VERBOSE_TESTS'] === 'true',
});
