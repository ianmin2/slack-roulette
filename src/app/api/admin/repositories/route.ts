/**
 * Admin Repositories API
 *
 * GET /api/admin/repositories - List all repositories with stats
 * PATCH /api/admin/repositories - Update a repository (repoId in body)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAdminRepositories, updateRepository } from '@/lib/admin';
import { loggers } from '@/lib/utils/logger';
import type { ApiResponse, AdminRepositoryData } from '@/types';

const log = loggers.admin;

/**
 * GET - List all repositories with their statistics
 */
export async function GET(): Promise<NextResponse<ApiResponse<AdminRepositoryData[]>>> {
  try {
    const repositories = await getAdminRepositories();

    return NextResponse.json({
      success: true,
      data: repositories,
    });
  } catch (error) {
    log.error('Repositories list failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch repositories',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Validation schema for repository update
 */
const UpdateRepositorySchema = z.object({
  repoId: z.string().uuid('Invalid repository ID format'),
  isActive: z.boolean().optional(),
  requireSeniorComplex: z.boolean().optional(),
  defaultReviewerWeight: z
    .number()
    .min(0.5, 'Weight must be at least 0.5')
    .max(2.0, 'Weight must be at most 2.0')
    .optional(),
  maxConcurrentDefault: z
    .number()
    .int()
    .min(1, 'Max concurrent must be at least 1')
    .max(20, 'Max concurrent must be at most 20')
    .optional(),
});

/**
 * PATCH - Update a repository's admin-editable fields
 */
export async function PATCH(
  request: NextRequest
): Promise<NextResponse<ApiResponse<void>>> {
  try {
    const body = await request.json();
    const validated = UpdateRepositorySchema.parse(body);

    const { repoId, ...updateData } = validated;

    await updateRepository(repoId, updateData);

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

    // Business logic error (repository not found, etc.)
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 404 }
      );
    }

    log.error('Repository update failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update repository',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
