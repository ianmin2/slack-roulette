/**
 * Problem Detection Rule Evaluator Tests
 */

import { evaluateRulesForAssignment, runProblemDetection } from '../evaluator';
import { db } from '@/lib/db';
import { postMessage } from '@/lib/slack/client';

// Mock dependencies
jest.mock('@/lib/db', () => ({
  db: {
    assignment: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    problemRule: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    assignmentProblem: {
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/slack/client', () => ({
  postMessage: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('evaluator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('evaluateRulesForAssignment', () => {
    const baseAssignment = {
      id: 'assign-1',
      prUrl: 'https://github.com/org/repo/pull/1',
      prNumber: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      assignedAt: new Date('2026-01-01T00:00:00Z'),
      firstReviewActivityAt: null,
      rejectionCount: 0,
      reviewCycleCount: 0,
      reviewerChangeCount: 0,
      slackChannelId: 'C123',
      slackMessageTs: '123.456',
      repository: { fullName: 'org/repo', name: 'repo' },
      reviewer: { slackId: 'U123', displayName: 'Reviewer' },
      author: { slackId: 'U456', displayName: 'Author' },
    };

    describe('NO_ACTIVITY_FOR condition', () => {
      const rule = {
        id: 'rule-1',
        name: 'stalled',
        conditionType: 'NO_ACTIVITY_FOR' as const,
        conditionValue: 48, // hours
        severity: 'WARNING' as const,
        autoNotify: true,
        isActive: true,
      };

      it('should trigger when no activity for longer than threshold', async () => {
        // Assignment created 72 hours ago
        const assignment = {
          ...baseAssignment,
          createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          assignedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
        };

        const results = await evaluateRulesForAssignment(assignment as any, [rule as any]);

        expect(results[0].triggered).toBe(true);
      });

      it('should not trigger when activity is recent', async () => {
        // Assignment created 24 hours ago
        const assignment = {
          ...baseAssignment,
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          assignedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        };

        const results = await evaluateRulesForAssignment(assignment as any, [rule as any]);

        expect(results[0].triggered).toBe(false);
      });

      it('should use firstReviewActivityAt if available', async () => {
        // Created 72h ago but activity 12h ago
        const assignment = {
          ...baseAssignment,
          createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          firstReviewActivityAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        };

        const results = await evaluateRulesForAssignment(assignment as any, [rule as any]);

        expect(results[0].triggered).toBe(false);
      });
    });

    describe('REJECTION_COUNT_GTE condition', () => {
      const rule = {
        id: 'rule-2',
        name: 'multiple_rejections',
        conditionType: 'REJECTION_COUNT_GTE' as const,
        conditionValue: 3,
        severity: 'PROBLEM' as const,
        autoNotify: true,
        isActive: true,
      };

      it('should trigger when rejection count meets threshold', async () => {
        const assignment = { ...baseAssignment, rejectionCount: 3 };

        const results = await evaluateRulesForAssignment(assignment as any, [rule as any]);

        expect(results[0].triggered).toBe(true);
      });

      it('should not trigger when rejection count is below threshold', async () => {
        const assignment = { ...baseAssignment, rejectionCount: 2 };

        const results = await evaluateRulesForAssignment(assignment as any, [rule as any]);

        expect(results[0].triggered).toBe(false);
      });
    });

    describe('REVIEWER_CHANGES_GTE condition', () => {
      const rule = {
        id: 'rule-3',
        name: 'reviewer_churn',
        conditionType: 'REVIEWER_CHANGES_GTE' as const,
        conditionValue: 2,
        severity: 'WARNING' as const,
        autoNotify: false,
        isActive: true,
      };

      it('should trigger when reviewer changes meet threshold', async () => {
        const assignment = { ...baseAssignment, reviewerChangeCount: 2 };

        const results = await evaluateRulesForAssignment(assignment as any, [rule as any]);

        expect(results[0].triggered).toBe(true);
      });
    });

    describe('TOTAL_AGE_GTE condition', () => {
      const rule = {
        id: 'rule-4',
        name: 'ancient_pr',
        conditionType: 'TOTAL_AGE_GTE' as const,
        conditionValue: 168, // 7 days in hours
        severity: 'CRITICAL' as const,
        autoNotify: true,
        isActive: true,
      };

      it('should trigger when PR is older than threshold', async () => {
        const assignment = {
          ...baseAssignment,
          createdAt: new Date(Date.now() - 200 * 60 * 60 * 1000), // 200 hours ago
        };

        const results = await evaluateRulesForAssignment(assignment as any, [rule as any]);

        expect(results[0].triggered).toBe(true);
      });

      it('should not trigger when PR is younger than threshold', async () => {
        const assignment = {
          ...baseAssignment,
          createdAt: new Date(Date.now() - 100 * 60 * 60 * 1000), // 100 hours ago
        };

        const results = await evaluateRulesForAssignment(assignment as any, [rule as any]);

        expect(results[0].triggered).toBe(false);
      });
    });
  });

  describe('runProblemDetection', () => {
    it('should return early when no rules exist', async () => {
      (db.problemRule.findMany as jest.Mock).mockResolvedValue([]);

      const stats = await runProblemDetection();

      expect(stats).toEqual({ checked: 0, triggered: 0, resolved: 0, notified: 0 });
      expect(db.assignment.findMany).not.toHaveBeenCalled();
    });

    it('should check all open assignments against rules', async () => {
      const rules = [
        {
          id: 'rule-1',
          name: 'stalled',
          conditionType: 'NO_ACTIVITY_FOR',
          conditionValue: 48,
          severity: 'WARNING',
          autoNotify: true,
          isActive: true,
        },
      ];

      const assignments = [
        {
          id: 'assign-1',
          prUrl: 'https://github.com/org/repo/pull/1',
          prNumber: 1,
          createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          assignedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          firstReviewActivityAt: null,
          rejectionCount: 0,
          reviewCycleCount: 0,
          reviewerChangeCount: 0,
          problemSignals: [],
          slackChannelId: 'C123',
          slackMessageTs: '123.456',
          repository: { fullName: 'org/repo', name: 'repo' },
          reviewer: { slackId: 'U123', displayName: 'Reviewer' },
          author: { slackId: 'U456', displayName: 'Author' },
          problems: [],
        },
      ];

      (db.problemRule.findMany as jest.Mock).mockResolvedValue(rules);
      (db.assignment.findMany as jest.Mock).mockResolvedValue(assignments);
      (db.assignmentProblem.create as jest.Mock).mockResolvedValue({ id: 'problem-1' });

      const stats = await runProblemDetection();

      expect(stats.checked).toBe(1);
      expect(stats.triggered).toBe(1);
      expect(db.assignmentProblem.create).toHaveBeenCalled();
    });

    it('should notify when autoNotify is true', async () => {
      const rules = [
        {
          id: 'rule-1',
          name: 'stalled',
          conditionType: 'NO_ACTIVITY_FOR',
          conditionValue: 48,
          severity: 'WARNING',
          autoNotify: true,
          isActive: true,
        },
      ];

      const assignments = [
        {
          id: 'assign-1',
          prUrl: 'https://github.com/org/repo/pull/1',
          prNumber: 1,
          createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          assignedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          firstReviewActivityAt: null,
          rejectionCount: 0,
          reviewCycleCount: 0,
          reviewerChangeCount: 0,
          problemSignals: [],
          slackChannelId: 'C123',
          slackMessageTs: '123.456',
          repository: { fullName: 'org/repo', name: 'repo' },
          reviewer: { slackId: 'U123', displayName: 'Reviewer' },
          author: { slackId: 'U456', displayName: 'Author' },
          problems: [],
        },
      ];

      (db.problemRule.findMany as jest.Mock).mockResolvedValue(rules);
      (db.assignment.findMany as jest.Mock).mockResolvedValue(assignments);
      (db.assignmentProblem.create as jest.Mock).mockResolvedValue({ id: 'problem-1' });

      const stats = await runProblemDetection();

      expect(stats.notified).toBe(1);
      expect(postMessage).toHaveBeenCalledWith(
        'C123',
        expect.stringContaining('Problem Detected'),
        expect.any(Object)
      );
    });

    it('should not create duplicate problems', async () => {
      const rules = [
        {
          id: 'rule-1',
          name: 'stalled',
          conditionType: 'NO_ACTIVITY_FOR',
          conditionValue: 48,
          severity: 'WARNING',
          autoNotify: true,
          isActive: true,
        },
      ];

      const assignments = [
        {
          id: 'assign-1',
          prUrl: 'https://github.com/org/repo/pull/1',
          prNumber: 1,
          createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          assignedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          firstReviewActivityAt: null,
          rejectionCount: 0,
          reviewCycleCount: 0,
          reviewerChangeCount: 0,
          problemSignals: ['stalled'],
          slackChannelId: 'C123',
          slackMessageTs: '123.456',
          repository: { fullName: 'org/repo', name: 'repo' },
          reviewer: { slackId: 'U123', displayName: 'Reviewer' },
          author: { slackId: 'U456', displayName: 'Author' },
          problems: [{ id: 'problem-1', ruleId: 'rule-1', resolvedAt: null }], // Already has problem
        },
      ];

      (db.problemRule.findMany as jest.Mock).mockResolvedValue(rules);
      (db.assignment.findMany as jest.Mock).mockResolvedValue(assignments);

      const stats = await runProblemDetection();

      expect(stats.triggered).toBe(0); // Problem already exists
      expect(db.assignmentProblem.create).not.toHaveBeenCalled();
    });

    it('should resolve problems when condition no longer met', async () => {
      const rules = [
        {
          id: 'rule-1',
          name: 'stalled',
          conditionType: 'NO_ACTIVITY_FOR',
          conditionValue: 48,
          severity: 'WARNING',
          autoNotify: true,
          isActive: true,
        },
      ];

      const assignments = [
        {
          id: 'assign-1',
          prUrl: 'https://github.com/org/repo/pull/1',
          prNumber: 1,
          createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          assignedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
          firstReviewActivityAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // Activity 1h ago
          rejectionCount: 0,
          reviewCycleCount: 0,
          reviewerChangeCount: 0,
          problemSignals: ['stalled'],
          slackChannelId: 'C123',
          slackMessageTs: '123.456',
          repository: { fullName: 'org/repo', name: 'repo' },
          reviewer: { slackId: 'U123', displayName: 'Reviewer' },
          author: { slackId: 'U456', displayName: 'Author' },
          problems: [{ id: 'problem-1', ruleId: 'rule-1', resolvedAt: null }],
        },
      ];

      (db.problemRule.findMany as jest.Mock).mockResolvedValue(rules);
      (db.assignment.findMany as jest.Mock).mockResolvedValue(assignments);

      const stats = await runProblemDetection();

      expect(stats.resolved).toBe(1);
      expect(db.assignmentProblem.update).toHaveBeenCalledWith({
        where: { id: 'problem-1' },
        data: { resolvedAt: expect.any(Date) },
      });
    });
  });
});
