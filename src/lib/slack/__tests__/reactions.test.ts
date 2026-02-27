/**
 * Reaction Event Handling Tests
 */

import { handleReactionEvent, getEmojiStatusMap, deriveStatusFromReactions } from '../reactions';
import { db } from '@/lib/db';
import { publishAppHome } from '@/lib/slack/views/app-home';

// Mock dependencies
jest.mock('@/lib/db', () => ({
  db: {
    assignment: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    reactionEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    statusReactionMapping: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/slack/views/app-home', () => ({
  publishAppHome: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/utils/logger', () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    createLogger: () => mockLogger,
    loggers: {
      slack: mockLogger,
      github: mockLogger,
      db: mockLogger,
      api: mockLogger,
      admin: mockLogger,
      digest: mockLogger,
      assignment: mockLogger,
      analytics: mockLogger,
      challenges: mockLogger,
      goals: mockLogger,
    },
  };
});

describe('reactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getEmojiStatusMap', () => {
    it('should return default mappings when no DB mappings exist', async () => {
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      const map = await getEmojiStatusMap();

      expect(map.eyes).toBe('IN_REVIEW');
      expect(map.white_check_mark).toBe('APPROVED');
      expect(map.x).toBe('CHANGES_REQUESTED');
    });

    it('should return DB mappings when they exist', async () => {
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([
        { status: 'APPROVED', emojis: ['shipit', 'rocket'], sortOrder: 1, isActive: true },
      ]);

      const map = await getEmojiStatusMap();

      expect(map.shipit).toBe('APPROVED');
      expect(map.rocket).toBe('APPROVED');
    });
  });

  describe('handleReactionEvent', () => {
    const mockAssignment = {
      id: 'assign-1',
      prUrl: 'https://github.com/org/repo/pull/1',
      slackChannelId: 'C123',
      slackMessageTs: '1234567890.123456',
      status: 'ASSIGNED',
      firstReviewActivityAt: null,
      rejectionCount: 0,
      reviewCycleCount: 0,
      completedAt: null,
      reviewer: { id: 'user-1', slackId: 'U123' },
      author: { id: 'user-2', slackId: 'U456' },
    };

    it('should ignore reactions on non-assignment messages', async () => {
      (db.assignment.findFirst as jest.Mock).mockResolvedValue(null);

      await handleReactionEvent({
        type: 'reaction_added',
        user: 'U123',
        reaction: 'eyes',
        item: { type: 'message', channel: 'C999', ts: '999.999' },
        event_ts: '123.456',
      });

      expect(db.reactionEvent.create).not.toHaveBeenCalled();
    });

    it('should record reaction event but not change status for non-reviewer', async () => {
      (db.assignment.findFirst as jest.Mock).mockResolvedValue(mockAssignment);
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      await handleReactionEvent({
        type: 'reaction_added',
        user: 'U999', // Not the assigned reviewer
        reaction: 'eyes',
        item: { type: 'message', channel: 'C123', ts: '1234567890.123456' },
        event_ts: '123.456',
      });

      expect(db.reactionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          assignmentId: 'assign-1',
          emoji: 'eyes',
          action: 'ADDED',
          isReviewer: false,
        }),
      });
      expect(db.assignment.update).not.toHaveBeenCalled();
    });

    it('should update status when assigned reviewer adds status emoji', async () => {
      (db.assignment.findFirst as jest.Mock).mockResolvedValue(mockAssignment);
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      await handleReactionEvent({
        type: 'reaction_added',
        user: 'U123', // Assigned reviewer
        reaction: 'eyes',
        item: { type: 'message', channel: 'C123', ts: '1234567890.123456' },
        event_ts: '123.456',
      });

      expect(db.reactionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isReviewer: true,
        }),
      });
      expect(db.assignment.update).toHaveBeenCalledWith({
        where: { id: 'assign-1' },
        data: expect.objectContaining({
          status: 'IN_REVIEW',
          firstReviewActivityAt: expect.any(Date),
        }),
      });
    });

    it('should track rejection count when x emoji added', async () => {
      const assignmentInReview = { ...mockAssignment, status: 'IN_REVIEW' };
      (db.assignment.findFirst as jest.Mock).mockResolvedValue(assignmentInReview);
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      await handleReactionEvent({
        type: 'reaction_added',
        user: 'U123',
        reaction: 'x',
        item: { type: 'message', channel: 'C123', ts: '1234567890.123456' },
        event_ts: '123.456',
      });

      expect(db.assignment.update).toHaveBeenCalledWith({
        where: { id: 'assign-1' },
        data: expect.objectContaining({
          status: 'CHANGES_REQUESTED',
          rejectionCount: { increment: 1 },
          reviewCycleCount: { increment: 1 },
        }),
      });
    });

    it('should set completedAt when approved', async () => {
      (db.assignment.findFirst as jest.Mock).mockResolvedValue(mockAssignment);
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      await handleReactionEvent({
        type: 'reaction_added',
        user: 'U123',
        reaction: 'white_check_mark',
        item: { type: 'message', channel: 'C123', ts: '1234567890.123456' },
        event_ts: '123.456',
      });

      expect(db.assignment.update).toHaveBeenCalledWith({
        where: { id: 'assign-1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          completedAt: expect.any(Date),
        }),
      });
    });

    it('should refresh App Home for affected users', async () => {
      (db.assignment.findFirst as jest.Mock).mockResolvedValue(mockAssignment);
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      await handleReactionEvent({
        type: 'reaction_added',
        user: 'U123',
        reaction: 'eyes',
        item: { type: 'message', channel: 'C123', ts: '1234567890.123456' },
        event_ts: '123.456',
      });

      expect(publishAppHome).toHaveBeenCalledWith('U123');
      expect(publishAppHome).toHaveBeenCalledWith('U456');
    });

    it('should not update status on reaction_removed', async () => {
      (db.assignment.findFirst as jest.Mock).mockResolvedValue(mockAssignment);
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      await handleReactionEvent({
        type: 'reaction_removed',
        user: 'U123',
        reaction: 'eyes',
        item: { type: 'message', channel: 'C123', ts: '1234567890.123456' },
        event_ts: '123.456',
      });

      expect(db.reactionEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'REMOVED',
        }),
      });
      expect(db.assignment.update).not.toHaveBeenCalled();
    });
  });

  describe('deriveStatusFromReactions', () => {
    it('should return null when no reviewer reactions exist', async () => {
      (db.reactionEvent.findMany as jest.Mock).mockResolvedValue([]);
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      const status = await deriveStatusFromReactions('assign-1');

      expect(status).toBeNull();
    });

    it('should return highest priority active status', async () => {
      (db.reactionEvent.findMany as jest.Mock).mockResolvedValue([
        { emoji: 'eyes', action: 'ADDED', createdAt: new Date('2026-01-01') },
        { emoji: 'white_check_mark', action: 'ADDED', createdAt: new Date('2026-01-02') },
      ]);
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      const status = await deriveStatusFromReactions('assign-1');

      expect(status).toBe('APPROVED');
    });

    it('should respect removed reactions', async () => {
      // Events returned from DB in descending order (newest first)
      (db.reactionEvent.findMany as jest.Mock).mockResolvedValue([
        { emoji: 'eyes', action: 'ADDED', createdAt: new Date('2026-01-03') },
        { emoji: 'white_check_mark', action: 'REMOVED', createdAt: new Date('2026-01-02') },
        { emoji: 'white_check_mark', action: 'ADDED', createdAt: new Date('2026-01-01') },
      ]);
      (db.statusReactionMapping.findMany as jest.Mock).mockResolvedValue([]);

      const status = await deriveStatusFromReactions('assign-1');

      expect(status).toBe('IN_REVIEW');
    });
  });
});
