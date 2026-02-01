/**
 * In-Memory Rate Limiter
 *
 * Implements token bucket algorithm for rate limiting.
 * Can be upgraded to Redis-based limiter for production.
 */

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  maxTokens: number;      // Maximum tokens in bucket
  refillRate: number;     // Tokens added per second
  windowMs?: number;      // Time window for cleanup (default: 60000ms)
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterMs?: number;
}

/**
 * Token bucket rate limiter
 */
export class RateLimiter {
  private buckets: Map<string, RateLimitEntry> = new Map();
  private config: Required<RateLimitConfig>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxTokens: config.maxTokens,
      refillRate: config.refillRate,
      windowMs: config.windowMs ?? 60000,
    };

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), this.config.windowMs);
  }

  /**
   * Check if request is allowed and consume a token
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    let entry = this.buckets.get(key);

    if (!entry) {
      // New entry, start with full bucket
      entry = {
        tokens: this.config.maxTokens,
        lastRefill: now,
      };
      this.buckets.set(key, entry);
    }

    // Refill tokens based on time elapsed
    const elapsed = (now - entry.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * this.config.refillRate;
    entry.tokens = Math.min(this.config.maxTokens, entry.tokens + tokensToAdd);
    entry.lastRefill = now;

    // Check if we have tokens available
    if (entry.tokens >= 1) {
      entry.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(entry.tokens),
        resetMs: Math.ceil((this.config.maxTokens - entry.tokens) / this.config.refillRate * 1000),
      };
    }

    // Rate limited
    const retryAfterMs = Math.ceil((1 - entry.tokens) / this.config.refillRate * 1000);
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.ceil(this.config.maxTokens / this.config.refillRate * 1000),
      retryAfterMs,
    };
  }

  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = this.config.windowMs * 2;

    // Use Array.from for compatibility
    Array.from(this.buckets.entries()).forEach(([key, entry]) => {
      if (now - entry.lastRefill > maxAge) {
        this.buckets.delete(key);
      }
    });
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Pre-configured rate limiters for different endpoints
export const rateLimiters = {
  // Slack commands: 30 requests per minute per user
  slackCommands: new RateLimiter({
    maxTokens: 30,
    refillRate: 0.5, // 30 tokens per minute
  }),

  // API endpoints: 100 requests per minute per IP
  api: new RateLimiter({
    maxTokens: 100,
    refillRate: 1.67, // 100 tokens per minute
  }),

  // Admin endpoints: 60 requests per minute
  admin: new RateLimiter({
    maxTokens: 60,
    refillRate: 1, // 60 tokens per minute
  }),

  // Webhooks: 200 requests per minute
  webhooks: new RateLimiter({
    maxTokens: 200,
    refillRate: 3.33, // 200 tokens per minute
  }),
};

/**
 * Get client identifier from request
 */
export const getClientId = (request: Request): string => {
  // Try to get user ID from various headers
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnecting = request.headers.get('cf-connecting-ip');

  return cfConnecting ?? realIp ?? forwarded?.split(',')[0] ?? 'unknown';
};

/**
 * Create rate limit response headers
 */
export const createRateLimitHeaders = (result: RateLimitResult): Headers => {
  const headers = new Headers();
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000 + result.resetMs / 1000)));

  if (result.retryAfterMs) {
    headers.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
  }

  return headers;
};
