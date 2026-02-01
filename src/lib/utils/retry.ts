/**
 * Retry Utility with Exponential Backoff
 *
 * Provides resilient retry logic for external API calls.
 */

export interface RetryConfig {
  maxRetries: number;         // Maximum number of retry attempts
  baseDelayMs: number;        // Base delay between retries
  maxDelayMs: number;         // Maximum delay cap
  jitter: boolean;            // Add randomness to delay
  retryOn?: (error: Error) => boolean;  // Custom retry condition
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
};

/**
 * Calculate delay with exponential backoff and optional jitter
 */
const calculateDelay = (attempt: number, config: RetryConfig): number => {
  // Exponential backoff: baseDelay * 2^attempt
  let delay = config.baseDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  delay = Math.min(delay, config.maxDelayMs);

  // Add jitter (0-50% of delay)
  if (config.jitter) {
    const jitterAmount = delay * 0.5 * Math.random();
    delay += jitterAmount;
  }

  return Math.floor(delay);
};

/**
 * Check if error is retryable
 */
const isRetryable = (error: Error, config: RetryConfig): boolean => {
  // Use custom retry condition if provided
  if (config.retryOn) {
    return config.retryOn(error);
  }

  // Default: retry on network errors and 5xx responses
  const message = error.message.toLowerCase();

  // Network errors
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('socket hang up')
  ) {
    return true;
  }

  // Rate limit errors (should retry after delay)
  if (message.includes('rate limit') || message.includes('429')) {
    return true;
  }

  // Server errors (5xx)
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return true;
  }

  return false;
};

/**
 * Sleep for specified milliseconds
 */
const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Execute function with retry logic
 *
 * @param fn - Async function to execute
 * @param config - Retry configuration
 * @returns Result with success status, data, and metrics
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> => {
  const fullConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | undefined;
  let attemptCount = 0;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    attemptCount = attempt + 1;
    try {
      const data = await fn();
      return {
        success: true,
        data,
        attempts: attemptCount,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt < fullConfig.maxRetries && isRetryable(lastError, fullConfig)) {
        const delay = calculateDelay(attempt, fullConfig);
        await sleep(delay);
        continue;
      }

      // No more retries
      break;
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: attemptCount,
    totalTimeMs: Date.now() - startTime,
  };
};

/**
 * Retry decorator for class methods
 */
export const retryable = (config: Partial<RetryConfig> = {}) => {
  return function (
    _target: object,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const result = await withRetry(() => originalMethod.apply(this, args), config);

      if (!result.success) {
        throw result.error;
      }

      return result.data;
    };

    return descriptor;
  };
};

/**
 * Specialized retry configs for different services
 */
export const retryConfigs = {
  // GitHub API - be more patient with rate limits
  github: {
    maxRetries: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    jitter: true,
    retryOn: (error: Error) => {
      const message = error.message.toLowerCase();
      // Retry on rate limits, server errors, and network issues
      return (
        message.includes('rate limit') ||
        message.includes('403') ||
        message.includes('5') ||
        message.includes('network') ||
        message.includes('timeout')
      );
    },
  } as RetryConfig,

  // Slack API - faster retries
  slack: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    jitter: true,
    retryOn: (error: Error) => {
      const message = error.message.toLowerCase();
      return (
        message.includes('rate_limited') ||
        message.includes('timeout') ||
        message.includes('network')
      );
    },
  } as RetryConfig,

  // Database operations - quick retries
  database: {
    maxRetries: 2,
    baseDelayMs: 100,
    maxDelayMs: 2000,
    jitter: false,
  } as RetryConfig,
};
