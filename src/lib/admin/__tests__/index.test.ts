/**
 * Tests for Admin Service
 */

import { UserRole, AvailabilityStatus } from '@/generated/prisma';

// Mock dependencies
jest.mock('@/lib/db', () => ({
  db: {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    repository: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    assignment: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    repositoryReviewer: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import {
  getAdminDashboard,
  getAdminUsers,
  getAdminRepositories,
  updateUser,
  updateRepository,
  updateReviewer,
} from '../index';

const mockDb = db as jest.Mocked<typeof db>;

describe('Admin Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAdminDashboard', () => {
    it('returns complete dashboard data', async () => {
      // Mock overview data
      (mockDb.user.count as jest.Mock)
        .mockResolvedValueOnce(10) // total users
        .mockResolvedValueOnce(5); // active users
      (mockDb.repository.count as jest.Mock)
        .mockResolvedValueOnce(3) // total repos
        .mockResolvedValueOnce(2); // active repos
      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([
        { status: 'COMPLETED', _count: { id: 50 } },
        { status: 'PENDING', _count: { id: 10 } },
        { status: 'APPROVED', _count: { id: 20 } },
      ]);

      // Mock users data
      (mockDb.user.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'user-1',
          slackId: 'U123',
          displayName: 'Test User',
          role: 'DEVELOPER',
          availabilityStatus: 'AVAILABLE',
          createdAt: new Date(),
          repositoryReviewers: [],
          assignmentsAsReviewer: [],
          achievements: [],
          statistics: [],
        },
      ]);

      // Mock repositories data
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'repo-1',
          fullName: 'org/repo',
          autoAssignment: true,
          requireSeniorComplex: false,
          createdAt: new Date(),
          reviewers: [],
          assignments: [],
        },
      ]);

      // Mock recent activity
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getAdminDashboard();

      expect(result).toHaveProperty('overview');
      expect(result).toHaveProperty('repositories');
      expect(result).toHaveProperty('users');
      expect(result).toHaveProperty('recentActivity');
      expect(result.overview.totalUsers).toBe(10);
      expect(result.overview.activeUsers).toBe(5);
      expect(result.overview.totalAssignments).toBe(80);
      expect(result.overview.completedAssignments).toBe(70);
    });
  });

  describe('getAdminUsers', () => {
    it('returns users with statistics', async () => {
      const mockUser = {
        id: 'user-1',
        slackId: 'U123',
        displayName: 'Test User',
        githubUsername: 'testuser',
        email: 'test@example.com',
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        createdAt: new Date(),
        repositoryReviewers: [{ id: 'rr-1' }],
        assignmentsAsReviewer: [
          { id: 'a-1', status: 'COMPLETED' },
          { id: 'a-2', status: 'PENDING' },
        ],
        achievements: [{ id: 'ach-1' }],
        statistics: [{ points: 100 }, { points: 50 }],
      };

      (mockDb.user.findMany as jest.Mock).mockResolvedValue([mockUser]);

      const users = await getAdminUsers();

      expect(users).toHaveLength(1);
      expect(users[0].displayName).toBe('Test User');
      expect(users[0].repositoryCount).toBe(1);
      expect(users[0].completedReviews).toBe(1);
      expect(users[0].pendingReviews).toBe(1);
      expect(users[0].totalPoints).toBe(150);
      expect(users[0].achievementCount).toBe(1);
    });
  });

  describe('getAdminRepositories', () => {
    it('returns repositories with statistics', async () => {
      const mockRepo = {
        id: 'repo-1',
        fullName: 'org/repo',
        autoAssignment: true,
        requireSeniorComplex: false,
        createdAt: new Date(),
        reviewers: [{ id: 'rr-1' }, { id: 'rr-2' }],
        assignments: [
          { id: 'a-1', status: 'COMPLETED', assignedAt: new Date(Date.now() - 3600000), completedAt: new Date() },
          { id: 'a-2', status: 'PENDING', assignedAt: null, completedAt: null },
        ],
      };

      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([mockRepo]);

      const repos = await getAdminRepositories();

      expect(repos).toHaveLength(1);
      expect(repos[0].fullName).toBe('org/repo');
      expect(repos[0].reviewerCount).toBe(2);
      expect(repos[0].completedReviews).toBe(1);
      expect(repos[0].pendingReviews).toBe(1);
      expect(repos[0].avgResponseTimeMinutes).toBe(60);
    });
  });

  describe('updateUser', () => {
    it('updates user display name', async () => {
      const existingUser = {
        id: 'user-1',
        displayName: 'Old Name',
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        githubUsername: null,
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(existingUser);
      (mockDb.user.update as jest.Mock).mockResolvedValue({ ...existingUser, displayName: 'New Name' });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateUser('user-1', { displayName: 'New Name' });

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { displayName: 'New Name' },
      });
      expect(mockDb.auditLog.create).toHaveBeenCalled();
    });

    it('updates user role', async () => {
      const existingUser = {
        id: 'user-1',
        displayName: 'Test User',
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        githubUsername: null,
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(existingUser);
      (mockDb.user.update as jest.Mock).mockResolvedValue({ ...existingUser, role: 'TEAM_LEAD' });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateUser('user-1', { role: UserRole.TEAM_LEAD });

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: UserRole.TEAM_LEAD },
      });
    });

    it('throws error for non-existent user', async () => {
      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(updateUser('non-existent', { displayName: 'New Name' }))
        .rejects.toThrow('User not found: non-existent');
    });

    it('throws error for invalid role', async () => {
      const existingUser = {
        id: 'user-1',
        displayName: 'Test User',
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        githubUsername: null,
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

      await expect(updateUser('user-1', { role: 'INVALID_ROLE' as UserRole }))
        .rejects.toThrow('Invalid role: INVALID_ROLE');
    });

    it('throws error when no valid fields to update', async () => {
      const existingUser = {
        id: 'user-1',
        displayName: 'Test User',
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        githubUsername: null,
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

      await expect(updateUser('user-1', {}))
        .rejects.toThrow('No valid fields to update');
    });
  });

  describe('updateRepository', () => {
    it('updates repository settings', async () => {
      const existingRepo = {
        id: 'repo-1',
        autoAssignment: true,
        requireSeniorComplex: false,
        complexityMultiplier: 1.0,
        maxReviewers: 5,
      };

      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue(existingRepo);
      (mockDb.repository.update as jest.Mock).mockResolvedValue({
        ...existingRepo,
        autoAssignment: false,
        requireSeniorComplex: true,
      });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateRepository('repo-1', { isActive: false, requireSeniorComplex: true });

      expect(mockDb.repository.update).toHaveBeenCalledWith({
        where: { id: 'repo-1' },
        data: { autoAssignment: false, requireSeniorComplex: true },
      });
    });

    it('throws error for non-existent repository', async () => {
      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(updateRepository('non-existent', { isActive: false }))
        .rejects.toThrow('Repository not found: non-existent');
    });

    it('throws error for invalid weight', async () => {
      const existingRepo = {
        id: 'repo-1',
        autoAssignment: true,
        requireSeniorComplex: false,
        complexityMultiplier: 1.0,
        maxReviewers: 5,
      };

      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue(existingRepo);

      await expect(updateRepository('repo-1', { defaultReviewerWeight: 3.0 }))
        .rejects.toThrow('Default reviewer weight must be between 0.5 and 2.0');
    });

    it('throws error for invalid max concurrent', async () => {
      const existingRepo = {
        id: 'repo-1',
        autoAssignment: true,
        requireSeniorComplex: false,
        complexityMultiplier: 1.0,
        maxReviewers: 5,
      };

      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue(existingRepo);

      await expect(updateRepository('repo-1', { maxConcurrentDefault: 50 }))
        .rejects.toThrow('Max concurrent default must be between 1 and 20');
    });
  });

  describe('updateReviewer', () => {
    it('updates reviewer settings', async () => {
      const existingReviewer = {
        id: 'rr-1',
        userId: 'user-1',
        repositoryId: 'repo-1',
        weight: 1.0,
        maxConcurrent: 5,
        isActive: true,
        user: { displayName: 'Test User' },
        repository: { fullName: 'org/repo' },
      };

      (mockDb.repositoryReviewer.findUnique as jest.Mock).mockResolvedValue(existingReviewer);
      (mockDb.repositoryReviewer.update as jest.Mock).mockResolvedValue({
        ...existingReviewer,
        weight: 1.5,
        maxConcurrent: 3,
      });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateReviewer('user-1', 'repo-1', { weight: 1.5, maxConcurrent: 3 });

      expect(mockDb.repositoryReviewer.update).toHaveBeenCalledWith({
        where: { id: 'rr-1' },
        data: { weight: 1.5, maxConcurrent: 3 },
      });
    });

    it('throws error for non-existent reviewer relationship', async () => {
      (mockDb.repositoryReviewer.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(updateReviewer('user-1', 'repo-1', { weight: 1.5 }))
        .rejects.toThrow('Reviewer relationship not found for user user-1 and repository repo-1');
    });

    it('throws error for invalid weight', async () => {
      const existingReviewer = {
        id: 'rr-1',
        userId: 'user-1',
        repositoryId: 'repo-1',
        weight: 1.0,
        maxConcurrent: 5,
        isActive: true,
        user: { displayName: 'Test User' },
        repository: { fullName: 'org/repo' },
      };

      (mockDb.repositoryReviewer.findUnique as jest.Mock).mockResolvedValue(existingReviewer);

      await expect(updateReviewer('user-1', 'repo-1', { weight: 0.2 }))
        .rejects.toThrow('Weight must be between 0.5 and 2.0');
    });

    it('throws error for invalid max concurrent', async () => {
      const existingReviewer = {
        id: 'rr-1',
        userId: 'user-1',
        repositoryId: 'repo-1',
        weight: 1.0,
        maxConcurrent: 5,
        isActive: true,
        user: { displayName: 'Test User' },
        repository: { fullName: 'org/repo' },
      };

      (mockDb.repositoryReviewer.findUnique as jest.Mock).mockResolvedValue(existingReviewer);

      await expect(updateReviewer('user-1', 'repo-1', { maxConcurrent: 0 }))
        .rejects.toThrow('Max concurrent must be between 1 and 20');
    });

    it('throws error for no valid fields to update', async () => {
      const existingReviewer = {
        id: 'rr-1',
        userId: 'user-1',
        repositoryId: 'repo-1',
        weight: 1.0,
        maxConcurrent: 5,
        isActive: true,
        user: { displayName: 'Test User' },
        repository: { fullName: 'org/repo' },
      };

      (mockDb.repositoryReviewer.findUnique as jest.Mock).mockResolvedValue(existingReviewer);

      await expect(updateReviewer('user-1', 'repo-1', {}))
        .rejects.toThrow('No valid fields to update');
    });

    it('updates reviewer isActive status', async () => {
      const existingReviewer = {
        id: 'rr-1',
        userId: 'user-1',
        repositoryId: 'repo-1',
        weight: 1.0,
        maxConcurrent: 5,
        isActive: true,
        user: { displayName: 'Test User' },
        repository: { fullName: 'org/repo' },
      };

      (mockDb.repositoryReviewer.findUnique as jest.Mock).mockResolvedValue(existingReviewer);
      (mockDb.repositoryReviewer.update as jest.Mock).mockResolvedValue({ ...existingReviewer, isActive: false });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateReviewer('user-1', 'repo-1', { isActive: false });

      expect(mockDb.repositoryReviewer.update).toHaveBeenCalledWith({
        where: { id: 'rr-1' },
        data: { isActive: false },
      });
    });
  });

  describe('updateUser - additional branches', () => {
    it('updates user availability status', async () => {
      const existingUser = {
        id: 'user-1',
        displayName: 'Test User',
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        githubUsername: null,
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(existingUser);
      (mockDb.user.update as jest.Mock).mockResolvedValue({ ...existingUser, availabilityStatus: 'VACATION' });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateUser('user-1', { availabilityStatus: AvailabilityStatus.VACATION });

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { availabilityStatus: AvailabilityStatus.VACATION },
      });
    });

    it('throws error for invalid availability status', async () => {
      const existingUser = {
        id: 'user-1',
        displayName: 'Test User',
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        githubUsername: null,
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

      await expect(updateUser('user-1', { availabilityStatus: 'INVALID' as AvailabilityStatus }))
        .rejects.toThrow('Invalid availability status: INVALID');
    });

    it('updates github username', async () => {
      const existingUser = {
        id: 'user-1',
        displayName: 'Test User',
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        githubUsername: null,
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(existingUser);
      (mockDb.user.update as jest.Mock).mockResolvedValue({ ...existingUser, githubUsername: 'newuser' });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateUser('user-1', { githubUsername: 'newuser' });

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { githubUsername: 'newuser' },
      });
    });

    it('clears github username when empty string', async () => {
      const existingUser = {
        id: 'user-1',
        displayName: 'Test User',
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        githubUsername: 'olduser',
      };

      (mockDb.user.findUnique as jest.Mock).mockResolvedValue(existingUser);
      (mockDb.user.update as jest.Mock).mockResolvedValue({ ...existingUser, githubUsername: null });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateUser('user-1', { githubUsername: '' });

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { githubUsername: null },
      });
    });
  });

  describe('updateRepository - additional branches', () => {
    it('updates valid weight', async () => {
      const existingRepo = {
        id: 'repo-1',
        autoAssignment: true,
        requireSeniorComplex: false,
        complexityMultiplier: 1.0,
        maxReviewers: 5,
      };

      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue(existingRepo);
      (mockDb.repository.update as jest.Mock).mockResolvedValue({ ...existingRepo, complexityMultiplier: 1.5 });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateRepository('repo-1', { defaultReviewerWeight: 1.5 });

      expect(mockDb.repository.update).toHaveBeenCalledWith({
        where: { id: 'repo-1' },
        data: { complexityMultiplier: 1.5 },
      });
    });

    it('updates valid max concurrent', async () => {
      const existingRepo = {
        id: 'repo-1',
        autoAssignment: true,
        requireSeniorComplex: false,
        complexityMultiplier: 1.0,
        maxReviewers: 5,
      };

      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue(existingRepo);
      (mockDb.repository.update as jest.Mock).mockResolvedValue({ ...existingRepo, maxReviewers: 10 });
      (mockDb.auditLog.create as jest.Mock).mockResolvedValue({});

      await updateRepository('repo-1', { maxConcurrentDefault: 10 });

      expect(mockDb.repository.update).toHaveBeenCalledWith({
        where: { id: 'repo-1' },
        data: { maxReviewers: 10 },
      });
    });

    it('throws error for no valid fields to update', async () => {
      const existingRepo = {
        id: 'repo-1',
        autoAssignment: true,
        requireSeniorComplex: false,
        complexityMultiplier: 1.0,
        maxReviewers: 5,
      };

      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue(existingRepo);

      await expect(updateRepository('repo-1', {}))
        .rejects.toThrow('No valid fields to update');
    });

    it('throws error for weight below minimum', async () => {
      const existingRepo = {
        id: 'repo-1',
        autoAssignment: true,
        requireSeniorComplex: false,
        complexityMultiplier: 1.0,
        maxReviewers: 5,
      };

      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue(existingRepo);

      await expect(updateRepository('repo-1', { defaultReviewerWeight: 0.3 }))
        .rejects.toThrow('Default reviewer weight must be between 0.5 and 2.0');
    });

    it('throws error for max concurrent below minimum', async () => {
      const existingRepo = {
        id: 'repo-1',
        autoAssignment: true,
        requireSeniorComplex: false,
        complexityMultiplier: 1.0,
        maxReviewers: 5,
      };

      (mockDb.repository.findUnique as jest.Mock).mockResolvedValue(existingRepo);

      await expect(updateRepository('repo-1', { maxConcurrentDefault: 0 }))
        .rejects.toThrow('Max concurrent default must be between 1 and 20');
    });
  });

  describe('getAdminDashboard - edge cases', () => {
    it('handles ASSIGNED and IN_REVIEW statuses', async () => {
      (mockDb.user.count as jest.Mock).mockResolvedValue(5);
      (mockDb.repository.count as jest.Mock).mockResolvedValue(2);
      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([
        { status: 'ASSIGNED', _count: { id: 5 } },
        { status: 'IN_REVIEW', _count: { id: 3 } },
        { status: 'COMPLETED', _count: { id: 10 } },
      ]);
      (mockDb.user.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getAdminDashboard();

      // ASSIGNED and IN_REVIEW should be counted as pending
      expect(result.overview.pendingAssignments).toBe(8);
      expect(result.overview.completedAssignments).toBe(10);
    });

    it('handles zero assignments', async () => {
      (mockDb.user.count as jest.Mock).mockResolvedValue(5);
      (mockDb.repository.count as jest.Mock).mockResolvedValue(2);
      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([]);
      (mockDb.user.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getAdminDashboard();

      expect(result.overview.totalAssignments).toBe(0);
      expect(result.overview.avgCompletionRate).toBe(0);
    });
  });

  describe('getAdminUsers - edge cases', () => {
    it('handles users with APPROVED status reviews', async () => {
      const mockUser = {
        id: 'user-1',
        slackId: 'U123',
        displayName: 'Test User',
        githubUsername: null,
        email: null,
        role: 'DEVELOPER',
        availabilityStatus: 'AVAILABLE',
        createdAt: new Date(),
        repositoryReviewers: [],
        assignmentsAsReviewer: [
          { id: 'a-1', status: 'APPROVED' },
          { id: 'a-2', status: 'IN_REVIEW' },
          { id: 'a-3', status: 'ASSIGNED' },
        ],
        achievements: [],
        statistics: [],
      };

      (mockDb.user.findMany as jest.Mock).mockResolvedValue([mockUser]);

      const users = await getAdminUsers();

      // APPROVED counted as completed, IN_REVIEW and ASSIGNED as pending
      expect(users[0].completedReviews).toBe(1);
      expect(users[0].pendingReviews).toBe(2);
    });
  });

  describe('getAdminRepositories - edge cases', () => {
    it('handles repository with no completed assignments', async () => {
      const mockRepo = {
        id: 'repo-1',
        fullName: 'org/repo',
        autoAssignment: true,
        requireSeniorComplex: false,
        createdAt: new Date(),
        reviewers: [],
        assignments: [
          { id: 'a-1', status: 'PENDING', assignedAt: null, completedAt: null },
        ],
      };

      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([mockRepo]);

      const repos = await getAdminRepositories();

      expect(repos[0].avgResponseTimeMinutes).toBeNull();
    });

    it('handles repository with APPROVED status', async () => {
      const mockRepo = {
        id: 'repo-1',
        fullName: 'org/repo',
        autoAssignment: true,
        requireSeniorComplex: false,
        createdAt: new Date(),
        reviewers: [],
        assignments: [
          { id: 'a-1', status: 'APPROVED', assignedAt: new Date(Date.now() - 1800000), completedAt: new Date() },
          { id: 'a-2', status: 'IN_REVIEW', assignedAt: null, completedAt: null },
          { id: 'a-3', status: 'ASSIGNED', assignedAt: null, completedAt: null },
        ],
      };

      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([mockRepo]);

      const repos = await getAdminRepositories();

      expect(repos[0].completedReviews).toBe(1);
      expect(repos[0].pendingReviews).toBe(2);
      expect(repos[0].avgResponseTimeMinutes).toBe(30);
    });
  });

  describe('getRecentActivity - activity types', () => {
    beforeEach(() => {
      // Minimal mocks for dashboard
      (mockDb.user.count as jest.Mock).mockResolvedValue(0);
      (mockDb.repository.count as jest.Mock).mockResolvedValue(0);
      (mockDb.assignment.groupBy as jest.Mock).mockResolvedValue([]);
      (mockDb.user.findMany as jest.Mock).mockResolvedValue([]);
      (mockDb.repository.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('handles assignment create activity', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'create',
          entityType: 'assignment',
          entityId: 'assign-1',
          userId: 'user-1',
          changes: {},
          createdAt: new Date(),
        },
      ]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].type).toBe('assignment_created');
      expect(result.recentActivity[0].description).toBe('New PR assignment created');
    });

    it('handles assignment update activity', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'update',
          entityType: 'assignment',
          entityId: 'assign-1',
          userId: null,
          changes: {},
          createdAt: new Date(),
        },
      ]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].type).toBe('assignment_completed');
      expect(result.recentActivity[0].description).toBe('Assignment updated');
    });

    it('handles user create activity', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'create',
          entityType: 'user',
          entityId: 'user-1',
          userId: 'user-1',
          changes: {},
          createdAt: new Date(),
        },
      ]);

      (mockDb.user.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // getAdminUsers
        .mockResolvedValueOnce([{ id: 'user-1', displayName: 'Test User' }]); // getRecentActivity

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].type).toBe('user_added');
      expect(result.recentActivity[0].description).toBe('Test User was added');
    });

    it('handles user update activity', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'update',
          entityType: 'user',
          entityId: 'user-1',
          userId: 'user-1',
          changes: { role: 'SENIOR' },
          createdAt: new Date(),
        },
      ]);

      (mockDb.user.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'user-1', displayName: 'Test User' }]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].type).toBe('user_updated');
      expect(result.recentActivity[0].description).toBe("Test User's profile was updated");
    });

    it('handles repository create activity', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'create',
          entityType: 'repository',
          entityId: 'repo-1',
          userId: null,
          changes: {},
          createdAt: new Date(),
        },
      ]);

      (mockDb.repository.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'repo-1', fullName: 'org/my-repo' }]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].type).toBe('repository_added');
      expect(result.recentActivity[0].description).toBe('Repository org/my-repo was added');
    });

    it('handles repository update activity', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'update',
          entityType: 'repository',
          entityId: 'repo-1',
          userId: null,
          changes: { autoAssignment: false },
          createdAt: new Date(),
        },
      ]);

      (mockDb.repository.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'repo-1', fullName: 'org/my-repo' }]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].type).toBe('repository_updated');
      expect(result.recentActivity[0].description).toBe('Repository org/my-repo settings were updated');
    });

    it('handles repository_reviewer update activity', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'update',
          entityType: 'repository_reviewer',
          entityId: 'rr-1',
          userId: null,
          changes: {},
          createdAt: new Date(),
        },
      ]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].type).toBe('config_changed');
      expect(result.recentActivity[0].description).toBe('Reviewer settings updated');
    });

    it('handles user_achievement activity', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'create',
          entityType: 'user_achievement',
          entityId: 'ua-1',
          userId: 'user-1',
          changes: {},
          createdAt: new Date(),
        },
      ]);

      (mockDb.user.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'user-1', displayName: 'Winner' }]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].type).toBe('achievement_unlocked');
      expect(result.recentActivity[0].description).toBe('Achievement unlocked by Winner');
    });

    it('handles unknown entity type activity', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'some_action',
          entityType: 'unknown_type',
          entityId: 'x-1',
          userId: null,
          changes: {},
          createdAt: new Date(),
        },
      ]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].type).toBe('config_changed');
      expect(result.recentActivity[0].description).toBe('some_action on unknown_type');
    });

    it('handles missing user name gracefully', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'create',
          entityType: 'user',
          entityId: 'user-1',
          userId: 'user-1',
          changes: {},
          createdAt: new Date(),
        },
      ]);

      // No users found
      (mockDb.user.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].description).toBe('Unknown user was added');
    });

    it('handles missing repository name gracefully', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'create',
          entityType: 'repository',
          entityId: 'repo-1',
          userId: null,
          changes: {},
          createdAt: new Date(),
        },
      ]);

      // No repos found
      (mockDb.repository.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].description).toBe('Repository Unknown repository was added');
    });

    it('handles activity with no userId (System action)', async () => {
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'update',
          entityType: 'user',
          entityId: 'user-1',
          userId: null, // System action
          changes: {},
          createdAt: new Date(),
        },
      ]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].description).toBe("System's profile was updated");
      expect(result.recentActivity[0].userDisplayName).toBeNull();
    });

    it('includes metadata from changes', async () => {
      const changes = { previousValue: 'old', newValue: 'new' };
      (mockDb.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          action: 'update',
          entityType: 'config',
          entityId: 'cfg-1',
          userId: null,
          changes,
          createdAt: new Date(),
        },
      ]);

      const result = await getAdminDashboard();

      expect(result.recentActivity[0].metadata).toEqual(changes);
    });
  });
});
