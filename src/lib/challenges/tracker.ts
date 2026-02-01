/**
 * Challenge Tracker Service
 *
 * Manages challenge lifecycle: creation, progress tracking, completion, and rewards.
 */

import { db } from '@/lib/db';
import { postMessage } from '@/lib/slack/client';
import { cache, CacheKeys, TTL } from '@/lib/cache';
import {
  type ChallengePreset,
  getWeekChallenges,
  getWeekInfo,
  getDifficultyEmoji,
  getScopeIcon,
  CHALLENGE_PRESETS,
} from './definitions';
import { Prisma } from '@/generated/prisma';
import type { Challenge, ChallengeProgress, ChallengeType } from '@/generated/prisma';

// =============================================================================
// TYPES
// =============================================================================

export interface ActiveChallenge {
  challenge: Challenge;
  progress: ChallengeProgress | null;
  percentComplete: number;
}

export interface ChallengeResult {
  challenge: Challenge;
  completed: boolean;
  rewardAwarded: boolean;
  newProgress: number;
}

// =============================================================================
// CHALLENGE CREATION
// =============================================================================

/**
 * Create challenges for the current week if they don't exist
 */
export const ensureWeeklyChallenges = async (): Promise<{
  individual: Challenge;
  team: Challenge;
  created: boolean;
}> => {
  const { weekNumber, startDate, endDate } = getWeekInfo();

  // Check if challenges already exist for this week
  const existing = await db.challenge.findMany({
    where: {
      isRecurring: true,
      startDate: { gte: startDate },
      endDate: { lte: endDate },
    },
  });

  if (existing.length >= 2) {
    const individual = existing.find(c => c.scope === 'INDIVIDUAL');
    const team = existing.find(c => c.scope === 'TEAM');
    if (individual && team) {
      return { individual, team, created: false };
    }
  }

  // Get presets for this week
  const presets = getWeekChallenges(weekNumber);

  // Create challenges
  const [individual, team] = await Promise.all([
    createChallengeFromPreset(presets.individual, startDate, endDate),
    createChallengeFromPreset(presets.team, startDate, endDate),
  ]);

  return { individual, team, created: true };
};

/**
 * Create a challenge from a preset
 */
const createChallengeFromPreset = async (
  preset: ChallengePreset,
  startDate: Date,
  endDate: Date
): Promise<Challenge> => {
  return db.challenge.create({
    data: {
      name: preset.name,
      displayName: preset.displayName,
      description: preset.description,
      type: preset.type,
      scope: preset.scope,
      target: preset.target,
      targetMeta: (preset.targetMeta ?? Prisma.DbNull) as Prisma.InputJsonValue,
      rewardType: preset.rewardType,
      rewardValue: preset.rewardValue,
      rewardDesc: preset.rewardDesc,
      startDate,
      endDate,
      isActive: true,
      isRecurring: true,
    },
  });
};

/**
 * Create a custom challenge
 */
export const createCustomChallenge = async (
  preset: ChallengePreset | string,
  startDate: Date,
  endDate: Date,
  createdById?: string,
  repositoryId?: string
): Promise<Challenge> => {
  const p = typeof preset === 'string'
    ? CHALLENGE_PRESETS.find(cp => cp.name === preset)
    : preset;

  if (!p) {
    throw new Error(`Unknown challenge preset: ${preset}`);
  }

  return db.challenge.create({
    data: {
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      type: p.type,
      scope: p.scope,
      target: p.target,
      targetMeta: (p.targetMeta ?? Prisma.DbNull) as Prisma.InputJsonValue,
      rewardType: p.rewardType,
      rewardValue: p.rewardValue,
      rewardDesc: p.rewardDesc,
      startDate,
      endDate,
      isActive: true,
      isRecurring: false,
      createdById,
      repositoryId,
    },
  });
};

// =============================================================================
// PROGRESS TRACKING
// =============================================================================

/**
 * Update challenge progress when a review is completed
 */
export const updateChallengeProgress = async (
  userId: string,
  responseTimeMinutes: number | null,
  pointsEarned: number
): Promise<ChallengeResult[]> => {
  const results: ChallengeResult[] = [];
  const now = new Date();

  // Get all active challenges
  const activeChallenges = await db.challenge.findMany({
    where: {
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
    },
  });

  for (const challenge of activeChallenges) {
    const result = await updateSingleChallengeProgress(
      challenge,
      userId,
      responseTimeMinutes,
      pointsEarned
    );
    if (result) {
      results.push(result);
    }
  }

  return results;
};

/**
 * Update progress for a single challenge
 */
const updateSingleChallengeProgress = async (
  challenge: Challenge,
  userId: string,
  responseTimeMinutes: number | null,
  pointsEarned: number
): Promise<ChallengeResult | null> => {
  const isTeamChallenge = challenge.scope === 'TEAM';
  const progressUserId = isTeamChallenge ? null : userId;

  // Calculate increment based on challenge type
  const increment = calculateIncrement(
    challenge.type,
    challenge.targetMeta as Record<string, unknown> | null,
    responseTimeMinutes,
    pointsEarned
  );

  if (increment === 0) {
    return null; // No progress to record
  }

  // Get or create progress record
  let progress = await db.challengeProgress.findFirst({
    where: {
      challengeId: challenge.id,
      userId: progressUserId,
    },
  });

  if (!progress) {
    progress = await db.challengeProgress.create({
      data: {
        challengeId: challenge.id,
        userId: progressUserId,
        currentValue: 0,
      },
    });
  }

  // Skip if already completed
  if (progress.isCompleted) {
    return {
      challenge,
      completed: true,
      rewardAwarded: progress.rewardClaimed,
      newProgress: progress.currentValue,
    };
  }

  // Update progress
  const newValue = progress.currentValue + increment;
  const isCompleted = checkCompletion(challenge.type, newValue, challenge.target);

  const updated = await db.challengeProgress.update({
    where: { id: progress.id },
    data: {
      currentValue: newValue,
      isCompleted,
      completedAt: isCompleted ? new Date() : null,
    },
  });

  // Award reward if just completed
  let rewardAwarded = false;
  if (isCompleted && !progress.isCompleted) {
    rewardAwarded = await awardChallengeReward(challenge, userId, isTeamChallenge);
  }

  return {
    challenge,
    completed: isCompleted,
    rewardAwarded,
    newProgress: updated.currentValue,
  };
};

/**
 * Calculate progress increment based on challenge type
 */
const calculateIncrement = (
  type: ChallengeType,
  targetMeta: Record<string, unknown> | null,
  responseTimeMinutes: number | null,
  pointsEarned: number
): number => {
  switch (type) {
    case 'REVIEWS_COMPLETED':
    case 'TEAM_REVIEWS':
      return 1;

    case 'FAST_REVIEWS': {
      const maxMinutes = (targetMeta?.maxMinutes as number) ?? 120;
      return responseTimeMinutes !== null && responseTimeMinutes <= maxMinutes ? 1 : 0;
    }

    case 'POINTS_EARNED':
      return pointsEarned;

    case 'STREAK_DAYS':
      // Streak tracking is handled separately in stats
      return 0;

    case 'RESPONSE_TIME_AVG':
      // Average tracking needs special handling
      return 0;

    case 'ZERO_PENDING':
      // Checked at end of period, not on each review
      return 0;

    default:
      return 0;
  }
};

/**
 * Check if challenge target is met
 */
const checkCompletion = (
  type: ChallengeType,
  currentValue: number,
  target: number
): boolean => {
  switch (type) {
    case 'RESPONSE_TIME_AVG':
    case 'ZERO_PENDING':
      // These are "less than or equal" targets
      return currentValue <= target;

    default:
      // Standard "greater than or equal" targets
      return currentValue >= target;
  }
};

// =============================================================================
// REWARDS
// =============================================================================

/**
 * Award challenge reward to user(s)
 */
const awardChallengeReward = async (
  challenge: Challenge,
  userId: string,
  isTeamChallenge: boolean
): Promise<boolean> => {
  if (challenge.rewardType === 'POINTS') {
    if (isTeamChallenge) {
      // Award to all participants
      const participants = await getTeamParticipants(challenge.id);
      for (const participantId of participants) {
        await awardBonusPoints(participantId, challenge.rewardValue);
      }
    } else {
      await awardBonusPoints(userId, challenge.rewardValue);
    }

    // Mark as claimed
    await db.challengeProgress.updateMany({
      where: {
        challengeId: challenge.id,
        isCompleted: true,
      },
      data: { rewardClaimed: true },
    });

    return true;
  }

  // TODO: Handle BADGE and ACHIEVEMENT rewards
  return false;
};

/**
 * Award bonus points to a user
 */
const awardBonusPoints = async (
  userId: string,
  points: number
): Promise<void> => {
  const now = new Date();
  const year = now.getFullYear();
  const weekNum = getWeekInfo(now).weekNumber;
  const period = `${year}-W${String(weekNum).padStart(2, '0')}`;

  // Find existing stats record for this week
  const existing = await db.statistics.findFirst({
    where: {
      userId,
      repositoryId: null, // Global stats
      period,
    },
  });

  if (existing) {
    await db.statistics.update({
      where: { id: existing.id },
      data: { points: { increment: points } },
    });
  } else {
    await db.statistics.create({
      data: {
        userId,
        repositoryId: null,
        period,
        periodType: 'week',
        points,
      },
    });
  }
};

/**
 * Get all users who participated in a team challenge
 */
const getTeamParticipants = async (challengeId: string): Promise<string[]> => {
  const challenge = await db.challenge.findUnique({
    where: { id: challengeId },
  });

  if (!challenge) return [];

  // Get all users who completed reviews during the challenge period
  const assignments = await db.assignment.findMany({
    where: {
      status: { in: ['COMPLETED', 'APPROVED'] },
      completedAt: {
        gte: challenge.startDate,
        lte: challenge.endDate,
      },
      reviewerId: { not: null },
    },
    select: { reviewerId: true },
    distinct: ['reviewerId'],
  });

  return assignments
    .map(a => a.reviewerId)
    .filter((id): id is string => id !== null);
};

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get active challenges for a user
 */
export const getActiveChallenges = async (
  userId: string
): Promise<ActiveChallenge[]> => {
  const now = new Date();

  // Ensure weekly challenges exist
  await ensureWeeklyChallenges();

  const challenges = await db.challenge.findMany({
    where: {
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
    },
    include: {
      progress: {
        where: {
          OR: [
            { userId }, // Individual progress
            { userId: null }, // Team progress
          ],
        },
      },
    },
    orderBy: { endDate: 'asc' },
  });

  return challenges.map(c => {
    const progress = c.progress.find(p =>
      c.scope === 'TEAM' ? p.userId === null : p.userId === userId
    ) ?? null;

    const percentComplete = progress
      ? Math.min(100, Math.round((progress.currentValue / c.target) * 100))
      : 0;

    return {
      challenge: c,
      progress,
      percentComplete,
    };
  });
};

/**
 * Get user's completed challenges
 */
export const getCompletedChallenges = async (
  userId: string,
  limit = 10
): Promise<Array<{ challenge: Challenge; completedAt: Date }>> => {
  const completedProgress = await db.challengeProgress.findMany({
    where: {
      OR: [
        { userId, isCompleted: true },
        { userId: null, isCompleted: true }, // Team challenges
      ],
    },
    include: { challenge: true },
    orderBy: { completedAt: 'desc' },
    take: limit,
  });

  return completedProgress
    .filter(p => p.completedAt !== null)
    .map(p => ({
      challenge: p.challenge,
      completedAt: p.completedAt!,
    }));
};

/**
 * Get team leaderboard for a challenge
 */
export const getChallengeLeaderboard = async (
  challengeId: string,
  limit = 10
): Promise<Array<{
  userId: string;
  displayName: string;
  contribution: number;
}>> => {
  const challenge = await db.challenge.findUnique({
    where: { id: challengeId },
  });

  if (!challenge || challenge.scope !== 'TEAM') {
    return [];
  }

  // Get individual contributions during challenge period
  const contributions = await db.assignment.groupBy({
    by: ['reviewerId'],
    where: {
      status: { in: ['COMPLETED', 'APPROVED'] },
      completedAt: {
        gte: challenge.startDate,
        lte: challenge.endDate,
      },
      reviewerId: { not: null },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: limit,
  });

  // Get user details
  const userIds = contributions
    .map(c => c.reviewerId)
    .filter((id): id is string => id !== null);

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true },
  });

  const userMap = new Map(users.map(u => [u.id, u.displayName]));

  return contributions
    .filter(c => c.reviewerId !== null)
    .map(c => ({
      userId: c.reviewerId!,
      displayName: userMap.get(c.reviewerId!) ?? 'Unknown',
      contribution: c._count.id,
    }));
};

// =============================================================================
// NOTIFICATIONS
// =============================================================================

/**
 * Notify user about completed challenge
 */
export const notifyChallengeCompletion = async (
  slackId: string,
  challenge: Challenge
): Promise<void> => {
  const rewardText = challenge.rewardDesc ?? `+${challenge.rewardValue} points`;

  const message =
    `🏆 *Challenge Complete!*\n\n` +
    `You completed *${challenge.displayName}*!\n` +
    `${challenge.description}\n\n` +
    `*Reward:* ${rewardText}`;

  await postMessage(slackId, message);
};

/**
 * Notify team about completed team challenge
 */
export const notifyTeamChallengeCompletion = async (
  channelId: string,
  challenge: Challenge,
  participants: Array<{ userId: string; displayName: string; contribution: number }>
): Promise<void> => {
  const rewardText = challenge.rewardDesc ?? `+${challenge.rewardValue} points`;

  const topContributors = participants
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${p.displayName} (${p.contribution} reviews)`)
    .join('\n');

  const message =
    `🏆 *Team Challenge Complete!*\n\n` +
    `The team completed *${challenge.displayName}*!\n` +
    `${challenge.description}\n\n` +
    `*Top Contributors:*\n${topContributors}\n\n` +
    `*Reward:* ${rewardText} for all participants`;

  await postMessage(channelId, message);
};

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format challenge for Slack display
 */
export const formatChallengeDisplay = (
  active: ActiveChallenge,
  showProgress = true
): string => {
  const { challenge, progress, percentComplete } = active;
  const preset = CHALLENGE_PRESETS.find(p => p.name === challenge.name);
  const difficulty = preset?.difficulty ?? 'medium';

  const diffEmoji = getDifficultyEmoji(difficulty);
  const scopeIcon = getScopeIcon(challenge.scope);

  let display = `${scopeIcon} *${challenge.displayName}* ${diffEmoji}\n`;
  display += `${challenge.description}\n`;

  if (showProgress) {
    const current = progress?.currentValue ?? 0;
    const target = challenge.target;
    const progressBar = buildProgressBar(percentComplete);

    display += `${progressBar} ${current}/${target}`;

    if (progress?.isCompleted) {
      display += ' ✅';
    }
  }

  // Time remaining
  const now = new Date();
  const endDate = new Date(challenge.endDate);
  const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft > 0 && daysLeft <= 7) {
    display += `\n_${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining_`;
  }

  return display;
};

/**
 * Build a visual progress bar
 */
const buildProgressBar = (percent: number): string => {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
};

// =============================================================================
// API ROUTE SUPPORT
// =============================================================================

/**
 * Create a challenge from API input
 * Used by POST /api/challenges
 */
export const createChallenge = async (
  input: {
    name: string;
    description: string;
    type: string;
    target: number;
    reward: { type: string; value: number; description: string };
    startDate: Date;
    endDate: Date;
    scope: string;
    repositoryId?: string;
  },
  createdById: string
): Promise<Challenge> => {
  return db.challenge.create({
    data: {
      name: input.name,
      displayName: input.name, // Use name as display name
      description: input.description,
      type: input.type.toUpperCase() as ChallengeType,
      scope: input.scope.toUpperCase() as Challenge['scope'],
      target: input.target,
      rewardType: input.reward.type.toUpperCase() as Challenge['rewardType'],
      rewardValue: input.reward.value,
      rewardDesc: input.reward.description,
      startDate: input.startDate,
      endDate: input.endDate,
      isActive: true,
      isRecurring: false,
      createdById,
      repositoryId: input.repositoryId ?? null,
    },
  });
};

/**
 * Get active challenges, optionally filtered by repository
 * Overloaded version for API routes that takes optional repositoryId
 */
export const getActiveChallengesByRepo = async (
  repositoryId?: string
): Promise<ActiveChallenge[]> => {
  const now = new Date();

  // Ensure weekly challenges exist
  await ensureWeeklyChallenges();

  const challenges = await db.challenge.findMany({
    where: {
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
      ...(repositoryId ? { repositoryId } : {}),
    },
    include: {
      progress: true,
    },
    orderBy: { endDate: 'asc' },
  });

  return challenges.map(c => {
    // For API, we return first progress (team) or null
    const progress = c.progress.length > 0 ? c.progress[0] : null;

    const percentComplete = progress
      ? Math.min(100, Math.round((progress.currentValue / c.target) * 100))
      : 0;

    return {
      challenge: c,
      progress,
      percentComplete,
    };
  });
};

/**
 * Get a single challenge with detailed progress information
 * Used by GET /api/challenges/[id]
 */
export const getChallengeWithProgress = async (
  challengeId: string
): Promise<{
  challenge: Challenge;
  progress: ChallengeProgress[];
  totalParticipants: number;
  completedCount: number;
} | null> => {
  const challenge = await db.challenge.findUnique({
    where: { id: challengeId },
    include: {
      progress: true,
    },
  });

  if (!challenge) {
    return null;
  }

  const completedCount = challenge.progress.filter(p => p.isCompleted).length;

  // For team challenges, count unique participants
  let totalParticipants: number;
  if (challenge.scope === 'TEAM') {
    const participants = await db.assignment.findMany({
      where: {
        status: { in: ['COMPLETED', 'APPROVED'] },
        completedAt: {
          gte: challenge.startDate,
          lte: challenge.endDate,
        },
        reviewerId: { not: null },
      },
      select: { reviewerId: true },
      distinct: ['reviewerId'],
    });
    totalParticipants = participants.length;
  } else {
    totalParticipants = challenge.progress.length;
  }

  return {
    challenge,
    progress: challenge.progress,
    totalParticipants,
    completedCount,
  };
};
