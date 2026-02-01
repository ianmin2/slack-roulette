/**
 * Dead Letter Queue
 *
 * Stores permanently failed jobs for manual review and retry.
 * Integrates with the alerting system for notifications.
 */

import { createLogger } from '@/lib/utils/logger';
import { alerts } from '@/lib/utils/alerts';
import type { Job, JobStatus } from './index';

const log = createLogger('dead-letter');

// =============================================================================
// TYPES
// =============================================================================

export interface DeadLetterEntry {
  /** Original job */
  job: Job;
  /** Time added to dead letter queue */
  addedAt: Date;
  /** Reason for failure */
  reason: string;
  /** Stack trace if available */
  stackTrace?: string;
  /** Number of times retry was attempted from DLQ */
  dlqRetryAttempts: number;
  /** Whether this entry has been resolved */
  resolved: boolean;
  /** Resolution details */
  resolution?: {
    action: 'retried' | 'discarded' | 'fixed';
    by?: string;
    at: Date;
    notes?: string;
  };
}

export interface DeadLetterStats {
  total: number;
  unresolved: number;
  resolved: number;
  byJobType: Record<string, number>;
  byReason: Record<string, number>;
}

// =============================================================================
// DEAD LETTER QUEUE
// =============================================================================

class DeadLetterQueue {
  private entries = new Map<string, DeadLetterEntry>();
  private alertOnAdd = true;

  /**
   * Configure alert behavior
   */
  configure(options: { alertOnAdd?: boolean }): void {
    if (options.alertOnAdd !== undefined) {
      this.alertOnAdd = options.alertOnAdd;
    }
  }

  /**
   * Add a failed job to the dead letter queue
   */
  async add(
    job: Job,
    reason: string,
    stackTrace?: string
  ): Promise<DeadLetterEntry> {
    const entry: DeadLetterEntry = {
      job,
      addedAt: new Date(),
      reason,
      stackTrace,
      dlqRetryAttempts: 0,
      resolved: false,
    };

    this.entries.set(job.id, entry);

    log.error('Job added to dead letter queue', {
      jobId: job.id,
      jobType: job.type,
      reason,
      attempts: job.attempts,
    });

    // Send alert for critical failures
    if (this.alertOnAdd) {
      await alerts.error(
        'Job Failed Permanently',
        `Job ${job.type} (${job.id}) has been moved to dead letter queue after ${job.attempts} attempts.\n\nReason: ${reason}`,
        'dead-letter-queue',
        {
          jobId: job.id,
          jobType: job.type,
          attempts: job.attempts,
          payload: job.payload,
        }
      );
    }

    return entry;
  }

  /**
   * Get an entry by job ID
   */
  get(jobId: string): DeadLetterEntry | undefined {
    return this.entries.get(jobId);
  }

  /**
   * Get all unresolved entries
   */
  getUnresolved(): DeadLetterEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => !e.resolved)
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
  }

  /**
   * Get entries by job type
   */
  getByType(jobType: string): DeadLetterEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => e.job.type === jobType)
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
  }

  /**
   * Get all entries (for admin view)
   */
  getAll(options?: {
    includeResolved?: boolean;
    limit?: number;
  }): DeadLetterEntry[] {
    const { includeResolved = false, limit = 100 } = options ?? {};

    return Array.from(this.entries.values())
      .filter((e) => includeResolved || !e.resolved)
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime())
      .slice(0, limit);
  }

  /**
   * Mark an entry as resolved
   */
  resolve(
    jobId: string,
    action: 'retried' | 'discarded' | 'fixed',
    options?: { by?: string; notes?: string }
  ): boolean {
    const entry = this.entries.get(jobId);
    if (!entry) return false;

    entry.resolved = true;
    entry.resolution = {
      action,
      by: options?.by,
      at: new Date(),
      notes: options?.notes,
    };

    log.info('Dead letter entry resolved', {
      jobId,
      action,
      by: options?.by,
    });

    return true;
  }

  /**
   * Mark entry as retried (increment counter)
   */
  markRetried(jobId: string): boolean {
    const entry = this.entries.get(jobId);
    if (!entry) return false;

    entry.dlqRetryAttempts++;
    return true;
  }

  /**
   * Get a job ready for retry (resets job status)
   */
  prepareForRetry(jobId: string): Job | null {
    const entry = this.entries.get(jobId);
    if (!entry || entry.resolved) return null;

    this.markRetried(jobId);

    // Clone the job with reset status
    const retriedJob: Job = {
      ...entry.job,
      status: 'pending' as JobStatus,
      attempts: 0,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      scheduledFor: new Date(),
    };

    log.info('Job prepared for retry from DLQ', {
      jobId,
      jobType: entry.job.type,
      dlqRetryAttempts: entry.dlqRetryAttempts,
    });

    return retriedJob;
  }

  /**
   * Get statistics
   */
  getStats(): DeadLetterStats {
    const entries = Array.from(this.entries.values());
    const byJobType: Record<string, number> = {};
    const byReason: Record<string, number> = {};

    for (const entry of entries) {
      byJobType[entry.job.type] = (byJobType[entry.job.type] ?? 0) + 1;

      // Simplify reason for grouping
      const simpleReason = entry.reason.split(':')[0] || 'Unknown';
      byReason[simpleReason] = (byReason[simpleReason] ?? 0) + 1;
    }

    return {
      total: entries.length,
      unresolved: entries.filter((e) => !e.resolved).length,
      resolved: entries.filter((e) => e.resolved).length,
      byJobType,
      byReason,
    };
  }

  /**
   * Remove old resolved entries
   */
  cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, entry] of this.entries.entries()) {
      if (entry.resolved && entry.resolution && entry.resolution.at.getTime() <= cutoff) {
        this.entries.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      log.debug('Cleaned up resolved dead letter entries', { removed });
    }

    return removed;
  }

  /**
   * Clear all entries (use with caution)
   */
  clear(): void {
    this.entries.clear();
    log.warn('Dead letter queue cleared');
  }

  /**
   * Reset for testing
   */
  reset(): void {
    this.entries.clear();
    this.alertOnAdd = true;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const deadLetterQueue = new DeadLetterQueue();

// =============================================================================
// EXPORTS
// =============================================================================

export const dlq = {
  configure: deadLetterQueue.configure.bind(deadLetterQueue),
  add: deadLetterQueue.add.bind(deadLetterQueue),
  get: deadLetterQueue.get.bind(deadLetterQueue),
  getUnresolved: deadLetterQueue.getUnresolved.bind(deadLetterQueue),
  getByType: deadLetterQueue.getByType.bind(deadLetterQueue),
  getAll: deadLetterQueue.getAll.bind(deadLetterQueue),
  resolve: deadLetterQueue.resolve.bind(deadLetterQueue),
  prepareForRetry: deadLetterQueue.prepareForRetry.bind(deadLetterQueue),
  getStats: deadLetterQueue.getStats.bind(deadLetterQueue),
  cleanup: deadLetterQueue.cleanup.bind(deadLetterQueue),
  clear: deadLetterQueue.clear.bind(deadLetterQueue),
  reset: deadLetterQueue.reset.bind(deadLetterQueue),
};

export default dlq;
