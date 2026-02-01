/**
 * Admin Users API
 *
 * GET /api/admin/users - List all users with stats
 * PATCH /api/admin/users - Update a user (userId in body)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAdminUsers, updateUser } from '@/lib/admin';
import { loggers } from '@/lib/utils/logger';
import type { ApiResponse, AdminUserData } from '@/types';

const log = loggers.admin;

/**
 * GET - List all users with their statistics
 */
export async function GET(): Promise<NextResponse<ApiResponse<AdminUserData[]>>> {
  try {
    const users = await getAdminUsers();

    return NextResponse.json({
      success: true,
      data: users,
    });
  } catch (error) {
    log.error('Users list failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch users',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Validation schema for user update
 */
const UpdateUserSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(['ADMIN', 'TEAM_LEAD', 'DEVELOPER', 'VIEWER']).optional(),
  availabilityStatus: z.enum(['AVAILABLE', 'BUSY', 'VACATION', 'UNAVAILABLE']).optional(),
  githubUsername: z.string().max(39).optional(), // GitHub max username length
});

/**
 * PATCH - Update a user's admin-editable fields
 */
export async function PATCH(
  request: NextRequest
): Promise<NextResponse<ApiResponse<void>>> {
  try {
    const body = await request.json();
    const validated = UpdateUserSchema.parse(body);

    const { userId, ...updateData } = validated;

    await updateUser(userId, updateData);

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

    // Business logic error (user not found, etc.)
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 404 }
      );
    }

    log.error('User update failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update user',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
