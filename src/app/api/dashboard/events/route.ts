/**
 * Dashboard Events SSE Endpoint
 *
 * GET /api/dashboard/events
 *
 * Server-Sent Events stream for real-time dashboard updates.
 *
 * Event types:
 * - assignment_created: New PR assignment created
 * - assignment_completed: Assignment marked completed/approved
 * - problem_triggered: New problem detected on an assignment
 * - achievement_earned: User earned a new achievement
 * - heartbeat: Keep-alive ping (every 15 seconds)
 *
 * Polls the database every 5 seconds for new events by checking
 * timestamps against the last poll time.
 */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/dashboard/auth';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('dashboard:events');

/** Polling interval in milliseconds */
const POLL_INTERVAL_MS = 5_000;

/** Heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Format a single SSE event.
 */
const formatSSE = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Fetch new assignments created after the given timestamp.
 */
const fetchNewAssignments = async (since: Date) =>
  db.assignment.findMany({
    where: { createdAt: { gt: since } },
    select: {
      id: true,
      prUrl: true,
      prNumber: true,
      prTitle: true,
      status: true,
      complexity: true,
      createdAt: true,
      repository: {
        select: { id: true, fullName: true },
      },
      author: {
        select: { id: true, displayName: true, avatarUrl: true },
      },
      reviewer: {
        select: { id: true, displayName: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

/**
 * Fetch assignments completed after the given timestamp.
 */
const fetchCompletedAssignments = async (since: Date) =>
  db.assignment.findMany({
    where: {
      completedAt: { gt: since },
      status: { in: ['COMPLETED', 'APPROVED'] },
    },
    select: {
      id: true,
      prUrl: true,
      prNumber: true,
      prTitle: true,
      status: true,
      completedAt: true,
      repository: {
        select: { id: true, fullName: true },
      },
      reviewer: {
        select: { id: true, displayName: true, avatarUrl: true },
      },
    },
    orderBy: { completedAt: 'asc' },
    take: 50,
  });

/**
 * Fetch problems triggered after the given timestamp.
 */
const fetchNewProblems = async (since: Date) =>
  db.assignmentProblem.findMany({
    where: { triggeredAt: { gt: since } },
    select: {
      id: true,
      triggeredAt: true,
      rule: {
        select: {
          name: true,
          severity: true,
          conditionType: true,
          conditionValue: true,
        },
      },
      assignment: {
        select: {
          id: true,
          prUrl: true,
          prNumber: true,
          prTitle: true,
          repository: {
            select: { id: true, fullName: true },
          },
          reviewer: {
            select: { id: true, displayName: true },
          },
        },
      },
    },
    orderBy: { triggeredAt: 'asc' },
    take: 50,
  });

/**
 * Fetch achievements earned after the given timestamp.
 */
const fetchNewAchievements = async (since: Date) =>
  db.userAchievement.findMany({
    where: { earnedAt: { gt: since } },
    select: {
      id: true,
      earnedAt: true,
      user: {
        select: { id: true, displayName: true, avatarUrl: true },
      },
      achievement: {
        select: { id: true, displayName: true, description: true, icon: true },
      },
    },
    orderBy: { earnedAt: 'asc' },
    take: 50,
  });

export const GET = async (request: NextRequest) => {
  // Authenticate before opening the stream
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

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let lastCheck = new Date();
      let lastHeartbeat = Date.now();
      let aborted = false;

      // Send initial connection event
      controller.enqueue(
        encoder.encode(
          formatSSE('connected', {
            message: 'SSE stream connected',
            timestamp: lastCheck.toISOString(),
          })
        )
      );

      const poll = async () => {
        if (aborted) return;

        try {
          const now = new Date();

          // Run all event queries in parallel
          const [newAssignments, completedAssignments, newProblems, newAchievements] =
            await Promise.all([
              fetchNewAssignments(lastCheck),
              fetchCompletedAssignments(lastCheck),
              fetchNewProblems(lastCheck),
              fetchNewAchievements(lastCheck),
            ]);

          // Emit events
          for (const assignment of newAssignments) {
            controller.enqueue(
              encoder.encode(formatSSE('assignment_created', assignment))
            );
          }

          for (const assignment of completedAssignments) {
            controller.enqueue(
              encoder.encode(formatSSE('assignment_completed', assignment))
            );
          }

          for (const problem of newProblems) {
            controller.enqueue(
              encoder.encode(formatSSE('problem_triggered', problem))
            );
          }

          for (const achievement of newAchievements) {
            controller.enqueue(
              encoder.encode(formatSSE('achievement_earned', achievement))
            );
          }

          // Heartbeat if enough time has passed since the last one
          if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
            controller.enqueue(
              encoder.encode(
                formatSSE('heartbeat', { timestamp: now.toISOString() })
              )
            );
            lastHeartbeat = Date.now();
          }

          lastCheck = now;
        } catch (error) {
          // Log but don't kill the stream for transient errors
          log.error(
            'SSE poll error',
            error instanceof Error ? error : undefined
          );

          // Send an error event to the client
          try {
            controller.enqueue(
              encoder.encode(
                formatSSE('error', {
                  message: 'Temporary polling error',
                  timestamp: new Date().toISOString(),
                })
              )
            );
          } catch {
            // Stream may be closed, stop polling
            aborted = true;
            return;
          }
        }

        // Schedule next poll
        if (!aborted) {
          pollTimeout = setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      let pollTimeout = setTimeout(poll, POLL_INTERVAL_MS);

      // Handle client disconnect via AbortSignal
      request.signal.addEventListener('abort', () => {
        aborted = true;
        clearTimeout(pollTimeout);
        try {
          controller.close();
        } catch {
          // Already closed
        }
        log.debug('SSE client disconnected');
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
};

/**
 * Disable static generation for this SSE endpoint.
 */
export const dynamic = 'force-dynamic';
