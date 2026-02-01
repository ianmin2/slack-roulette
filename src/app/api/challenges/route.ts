/**
 * Challenges API Route
 *
 * GET /api/challenges - List active challenges
 * POST /api/challenges - Create new challenge (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { createChallenge, getActiveChallengesByRepo } from '@/lib/challenges';
import { loggers } from '@/lib/utils/logger';
import type { ChallengeCreateInput, ChallengeScope, ChallengeType, RewardType } from '@/types';

const log = loggers.challenges;

/**
 * Zod schema for challenge creation
 */
const ChallengeCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  type: z.enum([
    'reviews_completed',
    'fast_reviews',
    'streak_days',
    'points_earned',
    'team_reviews',
    'response_time_avg',
    'zero_pending',
  ] as const),
  target: z.number().int().positive(),
  reward: z.object({
    type: z.enum(['points', 'badge', 'achievement'] as const),
    value: z.number().int().nonnegative(),
    description: z.string().min(1),
  }),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  scope: z.enum(['individual', 'team', 'repository'] as const),
  repositoryId: z.string().uuid().optional(),
});

/**
 * GET /api/challenges
 * List all active challenges
 *
 * Query params:
 * - repositoryId: Filter by repository (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const repositoryId = searchParams.get('repositoryId') ?? undefined;

    const challenges = await getActiveChallengesByRepo(repositoryId);

    return NextResponse.json({
      success: true,
      data: challenges,
    });
  } catch (error) {
    log.error('GET /api/challenges failed', error instanceof Error ? error : undefined);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch challenges' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/challenges
 * Create a new challenge (admin only)
 *
 * Requires:
 * - X-User-Id header: Slack ID of the user making the request
 */
export async function POST(request: NextRequest) {
  try {
    // Get user from header (set by middleware/auth)
    const userSlackId = request.headers.get('X-User-Id');

    if (!userSlackId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Verify user is admin
    const user = await db.user.findUnique({
      where: { slackId: userSlackId },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    if (user.role !== 'ADMIN' && user.role !== 'TEAM_LEAD') {
      return NextResponse.json(
        { success: false, error: 'Admin or Team Lead role required' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = ChallengeCreateSchema.safeParse(body);

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

    const input: ChallengeCreateInput = {
      name: validation.data.name,
      description: validation.data.description,
      type: validation.data.type as ChallengeType,
      target: validation.data.target,
      reward: {
        type: validation.data.reward.type as RewardType,
        value: validation.data.reward.value,
        description: validation.data.reward.description,
      },
      startDate: new Date(validation.data.startDate),
      endDate: new Date(validation.data.endDate),
      scope: validation.data.scope as ChallengeScope,
      repositoryId: validation.data.repositoryId,
    };

    // Validate dates
    if (input.endDate <= input.startDate) {
      return NextResponse.json(
        { success: false, error: 'End date must be after start date' },
        { status: 400 }
      );
    }

    // Validate repository exists if specified
    if (input.repositoryId) {
      const repo = await db.repository.findUnique({
        where: { id: input.repositoryId },
      });

      if (!repo) {
        return NextResponse.json(
          { success: false, error: 'Repository not found' },
          { status: 404 }
        );
      }
    }

    // Create challenge
    const challenge = await createChallenge(input, user.id);

    return NextResponse.json(
      { success: true, data: challenge },
      { status: 201 }
    );
  } catch (error) {
    log.error('POST /api/challenges failed', error instanceof Error ? error : undefined);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to create challenge' },
      { status: 500 }
    );
  }
}
