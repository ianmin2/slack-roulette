/**
 * Slack API Client
 *
 * Provides typed access to Slack Web API methods.
 * Uses native fetch - no SDK required.
 */

import { loggers } from '@/lib/utils/logger';

const log = loggers.slack;
const SLACK_API_BASE = 'https://slack.com/api';

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile: {
    email?: string;
    display_name?: string;
    image_48?: string;
  };
}

interface SlackMessage {
  ts: string;
  channel: string;
}

const getToken = (): string => {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not configured');
  return token;
};

/**
 * Make an authenticated request to Slack API
 */
const slackRequest = async (
  method: string,
  body?: Record<string, unknown>
): Promise<SlackApiResponse> => {
  const response = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

/**
 * Get user info by Slack ID
 */
export const getUserInfo = async (userId: string): Promise<SlackUser | null> => {
  const response = await slackRequest('users.info', { user: userId });

  if (!response.ok) {
    log.error('Failed to get user info', { userId, error: response.error });
    return null;
  }

  return (response as { ok: boolean; user: SlackUser }).user;
};

/**
 * Post a message to a channel
 */
export const postMessage = async (
  channel: string,
  text: string,
  options?: {
    thread_ts?: string;
    blocks?: unknown[];
    unfurl_links?: boolean;
  }
): Promise<SlackMessage | null> => {
  const response = await slackRequest('chat.postMessage', {
    channel,
    text,
    ...options,
  });

  if (!response.ok) {
    log.error('Failed to post message', { channel, error: response.error });
    return null;
  }

  return {
    ts: response.ts as string,
    channel: response.channel as string,
  };
};

/**
 * Post an ephemeral message (only visible to one user)
 */
export const postEphemeral = async (
  channel: string,
  user: string,
  text: string,
  options?: {
    thread_ts?: string;
    blocks?: unknown[];
  }
): Promise<boolean> => {
  const response = await slackRequest('chat.postEphemeral', {
    channel,
    user,
    text,
    ...options,
  });

  if (!response.ok) {
    log.error('Failed to post ephemeral message', { channel, user, error: response.error });
    return false;
  }

  return true;
};

/**
 * Add a reaction to a message
 */
export const addReaction = async (
  channel: string,
  timestamp: string,
  emoji: string
): Promise<boolean> => {
  const response = await slackRequest('reactions.add', {
    channel,
    timestamp,
    name: emoji,
  });

  // Ignore "already_reacted" errors
  if (!response.ok && response.error !== 'already_reacted') {
    log.error('Failed to add reaction', { channel, timestamp, emoji, error: response.error });
    return false;
  }

  return true;
};

export type { SlackUser, SlackMessage };
