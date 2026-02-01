/**
 * Achievement Checker Service
 *
 * Evaluates user statistics and awards achievements when criteria are met.
 */

import { db } from '@/lib/db';
import { postMessage } from '@/lib/slack/client';
import { ACHIEVEMENTS, type AchievementDefinition } from './definitions';

interface UserStats {
  totalCompleted: number;
  avgResponseTime: number | null;
  fastestResponse: number | null;
  currentStreak: number;
  totalPoints: number;
  skillsUsed: string[];
  reposReviewed: string[];
}

/**
 * Get user statistics for achievement evaluation
 */
const getUserStats = async (userId: string): Promise<UserStats> => {
  // Get completed reviews count
  const totalCompleted = await db.assignment.count({
    where: {
      reviewerId: userId,
      status: { in: ['COMPLETED', 'APPROVED'] },
    },
  });

  // Get aggregated statistics
  const stats = await db.statistics.findMany({
    where: { userId, repositoryId: null }, // Global stats only
    orderBy: { period: 'desc' },
  });

  // Calculate totals
  let totalPoints = 0;
  let fastestResponse: number | null = null;
  let totalResponseTime = 0;
  let responseCount = 0;
  let currentStreak = 0;

  for (const s of stats) {
    totalPoints += s.points;
    if (s.fastestResponse !== null) {
      if (fastestResponse === null || s.fastestResponse < fastestResponse) {
        fastestResponse = s.fastestResponse;
      }
    }
    if (s.avgResponseTime !== null) {
      totalResponseTime += s.avgResponseTime * s.completed;
      responseCount += s.completed;
    }
    // Get most recent streak
    if (currentStreak === 0 && s.streak > 0) {
      currentStreak = s.streak;
    }
  }

  const avgResponseTime = responseCount > 0
    ? Math.round(totalResponseTime / responseCount)
    : null;

  // Get unique skills used
  const skillsUsedAgg = await db.assignment.findMany({
    where: {
      reviewerId: userId,
      status: { in: ['COMPLETED', 'APPROVED'] },
    },
    select: { skillsRequired: true },
  });

  const skillsSet = new Set<string>();
  for (const a of skillsUsedAgg) {
    for (const skill of a.skillsRequired) {
      skillsSet.add(skill);
    }
  }

  // Get unique repos reviewed
  const reposReviewed = await db.assignment.findMany({
    where: {
      reviewerId: userId,
      status: { in: ['COMPLETED', 'APPROVED'] },
    },
    select: { repository: { select: { fullName: true } } },
    distinct: ['repositoryId'],
  });

  return {
    totalCompleted,
    avgResponseTime,
    fastestResponse,
    currentStreak,
    totalPoints,
    skillsUsed: Array.from(skillsSet),
    reposReviewed: reposReviewed.map(r => r.repository.fullName),
  };
};

/**
 * Check if a user meets the criteria for an achievement
 */
const meetsAchievementCriteria = (
  achievement: AchievementDefinition,
  stats: UserStats
): boolean => {
  const { criteria } = achievement;

  switch (criteria.type) {
    case 'reviews_completed':
      return stats.totalCompleted >= criteria.threshold;

    case 'avg_response_time':
      return stats.avgResponseTime !== null && stats.avgResponseTime <= criteria.threshold;

    case 'fastest_response':
      return stats.fastestResponse !== null && stats.fastestResponse <= criteria.threshold;

    case 'streak':
      return stats.currentStreak >= criteria.threshold;

    case 'points':
      return stats.totalPoints >= criteria.threshold;

    case 'skills_used':
      return stats.skillsUsed.length >= criteria.threshold;

    case 'repos_reviewed':
      return stats.reposReviewed.length >= criteria.threshold;

    default:
      return false;
  }
};

/**
 * Award an achievement to a user
 */
const awardAchievement = async (
  userId: string,
  achievement: AchievementDefinition
): Promise<boolean> => {
  // Check if achievement exists in DB
  let dbAchievement = await db.achievement.findUnique({
    where: { name: achievement.name },
  });

  // Create if not exists
  if (!dbAchievement) {
    dbAchievement = await db.achievement.create({
      data: {
        name: achievement.name,
        displayName: achievement.displayName,
        description: achievement.description,
        icon: achievement.icon,
        category: achievement.category,
        criteria: achievement.criteria as object,
      },
    });
  }

  // Check if already awarded
  const existing = await db.userAchievement.findUnique({
    where: {
      userId_achievementId: {
        userId,
        achievementId: dbAchievement.id,
      },
    },
  });

  if (existing) return false;

  // Award the achievement
  await db.userAchievement.create({
    data: {
      userId,
      achievementId: dbAchievement.id,
      notified: false,
    },
  });

  return true;
};

/**
 * Check and award achievements for a user
 * Returns newly awarded achievements
 */
export const checkAndAwardAchievements = async (
  userId: string
): Promise<AchievementDefinition[]> => {
  const stats = await getUserStats(userId);
  const newlyAwarded: AchievementDefinition[] = [];

  for (const achievement of ACHIEVEMENTS) {
    if (meetsAchievementCriteria(achievement, stats)) {
      const awarded = await awardAchievement(userId, achievement);
      if (awarded) {
        newlyAwarded.push(achievement);
      }
    }
  }

  return newlyAwarded;
};

/**
 * Notify user about new achievements via Slack DM
 */
export const notifyAchievements = async (
  slackId: string,
  achievements: AchievementDefinition[]
): Promise<void> => {
  if (achievements.length === 0) return;

  const achievementList = achievements
    .map(a => `${a.icon} *${a.displayName}* - ${a.description} (+${a.points} pts)`)
    .join('\n');

  const message = achievements.length === 1
    ? `🎉 *Achievement Unlocked!*\n\n${achievementList}`
    : `🎉 *${achievements.length} Achievements Unlocked!*\n\n${achievementList}`;

  // DM the user (channel = user ID for DMs)
  await postMessage(slackId, message);
};

/**
 * Get all achievements for a user
 */
export const getUserAchievements = async (userId: string): Promise<{
  earned: Array<{ achievement: AchievementDefinition; earnedAt: Date }>;
  available: AchievementDefinition[];
  progress: Map<string, { current: number; required: number }>;
}> => {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      achievements: {
        include: { achievement: true },
      },
    },
  });

  if (!user) {
    return { earned: [], available: ACHIEVEMENTS, progress: new Map() };
  }

  const earnedNames = new Set(user.achievements.map(ua => ua.achievement.name));
  const stats = await getUserStats(userId);

  const earned = user.achievements.map(ua => ({
    achievement: ACHIEVEMENTS.find(a => a.name === ua.achievement.name)!,
    earnedAt: ua.earnedAt,
  })).filter(e => e.achievement);

  const available = ACHIEVEMENTS.filter(a => !earnedNames.has(a.name));

  // Calculate progress for unearned achievements
  const progress = new Map<string, { current: number; required: number }>();

  for (const achievement of available) {
    const { criteria } = achievement;
    let current = 0;
    const required = criteria.threshold;

    switch (criteria.type) {
      case 'reviews_completed':
        current = stats.totalCompleted;
        break;
      case 'avg_response_time':
        current = stats.avgResponseTime ?? 999;
        break;
      case 'fastest_response':
        current = stats.fastestResponse ?? 999;
        break;
      case 'streak':
        current = stats.currentStreak;
        break;
      case 'points':
        current = stats.totalPoints;
        break;
      case 'skills_used':
        current = stats.skillsUsed.length;
        break;
      case 'repos_reviewed':
        current = stats.reposReviewed.length;
        break;
    }

    progress.set(achievement.name, { current, required });
  }

  return { earned, available, progress };
};
