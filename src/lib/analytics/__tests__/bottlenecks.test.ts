/**
 * Bottleneck Detection Tests
 */

import {
  calculatePercentile,
  calculateGiniCoefficient,
} from '../index';

// Mock the database
jest.mock('@/lib/db', () => ({
  db: {
    statistics: {
      findMany: jest.fn(),
    },
    repository: {
      findMany: jest.fn(),
    },
    assignment: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    repositoryReviewer: {
      findFirst: jest.fn(),
    },
    skill: {
      findMany: jest.fn(),
    },
  },
}));

describe('Analytics Helpers', () => {
  describe('calculatePercentile', () => {
    it('should return 0 for empty array', () => {
      expect(calculatePercentile([], 50)).toBe(0);
    });

    it('should return the only value for single-element array', () => {
      expect(calculatePercentile([42], 50)).toBe(42);
    });

    it('should calculate median correctly for odd-length array', () => {
      expect(calculatePercentile([1, 2, 3, 4, 5], 50)).toBe(3);
    });

    it('should calculate median correctly for even-length array', () => {
      expect(calculatePercentile([1, 2, 3, 4], 50)).toBe(2.5);
    });

    it('should calculate 90th percentile', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      // P90 should be around 91 (linear interpolation)
      const p90 = calculatePercentile(values, 90);
      expect(p90).toBeGreaterThanOrEqual(90);
      expect(p90).toBeLessThanOrEqual(100);
    });

    it('should calculate 99th percentile', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const p99 = calculatePercentile(values, 99);
      expect(p99).toBeGreaterThanOrEqual(99);
    });

    it('should sort unsorted arrays before calculation', () => {
      const values = [5, 1, 3, 2, 4];
      expect(calculatePercentile(values, 50)).toBe(3);
    });
  });

  describe('calculateGiniCoefficient', () => {
    it('should return 0 for empty array', () => {
      expect(calculateGiniCoefficient([])).toBe(0);
    });

    it('should return 0 for single-element array', () => {
      expect(calculateGiniCoefficient([100])).toBe(0);
    });

    it('should return 0 for perfect equality', () => {
      // All values equal = perfect equality
      const gini = calculateGiniCoefficient([10, 10, 10, 10]);
      expect(gini).toBe(0);
    });

    it('should return close to 1 for high inequality', () => {
      // One person has everything = high inequality
      const gini = calculateGiniCoefficient([0, 0, 0, 100]);
      expect(gini).toBeGreaterThan(0.5);
    });

    it('should calculate moderate inequality', () => {
      // Some variation but not extreme
      const gini = calculateGiniCoefficient([10, 20, 30, 40]);
      expect(gini).toBeGreaterThan(0);
      expect(gini).toBeLessThan(0.5);
    });

    it('should return 0 when all values are 0', () => {
      expect(calculateGiniCoefficient([0, 0, 0, 0])).toBe(0);
    });

    it('should handle real-world workload distribution', () => {
      // Typical workload: some reviewers do more than others
      const workloads = [2, 5, 8, 10, 15, 20];
      const gini = calculateGiniCoefficient(workloads);
      expect(gini).toBeGreaterThan(0.1);
      expect(gini).toBeLessThan(0.5);
    });
  });
});

import { formatBottleneckReportForSlack } from '../index';

describe('Bottleneck Report Formatting', () => {

  const emptyReport = {
    generatedAt: new Date('2024-02-01'),
    period: {
      start: new Date('2024-01-25'),
      end: new Date('2024-02-01'),
    },
    slowResponders: [],
    overloadedRepos: [],
    overloadedUsers: [],
    skillGapBottlenecks: [],
    summary: {
      totalBottlenecks: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      topRecommendations: [],
    },
  };

  it('should format empty report with no bottlenecks message', () => {
    const message = formatBottleneckReportForSlack(emptyReport);
    expect(message).toContain('*Bottleneck Detection Report*');
    expect(message).toContain('No bottlenecks detected');
  });

  it('should include slow responders section when present', () => {
    const report = {
      ...emptyReport,
      slowResponders: [
        {
          userId: 'user1',
          displayName: 'Slow Joe',
          slackId: 'U123',
          avgResponseTimeMinutes: 480,
          teamAvgResponseTimeMinutes: 120,
          responseTimeRatio: 4.0,
          reviewsCompleted: 5,
          severity: 'high' as const,
          recommendation: 'Review workload',
        },
      ],
      summary: { ...emptyReport.summary, totalBottlenecks: 1, highCount: 1 },
    };

    const message = formatBottleneckReportForSlack(report);
    expect(message).toContain('*Slow Responders*');
    expect(message).toContain('<@U123>');
    expect(message).toContain('480min');
    expect(message).toContain('4x team avg');
  });

  it('should include overloaded repos section when present', () => {
    const report = {
      ...emptyReport,
      overloadedRepos: [
        {
          repositoryId: 'repo1',
          fullName: 'org/busy-repo',
          pendingReviews: 15,
          avgResponseTimeMinutes: 200,
          reviewerCount: 2,
          reviewsPerReviewer: 7.5,
          severity: 'high' as const,
          recommendation: 'Add more reviewers',
        },
      ],
      summary: { ...emptyReport.summary, totalBottlenecks: 1, highCount: 1 },
    };

    const message = formatBottleneckReportForSlack(report);
    expect(message).toContain('*Overloaded Repositories*');
    expect(message).toContain('*org/busy-repo*');
    expect(message).toContain('15 pending');
    expect(message).toContain('7.5/reviewer');
  });

  it('should include overloaded users section when present', () => {
    const report = {
      ...emptyReport,
      overloadedUsers: [
        {
          userId: 'user2',
          displayName: 'Busy Bob',
          slackId: 'U456',
          pendingReviews: 5,
          maxConcurrent: 5,
          utilizationRate: 1.0,
          avgResponseTimeMinutes: 180,
          severity: 'critical' as const,
          recommendation: 'Redistribute assignments',
        },
      ],
      summary: { ...emptyReport.summary, totalBottlenecks: 1, criticalCount: 1 },
    };

    const message = formatBottleneckReportForSlack(report);
    expect(message).toContain('*Overloaded Users*');
    expect(message).toContain('<@U456>');
    expect(message).toContain('100% utilized');
    expect(message).toContain('5/5');
  });

  it('should include skill gaps section when present', () => {
    const report = {
      ...emptyReport,
      skillGapBottlenecks: [
        {
          skillName: 'kubernetes',
          requestCount: 10,
          reviewerCount: 0,
          pendingWithSkill: 5,
          severity: 'critical' as const,
          recommendation: 'Train reviewers in kubernetes',
        },
      ],
      summary: { ...emptyReport.summary, totalBottlenecks: 1, criticalCount: 1 },
    };

    const message = formatBottleneckReportForSlack(report);
    expect(message).toContain('*Skill Gaps*');
    expect(message).toContain('*kubernetes*');
    expect(message).toContain('5 pending');
    expect(message).toContain('0 reviewers');
  });

  it('should include top recommendations', () => {
    const report = {
      ...emptyReport,
      summary: {
        ...emptyReport.summary,
        totalBottlenecks: 2,
        topRecommendations: [
          'Add more reviewers to busy-repo',
          'Train team on kubernetes',
        ],
      },
    };

    const message = formatBottleneckReportForSlack(report);
    expect(message).toContain('*Top Recommendations*');
    expect(message).toContain('Add more reviewers');
    expect(message).toContain('Train team on kubernetes');
  });

  it('should show severity counts in summary', () => {
    const report = {
      ...emptyReport,
      summary: {
        totalBottlenecks: 5,
        criticalCount: 1,
        highCount: 2,
        mediumCount: 1,
        lowCount: 1,
        topRecommendations: [],
      },
    };

    const message = formatBottleneckReportForSlack(report);
    expect(message).toContain('Total issues: *5*');
    expect(message).toContain('Critical: *1*');
    expect(message).toContain('High: *2*');
    expect(message).toContain('Medium: *1*');
    expect(message).toContain('Low: *1*');
  });

  it('should use correct severity icons', () => {
    const report = {
      ...emptyReport,
      slowResponders: [
        {
          userId: 'user1',
          displayName: 'User 1',
          slackId: 'U1',
          avgResponseTimeMinutes: 600,
          teamAvgResponseTimeMinutes: 100,
          responseTimeRatio: 6.0,
          reviewsCompleted: 3,
          severity: 'critical' as const,
          recommendation: 'Fix urgently',
        },
        {
          userId: 'user2',
          displayName: 'User 2',
          slackId: 'U2',
          avgResponseTimeMinutes: 300,
          teamAvgResponseTimeMinutes: 100,
          responseTimeRatio: 3.0,
          reviewsCompleted: 4,
          severity: 'high' as const,
          recommendation: 'Review workload',
        },
      ],
      summary: { ...emptyReport.summary, totalBottlenecks: 2, criticalCount: 1, highCount: 1 },
    };

    const message = formatBottleneckReportForSlack(report);
    expect(message).toContain(':rotating_light:'); // Critical
    expect(message).toContain(':red_circle:'); // High
  });
});
