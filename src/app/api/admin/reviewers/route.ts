/**
 * Admin Reviewers API
 *
 * PATCH /api/admin/reviewers - Update reviewer settings (userId + repoId in body)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { updateReviewer } from '@/lib/admin';
import { loggers } from '@/lib/utils/logger';
import type { ApiResponse } from '@/types';

const log = loggers.admin;

/**
 * Validation schema for reviewer update
 */
const UpdateReviewerSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  repoId: z.string().uuid('Invalid repository ID format'),
  weight: z
    .number()
    .min(0.5, 'Weight must be at least 0.5')
    .max(2.0, 'Weight must be at most 2.0')
    .optional(),
  maxConcurrent: z
    .number()
    .int()
    .min(1, 'Max concurrent must be at least 1')
    .max(20, 'Max concurrent must be at most 20')
    .optional(),
  isActive: z.boolean().optional(),
});

/**
 * PATCH - Update reviewer settings for a user on a specific repository
 */
export async function PATCH(
  request: NextRequest
): Promise<NextResponse<ApiResponse<void>>> {
  try {
    const body = await request.json();
    const validated = UpdateReviewerSchema.parse(body);

    const { userId, repoId, ...updateData } = validated;

    await updateReviewer(userId, repoId, updateData);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    // Zod validation error
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: error.issues,
        },
        { status: 400 }
      );
    }

    // Business logic error (reviewer relationship not found, etc.)
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 404 }
      );
    }

    log.error('Reviewer update failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update reviewer settings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
