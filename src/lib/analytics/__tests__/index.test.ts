/**
 * Tests for Analytics Service
 */

// Mock dependencies before imports
jest.mock('@/lib/db', () => ({
  db: {
    assignment: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
    },
    statistics: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
    },
    skill: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    userAchievement: {
      findFirst: jest.fn(),
    },
    repositoryReviewer: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    repository: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import {
  calculatePercentile,
  calculateGiniCoefficient,
  getReviewMetrics,
  getResponseTimeAnalytics,
  getWorkloadDistribution,
  getTrendData,
  getAnalyticsDashboard,
  generateBottleneckReport,
  formatBottleneckReportForSlack,
  detectSlowResponders,
  detectOverloadedRepos,
  detectOverloadedUsers,
  detectSkillGapBottlenecks,
  generateUserGrowthReport,
  formatGrowthReportForSlack,
} from '../index';

const mockDb = db as jest.Mocked<typeof db>;

describe('Analytics Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculatePercentile', () => {
    it('returns 0 for empty array', () => {
      expect(calculatePercentile([], 50)).toBe(0);
    });

    it('returns single value for single element array', () => {
      expect(calculatePercentile([5], 50)).toBe(5);
    });

    it('calculates median correctly', () => {
      expect(calculatePercentile([1, 2, 3, 4, 5], 50)).toBe(3);
    });

    it('calculates p90 correctly', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const p90 = calculatePercentile(values, 90);
      expect(p90).toBeCloseTo(91, 0);
    });

    it('handles unsorted arrays', () => {
      expect(calculatePercentile([5, 1, 3, 4, 2], 50)).toBe(3);
    });
  });

  describe('calculateGiniCoefficient', () => {
    it('returns 0 for empty array', () => {
      expect(calculateGiniCoefficient([])).toBe(0);
    });

    it('returns 0 for single element', () => {
      expect(calculateGiniCoefficient([10])).toBe(0);
    });

    it('returns 0 for perfect equality', () => {
      const result = calculateGiniCoefficient([10, 10, 10, 10]);
      expect(result).toBeCloseTo(0, 1);
    });

    it('returns high value for inequality', () => {
      // One person does all the work
      const result = calculateGiniCoefficient([0, 0, 0, 100]);
      expect(result).toBeGreaterThan(0.5);
    });

    it('returns 0 when all values are 0', () => {
      expect(calculateGiniCoefficient([0, 0, 0])).toBe(0);
    });
  });

  describe('getReviewMetrics', () => {
    it('returns review metrics for date range', async () => {
      (mockDb.assignment.count as jest.Mock)
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(70)  // completed
        .mockResolvedValueOnce(20)  // pending
        .mockResolvedValueOnce(5)   // declined
        .mockResolvedValueOnce(5);  // reassigned

      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { assignedAt: new Date('2024-01-01T10:00:00'), completedAt: new Date('2024-01-01T11:00:00') },
        { assignedAt: new Date('2024-01-01T10:00:00'), completedAt: new Date('2024-01-01T12:00:00') },
      ]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      const result = await getReviewMetrics(start, end);

      expect(result.total).toBe(100);
      expect(result.completed).toBe(70);
      expect(result.pending).toBe(20);
      expect(result.completionRate).toBe(0.7);
      expect(result.avgTimeToCompletion).toBe(90); // (60 + 120) / 2
    });

    it('filters by repository when provided', async () => {
      (mockDb.assignment.count as jest.Mock).mockResolvedValue(10);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      await getReviewMetrics(start, end, 'repo-123');

      expect(mockDb.assignment.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            repositoryId: 'repo-123',
          }),
        })
      );
    });
  });

  describe('getResponseTimeAnalytics', () => {
    it('returns analytics with distribution buckets', async () => {
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T10:15:00') }, // 15 min
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T10:45:00') }, // 45 min
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T13:00:00') }, // 180 min
      ]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      const result = await getResponseTimeAnalytics(start, end);

      expect(result.avgMinutes).toBe(80); // (15 + 45 + 180) / 3
      expect(result.fastestMinutes).toBe(15);
      expect(result.slowestMinutes).toBe(180);
      expect(result.distribution).toHaveLength(6);
    });

    it('returns zero values for no data', async () => {
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      const result = await getResponseTimeAnalytics(start, end);

      expect(result.avgMinutes).toBe(0);
      expect(result.medianMinutes).toBe(0);
    });
  });

  describe('getWorkloadDistribution', () => {
    it('returns user and repository workloads', async () => {
      (mockDb.assignment.groupBy as jest.Mock)
        .mockResolvedValueOnce([
          { reviewerId: 'u1', _count: { id: 10 } },
          { reviewerId: 'u2', _count: { id: 5 } },
        ])
        .mockResolvedValueOnce([
          { repositoryId: 'r1', _count: { id: 8 } },
        ]);

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        displayName: 'User One',
      });

      (mockDb.assignment.count as jest.Mock).mockResolvedValue(5);
      (mockDb.statistics.findFirst as jest.Mock).mockResolvedValue({ avgResponseTime: 30 });
      (mockDb.repositoryReviewer.findFirst as jest.Mock).mockResolvedValue({ maxConcurrent: 5 });

      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue({
        id: 'r1',
        fullName: 'org/repo',
      });

      (mockDb.repositoryReviewer.count as jest.Mock).mockResolvedValue(3);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      const result = await getWorkloadDistribution(start, end);

      expect(result).toHaveProperty('byUser');
      expect(result).toHaveProperty('byRepository');
      expect(result).toHaveProperty('giniCoefficient');
      expect(result).toHaveProperty('topHeavyRatio');
    });
  });

  describe('getTrendData', () => {
    it('returns daily trend data', async () => {
      (mockDb.assignment.count as jest.Mock).mockResolvedValue(5);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T11:00:00') },
      ]);
      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([
        { reviewerId: 'u1' },
      ]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-03');
      const result = await getTrendData(start, end, 'day');

      expect(result.length).toBeGreaterThan(0);
      result.forEach(point => {
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('reviews');
        expect(point).toHaveProperty('avgResponseTime');
        expect(point).toHaveProperty('activeReviewers');
      });
    });
  });

  describe('getAnalyticsDashboard', () => {
    it('returns complete dashboard', async () => {
      // Mock all required calls
      (mockDb.assignment.count as jest.Mock).mockResolvedValue(10);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([]);
      (mockDb.skill.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getAnalyticsDashboard({ period: 'week' });

      expect(result).toHaveProperty('dateRange');
      expect(result).toHaveProperty('reviewMetrics');
      expect(result).toHaveProperty('responseTimeAnalytics');
      expect(result).toHaveProperty('workloadDistribution');
      expect(result).toHaveProperty('skillsAnalytics');
      expect(result).toHaveProperty('trendData');
    });
  });

  describe('detectSlowResponders', () => {
    it('identifies slow responders', async () => {
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([
        { userId: 'u1', avgResponseTime: 300, completed: 5, user: { displayName: 'Slow User', slackId: 'U1' } },
        { userId: 'u2', avgResponseTime: 60, completed: 10, user: { displayName: 'Fast User', slackId: 'U2' } },
        { userId: 'u3', avgResponseTime: 90, completed: 8, user: { displayName: 'Normal User', slackId: 'U3' } },
      ]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      const result = await detectSlowResponders(start, end);

      // Team average is (300+60+90)/3 = 150
      // Slow user at 300 is 2x average, should be flagged
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].displayName).toBe('Slow User');
    });

    it('returns empty for insufficient data', async () => {
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([
        { userId: 'u1', avgResponseTime: 60, completed: 5, user: { displayName: 'Only User', slackId: 'U1' } },
      ]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      const result = await detectSlowResponders(start, end);

      expect(result).toHaveLength(0);
    });
  });

  describe('detectOverloadedRepos', () => {
    it('identifies overloaded repositories', async () => {
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([
        { id: 'r1', fullName: 'org/overloaded', deletedAt: null, reviewers: [{ id: 'rr1' }] },
        { id: 'r2', fullName: 'org/healthy', deletedAt: null, reviewers: [{ id: 'rr2' }, { id: 'rr3' }] },
      ]);

      (mockDb.assignment.count as jest.Mock)
        .mockResolvedValueOnce(15) // r1 pending
        .mockResolvedValueOnce(2); // r2 pending

      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await detectOverloadedRepos();

      // r1 has 15 pending with 1 reviewer = 15 per reviewer (critical)
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].fullName).toBe('org/overloaded');
    });
  });

  describe('detectOverloadedUsers', () => {
    it('identifies overloaded users', async () => {
      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([
        { reviewerId: 'u1', _count: { id: 10 } },
      ]);

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        displayName: 'Busy User',
        slackId: 'U1',
      });

      (mockDb.repositoryReviewer.findFirst as jest.Mock).mockResolvedValue({
        maxConcurrent: 5,
      });

      (mockDb.statistics.findFirst as jest.Mock).mockResolvedValue({
        avgResponseTime: 60,
      });

      const result = await detectOverloadedUsers();

      // User has 10 pending with max 5 = 200% utilized (critical)
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].displayName).toBe('Busy User');
      expect(result[0].utilizationRate).toBe(2);
    });
  });

  describe('detectSkillGapBottlenecks', () => {
    it('identifies skill gaps', async () => {
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { skillsRequired: ['Rust'] },
        { skillsRequired: ['Rust'] },
        { skillsRequired: ['TypeScript', 'Rust'] },
      ]);

      (mockDb.skill.findMany as jest.Mock).mockResolvedValue([
        { name: 'TypeScript', users: [{ id: 'u1' }, { id: 'u2' }] },
        // No Rust skill defined - critical gap
      ]);

      const result = await detectSkillGapBottlenecks();

      // Rust has 3 requests with 0 reviewers - critical
      expect(result.length).toBeGreaterThan(0);
      const rustGap = result.find(g => g.skillName === 'Rust');
      expect(rustGap?.severity).toBe('critical');
    });
  });

  describe('generateBottleneckReport', () => {
    it('generates comprehensive report', async () => {
      // Mock all detection functions
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([]);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.skill.findMany as jest.Mock).mockResolvedValue([]);

      const result = await generateBottleneckReport('week');

      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('period');
      expect(result).toHaveProperty('slowResponders');
      expect(result).toHaveProperty('overloadedRepos');
      expect(result).toHaveProperty('overloadedUsers');
      expect(result).toHaveProperty('skillGapBottlenecks');
      expect(result).toHaveProperty('summary');
    });
  });

  describe('formatBottleneckReportForSlack', () => {
    it('formats report correctly', () => {
      const report = {
        generatedAt: new Date('2024-01-15'),
        period: { start: new Date('2024-01-08'), end: new Date('2024-01-15') },
        slowResponders: [{
          userId: 'u1',
          displayName: 'Slow User',
          slackId: 'U1',
          avgResponseTimeMinutes: 500,
          teamAvgResponseTimeMinutes: 100,
          responseTimeRatio: 5,
          reviewsCompleted: 3,
          severity: 'critical' as const,
          recommendation: 'Review workload',
        }],
        overloadedRepos: [],
        overloadedUsers: [],
        skillGapBottlenecks: [],
        summary: {
          totalBottlenecks: 1,
          criticalCount: 1,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          topRecommendations: ['Review workload'],
        },
      };

      const result = formatBottleneckReportForSlack(report);

      expect(result).toContain('Bottleneck Detection Report');
      expect(result).toContain('Summary');
      expect(result).toContain('Critical: *1*');
      expect(result).toContain('Slow Responders');
      expect(result).toContain('<@U1>');
    });

    it('shows success message when no bottlenecks', () => {
      const report = {
        generatedAt: new Date('2024-01-15'),
        period: { start: new Date('2024-01-08'), end: new Date('2024-01-15') },
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

      const result = formatBottleneckReportForSlack(report);

      expect(result).toContain('No bottlenecks detected');
    });
  });

  describe('generateUserGrowthReport', () => {
    it('generates growth report for user', async () => {
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        displayName: 'Test User',
        slackId: 'U1',
        createdAt: new Date('2023-01-01'),
        achievements: [{ id: 'ach1' }],
      });

      (mockDb.statistics.aggregate as jest.Mock).mockResolvedValue({
        _sum: { completed: 10, points: 200 },
        _avg: { avgResponseTime: 45 },
        _max: { streak: 5 },
      });

      (mockDb.assignment.findFirst as jest.Mock).mockResolvedValue({
        completedAt: new Date('2023-06-01'),
      });

      (mockDb.userAchievement.findFirst as jest.Mock).mockResolvedValue({
        earnedAt: new Date('2023-06-15'),
        achievement: { displayName: 'First Achievement' },
      });

      const result = await generateUserGrowthReport('u1');

      expect(result).not.toBeNull();
      expect(result?.userId).toBe('u1');
      expect(result?.displayName).toBe('Test User');
      expect(result).toHaveProperty('metrics');
      expect(result).toHaveProperty('trends');
      expect(result).toHaveProperty('milestones');
      expect(result).toHaveProperty('recommendations');
    });

    it('returns null for non-existent user', async () => {
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await generateUserGrowthReport('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('formatGrowthReportForSlack', () => {
    it('formats growth report correctly', () => {
      const report = {
        userId: 'u1',
        displayName: 'Test User',
        slackId: 'U1',
        period: { start: new Date('2024-01-08'), end: new Date('2024-01-15') },
        metrics: {
          reviewsCompleted: 10,
          avgResponseTimeMinutes: 45,
          pointsEarned: 200,
          streakDays: 5,
          achievementsUnlocked: 3,
          totalReviews: 100,
          totalPoints: 2000,
          totalAchievements: 10,
          memberSince: new Date('2023-01-01'),
        },
        trends: {
          reviewsWoW: { current: 10, previous: 8, change: 25, direction: 'up' as const, isPositive: true },
          responseTimeWoW: { current: 45, previous: 50, change: -10, direction: 'down' as const, isPositive: true },
          pointsWoW: { current: 200, previous: 150, change: 33, direction: 'up' as const, isPositive: true },
          reviewsMoM: { current: 40, previous: 35, change: 14, direction: 'up' as const, isPositive: true },
          responseTimeMoM: { current: 45, previous: 55, change: -18, direction: 'down' as const, isPositive: true },
          pointsMoM: { current: 800, previous: 700, change: 14, direction: 'up' as const, isPositive: true },
          weeklyReviews: [5, 6, 8, 7, 10, 12, 9, 10],
          weeklyResponseTime: [60, 55, 50, 48, 45, 42, 44, 45],
          weeklyPoints: [100, 120, 160, 140, 200, 240, 180, 200],
        },
        milestones: [
          { type: 'first_review' as const, description: 'First review', achievedAt: new Date('2023-06-01') },
        ],
        recommendations: ['Keep up the great work!'],
      };

      const result = formatGrowthReportForSlack(report);

      expect(result).toContain('Growth Report for Test User');
      expect(result).toContain('This Week');
      expect(result).toContain('Reviews: *10*');
      expect(result).toContain('All-Time Stats');
      expect(result).toContain('Total Reviews: *100*');
      expect(result).toContain('8-Week Review Trend');
      expect(result).toContain('Recent Milestones');
      expect(result).toContain('Tips');
    });
  });

  describe('getResponseTimeAnalytics - time buckets', () => {
    it('handles 4-8 hours response time bucket', async () => {
      // 300 minutes = 5 hours, should fall in 4-8 hours bucket
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T15:00:00') }, // 300 min
        { assignedAt: new Date('2024-01-01T08:00:00'), firstResponseAt: new Date('2024-01-01T14:00:00') }, // 360 min
      ]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      const result = await getResponseTimeAnalytics(start, end);

      const bucket4to8 = result.distribution.find(d => d.bucket === '4-8 hours');
      expect(bucket4to8).toBeDefined();
      expect(bucket4to8?.count).toBe(2);
    });

    it('handles >8 hours response time bucket', async () => {
      // 600 minutes = 10 hours, should fall in >8 hours bucket
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { assignedAt: new Date('2024-01-01T00:00:00'), firstResponseAt: new Date('2024-01-01T10:00:00') }, // 600 min
        { assignedAt: new Date('2024-01-01T06:00:00'), firstResponseAt: new Date('2024-01-02T00:00:00') }, // 1080 min
      ]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      const result = await getResponseTimeAnalytics(start, end);

      const bucket8plus = result.distribution.find(d => d.bucket === '> 8 hours');
      expect(bucket8plus).toBeDefined();
      expect(bucket8plus?.count).toBe(2);
    });

    it('distributes times across all buckets correctly', async () => {
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T10:15:00') }, // 15 min - < 30 min
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T10:45:00') }, // 45 min - 30-60 min
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T11:30:00') }, // 90 min - 1-2 hours
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T13:00:00') }, // 180 min - 2-4 hours
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-01T16:00:00') }, // 360 min - 4-8 hours
        { assignedAt: new Date('2024-01-01T10:00:00'), firstResponseAt: new Date('2024-01-02T06:00:00') }, // 1200 min - > 8 hours
      ]);

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-07');
      const result = await getResponseTimeAnalytics(start, end);

      expect(result.distribution).toHaveLength(6);
      expect(result.distribution.find(d => d.bucket === '< 30 min')?.count).toBe(1);
      expect(result.distribution.find(d => d.bucket === '30-60 min')?.count).toBe(1);
      expect(result.distribution.find(d => d.bucket === '1-2 hours')?.count).toBe(1);
      expect(result.distribution.find(d => d.bucket === '2-4 hours')?.count).toBe(1);
      expect(result.distribution.find(d => d.bucket === '4-8 hours')?.count).toBe(1);
      expect(result.distribution.find(d => d.bucket === '> 8 hours')?.count).toBe(1);
    });
  });

  describe('getAnalyticsDashboard - period types', () => {
    beforeEach(() => {
      // Common mocks for all period tests
      (mockDb.assignment.count as jest.Mock).mockResolvedValue(10);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([]);
      (mockDb.skill.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('uses day period correctly', async () => {
      const result = await getAnalyticsDashboard({ period: 'day' });

      expect(result.dateRange.start).toBeDefined();
      expect(result.dateRange.end).toBeDefined();
      // The date range should be approximately 1 day
      const diffMs = result.dateRange.end.getTime() - result.dateRange.start.getTime();
      const diffDays = diffMs / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeCloseTo(1, 0);
    });

    it('uses month period correctly', async () => {
      const result = await getAnalyticsDashboard({ period: 'month' });

      expect(result.dateRange.start).toBeDefined();
      expect(result.dateRange.end).toBeDefined();
      // The date range should be approximately 30 days
      const diffMs = result.dateRange.end.getTime() - result.dateRange.start.getTime();
      const diffDays = diffMs / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeGreaterThanOrEqual(28);
      expect(diffDays).toBeLessThanOrEqual(31);
    });

    it('uses quarter period correctly', async () => {
      const result = await getAnalyticsDashboard({ period: 'quarter' });

      expect(result.dateRange.start).toBeDefined();
      expect(result.dateRange.end).toBeDefined();
      // The date range should be approximately 90 days (3 months)
      const diffMs = result.dateRange.end.getTime() - result.dateRange.start.getTime();
      const diffDays = diffMs / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeGreaterThanOrEqual(89);
      expect(diffDays).toBeLessThanOrEqual(92);
    });

    it('uses year period correctly', async () => {
      const result = await getAnalyticsDashboard({ period: 'year' });

      expect(result.dateRange.start).toBeDefined();
      expect(result.dateRange.end).toBeDefined();
      // The date range should be approximately 365 days
      const diffMs = result.dateRange.end.getTime() - result.dateRange.start.getTime();
      const diffDays = diffMs / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeGreaterThanOrEqual(364);
      expect(diffDays).toBeLessThanOrEqual(366);
    });

    it('uses explicit startDate when provided', async () => {
      const customStart = new Date('2024-01-01');
      const result = await getAnalyticsDashboard({ period: 'week', startDate: customStart });

      // Should use the provided startDate
      expect(result.dateRange.start.getTime()).toBe(customStart.getTime());
    });
  });

  describe('detectSkillGapBottlenecks - severity levels', () => {
    it('identifies gaps with varying severity levels', async () => {
      // This test exercises the skill gap severity branching by requesting
      // skills with different coverage levels
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { skillsRequired: ['Critical'] },
        { skillsRequired: ['Critical'] },
        { skillsRequired: ['High'] },
        { skillsRequired: ['Medium'] },
        { skillsRequired: ['Low'] },
      ]);

      // Skills with varying coverage:
      // - Critical: not in list (0 reviewers)
      // - High: 1 reviewer for many requests
      // - Medium: some reviewers
      // - Low: adequate coverage
      (mockDb.skill.findMany as jest.Mock).mockResolvedValue([
        { name: 'High', users: [] }, // 0 reviewers = critical severity
        { name: 'Medium', users: [{ id: 'u1' }] }, // 1 reviewer, low ratio
        { name: 'Low', users: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] }, // 3 reviewers
      ]);

      const result = await detectSkillGapBottlenecks();

      // Should find gaps for skills without adequate coverage
      expect(result.length).toBeGreaterThan(0);

      // Critical should be found (skill not in database)
      const criticalGap = result.find(g => g.skillName === 'Critical');
      expect(criticalGap?.severity).toBe('critical');
    });

    it('classifies severity based on reviewer coverage ratio', async () => {
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { skillsRequired: ['NoReviewers'] },
      ]);

      (mockDb.skill.findMany as jest.Mock).mockResolvedValue([
        // NoReviewers not in list = critical
      ]);

      const result = await detectSkillGapBottlenecks();

      // Skills without any reviewers should be critical
      const gap = result.find(g => g.skillName === 'NoReviewers');
      expect(gap?.severity).toBe('critical');
    });

    it('does not flag skills with adequate coverage', async () => {
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([
        { skillsRequired: ['WellCovered'] },
        { skillsRequired: ['WellCovered'] },
      ]);

      (mockDb.skill.findMany as jest.Mock).mockResolvedValue([
        { name: 'WellCovered', users: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] }, // 3 reviewers for 2 requests = 0.67 ratio
      ]);

      const result = await detectSkillGapBottlenecks();

      // ratio < 3, so no gap should be flagged
      const wellCoveredGap = result.find(g => g.skillName === 'WellCovered');
      expect(wellCoveredGap).toBeUndefined();
    });
  });
});
