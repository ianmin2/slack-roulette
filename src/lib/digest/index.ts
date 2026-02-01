/**
 * Weekly Digest Service
 *
 * Generates and sends weekly digest reports with:
 * - Period statistics summary
 * - Top reviewers leaderboard
 * - Recent achievements
 * - Repository-specific stats
 * - Week-over-week trends
 */

import { db } from '@/lib/db';
import { postMessage } from '@/lib/slack/client';
import { getPeriodString, getLeaderboard } from '@/lib/stats';
import { loggers } from '@/lib/utils/logger';
import type {
  WeeklyDigest,
  DigestSummary,
  DigestLeaderboardEntry,
  DigestSpeedChampion,
  DigestActiveChallenge,
  DigestAchievement,
  DigestRepositoryStats,
  DigestTrends,
} from '@/types';

/**
 * Get ISO week number for a date
 */
const getWeekNumber = (date: Date): number => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

/**
 * Get the start and end dates for a given week
 */
const getWeekBounds = (date: Date): { start: Date; end: Date } => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start

  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

/**
 * Get the previous week's bounds
 */
const getPreviousWeekBounds = (date: Date): { start: Date; end: Date } => {
  const previousWeek = new Date(date);
  previousWeek.setDate(previousWeek.getDate() - 7);
  return getWeekBounds(previousWeek);
};

/**
 * Calculate percentage change between two values
 */
const calculatePercentChange = (current: number, previous: number): number => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

/**
 * Generate a weekly digest for the current week
 *
 * @param repositoryId - Optional repository ID to filter stats
 * @returns WeeklyDigest object with all aggregated data
 */
export const generateWeeklyDigest = async (
  repositoryId?: string
): Promise<WeeklyDigest> => {
  const now = new Date();
  const { start: weekStart, end: weekEnd } = getWeekBounds(now);
  const { end: prevWeekEnd } = getPreviousWeekBounds(now);

  const currentPeriod = getPeriodString(now, 'week');
  const prevPeriod = getPeriodString(prevWeekEnd, 'week');

  // Build where clause for repository filtering
  const repoFilter = repositoryId ? { repositoryId } : { repositoryId: null };

  // Fetch current week statistics
  const currentStats = await db.statistics.aggregate({
    where: {
      period: currentPeriod,
      periodType: 'week',
      ...repoFilter,
    },
    _sum: {
      completed: true,
      assigned: true,
      points: true,
    },
    _avg: {
      avgResponseTime: true,
    },
    _count: {
      userId: true,
    },
  });

  // Fetch previous week statistics for trends
  const previousStats = await db.statistics.aggregate({
    where: {
      period: prevPeriod,
      periodType: 'week',
      ...repoFilter,
    },
    _sum: {
      completed: true,
      assigned: true,
    },
    _avg: {
      avgResponseTime: true,
    },
    _count: {
      userId: true,
    },
  });

  // Count unique active reviewers this week
  const activeReviewers = await db.statistics.groupBy({
    by: ['userId'],
    where: {
      period: currentPeriod,
      periodType: 'week',
      completed: { gt: 0 },
      ...repoFilter,
    },
  });

  const previousActiveReviewers = await db.statistics.groupBy({
    by: ['userId'],
    where: {
      period: prevPeriod,
      periodType: 'week',
      completed: { gt: 0 },
      ...repoFilter,
    },
  });

  // Fetch recent achievements (last 7 days)
  const recentAchievementsData = await db.userAchievement.findMany({
    where: {
      earnedAt: {
        gte: weekStart,
        lte: weekEnd,
      },
    },
    include: {
      user: true,
      achievement: true,
    },
    orderBy: {
      earnedAt: 'desc',
    },
  });

  // Get top 5 reviewers for leaderboard
  const leaderboardData = await getLeaderboard('week', 5);

  // Get previous week's leaderboard for rank change calculation
  const previousLeaderboard = await db.statistics.findMany({
    where: {
      periodType: 'week',
      period: prevPeriod,
      repositoryId: null,
    },
    include: { user: true },
    orderBy: [{ completed: 'desc' }, { avgResponseTime: 'asc' }],
    take: 10,
  });

  // Map previous ranks by userId
  const previousRanks = new Map<string, number>();
  previousLeaderboard.forEach((entry, index) => {
    previousRanks.set(entry.userId, index + 1);
  });

  // Format leaderboard entries
  const topReviewers: DigestLeaderboardEntry[] = leaderboardData.map((entry, index) => {
    const currentRank = index + 1;
    const previousRank = previousRanks.get(entry.userId);
    const rankChange = previousRank ? previousRank - currentRank : 0;

    return {
      userId: entry.userId,
      displayName: entry.user.displayName,
      slackId: entry.user.slackId,
      reviewsCompleted: entry.completed,
      avgResponseTimeMinutes: entry.avgResponseTime,
      pointsEarned: entry.points,
      rank: currentRank,
      rankChange,
    };
  });

  // Format recent achievements
  const recentAchievements: DigestAchievement[] = recentAchievementsData.map(ua => ({
    userId: ua.userId,
    displayName: ua.user.displayName,
    slackId: ua.user.slackId,
    achievementName: ua.achievement.name,
    achievementDisplayName: ua.achievement.displayName,
    achievementIcon: ua.achievement.icon,
    earnedAt: ua.earnedAt,
  }));

  // Fetch speed champions (fastest responders with minimum 2 reviews)
  const speedChampionsData = await db.statistics.findMany({
    where: {
      period: currentPeriod,
      periodType: 'week',
      repositoryId: null,
      completed: { gte: 2 }, // Minimum 2 reviews to qualify
      avgResponseTime: { not: null, gt: 0 },
    },
    include: { user: true },
    orderBy: { avgResponseTime: 'asc' },
    take: 3,
  });

  const speedChampions: DigestSpeedChampion[] = speedChampionsData.map((entry, index) => ({
    userId: entry.userId,
    displayName: entry.user.displayName,
    slackId: entry.user.slackId,
    avgResponseTimeMinutes: entry.avgResponseTime ?? 0,
    reviewsCompleted: entry.completed,
    rank: index + 1,
  }));

  // Fetch active challenges with aggregate progress
  const activeChallengesData = await db.challenge.findMany({
    where: {
      isActive: true,
      startDate: { lte: weekEnd },
      endDate: { gte: weekStart },
    },
    include: {
      progress: true,
    },
    orderBy: { endDate: 'asc' },
  });

  const activeChallenges: DigestActiveChallenge[] = await Promise.all(
    activeChallengesData.map(async challenge => {
      // Calculate aggregate progress
      const totalProgress = challenge.progress.reduce(
        (sum, p) => sum + p.currentValue,
        0
      );
      const participantCount = challenge.progress.filter(p => p.currentValue > 0).length;

      // For team challenges, use total progress; for individual, use average
      const effectiveProgress = challenge.scope === 'TEAM'
        ? totalProgress
        : participantCount > 0 ? Math.round(totalProgress / participantCount) : 0;

      const percentComplete = Math.min(
        100,
        Math.round((effectiveProgress / challenge.target) * 100)
      );

      // Find top contributor
      const topProgressEntry = challenge.progress
        .filter(p => p.userId !== null)
        .sort((a, b) => b.currentValue - a.currentValue)[0];

      let topContributor: DigestActiveChallenge['topContributor'] = null;
      if (topProgressEntry?.userId) {
        const topUser = await db.user.findUnique({
          where: { id: topProgressEntry.userId },
        });
        if (topUser) {
          topContributor = {
            displayName: topUser.displayName,
            slackId: topUser.slackId,
            progress: topProgressEntry.currentValue,
          };
        }
      }

      return {
        id: challenge.id,
        name: challenge.name,
        displayName: challenge.displayName,
        type: challenge.type,
        scope: challenge.scope,
        target: challenge.target,
        currentProgress: effectiveProgress,
        percentComplete,
        participantCount,
        topContributor,
        endsAt: challenge.endDate,
      };
    })
  );

  // Fetch repository-specific stats if not filtering by repository
  let repositoryStats: DigestRepositoryStats[] = [];
  if (!repositoryId) {
    const repoStats = await db.statistics.groupBy({
      by: ['repositoryId'],
      where: {
        period: currentPeriod,
        periodType: 'week',
        repositoryId: { not: null },
      },
      _sum: {
        completed: true,
      },
      _avg: {
        avgResponseTime: true,
      },
    });

    // Fetch repository details and top reviewers
    const repoIds = repoStats
      .map(r => r.repositoryId)
      .filter((id): id is string => id !== null);

    const repositories = await db.repository.findMany({
      where: { id: { in: repoIds } },
    });

    const repoMap = new Map(repositories.map(r => [r.id, r]));

    // Get top reviewer per repository
    for (const stat of repoStats) {
      if (!stat.repositoryId) continue;

      const repo = repoMap.get(stat.repositoryId);
      if (!repo) continue;

      const topReviewer = await db.statistics.findFirst({
        where: {
          period: currentPeriod,
          periodType: 'week',
          repositoryId: stat.repositoryId,
        },
        include: { user: true },
        orderBy: { completed: 'desc' },
      });

      repositoryStats.push({
        repositoryId: stat.repositoryId,
        fullName: repo.fullName,
        reviewsCompleted: stat._sum.completed ?? 0,
        avgResponseTimeMinutes: stat._avg.avgResponseTime
          ? Math.round(stat._avg.avgResponseTime)
          : null,
        topReviewer: topReviewer
          ? {
              displayName: topReviewer.user.displayName,
              reviewCount: topReviewer.completed,
            }
          : null,
      });
    }

    // Sort by reviews completed
    repositoryStats = repositoryStats.sort(
      (a, b) => b.reviewsCompleted - a.reviewsCompleted
    );
  }

  // Calculate trends
  const currentReviews = currentStats._sum.completed ?? 0;
  const previousReviews = previousStats._sum.completed ?? 0;
  const currentAvgResponse = currentStats._avg.avgResponseTime ?? 0;
  const previousAvgResponse = previousStats._avg.avgResponseTime ?? 0;
  const currentActiveCount = activeReviewers.length;
  const previousActiveCount = previousActiveReviewers.length;

  const trends: DigestTrends = {
    reviewsVsLastWeek: calculatePercentChange(currentReviews, previousReviews),
    responseTimeVsLastWeek: calculatePercentChange(currentAvgResponse, previousAvgResponse),
    activeReviewersVsLastWeek: calculatePercentChange(currentActiveCount, previousActiveCount),
  };

  // Calculate completion rate
  const totalAssigned = currentStats._sum.assigned ?? 0;
  const totalCompleted = currentStats._sum.completed ?? 0;
  const completionRate = totalAssigned > 0 ? totalCompleted / totalAssigned : 0;

  // Build summary
  const summary: DigestSummary = {
    totalReviews: totalCompleted,
    totalAssignments: totalAssigned,
    avgResponseTimeMinutes: currentStats._avg.avgResponseTime
      ? Math.round(currentStats._avg.avgResponseTime)
      : 0,
    completionRate,
    activeReviewers: currentActiveCount,
    newAchievementsUnlocked: recentAchievements.length,
  };

  return {
    period: {
      start: weekStart,
      end: weekEnd,
      weekNumber: getWeekNumber(now),
      year: now.getFullYear(),
    },
    summary,
    topReviewers,
    speedChampions,
    activeChallenges,
    recentAchievements,
    repositoryStats,
    trends,
  };
};

/**
 * Format a trend value with emoji indicator
 */
const formatTrend = (value: number, inverseIsGood = false): string => {
  const isPositive = inverseIsGood ? value < 0 : value > 0;
  const isNegative = inverseIsGood ? value > 0 : value < 0;

  if (isPositive) return `+${Math.abs(value)}% :arrow_up:`;
  if (isNegative) return `-${Math.abs(value)}% :arrow_down:`;
  return '0% :left_right_arrow:';
};

/**
 * Format response time in human readable format
 */
const formatResponseTime = (minutes: number | null): string => {
  if (minutes === null || minutes === 0) return 'N/A';

  if (minutes < 60) return `${minutes}min`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

/**
 * Format a progress bar using block characters
 */
const formatProgressBar = (percent: number): string => {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
};

/**
 * Format the digest for Slack markdown
 *
 * @param digest - The WeeklyDigest to format
 * @returns Formatted Slack markdown string
 */
export const formatDigestMessage = (digest: WeeklyDigest): string => {
  const {
    period,
    summary,
    topReviewers,
    speedChampions,
    activeChallenges,
    recentAchievements,
    repositoryStats,
    trends,
  } = digest;

  const lines: string[] = [];

  // Header
  lines.push(`:bar_chart: *Weekly Digest - Week ${period.weekNumber}, ${period.year}*`);
  lines.push('');

  // Summary section
  lines.push(':clipboard: *Summary*');
  lines.push(`>:white_check_mark: *Reviews Completed:* ${summary.totalReviews}`);
  lines.push(`>:inbox_tray: *Assignments:* ${summary.totalAssignments}`);
  lines.push(`>:stopwatch: *Avg Response Time:* ${formatResponseTime(summary.avgResponseTimeMinutes)}`);
  lines.push(`>:chart_with_upwards_trend: *Completion Rate:* ${Math.round(summary.completionRate * 100)}%`);
  lines.push(`>:busts_in_silhouette: *Active Reviewers:* ${summary.activeReviewers}`);
  if (summary.newAchievementsUnlocked > 0) {
    lines.push(`>:tada: *Achievements Unlocked:* ${summary.newAchievementsUnlocked}`);
  }
  lines.push('');

  // Trends section
  lines.push(':chart_with_upwards_trend: *Trends vs Last Week*');
  lines.push(`>Reviews: ${formatTrend(trends.reviewsVsLastWeek)}`);
  lines.push(`>Response Time: ${formatTrend(trends.responseTimeVsLastWeek, true)}`);
  lines.push(`>Active Reviewers: ${formatTrend(trends.activeReviewersVsLastWeek)}`);
  lines.push('');

  // Leaderboard section
  if (topReviewers.length > 0) {
    lines.push(':trophy: *Top Reviewers*');

    const medals = [':first_place_medal:', ':second_place_medal:', ':third_place_medal:'];

    topReviewers.forEach((reviewer, index) => {
      const medal = medals[index] ?? `:${index + 1}:`;
      const rankChange =
        reviewer.rankChange > 0
          ? ` (:arrow_up: ${reviewer.rankChange})`
          : reviewer.rankChange < 0
          ? ` (:arrow_down: ${Math.abs(reviewer.rankChange)})`
          : '';

      const avgTime = formatResponseTime(reviewer.avgResponseTimeMinutes);

      lines.push(
        `>${medal} <@${reviewer.slackId}> - *${reviewer.reviewsCompleted}* reviews (avg ${avgTime})${rankChange}`
      );
    });
    lines.push('');
  }

  // Speed Champions section
  if (speedChampions.length > 0) {
    lines.push(':zap: *Speed Champions*');
    lines.push('_Fastest responders this week (min 2 reviews)_');

    const speedMedals = [':racing_car:', ':rocket:', ':athletic_shoe:'];

    speedChampions.forEach((champion, index) => {
      const icon = speedMedals[index] ?? ':star:';
      const avgTime = formatResponseTime(champion.avgResponseTimeMinutes);

      lines.push(
        `>${icon} <@${champion.slackId}> - avg *${avgTime}* (${champion.reviewsCompleted} reviews)`
      );
    });
    lines.push('');
  }

  // Active Challenges section
  if (activeChallenges.length > 0) {
    lines.push(':dart: *Active Challenges*');

    activeChallenges.forEach(challenge => {
      const progressBar = formatProgressBar(challenge.percentComplete);
      const daysLeft = Math.ceil(
        (challenge.endsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      const daysText = daysLeft === 1 ? '1 day left' : `${daysLeft} days left`;

      const scopeIcon = challenge.scope === 'TEAM' ? ':busts_in_silhouette:' : ':bust_in_silhouette:';

      lines.push(`>${scopeIcon} *${challenge.displayName}*`);
      lines.push(`>    ${progressBar} ${challenge.percentComplete}% (${daysText})`);

      if (challenge.topContributor && challenge.scope === 'TEAM') {
        lines.push(
          `>    :star: Top contributor: <@${challenge.topContributor.slackId}> (${challenge.topContributor.progress})`
        );
      }
    });
    lines.push('');
  }

  // Repository stats section
  if (repositoryStats.length > 0) {
    lines.push(':file_folder: *Repository Activity*');

    const topRepos = repositoryStats.slice(0, 5);
    topRepos.forEach(repo => {
      const avgTime = formatResponseTime(repo.avgResponseTimeMinutes);
      const topReviewerInfo = repo.topReviewer
        ? ` | Top: ${repo.topReviewer.displayName} (${repo.topReviewer.reviewCount})`
        : '';

      lines.push(
        `>*${repo.fullName}*: ${repo.reviewsCompleted} reviews (avg ${avgTime})${topReviewerInfo}`
      );
    });
    lines.push('');
  }

  // Recent achievements section
  if (recentAchievements.length > 0) {
    lines.push(':tada: *Recent Achievements*');

    const uniqueAchievements = recentAchievements.slice(0, 5);
    uniqueAchievements.forEach(achievement => {
      lines.push(
        `>${achievement.achievementIcon} <@${achievement.slackId}> unlocked *${achievement.achievementDisplayName}*`
      );
    });
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('_Keep up the great work! :rocket:_');

  return lines.join('\n');
};

/**
 * Send the weekly digest to a Slack channel
 *
 * @param channelId - Slack channel ID to send to
 * @param digest - The WeeklyDigest to send
 */
export const sendWeeklyDigest = async (
  channelId: string,
  digest: WeeklyDigest
): Promise<void> => {
  const message = formatDigestMessage(digest);

  const result = await postMessage(channelId, message, {
    unfurl_links: false,
  });

  if (!result) {
    throw new Error(`Failed to send weekly digest to channel ${channelId}`);
  }

  loggers.digest.info('Weekly digest sent', { channelId, messageTs: result.ts });
};
