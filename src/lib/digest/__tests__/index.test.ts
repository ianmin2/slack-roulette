/**
 * Weekly Digest Service Tests
 */

import { formatDigestMessage, generateWeeklyDigest, sendWeeklyDigest } from '../index';
import type { WeeklyDigest } from '@/types';

// Mock dependencies
jest.mock('@/lib/db', () => ({
  db: {
    statistics: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    userAchievement: {
      findMany: jest.fn(),
    },
    challenge: {
      findMany: jest.fn(),
    },
    repository: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/slack/client', () => ({
  postMessage: jest.fn().mockResolvedValue({ ts: '123.456' }),
}));

jest.mock('@/lib/stats', () => ({
  getPeriodString: jest.fn(() => '2024-W05'),
  getLeaderboard: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/lib/utils/logger', () => ({
  loggers: {
    digest: {
      info: jest.fn(),
      error: jest.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import { postMessage } from '@/lib/slack/client';
import { getLeaderboard } from '@/lib/stats';

const mockDb = db as jest.Mocked<typeof db>;
const mockPostMessage = postMessage as jest.Mock;
const mockGetLeaderboard = getLeaderboard as jest.Mock;

describe('Weekly Digest', () => {
  // Sample digest data for testing formatDigestMessage
  const sampleDigest: WeeklyDigest = {
    period: {
      start: new Date('2024-01-29'),
      end: new Date('2024-02-04'),
      weekNumber: 5,
      year: 2024,
    },
    summary: {
      totalReviews: 42,
      totalAssignments: 50,
      avgResponseTimeMinutes: 45,
      completionRate: 0.84,
      activeReviewers: 8,
      newAchievementsUnlocked: 3,
    },
    topReviewers: [
      {
        userId: 'user1',
        displayName: 'Alice',
        slackId: 'U123',
        reviewsCompleted: 12,
        avgResponseTimeMinutes: 30,
        pointsEarned: 240,
        rank: 1,
        rankChange: 2,
      },
      {
        userId: 'user2',
        displayName: 'Bob',
        slackId: 'U456',
        reviewsCompleted: 10,
        avgResponseTimeMinutes: 45,
        pointsEarned: 200,
        rank: 2,
        rankChange: -1,
      },
    ],
    speedChampions: [
      {
        userId: 'user3',
        displayName: 'Charlie',
        slackId: 'U789',
        avgResponseTimeMinutes: 15,
        reviewsCompleted: 5,
        rank: 1,
      },
      {
        userId: 'user1',
        displayName: 'Alice',
        slackId: 'U123',
        avgResponseTimeMinutes: 30,
        reviewsCompleted: 12,
        rank: 2,
      },
    ],
    activeChallenges: [
      {
        id: 'challenge1',
        name: 'speed_week',
        displayName: 'Speed Week',
        type: 'FAST_REVIEWS',
        scope: 'INDIVIDUAL',
        target: 10,
        currentProgress: 7,
        percentComplete: 70,
        participantCount: 5,
        topContributor: {
          displayName: 'Alice',
          slackId: 'U123',
          progress: 3,
        },
        endsAt: new Date('2024-02-04'),
      },
      {
        id: 'challenge2',
        name: 'team_sprint',
        displayName: 'Team Sprint',
        type: 'TEAM_REVIEWS',
        scope: 'TEAM',
        target: 50,
        currentProgress: 35,
        percentComplete: 70,
        participantCount: 8,
        topContributor: {
          displayName: 'Bob',
          slackId: 'U456',
          progress: 10,
        },
        endsAt: new Date('2024-02-04'),
      },
    ],
    recentAchievements: [
      {
        userId: 'user1',
        displayName: 'Alice',
        slackId: 'U123',
        achievementName: 'first_review',
        achievementDisplayName: 'First Review',
        achievementIcon: '🎉',
        earnedAt: new Date('2024-01-30'),
      },
    ],
    repositoryStats: [
      {
        repositoryId: 'repo1',
        fullName: 'org/repo1',
        reviewsCompleted: 20,
        avgResponseTimeMinutes: 40,
        topReviewer: {
          displayName: 'Alice',
          reviewCount: 8,
        },
      },
    ],
    trends: {
      reviewsVsLastWeek: 15,
      responseTimeVsLastWeek: -10,
      activeReviewersVsLastWeek: 5,
    },
  };

  describe('formatDigestMessage', () => {
    it('should format digest header with week number', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Weekly Digest - Week 5, 2024*');
    });

    it('should include summary section', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Summary*');
      expect(message).toContain('*Reviews Completed:* 42');
      expect(message).toContain('*Assignments:* 50');
      expect(message).toContain('*Completion Rate:* 84%');
      expect(message).toContain('*Active Reviewers:* 8');
    });

    it('should format average response time correctly', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Avg Response Time:* 45min');
    });

    it('should include achievements unlocked count', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Achievements Unlocked:* 3');
    });

    it('should include trends section', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Trends vs Last Week*');
      expect(message).toContain('Reviews:');
      expect(message).toContain('Response Time:');
      expect(message).toContain('Active Reviewers:');
    });

    it('should show positive trend with arrow up', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toMatch(/Reviews:.*\+15%.*:arrow_up:/);
    });

    it('should show response time improvement as positive', () => {
      const message = formatDigestMessage(sampleDigest);
      // -10% response time is good, should show as improvement
      expect(message).toMatch(/Response Time:.*10%.*:arrow_up:/);
    });

    it('should include top reviewers with medals', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Top Reviewers*');
      expect(message).toContain(':first_place_medal:');
      expect(message).toContain('<@U123>');
      expect(message).toContain('*12* reviews');
    });

    it('should show rank changes for reviewers', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain(':arrow_up: 2'); // Alice moved up 2
      expect(message).toContain(':arrow_down: 1'); // Bob moved down 1
    });

    it('should include speed champions section', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Speed Champions*');
      expect(message).toContain('_Fastest responders this week');
      expect(message).toContain(':racing_car:');
      expect(message).toContain('<@U789>'); // Charlie is fastest
      expect(message).toContain('*15min*');
    });

    it('should include active challenges section', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Active Challenges*');
      expect(message).toContain('*Speed Week*');
      expect(message).toContain('*Team Sprint*');
    });

    it('should show challenge progress bars', () => {
      const message = formatDigestMessage(sampleDigest);
      // 70% = 7 filled blocks
      expect(message).toMatch(/\[█{7}░{3}\]/);
    });

    it('should show scope icons for challenges', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain(':bust_in_silhouette:'); // Individual
      expect(message).toContain(':busts_in_silhouette:'); // Team
    });

    it('should show top contributor for team challenges', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('Top contributor:');
      expect(message).toContain('<@U456>'); // Bob for team challenge
    });

    it('should include repository stats section', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Repository Activity*');
      expect(message).toContain('*org/repo1*');
      expect(message).toContain('20 reviews');
    });

    it('should include recent achievements section', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('*Recent Achievements*');
      expect(message).toContain('🎉');
      expect(message).toContain('<@U123>');
      expect(message).toContain('*First Review*');
    });

    it('should include footer', () => {
      const message = formatDigestMessage(sampleDigest);
      expect(message).toContain('---');
      expect(message).toContain('_Keep up the great work!');
    });

    it('should omit achievements section when no new achievements', () => {
      const digestNoAchievements = {
        ...sampleDigest,
        summary: { ...sampleDigest.summary, newAchievementsUnlocked: 0 },
        recentAchievements: [],
      };
      const message = formatDigestMessage(digestNoAchievements);
      expect(message).not.toContain('*Recent Achievements*');
    });

    it('should omit speed champions section when none qualify', () => {
      const digestNoSpeedChamps = {
        ...sampleDigest,
        speedChampions: [],
      };
      const message = formatDigestMessage(digestNoSpeedChamps);
      expect(message).not.toContain('*Speed Champions*');
    });

    it('should omit challenges section when none active', () => {
      const digestNoChallenges = {
        ...sampleDigest,
        activeChallenges: [],
      };
      const message = formatDigestMessage(digestNoChallenges);
      expect(message).not.toContain('*Active Challenges*');
    });

    it('should format hours correctly for long response times', () => {
      const digestLongTime = {
        ...sampleDigest,
        summary: { ...sampleDigest.summary, avgResponseTimeMinutes: 150 },
      };
      const message = formatDigestMessage(digestLongTime);
      expect(message).toContain('2h 30m');
    });
  });

  describe('generateWeeklyDigest', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('generates complete digest with all sections', async () => {
      // Mock current stats
      (mockDb.statistics.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { completed: 50, assigned: 60, points: 500 },
          _avg: { avgResponseTime: 45 },
          _count: { userId: 10 },
        })
        .mockResolvedValueOnce({
          _sum: { completed: 40, assigned: 55 },
          _avg: { avgResponseTime: 50 },
          _count: { userId: 8 },
        });

      // Mock active reviewers
      (mockDb.statistics.groupBy as jest.Mock)
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }])
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([]); // repo stats groupBy

      // Mock achievements
      (mockDb.userAchievement.findMany as jest.Mock).mockResolvedValue([]);

      // Mock leaderboard
      mockGetLeaderboard.mockResolvedValue([
        {
          userId: 'user-1',
          user: { displayName: 'Top User', slackId: 'U123' },
          completed: 20,
          avgResponseTime: 30,
          points: 200,
        },
      ]);

      // Mock previous leaderboard and speed champions
      (mockDb.statistics.findMany as jest.Mock)
        .mockResolvedValueOnce([
          { userId: 'user-1', user: { displayName: 'Top User' } },
        ])
        .mockResolvedValueOnce([]); // speed champions

      // Mock challenges
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([]);

      // Mock repository stats
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]);

      const digest = await generateWeeklyDigest();

      expect(digest).toHaveProperty('period');
      expect(digest).toHaveProperty('summary');
      expect(digest).toHaveProperty('topReviewers');
      expect(digest).toHaveProperty('trends');
      expect(digest.summary.totalReviews).toBe(50);
      expect(digest.summary.activeReviewers).toBe(2);
    });

    it('calculates trends correctly', async () => {
      // Current week: 60 reviews
      (mockDb.statistics.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { completed: 60, assigned: 70, points: 600 },
          _avg: { avgResponseTime: 40 },
          _count: { userId: 12 },
        })
        // Previous week: 50 reviews
        .mockResolvedValueOnce({
          _sum: { completed: 50, assigned: 60 },
          _avg: { avgResponseTime: 50 },
          _count: { userId: 10 },
        });

      (mockDb.statistics.groupBy as jest.Mock)
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }])
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }])
        .mockResolvedValueOnce([]);

      (mockDb.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
      mockGetLeaderboard.mockResolvedValue([]);
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]);

      const digest = await generateWeeklyDigest();

      // 60 vs 50 = +20%
      expect(digest.trends.reviewsVsLastWeek).toBe(20);
      // 40 vs 50 = -20%
      expect(digest.trends.responseTimeVsLastWeek).toBe(-20);
      // 3 vs 2 = +50%
      expect(digest.trends.activeReviewersVsLastWeek).toBe(50);
    });

    it('handles zero previous values in trend calculation', async () => {
      (mockDb.statistics.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { completed: 10, assigned: 12, points: 100 },
          _avg: { avgResponseTime: 30 },
          _count: { userId: 5 },
        })
        .mockResolvedValueOnce({
          _sum: { completed: 0, assigned: 0 },
          _avg: { avgResponseTime: 0 },
          _count: { userId: 0 },
        });

      (mockDb.statistics.groupBy as jest.Mock)
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      (mockDb.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
      mockGetLeaderboard.mockResolvedValue([]);
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]);

      const digest = await generateWeeklyDigest();

      // 10 vs 0 = +100%
      expect(digest.trends.reviewsVsLastWeek).toBe(100);
    });

    it('filters by repository when provided', async () => {
      (mockDb.statistics.aggregate as jest.Mock).mockResolvedValue({
        _sum: { completed: 10, assigned: 12, points: 100 },
        _avg: { avgResponseTime: 30 },
        _count: { userId: 3 },
      });
      (mockDb.statistics.groupBy as jest.Mock).mockResolvedValue([]);
      (mockDb.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
      mockGetLeaderboard.mockResolvedValue([]);
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]);

      await generateWeeklyDigest('repo-123');

      expect(mockDb.statistics.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            repositoryId: 'repo-123',
          }),
        })
      );
    });
  });

  describe('sendWeeklyDigest', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('sends formatted message to channel', async () => {
      mockPostMessage.mockResolvedValue({ ts: '123.456' });

      await sendWeeklyDigest('C123', sampleDigest);

      expect(mockPostMessage).toHaveBeenCalledWith(
        'C123',
        expect.stringContaining('Weekly Digest'),
        { unfurl_links: false }
      );
    });

    it('throws error when post fails', async () => {
      mockPostMessage.mockResolvedValue(null);

      await expect(sendWeeklyDigest('C123', sampleDigest))
        .rejects.toThrow('Failed to send weekly digest');
    });
  });

  describe('generateWeeklyDigest - challenge scopes', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Base mocks for all tests
      (mockDb.statistics.aggregate as jest.Mock).mockResolvedValue({
        _sum: { completed: 20, assigned: 25, points: 200 },
        _avg: { avgResponseTime: 45 },
        _count: { userId: 5 },
      });
      (mockDb.statistics.groupBy as jest.Mock).mockResolvedValue([]);
      (mockDb.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
      mockGetLeaderboard.mockResolvedValue([]);
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('handles TEAM scope challenge with total progress', async () => {
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ch-1',
          name: 'team_challenge',
          displayName: 'Team Challenge',
          type: 'TEAM_REVIEWS',
          scope: 'TEAM',
          target: 100,
          endDate: new Date('2024-12-31'),
          progress: [
            { userId: 'u1', currentValue: 20 },
            { userId: 'u2', currentValue: 30 },
            { userId: 'u3', currentValue: 15 },
          ],
        },
      ]);
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Top Contributor',
        slackId: 'U456',
      });

      const digest = await generateWeeklyDigest();

      // Team scope uses total progress (20 + 30 + 15 = 65)
      expect(digest.activeChallenges).toHaveLength(1);
      expect(digest.activeChallenges[0].currentProgress).toBe(65);
      expect(digest.activeChallenges[0].participantCount).toBe(3);
      expect(digest.activeChallenges[0].topContributor?.displayName).toBe('Top Contributor');
    });

    it('handles INDIVIDUAL scope challenge with average progress', async () => {
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ch-2',
          name: 'individual_challenge',
          displayName: 'Individual Challenge',
          type: 'FAST_REVIEWS',
          scope: 'INDIVIDUAL',
          target: 10,
          endDate: new Date('2024-12-31'),
          progress: [
            { userId: 'u1', currentValue: 8 },
            { userId: 'u2', currentValue: 4 },
          ],
        },
      ]);
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue({
        displayName: 'Individual Leader',
        slackId: 'U789',
      });

      const digest = await generateWeeklyDigest();

      // Individual scope uses average progress (8 + 4) / 2 = 6
      expect(digest.activeChallenges).toHaveLength(1);
      expect(digest.activeChallenges[0].currentProgress).toBe(6);
      expect(digest.activeChallenges[0].participantCount).toBe(2);
    });

    it('handles challenge with zero participants', async () => {
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ch-3',
          name: 'no_progress',
          displayName: 'No Progress',
          type: 'REVIEWS',
          scope: 'INDIVIDUAL',
          target: 10,
          endDate: new Date('2024-12-31'),
          progress: [
            { userId: 'u1', currentValue: 0 },
            { userId: 'u2', currentValue: 0 },
          ],
        },
      ]);

      const digest = await generateWeeklyDigest();

      // No participants with progress > 0
      expect(digest.activeChallenges[0].currentProgress).toBe(0);
      expect(digest.activeChallenges[0].participantCount).toBe(0);
    });

    it('handles challenge with no top contributor (null userId)', async () => {
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ch-4',
          name: 'null_user',
          displayName: 'Null User Challenge',
          type: 'REVIEWS',
          scope: 'TEAM',
          target: 50,
          endDate: new Date('2024-12-31'),
          progress: [
            { userId: null, currentValue: 10 }, // No user ID
          ],
        },
      ]);

      const digest = await generateWeeklyDigest();

      expect(digest.activeChallenges[0].topContributor).toBeNull();
    });

    it('handles top contributor user not found', async () => {
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ch-5',
          name: 'missing_user',
          displayName: 'Missing User',
          type: 'REVIEWS',
          scope: 'TEAM',
          target: 50,
          endDate: new Date('2024-12-31'),
          progress: [
            { userId: 'deleted-user', currentValue: 25 },
          ],
        },
      ]);
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(null); // User not found

      const digest = await generateWeeklyDigest();

      expect(digest.activeChallenges[0].topContributor).toBeNull();
    });
  });

  describe('generateWeeklyDigest - repository stats', () => {
    it('includes repository stats when not filtering by repository', async () => {
      jest.clearAllMocks();

      // Stats aggregate for current and previous periods
      (mockDb.statistics.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { completed: 20, assigned: 25, points: 200 },
          _avg: { avgResponseTime: 45 },
          _count: { userId: 5 },
        })
        .mockResolvedValueOnce({
          _sum: { completed: 15, assigned: 20 },
          _avg: { avgResponseTime: 50 },
          _count: { userId: 4 },
        });

      // GroupBy calls: 1) active reviewers current, 2) active reviewers previous, 3) repo stats
      (mockDb.statistics.groupBy as jest.Mock)
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([
          { repositoryId: 'repo-1', _sum: { completed: 15 }, _avg: { avgResponseTime: 30 } },
          { repositoryId: 'repo-2', _sum: { completed: 10 }, _avg: { avgResponseTime: 45 } },
        ]);

      (mockDb.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
      mockGetLeaderboard.mockResolvedValue([]);
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([]);

      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([
        { id: 'repo-1', fullName: 'org/repo-one' },
        { id: 'repo-2', fullName: 'org/repo-two' },
      ]);

      // Top reviewer per repo
      (mockDb.statistics.findFirst as jest.Mock)
        .mockResolvedValueOnce({
          user: { displayName: 'Top for Repo 1' },
          completed: 8,
        })
        .mockResolvedValueOnce({
          user: { displayName: 'Top for Repo 2' },
          completed: 5,
        });

      const digest = await generateWeeklyDigest();

      expect(digest.repositoryStats.length).toBeGreaterThanOrEqual(1);
    });

    it('skips repos with null repositoryId in stats', async () => {
      jest.clearAllMocks();

      (mockDb.statistics.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { completed: 20, assigned: 25, points: 200 },
          _avg: { avgResponseTime: 45 },
        })
        .mockResolvedValueOnce({
          _sum: { completed: 15, assigned: 20 },
          _avg: { avgResponseTime: 50 },
        });

      (mockDb.statistics.groupBy as jest.Mock)
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([
          { repositoryId: null, _sum: { completed: 5 }, _avg: { avgResponseTime: 20 } },
          { repositoryId: 'repo-1', _sum: { completed: 10 }, _avg: { avgResponseTime: 30 } },
        ]);

      (mockDb.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
      mockGetLeaderboard.mockResolvedValue([]);
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([]);

      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([
        { id: 'repo-1', fullName: 'org/repo-one' },
      ]);

      (mockDb.statistics.findFirst as jest.Mock).mockResolvedValue({
        user: { displayName: 'Reviewer' },
        completed: 5,
      });

      const digest = await generateWeeklyDigest();

      // The null repositoryId entry should be filtered out in repoIds
      expect(digest.repositoryStats.length).toBeLessThanOrEqual(1);
    });

    it('handles repo not found in map', async () => {
      jest.clearAllMocks();

      (mockDb.statistics.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { completed: 20, assigned: 25, points: 200 },
          _avg: { avgResponseTime: 45 },
        })
        .mockResolvedValueOnce({
          _sum: { completed: 15, assigned: 20 },
          _avg: { avgResponseTime: 50 },
        });

      (mockDb.statistics.groupBy as jest.Mock)
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([
          { repositoryId: 'deleted-repo', _sum: { completed: 5 }, _avg: { avgResponseTime: 20 } },
        ]);

      (mockDb.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
      mockGetLeaderboard.mockResolvedValue([]);
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([]);

      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]); // No repos found

      const digest = await generateWeeklyDigest();

      // Should skip the repo since it's not found in map
      expect(digest.repositoryStats).toHaveLength(0);
    });

    it('handles top reviewer being null', async () => {
      jest.clearAllMocks();

      (mockDb.statistics.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { completed: 20, assigned: 25, points: 200 },
          _avg: { avgResponseTime: 45 },
        })
        .mockResolvedValueOnce({
          _sum: { completed: 15, assigned: 20 },
          _avg: { avgResponseTime: 50 },
        });

      (mockDb.statistics.groupBy as jest.Mock)
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([{ userId: 'u1' }])
        .mockResolvedValueOnce([
          { repositoryId: 'repo-1', _sum: { completed: 10 }, _avg: { avgResponseTime: 30 } },
        ]);

      (mockDb.userAchievement.findMany as jest.Mock).mockResolvedValue([]);
      mockGetLeaderboard.mockResolvedValue([]);
      (mockDb.statistics.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([]);

      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([
        { id: 'repo-1', fullName: 'org/repo-one' },
      ]);

      (mockDb.statistics.findFirst as jest.Mock).mockResolvedValue(null); // No top reviewer

      const digest = await generateWeeklyDigest();

      expect(digest.repositoryStats.length).toBe(1);
      expect(digest.repositoryStats[0].topReviewer).toBeNull();
    });
  });
});
