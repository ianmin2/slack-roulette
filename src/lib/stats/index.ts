/**
 * Statistics Service
 *
 * Handles tracking and updating user review statistics.
 */

import { db } from '@/lib/db';
import { checkAndAwardAchievements, notifyAchievements } from '@/lib/achievements';
import { updateChallengeProgress, notifyChallengeCompletion } from '@/lib/challenges';
import { cache, CacheKeys, TTL } from '@/lib/cache';

/**
 * Get ISO week number
 */
const getWeekNumber = (date: Date): number => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

/**
 * Get period string for a date
 */
export const getPeriodString = (
  date: Date,
  type: 'week' | 'month' | 'year'
): string => {
  const year = date.getFullYear();

  switch (type) {
    case 'week':
      return `${year}-W${String(getWeekNumber(date)).padStart(2, '0')}`;
    case 'month':
      return `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    case 'year':
      return `${year}`;
  }
};

/**
 * Calculate points for completing a review
 */
export const calculatePointsForReview = (responseTimeMinutes: number | null): number => {
  let points = 10; // Base points

  if (responseTimeMinutes !== null) {
    if (responseTimeMinutes < 60) {
      points += 15; // < 1 hour: +15
    } else if (responseTimeMinutes < 120) {
      points += 10; // < 2 hours: +10
    } else if (responseTimeMinutes < 240) {
      points += 5; // < 4 hours: +5
    }
  }

  return points;
};

// Alias for internal use
const calculatePoints = calculatePointsForReview;

/**
 * Update statistics for a user when a review is assigned
 */
export const recordAssignment = async (
  userId: string,
  repositoryId: string | null
) => {
  const now = new Date();
  const periods: Array<{ type: 'week' | 'month'; period: string }> = [
    { type: 'week', period: getPeriodString(now, 'week') },
    { type: 'month', period: getPeriodString(now, 'month') },
  ];

  // Record stats for both global (null repoId) and per-repository
  const repoIds = repositoryId ? [null, repositoryId] : [null];

  for (const repoId of repoIds) {
    for (const { type, period } of periods) {
      // Handle null repositoryId by finding existing record first
      const existing = await db.statistics.findFirst({
        where: {
          userId,
          repositoryId: repoId,
          period,
        },
      });

      if (existing) {
        await db.statistics.update({
          where: { id: existing.id },
          data: { assigned: { increment: 1 } },
        });
      } else {
        await db.statistics.create({
          data: {
            userId,
            repositoryId: repoId,
            period,
            periodType: type,
            assigned: 1,
          },
        });
      }
    }
  }
};

/**
 * Update statistics when a review is completed
 */
export const recordCompletion = async (
  userId: string,
  repositoryId: string | null,
  responseTimeMinutes: number | null
) => {
  const now = new Date();
  const periods: Array<{ type: 'week' | 'month'; period: string }> = [
    { type: 'week', period: getPeriodString(now, 'week') },
    { type: 'month', period: getPeriodString(now, 'month') },
  ];

  // Record stats for both global (null repoId) and per-repository
  const repoIds = repositoryId ? [null, repositoryId] : [null];

  for (const repoId of repoIds) {
    for (const { type, period } of periods) {
      const existing = await db.statistics.findFirst({
        where: {
          userId,
          repositoryId: repoId,
          period,
        },
      });

      if (existing) {
        // Calculate new average response time
        let newAvgResponseTime = existing.avgResponseTime;
        if (responseTimeMinutes !== null) {
          if (existing.avgResponseTime === null) {
            newAvgResponseTime = responseTimeMinutes;
          } else {
            // Running average
            const totalCompleted = existing.completed;
            newAvgResponseTime = Math.round(
              (existing.avgResponseTime * totalCompleted + responseTimeMinutes) /
                (totalCompleted + 1)
            );
          }
        }

        // Update fastest response
        let newFastestResponse = existing.fastestResponse;
        if (
          responseTimeMinutes !== null &&
          (existing.fastestResponse === null ||
            responseTimeMinutes < existing.fastestResponse)
        ) {
          newFastestResponse = responseTimeMinutes;
        }

        await db.statistics.update({
          where: { id: existing.id },
          data: {
            completed: { increment: 1 },
            avgResponseTime: newAvgResponseTime,
            fastestResponse: newFastestResponse,
            points: { increment: calculatePoints(responseTimeMinutes) },
            streak: { increment: 1 },
          },
        });
      } else {
        await db.statistics.create({
          data: {
            userId,
            repositoryId: repoId,
            period,
            periodType: type,
            assigned: 0,
            completed: 1,
            avgResponseTime: responseTimeMinutes,
            fastestResponse: responseTimeMinutes,
            points: calculatePoints(responseTimeMinutes),
            streak: 1,
          },
        });
      }
    }
  }

  // Invalidate relevant caches
  await Promise.all([
    cache.invalidateUser(userId),
    cache.invalidateLeaderboards(),
    repositoryId ? cache.invalidateRepo(repositoryId) : Promise.resolve(),
  ]);
};


/**
 * Get user stats summary
 */
export const getUserStatsSummary = async (
  userId: string,
  repositoryId: string | null = null
) => {
  const now = new Date();
  const weekPeriod = getPeriodString(now, 'week');
  const monthPeriod = getPeriodString(now, 'month');
  const cacheKey = CacheKeys.userStats(userId, repositoryId ?? 'global');

  return cache.getOrSet(
    cacheKey,
    async () => {
      const [weekStats, monthStats, allTimeStats] = await Promise.all([
        db.statistics.findFirst({
          where: { userId, repositoryId, period: weekPeriod },
        }),
        db.statistics.findFirst({
          where: { userId, repositoryId, period: monthPeriod },
        }),
        db.assignment.count({
          where: {
            reviewerId: userId,
            status: { in: ['COMPLETED', 'APPROVED'] },
            ...(repositoryId ? { repositoryId } : {}),
          },
        }),
      ]);

      return {
        week: weekStats,
        month: monthStats,
        allTimeCompleted: allTimeStats,
      };
    },
    { ttl: TTL.STANDARD } // 5 minutes cache
  );
};

/**
 * Get leaderboard for a period
 */
export const getLeaderboard = async (
  periodType: 'week' | 'month',
  limit = 10,
  repoId?: string
) => {
  const now = new Date();
  const period = getPeriodString(now, periodType);
  const cacheKey = CacheKeys.leaderboard(period, repoId);

  return cache.getOrSet(
    cacheKey,
    async () => {
      return db.statistics.findMany({
        where: {
          periodType,
          period,
          repositoryId: repoId ?? null, // Global stats if no repoId
        },
        include: { user: true },
        orderBy: [{ completed: 'desc' }, { avgResponseTime: 'asc' }],
        take: limit,
      });
    },
    { ttl: TTL.MEDIUM } // 15 minutes cache
  );
};

/**
 * Record completion and check for new achievements and challenge progress
 * Returns newly unlocked achievements (if any)
 */
export const recordCompletionWithAchievements = async (
  userId: string,
  slackId: string,
  repositoryId: string | null,
  responseTimeMinutes: number | null
) => {
  // Record the completion stats
  await recordCompletion(userId, repositoryId, responseTimeMinutes);

  // Calculate points earned for this review (same logic as calculatePoints)
  const pointsEarned = calculatePointsForReview(responseTimeMinutes);

  // Check for new achievements and challenge progress in parallel
  const [newAchievements, challengeResults] = await Promise.all([
    checkAndAwardAchievements(userId),
    updateChallengeProgress(userId, responseTimeMinutes, pointsEarned),
  ]);

  // Notify user of any new achievements
  if (newAchievements.length > 0) {
    await notifyAchievements(slackId, newAchievements);
  }

  // Notify user of newly completed challenges
  const completedChallenges = challengeResults.filter(
    r => r.completed && r.rewardAwarded
  );
  for (const result of completedChallenges) {
    await notifyChallengeCompletion(slackId, result.challenge);
  }

  return {
    achievements: newAchievements,
    challenges: challengeResults,
  };
};
