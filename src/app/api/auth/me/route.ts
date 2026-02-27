/**
 * Current Session Endpoint
 *
 * GET /api/auth/me
 *
 * Returns the authenticated user's profile if the session
 * cookie is present and valid. Returns 401 otherwise.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/dashboard/auth';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('auth:me');

/**
 * GET /api/auth/me
 */
export const GET = async (request: NextRequest): Promise<NextResponse> => {
  try {
    const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const result = await validateSession(sessionId);

    if (!result.valid || !result.user) {
      return NextResponse.json(
        { success: false, error: 'Session expired or invalid' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        user: result.user,
      },
    });
  } catch (error) {
    log.error(
      'Failed to validate session',
      error instanceof Error ? error : new Error(String(error))
    );

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
};
