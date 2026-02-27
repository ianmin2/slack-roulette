/**
 * Dashboard Assignments API
 *
 * GET /api/dashboard/assignments
 *
 * Query Parameters:
 * - status: Comma-separated AssignmentStatus values (default: PENDING,ASSIGNED,IN_REVIEW,CHANGES_REQUESTED)
 * - page: Page number, 1-indexed (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - repository: Repository ID filter (optional)
 * - reviewer: Reviewer user ID filter (optional)
 *
 * Returns: Paginated assignments with repository, author, reviewer includes
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/dashboard/auth';
import { createLogger } from '@/lib/utils/logger';
import type { AssignmentStatus } from '@/generated/prisma';

const log = createLogger('dashboard:assignments');

// Valid assignment statuses for filtering
const VALID_STATUSES: AssignmentStatus[] = [
  'PENDING',
  'ASSIGNED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'COMPLETED',
  'SKIPPED',
  'EXPIRED',
];

const DEFAULT_ACTIVE_STATUSES: AssignmentStatus[] = [
  'PENDING',
  'ASSIGNED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
];

const QuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  repository: z.string().uuid().optional(),
  reviewer: z.string().uuid().optional(),
});

/**
 * Parse comma-separated status string into validated AssignmentStatus array
 */
const parseStatuses = (raw: string | undefined): AssignmentStatus[] => {
  if (!raw) return DEFAULT_ACTIVE_STATUSES;

  const requested = raw.split(',').map((s) => s.trim().toUpperCase());
  const valid = requested.filter((s): s is AssignmentStatus =>
    VALID_STATUSES.includes(s as AssignmentStatus)
  );

  return valid.length > 0 ? valid : DEFAULT_ACTIVE_STATUSES;
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
    const rawQuery = {
      status: searchParams.get('status') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      repository: searchParams.get('repository') ?? undefined,
      reviewer: searchParams.get('reviewer') ?? undefined,
    };

    const parsed = QuerySchema.safeParse(rawQuery);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { page, limit, repository, reviewer } = parsed.data;
    const statuses = parseStatuses(parsed.data.status);
    const skip = (page - 1) * limit;

    // Build where clause
    const where = {
      status: { in: statuses },
      ...(repository ? { repositoryId: repository } : {}),
      ...(reviewer ? { reviewerId: reviewer } : {}),
    };

    // Fetch assignments + total count in parallel
    const [assignments, total] = await Promise.all([
      db.assignment.findMany({
        where,
        include: {
          repository: {
            select: {
              id: true,
              name: true,
              fullName: true,
              owner: true,
            },
          },
          author: {
            select: {
              id: true,
              displayName: true,
              avatarUrl: true,
              githubUsername: true,
            },
          },
          reviewer: {
            select: {
              id: true,
              displayName: true,
              avatarUrl: true,
              githubUsername: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.assignment.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        assignments,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    log.error('GET /api/dashboard/assignments failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      { success: false, error: 'Failed to fetch assignments' },
      { status: 500 }
    );
  }
};
