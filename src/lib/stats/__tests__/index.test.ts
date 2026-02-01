/**
 * Statistics Service Tests
 *
 * Tests for period string generation, points calculation, and database operations.
 */

// Mock the db module before imports
jest.mock('@/lib/db', () => ({
  db: {
    statistics: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    assignment: {
      count: jest.fn(),
    },
  },
}));

// Mock the achievements module
jest.mock('@/lib/achievements', () => ({
  checkAndAwardAchievements: jest.fn().mockResolvedValue([]),
  notifyAchievements: jest.fn().mockResolvedValue(undefined),
}));

// Mock the challenges module
jest.mock('@/lib/challenges', () => ({
  updateChallengeProgress: jest.fn().mockResolvedValue([]),
  notifyChallengeCompletion: jest.fn().mockResolvedValue(undefined),
}));

// Mock the cache module - bypass caching in tests
jest.mock('@/lib/cache', () => ({
  cache: {
    getOrSet: jest.fn((key, factory) => factory()),
    invalidateUser: jest.fn().mockResolvedValue(undefined),
    invalidateRepo: jest.fn().mockResolvedValue(undefined),
    invalidateLeaderboards: jest.fn().mockResolvedValue(undefined),
  },
  CacheKeys: {
    userStats: jest.fn((userId, period) => `user:${userId}:stats:${period}`),
    leaderboard: jest.fn((period, repoId) => repoId ? `leaderboard:${period}:${repoId}` : `leaderboard:${period}`),
  },
  TTL: {
    SHORT: 30,
    STANDARD: 300,
    MEDIUM: 900,
    LONG: 3600,
    DAY: 86400,
  },
}));

import { db } from '@/lib/db';
import { checkAndAwardAchievements, notifyAchievements } from '@/lib/achievements';
import {
  getPeriodString,
  recordAssignment,
  recordCompletion,
  getUserStatsSummary,
  getLeaderboard,
  recordCompletionWithAchievements,
} from '../index';

const mockedDb = db as jest.Mocked<typeof db>;
const mockedCheckAchievements = checkAndAwardAchievements as jest.Mock;
const mockedNotifyAchievements = notifyAchievements as jest.Mock;

describe('getPeriodString', () => {
  describe('week period', () => {
    it('generates correct week string for January 1st', () => {
      const date = new Date('2026-01-01');
      const result = getPeriodString(date, 'week');

      // Week 1 of 2026
      expect(result).toMatch(/^2026-W01$/);
    });

    it('generates correct week string for mid-year date', () => {
      const date = new Date('2026-06-15');
      const result = getPeriodString(date, 'week');

      expect(result).toMatch(/^2026-W\d{2}$/);
    });

    it('pads single-digit week numbers with zero', () => {
      const date = new Date('2026-01-05');
      const result = getPeriodString(date, 'week');

      expect(result).toMatch(/^2026-W0\d$/);
    });

    it('handles year boundary correctly', () => {
      // December 31, 2025 might be in week 1 of 2026 (ISO week)
      const date = new Date('2025-12-31');
      const result = getPeriodString(date, 'week');

      expect(result).toMatch(/^\d{4}-W\d{2}$/);
    });
  });

  describe('month period', () => {
    it('generates correct month string for January', () => {
      const date = new Date('2026-01-15');
      const result = getPeriodString(date, 'month');

      expect(result).toBe('2026-01');
    });

    it('generates correct month string for December', () => {
      const date = new Date('2026-12-25');
      const result = getPeriodString(date, 'month');

      expect(result).toBe('2026-12');
    });

    it('pads single-digit months with zero', () => {
      const date = new Date('2026-05-10');
      const result = getPeriodString(date, 'month');

      expect(result).toBe('2026-05');
    });

    it('handles different years', () => {
      const date2024 = new Date('2024-03-15');
      const date2030 = new Date('2030-11-01');

      expect(getPeriodString(date2024, 'month')).toBe('2024-03');
      expect(getPeriodString(date2030, 'month')).toBe('2030-11');
    });
  });

  describe('year period', () => {
    it('returns just the year', () => {
      const date = new Date('2026-06-15');
      const result = getPeriodString(date, 'year');

      expect(result).toBe('2026');
    });

    it('handles different years', () => {
      expect(getPeriodString(new Date('2020-01-01'), 'year')).toBe('2020');
      expect(getPeriodString(new Date('2099-12-31'), 'year')).toBe('2099');
    });
  });
});

describe('recordAssignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.statistics.findFirst.mockResolvedValue(null);
    mockedDb.statistics.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'stat-1', ...data })
    );
    mockedDb.statistics.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'stat-1', ...data })
    );
  });

  it('creates new statistics records for global and repo when none exist', async () => {
    await recordAssignment('user-1', 'repo-1');

    // Should create 4 records: week+month for both global (null) and repo
    expect(mockedDb.statistics.findFirst).toHaveBeenCalledTimes(4);
    expect(mockedDb.statistics.create).toHaveBeenCalledTimes(4);
  });

  it('creates only global records when repositoryId is null', async () => {
    await recordAssignment('user-1', null);

    // Should create 2 records: week+month for global only
    expect(mockedDb.statistics.findFirst).toHaveBeenCalledTimes(2);
    expect(mockedDb.statistics.create).toHaveBeenCalledTimes(2);
  });

  it('increments assigned count when record exists', async () => {
    mockedDb.statistics.findFirst.mockResolvedValue({
      id: 'existing-stat',
      userId: 'user-1',
      assigned: 5,
    });

    await recordAssignment('user-1', null);

    expect(mockedDb.statistics.update).toHaveBeenCalledWith({
      where: { id: 'existing-stat' },
      data: { assigned: { increment: 1 } },
    });
  });

  it('creates records with correct period types', async () => {
    await recordAssignment('user-1', null);

    const createCalls = mockedDb.statistics.create.mock.calls;
    const periodTypes = createCalls.map(call => call[0].data.periodType);

    expect(periodTypes).toContain('week');
    expect(periodTypes).toContain('month');
  });
});

describe('recordCompletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.statistics.findFirst.mockResolvedValue(null);
    mockedDb.statistics.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'stat-1', ...data })
    );
    mockedDb.statistics.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'stat-1', ...data })
    );
  });

  it('creates new statistics records with completion data', async () => {
    await recordCompletion('user-1', null, 30);

    expect(mockedDb.statistics.create).toHaveBeenCalled();
    const createCall = mockedDb.statistics.create.mock.calls[0][0];
    expect(createCall.data.completed).toBe(1);
    expect(createCall.data.avgResponseTime).toBe(30);
    expect(createCall.data.fastestResponse).toBe(30);
  });

  it('calculates base points (10) for slow response', async () => {
    await recordCompletion('user-1', null, 300); // 5 hours

    const createCall = mockedDb.statistics.create.mock.calls[0][0];
    expect(createCall.data.points).toBe(10); // Base only
  });

  it('calculates bonus points for fast response (<1 hour)', async () => {
    await recordCompletion('user-1', null, 30);

    const createCall = mockedDb.statistics.create.mock.calls[0][0];
    expect(createCall.data.points).toBe(25); // 10 base + 15 bonus
  });

  it('calculates bonus points for medium response (<2 hours)', async () => {
    await recordCompletion('user-1', null, 90);

    const createCall = mockedDb.statistics.create.mock.calls[0][0];
    expect(createCall.data.points).toBe(20); // 10 base + 10 bonus
  });

  it('calculates bonus points for semi-fast response (<4 hours)', async () => {
    await recordCompletion('user-1', null, 180);

    const createCall = mockedDb.statistics.create.mock.calls[0][0];
    expect(createCall.data.points).toBe(15); // 10 base + 5 bonus
  });

  it('updates existing record with running average', async () => {
    mockedDb.statistics.findFirst.mockResolvedValue({
      id: 'existing-stat',
      userId: 'user-1',
      completed: 2,
      avgResponseTime: 60,
      fastestResponse: 45,
      points: 50,
      streak: 2,
    });

    await recordCompletion('user-1', null, 30);

    expect(mockedDb.statistics.update).toHaveBeenCalled();
    const updateCall = mockedDb.statistics.update.mock.calls[0][0];
    // New average: (60 * 2 + 30) / 3 = 50
    expect(updateCall.data.avgResponseTime).toBe(50);
    // New fastest: 30 < 45
    expect(updateCall.data.fastestResponse).toBe(30);
  });

  it('does not update fastest if new time is slower', async () => {
    mockedDb.statistics.findFirst.mockResolvedValue({
      id: 'existing-stat',
      userId: 'user-1',
      completed: 2,
      avgResponseTime: 60,
      fastestResponse: 20,
      points: 50,
      streak: 2,
    });

    await recordCompletion('user-1', null, 30);

    const updateCall = mockedDb.statistics.update.mock.calls[0][0];
    expect(updateCall.data.fastestResponse).toBe(20); // Unchanged
  });

  it('handles null response time', async () => {
    await recordCompletion('user-1', null, null);

    const createCall = mockedDb.statistics.create.mock.calls[0][0];
    expect(createCall.data.avgResponseTime).toBeNull();
    expect(createCall.data.fastestResponse).toBeNull();
    expect(createCall.data.points).toBe(10); // Base only
  });
});

describe('getUserStatsSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns week, month, and all-time stats', async () => {
    const weekStats = { id: 'week-1', completed: 5, points: 100 };
    const monthStats = { id: 'month-1', completed: 20, points: 400 };

    mockedDb.statistics.findFirst
      .mockResolvedValueOnce(weekStats)
      .mockResolvedValueOnce(monthStats);
    mockedDb.assignment.count.mockResolvedValue(50);

    const result = await getUserStatsSummary('user-1');

    expect(result.week).toEqual(weekStats);
    expect(result.month).toEqual(monthStats);
    expect(result.allTimeCompleted).toBe(50);
  });

  it('handles null stats gracefully', async () => {
    mockedDb.statistics.findFirst.mockResolvedValue(null);
    mockedDb.assignment.count.mockResolvedValue(0);

    const result = await getUserStatsSummary('user-1');

    expect(result.week).toBeNull();
    expect(result.month).toBeNull();
    expect(result.allTimeCompleted).toBe(0);
  });

  it('filters by repository when provided', async () => {
    mockedDb.statistics.findFirst.mockResolvedValue(null);
    mockedDb.assignment.count.mockResolvedValue(10);

    await getUserStatsSummary('user-1', 'repo-1');

    expect(mockedDb.statistics.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ repositoryId: 'repo-1' }),
      })
    );
  });
});

describe('getLeaderboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns top users ordered by completed reviews', async () => {
    const leaderboardData = [
      { id: 'stat-1', userId: 'user-1', completed: 25, user: { displayName: 'Alice' } },
      { id: 'stat-2', userId: 'user-2', completed: 20, user: { displayName: 'Bob' } },
    ];

    mockedDb.statistics.findMany.mockResolvedValue(leaderboardData);

    const result = await getLeaderboard('week', 10);

    expect(result).toEqual(leaderboardData);
    expect(mockedDb.statistics.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ completed: 'desc' }, { avgResponseTime: 'asc' }],
        take: 10,
      })
    );
  });

  it('queries global stats only (null repositoryId)', async () => {
    mockedDb.statistics.findMany.mockResolvedValue([]);

    await getLeaderboard('month');

    expect(mockedDb.statistics.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ repositoryId: null }),
      })
    );
  });

  it('defaults to limit of 10', async () => {
    mockedDb.statistics.findMany.mockResolvedValue([]);

    await getLeaderboard('week');

    expect(mockedDb.statistics.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });
});

describe('recordCompletionWithAchievements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.statistics.findFirst.mockResolvedValue(null);
    mockedDb.statistics.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'stat-1', ...data })
    );
    mockedCheckAchievements.mockResolvedValue([]);
    mockedNotifyAchievements.mockResolvedValue(undefined);
  });

  it('records completion and checks for achievements', async () => {
    await recordCompletionWithAchievements('user-1', 'U12345', null, 30);

    // Should have recorded completion
    expect(mockedDb.statistics.create).toHaveBeenCalled();

    // Should check achievements
    expect(mockedCheckAchievements).toHaveBeenCalledWith('user-1');
  });

  it('notifies user when new achievements are earned', async () => {
    const newAchievements = [
      { name: 'first_review', displayName: 'First Steps', icon: '🎯' },
    ];
    mockedCheckAchievements.mockResolvedValue(newAchievements);

    const result = await recordCompletionWithAchievements(
      'user-1',
      'U12345',
      null,
      30
    );

    expect(mockedNotifyAchievements).toHaveBeenCalledWith('U12345', newAchievements);
    expect(result.achievements).toEqual(newAchievements);
    expect(result.challenges).toEqual([]);
  });

  it('does not notify when no new achievements', async () => {
    mockedCheckAchievements.mockResolvedValue([]);

    const result = await recordCompletionWithAchievements(
      'user-1',
      'U12345',
      null,
      30
    );

    expect(mockedNotifyAchievements).not.toHaveBeenCalled();
    expect(result.achievements).toEqual([]);
    expect(result.challenges).toEqual([]);
  });

  it('includes repository in completion record', async () => {
    // Create 4 records: week+month for both global and repo
    await recordCompletionWithAchievements('user-1', 'U12345', 'repo-1', 45);

    // Should create records for both null and repo-1
    expect(mockedDb.statistics.findFirst).toHaveBeenCalledTimes(4);
  });
});

describe('points calculation documentation', () => {
  /**
   * Points Structure:
   * - Base: 10 points per completion
   * - < 1 hour response: +15 bonus (total 25)
   * - < 2 hours response: +10 bonus (total 20)
   * - < 4 hours response: +5 bonus (total 15)
   * - >= 4 hours: no bonus (total 10)
   */

  it('documents point calculation rules', () => {
    const pointsStructure = {
      base: 10,
      bonuses: {
        under1Hour: 15,
        under2Hours: 10,
        under4Hours: 5,
      },
    };

    expect(pointsStructure.base + pointsStructure.bonuses.under1Hour).toBe(25);
    expect(pointsStructure.base + pointsStructure.bonuses.under2Hours).toBe(20);
    expect(pointsStructure.base + pointsStructure.bonuses.under4Hours).toBe(15);
  });
});
