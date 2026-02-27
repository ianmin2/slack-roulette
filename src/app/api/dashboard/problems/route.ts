/**
 * Dashboard Problems API
 *
 * GET /api/dashboard/problems
 *
 * Returns: Active (unresolved) assignment problems with:
 * - Assignment details (PR title, URL, status)
 * - Problem rule info (name, severity, condition)
 * - Reviewer info
 * - Trigger timestamp and description
 */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/dashboard/auth';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('dashboard:problems');

/**
 * Generate a human-readable description for a problem based on its rule.
 */
const describeCondition = (
  conditionType: string,
  conditionValue: number
): string => {
  switch (conditionType) {
    case 'NO_ACTIVITY_FOR':
      return `No activity for ${conditionValue} hours`;
    case 'REJECTION_COUNT_GTE':
      return `${conditionValue} or more rejections`;
    case 'REVIEWER_CHANGES_GTE':
      return `${conditionValue} or more reviewer reassignments`;
    case 'TOTAL_AGE_GTE':
      return `PR open for ${conditionValue}+ hours`;
    default:
      return `Condition: ${conditionType} >= ${conditionValue}`;
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

    // Fetch active (unresolved) problems with full context
    const problems = await db.assignmentProblem.findMany({
      where: {
        resolvedAt: null,
      },
      include: {
        assignment: {
          select: {
            id: true,
            prUrl: true,
            prNumber: true,
            prTitle: true,
            status: true,
            complexity: true,
            createdAt: true,
            assignedAt: true,
            repository: {
              select: {
                id: true,
                name: true,
                fullName: true,
              },
            },
            author: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
              },
            },
            reviewer: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        rule: {
          select: {
            id: true,
            name: true,
            description: true,
            severity: true,
            conditionType: true,
            conditionValue: true,
          },
        },
      },
      orderBy: [
        // Critical first, then by trigger time (newest first)
        { rule: { severity: 'desc' } },
        { triggeredAt: 'desc' },
      ],
    });

    // Enrich with human-readable description
    const enriched = problems.map((problem) => ({
      id: problem.id,
      triggeredAt: problem.triggeredAt,
      notified: problem.notified,
      severity: problem.rule.severity,
      description: describeCondition(
        problem.rule.conditionType,
        problem.rule.conditionValue
      ),
      rule: {
        id: problem.rule.id,
        name: problem.rule.name,
        description: problem.rule.description,
        severity: problem.rule.severity,
        conditionType: problem.rule.conditionType,
        conditionValue: problem.rule.conditionValue,
      },
      assignment: problem.assignment,
    }));

    return NextResponse.json({
      success: true,
      data: {
        problems: enriched,
        total: enriched.length,
      },
    });
  } catch (error) {
    log.error('GET /api/dashboard/problems failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      { success: false, error: 'Failed to fetch problems' },
      { status: 500 }
    );
  }
};
