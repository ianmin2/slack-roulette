/**
 * Tests for Weekly Goals Service
 */

// Mock dependencies
jest.mock('@/lib/db', () => ({
  db: {
    weeklyGoal: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    statistics: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/lib/slack/client', () => ({
  postMessage: jest.fn(),
}));

jest.mock('@/lib/stats', () => ({
  getPeriodString: jest.fn().mockReturnValue('2024-W01'),
}));

import { db } from '@/lib/db';
import { postMessage } from '@/lib/slack/client';
import {
  setWeeklyGoal,
  getWeeklyGoal,
  getWeeklyGoalHistory,
  updateWeeklyGoalProgress,
  checkAndNotifyGoalCompletion,
  getWeeklyGoalSummary,
} from '../goals';

const mockDb = db as jest.Mocked<typeof db>;
const mockPostMessage = postMessage as jest.Mock;

describe('Weekly Goals Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setWeeklyGoal', () => {
    it('creates a new goal when none exists', async () => {
      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue(null);
      (mockDb.weeklyGoal.create as jest.Mock).mockResolvedValue({
        id: 'goal-1',
        userId: 'user-1',
        weekStart: new Date(),
        targetReviews: 10,
        targetPoints: 200,
        targetAvgResponseMinutes: 60,
        currentReviews: 0,
        currentPoints: 0,
        currentAvgResponseMinutes: null,
        isAchieved: false,
        createdAt: new Date(),
      });

      const result = await setWeeklyGoal('user-1', {
        targetReviews: 10,
        targetPoints: 200,
        targetAvgResponseMinutes: 60,
      });

      expect(mockDb.weeklyGoal.create).toHaveBeenCalled();
      expect(result.targetReviews).toBe(10);
      expect(result.targetPoints).toBe(200);
    });

    it('updates existing goal', async () => {
      const existingGoal = {
        id: 'goal-1',
        userId: 'user-1',
        weekStart: new Date(),
        targetReviews: 5,
        targetPoints: 100,
        targetAvgResponseMinutes: null,
      };

      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue(existingGoal);
      (mockDb.weeklyGoal.update as jest.Mock).mockResolvedValue({
        ...existingGoal,
        targetReviews: 15,
      });

      const result = await setWeeklyGoal('user-1', { targetReviews: 15 });

      expect(mockDb.weeklyGoal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: {
          targetReviews: 15,
          targetPoints: 100,
          targetAvgResponseMinutes: null,
        },
      });
      expect(result.targetReviews).toBe(15);
    });

    it('uses defaults for missing values', async () => {
      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue(null);
      (mockDb.weeklyGoal.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({ id: 'goal-1', ...data, createdAt: new Date() })
      );

      const result = await setWeeklyGoal('user-1', {});

      expect(mockDb.weeklyGoal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            targetReviews: 5,
            targetPoints: 100,
            targetAvgResponseMinutes: null,
          }),
        })
      );
      expect(result.targetReviews).toBe(5);
      expect(result.targetPoints).toBe(100);
    });
  });

  describe('getWeeklyGoal', () => {
    it('returns goal when found', async () => {
      const goal = {
        id: 'goal-1',
        userId: 'user-1',
        weekStart: new Date(),
        targetReviews: 5,
        targetPoints: 100,
        targetAvgResponseMinutes: null,
        currentReviews: 3,
        currentPoints: 60,
        currentAvgResponseMinutes: 45,
        isAchieved: false,
        createdAt: new Date(),
      };

      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue(goal);

      const result = await getWeeklyGoal('user-1');

      expect(result).not.toBeNull();
      expect(result?.targetReviews).toBe(5);
      expect(result?.currentReviews).toBe(3);
    });

    it('returns null when no goal exists', async () => {
      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await getWeeklyGoal('user-1');

      expect(result).toBeNull();
    });
  });

  describe('getWeeklyGoalHistory', () => {
    it('returns goal history ordered by date', async () => {
      const goals = [
        {
          id: 'goal-2',
          userId: 'user-1',
          weekStart: new Date('2024-01-08'),
          targetReviews: 10,
          targetPoints: 200,
          currentReviews: 8,
          currentPoints: 150,
          isAchieved: false,
          createdAt: new Date(),
        },
        {
          id: 'goal-1',
          userId: 'user-1',
          weekStart: new Date('2024-01-01'),
          targetReviews: 5,
          targetPoints: 100,
          currentReviews: 5,
          currentPoints: 120,
          isAchieved: true,
          createdAt: new Date(),
        },
      ];

      (mockDb.weeklyGoal.findMany as jest.Mock).mockResolvedValue(goals);

      const result = await getWeeklyGoalHistory('user-1', 5);

      expect(result).toHaveLength(2);
      expect(mockDb.weeklyGoal.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { weekStart: 'desc' },
        take: 5,
      });
    });
  });

  describe('updateWeeklyGoalProgress', () => {
    it('creates default goal and updates progress when no goal exists', async () => {
      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue(null);

      const createdGoal = {
        id: 'goal-1',
        userId: 'user-1',
        targetReviews: 5,
        targetPoints: 100,
        currentReviews: 0,
        currentPoints: 0,
        isAchieved: false,
      };
      (mockDb.weeklyGoal.create as jest.Mock).mockResolvedValue(createdGoal);

      (mockDb.statistics.findFirst as jest.Mock).mockResolvedValue({
        completed: 3,
        points: 75,
        avgResponseTime: 30,
      });

      (mockDb.weeklyGoal.update as jest.Mock).mockResolvedValue({
        ...createdGoal,
        currentReviews: 3,
        currentPoints: 75,
        currentAvgResponseMinutes: 30,
        isAchieved: false,
      });

      const result = await updateWeeklyGoalProgress('user-1');

      expect(mockDb.weeklyGoal.create).toHaveBeenCalled();
      expect(result.currentReviews).toBe(3);
      expect(result.currentPoints).toBe(75);
    });

    it('marks goal as achieved when targets are met', async () => {
      const existingGoal = {
        id: 'goal-1',
        userId: 'user-1',
        targetReviews: 5,
        targetPoints: 100,
        targetAvgResponseMinutes: null,
        currentReviews: 0,
        currentPoints: 0,
        isAchieved: false,
      };

      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue(existingGoal);
      (mockDb.statistics.findFirst as jest.Mock).mockResolvedValue({
        completed: 10,
        points: 200,
        avgResponseTime: 30,
      });

      (mockDb.weeklyGoal.update as jest.Mock).mockResolvedValue({
        ...existingGoal,
        currentReviews: 10,
        currentPoints: 200,
        currentAvgResponseMinutes: 30,
        isAchieved: true,
      });

      const result = await updateWeeklyGoalProgress('user-1');

      expect(mockDb.weeklyGoal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isAchieved: true }),
        })
      );
      expect(result.isAchieved).toBe(true);
    });
  });

  describe('checkAndNotifyGoalCompletion', () => {
    it('does nothing when no goal exists', async () => {
      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue(null);

      await checkAndNotifyGoalCompletion('user-1', 'U123');

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('does nothing when goal is not achieved', async () => {
      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue({
        id: 'goal-1',
        isAchieved: false,
        notified: false,
      });

      await checkAndNotifyGoalCompletion('user-1', 'U123');

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('does nothing when already notified', async () => {
      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue({
        id: 'goal-1',
        isAchieved: true,
        notified: true,
      });

      await checkAndNotifyGoalCompletion('user-1', 'U123');

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('sends notification and marks as notified when achieved', async () => {
      const goal = {
        id: 'goal-1',
        isAchieved: true,
        notified: false,
        currentReviews: 10,
        targetReviews: 5,
        currentPoints: 200,
        targetPoints: 100,
        currentAvgResponseMinutes: 30,
        targetAvgResponseMinutes: 60,
      };

      (mockDb.weeklyGoal.findUnique as jest.Mock).mockResolvedValue(goal);
      (mockDb.weeklyGoal.update as jest.Mock).mockResolvedValue({ ...goal, notified: true });
      mockPostMessage.mockResolvedValue({});

      await checkAndNotifyGoalCompletion('user-1', 'U123');

      expect(mockDb.weeklyGoal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: { notified: true },
      });
      expect(mockPostMessage).toHaveBeenCalledWith(
        'U123',
        expect.stringContaining('Weekly Goal Achieved')
      );
    });
  });

  describe('getWeeklyGoalSummary', () => {
    it('calculates progress percentages correctly', () => {
      const goal = {
        id: 'goal-1',
        userId: 'user-1',
        weekStart: new Date(),
        targetReviews: 10,
        targetPoints: 100,
        targetAvgResponseMinutes: 60,
        currentReviews: 5,
        currentPoints: 50,
        currentAvgResponseMinutes: 30,
        isAchieved: false,
        createdAt: new Date(),
      };

      const summary = getWeeklyGoalSummary(goal);

      expect(summary.reviewProgress.current).toBe(5);
      expect(summary.reviewProgress.target).toBe(10);
      expect(summary.reviewProgress.percent).toBe(50);
      expect(summary.pointsProgress.current).toBe(50);
      expect(summary.pointsProgress.target).toBe(100);
      expect(summary.pointsProgress.percent).toBe(50);
      expect(summary.responseProgress?.achieved).toBe(true); // 30 < 60
    });

    it('caps percentage at 100', () => {
      const goal = {
        id: 'goal-1',
        userId: 'user-1',
        weekStart: new Date(),
        targetReviews: 5,
        targetPoints: 100,
        targetAvgResponseMinutes: null,
        currentReviews: 10,
        currentPoints: 200,
        currentAvgResponseMinutes: null,
        isAchieved: true,
        createdAt: new Date(),
      };

      const summary = getWeeklyGoalSummary(goal);

      expect(summary.reviewProgress.percent).toBe(100);
      expect(summary.pointsProgress.percent).toBe(100);
    });

    it('returns null for response progress when no target set', () => {
      const goal = {
        id: 'goal-1',
        userId: 'user-1',
        weekStart: new Date(),
        targetReviews: 5,
        targetPoints: 100,
        targetAvgResponseMinutes: null,
        currentReviews: 3,
        currentPoints: 60,
        currentAvgResponseMinutes: 30,
        isAchieved: false,
        createdAt: new Date(),
      };

      const summary = getWeeklyGoalSummary(goal);

      expect(summary.responseProgress).toBeNull();
    });
  });
});
