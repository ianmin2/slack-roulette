/**
 * Tests for Retry Utility
 */

import { withRetry, retryConfigs, RetryConfig } from '../retry';

// Mock timers for testing delays
jest.useFakeTimers();

describe('withRetry', () => {
  beforeEach(() => {
    jest.clearAllTimers();
  });

  describe('successful execution', () => {
    it('returns success on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      const resultPromise = withRetry(fn);
      jest.runAllTimers();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('result');
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns success after retry', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue('result');

      const resultPromise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, jitter: false });

      // Run timers to complete retries
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('result');
      expect(result.attempts).toBe(2);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('returns success after multiple retries', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('result');

      const resultPromise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, jitter: false });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('result');
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('failed execution', () => {
    it('returns failure after max retries exceeded', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('network error'));

      const resultPromise = withRetry(fn, { maxRetries: 2, baseDelayMs: 100, jitter: false });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('network error');
      expect(result.attempts).toBe(3); // Initial + 2 retries
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry non-retryable errors', async () => {
      // Use real timers for this test since no delays are expected
      jest.useRealTimers();

      const fn = jest.fn().mockRejectedValue(new Error('validation failed'));

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 100, jitter: false });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1); // No retries
      expect(fn).toHaveBeenCalledTimes(1);

      // Restore fake timers for other tests
      jest.useFakeTimers();
    });
  });

  describe('retryable error detection', () => {
    const retryableErrors = [
      'network error',
      'timeout occurred',
      'ECONNRESET',
      'ECONNREFUSED',
      'socket hang up',
      'rate limit exceeded',
      'HTTP 429',
      'HTTP 500',
      'HTTP 502',
      'HTTP 503',
      'HTTP 504',
    ];

    retryableErrors.forEach((errorMsg) => {
      it(`retries on "${errorMsg}"`, async () => {
        const fn = jest.fn()
          .mockRejectedValueOnce(new Error(errorMsg))
          .mockResolvedValue('result');

        const resultPromise = withRetry(fn, { maxRetries: 1, baseDelayMs: 100, jitter: false });
        await jest.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.success).toBe(true);
        expect(fn).toHaveBeenCalledTimes(2);
      });
    });

    it('does not retry on non-retryable errors', async () => {
      // Use real timers for this test since no delays are expected
      jest.useRealTimers();

      const fn = jest.fn().mockRejectedValue(new Error('invalid input'));

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });

      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);

      // Restore fake timers
      jest.useFakeTimers();
    });
  });

  describe('custom retry condition', () => {
    it('uses custom retryOn function', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('custom error'))
        .mockResolvedValue('result');

      const customConfig: Partial<RetryConfig> = {
        maxRetries: 2,
        baseDelayMs: 100,
        jitter: false,
        retryOn: (error) => error.message.includes('custom'),
      };

      const resultPromise = withRetry(fn, customConfig);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry when custom function returns false', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('do not retry'));

      const customConfig: Partial<RetryConfig> = {
        maxRetries: 3,
        baseDelayMs: 100,
        retryOn: () => false,
      };

      const resultPromise = withRetry(fn, customConfig);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('metrics', () => {
    it('tracks total time taken', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      const resultPromise = withRetry(fn);
      jest.runAllTimers();
      const result = await resultPromise;

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('counts attempts correctly', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('result');

      const resultPromise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, jitter: false });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.attempts).toBe(3);
    });
  });

  describe('non-Error thrown values', () => {
    it('handles non-Error thrown values', async () => {
      const fn = jest.fn().mockRejectedValue('string error');

      const resultPromise = withRetry(fn, { maxRetries: 1, baseDelayMs: 100 });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('string error');
    });
  });
});

describe('retryConfigs', () => {
  describe('github config', () => {
    it('has appropriate settings for GitHub API', () => {
      expect(retryConfigs.github.maxRetries).toBe(5);
      expect(retryConfigs.github.baseDelayMs).toBe(2000);
      expect(retryConfigs.github.maxDelayMs).toBe(60000);
      expect(retryConfigs.github.jitter).toBe(true);
    });

    it('retries on rate limits', () => {
      const shouldRetry = retryConfigs.github.retryOn!(new Error('rate limit exceeded'));
      expect(shouldRetry).toBe(true);
    });

    it('retries on 403', () => {
      const shouldRetry = retryConfigs.github.retryOn!(new Error('HTTP 403 Forbidden'));
      expect(shouldRetry).toBe(true);
    });
  });

  describe('slack config', () => {
    it('has appropriate settings for Slack API', () => {
      expect(retryConfigs.slack.maxRetries).toBe(3);
      expect(retryConfigs.slack.baseDelayMs).toBe(500);
      expect(retryConfigs.slack.maxDelayMs).toBe(10000);
    });

    it('retries on rate_limited', () => {
      const shouldRetry = retryConfigs.slack.retryOn!(new Error('rate_limited'));
      expect(shouldRetry).toBe(true);
    });
  });

  describe('database config', () => {
    it('has appropriate settings for database', () => {
      expect(retryConfigs.database.maxRetries).toBe(2);
      expect(retryConfigs.database.baseDelayMs).toBe(100);
      expect(retryConfigs.database.maxDelayMs).toBe(2000);
      expect(retryConfigs.database.jitter).toBe(false);
    });
  });
});
