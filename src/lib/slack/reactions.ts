/**
 * Reaction Event Handling Service
 * Tracks emoji reactions on assignment messages to update review status
 */

import { db } from '@/lib/db';
import { publishAppHome } from '@/lib/slack/views/app-home';
import { recordCompletionWithAchievements } from '@/lib/stats';
import { createLogger } from '@/lib/utils/logger';
import type { AssignmentStatus, ReactionAction } from '@/generated/prisma';

const log = createLogger('slack:reactions');

// Default emoji → status mappings (can be overridden in DB)
const DEFAULT_EMOJI_STATUS_MAP: Record<string, AssignmentStatus> = {
  eyes: 'IN_REVIEW',
  eyeglasses: 'IN_REVIEW',
  speech_balloon: 'IN_REVIEW', // Commented but still reviewing
  comment: 'IN_REVIEW',
  x: 'CHANGES_REQUESTED',
  no_entry: 'CHANGES_REQUESTED',
  no_entry_sign: 'CHANGES_REQUESTED',
  white_check_mark: 'APPROVED',
  heavy_check_mark: 'APPROVED',
  checkmark: 'APPROVED',
  '+1': 'APPROVED',
  thumbsup: 'APPROVED',
};

// Emojis that count as rejections for tracking
const REJECTION_EMOJIS = ['x', 'no_entry', 'no_entry_sign'];

// Emojis that indicate review is starting
const REVIEW_START_EMOJIS = ['eyes', 'eyeglasses'];

/**
 * Get emoji → status mappings from DB (with fallback to defaults)
 */
export const getEmojiStatusMap = async (): Promise<Record<string, AssignmentStatus>> => {
  const mappings = await db.statusReactionMapping.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (mappings.length === 0) {
    return DEFAULT_EMOJI_STATUS_MAP;
  }

  const map: Record<string, AssignmentStatus> = {};
  for (const mapping of mappings) {
    for (const emoji of mapping.emojis) {
      map[emoji] = mapping.status;
    }
  }

  return map;
};

interface ReactionEventPayload {
  type: 'reaction_added' | 'reaction_removed';
  user: string; // Slack user ID who reacted
  reaction: string; // Emoji name (without colons)
  item: {
    type: string;
    channel: string;
    ts: string;
  };
  event_ts: string;
}

/**
 * Handle reaction_added or reaction_removed event
 */
export const handleReactionEvent = async (event: ReactionEventPayload): Promise<void> => {
  // Only process reactions on messages
  if (event.item.type !== 'message') return;

  const { user: slackUserId, reaction: emoji, item } = event;
  const action: ReactionAction = event.type === 'reaction_added' ? 'ADDED' : 'REMOVED';

  log.debug('Reaction event', { action, emoji, user: slackUserId, channel: item.channel, ts: item.ts });

  // Find assignment by Slack message coordinates
  const assignment = await db.assignment.findFirst({
    where: {
      slackChannelId: item.channel,
      slackMessageTs: item.ts,
    },
    include: {
      reviewer: true,
      author: true,
    },
  });

  if (!assignment) {
    // Not a reaction on an assignment message - ignore
    log.debug('No assignment found for message', { channel: item.channel, ts: item.ts });
    return;
  }

  // Check if this is the assigned reviewer
  const isReviewer = assignment.reviewer?.slackId === slackUserId;

  // Record the reaction event (immutable audit log)
  await db.reactionEvent.create({
    data: {
      assignmentId: assignment.id,
      userId: slackUserId,
      emoji,
      action,
      isReviewer,
    },
  });

  log.info('Recorded reaction event', {
    assignment: `${assignment.prUrl}`,
    emoji,
    action,
    isReviewer,
  });

  // Only assigned reviewer's reactions change status
  if (!isReviewer) {
    log.debug('Reaction from non-reviewer - recorded but status unchanged');
    return;
  }

  // Derive new status from emoji
  const emojiMap = await getEmojiStatusMap();
  const newStatus = emojiMap[emoji];

  if (!newStatus) {
    log.debug('Unknown emoji - no status change', { emoji });
    return;
  }

  // Only process ADDED reactions for status changes
  if (action !== 'ADDED') {
    log.debug('Reaction removed - no status change');
    return;
  }

  // Build update data
  const updateData: {
    status: AssignmentStatus;
    firstReviewActivityAt?: Date;
    rejectionCount?: { increment: number };
    reviewCycleCount?: { increment: number };
    completedAt?: Date;
  } = {
    status: newStatus,
  };

  // Track first review activity
  if (!assignment.firstReviewActivityAt && REVIEW_START_EMOJIS.includes(emoji)) {
    updateData.firstReviewActivityAt = new Date();
  }

  // Track rejections
  if (REJECTION_EMOJIS.includes(emoji)) {
    updateData.rejectionCount = { increment: 1 };

    // If previous status was IN_REVIEW, this is a review cycle
    if (assignment.status === 'IN_REVIEW') {
      updateData.reviewCycleCount = { increment: 1 };
    }
  }

  // Track completion
  if (newStatus === 'APPROVED' && !assignment.completedAt) {
    updateData.completedAt = new Date();
  }

  // Update assignment
  await db.assignment.update({
    where: { id: assignment.id },
    data: updateData,
  });

  log.info('Updated assignment status', {
    assignment: assignment.prUrl,
    oldStatus: assignment.status,
    newStatus,
    emoji,
  });

  // Record stats, achievements, and challenge progress on review completion
  if (newStatus === 'APPROVED' && assignment.reviewer) {
    const responseTimeMinutes = assignment.firstReviewActivityAt
      ? Math.round((Date.now() - assignment.firstReviewActivityAt.getTime()) / 60000)
      : assignment.assignedAt
        ? Math.round((Date.now() - assignment.assignedAt.getTime()) / 60000)
        : null;

    recordCompletionWithAchievements(
      assignment.reviewer.id,
      assignment.reviewer.slackId,
      assignment.repositoryId,
      responseTimeMinutes
    ).catch((err) =>
      log.error('Failed to record completion stats', err instanceof Error ? err : undefined)
    );
  }

  // Refresh App Home for affected users
  const usersToRefresh = [
    assignment.reviewer?.slackId,
    assignment.author?.slackId,
  ].filter(Boolean) as string[];

  for (const userId of usersToRefresh) {
    publishAppHome(userId).catch((err) =>
      log.error('Failed to refresh App Home', err instanceof Error ? err : undefined, { userId })
    );
  }
};

/**
 * Get current reaction-based status for an assignment
 * Used for reconciliation if needed
 */
export const deriveStatusFromReactions = async (
  assignmentId: string
): Promise<AssignmentStatus | null> => {
  const events = await db.reactionEvent.findMany({
    where: {
      assignmentId,
      isReviewer: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (events.length === 0) return null;

  const emojiMap = await getEmojiStatusMap();

  // Build current state: track which emojis are "on"
  const activeEmojis = new Set<string>();

  // Process in reverse chronological order (oldest first) to build state
  for (const event of [...events].reverse()) {
    if (event.action === 'ADDED') {
      activeEmojis.add(event.emoji);
    } else {
      activeEmojis.delete(event.emoji);
    }
  }

  // Find the highest priority active emoji
  // Priority: APPROVED > CHANGES_REQUESTED > IN_REVIEW
  const statusPriority: AssignmentStatus[] = ['APPROVED', 'CHANGES_REQUESTED', 'IN_REVIEW'];

  for (const status of statusPriority) {
    for (const emoji of activeEmojis) {
      if (emojiMap[emoji] === status) {
        return status;
      }
    }
  }

  return null;
};

/**
 * Seed default status reaction mappings
 */
export const seedStatusMappings = async (): Promise<void> => {
  const defaults = [
    {
      status: 'IN_REVIEW' as const,
      emojis: ['eyes', 'eyeglasses', 'speech_balloon', 'comment'],
      displayEmoji: '👀',
      sortOrder: 1,
    },
    {
      status: 'CHANGES_REQUESTED' as const,
      emojis: ['x', 'no_entry', 'no_entry_sign'],
      displayEmoji: '❌',
      sortOrder: 2,
    },
    {
      status: 'APPROVED' as const,
      emojis: ['white_check_mark', 'heavy_check_mark', 'checkmark', '+1', 'thumbsup'],
      displayEmoji: '✅',
      sortOrder: 3,
    },
  ];

  for (const mapping of defaults) {
    await db.statusReactionMapping.upsert({
      where: { status: mapping.status },
      create: mapping,
      update: {
        emojis: mapping.emojis,
        displayEmoji: mapping.displayEmoji,
        sortOrder: mapping.sortOrder,
      },
    });
  }

  log.info('Seeded default status reaction mappings');
};
