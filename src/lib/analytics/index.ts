/**
 * Analytics Service
 *
 * Advanced analytics for PR Roulette including:
 * - Review metrics (completion rates, counts)
 * - Response time analytics (percentiles, distribution)
 * - Workload distribution (Gini coefficient, top-heavy ratio)
 * - Skills analytics (demand, gaps, coverage)
 * - Trend data (daily/weekly aggregations)
 */

import { db } from '@/lib/db';
import type {
  AnalyticsDashboard,
  AnalyticsQuery,
  ReviewMetrics,
  ResponseTimeAnalytics,
  ResponseTimeDistribution,
  WorkloadDistribution,
  UserWorkload,
  RepositoryWorkload,
  SkillsAnalytics,
  SkillDemand,
  SkillGap,
  TrendDataPoint,
  BottleneckReport,
  SlowResponderBottleneck,
  OverloadedRepoBottleneck,
  OverloadedUserBottleneck,
  SkillGapBottleneck,
  BottleneckSeverity,
  BottleneckSummary,
  UserGrowthReport,
  GrowthMetrics,
  GrowthTrends,
  TrendValue,
  GrowthMilestone,
  MilestoneType,
} from '@/types';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate percentile from sorted array of values
 * Uses linear interpolation for values between array indices
 *
 * @param values - Array of numeric values (will be sorted in place)
 * @param p - Percentile to calculate (0-100)
 * @returns The value at the given percentile
 */
export const calculatePercentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  // Sort ascending
  values.sort((a, b) => a - b);

  // Calculate index
  const index = (p / 100) * (values.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  // Linear interpolation
  if (lower === upper) return values[lower];
  return values[lower] * (1 - weight) + values[upper] * weight;
};

/**
 * Calculate Gini coefficient for workload distribution
 * Formula: G = (2 * sum(i * x[i]) / (n * sum(x))) - (n+1)/n
 *
 * @param values - Array of workload values (e.g., number of reviews per person)
 * @returns Gini coefficient (0 = perfect equality, 1 = perfect inequality)
 */
export const calculateGiniCoefficient = (values: number[]): number => {
  if (values.length === 0) return 0;
  if (values.length === 1) return 0;

  // Sort ascending
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const totalSum = sorted.reduce((sum, x) => sum + x, 0);

  if (totalSum === 0) return 0;

  // Calculate sum of (i * x[i]) where i is 1-indexed
  const weightedSum = sorted.reduce((sum, x, i) => sum + (i + 1) * x, 0);

  // Gini formula
  return (2 * weightedSum) / (n * totalSum) - (n + 1) / n;
};

/**
 * Convert response time in minutes to bucket label
 */
const getResponseTimeBucket = (minutes: number): string => {
  if (minutes < 30) return '< 30 min';
  if (minutes < 60) return '30-60 min';
  if (minutes < 120) return '1-2 hours';
  if (minutes < 240) return '2-4 hours';
  if (minutes < 480) return '4-8 hours';
  return '> 8 hours';
};

/**
 * Get the bucket order for sorting
 */
const BUCKET_ORDER = [
  '< 30 min',
  '30-60 min',
  '1-2 hours',
  '2-4 hours',
  '4-8 hours',
  '> 8 hours',
];

/**
 * Get date range for a period
 */
const getDateRangeForPeriod = (
  period: 'day' | 'week' | 'month' | 'quarter' | 'year',
  startDate?: Date,
  endDate?: Date
): { start: Date; end: Date } => {
  const now = new Date();
  const end = endDate ?? now;

  if (startDate) {
    return { start: startDate, end };
  }

  const start = new Date(end);
  switch (period) {
    case 'day':
      start.setDate(start.getDate() - 1);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case 'month':
      start.setMonth(start.getMonth() - 1);
      break;
    case 'quarter':
      start.setMonth(start.getMonth() - 3);
      break;
    case 'year':
      start.setFullYear(start.getFullYear() - 1);
      break;
  }

  return { start, end };
};

// =============================================================================
// REVIEW METRICS
// =============================================================================

/**
 * Get review metrics for a date range
 */
export const getReviewMetrics = async (
  startDate: Date,
  endDate: Date,
  repoId?: string
): Promise<ReviewMetrics> => {
  const whereClause = {
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
    ...(repoId ? { repositoryId: repoId } : {}),
  };

  // Get counts by status
  const [total, completed, pending, declined, reassigned] = await Promise.all([
    db.assignment.count({ where: whereClause }),
    db.assignment.count({
      where: { ...whereClause, status: { in: ['COMPLETED', 'APPROVED'] } },
    }),
    db.assignment.count({
      where: { ...whereClause, status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW'] } },
    }),
    db.assignment.count({
      where: { ...whereClause, status: 'SKIPPED' },
    }),
    // Reassigned = count of assignments where reviewerId changed (approximated by SKIPPED + re-created)
    db.assignment.count({
      where: { ...whereClause, status: 'EXPIRED' },
    }),
  ]);

  // Calculate average time to completion
  const completedAssignments = await db.assignment.findMany({
    where: {
      ...whereClause,
      status: { in: ['COMPLETED', 'APPROVED'] },
      assignedAt: { not: null },
      completedAt: { not: null },
    },
    select: {
      assignedAt: true,
      completedAt: true,
    },
  });

  let avgTimeToCompletion = 0;
  if (completedAssignments.length > 0) {
    const totalMinutes = completedAssignments.reduce((sum, a) => {
      if (!a.assignedAt || !a.completedAt) return sum;
      return sum + (a.completedAt.getTime() - a.assignedAt.getTime()) / 60000;
    }, 0);
    avgTimeToCompletion = Math.round(totalMinutes / completedAssignments.length);
  }

  const completionRate = total > 0 ? completed / total : 0;

  return {
    total,
    completed,
    pending,
    declined,
    reassigned,
    completionRate,
    avgTimeToCompletion,
  };
};

// =============================================================================
// RESPONSE TIME ANALYTICS
// =============================================================================

/**
 * Get response time analytics with percentiles and distribution
 */
export const getResponseTimeAnalytics = async (
  startDate: Date,
  endDate: Date
): Promise<ResponseTimeAnalytics> => {
  // Get all completed assignments with response times
  const assignments = await db.assignment.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      status: { in: ['COMPLETED', 'APPROVED'] },
      assignedAt: { not: null },
      firstResponseAt: { not: null },
    },
    select: {
      assignedAt: true,
      firstResponseAt: true,
    },
  });

  // Calculate response times in minutes
  const responseTimes = assignments
    .filter(a => a.assignedAt && a.firstResponseAt)
    .map(a => (a.firstResponseAt!.getTime() - a.assignedAt!.getTime()) / 60000);

  if (responseTimes.length === 0) {
    return {
      avgMinutes: 0,
      medianMinutes: 0,
      p90Minutes: 0,
      p99Minutes: 0,
      fastestMinutes: 0,
      slowestMinutes: 0,
      distribution: BUCKET_ORDER.map(bucket => ({
        bucket,
        count: 0,
        percentage: 0,
      })),
    };
  }

  // Calculate statistics
  const sortedTimes = [...responseTimes].sort((a, b) => a - b);
  const avgMinutes = Math.round(
    responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length
  );

  // Calculate distribution buckets
  const bucketCounts = new Map<string, number>();
  BUCKET_ORDER.forEach(b => bucketCounts.set(b, 0));

  responseTimes.forEach(time => {
    const bucket = getResponseTimeBucket(time);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  });

  const distribution: ResponseTimeDistribution[] = BUCKET_ORDER.map(bucket => ({
    bucket,
    count: bucketCounts.get(bucket) ?? 0,
    percentage: ((bucketCounts.get(bucket) ?? 0) / responseTimes.length) * 100,
  }));

  return {
    avgMinutes,
    medianMinutes: Math.round(calculatePercentile(sortedTimes, 50)),
    p90Minutes: Math.round(calculatePercentile(sortedTimes, 90)),
    p99Minutes: Math.round(calculatePercentile(sortedTimes, 99)),
    fastestMinutes: Math.round(sortedTimes[0]),
    slowestMinutes: Math.round(sortedTimes[sortedTimes.length - 1]),
    distribution,
  };
};

// =============================================================================
// WORKLOAD DISTRIBUTION
// =============================================================================

/**
 * Get workload distribution analysis
 */
export const getWorkloadDistribution = async (
  startDate: Date,
  endDate: Date
): Promise<WorkloadDistribution> => {
  const whereClause = {
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
  };

  // Get user workloads
  const userStats = await db.assignment.groupBy({
    by: ['reviewerId'],
    where: {
      ...whereClause,
      reviewerId: { not: null },
    },
    _count: {
      id: true,
    },
  });

  // Get user details and calculate workloads
  const userWorkloads: UserWorkload[] = [];

  for (const stat of userStats) {
    if (!stat.reviewerId) continue;

    const [user, completed, pending, avgStats] = await Promise.all([
      db.user.findUnique({
        where: { id: stat.reviewerId },
        select: { id: true, displayName: true },
      }),
      db.assignment.count({
        where: {
          ...whereClause,
          reviewerId: stat.reviewerId,
          status: { in: ['COMPLETED', 'APPROVED'] },
        },
      }),
      db.assignment.count({
        where: {
          reviewerId: stat.reviewerId,
          status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW'] },
        },
      }),
      db.statistics.findFirst({
        where: { userId: stat.reviewerId, repositoryId: null },
        orderBy: { period: 'desc' },
        select: { avgResponseTime: true },
      }),
    ]);

    if (!user) continue;

    // Get max concurrent from any repository setting (use highest)
    const maxConcurrent = await db.repositoryReviewer.findFirst({
      where: { userId: stat.reviewerId, isActive: true },
      orderBy: { maxConcurrent: 'desc' },
      select: { maxConcurrent: true },
    });

    const maxConcurrentValue = maxConcurrent?.maxConcurrent ?? 5;
    const utilizationRate = pending / maxConcurrentValue;

    userWorkloads.push({
      userId: user.id,
      displayName: user.displayName,
      assigned: stat._count.id,
      completed,
      pending,
      avgResponseTime: avgStats?.avgResponseTime ?? null,
      utilizationRate: Math.min(utilizationRate, 1),
    });
  }

  // Sort by assigned descending
  userWorkloads.sort((a, b) => b.assigned - a.assigned);

  // Get repository workloads
  const repoStats = await db.assignment.groupBy({
    by: ['repositoryId'],
    where: whereClause,
    _count: {
      id: true,
    },
  });

  const repositoryWorkloads: RepositoryWorkload[] = [];

  for (const stat of repoStats) {
    const [repo, completed, pending, reviewerCount] = await Promise.all([
      db.repository.findUnique({
        where: { id: stat.repositoryId },
        select: { id: true, fullName: true },
      }),
      db.assignment.count({
        where: {
          ...whereClause,
          repositoryId: stat.repositoryId,
          status: { in: ['COMPLETED', 'APPROVED'] },
        },
      }),
      db.assignment.count({
        where: {
          repositoryId: stat.repositoryId,
          status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW'] },
        },
      }),
      db.repositoryReviewer.count({
        where: { repositoryId: stat.repositoryId, isActive: true },
      }),
    ]);

    if (!repo) continue;

    // Calculate avg response time for repo
    const repoAssignments = await db.assignment.findMany({
      where: {
        ...whereClause,
        repositoryId: stat.repositoryId,
        status: { in: ['COMPLETED', 'APPROVED'] },
        assignedAt: { not: null },
        firstResponseAt: { not: null },
      },
      select: {
        assignedAt: true,
        firstResponseAt: true,
      },
    });

    let avgResponseTime: number | null = null;
    if (repoAssignments.length > 0) {
      const totalMinutes = repoAssignments.reduce((sum, a) => {
        if (!a.assignedAt || !a.firstResponseAt) return sum;
        return sum + (a.firstResponseAt.getTime() - a.assignedAt.getTime()) / 60000;
      }, 0);
      avgResponseTime = Math.round(totalMinutes / repoAssignments.length);
    }

    repositoryWorkloads.push({
      repositoryId: repo.id,
      fullName: repo.fullName,
      assigned: stat._count.id,
      completed,
      pending,
      reviewerCount,
      avgResponseTime,
    });
  }

  // Sort by assigned descending
  repositoryWorkloads.sort((a, b) => b.assigned - a.assigned);

  // Calculate Gini coefficient
  const workloadValues = userWorkloads.map(u => u.assigned);
  const giniCoefficient = calculateGiniCoefficient(workloadValues);

  // Calculate top-heavy ratio (% of work done by top 20% of reviewers)
  let topHeavyRatio = 0;
  if (userWorkloads.length > 0) {
    const sortedByAssigned = [...userWorkloads].sort((a, b) => b.assigned - a.assigned);
    const totalWork = sortedByAssigned.reduce((sum, u) => sum + u.assigned, 0);
    const top20Count = Math.max(1, Math.ceil(sortedByAssigned.length * 0.2));
    const top20Work = sortedByAssigned.slice(0, top20Count).reduce((sum, u) => sum + u.assigned, 0);
    topHeavyRatio = totalWork > 0 ? top20Work / totalWork : 0;
  }

  return {
    byUser: userWorkloads,
    byRepository: repositoryWorkloads,
    giniCoefficient,
    topHeavyRatio,
  };
};

// =============================================================================
// SKILLS ANALYTICS
// =============================================================================

/**
 * Get skills analytics (demand, gaps, coverage)
 */
const getSkillsAnalytics = async (
  startDate: Date,
  endDate: Date
): Promise<SkillsAnalytics> => {
  // Get all assignments with skills required
  const assignments = await db.assignment.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      skillsRequired: { isEmpty: false },
    },
    select: {
      skillsRequired: true,
    },
  });

  // Count skill demand
  const skillDemandMap = new Map<string, number>();
  assignments.forEach(a => {
    a.skillsRequired.forEach(skill => {
      skillDemandMap.set(skill, (skillDemandMap.get(skill) ?? 0) + 1);
    });
  });

  // Get reviewer counts per skill
  const skills = await db.skill.findMany({
    include: {
      users: true,
    },
  });

  const skillReviewerMap = new Map<string, number>();
  skills.forEach(skill => {
    skillReviewerMap.set(skill.name, skill.users.length);
  });

  // Build top skills and skill gaps
  const topSkills: SkillDemand[] = [];
  const skillGaps: SkillGap[] = [];

  skillDemandMap.forEach((requestCount, skillName) => {
    const reviewerCount = skillReviewerMap.get(skillName) ?? 0;
    const demandRatio = reviewerCount > 0 ? requestCount / reviewerCount : requestCount;

    topSkills.push({
      skillName,
      requestCount,
      reviewerCount,
      demandRatio,
    });

    // Identify gaps
    if (reviewerCount === 0 || demandRatio > 3) {
      const severity: 'low' | 'medium' | 'high' | 'critical' =
        reviewerCount === 0
          ? 'critical'
          : demandRatio > 10
            ? 'high'
            : demandRatio > 5
              ? 'medium'
              : 'low';

      skillGaps.push({
        skillName,
        requestCount,
        reviewerCount,
        severity,
      });
    }
  });

  // Sort top skills by demand
  topSkills.sort((a, b) => b.requestCount - a.requestCount);

  // Sort skill gaps by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  skillGaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Calculate coverage
  const requestedSkills = new Set(skillDemandMap.keys());
  const coveredSkills = Array.from(requestedSkills).filter(
    skill => (skillReviewerMap.get(skill) ?? 0) > 0
  );
  const skillCoverage = requestedSkills.size > 0
    ? coveredSkills.length / requestedSkills.size
    : 1;

  return {
    topSkills: topSkills.slice(0, 10),
    skillGaps,
    skillCoverage,
  };
};

// =============================================================================
// TREND DATA
// =============================================================================

/**
 * Get trend data points grouped by day or week
 */
export const getTrendData = async (
  startDate: Date,
  endDate: Date,
  granularity: 'day' | 'week'
): Promise<TrendDataPoint[]> => {
  const trendData: TrendDataPoint[] = [];

  // Calculate number of periods
  const msPerDay = 24 * 60 * 60 * 1000;
  const msPerWeek = 7 * msPerDay;
  const periodMs = granularity === 'day' ? msPerDay : msPerWeek;

  let currentStart = new Date(startDate);

  while (currentStart < endDate) {
    const periodEnd = new Date(Math.min(currentStart.getTime() + periodMs, endDate.getTime()));

    const whereClause = {
      createdAt: {
        gte: currentStart,
        lt: periodEnd,
      },
    };

    // Get metrics for this period
    const [totalAssignments, completedAssignments, activeReviewerIds] = await Promise.all([
      db.assignment.count({ where: whereClause }),
      db.assignment.findMany({
        where: {
          ...whereClause,
          status: { in: ['COMPLETED', 'APPROVED'] },
          assignedAt: { not: null },
          firstResponseAt: { not: null },
        },
        select: {
          assignedAt: true,
          firstResponseAt: true,
        },
      }),
      db.assignment.groupBy({
        by: ['reviewerId'],
        where: {
          ...whereClause,
          reviewerId: { not: null },
        },
      }),
    ]);

    // Calculate avg response time
    let avgResponseTime = 0;
    if (completedAssignments.length > 0) {
      const totalMinutes = completedAssignments.reduce((sum, a) => {
        if (!a.assignedAt || !a.firstResponseAt) return sum;
        return sum + (a.firstResponseAt.getTime() - a.assignedAt.getTime()) / 60000;
      }, 0);
      avgResponseTime = Math.round(totalMinutes / completedAssignments.length);
    }

    // Calculate completion rate
    const completedCount = await db.assignment.count({
      where: {
        ...whereClause,
        status: { in: ['COMPLETED', 'APPROVED'] },
      },
    });
    const completionRate = totalAssignments > 0 ? completedCount / totalAssignments : 0;

    trendData.push({
      date: currentStart,
      reviews: totalAssignments,
      avgResponseTime,
      activeReviewers: activeReviewerIds.length,
      completionRate,
    });

    currentStart = periodEnd;
  }

  return trendData;
};

// =============================================================================
// MAIN DASHBOARD FUNCTION
// =============================================================================

/**
 * Get complete analytics dashboard
 */
export const getAnalyticsDashboard = async (
  query: AnalyticsQuery
): Promise<AnalyticsDashboard> => {
  const { start, end } = getDateRangeForPeriod(query.period, query.startDate, query.endDate);

  // Determine granularity based on date range
  const daysDiff = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  const granularity: 'day' | 'week' = daysDiff <= 14 ? 'day' : 'week';

  // Fetch all analytics in parallel
  const [reviewMetrics, responseTimeAnalytics, workloadDistribution, skillsAnalytics, trendData] =
    await Promise.all([
      getReviewMetrics(start, end, query.repositoryId),
      getResponseTimeAnalytics(start, end),
      getWorkloadDistribution(start, end),
      getSkillsAnalytics(start, end),
      getTrendData(start, end, granularity),
    ]);

  return {
    dateRange: {
      start,
      end,
    },
    reviewMetrics,
    responseTimeAnalytics,
    workloadDistribution,
    skillsAnalytics,
    trendData,
  };
};

// =============================================================================
// BOTTLENECK DETECTION
// =============================================================================

/**
 * Thresholds for bottleneck severity determination
 */
const BOTTLENECK_THRESHOLDS = {
  // Response time ratio thresholds (user avg / team avg)
  slowResponder: {
    low: 1.5,      // 50% slower than average
    medium: 2.0,   // 2x slower
    high: 3.0,     // 3x slower
    critical: 5.0, // 5x slower
  },
  // Utilization rate thresholds
  overloadedUser: {
    low: 0.7,      // 70% utilized
    medium: 0.85,  // 85% utilized
    high: 0.95,    // 95% utilized
    critical: 1.0, // At or over capacity
  },
  // Reviews per reviewer for overloaded repos
  overloadedRepo: {
    low: 3,
    medium: 5,
    high: 8,
    critical: 12,
  },
  // Skill gap demand ratio (requests / reviewers)
  skillGap: {
    low: 2,
    medium: 4,
    high: 8,
    critical: 999, // No reviewers
  },
};

/**
 * Determine severity based on value and thresholds
 */
const getSeverity = (
  value: number,
  thresholds: { low: number; medium: number; high: number; critical: number }
): BottleneckSeverity => {
  if (value >= thresholds.critical) return 'critical';
  if (value >= thresholds.high) return 'high';
  if (value >= thresholds.medium) return 'medium';
  if (value >= thresholds.low) return 'low';
  return 'low'; // Below threshold, but still flagged
};

/**
 * Detect slow responders - users with response times significantly above team average
 */
export const detectSlowResponders = async (
  startDate: Date,
  endDate: Date
): Promise<SlowResponderBottleneck[]> => {
  // Get all users with statistics for the period
  const userStats = await db.statistics.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      repositoryId: null,
      avgResponseTime: { not: null, gt: 0 },
      completed: { gte: 2 }, // Minimum reviews to be relevant
    },
    include: {
      user: true,
    },
    orderBy: { avgResponseTime: 'desc' },
  });

  if (userStats.length < 2) return []; // Need multiple users to compare

  // Calculate team average
  const responseTimes = userStats
    .map(s => s.avgResponseTime)
    .filter((t): t is number => t !== null);
  const teamAvg = responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length;

  // Identify slow responders (>50% above team average)
  const slowResponders: SlowResponderBottleneck[] = [];

  for (const stat of userStats) {
    if (!stat.avgResponseTime) continue;

    const ratio = stat.avgResponseTime / teamAvg;
    if (ratio < BOTTLENECK_THRESHOLDS.slowResponder.low) continue;

    const severity = getSeverity(ratio, BOTTLENECK_THRESHOLDS.slowResponder);

    const recommendation = severity === 'critical'
      ? `Consider redistributing workload from ${stat.user.displayName} or providing support`
      : severity === 'high'
        ? `Review ${stat.user.displayName}'s workload and capacity`
        : `Monitor ${stat.user.displayName}'s response patterns`;

    slowResponders.push({
      userId: stat.userId,
      displayName: stat.user.displayName,
      slackId: stat.user.slackId,
      avgResponseTimeMinutes: Math.round(stat.avgResponseTime),
      teamAvgResponseTimeMinutes: Math.round(teamAvg),
      responseTimeRatio: Math.round(ratio * 100) / 100,
      reviewsCompleted: stat.completed,
      severity,
      recommendation,
    });
  }

  // Sort by severity (critical first) then by response time
  const severityOrder: Record<BottleneckSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  slowResponders.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.avgResponseTimeMinutes - a.avgResponseTimeMinutes;
  });

  return slowResponders;
};

/**
 * Detect overloaded repositories - repos with high pending reviews or slow response times
 */
export const detectOverloadedRepos = async (): Promise<OverloadedRepoBottleneck[]> => {
  // Get all active repositories (not soft-deleted)
  const repos = await db.repository.findMany({
    where: { deletedAt: null },
    include: {
      reviewers: { where: { isActive: true } },
    },
  });

  const overloadedRepos: OverloadedRepoBottleneck[] = [];

  for (const repo of repos) {
    // Get pending reviews count
    const pendingCount = await db.assignment.count({
      where: {
        repositoryId: repo.id,
        status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW'] },
      },
    });

    // Get average response time for recent completions
    const recentCompletions = await db.assignment.findMany({
      where: {
        repositoryId: repo.id,
        status: { in: ['COMPLETED', 'APPROVED'] },
        assignedAt: { not: null },
        firstResponseAt: { not: null },
        completedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
      },
      select: {
        assignedAt: true,
        firstResponseAt: true,
      },
    });

    let avgResponseTime: number | null = null;
    if (recentCompletions.length > 0) {
      const totalMinutes = recentCompletions.reduce((sum, a) => {
        if (!a.assignedAt || !a.firstResponseAt) return sum;
        return sum + (a.firstResponseAt.getTime() - a.assignedAt.getTime()) / 60000;
      }, 0);
      avgResponseTime = Math.round(totalMinutes / recentCompletions.length);
    }

    const reviewerCount = repo.reviewers.length;
    const reviewsPerReviewer = reviewerCount > 0 ? pendingCount / reviewerCount : pendingCount;

    // Skip if not overloaded
    if (reviewsPerReviewer < BOTTLENECK_THRESHOLDS.overloadedRepo.low && pendingCount < 3) {
      continue;
    }

    const severity = getSeverity(reviewsPerReviewer, BOTTLENECK_THRESHOLDS.overloadedRepo);

    let recommendation: string;
    if (reviewerCount === 0) {
      recommendation = `Add reviewers to ${repo.fullName} - currently no active reviewers`;
    } else if (severity === 'critical') {
      recommendation = `Urgently redistribute pending reviews in ${repo.fullName} or add more reviewers`;
    } else if (severity === 'high') {
      recommendation = `Consider adding reviewers to ${repo.fullName} or redistributing workload`;
    } else {
      recommendation = `Monitor review backlog in ${repo.fullName}`;
    }

    overloadedRepos.push({
      repositoryId: repo.id,
      fullName: repo.fullName,
      pendingReviews: pendingCount,
      avgResponseTimeMinutes: avgResponseTime,
      reviewerCount,
      reviewsPerReviewer: Math.round(reviewsPerReviewer * 10) / 10,
      severity: reviewerCount === 0 ? 'critical' : severity,
      recommendation,
    });
  }

  // Sort by severity then pending count
  const severityOrder: Record<BottleneckSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  overloadedRepos.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.pendingReviews - a.pendingReviews;
  });

  return overloadedRepos;
};

/**
 * Detect overloaded users - users at or near their capacity
 */
export const detectOverloadedUsers = async (): Promise<OverloadedUserBottleneck[]> => {
  // Get all users with pending assignments
  const usersWithPending = await db.assignment.groupBy({
    by: ['reviewerId'],
    where: {
      reviewerId: { not: null },
      status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW'] },
    },
    _count: { id: true },
  });

  const overloadedUsers: OverloadedUserBottleneck[] = [];

  for (const userStat of usersWithPending) {
    if (!userStat.reviewerId) continue;

    const [user, maxConcurrentSetting, avgStats] = await Promise.all([
      db.user.findUnique({
        where: { id: userStat.reviewerId },
        select: { id: true, displayName: true, slackId: true },
      }),
      db.repositoryReviewer.findFirst({
        where: { userId: userStat.reviewerId, isActive: true },
        orderBy: { maxConcurrent: 'desc' },
        select: { maxConcurrent: true },
      }),
      db.statistics.findFirst({
        where: { userId: userStat.reviewerId, repositoryId: null },
        orderBy: { period: 'desc' },
        select: { avgResponseTime: true },
      }),
    ]);

    if (!user) continue;

    const maxConcurrent = maxConcurrentSetting?.maxConcurrent ?? 5;
    const pendingCount = userStat._count.id;
    const utilizationRate = pendingCount / maxConcurrent;

    // Skip if not overloaded
    if (utilizationRate < BOTTLENECK_THRESHOLDS.overloadedUser.low) continue;

    const severity = getSeverity(utilizationRate, BOTTLENECK_THRESHOLDS.overloadedUser);

    let recommendation: string;
    if (utilizationRate >= 1) {
      recommendation = `${user.displayName} is at capacity - redistribute new assignments`;
    } else if (severity === 'high') {
      recommendation = `${user.displayName} is near capacity - limit new assignments`;
    } else {
      recommendation = `Monitor ${user.displayName}'s workload`;
    }

    overloadedUsers.push({
      userId: user.id,
      displayName: user.displayName,
      slackId: user.slackId,
      pendingReviews: pendingCount,
      maxConcurrent,
      utilizationRate: Math.round(utilizationRate * 100) / 100,
      avgResponseTimeMinutes: avgStats?.avgResponseTime ? Math.round(avgStats.avgResponseTime) : null,
      severity,
      recommendation,
    });
  }

  // Sort by severity then utilization
  const severityOrder: Record<BottleneckSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  overloadedUsers.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.utilizationRate - a.utilizationRate;
  });

  return overloadedUsers;
};

/**
 * Detect skill gap bottlenecks - skills in high demand with few reviewers
 */
export const detectSkillGapBottlenecks = async (): Promise<SkillGapBottleneck[]> => {
  // Get pending assignments with skills
  const pendingWithSkills = await db.assignment.findMany({
    where: {
      status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW'] },
      skillsRequired: { isEmpty: false },
    },
    select: { skillsRequired: true },
  });

  // Count skill demand in pending reviews
  const pendingSkillCounts = new Map<string, number>();
  pendingWithSkills.forEach(a => {
    a.skillsRequired.forEach(skill => {
      pendingSkillCounts.set(skill, (pendingSkillCounts.get(skill) ?? 0) + 1);
    });
  });

  // Get all skills with reviewer counts
  const skills = await db.skill.findMany({
    include: {
      users: { where: { user: { availabilityStatus: 'AVAILABLE' } } },
    },
  });

  const skillReviewerMap = new Map<string, number>();
  skills.forEach(skill => {
    skillReviewerMap.set(skill.name, skill.users.length);
  });

  const skillGapBottlenecks: SkillGapBottleneck[] = [];

  pendingSkillCounts.forEach((pendingCount, skillName) => {
    const reviewerCount = skillReviewerMap.get(skillName) ?? 0;
    const demandRatio = reviewerCount > 0 ? pendingCount / reviewerCount : 999;

    // Skip if not a bottleneck
    if (demandRatio < BOTTLENECK_THRESHOLDS.skillGap.low) return;

    const severity: BottleneckSeverity = reviewerCount === 0
      ? 'critical'
      : getSeverity(demandRatio, BOTTLENECK_THRESHOLDS.skillGap);

    let recommendation: string;
    if (reviewerCount === 0) {
      recommendation = `No reviewers available for "${skillName}" - train or recruit urgently`;
    } else if (severity === 'critical' || severity === 'high') {
      recommendation = `Expand "${skillName}" skill coverage - ${pendingCount} pending with only ${reviewerCount} reviewers`;
    } else {
      recommendation = `Consider adding more "${skillName}" reviewers`;
    }

    skillGapBottlenecks.push({
      skillName,
      requestCount: pendingCount,
      reviewerCount,
      pendingWithSkill: pendingCount,
      severity,
      recommendation,
    });
  });

  // Sort by severity then pending count
  const severityOrder: Record<BottleneckSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  skillGapBottlenecks.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.pendingWithSkill - a.pendingWithSkill;
  });

  return skillGapBottlenecks;
};

/**
 * Generate comprehensive bottleneck report
 */
export const generateBottleneckReport = async (
  period: 'week' | 'month' = 'week'
): Promise<BottleneckReport> => {
  const now = new Date();
  const start = new Date(now);
  if (period === 'week') {
    start.setDate(start.getDate() - 7);
  } else {
    start.setMonth(start.getMonth() - 1);
  }

  // Detect all bottleneck types in parallel
  const [slowResponders, overloadedRepos, overloadedUsers, skillGapBottlenecks] = await Promise.all([
    detectSlowResponders(start, now),
    detectOverloadedRepos(),
    detectOverloadedUsers(),
    detectSkillGapBottlenecks(),
  ]);

  // Calculate summary
  const allBottlenecks = [
    ...slowResponders,
    ...overloadedRepos,
    ...overloadedUsers,
    ...skillGapBottlenecks,
  ];

  const severityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  allBottlenecks.forEach(b => {
    severityCounts[b.severity]++;
  });

  // Get top recommendations (prioritize critical and high severity)
  const topRecommendations: string[] = [];
  const severityOrder: BottleneckSeverity[] = ['critical', 'high', 'medium', 'low'];

  for (const severity of severityOrder) {
    if (topRecommendations.length >= 5) break;

    const bottlenecksOfSeverity = allBottlenecks.filter(b => b.severity === severity);
    for (const b of bottlenecksOfSeverity) {
      if (topRecommendations.length >= 5) break;
      if (!topRecommendations.includes(b.recommendation)) {
        topRecommendations.push(b.recommendation);
      }
    }
  }

  const summary: BottleneckSummary = {
    totalBottlenecks: allBottlenecks.length,
    criticalCount: severityCounts.critical,
    highCount: severityCounts.high,
    mediumCount: severityCounts.medium,
    lowCount: severityCounts.low,
    topRecommendations,
  };

  return {
    generatedAt: now,
    period: {
      start,
      end: now,
    },
    slowResponders,
    overloadedRepos,
    overloadedUsers,
    skillGapBottlenecks,
    summary,
  };
};

/**
 * Format bottleneck report for Slack
 */
export const formatBottleneckReportForSlack = (report: BottleneckReport): string => {
  const lines: string[] = [];

  // Header
  lines.push(':warning: *Bottleneck Detection Report*');
  lines.push(`_Generated ${report.generatedAt.toISOString().split('T')[0]}_`);
  lines.push('');

  // Summary
  lines.push(':bar_chart: *Summary*');
  if (report.summary.totalBottlenecks === 0) {
    lines.push('>:white_check_mark: No bottlenecks detected! Great work!');
  } else {
    lines.push(`>Total issues: *${report.summary.totalBottlenecks}*`);
    if (report.summary.criticalCount > 0) {
      lines.push(`>:rotating_light: Critical: *${report.summary.criticalCount}*`);
    }
    if (report.summary.highCount > 0) {
      lines.push(`>:red_circle: High: *${report.summary.highCount}*`);
    }
    if (report.summary.mediumCount > 0) {
      lines.push(`>:large_orange_circle: Medium: *${report.summary.mediumCount}*`);
    }
    if (report.summary.lowCount > 0) {
      lines.push(`>:large_yellow_circle: Low: *${report.summary.lowCount}*`);
    }
  }
  lines.push('');

  // Slow Responders
  if (report.slowResponders.length > 0) {
    lines.push(':turtle: *Slow Responders*');
    report.slowResponders.slice(0, 5).forEach(sr => {
      const icon = sr.severity === 'critical' ? ':rotating_light:' :
        sr.severity === 'high' ? ':red_circle:' :
        sr.severity === 'medium' ? ':large_orange_circle:' : ':large_yellow_circle:';
      lines.push(`>${icon} <@${sr.slackId}> - ${sr.avgResponseTimeMinutes}min avg (${sr.responseTimeRatio}x team avg)`);
    });
    lines.push('');
  }

  // Overloaded Repos
  if (report.overloadedRepos.length > 0) {
    lines.push(':file_folder: *Overloaded Repositories*');
    report.overloadedRepos.slice(0, 5).forEach(or => {
      const icon = or.severity === 'critical' ? ':rotating_light:' :
        or.severity === 'high' ? ':red_circle:' :
        or.severity === 'medium' ? ':large_orange_circle:' : ':large_yellow_circle:';
      lines.push(`>${icon} *${or.fullName}* - ${or.pendingReviews} pending (${or.reviewsPerReviewer}/reviewer)`);
    });
    lines.push('');
  }

  // Overloaded Users
  if (report.overloadedUsers.length > 0) {
    lines.push(':weight_lifter: *Overloaded Users*');
    report.overloadedUsers.slice(0, 5).forEach(ou => {
      const icon = ou.severity === 'critical' ? ':rotating_light:' :
        ou.severity === 'high' ? ':red_circle:' :
        ou.severity === 'medium' ? ':large_orange_circle:' : ':large_yellow_circle:';
      const utilPct = Math.round(ou.utilizationRate * 100);
      lines.push(`>${icon} <@${ou.slackId}> - ${utilPct}% utilized (${ou.pendingReviews}/${ou.maxConcurrent})`);
    });
    lines.push('');
  }

  // Skill Gaps
  if (report.skillGapBottlenecks.length > 0) {
    lines.push(':jigsaw: *Skill Gaps*');
    report.skillGapBottlenecks.slice(0, 5).forEach(sg => {
      const icon = sg.severity === 'critical' ? ':rotating_light:' :
        sg.severity === 'high' ? ':red_circle:' :
        sg.severity === 'medium' ? ':large_orange_circle:' : ':large_yellow_circle:';
      lines.push(`>${icon} *${sg.skillName}* - ${sg.pendingWithSkill} pending, ${sg.reviewerCount} reviewers`);
    });
    lines.push('');
  }

  // Top Recommendations
  if (report.summary.topRecommendations.length > 0) {
    lines.push(':bulb: *Top Recommendations*');
    report.summary.topRecommendations.forEach((rec, i) => {
      lines.push(`>${i + 1}. ${rec}`);
    });
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('_Use `/pr-roulette bottlenecks` to see detailed report_');

  return lines.join('\n');
};

// =============================================================================
// INDIVIDUAL GROWTH TRACKING
// =============================================================================

/**
 * Calculate trend value with direction
 */
const calculateTrend = (
  current: number,
  previous: number,
  inverseIsPositive = false
): TrendValue => {
  if (previous === 0) {
    return {
      current,
      previous,
      change: current > 0 ? 100 : 0,
      direction: current > 0 ? 'up' : 'stable',
      isPositive: inverseIsPositive ? current <= 0 : current > 0,
    };
  }

  const change = Math.round(((current - previous) / previous) * 100);
  const direction: 'up' | 'down' | 'stable' =
    change > 5 ? 'up' : change < -5 ? 'down' : 'stable';
  const isPositive = inverseIsPositive ? direction === 'down' : direction === 'up';

  return { current, previous, change, direction, isPositive };
};

/**
 * Get week bounds for a given week offset from now
 */
const getWeekBoundsOffset = (weeksAgo: number): { start: Date; end: Date } => {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() - weeksAgo * 7);
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  return { start, end };
};

/**
 * Get user's growth metrics for a specific period
 */
const getUserPeriodMetrics = async (
  userId: string,
  start: Date,
  end: Date
): Promise<{ reviews: number; responseTime: number | null; points: number }> => {
  const stats = await db.statistics.aggregate({
    where: {
      userId,
      repositoryId: null,
      createdAt: { gte: start, lte: end },
    },
    _sum: {
      completed: true,
      points: true,
    },
    _avg: {
      avgResponseTime: true,
    },
  });

  return {
    reviews: stats._sum.completed ?? 0,
    responseTime: stats._avg.avgResponseTime ? Math.round(stats._avg.avgResponseTime) : null,
    points: stats._sum.points ?? 0,
  };
};

/**
 * Get user milestones
 */
const getUserMilestones = async (
  userId: string,
  totalReviews: number
): Promise<GrowthMilestone[]> => {
  const milestones: GrowthMilestone[] = [];

  // Get first review date
  const firstAssignment = await db.assignment.findFirst({
    where: {
      reviewerId: userId,
      status: { in: ['COMPLETED', 'APPROVED'] },
    },
    orderBy: { completedAt: 'asc' },
    select: { completedAt: true },
  });

  if (firstAssignment?.completedAt) {
    milestones.push({
      type: 'first_review',
      description: 'Completed first review',
      achievedAt: firstAssignment.completedAt,
    });
  }

  // Review count milestones
  const reviewMilestones: { threshold: number; type: MilestoneType; desc: string }[] = [
    { threshold: 10, type: 'reviews_10', desc: 'Completed 10 reviews' },
    { threshold: 50, type: 'reviews_50', desc: 'Completed 50 reviews' },
    { threshold: 100, type: 'reviews_100', desc: 'Completed 100 reviews' },
    { threshold: 500, type: 'reviews_500', desc: 'Completed 500 reviews' },
  ];

  for (const { threshold, type, desc } of reviewMilestones) {
    if (totalReviews >= threshold) {
      // Estimate when this milestone was reached
      const assignmentAtMilestone = await db.assignment.findFirst({
        where: {
          reviewerId: userId,
          status: { in: ['COMPLETED', 'APPROVED'] },
        },
        orderBy: { completedAt: 'asc' },
        skip: threshold - 1,
        take: 1,
        select: { completedAt: true },
      });

      if (assignmentAtMilestone?.completedAt) {
        milestones.push({
          type,
          description: desc,
          achievedAt: assignmentAtMilestone.completedAt,
          value: threshold,
        });
      }
    }
  }

  // First achievement
  const firstAchievement = await db.userAchievement.findFirst({
    where: { userId },
    orderBy: { earnedAt: 'asc' },
    include: { achievement: true },
  });

  if (firstAchievement) {
    milestones.push({
      type: 'first_achievement',
      description: `Unlocked "${firstAchievement.achievement.displayName}"`,
      achievedAt: firstAchievement.earnedAt,
    });
  }

  // Sort by date
  milestones.sort((a, b) => b.achievedAt.getTime() - a.achievedAt.getTime());

  return milestones.slice(0, 10); // Limit to 10 most recent
};

/**
 * Generate recommendations based on growth data
 */
const generateGrowthRecommendations = (
  metrics: GrowthMetrics,
  trends: GrowthTrends
): string[] => {
  const recommendations: string[] = [];

  // Response time recommendations
  if (metrics.avgResponseTimeMinutes && metrics.avgResponseTimeMinutes > 240) {
    recommendations.push('Try to respond to review requests within 4 hours to help unblock teammates');
  } else if (trends.responseTimeWoW.isPositive && trends.responseTimeWoW.direction === 'down') {
    recommendations.push('Great job improving your response time this week!');
  }

  // Review volume recommendations
  if (metrics.reviewsCompleted === 0) {
    recommendations.push('Complete some reviews this week to build momentum');
  } else if (trends.reviewsWoW.direction === 'up' && trends.reviewsWoW.change > 20) {
    recommendations.push('Excellent review volume increase - keep it up!');
  }

  // Streak recommendations
  if (metrics.streakDays > 0 && metrics.streakDays < 5) {
    recommendations.push(`You're on a ${metrics.streakDays}-day streak - keep it going to earn streak achievements!`);
  } else if (metrics.streakDays >= 7) {
    recommendations.push(`Amazing ${metrics.streakDays}-day streak! You're a review champion!`);
  }

  // Points recommendations
  if (trends.pointsWoW.direction === 'up') {
    recommendations.push('Your points are trending up - check the leaderboard to see your ranking');
  }

  // Achievement recommendations
  if (metrics.totalAchievements < 5) {
    recommendations.push('Keep reviewing to unlock more achievements - check /pr-roulette achievements');
  }

  return recommendations.slice(0, 4); // Limit to 4
};

/**
 * Generate user growth report
 */
export const generateUserGrowthReport = async (
  userId: string
): Promise<UserGrowthReport | null> => {
  // Get user info
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      achievements: true,
    },
  });

  if (!user) return null;

  const now = new Date();

  // Get current week metrics
  const thisWeek = getWeekBoundsOffset(0);
  const lastWeek = getWeekBoundsOffset(1);
  const thisMonth = { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  const lastMonth = {
    start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    end: new Date(now.getFullYear(), now.getMonth(), 0),
  };

  // Fetch metrics in parallel
  const [thisWeekMetrics, lastWeekMetrics, thisMonthMetrics, lastMonthMetrics] = await Promise.all([
    getUserPeriodMetrics(userId, thisWeek.start, thisWeek.end),
    getUserPeriodMetrics(userId, lastWeek.start, lastWeek.end),
    getUserPeriodMetrics(userId, thisMonth.start, thisMonth.end),
    getUserPeriodMetrics(userId, lastMonth.start, lastMonth.end),
  ]);

  // Get all-time stats
  const allTimeStats = await db.statistics.aggregate({
    where: { userId, repositoryId: null },
    _sum: {
      completed: true,
      points: true,
    },
    _max: {
      streak: true,
    },
  });

  // Get historical data for sparklines (last 8 weeks)
  const weeklyData: { reviews: number; responseTime: number; points: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const week = getWeekBoundsOffset(i);
    const metrics = await getUserPeriodMetrics(userId, week.start, week.end);
    weeklyData.push({
      reviews: metrics.reviews,
      responseTime: metrics.responseTime ?? 0,
      points: metrics.points,
    });
  }

  // Build metrics
  const totalReviews = allTimeStats._sum.completed ?? 0;
  const metrics: GrowthMetrics = {
    reviewsCompleted: thisWeekMetrics.reviews,
    avgResponseTimeMinutes: thisWeekMetrics.responseTime,
    pointsEarned: thisWeekMetrics.points,
    streakDays: allTimeStats._max.streak ?? 0,
    achievementsUnlocked: user.achievements.length,
    totalReviews,
    totalPoints: allTimeStats._sum.points ?? 0,
    totalAchievements: user.achievements.length,
    memberSince: user.createdAt,
  };

  // Build trends
  const trends: GrowthTrends = {
    reviewsWoW: calculateTrend(thisWeekMetrics.reviews, lastWeekMetrics.reviews),
    responseTimeWoW: calculateTrend(
      thisWeekMetrics.responseTime ?? 0,
      lastWeekMetrics.responseTime ?? 0,
      true // Lower is better
    ),
    pointsWoW: calculateTrend(thisWeekMetrics.points, lastWeekMetrics.points),
    reviewsMoM: calculateTrend(thisMonthMetrics.reviews, lastMonthMetrics.reviews),
    responseTimeMoM: calculateTrend(
      thisMonthMetrics.responseTime ?? 0,
      lastMonthMetrics.responseTime ?? 0,
      true
    ),
    pointsMoM: calculateTrend(thisMonthMetrics.points, lastMonthMetrics.points),
    weeklyReviews: weeklyData.map(w => w.reviews),
    weeklyResponseTime: weeklyData.map(w => w.responseTime),
    weeklyPoints: weeklyData.map(w => w.points),
  };

  // Get milestones
  const milestones = await getUserMilestones(userId, totalReviews);

  // Generate recommendations
  const recommendations = generateGrowthRecommendations(metrics, trends);

  return {
    userId: user.id,
    displayName: user.displayName,
    slackId: user.slackId,
    period: {
      start: thisWeek.start,
      end: thisWeek.end,
    },
    metrics,
    trends,
    milestones,
    recommendations,
  };
};

/**
 * Format growth report for Slack
 */
export const formatGrowthReportForSlack = (report: UserGrowthReport): string => {
  const lines: string[] = [];

  // Header
  lines.push(`:chart_with_upwards_trend: *Growth Report for ${report.displayName}*`);
  lines.push(`_Member since ${report.metrics.memberSince.toLocaleDateString()}_`);
  lines.push('');

  // This Week snapshot
  lines.push(':calendar: *This Week*');
  lines.push(`>:white_check_mark: Reviews: *${report.metrics.reviewsCompleted}* ${formatTrendEmoji(report.trends.reviewsWoW)}`);
  if (report.metrics.avgResponseTimeMinutes) {
    lines.push(`>:stopwatch: Avg Response: *${formatResponseTimeShort(report.metrics.avgResponseTimeMinutes)}* ${formatTrendEmoji(report.trends.responseTimeWoW)}`);
  }
  lines.push(`>:star: Points: *${report.metrics.pointsEarned}* ${formatTrendEmoji(report.trends.pointsWoW)}`);
  if (report.metrics.streakDays > 0) {
    lines.push(`>:fire: Streak: *${report.metrics.streakDays} days*`);
  }
  lines.push('');

  // All-time stats
  lines.push(':trophy: *All-Time Stats*');
  lines.push(`>Total Reviews: *${report.metrics.totalReviews}*`);
  lines.push(`>Total Points: *${report.metrics.totalPoints}*`);
  lines.push(`>Achievements: *${report.metrics.totalAchievements}*`);
  lines.push('');

  // Weekly trend sparkline
  if (report.trends.weeklyReviews.some(r => r > 0)) {
    lines.push(':chart_with_upwards_trend: *8-Week Review Trend*');
    lines.push(`>${formatSparkline(report.trends.weeklyReviews)}`);
    lines.push('');
  }

  // Milestones
  if (report.milestones.length > 0) {
    lines.push(':star2: *Recent Milestones*');
    report.milestones.slice(0, 3).forEach(m => {
      const date = m.achievedAt.toLocaleDateString();
      lines.push(`>:checkered_flag: ${m.description} _(${date})_`);
    });
    lines.push('');
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push(':bulb: *Tips*');
    report.recommendations.forEach(rec => {
      lines.push(`>• ${rec}`);
    });
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push('_Keep growing! Use `/pr-roulette achievements` to see your badges._');

  return lines.join('\n');
};

/**
 * Format trend as emoji
 */
const formatTrendEmoji = (trend: TrendValue): string => {
  if (trend.direction === 'stable') return '';
  const arrow = trend.direction === 'up' ? ':arrow_up:' : ':arrow_down:';
  const sign = trend.change > 0 ? '+' : '';
  const color = trend.isPositive ? ':white_check_mark:' : '';
  return `(${sign}${trend.change}% ${arrow})${color ? ' ' + color : ''}`;
};

/**
 * Format response time short
 */
const formatResponseTimeShort = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
};

/**
 * Format sparkline using block characters
 */
const formatSparkline = (values: number[]): string => {
  if (values.length === 0) return '';

  const max = Math.max(...values, 1);
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

  return values
    .map(v => {
      const normalized = v / max;
      const index = Math.min(Math.floor(normalized * blocks.length), blocks.length - 1);
      return blocks[index];
    })
    .join('');
};
