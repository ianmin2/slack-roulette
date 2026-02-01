/**
 * Unified Logger
 *
 * Centralized logging utility with structured output.
 * Replaces scattered console.log/error/warn calls.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get minimum log level from environment
 */
const getMinLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel;
  }
  // Default to 'info' in production, 'debug' in development
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

/**
 * Check if a log level should be output
 */
const shouldLog = (level: LogLevel): boolean => {
  return LOG_LEVELS[level] >= LOG_LEVELS[getMinLevel()];
};

/**
 * Format log entry for output
 */
const formatEntry = (entry: LogEntry): string => {
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;

  if (entry.context && Object.keys(entry.context).length > 0) {
    const contextStr = JSON.stringify(entry.context, null, 0);
    return `${prefix} ${entry.message} ${contextStr}`;
  }

  return `${prefix} ${entry.message}`;
};

/**
 * Create a log entry
 */
const createEntry = (level: LogLevel, message: string, context?: LogContext): LogEntry => ({
  level,
  message,
  timestamp: new Date().toISOString(),
  context,
});

/**
 * Output log to console
 */
const output = (entry: LogEntry): void => {
  const formatted = formatEntry(entry);

  switch (entry.level) {
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug(formatted);
      break;
    case 'info':
      // eslint-disable-next-line no-console
      console.log(formatted);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(formatted);
      break;
    case 'error':
      // eslint-disable-next-line no-console
      console.error(formatted);
      break;
  }
};

/**
 * Logger instance
 */
class Logger {
  private prefix: string;

  constructor(prefix = '') {
    this.prefix = prefix;
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!shouldLog(level)) return;

    const fullMessage = this.prefix ? `[${this.prefix}] ${message}` : message;
    output(createEntry(level, fullMessage, context));
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void;
  error(message: string, error: unknown, context?: LogContext): void;
  error(message: string, errorOrContext?: unknown, context?: LogContext): void {
    let finalContext = context;
    if (errorOrContext instanceof Error) {
      finalContext = {
        ...context,
        error: {
          name: errorOrContext.name,
          message: errorOrContext.message,
          stack: errorOrContext.stack,
        },
      };
    } else if (errorOrContext && typeof errorOrContext === 'object' && !('message' in errorOrContext && 'name' in errorOrContext)) {
      // It's a LogContext object, not an Error-like object
      finalContext = errorOrContext as LogContext;
    } else if (errorOrContext !== undefined) {
      // Unknown error type - stringify it
      finalContext = {
        ...context,
        error: String(errorOrContext),
      };
    }
    this.log('error', message, finalContext);
  }

  /**
   * Create a child logger with a prefix
   */
  child(prefix: string): Logger {
    const newPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger(newPrefix);
  }
}

/**
 * Create namespaced loggers for different modules
 */
export const createLogger = (namespace: string): Logger => {
  return new Logger(namespace);
};

/**
 * Pre-configured loggers for common modules
 */
export const logger = new Logger();

export const loggers = {
  slack: createLogger('slack'),
  github: createLogger('github'),
  db: createLogger('db'),
  api: createLogger('api'),
  admin: createLogger('admin'),
  digest: createLogger('digest'),
  assignment: createLogger('assignment'),
  analytics: createLogger('analytics'),
  challenges: createLogger('challenges'),
  goals: createLogger('goals'),
};

/**
 * Utility to log errors with consistent format
 */
export const logError = (namespace: string, operation: string, error: unknown): void => {
  const logger = createLogger(namespace);
  const errorObj = error instanceof Error ? error : new Error(String(error));
  logger.error(`${operation} failed`, errorObj);
};
