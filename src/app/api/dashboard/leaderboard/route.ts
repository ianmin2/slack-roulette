/**
 * Dashboard Leaderboard API
 *
 * GET /api/dashboard/leaderboard
 *
 * Query Parameters:
 * - period: 'week' | 'month' (default: 'week')
 * - limit: Number of entries to return (default: 20, max: 50)
 *
 * Returns: Ranked list of users with:
 * - rank, displayName, avatarUrl, githubUsername
 * - completed: Reviews completed in period
 * - points: Points earned in period
 * - avgResponseTime: Average first-response time in minutes
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/dashboard/auth';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('dashboard:leaderboard');

const LEADERBOARD_PERIODS = ['week', 'month'] as const;

const QuerySchema = z.object({
  period: z.enum(LEADERBOARD_PERIODS).default('week'),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

/**
 * Get the current period string matching the Statistics model format.
 */
const getCurrentPeriodString = (periodType: 'week' | 'month'): string => {
  const now = new Date();
  const year = now.getFullYear();

  switch (periodType) {
    case 'week': {
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
      limit: searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { period, limit } = parsed.data;
    const periodString = getCurrentPeriodString(period);

    // Fetch statistics for the period, joined with user data
    // Aggregate across all repositories (repositoryId = null for global,
    // but also sum per-repo stats for users who only have per-repo entries)
    const statistics = await db.statistics.findMany({
      where: {
        periodType: period,
        period: periodString,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            githubUsername: true,
          },
        },
      },
    });

    // Aggregate per user (a user may have multiple repo-scoped stat entries)
    const userMap = new Map<
      string,
      {
        user: {
          id: string;
          displayName: string;
          avatarUrl: string | null;
          githubUsername: string | null;
        };
        completed: number;
        points: number;
        totalResponseTime: number;
        responseTimeCount: number;
      }
    >();

    for (const stat of statistics) {
      const existing = userMap.get(stat.userId);

      if (existing) {
        existing.completed += stat.completed;
        existing.points += stat.points;
        if (stat.avgResponseTime !== null) {
          existing.totalResponseTime += stat.avgResponseTime * stat.completed;
          existing.responseTimeCount += stat.completed;
        }
      } else {
        userMap.set(stat.userId, {
          user: stat.user,
          completed: stat.completed,
          points: stat.points,
          totalResponseTime: stat.avgResponseTime !== null
            ? stat.avgResponseTime * stat.completed
            : 0,
          responseTimeCount: stat.avgResponseTime !== null ? stat.completed : 0,
        });
      }
    }

    // Sort by points descending, then by completed descending as tiebreaker
    const sorted = Array.from(userMap.values())
      .sort((a, b) => b.points - a.points || b.completed - a.completed)
      .slice(0, limit);

    // Build ranked response
    const leaderboard = sorted.map((entry, index) => ({
      rank: index + 1,
      user: entry.user,
      completed: entry.completed,
      points: entry.points,
      avgResponseTime: entry.responseTimeCount > 0
        ? Math.round(entry.totalResponseTime / entry.responseTimeCount)
        : null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        period,
        periodString,
        leaderboard,
      },
    });
  } catch (error) {
    log.error('GET /api/dashboard/leaderboard failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      { success: false, error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
};
