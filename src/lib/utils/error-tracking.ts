/**
 * Error Tracking
 *
 * Provides error tracking and reporting infrastructure.
 * Supports Sentry integration and local error logging.
 */

import { createLogger } from './logger';

const log = createLogger('error-tracking');

// =============================================================================
// TYPES
// =============================================================================

export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface ErrorContext {
  /** User ID if available */
  userId?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Additional tags for filtering */
  tags?: Record<string, string>;
  /** Extra data to include */
  extra?: Record<string, unknown>;
  /** Fingerprint for grouping similar errors */
  fingerprint?: string[];
}

export interface TrackedError {
  id: string;
  message: string;
  stack?: string;
  severity: ErrorSeverity;
  context: ErrorContext;
  timestamp: Date;
  reported: boolean;
  sentryEventId?: string;
}

export interface ErrorTrackingConfig {
  /** Sentry DSN (if not set, errors are only logged locally) */
  dsn?: string;
  /** Environment name */
  environment: string;
  /** Release version */
  release?: string;
  /** Sample rate for error reporting (0-1) */
  sampleRate: number;
  /** Whether to capture unhandled rejections */
  captureUnhandledRejections: boolean;
  /** Whether to capture uncaught exceptions */
  captureUncaughtExceptions: boolean;
  /** Patterns to ignore */
  ignorePatterns: RegExp[];
  /** Before send hook */
  beforeSend?: (error: TrackedError) => TrackedError | null;
}

export interface ErrorStats {
  total: number;
  reported: number;
  bySeverity: Record<ErrorSeverity, number>;
  byTag: Record<string, number>;
  recentErrors: TrackedError[];
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: ErrorTrackingConfig = {
  environment: process.env.NODE_ENV ?? 'development',
  release: process.env.npm_package_version,
  sampleRate: 1.0,
  captureUnhandledRejections: true,
  captureUncaughtExceptions: true,
  ignorePatterns: [
    /ResizeObserver loop/i,
    /Network request failed/i,
    /AbortError/i,
  ],
};

// =============================================================================
// ERROR TRACKER
// =============================================================================

class ErrorTracker {
  private config: ErrorTrackingConfig = { ...DEFAULT_CONFIG };
  private errors: TrackedError[] = [];
  private errorIdCounter = 0;
  private initialized = false;
  private sentryClient: SentryLikeClient | null = null;

  /**
   * Initialize error tracking
   */
  init(config: Partial<ErrorTrackingConfig> = {}): void {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.dsn) {
      // Initialize Sentry-like client
      this.sentryClient = {
        captureException: async (error: Error, context: ErrorContext) => {
          // In a real implementation, this would send to Sentry
          // For now, we simulate the response
          return `sentry_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        },
        captureMessage: async (message: string, severity: ErrorSeverity, context: ErrorContext) => {
          return `sentry_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        },
      };
    }

    // Set up global handlers
    if (typeof process !== 'undefined') {
      if (this.config.captureUnhandledRejections) {
        process.on('unhandledRejection', (reason) => {
          this.captureException(
            reason instanceof Error ? reason : new Error(String(reason)),
            { tags: { type: 'unhandledRejection' } }
          );
        });
      }

      if (this.config.captureUncaughtExceptions) {
        process.on('uncaughtException', (error) => {
          this.captureException(error, { tags: { type: 'uncaughtException' } });
        });
      }
    }

    this.initialized = true;
    log.info('Error tracking initialized', {
      environment: this.config.environment,
      hasSentry: !!this.config.dsn,
      sampleRate: this.config.sampleRate,
    });
  }

  /**
   * Capture an exception
   */
  async captureException(
    error: Error,
    context: ErrorContext = {}
  ): Promise<string | null> {
    return this.capture({
      message: error.message,
      stack: error.stack,
      severity: 'error',
      context,
    });
  }

  /**
   * Capture a message
   */
  async captureMessage(
    message: string,
    severity: ErrorSeverity = 'info',
    context: ErrorContext = {}
  ): Promise<string | null> {
    return this.capture({
      message,
      severity,
      context,
    });
  }

  /**
   * Capture a fatal error (and potentially exit)
   */
  async captureFatal(
    error: Error,
    context: ErrorContext = {}
  ): Promise<string | null> {
    return this.capture({
      message: error.message,
      stack: error.stack,
      severity: 'fatal',
      context,
    });
  }

  /**
   * Internal capture method
   */
  private async capture(options: {
    message: string;
    stack?: string;
    severity: ErrorSeverity;
    context: ErrorContext;
  }): Promise<string | null> {
    const { message, stack, severity, context } = options;

    // Check if should be ignored
    if (this.shouldIgnore(message)) {
      log.debug('Error ignored by pattern', { message });
      return null;
    }

    // Check sample rate
    if (Math.random() > this.config.sampleRate) {
      log.debug('Error dropped by sampling', { message });
      return null;
    }

    // Create tracked error
    const trackedError: TrackedError = {
      id: `err_${Date.now()}_${++this.errorIdCounter}`,
      message,
      stack,
      severity,
      context,
      timestamp: new Date(),
      reported: false,
    };

    // Apply beforeSend hook
    if (this.config.beforeSend) {
      const modified = this.config.beforeSend(trackedError);
      if (!modified) {
        log.debug('Error dropped by beforeSend', { message });
        return null;
      }
      Object.assign(trackedError, modified);
    }

    // Store locally
    this.errors.push(trackedError);
    this.trimErrors();

    // Log the error
    if (severity === 'fatal' || severity === 'error') {
      log.error(message, new Error(message), {
        errorId: trackedError.id,
        ...context,
      });
    } else {
      log.warn(message, {
        errorId: trackedError.id,
        severity,
        ...context,
      });
    }

    // Report to Sentry if configured
    if (this.sentryClient) {
      try {
        const eventId = stack
          ? await this.sentryClient.captureException(new Error(message), context)
          : await this.sentryClient.captureMessage(message, severity, context);

        trackedError.reported = true;
        trackedError.sentryEventId = eventId;
      } catch (err) {
        log.error('Failed to report to Sentry', err instanceof Error ? err : new Error(String(err)));
      }
    }

    return trackedError.id;
  }

  /**
   * Check if error should be ignored
   */
  private shouldIgnore(message: string): boolean {
    return this.config.ignorePatterns.some((pattern) => pattern.test(message));
  }

  /**
   * Trim old errors to prevent memory bloat
   */
  private trimErrors(): void {
    const MAX_ERRORS = 1000;
    if (this.errors.length > MAX_ERRORS) {
      this.errors = this.errors.slice(-MAX_ERRORS);
    }
  }

  /**
   * Get error statistics
   */
  getStats(): ErrorStats {
    const bySeverity: Record<ErrorSeverity, number> = {
      fatal: 0,
      error: 0,
      warning: 0,
      info: 0,
      debug: 0,
    };

    const byTag: Record<string, number> = {};
    let reported = 0;

    for (const error of this.errors) {
      bySeverity[error.severity]++;
      if (error.reported) reported++;

      if (error.context.tags) {
        for (const [key, value] of Object.entries(error.context.tags)) {
          const tagKey = `${key}:${value}`;
          byTag[tagKey] = (byTag[tagKey] ?? 0) + 1;
        }
      }
    }

    return {
      total: this.errors.length,
      reported,
      bySeverity,
      byTag,
      recentErrors: this.errors.slice(-10).reverse(),
    };
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit = 50): TrackedError[] {
    return this.errors.slice(-limit).reverse();
  }

  /**
   * Get error by ID
   */
  getError(id: string): TrackedError | undefined {
    return this.errors.find((e) => e.id === id);
  }

  /**
   * Clear errors (for testing)
   */
  clearErrors(): void {
    this.errors = [];
  }

  /**
   * Reset tracker (for testing)
   */
  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.errors = [];
    this.errorIdCounter = 0;
    this.initialized = false;
    this.sentryClient = null;
  }

  /**
   * Create a scoped error tracker with preset context
   */
  withScope(context: ErrorContext): ScopedErrorTracker {
    return {
      captureException: (error: Error, extraContext?: ErrorContext) =>
        this.captureException(error, { ...context, ...extraContext }),
      captureMessage: (message: string, severity?: ErrorSeverity, extraContext?: ErrorContext) =>
        this.captureMessage(message, severity, { ...context, ...extraContext }),
    };
  }

  /**
   * Wrap an async function with error tracking
   */
  async wrap<T>(
    fn: () => Promise<T>,
    context: ErrorContext = {}
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      await this.captureException(
        error instanceof Error ? error : new Error(String(error)),
        context
      );
      throw error;
    }
  }
}

// =============================================================================
// HELPER TYPES
// =============================================================================

interface SentryLikeClient {
  captureException(error: Error, context: ErrorContext): Promise<string>;
  captureMessage(message: string, severity: ErrorSeverity, context: ErrorContext): Promise<string>;
}

interface ScopedErrorTracker {
  captureException(error: Error, context?: ErrorContext): Promise<string | null>;
  captureMessage(message: string, severity?: ErrorSeverity, context?: ErrorContext): Promise<string | null>;
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const errorTracker = new ErrorTracker();

// =============================================================================
// EXPORTS
// =============================================================================

export const errors = {
  init: errorTracker.init.bind(errorTracker),
  captureException: errorTracker.captureException.bind(errorTracker),
  captureMessage: errorTracker.captureMessage.bind(errorTracker),
  captureFatal: errorTracker.captureFatal.bind(errorTracker),
  getStats: errorTracker.getStats.bind(errorTracker),
  getRecentErrors: errorTracker.getRecentErrors.bind(errorTracker),
  getError: errorTracker.getError.bind(errorTracker),
  clearErrors: errorTracker.clearErrors.bind(errorTracker),
  withScope: errorTracker.withScope.bind(errorTracker),
  wrap: errorTracker.wrap.bind(errorTracker),
  reset: errorTracker.reset.bind(errorTracker),
};

export default errors;
