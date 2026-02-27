/**
 * Dashboard Stats API
 *
 * GET /api/dashboard/stats
 *
 * Query Parameters:
 * - period: 'week' | 'month' | 'year' | 'all_time' (default: 'week')
 *
 * Returns: Dashboard summary statistics
 * - totalReviews: Total completed reviews in period
 * - activeReviewers: Distinct reviewers with activity in period
 * - avgResponseTime: Average first-response time in minutes
 * - completionRate: Percentage of assigned reviews that completed
 * - pendingCount: Currently pending/in-progress assignments
 * - problemCount: Active (unresolved) assignment problems
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/dashboard/auth';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('dashboard:stats');

const PERIOD_TYPES = ['week', 'month', 'year', 'all_time'] as const;
type PeriodType = (typeof PERIOD_TYPES)[number];

const QuerySchema = z.object({
  period: z.enum(PERIOD_TYPES).default('week'),
});

/**
 * Get the current period string for a given period type.
 * Matches the Statistics model's `period` format.
 */
const getCurrentPeriodString = (periodType: PeriodType): string => {
  const now = new Date();
  const year = now.getFullYear();

  switch (periodType) {
    case 'week': {
      // ISO week number
      const startOfYear = new Date(year, 0, 1);
      const dayOfYear = Math.floor(
        (now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000)
      );
      const weekNumber = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
      return `${year}-W${String(weekNumber).padStart(2, '0')}`;
    }
    case 'month': {
      const month = String(now.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
    }
    case 'year':
      return `${year}`;
    case 'all_time':
      return 'all_time';
  }
};

/**
 * Get the date cutoff for filtering assignments by period.
 */
const getPeriodCutoff = (periodType: PeriodType): Date | null => {
  const now = new Date();

  switch (periodType) {
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
    case 'all_time':
      return null;
  }
};

export const GET = async (request: NextRequest) => {
  try {
    // Authenticate
    const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const session = await validateSession(sessionId);

    if (!session.valid) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session' },
        { status: 401 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      period: searchParams.get('period') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { period } = parsed.data;
    const periodString = getCurrentPeriodString(period);
    const cutoff = getPeriodCutoff(period);

    // Build date filter for assignments
    const dateFilter = cutoff ? { createdAt: { gte: cutoff } } : {};

    // Run all queries in parallel
    const [
      statisticsAgg,
      activeReviewerCount,
      pendingCount,
      problemCount,
      totalAssigned,
    ] = await Promise.all([
      // Aggregate from Statistics model for the current period
      db.statistics.aggregate({
        where: {
          periodType: period,
          period: period === 'all_time' ? 'all_time' : periodString,
          repositoryId: null, // Global stats (not per-repo)
        },
        _sum: {
          completed: true,
          assigned: true,
          skipped: true,
        },
        _avg: {
          avgResponseTime: true,
        },
      }),

      // Count distinct active reviewers in the period
      db.assignment.groupBy({
        by: ['reviewerId'],
        where: {
          ...dateFilter,
          reviewerId: { not: null },
          status: {
            in: ['IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'COMPLETED'],
          },
        },
      }),

      // Count currently pending assignments
      db.assignment.count({
        where: {
          status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW', 'CHANGES_REQUESTED'] },
        },
      }),

      // Count active (unresolved) problems
      db.assignmentProblem.count({
        where: { resolvedAt: null },
      }),

      // Total assigned in period (for completion rate denominator)
      db.assignment.count({
        where: {
          ...dateFilter,
          status: { not: 'PENDING' }, // Exclude unassigned
        },
      }),
    ]);

    const totalReviews = statisticsAgg._sum.completed ?? 0;
    const totalAssignedFromStats = statisticsAgg._sum.assigned ?? 0;
    const activeReviewers = activeReviewerCount.length;
    const avgResponseTime = statisticsAgg._avg.avgResponseTime
      ? Math.round(statisticsAgg._avg.avgResponseTime)
      : null;

    // Completion rate: completed / total assigned (from either stats or direct count)
    const denominator = totalAssignedFromStats > 0 ? totalAssignedFromStats : totalAssigned;
    const completionRate = denominator > 0
      ? Math.round((totalReviews / denominator) * 10000) / 100
      : 0;

    return NextResponse.json({
      success: true,
      data: {
        period,
        periodString,
        totalReviews,
        activeReviewers,
        avgResponseTimeMinutes: avgResponseTime,
        completionRate,
        pendingAssignments: pendingCount,
        activeProblems: problemCount,
      },
    });
  } catch (error) {
    log.error('GET /api/dashboard/stats failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      { success: false, error: 'Failed to fetch dashboard stats' },
      { status: 500 }
    );
  }
};
