/**
 * Slack OAuth Callback Endpoint
 *
 * GET /api/auth/slack/callback
 *
 * Handles the redirect back from Slack after the user authorises.
 * Exchanges the authorization code for a token, resolves the Slack
 * user identity, verifies they exist in the local DB, creates a
 * dashboard session, and redirects to /dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createSession, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE } from '@/lib/dashboard/auth';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('auth:slack:callback');

/** CSRF state cookie (must match the one set in /api/auth/slack) */
const STATE_COOKIE_NAME = 'pr_roulette_oauth_state';

// =============================================================================
// TYPES
// =============================================================================

interface SlackOAuthTokenResponse {
  ok: boolean;
  error?: string;
  authed_user?: {
    id: string;
    scope: string;
    access_token: string;
    token_type: string;
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Exchange an OAuth authorization code for a Slack access token.
 */
const exchangeCodeForToken = async (code: string): Promise<SlackOAuthTokenResponse> => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    throw new Error('Missing required env vars: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, APP_URL');
  }

  const redirectUri = `${appUrl}/api/auth/slack/callback`;

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack token exchange failed with HTTP ${response.status}`);
  }

  return response.json() as Promise<SlackOAuthTokenResponse>;
};

/**
 * Redirect to an error page with a descriptive message.
 */
const errorRedirect = (appUrl: string, reason: string): NextResponse => {
  const url = new URL('/auth/error', appUrl);
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url.toString());
};

// =============================================================================
// ROUTE HANDLER
// =============================================================================

/**
 * GET /api/auth/slack/callback?code=...&state=...
 */
export const GET = async (request: NextRequest): Promise<NextResponse> => {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  try {
    const { searchParams } = request.nextUrl;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // ------------------------------------------------------------------
    // 1. Handle Slack-side errors (e.g. user denied access)
    // ------------------------------------------------------------------
    if (error) {
      log.warn('Slack OAuth returned error', { error });
      return errorRedirect(appUrl, 'access_denied');
    }

    // ------------------------------------------------------------------
    // 2. Validate required parameters
    // ------------------------------------------------------------------
    if (!code || !state) {
      log.warn('Missing code or state in OAuth callback');
      return errorRedirect(appUrl, 'missing_params');
    }

    // ------------------------------------------------------------------
    // 3. CSRF: verify state matches cookie
    // ------------------------------------------------------------------
    const storedState = request.cookies.get(STATE_COOKIE_NAME)?.value;

    if (!storedState || storedState !== state) {
      log.warn('OAuth state mismatch (possible CSRF)', {
        received: state,
        expected: storedState ?? '<missing>',
      });
      return errorRedirect(appUrl, 'state_mismatch');
    }

    // ------------------------------------------------------------------
    // 4. Exchange code for token
    // ------------------------------------------------------------------
    const tokenResponse = await exchangeCodeForToken(code);

    if (!tokenResponse.ok || !tokenResponse.authed_user?.id) {
      log.error('Slack token exchange failed', {
        error: tokenResponse.error ?? 'unknown',
      });
      return errorRedirect(appUrl, 'token_exchange_failed');
    }

    const slackUserId = tokenResponse.authed_user.id;

    // ------------------------------------------------------------------
    // 5. Verify user exists in our database
    // ------------------------------------------------------------------
    const user = await db.user.findUnique({
      where: { slackId: slackUserId },
      select: { id: true, slackId: true, displayName: true },
    });

    if (!user) {
      log.warn('OAuth login rejected — user not found in DB', { slackUserId });
      return errorRedirect(appUrl, 'user_not_found');
    }

    // ------------------------------------------------------------------
    // 6. Create dashboard session
    // ------------------------------------------------------------------
    const { sessionId, expiresAt } = await createSession(slackUserId);

    log.info('Slack OAuth login successful', {
      userId: user.id,
      displayName: user.displayName,
    });

    // ------------------------------------------------------------------
    // 7. Set session cookie and redirect to dashboard
    // ------------------------------------------------------------------
    const response = NextResponse.redirect(new URL('/dashboard', appUrl));

    response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_COOKIE_MAX_AGE,
      expires: expiresAt,
    });

    // Clear the CSRF state cookie — it served its purpose
    response.cookies.delete(STATE_COOKIE_NAME);

    return response;
  } catch (error) {
    log.error(
      'Unhandled error in Slack OAuth callback',
      error instanceof Error ? error : new Error(String(error))
    );

    return errorRedirect(appUrl, 'internal_error');
  }
};
