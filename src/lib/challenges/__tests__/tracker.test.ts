/**
 * Tests for Challenge Tracker Service
 */

// Mock dependencies
jest.mock('@/lib/db', () => ({
  db: {
    challenge: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    challengeProgress: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    assignment: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    statistics: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/slack/client', () => ({
  postMessage: jest.fn(),
}));

jest.mock('../definitions', () => ({
  getWeekChallenges: jest.fn().mockReturnValue({
    individual: {
      name: 'weekly_reviews',
      displayName: 'Weekly Warrior',
      description: 'Complete 5 reviews this week',
      type: 'REVIEWS_COMPLETED',
      scope: 'INDIVIDUAL',
      target: 5,
      rewardType: 'POINTS',
      rewardValue: 50,
      difficulty: 'easy',
    },
    team: {
      name: 'team_reviews',
      displayName: 'Team Effort',
      description: 'Team completes 20 reviews',
      type: 'TEAM_REVIEWS',
      scope: 'TEAM',
      target: 20,
      rewardType: 'POINTS',
      rewardValue: 100,
      difficulty: 'medium',
    },
  }),
  getWeekInfo: jest.fn().mockReturnValue({
    weekNumber: 1,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-01-07'),
  }),
  getDifficultyEmoji: jest.fn().mockReturnValue('⭐'),
  getScopeIcon: jest.fn().mockReturnValue('👤'),
  CHALLENGE_PRESETS: [
    {
      name: 'weekly_reviews',
      displayName: 'Weekly Warrior',
      description: 'Complete 5 reviews',
      type: 'REVIEWS_COMPLETED',
      scope: 'INDIVIDUAL',
      target: 5,
      difficulty: 'easy',
    },
  ],
}));

import { db } from '@/lib/db';
import { postMessage } from '@/lib/slack/client';
import {
  ensureWeeklyChallenges,
  createCustomChallenge,
  updateChallengeProgress,
  getActiveChallenges,
  getCompletedChallenges,
  getChallengeLeaderboard,
  notifyChallengeCompletion,
  formatChallengeDisplay,
} from '../tracker';

const mockDb = db as jest.Mocked<typeof db>;
const mockPostMessage = postMessage as jest.Mock;

describe('Challenge Tracker Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureWeeklyChallenges', () => {
    it('returns existing challenges when they exist', async () => {
      const existingChallenges = [
        { id: 'ch-1', scope: 'INDIVIDUAL', name: 'weekly_reviews' },
        { id: 'ch-2', scope: 'TEAM', name: 'team_reviews' },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(existingChallenges);

      const result = await ensureWeeklyChallenges();

      expect(result.created).toBe(false);
      expect(result.individual).toBeDefined();
      expect(result.team).toBeDefined();
    });

    it('creates new challenges when none exist', async () => {
      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.challenge.create as jest.Mock)
        .mockResolvedValueOnce({ id: 'ch-1', scope: 'INDIVIDUAL' })
        .mockResolvedValueOnce({ id: 'ch-2', scope: 'TEAM' });

      const result = await ensureWeeklyChallenges();

      expect(result.created).toBe(true);
      expect(mockDb.challenge.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('createCustomChallenge', () => {
    it('creates challenge from preset name', async () => {
      (mockDb.challenge.create as jest.Mock).mockResolvedValue({
        id: 'ch-1',
        name: 'weekly_reviews',
        displayName: 'Weekly Warrior',
        type: 'REVIEWS_COMPLETED',
        scope: 'INDIVIDUAL',
        target: 5,
      });

      const result = await createCustomChallenge(
        'weekly_reviews',
        new Date('2024-01-01'),
        new Date('2024-01-07')
      );

      expect(result.name).toBe('weekly_reviews');
      expect(mockDb.challenge.create).toHaveBeenCalled();
    });

    it('throws error for unknown preset', async () => {
      await expect(
        createCustomChallenge(
          'unknown_preset',
          new Date('2024-01-01'),
          new Date('2024-01-07')
        )
      ).rejects.toThrow('Unknown challenge preset: unknown_preset');
    });
  });

  describe('updateChallengeProgress', () => {
    it('updates progress for active challenges', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'REVIEWS_COMPLETED',
          scope: 'INDIVIDUAL',
          target: 5,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);
      (mockDb.challengeProgress.findFirst as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 2,
        isCompleted: false,
        rewardClaimed: false,
      });
      (mockDb.challengeProgress.update as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 3,
        isCompleted: false,
      });

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(results).toHaveLength(1);
      expect(results[0].newProgress).toBe(3);
    });

    it('creates new progress record when none exists', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'REVIEWS_COMPLETED',
          scope: 'INDIVIDUAL',
          target: 5,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);
      (mockDb.challengeProgress.findFirst as jest.Mock).mockResolvedValue(null);
      (mockDb.challengeProgress.create as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 0,
        isCompleted: false,
      });
      (mockDb.challengeProgress.update as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 1,
        isCompleted: false,
      });

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(mockDb.challengeProgress.create).toHaveBeenCalled();
    });

    it('handles fast review challenges', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'FAST_REVIEWS',
          scope: 'INDIVIDUAL',
          target: 3,
          targetMeta: { maxMinutes: 60 },
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);
      (mockDb.challengeProgress.findFirst as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 1,
        isCompleted: false,
      });
      (mockDb.challengeProgress.update as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 2,
        isCompleted: false,
      });

      // Response time within limit
      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(results).toHaveLength(1);
      expect(results[0].newProgress).toBe(2);
    });

    it('does not increment fast review when response time exceeds limit', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'FAST_REVIEWS',
          scope: 'INDIVIDUAL',
          target: 3,
          targetMeta: { maxMinutes: 60 },
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);

      // Response time exceeds limit
      const results = await updateChallengeProgress('user-1', 120, 10);

      expect(results).toHaveLength(0);
    });

    it('awards points when challenge is completed', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'REVIEWS_COMPLETED',
          scope: 'INDIVIDUAL',
          target: 3,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);
      (mockDb.challengeProgress.findFirst as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 2,
        isCompleted: false,
      });
      (mockDb.challengeProgress.update as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 3,
        isCompleted: true,
        completedAt: new Date(),
      });
      (mockDb.statistics.findFirst as jest.Mock).mockResolvedValue({
        id: 'stats-1',
        points: 100,
      });
      (mockDb.statistics.update as jest.Mock).mockResolvedValue({});
      (mockDb.challengeProgress.updateMany as jest.Mock).mockResolvedValue({});

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(results[0].completed).toBe(true);
      expect(results[0].rewardAwarded).toBe(true);
    });
  });

  describe('getActiveChallenges', () => {
    it('returns active challenges with progress', async () => {
      (mockDb.challenge.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // For ensureWeeklyChallenges check
        .mockResolvedValueOnce([
          {
            id: 'ch-1',
            name: 'weekly_reviews',
            displayName: 'Weekly Warrior',
            scope: 'INDIVIDUAL',
            target: 5,
            isActive: true,
            endDate: new Date(Date.now() + 86400000),
            progress: [
              { userId: 'user-1', currentValue: 3, isCompleted: false },
            ],
          },
        ]);

      (mockDb.challenge.create as jest.Mock)
        .mockResolvedValueOnce({ id: 'ch-new-1', scope: 'INDIVIDUAL' })
        .mockResolvedValueOnce({ id: 'ch-new-2', scope: 'TEAM' });

      const result = await getActiveChallenges('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].percentComplete).toBe(60);
    });
  });

  describe('getCompletedChallenges', () => {
    it('returns completed challenges for user', async () => {
      (mockDb.challengeProgress.findMany as jest.Mock).mockResolvedValue([
        {
          userId: 'user-1',
          isCompleted: true,
          completedAt: new Date('2024-01-05'),
          challenge: {
            id: 'ch-1',
            name: 'weekly_reviews',
            displayName: 'Weekly Warrior',
          },
        },
      ]);

      const result = await getCompletedChallenges('user-1', 10);

      expect(result).toHaveLength(1);
      expect(result[0].challenge.name).toBe('weekly_reviews');
    });
  });

  describe('getChallengeLeaderboard', () => {
    it('returns empty array for non-team challenge', async () => {
      (mockDb.challenge.findUnique as jest.Mock).mockResolvedValue({
        id: 'ch-1',
        scope: 'INDIVIDUAL',
      });

      const result = await getChallengeLeaderboard('ch-1');

      expect(result).toHaveLength(0);
    });

    it('returns leaderboard for team challenge', async () => {
      (mockDb.challenge.findUnique as jest.Mock).mockResolvedValue({
        id: 'ch-1',
        scope: 'TEAM',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-07'),
      });

      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([
        { reviewerId: 'user-1', _count: { id: 10 } },
        { reviewerId: 'user-2', _count: { id: 5 } },
      ]);

      (mockDb.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'user-1', displayName: 'User One' },
        { id: 'user-2', displayName: 'User Two' },
      ]);

      const result = await getChallengeLeaderboard('ch-1', 10);

      expect(result).toHaveLength(2);
      expect(result[0].displayName).toBe('User One');
      expect(result[0].contribution).toBe(10);
    });
  });

  describe('notifyChallengeCompletion', () => {
    it('sends notification to user', async () => {
      const challenge = {
        id: 'ch-1',
        displayName: 'Weekly Warrior',
        description: 'Complete 5 reviews',
        rewardValue: 50,
        rewardDesc: '+50 points',
      };

      mockPostMessage.mockResolvedValue({});

      await notifyChallengeCompletion('U123', challenge as any);

      expect(mockPostMessage).toHaveBeenCalledWith(
        'U123',
        expect.stringContaining('Challenge Complete')
      );
    });
  });

  describe('formatChallengeDisplay', () => {
    it('formats active challenge for display', () => {
      const activeChallenge = {
        challenge: {
          name: 'weekly_reviews',
          displayName: 'Weekly Warrior',
          description: 'Complete 5 reviews this week',
          scope: 'INDIVIDUAL',
          target: 5,
          endDate: new Date(Date.now() + 3 * 86400000), // 3 days from now
        },
        progress: {
          currentValue: 3,
          isCompleted: false,
        },
        percentComplete: 60,
      };

      const result = formatChallengeDisplay(activeChallenge as any);

      expect(result).toContain('Weekly Warrior');
      expect(result).toContain('3/5');
      expect(result).toContain('60%');
      expect(result).toContain('3 days remaining');
    });

    it('shows checkmark when completed', () => {
      const activeChallenge = {
        challenge: {
          name: 'weekly_reviews',
          displayName: 'Weekly Warrior',
          description: 'Complete 5 reviews',
          scope: 'INDIVIDUAL',
          target: 5,
          endDate: new Date(Date.now() + 86400000),
        },
        progress: {
          currentValue: 5,
          isCompleted: true,
        },
        percentComplete: 100,
      };

      const result = formatChallengeDisplay(activeChallenge as any);

      expect(result).toContain('✅');
    });

    it('hides progress when showProgress is false', () => {
      const activeChallenge = {
        challenge: {
          name: 'weekly_reviews',
          displayName: 'Weekly Warrior',
          description: 'Complete 5 reviews',
          scope: 'INDIVIDUAL',
          target: 5,
          endDate: new Date(Date.now() + 86400000),
        },
        progress: null,
        percentComplete: 0,
      };

      const result = formatChallengeDisplay(activeChallenge as any, false);

      expect(result).not.toContain('/5');
      expect(result).not.toContain('%');
    });

    it('shows singular day remaining', () => {
      const activeChallenge = {
        challenge: {
          name: 'weekly_reviews',
          displayName: 'Weekly Warrior',
          description: 'Complete 5 reviews',
          scope: 'INDIVIDUAL',
          target: 5,
          endDate: new Date(Date.now() + 1 * 86400000), // 1 day from now
        },
        progress: { currentValue: 3, isCompleted: false },
        percentComplete: 60,
      };

      const result = formatChallengeDisplay(activeChallenge as any);

      expect(result).toContain('1 day remaining');
    });

    it('does not show remaining days when more than 7', () => {
      const activeChallenge = {
        challenge: {
          name: 'weekly_reviews',
          displayName: 'Weekly Warrior',
          description: 'Complete 5 reviews',
          scope: 'INDIVIDUAL',
          target: 5,
          endDate: new Date(Date.now() + 10 * 86400000), // 10 days from now
        },
        progress: { currentValue: 3, isCompleted: false },
        percentComplete: 60,
      };

      const result = formatChallengeDisplay(activeChallenge as any);

      expect(result).not.toContain('remaining');
    });
  });

  describe('updateChallengeProgress - additional branches', () => {
    it('handles team challenge progress', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'TEAM_REVIEWS',
          scope: 'TEAM',
          target: 20,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 100,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);
      (mockDb.challengeProgress.findFirst as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        userId: null, // Team progress has null userId
        currentValue: 10,
        isCompleted: false,
      });
      (mockDb.challengeProgress.update as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 11,
        isCompleted: false,
      });

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(results).toHaveLength(1);
      expect(results[0].newProgress).toBe(11);
    });

    it('handles points earned challenge type', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'POINTS_EARNED',
          scope: 'INDIVIDUAL',
          target: 100,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);
      (mockDb.challengeProgress.findFirst as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 80,
        isCompleted: false,
      });
      (mockDb.challengeProgress.update as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 90,
        isCompleted: false,
      });

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(results).toHaveLength(1);
      expect(results[0].newProgress).toBe(90);
    });

    it('skips already completed progress', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'REVIEWS_COMPLETED',
          scope: 'INDIVIDUAL',
          target: 5,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);
      (mockDb.challengeProgress.findFirst as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 5,
        isCompleted: true,
        rewardClaimed: true,
      });

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(results).toHaveLength(1);
      expect(results[0].completed).toBe(true);
      expect(mockDb.challengeProgress.update).not.toHaveBeenCalled();
    });

    it('handles streak days challenge (returns 0 increment)', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'STREAK_DAYS',
          scope: 'INDIVIDUAL',
          target: 7,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(results).toHaveLength(0);
    });

    it('handles response time avg challenge (returns 0 increment)', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'RESPONSE_TIME_AVG',
          scope: 'INDIVIDUAL',
          target: 60,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(results).toHaveLength(0);
    });

    it('handles zero pending challenge (returns 0 increment)', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'ZERO_PENDING',
          scope: 'INDIVIDUAL',
          target: 0,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(results).toHaveLength(0);
    });

    it('handles fast review with null response time', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'FAST_REVIEWS',
          scope: 'INDIVIDUAL',
          target: 3,
          targetMeta: { maxMinutes: 60 },
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);

      // Null response time
      const results = await updateChallengeProgress('user-1', null, 10);

      expect(results).toHaveLength(0);
    });

    it('handles fast review with default maxMinutes', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'FAST_REVIEWS',
          scope: 'INDIVIDUAL',
          target: 3,
          targetMeta: null, // No maxMinutes set, defaults to 120
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);
      (mockDb.challengeProgress.findFirst as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 1,
        isCompleted: false,
      });
      (mockDb.challengeProgress.update as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 2,
        isCompleted: false,
      });

      // Response time within default 120 limit
      const results = await updateChallengeProgress('user-1', 100, 10);

      expect(results).toHaveLength(1);
    });

    it('creates stats record if not exists when awarding points', async () => {
      const activeChallenges = [
        {
          id: 'ch-1',
          type: 'REVIEWS_COMPLETED',
          scope: 'INDIVIDUAL',
          target: 1,
          targetMeta: null,
          rewardType: 'POINTS',
          rewardValue: 50,
        },
      ];

      (mockDb.challenge.findMany as jest.Mock).mockResolvedValue(activeChallenges);
      (mockDb.challengeProgress.findFirst as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 0,
        isCompleted: false,
      });
      (mockDb.challengeProgress.update as jest.Mock).mockResolvedValue({
        id: 'prog-1',
        currentValue: 1,
        isCompleted: true,
        completedAt: new Date(),
      });
      (mockDb.statistics.findFirst as jest.Mock).mockResolvedValue(null);
      (mockDb.statistics.create as jest.Mock).mockResolvedValue({});
      (mockDb.challengeProgress.updateMany as jest.Mock).mockResolvedValue({});

      const results = await updateChallengeProgress('user-1', 30, 10);

      expect(mockDb.statistics.create).toHaveBeenCalled();
      expect(results[0].rewardAwarded).toBe(true);
    });
  });

  describe('getChallengeLeaderboard - edge cases', () => {
    it('returns empty for null challenge', async () => {
      (mockDb.challenge.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await getChallengeLeaderboard('non-existent');

      expect(result).toHaveLength(0);
    });

    it('filters out null reviewerIds', async () => {
      (mockDb.challenge.findUnique as jest.Mock).mockResolvedValue({
        id: 'ch-1',
        scope: 'TEAM',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-07'),
      });

      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([
        { reviewerId: 'user-1', _count: { id: 10 } },
        { reviewerId: null, _count: { id: 5 } }, // Should be filtered
      ]);

      (mockDb.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'user-1', displayName: 'User One' },
      ]);

      const result = await getChallengeLeaderboard('ch-1', 10);

      expect(result).toHaveLength(1);
    });
  });

  describe('notifyChallengeCompletion - edge cases', () => {
    it('uses default reward text when no rewardDesc', async () => {
      const challenge = {
        id: 'ch-1',
        displayName: 'Weekly Warrior',
        description: 'Complete 5 reviews',
        rewardValue: 50,
        rewardDesc: null,
      };

      mockPostMessage.mockResolvedValue({});

      await notifyChallengeCompletion('U123', challenge as any);

      expect(mockPostMessage).toHaveBeenCalledWith(
        'U123',
        expect.stringContaining('+50 points')
      );
    });
  });
});
