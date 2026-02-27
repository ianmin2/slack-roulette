/**
 * User Sync Service
 *
 * Syncs Slack channel members with the PR Roulette user database.
 * Handles bulk sync, single user sync, and member join/leave events.
 */

import { db } from '@/lib/db';
import { getUserInfo, postMessage } from '@/lib/slack/client';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('sync');

const SLACK_API_BASE = 'https://slack.com/api';

interface SyncReport {
  added: number;
  updated: number;
  deactivated: number;
  skipped: number;
  errors: number;
  total: number;
}

/**
 * Fetch all members of a Slack channel (handles pagination)
 */
const getChannelMembers = async (channelId: string): Promise<string[]> => {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not configured');

  const members: string[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ channel: channelId, limit: '200' });
    if (cursor) params.set('cursor', cursor);

    const response = await fetch(`${SLACK_API_BASE}/conversations.members?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`conversations.members failed: ${data.error}`);
    }

    members.push(...(data.members ?? []));
    cursor = data.response_metadata?.next_cursor;
  } while (cursor);

  return members;
};

/**
 * Check if a Slack user is a bot
 */
const isBot = async (slackId: string): Promise<boolean> => {
  const user = await getUserInfo(slackId);
  if (!user) return true; // Treat unreachable users as bots
  return (user as unknown as { is_bot?: boolean }).is_bot === true;
};

/**
 * Sync a single user from Slack to the database
 */
export const syncSingleUser = async (slackId: string): Promise<{ action: 'created' | 'updated' | 'skipped'; userId?: string }> => {
  const slackUser = await getUserInfo(slackId);
  if (!slackUser) return { action: 'skipped' };

  // Skip bots
  if ((slackUser as unknown as { is_bot?: boolean }).is_bot) return { action: 'skipped' };

  const existing = await db.user.findUnique({ where: { slackId } });

  if (existing) {
    // Update display name and avatar if changed
    if (
      existing.displayName !== (slackUser.profile.display_name || slackUser.real_name || slackUser.name) ||
      existing.avatarUrl !== slackUser.profile.image_48
    ) {
      await db.user.update({
        where: { slackId },
        data: {
          displayName: slackUser.profile.display_name || slackUser.real_name || slackUser.name,
          avatarUrl: slackUser.profile.image_48,
          email: slackUser.profile.email || existing.email,
        },
      });
      return { action: 'updated', userId: existing.id };
    }
    return { action: 'skipped', userId: existing.id };
  }

  // Create new user
  const userCount = await db.user.count({ where: { deletedAt: null } });
  const role = userCount === 0 ? 'ADMIN' as const : 'DEVELOPER' as const;

  const user = await db.user.create({
    data: {
      slackId,
      displayName: slackUser.profile.display_name || slackUser.real_name || slackUser.name,
      email: slackUser.profile.email,
      avatarUrl: slackUser.profile.image_48,
      role,
    },
  });

  return { action: 'created', userId: user.id };
};

/**
 * Sync all members of a channel to the database.
 * Creates new users, updates existing ones, and marks absent users as unavailable.
 */
export const syncChannelMembers = async (channelId: string): Promise<SyncReport> => {
  log.info('Starting channel member sync', { channelId });

  const report: SyncReport = {
    added: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    errors: 0,
    total: 0,
  };

  // Fetch all channel members
  const memberIds = await getChannelMembers(channelId);
  report.total = memberIds.length;

  log.info('Fetched channel members', { count: memberIds.length });

  // Sync each member
  const memberSlackIds = new Set<string>();

  for (const slackId of memberIds) {
    try {
      // Skip the bot itself
      if (await isBot(slackId)) {
        report.skipped++;
        continue;
      }

      memberSlackIds.add(slackId);
      const result = await syncSingleUser(slackId);

      switch (result.action) {
        case 'created':
          report.added++;
          break;
        case 'updated':
          report.updated++;
          break;
        case 'skipped':
          report.skipped++;
          break;
      }
    } catch (error) {
      log.error('Error syncing user', error instanceof Error ? error : undefined, { slackId });
      report.errors++;
    }
  }

  // Deactivate users not in the channel (set availability to UNAVAILABLE)
  const allUsers = await db.user.findMany({
    where: { deletedAt: null },
    select: { id: true, slackId: true, availabilityStatus: true },
  });

  for (const user of allUsers) {
    if (!memberSlackIds.has(user.slackId) && user.availabilityStatus !== 'UNAVAILABLE') {
      await db.user.update({
        where: { id: user.id },
        data: { availabilityStatus: 'UNAVAILABLE' },
      });
      report.deactivated++;
    }
  }

  log.info('Channel sync complete', { ...report });
  return report;
};

/**
 * Handle member_joined_channel event
 */
export const handleMemberJoined = async (event: {
  user: string;
  channel: string;
}): Promise<void> => {
  const { user: slackId, channel: channelId } = event;

  log.info('Member joined channel', { slackId, channelId });

  const result = await syncSingleUser(slackId);

  if (result.action === 'created') {
    // Post welcome message
    await postMessage(
      channelId,
      `Welcome <@${slackId}>! You've been added to PR Roulette.\n\n` +
      `Open the *App Home* tab (click "PR Roulette" in Apps) to complete your setup and link your GitHub account.\n\n` +
      `Use \`/pr-roulette help\` to see all available commands.`
    );
  } else if (result.action === 'updated' || result.action === 'skipped') {
    // Existing user rejoined — make sure they're available
    if (result.userId) {
      const user = await db.user.findUnique({ where: { id: result.userId } });
      if (user?.availabilityStatus === 'UNAVAILABLE') {
        await db.user.update({
          where: { id: result.userId },
          data: { availabilityStatus: 'AVAILABLE' },
        });
      }
    }
  }
};

/**
 * Handle member_left_channel event
 */
export const handleMemberLeft = async (event: {
  user: string;
  channel: string;
}): Promise<void> => {
  const { user: slackId } = event;

  log.info('Member left channel', { slackId });

  const user = await db.user.findUnique({ where: { slackId } });
  if (user) {
    await db.user.update({
      where: { id: user.id },
      data: { availabilityStatus: 'UNAVAILABLE' },
    });
  }
};

/**
 * Format sync report for Slack display
 */
export const formatSyncReport = (report: SyncReport): string =>
  `*Channel Sync Complete*\n\n` +
  `Total members: ${report.total}\n` +
  `Added: ${report.added}\n` +
  `Updated: ${report.updated}\n` +
  `Deactivated: ${report.deactivated}\n` +
  `Skipped (bots): ${report.skipped}\n` +
  (report.errors > 0 ? `Errors: ${report.errors}\n` : '');

export type { SyncReport };
