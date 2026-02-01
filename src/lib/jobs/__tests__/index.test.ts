/**
 * Tests for Job Queue Module
 */

import {
  jobs,
  enqueueJob,
  scheduleJob,
  registerJobHandler,
  startJobQueue,
  stopJobQueue,
  getQueueStats,
  getQueue,
  resetQueue,
  JobTypes,
} from '../index';

describe('Job Queue', () => {
  beforeEach(() => {
    resetQueue();
  });

  afterEach(() => {
    stopJobQueue();
  });

  describe('enqueueJob', () => {
    it('creates a job with default options', async () => {
      const job = await enqueueJob('test:job', { data: 'test' });

      expect(job.id).toMatch(/^job_\d+_\d+$/);
      expect(job.type).toBe('test:job');
      expect(job.payload).toEqual({ data: 'test' });
      expect(job.status).toBe('pending');
      expect(job.priority).toBe(10);
      expect(job.attempts).toBe(0);
      expect(job.maxAttempts).toBe(3);
    });

    it('creates a job with custom options', async () => {
      const job = await enqueueJob(
        'test:custom',
        { value: 123 },
        { priority: 1, maxAttempts: 5 }
      );

      expect(job.priority).toBe(1);
      expect(job.maxAttempts).toBe(5);
    });

    it('creates a job with delay', async () => {
      const before = Date.now();
      const job = await enqueueJob('test:delayed', {}, { delay: 5000 });

      expect(job.scheduledFor.getTime()).toBeGreaterThanOrEqual(before + 5000);
    });
  });

  describe('scheduleJob', () => {
    it('schedules a job for a specific time', async () => {
      const futureTime = new Date(Date.now() + 60000);
      const job = await scheduleJob('test:scheduled', { task: 'future' }, futureTime);

      expect(job.scheduledFor.getTime()).toBe(futureTime.getTime());
      expect(job.status).toBe('pending');
    });
  });

  describe('registerJobHandler', () => {
    it('registers a handler for a job type', async () => {
      const handler = jest.fn().mockResolvedValue('done');
      registerJobHandler('test:handler', handler);

      const job = await enqueueJob('test:handler', { input: 'value' });

      // Process jobs
      startJobQueue();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith({ input: 'value' });
    });

    it('processes job and marks as completed', async () => {
      const handler = jest.fn().mockResolvedValue({ result: 'success' });
      registerJobHandler('test:complete', handler);

      const job = await enqueueJob('test:complete', {});
      startJobQueue();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedJob = getQueue().getJob(job.id);
      expect(updatedJob?.status).toBe('completed');
      expect(updatedJob?.result).toEqual({ result: 'success' });
    });

    it('retries failed jobs', async () => {
      jest.useFakeTimers();

      let callCount = 0;
      const handler = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      registerJobHandler('test:retry', handler);
      const job = await enqueueJob('test:retry', {}, { maxAttempts: 3 });

      startJobQueue(50);

      // First attempt fails, schedules retry
      await jest.advanceTimersByTimeAsync(100);

      // Advance past the retry delay (2000ms for attempt 1)
      await jest.advanceTimersByTimeAsync(2500);

      const updatedJob = getQueue().getJob(job.id);
      expect(updatedJob?.status).toBe('completed');
      expect(callCount).toBe(2);

      jest.useRealTimers();
    });

    it('marks job as failed after max attempts', async () => {
      jest.useFakeTimers();

      const handler = jest.fn().mockRejectedValue(new Error('Permanent failure'));
      registerJobHandler('test:fail', handler);

      const job = await enqueueJob('test:fail', {}, { maxAttempts: 2 });

      startJobQueue(50);

      // First attempt fails, schedules retry
      await jest.advanceTimersByTimeAsync(100);

      // Advance past the retry delay (2000ms for attempt 1)
      await jest.advanceTimersByTimeAsync(2500);

      const updatedJob = getQueue().getJob(job.id);
      expect(updatedJob?.status).toBe('failed');
      expect(updatedJob?.error).toBe('Permanent failure');
      expect(updatedJob?.attempts).toBe(2);

      jest.useRealTimers();
    });
  });

  describe('getQueueStats', () => {
    it('returns correct statistics', async () => {
      await enqueueJob('test:stat1', {});
      await enqueueJob('test:stat2', {});

      const stats = getQueueStats();

      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.total).toBe(2);
    });

    it('updates stats after processing', async () => {
      const handler = jest.fn().mockResolvedValue('done');
      registerJobHandler('test:stats', handler);

      await enqueueJob('test:stats', {});
      startJobQueue();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = getQueueStats();
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(0);
    });
  });

  describe('queue operations', () => {
    it('gets job by id', async () => {
      const job = await enqueueJob('test:get', { data: 'findme' });
      const found = getQueue().getJob(job.id);

      expect(found).toBeDefined();
      expect(found?.payload).toEqual({ data: 'findme' });
    });

    it('gets jobs by type', async () => {
      await enqueueJob('test:type-a', {});
      await enqueueJob('test:type-a', {});
      await enqueueJob('test:type-b', {});

      const typeAJobs = getQueue().getJobsByType('test:type-a');
      expect(typeAJobs).toHaveLength(2);
    });

    it('processes jobs in priority order', async () => {
      const processed: number[] = [];
      const handler = jest.fn().mockImplementation(async (payload: { priority: number }) => {
        processed.push(payload.priority);
      });

      registerJobHandler('test:priority', handler);

      await enqueueJob('test:priority', { priority: 3 }, { priority: 3 });
      await enqueueJob('test:priority', { priority: 1 }, { priority: 1 });
      await enqueueJob('test:priority', { priority: 2 }, { priority: 2 });

      startJobQueue();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should be processed in priority order (1, 2, 3)
      expect(processed).toEqual([1, 2, 3]);
    });

    it('clears all jobs', async () => {
      await enqueueJob('test:clear1', {});
      await enqueueJob('test:clear2', {});

      getQueue().clear();

      const stats = getQueueStats();
      expect(stats.total).toBe(0);
    });

    it('cleans up old completed jobs', async () => {
      const handler = jest.fn().mockResolvedValue('done');
      registerJobHandler('test:cleanup', handler);

      const job = await enqueueJob('test:cleanup', {});
      startJobQueue();
      await new Promise((resolve) => setTimeout(resolve, 100));
      stopJobQueue();

      // Job should be completed
      expect(getQueue().getJob(job.id)?.status).toBe('completed');

      // Cleanup with 0 maxAge should remove it
      const removed = getQueue().cleanup(0);
      expect(removed).toBe(1);
      expect(getQueue().getJob(job.id)).toBeUndefined();
    });
  });

  describe('JobTypes', () => {
    it('has all expected job types', () => {
      expect(JobTypes.GENERATE_WEEKLY_DIGEST).toBe('digest:generate');
      expect(JobTypes.SEND_WEEKLY_DIGEST).toBe('digest:send');
      expect(JobTypes.CHECK_ACHIEVEMENTS).toBe('achievements:check');
      expect(JobTypes.UPDATE_CHALLENGE_PROGRESS).toBe('challenges:progress');
      expect(JobTypes.SEND_SLACK_NOTIFICATION).toBe('notifications:slack');
      expect(JobTypes.AGGREGATE_DAILY_STATS).toBe('analytics:daily');
      expect(JobTypes.PROCESS_PR_ASSIGNMENT).toBe('assignment:process');
      expect(JobTypes.SYNC_GITHUB_STATUS).toBe('maintenance:github-sync');
    });
  });

  describe('jobs convenience object', () => {
    it('exports all methods', () => {
      expect(jobs.enqueue).toBeDefined();
      expect(jobs.schedule).toBeDefined();
      expect(jobs.register).toBeDefined();
      expect(jobs.start).toBeDefined();
      expect(jobs.stop).toBeDefined();
      expect(jobs.getStats).toBeDefined();
      expect(jobs.getQueue).toBeDefined();
      expect(jobs.resetQueue).toBeDefined();
      expect(jobs.types).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles job without registered handler', async () => {
      const job = await enqueueJob('test:no-handler', {});

      startJobQueue();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedJob = getQueue().getJob(job.id);
      expect(updatedJob?.status).toBe('failed');
      expect(updatedJob?.error).toContain('No handler registered');
    });

    it('handles multiple start calls gracefully', () => {
      startJobQueue();
      startJobQueue(); // Should not throw or create multiple intervals
      stopJobQueue();
    });

    it('handles stop without start', () => {
      stopJobQueue(); // Should not throw
    });
  });
});
