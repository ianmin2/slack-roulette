/**
 * Tests for Dead Letter Queue
 */

import { dlq, deadLetterQueue } from '../dead-letter';
import { alerts } from '@/lib/utils/alerts';
import type { Job } from '../index';

// Mock the alerts module
jest.mock('@/lib/utils/alerts', () => ({
  alerts: {
    error: jest.fn().mockResolvedValue(null),
  },
}));

const mockedAlerts = alerts as jest.Mocked<typeof alerts>;

const createMockJob = (overrides?: Partial<Job>): Job => ({
  id: `job_${Date.now()}_1`,
  type: 'test:job',
  payload: { data: 'test' },
  status: 'failed',
  priority: 10,
  attempts: 3,
  maxAttempts: 3,
  createdAt: new Date(),
  scheduledFor: new Date(),
  error: 'Test failure',
  completedAt: new Date(),
  ...overrides,
});

describe('Dead Letter Queue', () => {
  beforeEach(() => {
    dlq.reset();
    jest.clearAllMocks();
  });

  describe('add', () => {
    it('adds a job to the queue', async () => {
      const job = createMockJob();
      const entry = await dlq.add(job, 'Test failure reason');

      expect(entry.job).toBe(job);
      expect(entry.reason).toBe('Test failure reason');
      expect(entry.addedAt).toBeInstanceOf(Date);
      expect(entry.dlqRetryAttempts).toBe(0);
      expect(entry.resolved).toBe(false);
    });

    it('stores stack trace when provided', async () => {
      const job = createMockJob();
      const entry = await dlq.add(job, 'Error', 'Error: Test\n  at test.ts:10');

      expect(entry.stackTrace).toBe('Error: Test\n  at test.ts:10');
    });

    it('sends an alert by default', async () => {
      const job = createMockJob({ type: 'test:important' });
      await dlq.add(job, 'Critical failure');

      expect(mockedAlerts.error).toHaveBeenCalledWith(
        'Job Failed Permanently',
        expect.stringContaining('test:important'),
        'dead-letter-queue',
        expect.objectContaining({
          jobId: job.id,
          jobType: 'test:important',
        })
      );
    });

    it('can disable alerts', async () => {
      dlq.configure({ alertOnAdd: false });
      const job = createMockJob();
      await dlq.add(job, 'Silent failure');

      expect(mockedAlerts.error).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('retrieves an entry by job ID', async () => {
      const job = createMockJob({ id: 'job_123' });
      await dlq.add(job, 'Failure');

      const entry = dlq.get('job_123');
      expect(entry).toBeDefined();
      expect(entry?.job.id).toBe('job_123');
    });

    it('returns undefined for non-existent ID', () => {
      const entry = dlq.get('non-existent');
      expect(entry).toBeUndefined();
    });
  });

  describe('getUnresolved', () => {
    it('returns only unresolved entries', async () => {
      const job1 = createMockJob({ id: 'job_1' });
      const job2 = createMockJob({ id: 'job_2' });

      await dlq.add(job1, 'Failure 1');
      await dlq.add(job2, 'Failure 2');

      dlq.resolve('job_1', 'discarded');

      const unresolved = dlq.getUnresolved();
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].job.id).toBe('job_2');
    });

    it('sorts by addedAt descending', async () => {
      const job1 = createMockJob({ id: 'job_1' });
      const job2 = createMockJob({ id: 'job_2' });

      await dlq.add(job1, 'Failure 1');
      await new Promise((r) => setTimeout(r, 10));
      await dlq.add(job2, 'Failure 2');

      const unresolved = dlq.getUnresolved();
      expect(unresolved[0].job.id).toBe('job_2');
      expect(unresolved[1].job.id).toBe('job_1');
    });
  });

  describe('getByType', () => {
    it('filters entries by job type', async () => {
      await dlq.add(createMockJob({ id: 'job_1', type: 'type-a' }), 'Failure');
      await dlq.add(createMockJob({ id: 'job_2', type: 'type-b' }), 'Failure');
      await dlq.add(createMockJob({ id: 'job_3', type: 'type-a' }), 'Failure');

      const typeA = dlq.getByType('type-a');
      expect(typeA).toHaveLength(2);
      expect(typeA.every((e) => e.job.type === 'type-a')).toBe(true);
    });
  });

  describe('getAll', () => {
    it('returns all entries by default excluding resolved', async () => {
      await dlq.add(createMockJob({ id: 'job_1' }), 'Failure');
      await dlq.add(createMockJob({ id: 'job_2' }), 'Failure');
      dlq.resolve('job_1', 'discarded');

      const all = dlq.getAll();
      expect(all).toHaveLength(1);
    });

    it('includes resolved when requested', async () => {
      await dlq.add(createMockJob({ id: 'job_1' }), 'Failure');
      await dlq.add(createMockJob({ id: 'job_2' }), 'Failure');
      dlq.resolve('job_1', 'discarded');

      const all = dlq.getAll({ includeResolved: true });
      expect(all).toHaveLength(2);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await dlq.add(createMockJob({ id: `job_${i}` }), 'Failure');
      }

      const limited = dlq.getAll({ limit: 5 });
      expect(limited).toHaveLength(5);
    });
  });

  describe('resolve', () => {
    it('marks entry as resolved', async () => {
      const job = createMockJob({ id: 'job_resolve' });
      await dlq.add(job, 'Failure');

      const result = dlq.resolve('job_resolve', 'fixed', {
        by: 'admin',
        notes: 'Fixed the issue',
      });

      expect(result).toBe(true);

      const entry = dlq.get('job_resolve');
      expect(entry?.resolved).toBe(true);
      expect(entry?.resolution?.action).toBe('fixed');
      expect(entry?.resolution?.by).toBe('admin');
      expect(entry?.resolution?.notes).toBe('Fixed the issue');
      expect(entry?.resolution?.at).toBeInstanceOf(Date);
    });

    it('returns false for non-existent entry', () => {
      const result = dlq.resolve('non-existent', 'discarded');
      expect(result).toBe(false);
    });
  });

  describe('prepareForRetry', () => {
    it('returns a job ready for retry', async () => {
      const job = createMockJob({
        id: 'job_retry',
        status: 'failed',
        attempts: 3,
        error: 'Original error',
      });
      await dlq.add(job, 'Failure');

      const retriedJob = dlq.prepareForRetry('job_retry');

      expect(retriedJob).not.toBeNull();
      expect(retriedJob?.status).toBe('pending');
      expect(retriedJob?.attempts).toBe(0);
      expect(retriedJob?.error).toBeUndefined();
      expect(retriedJob?.scheduledFor).toBeInstanceOf(Date);
    });

    it('increments dlqRetryAttempts', async () => {
      await dlq.add(createMockJob({ id: 'job_retry2' }), 'Failure');

      dlq.prepareForRetry('job_retry2');
      dlq.prepareForRetry('job_retry2');

      const entry = dlq.get('job_retry2');
      expect(entry?.dlqRetryAttempts).toBe(2);
    });

    it('returns null for resolved entries', async () => {
      await dlq.add(createMockJob({ id: 'job_resolved' }), 'Failure');
      dlq.resolve('job_resolved', 'discarded');

      const retriedJob = dlq.prepareForRetry('job_resolved');
      expect(retriedJob).toBeNull();
    });

    it('returns null for non-existent entries', () => {
      const retriedJob = dlq.prepareForRetry('non-existent');
      expect(retriedJob).toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', async () => {
      await dlq.add(createMockJob({ id: 'job_1', type: 'type-a' }), 'Network: timeout');
      await dlq.add(createMockJob({ id: 'job_2', type: 'type-a' }), 'Network: refused');
      await dlq.add(createMockJob({ id: 'job_3', type: 'type-b' }), 'Database: connection lost');
      dlq.resolve('job_1', 'fixed');

      const stats = dlq.getStats();

      expect(stats.total).toBe(3);
      expect(stats.unresolved).toBe(2);
      expect(stats.resolved).toBe(1);
      expect(stats.byJobType['type-a']).toBe(2);
      expect(stats.byJobType['type-b']).toBe(1);
      expect(stats.byReason['Network']).toBe(2);
      expect(stats.byReason['Database']).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('removes old resolved entries', async () => {
      await dlq.add(createMockJob({ id: 'job_old' }), 'Failure');
      dlq.resolve('job_old', 'fixed');

      const removed = dlq.cleanup(0); // Remove everything

      expect(removed).toBe(1);
      expect(dlq.get('job_old')).toBeUndefined();
    });

    it('keeps unresolved entries', async () => {
      await dlq.add(createMockJob({ id: 'job_unresolved' }), 'Failure');

      const removed = dlq.cleanup(0);

      expect(removed).toBe(0);
      expect(dlq.get('job_unresolved')).toBeDefined();
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      await dlq.add(createMockJob({ id: 'job_1' }), 'Failure');
      await dlq.add(createMockJob({ id: 'job_2' }), 'Failure');

      dlq.clear();

      expect(dlq.getAll({ includeResolved: true })).toHaveLength(0);
    });
  });
});
