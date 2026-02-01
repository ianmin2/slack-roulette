/**
 * Achievement Checker Tests
 *
 * Tests for achievement checking logic with mocked database.
 */

import { ACHIEVEMENTS } from '../definitions';

// Mock the db module
jest.mock('@/lib/db', () => ({
  db: {
    assignment: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    statistics: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    achievement: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    userAchievement: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

// Mock Slack client
jest.mock('@/lib/slack/client', () => ({
  postMessage: jest.fn().mockResolvedValue({ ts: '123', channel: 'test' }),
}));

import { db } from '@/lib/db';
import { checkAndAwardAchievements, getUserAchievements, notifyAchievements } from '../checker';
import { postMessage } from '@/lib/slack/client';

const mockedDb = db as jest.Mocked<typeof db>;
const mockedPostMessage = postMessage as jest.Mock;

describe('checkAndAwardAchievements', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockedDb.assignment.count.mockResolvedValue(0);
    mockedDb.assignment.findMany.mockResolvedValue([]);
    mockedDb.statistics.findMany.mockResolvedValue([]);
    mockedDb.achievement.findUnique.mockResolvedValue(null);
    mockedDb.achievement.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'ach-1', ...data })
    );
    mockedDb.userAchievement.findUnique.mockResolvedValue(null);
    mockedDb.userAchievement.create.mockResolvedValue({ id: 'ua-1' });
  });

  it('returns empty array when user has no completed reviews', async () => {
    mockedDb.assignment.count.mockResolvedValue(0);

    const result = await checkAndAwardAchievements('user-1');

    expect(result).toEqual([]);
  });

  it('awards first_review achievement for 1 completed review', async () => {
    mockedDb.assignment.count.mockResolvedValue(1);
    mockedDb.statistics.findMany.mockResolvedValue([
      { points: 10, fastestResponse: null, avgResponseTime: null, completed: 1, streak: 1 },
    ]);
    mockedDb.assignment.findMany.mockResolvedValue([
      { skillsRequired: [], repository: { fullName: 'owner/repo' } },
    ]);

    const result = await checkAndAwardAchievements('user-1');

    expect(result.some(a => a.name === 'first_review')).toBe(true);
  });

  it('awards multiple achievements when criteria are met', async () => {
    mockedDb.assignment.count.mockResolvedValue(5);
    mockedDb.statistics.findMany.mockResolvedValue([
      { points: 100, fastestResponse: 25, avgResponseTime: 60, completed: 5, streak: 3 },
    ]);
    mockedDb.assignment.findMany.mockResolvedValue([
      { skillsRequired: ['TypeScript'], repository: { fullName: 'owner/repo' } },
    ]);

    const result = await checkAndAwardAchievements('user-1');

    // Should earn first_review, getting_started, on_a_roll, point_collector, speed_demon
    expect(result.length).toBeGreaterThan(0);
  });

  it('does not re-award already earned achievements', async () => {
    mockedDb.assignment.count.mockResolvedValue(1);
    mockedDb.statistics.findMany.mockResolvedValue([
      { points: 10, fastestResponse: null, avgResponseTime: null, completed: 1, streak: 1 },
    ]);
    mockedDb.assignment.findMany.mockResolvedValue([
      { skillsRequired: [], repository: { fullName: 'owner/repo' } },
    ]);
    // Already has the achievement
    mockedDb.userAchievement.findUnique.mockResolvedValue({ id: 'ua-1' });

    const result = await checkAndAwardAchievements('user-1');

    expect(result.filter(a => a.name === 'first_review')).toHaveLength(0);
  });
});

describe('notifyAchievements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does nothing for empty achievements array', async () => {
    await notifyAchievements('U12345', []);

    expect(mockedPostMessage).not.toHaveBeenCalled();
  });

  it('sends DM for single achievement', async () => {
    const achievement = ACHIEVEMENTS.find(a => a.name === 'first_review')!;
    await notifyAchievements('U12345', [achievement]);

    expect(mockedPostMessage).toHaveBeenCalledWith(
      'U12345',
      expect.stringContaining('Achievement Unlocked')
    );
    expect(mockedPostMessage).toHaveBeenCalledWith(
      'U12345',
      expect.stringContaining(achievement.displayName)
    );
  });

  it('sends plural message for multiple achievements', async () => {
    const achievements = ACHIEVEMENTS.slice(0, 3);
    await notifyAchievements('U12345', achievements);

    expect(mockedPostMessage).toHaveBeenCalledWith(
      'U12345',
      expect.stringContaining('3 Achievements Unlocked')
    );
  });
});

describe('getUserAchievements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty earned and all available for non-existent user', async () => {
    mockedDb.user.findUnique.mockResolvedValue(null);

    const result = await getUserAchievements('non-existent');

    expect(result.earned).toEqual([]);
    expect(result.available).toEqual(ACHIEVEMENTS);
  });

  it('returns earned achievements for user', async () => {
    const mockAchievement = {
      id: 'ach-1',
      name: 'first_review',
      displayName: 'First Steps',
      description: 'Complete your first code review',
      icon: '🎯',
      category: 'volume',
      criteria: { type: 'reviews_completed', threshold: 1 },
    };

    mockedDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      achievements: [
        {
          achievement: mockAchievement,
          earnedAt: new Date('2026-01-15'),
        },
      ],
    });

    // Mock stats queries
    mockedDb.assignment.count.mockResolvedValue(1);
    mockedDb.statistics.findMany.mockResolvedValue([]);
    mockedDb.assignment.findMany.mockResolvedValue([]);

    const result = await getUserAchievements('user-1');

    expect(result.earned.length).toBe(1);
    expect(result.earned[0].achievement.name).toBe('first_review');
  });

  it('calculates progress for unearned achievements', async () => {
    mockedDb.user.findUnique.mockResolvedValue({
      id: 'user-1',
      achievements: [],
    });

    mockedDb.assignment.count.mockResolvedValue(3);
    mockedDb.statistics.findMany.mockResolvedValue([
      { points: 50, fastestResponse: 45, avgResponseTime: 90, completed: 3, streak: 2 },
    ]);
    mockedDb.assignment.findMany.mockResolvedValue([
      { skillsRequired: ['TypeScript'], repository: { fullName: 'owner/repo' } },
    ]);

    const result = await getUserAchievements('user-1');

    expect(result.progress.size).toBeGreaterThan(0);
    // Should have progress towards 'getting_started' (5 reviews needed, have 3)
    const gettingStartedProgress = result.progress.get('getting_started');
    expect(gettingStartedProgress?.current).toBe(3);
    expect(gettingStartedProgress?.required).toBe(5);
  });
});
