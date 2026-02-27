/**
 * Logout Endpoint
 *
 * POST /api/auth/logout
 *
 * Destroys the dashboard session and clears the session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { deleteSession, SESSION_COOKIE_NAME } from '@/lib/dashboard/auth';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('auth:logout');

/**
 * POST /api/auth/logout
 */
export const POST = async (request: NextRequest): Promise<NextResponse> => {
  try {
    const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (sessionId) {
      await deleteSession(sessionId);
      log.info('User logged out', { sessionId });
    }

    const response = NextResponse.json({ success: true });

    // Clear the session cookie regardless of whether a session existed
    response.cookies.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (error) {
    log.error(
      'Logout failed',
      error instanceof Error ? error : new Error(String(error))
    );

    // Still clear the cookie even if session deletion failed
    const response = NextResponse.json({ success: true });

    response.cookies.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    return response;
  }
};
