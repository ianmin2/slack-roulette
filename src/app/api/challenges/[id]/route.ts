/**
 * Single Challenge API Route
 *
 * GET /api/challenges/[id] - Get challenge details with progress
 */

import { NextRequest, NextResponse } from 'next/server';

import { getChallengeWithProgress } from '@/lib/challenges';
import { loggers } from '@/lib/utils/logger';

const log = loggers.challenges;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/challenges/[id]
 * Get a single challenge with detailed progress information
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Challenge ID required' },
        { status: 400 }
      );
    }

    const result = await getChallengeWithProgress(id);

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Challenge not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        challenge: result.challenge,
        progress: result.progress,
        stats: {
          totalParticipants: result.totalParticipants,
          completedCount: result.completedCount,
          completionRate:
            result.totalParticipants > 0
              ? Math.round((result.completedCount / result.totalParticipants) * 100)
              : 0,
        },
      },
    });
  } catch (error) {
    log.error('GET /api/challenges/[id] failed', error instanceof Error ? error : undefined);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch challenge' },
      { status: 500 }
    );
  }
}
