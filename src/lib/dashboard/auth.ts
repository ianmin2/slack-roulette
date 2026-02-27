/**
 * Dashboard Authentication Utilities
 *
 * Manages DashboardSession lifecycle for Slack OAuth-based
 * web dashboard authentication.
 *
 * - Session creation with 24h TTL
 * - Session validation with touch (lastAccessedAt update)
 * - Session cleanup for expired entries
 */

import crypto from 'crypto';
import { db } from '@/lib/db';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('dashboard:auth');

// =============================================================================
// CONSTANTS
// =============================================================================

/** Session time-to-live in milliseconds (24 hours) */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Cookie name for dashboard session */
export const SESSION_COOKIE_NAME = 'pr_roulette_session';

/** Cookie max-age in seconds (24 hours) */
export const SESSION_COOKIE_MAX_AGE = 24 * 60 * 60;

// =============================================================================
// TYPES
// =============================================================================

interface SessionUser {
  id: string;
  slackId: string;
  displayName: string;
  role: string;
  avatarUrl: string | null;
}

interface SessionValidationResult {
  valid: boolean;
  user?: SessionUser;
}

interface SessionCreationResult {
  sessionId: string;
  expiresAt: Date;
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Create a new dashboard session for a Slack user.
 *
 * Generates a unique access token and stores the session
 * with a 24-hour expiration.
 */
export const createSession = async (slackUserId: string): Promise<SessionCreationResult> => {
  const accessToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await db.dashboardSession.create({
    data: {
      slackUserId,
      accessToken,
      expiresAt,
    },
  });

  log.info('Dashboard session created', { slackUserId, sessionId: session.id });

  return {
    sessionId: session.id,
    expiresAt,
  };
};

/**
 * Validate an existing dashboard session.
 *
 * Checks that the session exists and has not expired.
 * On success, touches `lastAccessedAt` and returns the associated user.
 * Returns `{ valid: false }` for missing, expired, or orphaned sessions.
 */
export const validateSession = async (sessionId: string): Promise<SessionValidationResult> => {
  const session = await db.dashboardSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    log.debug('Session not found', { sessionId });
    return { valid: false };
  }

  if (session.expiresAt < new Date()) {
    log.debug('Session expired', { sessionId, expiresAt: session.expiresAt.toISOString() });
    // Clean up the expired session
    await db.dashboardSession.delete({ where: { id: sessionId } }).catch(() => {
      // Ignore deletion errors for already-deleted sessions
    });
    return { valid: false };
  }

  // Look up the user by slackId
  const user = await db.user.findUnique({
    where: { slackId: session.slackUserId },
    select: {
      id: true,
      slackId: true,
      displayName: true,
      role: true,
      avatarUrl: true,
    },
  });

  if (!user) {
    log.warn('Session references non-existent user', {
      sessionId,
      slackUserId: session.slackUserId,
    });
    // Orphaned session — remove it
    await db.dashboardSession.delete({ where: { id: sessionId } }).catch(() => {});
    return { valid: false };
  }

  // Touch lastAccessedAt (fire-and-forget, non-blocking)
  db.dashboardSession
    .update({
      where: { id: sessionId },
      data: { lastAccessedAt: new Date() },
    })
    .catch((err: unknown) => {
      log.warn('Failed to update lastAccessedAt', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return {
    valid: true,
    user: {
      id: user.id,
      slackId: user.slackId,
      displayName: user.displayName,
      role: user.role,
      avatarUrl: user.avatarUrl,
    },
  };
};

/**
 * Delete a specific dashboard session (logout).
 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  await db.dashboardSession
    .delete({ where: { id: sessionId } })
    .catch((err: unknown) => {
      // Ignore "record not found" — session may already be gone
      log.debug('Session deletion skipped (may not exist)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  log.info('Dashboard session deleted', { sessionId });
};

/**
 * Delete all expired dashboard sessions.
 *
 * Intended to be called from a cron job or periodic cleanup task.
 * Returns the number of sessions removed.
 */
export const cleanExpiredSessions = async (): Promise<number> => {
  const result = await db.dashboardSession.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  if (result.count > 0) {
    log.info('Expired dashboard sessions cleaned', { count: result.count });
  }

  return result.count;
};
