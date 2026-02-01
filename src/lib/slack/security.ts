/**
 * Slack Security Utilities
 *
 * Shared security functions for Slack request verification.
 * Used by commands, events, and interactions endpoints.
 */

import crypto from 'crypto';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('slack:security');

/**
 * Get Slack signing secret from environment
 */
export const getSigningSecret = (): string => {
  return process.env.SLACK_SIGNING_SECRET ?? '';
};

/**
 * Get Slack bot token from environment
 */
export const getBotToken = (): string => {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }
  return token;
};

/**
 * Verify Slack request signature
 *
 * Validates that the request came from Slack using HMAC-SHA256.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * @param signature - The x-slack-signature header value
 * @param timestamp - The x-slack-request-timestamp header value
 * @param body - The raw request body
 * @returns true if signature is valid
 */
export const verifySlackSignature = (
  signature: string,
  timestamp: string,
  body: string
): boolean => {
  const signingSecret = getSigningSecret();

  if (!signingSecret) {
    log.warn('SLACK_SIGNING_SECRET not configured, skipping verification');
    return true; // Allow in development without secret
  }

  // Check timestamp to prevent replay attacks (5 minute window)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    log.warn('Slack request timestamp too old', { timestamp });
    return false;
  }

  // Calculate expected signature
  const baseString = `v0:${timestamp}:${body}`;
  const hash = crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');
  const expectedSignature = `v0=${hash}`;

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

/**
 * Extract Slack headers from a request
 */
export const getSlackHeaders = (request: Request): {
  signature: string;
  timestamp: string;
} => ({
  signature: request.headers.get('x-slack-signature') ?? '',
  timestamp: request.headers.get('x-slack-request-timestamp') ?? '',
});

/**
 * Verify request and return error response if invalid
 * Returns null if valid, NextResponse if invalid
 */
export const verifyRequestOrError = (
  signature: string,
  timestamp: string,
  body: string
): { error: string; status: number } | null => {
  if (!verifySlackSignature(signature, timestamp, body)) {
    return { error: 'Invalid signature', status: 401 };
  }
  return null;
};
