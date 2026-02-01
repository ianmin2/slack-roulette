/**
 * Tests for Unified Logger
 */

import { createLogger, logger, loggers, logError } from '../logger';

describe('Logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('log levels', () => {
    it('uses LOG_LEVEL from environment', async () => {
      process.env.LOG_LEVEL = 'warn';
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.debug('should not log');
      log.info('should not log');
      log.warn('should log');

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
    });

    it('defaults to debug in non-production', async () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.debug('should log in dev');

      expect(console.debug).toHaveBeenCalled();
    });

    it('defaults to info in production', async () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.debug('should not log in prod');
      log.info('should log in prod');

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it('handles invalid LOG_LEVEL gracefully', async () => {
      process.env.LOG_LEVEL = 'invalid';
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.debug('should log with default level');

      expect(console.debug).toHaveBeenCalled();
    });
  });

  describe('output methods', () => {
    beforeEach(() => {
      process.env.LOG_LEVEL = 'debug';
    });

    it('logs debug messages', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.debug('debug message');

      expect(console.debug).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
      expect(console.debug).toHaveBeenCalledWith(
        expect.stringContaining('debug message')
      );
    });

    it('logs info messages', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.info('info message');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]')
      );
    });

    it('logs warn messages', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.warn('warn message');

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]')
      );
    });

    it('logs error messages', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.error('error message');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
    });
  });

  describe('context handling', () => {
    beforeEach(() => {
      process.env.LOG_LEVEL = 'debug';
    });

    it('includes context in output', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.info('with context', { userId: 'u123', action: 'login' });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('userId')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('u123')
      );
    });

    it('handles empty context', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.info('no context', {});

      expect(console.log).toHaveBeenCalledWith(
        expect.not.stringContaining('{}')
      );
    });

    it('handles undefined context', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.info('undefined context');

      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('error method overloads', () => {
    beforeEach(() => {
      process.env.LOG_LEVEL = 'debug';
    });

    it('handles Error object', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      const error = new Error('test error');
      log.error('operation failed', error);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('test error')
      );
    });

    it('handles Error object with additional context', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      const error = new Error('test error');
      log.error('operation failed', error, { userId: 'u123' });

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('userId')
      );
    });

    it('handles plain context object', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.error('operation failed', { code: 'ERR_001' });

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('ERR_001')
      );
    });

    it('handles undefined error parameter', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('test');

      log.error('operation failed', undefined);

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('namespacing', () => {
    beforeEach(() => {
      process.env.LOG_LEVEL = 'debug';
    });

    it('includes namespace prefix', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const log = freshCreateLogger('mymodule');

      log.info('test message');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[mymodule]')
      );
    });

    it('creates child logger with combined prefix', async () => {
      jest.resetModules();
      const { createLogger: freshCreateLogger } = await import('../logger');
      const parent = freshCreateLogger('parent');
      const child = parent.child('child');

      child.info('child message');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[parent:child]')
      );
    });

    it('child logger works without parent prefix', async () => {
      jest.resetModules();
      const { logger: freshLogger } = await import('../logger');
      const child = freshLogger.child('orphan');

      child.info('orphan message');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[orphan]')
      );
    });
  });

  describe('logError utility', () => {
    beforeEach(() => {
      process.env.LOG_LEVEL = 'debug';
    });

    it('logs Error objects', async () => {
      jest.resetModules();
      const { logError: freshLogError } = await import('../logger');

      freshLogError('mymodule', 'fetch', new Error('network error'));

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('fetch failed')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('network error')
      );
    });

    it('converts non-Error to Error', async () => {
      jest.resetModules();
      const { logError: freshLogError } = await import('../logger');

      freshLogError('mymodule', 'parse', 'string error');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('parse failed')
      );
    });
  });

  describe('pre-configured loggers', () => {
    it('exports loggers for all modules', () => {
      expect(loggers.slack).toBeDefined();
      expect(loggers.github).toBeDefined();
      expect(loggers.db).toBeDefined();
      expect(loggers.api).toBeDefined();
      expect(loggers.admin).toBeDefined();
      expect(loggers.digest).toBeDefined();
      expect(loggers.assignment).toBeDefined();
      expect(loggers.analytics).toBeDefined();
      expect(loggers.challenges).toBeDefined();
      expect(loggers.goals).toBeDefined();
    });

    it('exports default logger', () => {
      expect(logger).toBeDefined();
    });
  });
});
