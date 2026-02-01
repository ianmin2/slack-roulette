/**
 * Weekly Goals API Route
 *
 * GET /api/goals - Get current user's weekly goal
 * POST /api/goals - Set/update weekly goal
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import {
  getWeeklyGoal,
  setWeeklyGoal,
  getWeeklyGoalHistory,
  getWeeklyGoalSummary,
} from '@/lib/challenges/goals';
import { loggers } from '@/lib/utils/logger';

const log = loggers.goals;

/**
 * Zod schema for weekly goal input
 */
const WeeklyGoalInputSchema = z.object({
  targetReviews: z.number().int().positive().max(100).optional(),
  targetPoints: z.number().int().positive().max(10000).optional(),
  targetAvgResponseMinutes: z.number().int().positive().max(1440).optional(), // Max 24 hours
});

/**
 * GET /api/goals
 * Get the current user's weekly goal
 *
 * Requires:
 * - X-User-Id header: Slack ID of the user
 *
 * Query params:
 * - history: If "true", returns goal history instead of current goal
 * - limit: Number of historical goals to return (default 10)
 */
export async function GET(request: NextRequest) {
  try {
    const userSlackId = request.headers.get('X-User-Id');

    if (!userSlackId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get user
    const user = await db.user.findUnique({
      where: { slackId: userSlackId },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const wantHistory = searchParams.get('history') === 'true';
    const limit = parseInt(searchParams.get('limit') ?? '10', 10);

    if (wantHistory) {
      // Return goal history
      const history = await getWeeklyGoalHistory(user.id, limit);

      return NextResponse.json({
        success: true,
        data: {
          history,
          achievedCount: history.filter(g => g.isAchieved).length,
          totalCount: history.length,
        },
      });
    }

    // Return current goal
    const goal = await getWeeklyGoal(user.id);

    if (!goal) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No weekly goal set. Use POST to create one.',
      });
    }

    const summary = getWeeklyGoalSummary(goal);

    return NextResponse.json({
      success: true,
      data: {
        goal,
        progress: summary,
      },
    });
  } catch (error) {
    log.error('GET /api/goals failed', error instanceof Error ? error : undefined);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch weekly goal' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/goals
 * Set or update the current week's goal
 *
 * Requires:
 * - X-User-Id header: Slack ID of the user
 *
 * Body:
 * - targetReviews: number (optional, default 5)
 * - targetPoints: number (optional, default 100)
 * - targetAvgResponseMinutes: number (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const userSlackId = request.headers.get('X-User-Id');

    if (!userSlackId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get user
    const user = await db.user.findUnique({
      where: { slackId: userSlackId },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = WeeklyGoalInputSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: validation.error.issues,
        },
        { status: 400 }
      );
    }

    // Ensure at least one target is provided
    const { targetReviews, targetPoints, targetAvgResponseMinutes } = validation.data;

    if (
      targetReviews === undefined &&
      targetPoints === undefined &&
      targetAvgResponseMinutes === undefined
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'At least one target must be provided (targetReviews, targetPoints, or targetAvgResponseMinutes)',
        },
        { status: 400 }
      );
    }

    // Set/update the goal
    const goal = await setWeeklyGoal(user.id, {
      targetReviews,
      targetPoints,
      targetAvgResponseMinutes,
    });

    const summary = getWeeklyGoalSummary(goal);

    return NextResponse.json({
      success: true,
      data: {
        goal,
        progress: summary,
      },
    });
  } catch (error) {
    log.error('POST /api/goals failed', error instanceof Error ? error : undefined);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to set weekly goal' },
      { status: 500 }
    );
  }
}
