/**
 * Analytics API Route
 *
 * GET /api/analytics
 *
 * Query Parameters:
 * - period: 'day' | 'week' | 'month' | 'quarter' | 'year' (default: 'week')
 * - startDate: ISO date string (optional, overrides period calculation)
 * - endDate: ISO date string (optional, defaults to now)
 * - repositoryId: UUID string (optional, filter by repository)
 * - userId: UUID string (optional, filter by user)
 *
 * Returns: AnalyticsDashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAnalyticsDashboard } from '@/lib/analytics';
import { loggers } from '@/lib/utils/logger';
import type { AnalyticsPeriod, AnalyticsQuery, ApiResponse, AnalyticsDashboard } from '@/types';

const log = loggers.analytics;

const AnalyticsQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('week'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  repositoryId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<AnalyticsDashboard>>> {
  try {
    const { searchParams } = new URL(request.url);

    // Parse and validate query parameters
    const rawQuery = {
      period: searchParams.get('period') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      repositoryId: searchParams.get('repositoryId') ?? undefined,
      userId: searchParams.get('userId') ?? undefined,
    };

    const parsed = AnalyticsQuerySchema.safeParse(rawQuery);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { period, startDate, endDate, repositoryId, userId } = parsed.data;

    // Build analytics query
    const query: AnalyticsQuery = {
      period: period as AnalyticsPeriod,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      repositoryId,
      userId,
    };

    // Fetch analytics dashboard
    const dashboard = await getAnalyticsDashboard(query);

    return NextResponse.json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    log.error('Analytics API failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch analytics',
      },
      { status: 500 }
    );
  }
}
