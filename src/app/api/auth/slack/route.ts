/**
 * Slack OAuth Redirect Endpoint
 *
 * GET /api/auth/slack
 *
 * Initiates the Slack OAuth flow by redirecting the user to
 * Slack's authorization page. Generates a CSRF state token
 * and stores it in a short-lived cookie for validation on callback.
 */

import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('auth:slack');

/** CSRF state cookie name */
const STATE_COOKIE_NAME = 'pr_roulette_oauth_state';

/** State cookie TTL in seconds (10 minutes — plenty for an OAuth round-trip) */
const STATE_COOKIE_MAX_AGE = 10 * 60;

/**
 * Build the Slack OAuth authorization URL.
 */
const buildSlackOAuthUrl = (state: string): string => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const appUrl = process.env.APP_URL;

  if (!clientId || !appUrl) {
    throw new Error('Missing required env vars: SLACK_CLIENT_ID, APP_URL');
  }

  const redirectUri = `${appUrl}/api/auth/slack/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    user_scope: 'identity.basic,identity.avatar',
    state,
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
};

/**
 * GET /api/auth/slack
 *
 * Redirects the browser to Slack's OAuth consent screen.
 */
export const GET = async (): Promise<NextResponse> => {
  try {
    const state = crypto.randomUUID();
    const oauthUrl = buildSlackOAuthUrl(state);

    log.info('Initiating Slack OAuth flow');

    const response = NextResponse.redirect(oauthUrl);

    // Store state in a secure, httpOnly cookie for CSRF validation
    response.cookies.set(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: STATE_COOKIE_MAX_AGE,
    });

    return response;
  } catch (error) {
    log.error('Failed to initiate Slack OAuth', error instanceof Error ? error : new Error(String(error)));

    return NextResponse.json(
      { success: false, error: 'Failed to initiate authentication' },
      { status: 500 }
    );
  }
};
