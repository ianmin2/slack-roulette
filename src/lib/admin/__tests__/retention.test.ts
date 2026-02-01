/**
 * Tests for Data Retention Policies
 */

// Mock the db module
jest.mock('@/lib/db', () => ({
  db: {
    assignment: {
      count: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    statistics: {
      count: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      count: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import {
  retention,
  retentionManager,
  DEFAULT_POLICIES,
  type RetentionPolicy,
} from '../retention';

const mockedDb = db as jest.Mocked<typeof db>;

describe('Data Retention', () => {
  beforeEach(() => {
    retention.reset();
    jest.clearAllMocks();
  });

  describe('policies', () => {
    it('loads default policies on initialization', () => {
      const policies = retention.getPolicies();
      expect(policies.length).toBe(DEFAULT_POLICIES.length);
    });

    it('gets a specific policy by id', () => {
      const policy = retention.getPolicy('assignments-completed');
      expect(policy).toBeDefined();
      expect(policy?.entityType).toBe('assignments');
      expect(policy?.action).toBe('archive');
    });

    it('returns undefined for unknown policy', () => {
      const policy = retention.getPolicy('non-existent');
      expect(policy).toBeUndefined();
    });

    it('sets a new policy', () => {
      const newPolicy: RetentionPolicy = {
        id: 'custom-policy',
        entityType: 'assignments',
        retentionDays: 30,
        action: 'delete',
        enabled: true,
        description: 'Custom policy',
      };

      retention.setPolicy(newPolicy);

      const policy = retention.getPolicy('custom-policy');
      expect(policy).toEqual(newPolicy);
    });

    it('updates an existing policy', () => {
      const updated: RetentionPolicy = {
        id: 'assignments-completed',
        entityType: 'assignments',
        retentionDays: 180, // Changed from 365
        action: 'delete', // Changed from archive
        enabled: true,
        description: 'Updated policy',
      };

      retention.setPolicy(updated);

      const policy = retention.getPolicy('assignments-completed');
      expect(policy?.retentionDays).toBe(180);
      expect(policy?.action).toBe('delete');
    });

    it('removes a policy', () => {
      const result = retention.removePolicy('assignments-completed');
      expect(result).toBe(true);
      expect(retention.getPolicy('assignments-completed')).toBeUndefined();
    });

    it('returns false when removing non-existent policy', () => {
      const result = retention.removePolicy('non-existent');
      expect(result).toBe(false);
    });

    it('enables/disables a policy', () => {
      const result = retention.setEnabled('assignments-completed', false);
      expect(result).toBe(true);

      const policy = retention.getPolicy('assignments-completed');
      expect(policy?.enabled).toBe(false);
    });

    it('returns false when enabling non-existent policy', () => {
      const result = retention.setEnabled('non-existent', true);
      expect(result).toBe(false);
    });
  });

  describe('getCutoffDate', () => {
    it('calculates correct cutoff date', () => {
      const policy = retention.getPolicy('assignments-completed')!;
      const cutoff = retention.getCutoffDate(policy);

      const expectedCutoff = new Date();
      expectedCutoff.setDate(expectedCutoff.getDate() - policy.retentionDays);

      // Allow 1 second tolerance for test execution time
      expect(Math.abs(cutoff.getTime() - expectedCutoff.getTime())).toBeLessThan(1000);
    });
  });

  describe('executePolicy', () => {
    describe('dry run', () => {
      it('counts records without modifying', async () => {
        mockedDb.assignment.count.mockResolvedValue(42);

        const policy = retention.getPolicy('assignments-completed')!;
        const result = await retention.executePolicy(policy, true);

        expect(result.recordsProcessed).toBe(42);
        expect(mockedDb.assignment.count).toHaveBeenCalled();
        expect(mockedDb.assignment.deleteMany).not.toHaveBeenCalled();
        expect(mockedDb.assignment.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('assignments', () => {
      it('deletes records with delete action', async () => {
        mockedDb.assignment.deleteMany.mockResolvedValue({ count: 10 });

        const policy: RetentionPolicy = {
          id: 'test-delete',
          entityType: 'assignments',
          retentionDays: 30,
          action: 'delete',
          enabled: true,
          description: 'Test delete',
        };

        const result = await retention.executePolicy(policy, false);

        expect(result.recordsProcessed).toBe(10);
        expect(mockedDb.assignment.deleteMany).toHaveBeenCalled();
      });

      it('marks records as EXPIRED with archive action', async () => {
        mockedDb.assignment.updateMany.mockResolvedValue({ count: 5 });

        const policy = retention.getPolicy('assignments-completed')!;
        const result = await retention.executePolicy(policy, false);

        expect(result.recordsProcessed).toBe(5);
        // Assignment model doesn't have deletedAt, so archive uses EXPIRED status
        expect(mockedDb.assignment.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'EXPIRED' }),
          })
        );
      });

      it('anonymizes records with anonymize action', async () => {
        mockedDb.assignment.updateMany.mockResolvedValue({ count: 3 });

        const policy: RetentionPolicy = {
          id: 'test-anonymize',
          entityType: 'assignments',
          retentionDays: 30,
          action: 'anonymize',
          enabled: true,
          description: 'Test anonymize',
        };

        const result = await retention.executePolicy(policy, false);

        expect(result.recordsProcessed).toBe(3);
        expect(mockedDb.assignment.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              prUrl: '[REDACTED]',
              prTitle: '[REDACTED]',
            }),
          })
        );
      });

      it('applies status condition', async () => {
        mockedDb.assignment.deleteMany.mockResolvedValue({ count: 2 });

        const policy: RetentionPolicy = {
          id: 'test-conditions',
          entityType: 'assignments',
          retentionDays: 30,
          action: 'delete',
          enabled: true,
          conditions: { status: 'EXPIRED' },
          description: 'Test conditions',
        };

        await retention.executePolicy(policy, false);

        expect(mockedDb.assignment.deleteMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ status: 'EXPIRED' }),
          })
        );
      });
    });

    describe('statistics', () => {
      it('deletes statistics records', async () => {
        mockedDb.statistics.deleteMany.mockResolvedValue({ count: 100 });

        const policy: RetentionPolicy = {
          id: 'test-stats-delete',
          entityType: 'statistics',
          retentionDays: 730,
          action: 'delete',
          enabled: true,
          description: 'Delete old stats',
        };

        const result = await retention.executePolicy(policy, false);

        expect(result.recordsProcessed).toBe(100);
        expect(mockedDb.statistics.deleteMany).toHaveBeenCalled();
      });

      it('anonymizes statistics records', async () => {
        mockedDb.statistics.updateMany.mockResolvedValue({ count: 50 });

        const policy = retention.getPolicy('statistics-detailed')!;
        const result = await retention.executePolicy(policy, false);

        expect(result.recordsProcessed).toBe(50);
        expect(mockedDb.statistics.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ userId: '[ANONYMIZED]' }),
          })
        );
      });
    });

    describe('audit logs', () => {
      it('archives audit logs (uses deleteMany - no soft delete field)', async () => {
        // AuditLog model doesn't have an archived field, so archive uses deleteMany
        mockedDb.auditLog.deleteMany.mockResolvedValue({ count: 200 });

        const policy = retention.getPolicy('audit-logs')!;
        const result = await retention.executePolicy(policy, false);

        expect(result.recordsProcessed).toBe(200);
        expect(mockedDb.auditLog.deleteMany).toHaveBeenCalled();
      });

      it('deletes audit logs', async () => {
        mockedDb.auditLog.deleteMany.mockResolvedValue({ count: 75 });

        const policy: RetentionPolicy = {
          id: 'test-audit-delete',
          entityType: 'auditLogs',
          retentionDays: 90,
          action: 'delete',
          enabled: true,
          description: 'Delete old audit logs',
        };

        const result = await retention.executePolicy(policy, false);

        expect(result.recordsProcessed).toBe(75);
        expect(mockedDb.auditLog.deleteMany).toHaveBeenCalled();
      });
    });

    it('captures errors', async () => {
      mockedDb.assignment.deleteMany.mockRejectedValue(new Error('Database error'));

      const policy: RetentionPolicy = {
        id: 'test-error',
        entityType: 'assignments',
        retentionDays: 30,
        action: 'delete',
        enabled: true,
        description: 'Test error handling',
      };

      const result = await retention.executePolicy(policy, false);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Database error');
    });
  });

  describe('executeAll', () => {
    it('executes all enabled policies', async () => {
      // Disable all but two policies for testing
      retention.setEnabled('assignments-abandoned', false);
      retention.setEnabled('statistics-detailed', false);
      retention.setEnabled('dead-letter-resolved', false);

      mockedDb.assignment.updateMany.mockResolvedValue({ count: 10 });
      mockedDb.auditLog.updateMany.mockResolvedValue({ count: 5 });

      const results = await retention.executeAll(false);

      expect(results).toHaveLength(2); // Only 2 enabled policies
    });

    it('supports dry run for all policies', async () => {
      mockedDb.assignment.count.mockResolvedValue(100);
      mockedDb.statistics.count.mockResolvedValue(50);
      mockedDb.auditLog.count.mockResolvedValue(25);

      // Disable dead letter policy (no db mock for it)
      retention.setEnabled('dead-letter-resolved', false);

      const results = await retention.executeAll(true);

      // Verify no mutations were called
      expect(mockedDb.assignment.deleteMany).not.toHaveBeenCalled();
      expect(mockedDb.assignment.updateMany).not.toHaveBeenCalled();
      expect(mockedDb.statistics.deleteMany).not.toHaveBeenCalled();
      expect(mockedDb.statistics.updateMany).not.toHaveBeenCalled();
      expect(mockedDb.auditLog.deleteMany).not.toHaveBeenCalled();
      expect(mockedDb.auditLog.updateMany).not.toHaveBeenCalled();

      // Should have results
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('stats and results', () => {
    it('updates stats after execution', async () => {
      mockedDb.assignment.updateMany.mockResolvedValue({ count: 10 });
      // AuditLog archive action now uses deleteMany (no soft delete field)
      mockedDb.auditLog.deleteMany.mockResolvedValue({ count: 5 });

      // Enable only assignment and audit policies
      retention.setEnabled('assignments-abandoned', false);
      retention.setEnabled('statistics-detailed', false);
      retention.setEnabled('dead-letter-resolved', false);

      await retention.executeAll(false);

      const stats = retention.getStats();
      expect(stats).toBeDefined();
      expect(stats?.lastRun).toBeInstanceOf(Date);
      expect(stats?.policiesExecuted).toBe(2);
      expect(stats?.totalRecordsProcessed).toBe(15);
    });

    it('returns recent results', async () => {
      mockedDb.assignment.count.mockResolvedValue(5);

      // Disable all but one
      for (const policy of DEFAULT_POLICIES) {
        retention.setEnabled(policy.id, policy.id === 'assignments-completed');
      }

      await retention.executeAll(true);

      const results = retention.getResults();
      expect(results).toHaveLength(1);
      expect(results[0].policy).toBe('assignments-completed');
    });
  });

  describe('reset', () => {
    it('restores default policies', () => {
      retention.removePolicy('assignments-completed');
      retention.setPolicy({
        id: 'custom',
        entityType: 'assignments',
        retentionDays: 1,
        action: 'delete',
        enabled: true,
        description: 'Custom',
      });

      retention.reset();

      const policies = retention.getPolicies();
      expect(policies.length).toBe(DEFAULT_POLICIES.length);
      expect(retention.getPolicy('custom')).toBeUndefined();
      expect(retention.getPolicy('assignments-completed')).toBeDefined();
    });
  });
});
