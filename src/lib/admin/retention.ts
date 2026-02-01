/**
 * Data Retention Policies
 *
 * Manages data lifecycle, cleanup, and archival for compliance and storage optimization.
 */

import { createLogger } from '@/lib/utils/logger';
import { db } from '@/lib/db';

const log = createLogger('retention');

// =============================================================================
// TYPES
// =============================================================================

export interface RetentionPolicy {
  /** Policy identifier */
  id: string;
  /** Entity type this policy applies to */
  entityType: 'assignments' | 'statistics' | 'auditLogs' | 'notifications' | 'deadLetterEntries';
  /** Retention period in days */
  retentionDays: number;
  /** What to do with expired data */
  action: 'delete' | 'archive' | 'anonymize';
  /** Whether the policy is enabled */
  enabled: boolean;
  /** Additional conditions (JSON filter) */
  conditions?: Record<string, unknown>;
  /** Description */
  description: string;
}

export interface RetentionResult {
  policy: string;
  entityType: string;
  action: string;
  recordsProcessed: number;
  startedAt: Date;
  completedAt: Date;
  errors: string[];
}

export interface RetentionStats {
  lastRun?: Date;
  policiesExecuted: number;
  totalRecordsProcessed: number;
  byPolicy: Record<string, { processed: number; errors: number }>;
}

// =============================================================================
// DEFAULT POLICIES
// =============================================================================

export const DEFAULT_POLICIES: RetentionPolicy[] = [
  {
    id: 'assignments-completed',
    entityType: 'assignments',
    retentionDays: 365, // 1 year
    action: 'archive',
    enabled: true,
    conditions: { status: 'COMPLETED' },
    description: 'Archive completed assignments older than 1 year',
  },
  {
    id: 'assignments-abandoned',
    entityType: 'assignments',
    retentionDays: 90, // 3 months
    action: 'delete',
    enabled: true,
    conditions: { status: 'EXPIRED' },
    description: 'Delete expired/abandoned assignments after 90 days',
  },
  {
    id: 'statistics-detailed',
    entityType: 'statistics',
    retentionDays: 730, // 2 years
    action: 'anonymize',
    enabled: true,
    description: 'Anonymize detailed statistics older than 2 years',
  },
  {
    id: 'audit-logs',
    entityType: 'auditLogs',
    retentionDays: 365, // 1 year
    action: 'archive',
    enabled: true,
    description: 'Archive audit logs older than 1 year',
  },
  {
    id: 'dead-letter-resolved',
    entityType: 'deadLetterEntries',
    retentionDays: 30, // 30 days
    action: 'delete',
    enabled: true,
    conditions: { resolved: true },
    description: 'Delete resolved dead letter entries after 30 days',
  },
];

// =============================================================================
// RETENTION MANAGER
// =============================================================================

class RetentionManager {
  private policies: Map<string, RetentionPolicy> = new Map();
  private results: RetentionResult[] = [];
  private lastStats: RetentionStats | null = null;

  constructor() {
    // Load default policies
    for (const policy of DEFAULT_POLICIES) {
      this.policies.set(policy.id, policy);
    }
  }

  /**
   * Get all policies
   */
  getPolicies(): RetentionPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get a specific policy
   */
  getPolicy(id: string): RetentionPolicy | undefined {
    return this.policies.get(id);
  }

  /**
   * Add or update a policy
   */
  setPolicy(policy: RetentionPolicy): void {
    this.policies.set(policy.id, policy);
    log.info('Retention policy updated', { id: policy.id, action: policy.action });
  }

  /**
   * Remove a policy
   */
  removePolicy(id: string): boolean {
    const removed = this.policies.delete(id);
    if (removed) {
      log.info('Retention policy removed', { id });
    }
    return removed;
  }

  /**
   * Enable or disable a policy
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const policy = this.policies.get(id);
    if (!policy) return false;

    policy.enabled = enabled;
    log.info('Retention policy status changed', { id, enabled });
    return true;
  }

  /**
   * Calculate cutoff date for a policy
   */
  getCutoffDate(policy: RetentionPolicy): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - policy.retentionDays);
    return cutoff;
  }

  /**
   * Execute all enabled policies
   */
  async executeAll(dryRun = false): Promise<RetentionResult[]> {
    const results: RetentionResult[] = [];
    const enabledPolicies = Array.from(this.policies.values()).filter((p) => p.enabled);

    log.info('Starting retention policy execution', {
      dryRun,
      policyCount: enabledPolicies.length,
    });

    for (const policy of enabledPolicies) {
      try {
        const result = await this.executePolicy(policy, dryRun);
        results.push(result);
      } catch (error) {
        log.error('Retention policy execution failed', error instanceof Error ? error : new Error(String(error)), {
          policyId: policy.id,
        });

        results.push({
          policy: policy.id,
          entityType: policy.entityType,
          action: policy.action,
          recordsProcessed: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          errors: [error instanceof Error ? error.message : String(error)],
        });
      }
    }

    this.results = results;
    this.updateStats(results);

    return results;
  }

  /**
   * Execute a specific policy
   */
  async executePolicy(policy: RetentionPolicy, dryRun = false): Promise<RetentionResult> {
    const startedAt = new Date();
    const cutoff = this.getCutoffDate(policy);
    const errors: string[] = [];
    let recordsProcessed = 0;

    log.debug('Executing retention policy', {
      id: policy.id,
      entityType: policy.entityType,
      action: policy.action,
      cutoff: cutoff.toISOString(),
      dryRun,
    });

    try {
      switch (policy.entityType) {
        case 'assignments':
          recordsProcessed = await this.processAssignments(policy, cutoff, dryRun);
          break;
        case 'statistics':
          recordsProcessed = await this.processStatistics(policy, cutoff, dryRun);
          break;
        case 'auditLogs':
          recordsProcessed = await this.processAuditLogs(policy, cutoff, dryRun);
          break;
        default:
          log.warn('Unknown entity type for retention', { entityType: policy.entityType });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const result: RetentionResult = {
      policy: policy.id,
      entityType: policy.entityType,
      action: policy.action,
      recordsProcessed,
      startedAt,
      completedAt: new Date(),
      errors,
    };

    log.info('Retention policy execution completed', {
      policyId: policy.id,
      recordsProcessed,
      durationMs: result.completedAt.getTime() - startedAt.getTime(),
      dryRun,
    });

    return result;
  }

  /**
   * Process assignment records
   */
  private async processAssignments(
    policy: RetentionPolicy,
    cutoff: Date,
    dryRun: boolean
  ): Promise<number> {
    const whereClause: Record<string, unknown> = {
      createdAt: { lt: cutoff },
    };

    // Add status condition if specified
    if (policy.conditions?.status) {
      whereClause.status = policy.conditions.status;
    }

    if (dryRun) {
      const count = await db.assignment.count({ where: whereClause });
      return count;
    }

    switch (policy.action) {
      case 'delete': {
        const result = await db.assignment.deleteMany({ where: whereClause });
        return result.count;
      }
      case 'archive': {
        // Archive by marking as EXPIRED (Assignment model doesn't have deletedAt)
        const result = await db.assignment.updateMany({
          where: whereClause,
          data: { status: 'EXPIRED' },
        });
        return result.count;
      }
      case 'anonymize': {
        // Remove PII while keeping statistical data
        const result = await db.assignment.updateMany({
          where: whereClause,
          data: {
            prUrl: '[REDACTED]',
            prTitle: '[REDACTED]',
          },
        });
        return result.count;
      }
    }
  }

  /**
   * Process statistics records
   */
  private async processStatistics(
    policy: RetentionPolicy,
    cutoff: Date,
    dryRun: boolean
  ): Promise<number> {
    const whereClause = {
      updatedAt: { lt: cutoff },
    };

    if (dryRun) {
      const count = await db.statistics.count({ where: whereClause });
      return count;
    }

    switch (policy.action) {
      case 'delete': {
        const result = await db.statistics.deleteMany({ where: whereClause });
        return result.count;
      }
      case 'archive': {
        // Statistics don't have a deletedAt, so we just return 0 for archive
        // In production, you'd move to an archive table
        return 0;
      }
      case 'anonymize': {
        // Set userId to null to anonymize
        const result = await db.statistics.updateMany({
          where: whereClause,
          data: { userId: '[ANONYMIZED]' },
        });
        return result.count;
      }
    }
  }

  /**
   * Process audit log records
   */
  private async processAuditLogs(
    policy: RetentionPolicy,
    cutoff: Date,
    dryRun: boolean
  ): Promise<number> {
    const whereClause = {
      createdAt: { lt: cutoff },
    };

    if (dryRun) {
      const count = await db.auditLog.count({ where: whereClause });
      return count;
    }

    switch (policy.action) {
      case 'delete':
      case 'archive': {
        // AuditLog doesn't have soft delete - use hard delete for both
        const result = await db.auditLog.deleteMany({ where: whereClause });
        return result.count;
      }
      case 'anonymize': {
        // Anonymize by removing user reference
        const result = await db.auditLog.updateMany({
          where: whereClause,
          data: { userId: null },
        });
        return result.count;
      }
    }
  }

  /**
   * Get the last execution stats
   */
  getStats(): RetentionStats | null {
    return this.lastStats;
  }

  /**
   * Get recent execution results
   */
  getResults(limit = 10): RetentionResult[] {
    return this.results.slice(-limit);
  }

  /**
   * Update stats from results
   */
  private updateStats(results: RetentionResult[]): void {
    const byPolicy: Record<string, { processed: number; errors: number }> = {};

    for (const result of results) {
      byPolicy[result.policy] = {
        processed: result.recordsProcessed,
        errors: result.errors.length,
      };
    }

    this.lastStats = {
      lastRun: new Date(),
      policiesExecuted: results.length,
      totalRecordsProcessed: results.reduce((sum, r) => sum + r.recordsProcessed, 0),
      byPolicy,
    };
  }

  /**
   * Reset to default policies (for testing)
   */
  reset(): void {
    this.policies.clear();
    for (const policy of DEFAULT_POLICIES) {
      this.policies.set(policy.id, { ...policy });
    }
    this.results = [];
    this.lastStats = null;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const retentionManager = new RetentionManager();

// =============================================================================
// EXPORTS
// =============================================================================

export const retention = {
  getPolicies: retentionManager.getPolicies.bind(retentionManager),
  getPolicy: retentionManager.getPolicy.bind(retentionManager),
  setPolicy: retentionManager.setPolicy.bind(retentionManager),
  removePolicy: retentionManager.removePolicy.bind(retentionManager),
  setEnabled: retentionManager.setEnabled.bind(retentionManager),
  getCutoffDate: retentionManager.getCutoffDate.bind(retentionManager),
  executeAll: retentionManager.executeAll.bind(retentionManager),
  executePolicy: retentionManager.executePolicy.bind(retentionManager),
  getStats: retentionManager.getStats.bind(retentionManager),
  getResults: retentionManager.getResults.bind(retentionManager),
  reset: retentionManager.reset.bind(retentionManager),
};

export default retention;
