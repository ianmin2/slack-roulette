/**
 * Weekly Goals Service
 *
 * Manages personal weekly review goals for users.
 * Goals reset each Monday and track progress toward
 * user-defined targets.
 */

import { db } from '@/lib/db';
import { postMessage } from '@/lib/slack/client';
import { getPeriodString } from '@/lib/stats';
import type { WeeklyGoal, WeeklyGoalInput } from '@/types';

/**
 * Get the start of the current week (Monday 00:00:00 UTC)
 */
const getWeekStart = (date: Date = new Date()): Date => {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Set a weekly goal for a user
 * Creates a new goal or updates existing one for the current week
 */
export const setWeeklyGoal = async (
  userId: string,
  input: WeeklyGoalInput
): Promise<WeeklyGoal> => {
  const weekStart = getWeekStart();

  // Check for existing goal this week
  const existing = await db.weeklyGoal.findUnique({
    where: {
      userId_weekStart: {
        userId,
        weekStart,
      },
    },
  });

  if (existing) {
    // Update existing goal
    const updated = await db.weeklyGoal.update({
      where: { id: existing.id },
      data: {
        targetReviews: input.targetReviews ?? existing.targetReviews,
        targetPoints: input.targetPoints ?? existing.targetPoints,
        targetAvgResponseMinutes:
          input.targetAvgResponseMinutes ?? existing.targetAvgResponseMinutes,
      },
    });
    return mapDbGoalToType(updated);
  }

  // Create new goal
  const goal = await db.weeklyGoal.create({
    data: {
      userId,
      weekStart,
      targetReviews: input.targetReviews ?? 5,
      targetPoints: input.targetPoints ?? 100,
      targetAvgResponseMinutes: input.targetAvgResponseMinutes ?? null,
      currentReviews: 0,
      currentPoints: 0,
      currentAvgResponseMinutes: null,
      isAchieved: false,
    },
  });

  return mapDbGoalToType(goal);
};

/**
 * Get the current weekly goal for a user
 */
export const getWeeklyGoal = async (
  userId: string
): Promise<WeeklyGoal | null> => {
  const weekStart = getWeekStart();

  const goal = await db.weeklyGoal.findUnique({
    where: {
      userId_weekStart: {
        userId,
        weekStart,
      },
    },
  });

  return goal ? mapDbGoalToType(goal) : null;
};

/**
 * Get a user's goal history
 */
export const getWeeklyGoalHistory = async (
  userId: string,
  limit = 10
): Promise<WeeklyGoal[]> => {
  const goals = await db.weeklyGoal.findMany({
    where: { userId },
    orderBy: { weekStart: 'desc' },
    take: limit,
  });

  return goals.map(mapDbGoalToType);
};

/**
 * Update weekly goal progress for a user
 * Called after review completion to sync current values
 */
export const updateWeeklyGoalProgress = async (
  userId: string
): Promise<WeeklyGoal> => {
  const weekStart = getWeekStart();

  // Get or create goal
  let goal = await db.weeklyGoal.findUnique({
    where: {
      userId_weekStart: {
        userId,
        weekStart,
      },
    },
  });

  if (!goal) {
    // Create default goal if none exists
    goal = await db.weeklyGoal.create({
      data: {
        userId,
        weekStart,
        targetReviews: 5,
        targetPoints: 100,
        targetAvgResponseMinutes: null,
        currentReviews: 0,
        currentPoints: 0,
        currentAvgResponseMinutes: null,
        isAchieved: false,
      },
    });
  }

  // Calculate current progress from statistics
  const weekPeriod = getPeriodString(weekStart, 'week');
  const stats = await db.statistics.findFirst({
    where: { userId, repositoryId: null, period: weekPeriod },
  });

  const currentReviews = stats?.completed ?? 0;
  const currentPoints = stats?.points ?? 0;
  const currentAvgResponseMinutes = stats?.avgResponseTime ?? null;

  // Check if goal is achieved
  const reviewsAchieved = currentReviews >= goal.targetReviews;
  const pointsAchieved = currentPoints >= goal.targetPoints;
  const responseAchieved =
    goal.targetAvgResponseMinutes === null ||
    (currentAvgResponseMinutes !== null &&
      currentAvgResponseMinutes <= goal.targetAvgResponseMinutes);

  const isAchieved = reviewsAchieved && pointsAchieved && responseAchieved;

  // Update goal
  const updated = await db.weeklyGoal.update({
    where: { id: goal.id },
    data: {
      currentReviews,
      currentPoints,
      currentAvgResponseMinutes,
      isAchieved,
    },
  });

  return mapDbGoalToType(updated);
};

/**
 * Check and notify user if they just achieved their weekly goal
 */
export const checkAndNotifyGoalCompletion = async (
  userId: string,
  slackId: string
): Promise<void> => {
  const weekStart = getWeekStart();

  const goal = await db.weeklyGoal.findUnique({
    where: {
      userId_weekStart: {
        userId,
        weekStart,
      },
    },
  });

  if (!goal || !goal.isAchieved || goal.notified) return;

  // Mark as notified
  await db.weeklyGoal.update({
    where: { id: goal.id },
    data: { notified: true },
  });

  // Build achievement summary
  const achievements: string[] = [];
  if (goal.currentReviews >= goal.targetReviews) {
    achievements.push(`Reviews: ${goal.currentReviews}/${goal.targetReviews}`);
  }
  if (goal.currentPoints >= goal.targetPoints) {
    achievements.push(`Points: ${goal.currentPoints}/${goal.targetPoints}`);
  }
  if (
    goal.targetAvgResponseMinutes &&
    goal.currentAvgResponseMinutes &&
    goal.currentAvgResponseMinutes <= goal.targetAvgResponseMinutes
  ) {
    achievements.push(
      `Avg Response: ${goal.currentAvgResponseMinutes}min (target: <${goal.targetAvgResponseMinutes}min)`
    );
  }

  const message = `*Weekly Goal Achieved!*\n\nCongratulations! You've hit your weekly targets:\n${achievements.map(a => `  ${a}`).join('\n')}\n\n_Set new goals with \`/pr-roulette goal set\`_`;

  // DM the user
  await postMessage(slackId, message);
};

/**
 * Get weekly goal summary for display
 */
export const getWeeklyGoalSummary = (
  goal: WeeklyGoal
): {
  reviewProgress: { current: number; target: number; percent: number };
  pointsProgress: { current: number; target: number; percent: number };
  responseProgress: { current: number | null; target: number | null; achieved: boolean } | null;
} => {
  const reviewProgress = {
    current: goal.currentReviews,
    target: goal.targetReviews,
    percent: Math.min(100, Math.round((goal.currentReviews / goal.targetReviews) * 100)),
  };

  const pointsProgress = {
    current: goal.currentPoints,
    target: goal.targetPoints,
    percent: Math.min(100, Math.round((goal.currentPoints / goal.targetPoints) * 100)),
  };

  const responseProgress =
    goal.targetAvgResponseMinutes !== null
      ? {
          current: goal.currentAvgResponseMinutes,
          target: goal.targetAvgResponseMinutes,
          achieved:
            goal.currentAvgResponseMinutes !== null &&
            goal.currentAvgResponseMinutes <= goal.targetAvgResponseMinutes,
        }
      : null;

  return { reviewProgress, pointsProgress, responseProgress };
};

/**
 * Map DB goal record to typed WeeklyGoal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapDbGoalToType = (goal: any): WeeklyGoal => ({
  id: goal.id,
  userId: goal.userId,
  weekStart: goal.weekStart,
  targetReviews: goal.targetReviews,
  targetPoints: goal.targetPoints,
  targetAvgResponseMinutes: goal.targetAvgResponseMinutes,
  currentReviews: goal.currentReviews,
  currentPoints: goal.currentPoints,
  currentAvgResponseMinutes: goal.currentAvgResponseMinutes,
  isAchieved: goal.isAchieved,
  createdAt: goal.createdAt,
});
