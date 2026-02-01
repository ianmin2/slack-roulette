/**
 * Tests for Error Tracking
 */

import { errors, errorTracker } from '../error-tracking';

describe('Error Tracking', () => {
  beforeEach(() => {
    errors.reset();
  });

  describe('captureException', () => {
    it('captures an exception', async () => {
      const error = new Error('Test error');
      const errorId = await errors.captureException(error);

      expect(errorId).toMatch(/^err_\d+_\d+$/);

      const tracked = errors.getError(errorId!);
      expect(tracked).toBeDefined();
      expect(tracked?.message).toBe('Test error');
      expect(tracked?.severity).toBe('error');
    });

    it('captures exception with context', async () => {
      const error = new Error('User error');
      const errorId = await errors.captureException(error, {
        userId: 'user-123',
        requestId: 'req-456',
        tags: { component: 'auth' },
        extra: { attemptCount: 3 },
      });

      const tracked = errors.getError(errorId!);
      expect(tracked?.context.userId).toBe('user-123');
      expect(tracked?.context.requestId).toBe('req-456');
      expect(tracked?.context.tags?.component).toBe('auth');
      expect(tracked?.context.extra?.attemptCount).toBe(3);
    });

    it('captures stack trace', async () => {
      const error = new Error('Stack trace test');
      const errorId = await errors.captureException(error);

      const tracked = errors.getError(errorId!);
      expect(tracked?.stack).toContain('Error: Stack trace test');
    });
  });

  describe('captureMessage', () => {
    it('captures a message with default severity', async () => {
      const errorId = await errors.captureMessage('Something happened');

      const tracked = errors.getError(errorId!);
      expect(tracked?.message).toBe('Something happened');
      expect(tracked?.severity).toBe('info');
    });

    it('captures message with specified severity', async () => {
      const errorId = await errors.captureMessage('Warning message', 'warning');

      const tracked = errors.getError(errorId!);
      expect(tracked?.severity).toBe('warning');
    });
  });

  describe('captureFatal', () => {
    it('captures fatal errors', async () => {
      const error = new Error('Fatal error');
      const errorId = await errors.captureFatal(error);

      const tracked = errors.getError(errorId!);
      expect(tracked?.severity).toBe('fatal');
    });
  });

  describe('ignore patterns', () => {
    it('ignores errors matching patterns', async () => {
      errors.init({
        ignorePatterns: [/ResizeObserver/i, /Network request failed/i],
      });

      const errorId1 = await errors.captureException(new Error('ResizeObserver loop completed'));
      const errorId2 = await errors.captureException(new Error('Network request failed'));
      const errorId3 = await errors.captureException(new Error('Real error'));

      expect(errorId1).toBeNull();
      expect(errorId2).toBeNull();
      expect(errorId3).not.toBeNull();
    });
  });

  describe('sample rate', () => {
    it('respects sample rate', async () => {
      errors.init({ sampleRate: 0 }); // Drop all errors

      const errorId = await errors.captureException(new Error('Sampled out'));

      expect(errorId).toBeNull();
    });

    it('captures all errors with sample rate 1', async () => {
      errors.init({ sampleRate: 1 });

      const errorIds = await Promise.all([
        errors.captureException(new Error('Error 1')),
        errors.captureException(new Error('Error 2')),
        errors.captureException(new Error('Error 3')),
      ]);

      expect(errorIds.every((id) => id !== null)).toBe(true);
    });
  });

  describe('beforeSend hook', () => {
    it('allows modifying errors before capture', async () => {
      errors.init({
        beforeSend: (error) => {
          error.context.tags = { ...error.context.tags, processed: 'true' };
          return error;
        },
      });

      const errorId = await errors.captureException(new Error('Modified'));

      const tracked = errors.getError(errorId!);
      expect(tracked?.context.tags?.processed).toBe('true');
    });

    it('allows dropping errors', async () => {
      errors.init({
        beforeSend: (error) => {
          if (error.message.includes('drop')) return null;
          return error;
        },
      });

      const errorId1 = await errors.captureException(new Error('Please drop this'));
      const errorId2 = await errors.captureException(new Error('Keep this'));

      expect(errorId1).toBeNull();
      expect(errorId2).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', async () => {
      await errors.captureException(new Error('Error 1'));
      await errors.captureException(new Error('Error 2'));
      await errors.captureMessage('Warning', 'warning');
      await errors.captureMessage('Info', 'info');

      const stats = errors.getStats();

      expect(stats.total).toBe(4);
      expect(stats.bySeverity.error).toBe(2);
      expect(stats.bySeverity.warning).toBe(1);
      expect(stats.bySeverity.info).toBe(1);
    });

    it('tracks errors by tags', async () => {
      await errors.captureException(new Error('Auth error'), {
        tags: { component: 'auth' },
      });
      await errors.captureException(new Error('Auth error 2'), {
        tags: { component: 'auth' },
      });
      await errors.captureException(new Error('API error'), {
        tags: { component: 'api' },
      });

      const stats = errors.getStats();

      expect(stats.byTag['component:auth']).toBe(2);
      expect(stats.byTag['component:api']).toBe(1);
    });

    it('includes recent errors', async () => {
      await errors.captureException(new Error('Error 1'));
      await errors.captureException(new Error('Error 2'));

      const stats = errors.getStats();

      expect(stats.recentErrors).toHaveLength(2);
      expect(stats.recentErrors[0].message).toBe('Error 2'); // Most recent first
    });
  });

  describe('getRecentErrors', () => {
    it('returns errors in reverse chronological order', async () => {
      await errors.captureException(new Error('First'));
      await errors.captureException(new Error('Second'));
      await errors.captureException(new Error('Third'));

      const recent = errors.getRecentErrors(10);

      expect(recent[0].message).toBe('Third');
      expect(recent[2].message).toBe('First');
    });

    it('respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await errors.captureException(new Error(`Error ${i}`));
      }

      const recent = errors.getRecentErrors(5);

      expect(recent).toHaveLength(5);
    });
  });

  describe('withScope', () => {
    it('creates scoped error tracker', async () => {
      const scoped = errors.withScope({
        userId: 'user-123',
        tags: { service: 'worker' },
      });

      const errorId = await scoped.captureException(new Error('Scoped error'));

      const tracked = errors.getError(errorId!);
      expect(tracked?.context.userId).toBe('user-123');
      expect(tracked?.context.tags?.service).toBe('worker');
    });

    it('merges extra context', async () => {
      const scoped = errors.withScope({
        userId: 'user-123',
      });

      const errorId = await scoped.captureException(new Error('With extra'), {
        requestId: 'req-456',
      });

      const tracked = errors.getError(errorId!);
      expect(tracked?.context.userId).toBe('user-123');
      expect(tracked?.context.requestId).toBe('req-456');
    });
  });

  describe('wrap', () => {
    it('returns result on success', async () => {
      const result = await errors.wrap(async () => {
        return 'success';
      });

      expect(result).toBe('success');
      expect(errors.getRecentErrors()).toHaveLength(0);
    });

    it('captures and rethrows errors', async () => {
      await expect(
        errors.wrap(async () => {
          throw new Error('Wrapped error');
        })
      ).rejects.toThrow('Wrapped error');

      const recent = errors.getRecentErrors();
      expect(recent).toHaveLength(1);
      expect(recent[0].message).toBe('Wrapped error');
    });

    it('includes context in wrapped errors', async () => {
      try {
        await errors.wrap(
          async () => {
            throw new Error('Context error');
          },
          { userId: 'user-789', tags: { operation: 'test' } }
        );
      } catch {
        // Expected
      }

      const recent = errors.getRecentErrors();
      expect(recent[0].context.userId).toBe('user-789');
      expect(recent[0].context.tags?.operation).toBe('test');
    });
  });

  describe('clearErrors', () => {
    it('clears all tracked errors', async () => {
      await errors.captureException(new Error('Error 1'));
      await errors.captureException(new Error('Error 2'));

      errors.clearErrors();

      expect(errors.getRecentErrors()).toHaveLength(0);
      expect(errors.getStats().total).toBe(0);
    });
  });

  describe('init with Sentry DSN', () => {
    it('marks errors as reported when DSN is set', async () => {
      errors.init({ dsn: 'https://fake@sentry.io/123' });

      const errorId = await errors.captureException(new Error('Reported error'));

      const tracked = errors.getError(errorId!);
      expect(tracked?.reported).toBe(true);
      expect(tracked?.sentryEventId).toBeDefined();
    });
  });
});
