/**
 * Tests for Slack App Home View Builder
 */

import { buildAppHomeView } from '../views/app-home';

// Mock dependencies
jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    assignment: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    userAchievement: {
      count: jest.fn(),
    },
    repository: {
      count: jest.fn(),
    },
  },
}));

jest.mock('@/lib/stats', () => ({
  getUserStatsSummary: jest.fn(),
}));

import { db } from '@/lib/db';
import { getUserStatsSummary } from '@/lib/stats';

const mockDb = db as jest.Mocked<typeof db>;
const mockGetUserStatsSummary = getUserStatsSummary as jest.Mock;

describe('App Home View Builder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildAppHomeView', () => {
    it('returns welcome message for unknown user', async () => {
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(null);

      const view = await buildAppHomeView('U12345');

      expect(view.type).toBe('home');
      expect(view.blocks).toHaveLength(2);
      expect(view.blocks[0].type).toBe('header');
      expect((view.blocks[0].text as { text: string }).text).toContain('Welcome');
    });

    it('builds complete view for existing user', async () => {
      const mockUser = {
        id: 'user-123',
        displayName: 'Test User',
        slackId: 'U12345',
        role: 'DEVELOPER',
        achievements: [
          {
            achievement: {
              icon: '🚀',
              displayName: 'Speed Demon',
            },
          },
        ],
      };

      const mockAssignments = [
        {
          id: 'assign-1',
          prTitle: 'Fix bug',
          prNumber: 42,
          prUrl: 'https://github.com/owner/repo/pull/42',
          complexity: 'MEDIUM',
          assignedAt: new Date(),
          repository: { name: 'repo' },
        },
      ];

      const mockStats = {
        week: {
          completed: 5,
          avgResponseTime: 30,
          points: 150,
          streak: 3,
        },
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
      (mockDb.userAchievement.count as jest.Mock).mockResolvedValue(1);
      mockGetUserStatsSummary.mockResolvedValue(mockStats);

      const view = await buildAppHomeView('U12345');

      expect(view.type).toBe('home');
      // Should have header, stats, assignments, achievements, quick actions, footer
      expect(view.blocks.length).toBeGreaterThan(5);

      // Check header includes user name
      const headerBlock = view.blocks.find(b => b.type === 'header');
      expect(headerBlock).toBeDefined();
      expect((headerBlock?.text as { text: string }).text).toContain('Test User');
    });

    it('includes admin section for ADMIN role', async () => {
      const mockUser = {
        id: 'user-123',
        displayName: 'Admin User',
        slackId: 'U12345',
        role: 'ADMIN',
        achievements: [],
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.userAchievement.count as jest.Mock).mockResolvedValue(0);
      (mockDb.repository.count as jest.Mock).mockResolvedValue(5);
      (mockDb.user.count as jest.Mock).mockResolvedValue(10);
      (mockDb.assignment.count as jest.Mock).mockResolvedValue(3);
      mockGetUserStatsSummary.mockResolvedValue(null);

      const view = await buildAppHomeView('U12345');

      // Should have admin header
      const adminHeader = view.blocks.find(
        b => b.type === 'header' && (b.text as { text: string }).text === 'Admin Dashboard'
      );
      expect(adminHeader).toBeDefined();
    });

    it('includes admin section for TEAM_LEAD role', async () => {
      const mockUser = {
        id: 'user-123',
        displayName: 'Team Lead',
        slackId: 'U12345',
        role: 'TEAM_LEAD',
        achievements: [],
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.userAchievement.count as jest.Mock).mockResolvedValue(0);
      (mockDb.repository.count as jest.Mock).mockResolvedValue(5);
      (mockDb.user.count as jest.Mock).mockResolvedValue(10);
      (mockDb.assignment.count as jest.Mock).mockResolvedValue(3);
      mockGetUserStatsSummary.mockResolvedValue(null);

      const view = await buildAppHomeView('U12345');

      const adminHeader = view.blocks.find(
        b => b.type === 'header' && (b.text as { text: string }).text === 'Admin Dashboard'
      );
      expect(adminHeader).toBeDefined();
    });

    it('excludes admin section for DEVELOPER role', async () => {
      const mockUser = {
        id: 'user-123',
        displayName: 'Developer',
        slackId: 'U12345',
        role: 'DEVELOPER',
        achievements: [],
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.userAchievement.count as jest.Mock).mockResolvedValue(0);
      mockGetUserStatsSummary.mockResolvedValue(null);

      const view = await buildAppHomeView('U12345');

      const adminHeader = view.blocks.find(
        b => b.type === 'header' && (b.text as { text: string }).text === 'Admin Dashboard'
      );
      expect(adminHeader).toBeUndefined();
    });

    it('shows "no pending reviews" message when no assignments', async () => {
      const mockUser = {
        id: 'user-123',
        displayName: 'Test User',
        slackId: 'U12345',
        role: 'DEVELOPER',
        achievements: [],
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.userAchievement.count as jest.Mock).mockResolvedValue(0);
      mockGetUserStatsSummary.mockResolvedValue(null);

      const view = await buildAppHomeView('U12345');

      // Find block with "No pending reviews" text
      const noPendingBlock = view.blocks.find(
        b => b.type === 'section' &&
          b.text &&
          typeof b.text === 'object' &&
          'text' in b.text &&
          (b.text as { text: string }).text?.includes('No pending reviews')
      );
      expect(noPendingBlock).toBeDefined();
    });

    it('shows pending assignments count correctly', async () => {
      const mockUser = {
        id: 'user-123',
        displayName: 'Test User',
        slackId: 'U12345',
        role: 'DEVELOPER',
        achievements: [],
      };

      const mockAssignments = [
        { id: '1', prTitle: 'PR 1', prNumber: 1, prUrl: 'url1', complexity: 'SMALL', assignedAt: new Date(), repository: { name: 'repo' } },
        { id: '2', prTitle: 'PR 2', prNumber: 2, prUrl: 'url2', complexity: 'MEDIUM', assignedAt: new Date(), repository: { name: 'repo' } },
        { id: '3', prTitle: 'PR 3', prNumber: 3, prUrl: 'url3', complexity: 'LARGE', assignedAt: new Date(), repository: { name: 'repo' } },
      ];

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (mockDb.assignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
      (mockDb.userAchievement.count as jest.Mock).mockResolvedValue(0);
      mockGetUserStatsSummary.mockResolvedValue(null);

      const view = await buildAppHomeView('U12345');

      // Stats section should show pending count of 3
      const statsSection = view.blocks.find(
        b => b.type === 'section' && b.fields
      );
      expect(statsSection).toBeDefined();

      const pendingField = (statsSection?.fields as Array<{ text: string }>)?.find(
        f => f.text.includes('Pending Reviews')
      );
      expect(pendingField?.text).toContain('3');
    });
  });
});
