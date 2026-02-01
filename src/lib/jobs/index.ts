/**
 * Background Job Queue
 *
 * Provides job scheduling and processing for heavy/async operations:
 * - Weekly digest generation and sending
 * - Achievement checking
 * - Challenge progress updates
 * - Notification batching
 * - Analytics aggregation
 */

import { createLogger } from '@/lib/utils/logger';
import { dlq } from './dead-letter';

const log = createLogger('jobs');

// =============================================================================
// TYPES
// =============================================================================

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  scheduledFor: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: unknown;
}

export interface JobHandler<T = unknown> {
  (payload: T): Promise<unknown>;
}

export interface JobOptions {
  /** Job priority (lower = higher priority). Default: 10 */
  priority?: number;
  /** Maximum retry attempts. Default: 3 */
  maxAttempts?: number;
  /** Delay before processing (ms). Default: 0 */
  delay?: number;
  /** Scheduled time for the job */
  scheduledFor?: Date;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

// =============================================================================
// JOB TYPES
// =============================================================================

export const JobTypes = {
  // Digest jobs
  GENERATE_WEEKLY_DIGEST: 'digest:generate',
  SEND_WEEKLY_DIGEST: 'digest:send',

  // Achievement jobs
  CHECK_ACHIEVEMENTS: 'achievements:check',
  NOTIFY_ACHIEVEMENT: 'achievements:notify',

  // Challenge jobs
  UPDATE_CHALLENGE_PROGRESS: 'challenges:progress',
  COMPLETE_CHALLENGE: 'challenges:complete',
  CREATE_WEEKLY_CHALLENGES: 'challenges:create-weekly',

  // Notification jobs
  SEND_SLACK_NOTIFICATION: 'notifications:slack',
  SEND_BATCH_NOTIFICATIONS: 'notifications:batch',

  // Analytics jobs
  AGGREGATE_DAILY_STATS: 'analytics:daily',
  GENERATE_BOTTLENECK_REPORT: 'analytics:bottleneck',
  CLEANUP_OLD_DATA: 'analytics:cleanup',

  // Assignment jobs
  PROCESS_PR_ASSIGNMENT: 'assignment:process',
  REMIND_PENDING_REVIEW: 'assignment:remind',

  // Maintenance jobs
  SYNC_GITHUB_STATUS: 'maintenance:github-sync',
  REFRESH_USER_DATA: 'maintenance:refresh-users',
} as const;

export type JobType = (typeof JobTypes)[keyof typeof JobTypes];

// =============================================================================
// IN-MEMORY QUEUE IMPLEMENTATION
// =============================================================================

class JobQueue {
  private jobs = new Map<string, Job>();
  private handlers = new Map<string, JobHandler>();
  private processing = false;
  private processInterval: NodeJS.Timeout | null = null;
  private jobIdCounter = 0;

  /**
   * Register a handler for a job type
   */
  registerHandler<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
    log.debug('Registered job handler', { type });
  }

  /**
   * Add a job to the queue
   */
  async enqueue<T>(
    type: string,
    payload: T,
    options: JobOptions = {}
  ): Promise<Job<T>> {
    const {
      priority = 10,
      maxAttempts = 3,
      delay = 0,
      scheduledFor,
    } = options;

    const id = `job_${Date.now()}_${++this.jobIdCounter}`;
    const now = new Date();

    const job: Job<T> = {
      id,
      type,
      payload,
      status: 'pending',
      priority,
      attempts: 0,
      maxAttempts,
      createdAt: now,
      scheduledFor: scheduledFor ?? new Date(now.getTime() + delay),
    };

    this.jobs.set(id, job as Job);
    log.debug('Job enqueued', { id, type, scheduledFor: job.scheduledFor });

    // Trigger processing if not already running
    this.scheduleProcessing();

    return job;
  }

  /**
   * Add multiple jobs at once
   */
  async enqueueBatch<T>(
    jobs: Array<{ type: string; payload: T; options?: JobOptions }>
  ): Promise<Job<T>[]> {
    return Promise.all(
      jobs.map(({ type, payload, options }) => this.enqueue(type, payload, options))
    );
  }

  /**
   * Schedule a job for a specific time
   */
  async schedule<T>(
    type: string,
    payload: T,
    scheduledFor: Date,
    options: Omit<JobOptions, 'scheduledFor' | 'delay'> = {}
  ): Promise<Job<T>> {
    return this.enqueue(type, payload, { ...options, scheduledFor });
  }

  /**
   * Get a job by ID
   */
  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * Get all jobs of a specific type
   */
  getJobsByType(type: string): Job[] {
    return Array.from(this.jobs.values()).filter((j) => j.type === type);
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const jobs = Array.from(this.jobs.values());
    return {
      pending: jobs.filter((j) => j.status === 'pending').length,
      processing: jobs.filter((j) => j.status === 'processing').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      total: jobs.length,
    };
  }

  /**
   * Start processing jobs
   */
  start(intervalMs = 1000): void {
    if (this.processInterval) return;

    log.info('Job queue started', { intervalMs });
    this.processInterval = setInterval(() => this.processJobs(), intervalMs);
    // Process immediately
    this.processJobs();
  }

  /**
   * Stop processing jobs
   */
  stop(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
      log.info('Job queue stopped');
    }
  }

  /**
   * Clear all jobs (use with caution)
   */
  clear(): void {
    this.jobs.clear();
    this.jobIdCounter = 0;
    log.warn('Job queue cleared');
  }

  /**
   * Remove completed/failed jobs older than specified age
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, job] of this.jobs.entries()) {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        job.completedAt &&
        job.completedAt.getTime() < cutoff
      ) {
        this.jobs.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      log.debug('Cleaned up old jobs', { removed });
    }

    return removed;
  }

  private scheduleProcessing(): void {
    // If not started with interval, process on next tick
    if (!this.processInterval && !this.processing) {
      setImmediate(() => this.processJobs());
    }
  }

  private async processJobs(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const now = new Date();
      const pendingJobs = Array.from(this.jobs.values())
        .filter(
          (j) =>
            (j.status === 'pending' || j.status === 'retrying') &&
            j.scheduledFor <= now
        )
        .sort((a, b) => {
          // Sort by priority first, then by scheduled time
          if (a.priority !== b.priority) return a.priority - b.priority;
          return a.scheduledFor.getTime() - b.scheduledFor.getTime();
        });

      for (const job of pendingJobs) {
        await this.processJob(job);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);

    if (!handler) {
      log.warn('No handler registered for job type', { type: job.type, id: job.id });
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.type}`;
      job.completedAt = new Date();
      return;
    }

    job.status = 'processing';
    job.startedAt = new Date();
    job.attempts++;

    log.debug('Processing job', { id: job.id, type: job.type, attempt: job.attempts });

    try {
      const result = await handler(job.payload);

      job.status = 'completed';
      job.result = result;
      job.completedAt = new Date();

      log.debug('Job completed', {
        id: job.id,
        type: job.type,
        durationMs: job.completedAt.getTime() - job.startedAt!.getTime(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (job.attempts < job.maxAttempts) {
        // Schedule retry with exponential backoff
        const delayMs = Math.min(1000 * Math.pow(2, job.attempts), 60000);
        job.status = 'retrying';
        job.scheduledFor = new Date(Date.now() + delayMs);
        job.error = errorMessage;

        log.warn('Job failed, scheduling retry', {
          id: job.id,
          type: job.type,
          attempt: job.attempts,
          maxAttempts: job.maxAttempts,
          retryIn: delayMs,
          error: errorMessage,
        });
      } else {
        job.status = 'failed';
        job.error = errorMessage;
        job.completedAt = new Date();

        log.error('Job failed permanently', {
          id: job.id,
          type: job.type,
          attempts: job.attempts,
          error: errorMessage,
        });

        // Add to dead letter queue for manual review
        const stackTrace = error instanceof Error ? error.stack : undefined;
        dlq.add(job, errorMessage, stackTrace).catch((dlqError) => {
          log.error('Failed to add job to dead letter queue', dlqError instanceof Error ? dlqError : new Error(String(dlqError)), {
            jobId: job.id,
          });
        });
      }
    }
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let queueInstance: JobQueue | null = null;

/**
 * Get the job queue instance
 */
export const getQueue = (): JobQueue => {
  if (!queueInstance) {
    queueInstance = new JobQueue();
  }
  return queueInstance;
};

/**
 * Reset the queue (mainly for testing)
 */
export const resetQueue = (): void => {
  if (queueInstance) {
    queueInstance.stop();
    queueInstance.clear();
  }
  queueInstance = null;
};

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Enqueue a job
 */
export const enqueueJob = async <T>(
  type: string,
  payload: T,
  options?: JobOptions
): Promise<Job<T>> => {
  return getQueue().enqueue(type, payload, options);
};

/**
 * Schedule a job for later
 */
export const scheduleJob = async <T>(
  type: string,
  payload: T,
  scheduledFor: Date,
  options?: Omit<JobOptions, 'scheduledFor' | 'delay'>
): Promise<Job<T>> => {
  return getQueue().schedule(type, payload, scheduledFor, options);
};

/**
 * Register a job handler
 */
export const registerJobHandler = <T>(
  type: string,
  handler: JobHandler<T>
): void => {
  getQueue().registerHandler(type, handler);
};

/**
 * Start processing jobs
 */
export const startJobQueue = (intervalMs?: number): void => {
  getQueue().start(intervalMs);
};

/**
 * Stop processing jobs
 */
export const stopJobQueue = (): void => {
  getQueue().stop();
};

/**
 * Get queue statistics
 */
export const getQueueStats = (): QueueStats => {
  return getQueue().getStats();
};

// =============================================================================
// EXPORTS
// =============================================================================

export const jobs = {
  enqueue: enqueueJob,
  schedule: scheduleJob,
  register: registerJobHandler,
  start: startJobQueue,
  stop: stopJobQueue,
  getStats: getQueueStats,
  getQueue,
  resetQueue,
  types: JobTypes,
};

export default jobs;
