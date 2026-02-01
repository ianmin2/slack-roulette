/**
 * Tests for Rate Limiter Utility
 */

import { RateLimiter, getClientId, createRateLimitHeaders } from '../rate-limiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      maxTokens: 10,
      refillRate: 1, // 1 token per second
      windowMs: 1000,
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('check', () => {
    it('allows requests when tokens are available', () => {
      const result = limiter.check('user1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('consumes tokens on each request', () => {
      limiter.check('user1');
      limiter.check('user1');
      const result = limiter.check('user1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
    });

    it('denies requests when tokens exhausted', () => {
      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        limiter.check('user1');
      }

      const result = limiter.check('user1');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeDefined();
    });

    it('tracks different keys independently', () => {
      // Exhaust tokens for user1
      for (let i = 0; i < 10; i++) {
        limiter.check('user1');
      }

      // user2 should still have tokens
      const result = limiter.check('user2');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('refills tokens over time', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        limiter.check('user1');
      }

      // Wait for refill (2 seconds = 2 tokens)
      await new Promise(resolve => setTimeout(resolve, 2100));

      const result = limiter.check('user1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    }, 5000);

    it('caps tokens at maxTokens', async () => {
      const result1 = limiter.check('user1');
      expect(result1.remaining).toBe(9);

      // Wait for potential refill
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should not exceed maxTokens (10)
      const result2 = limiter.check('user1');
      expect(result2.remaining).toBeLessThanOrEqual(9);
    }, 3000);

    it('returns resetMs indicating time to full bucket', () => {
      const result = limiter.check('user1');

      expect(result.resetMs).toBeGreaterThan(0);
    });

    it('returns retryAfterMs when rate limited', () => {
      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        limiter.check('user1');
      }

      const result = limiter.check('user1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(1000); // 1 second for 1 token
    });
  });

  describe('destroy', () => {
    it('clears cleanup interval', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      limiter.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('can be called multiple times safely', () => {
      expect(() => {
        limiter.destroy();
        limiter.destroy();
      }).not.toThrow();
    });
  });
});

describe('getClientId', () => {
  const createMockRequest = (headers: Record<string, string | null>): Request => {
    return {
      headers: {
        get: (name: string) => headers[name.toLowerCase()] ?? null,
      },
    } as unknown as Request;
  };

  it('returns cf-connecting-ip if present', () => {
    const request = createMockRequest({
      'cf-connecting-ip': '1.2.3.4',
      'x-real-ip': '5.6.7.8',
      'x-forwarded-for': '9.10.11.12',
    });

    expect(getClientId(request)).toBe('1.2.3.4');
  });

  it('returns x-real-ip if cf-connecting-ip not present', () => {
    const request = createMockRequest({
      'x-real-ip': '5.6.7.8',
      'x-forwarded-for': '9.10.11.12',
    });

    expect(getClientId(request)).toBe('5.6.7.8');
  });

  it('returns first x-forwarded-for IP if others not present', () => {
    const request = createMockRequest({
      'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12',
    });

    expect(getClientId(request)).toBe('1.2.3.4');
  });

  it('returns unknown if no headers present', () => {
    const request = createMockRequest({});

    expect(getClientId(request)).toBe('unknown');
  });
});

describe('createRateLimitHeaders', () => {
  it('sets X-RateLimit-Remaining header', () => {
    const headers = createRateLimitHeaders({
      allowed: true,
      remaining: 5,
      resetMs: 10000,
    });

    expect(headers.get('X-RateLimit-Remaining')).toBe('5');
  });

  it('sets X-RateLimit-Reset header', () => {
    const now = Date.now();
    const headers = createRateLimitHeaders({
      allowed: true,
      remaining: 5,
      resetMs: 10000,
    });

    const resetTime = parseInt(headers.get('X-RateLimit-Reset') || '0', 10);
    const expectedResetTime = Math.ceil(now / 1000 + 10);

    // Allow 1 second tolerance
    expect(resetTime).toBeGreaterThanOrEqual(expectedResetTime - 1);
    expect(resetTime).toBeLessThanOrEqual(expectedResetTime + 1);
  });

  it('sets Retry-After header when rate limited', () => {
    const headers = createRateLimitHeaders({
      allowed: false,
      remaining: 0,
      resetMs: 10000,
      retryAfterMs: 5000,
    });

    expect(headers.get('Retry-After')).toBe('5');
  });

  it('does not set Retry-After when not rate limited', () => {
    const headers = createRateLimitHeaders({
      allowed: true,
      remaining: 5,
      resetMs: 10000,
    });

    expect(headers.get('Retry-After')).toBeNull();
  });
});
