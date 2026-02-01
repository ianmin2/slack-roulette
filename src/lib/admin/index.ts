/**
 * Admin Service
 *
 * Provides administrative functions for managing users, repositories,
 * and viewing dashboard analytics.
 */

import { db } from '@/lib/db';
import { UserRole, AvailabilityStatus } from '@/generated/prisma';
import type {
  AdminDashboardData,
  AdminOverview,
  AdminRepositoryData,
  AdminUserData,
  AdminActivityEntry,
  AdminUserUpdate,
  AdminRepositoryUpdate,
  AdminReviewerUpdate,
} from '@/types';

// =============================================================================
// DASHBOARD
// =============================================================================

/**
 * Get admin dashboard with all overview data
 */
export const getAdminDashboard = async (): Promise<AdminDashboardData> => {
  const [overview, repositories, users, recentActivity] = await Promise.all([
    getAdminOverview(),
    getAdminRepositories(),
    getAdminUsers(),
    getRecentActivity(20),
  ]);

  return {
    overview,
    repositories,
    users,
    recentActivity,
  };
};

/**
 * Get overview metrics
 */
const getAdminOverview = async (): Promise<AdminOverview> => {
  const [
    totalUsers,
    activeUsers,
    totalRepositories,
    activeRepositories,
    assignmentCounts,
  ] = await Promise.all([
    // Total users (non-deleted)
    db.user.count({
      where: { deletedAt: null },
    }),

    // Active users (have reviewed in last 30 days)
    db.user.count({
      where: {
        deletedAt: null,
        assignmentsAsReviewer: {
          some: {
            completedAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
      },
    }),

    // Total repositories (non-deleted)
    db.repository.count({
      where: { deletedAt: null },
    }),

    // Active repositories (have assignments in last 30 days)
    db.repository.count({
      where: {
        deletedAt: null,
        assignments: {
          some: {
            createdAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
      },
    }),

    // Assignment counts by status
    db.assignment.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
  ]);

  // Calculate totals from grouped counts
  let totalAssignments = 0;
  let pendingAssignments = 0;
  let completedAssignments = 0;

  for (const group of assignmentCounts) {
    totalAssignments += group._count.id;

    if (group.status === 'PENDING' || group.status === 'ASSIGNED' || group.status === 'IN_REVIEW') {
      pendingAssignments += group._count.id;
    }

    if (group.status === 'COMPLETED' || group.status === 'APPROVED') {
      completedAssignments += group._count.id;
    }
  }

  const avgCompletionRate = totalAssignments > 0
    ? completedAssignments / totalAssignments
    : 0;

  return {
    totalUsers,
    activeUsers,
    totalRepositories,
    activeRepositories,
    totalAssignments,
    pendingAssignments,
    completedAssignments,
    avgCompletionRate,
  };
};

// =============================================================================
// USERS
// =============================================================================

/**
 * Get all users with their statistics
 */
export const getAdminUsers = async (): Promise<AdminUserData[]> => {
  const users = await db.user.findMany({
    where: { deletedAt: null },
    include: {
      repositoryReviewers: {
        where: { isActive: true },
      },
      assignmentsAsReviewer: {
        select: {
          id: true,
          status: true,
        },
      },
      achievements: true,
      statistics: {
        where: { repositoryId: null }, // Global stats only
        select: { points: true },
      },
    },
    orderBy: { displayName: 'asc' },
  });

  return users.map((user) => {
    const pendingReviews = user.assignmentsAsReviewer.filter(
      (a) => a.status === 'PENDING' || a.status === 'ASSIGNED' || a.status === 'IN_REVIEW'
    ).length;

    const completedReviews = user.assignmentsAsReviewer.filter(
      (a) => a.status === 'COMPLETED' || a.status === 'APPROVED'
    ).length;

    const totalPoints = user.statistics.reduce((sum, s) => sum + s.points, 0);

    return {
      id: user.id,
      slackId: user.slackId,
      displayName: user.displayName,
      githubUsername: user.githubUsername,
      email: user.email,
      role: user.role,
      availabilityStatus: user.availabilityStatus,
      repositoryCount: user.repositoryReviewers.length,
      pendingReviews,
      completedReviews,
      totalPoints,
      achievementCount: user.achievements.length,
      createdAt: user.createdAt,
    };
  });
};

/**
 * Update a user's admin-editable fields
 */
export const updateUser = async (
  userId: string,
  data: AdminUserUpdate
): Promise<void> => {
  // Verify user exists
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // Build update data - only include defined fields
  const updateData: {
    displayName?: string;
    role?: UserRole;
    availabilityStatus?: AvailabilityStatus;
    githubUsername?: string | null;
  } = {};

  if (data.displayName !== undefined) {
    updateData.displayName = data.displayName;
  }

  if (data.role !== undefined) {
    // Validate role enum
    const validRoles: UserRole[] = [
      UserRole.ADMIN,
      UserRole.TEAM_LEAD,
      UserRole.DEVELOPER,
      UserRole.VIEWER,
    ];
    const roleEnum = data.role as UserRole;
    if (!validRoles.includes(roleEnum)) {
      throw new Error(`Invalid role: ${data.role}`);
    }
    updateData.role = roleEnum;
  }

  if (data.availabilityStatus !== undefined) {
    // Validate availability enum
    const validStatuses: AvailabilityStatus[] = [
      AvailabilityStatus.AVAILABLE,
      AvailabilityStatus.BUSY,
      AvailabilityStatus.VACATION,
      AvailabilityStatus.UNAVAILABLE,
    ];
    const statusEnum = data.availabilityStatus as AvailabilityStatus;
    if (!validStatuses.includes(statusEnum)) {
      throw new Error(`Invalid availability status: ${data.availabilityStatus}`);
    }
    updateData.availabilityStatus = statusEnum;
  }

  if (data.githubUsername !== undefined) {
    updateData.githubUsername = data.githubUsername || null;
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error('No valid fields to update');
  }

  await db.user.update({
    where: { id: userId },
    data: updateData,
  });

  // Log the change
  await db.auditLog.create({
    data: {
      action: 'update',
      entityType: 'user',
      entityId: userId,
      changes: {
        before: {
          displayName: user.displayName,
          role: user.role,
          availabilityStatus: user.availabilityStatus,
          githubUsername: user.githubUsername,
        },
        after: { ...updateData },
      },
    },
  });
};

// =============================================================================
// REPOSITORIES
// =============================================================================

/**
 * Get all repositories with their statistics
 */
export const getAdminRepositories = async (): Promise<AdminRepositoryData[]> => {
  const repositories = await db.repository.findMany({
    where: { deletedAt: null },
    include: {
      reviewers: {
        where: { isActive: true },
      },
      assignments: {
        select: {
          id: true,
          status: true,
          assignedAt: true,
          completedAt: true,
        },
      },
    },
    orderBy: { fullName: 'asc' },
  });

  return repositories.map((repo) => {
    const pendingReviews = repo.assignments.filter(
      (a) => a.status === 'PENDING' || a.status === 'ASSIGNED' || a.status === 'IN_REVIEW'
    ).length;

    const completedReviews = repo.assignments.filter(
      (a) => a.status === 'COMPLETED' || a.status === 'APPROVED'
    ).length;

    // Calculate average response time
    const completedWithTimes = repo.assignments.filter(
      (a) => (a.status === 'COMPLETED' || a.status === 'APPROVED') &&
        a.assignedAt !== null &&
        a.completedAt !== null
    );

    let avgResponseTimeMinutes: number | null = null;
    if (completedWithTimes.length > 0) {
      const totalMinutes = completedWithTimes.reduce((sum, a) => {
        const diffMs = a.completedAt!.getTime() - a.assignedAt!.getTime();
        return sum + Math.round(diffMs / 60000);
      }, 0);
      avgResponseTimeMinutes = Math.round(totalMinutes / completedWithTimes.length);
    }

    return {
      id: repo.id,
      fullName: repo.fullName,
      isActive: repo.autoAssignment,
      reviewerCount: repo.reviewers.length,
      pendingReviews,
      completedReviews,
      avgResponseTimeMinutes,
      requireSeniorComplex: repo.requireSeniorComplex,
      createdAt: repo.createdAt,
    };
  });
};

/**
 * Update a repository's admin-editable fields
 */
export const updateRepository = async (
  repoId: string,
  data: AdminRepositoryUpdate
): Promise<void> => {
  // Verify repository exists
  const repo = await db.repository.findUnique({
    where: { id: repoId },
  });

  if (!repo) {
    throw new Error(`Repository not found: ${repoId}`);
  }

  // Build update data
  const updateData: {
    autoAssignment?: boolean;
    requireSeniorComplex?: boolean;
    complexityMultiplier?: number;
    maxReviewers?: number;
  } = {};

  if (data.isActive !== undefined) {
    updateData.autoAssignment = data.isActive;
  }

  if (data.requireSeniorComplex !== undefined) {
    updateData.requireSeniorComplex = data.requireSeniorComplex;
  }

  if (data.defaultReviewerWeight !== undefined) {
    if (data.defaultReviewerWeight < 0.5 || data.defaultReviewerWeight > 2.0) {
      throw new Error('Default reviewer weight must be between 0.5 and 2.0');
    }
    updateData.complexityMultiplier = data.defaultReviewerWeight;
  }

  if (data.maxConcurrentDefault !== undefined) {
    if (data.maxConcurrentDefault < 1 || data.maxConcurrentDefault > 20) {
      throw new Error('Max concurrent default must be between 1 and 20');
    }
    updateData.maxReviewers = data.maxConcurrentDefault;
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error('No valid fields to update');
  }

  await db.repository.update({
    where: { id: repoId },
    data: updateData,
  });

  // Log the change
  await db.auditLog.create({
    data: {
      action: 'update',
      entityType: 'repository',
      entityId: repoId,
      changes: {
        before: {
          autoAssignment: repo.autoAssignment,
          requireSeniorComplex: repo.requireSeniorComplex,
          complexityMultiplier: repo.complexityMultiplier,
          maxReviewers: repo.maxReviewers,
        },
        after: { ...updateData },
      },
    },
  });
};

// =============================================================================
// REVIEWERS
// =============================================================================

/**
 * Update reviewer settings for a user on a specific repository
 */
export const updateReviewer = async (
  userId: string,
  repoId: string,
  data: AdminReviewerUpdate
): Promise<void> => {
  // Verify the reviewer relationship exists
  const reviewer = await db.repositoryReviewer.findUnique({
    where: {
      userId_repositoryId: {
        userId,
        repositoryId: repoId,
      },
    },
    include: {
      user: true,
      repository: true,
    },
  });

  if (!reviewer) {
    throw new Error(`Reviewer relationship not found for user ${userId} and repository ${repoId}`);
  }

  // Build update data
  const updateData: {
    weight?: number;
    maxConcurrent?: number;
    isActive?: boolean;
  } = {};

  if (data.weight !== undefined) {
    if (data.weight < 0.5 || data.weight > 2.0) {
      throw new Error('Weight must be between 0.5 and 2.0');
    }
    updateData.weight = data.weight;
  }

  if (data.maxConcurrent !== undefined) {
    if (data.maxConcurrent < 1 || data.maxConcurrent > 20) {
      throw new Error('Max concurrent must be between 1 and 20');
    }
    updateData.maxConcurrent = data.maxConcurrent;
  }

  if (data.isActive !== undefined) {
    updateData.isActive = data.isActive;
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error('No valid fields to update');
  }

  await db.repositoryReviewer.update({
    where: { id: reviewer.id },
    data: updateData,
  });

  // Log the change
  await db.auditLog.create({
    data: {
      action: 'update',
      entityType: 'repository_reviewer',
      entityId: reviewer.id,
      userId,
      changes: {
        before: {
          weight: reviewer.weight,
          maxConcurrent: reviewer.maxConcurrent,
          isActive: reviewer.isActive,
        },
        after: { ...updateData },
        context: {
          userName: reviewer.user.displayName,
          repoName: reviewer.repository.fullName,
        },
      },
    },
  });
};

// =============================================================================
// ACTIVITY
// =============================================================================

/**
 * Get recent activity for the admin dashboard
 */
const getRecentActivity = async (limit: number): Promise<AdminActivityEntry[]> => {
  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Batch fetch users and repositories for activity entries
  const userIds = new Set<string>();
  const repoIds = new Set<string>();

  for (const log of logs) {
    if (log.userId) userIds.add(log.userId);
    if (log.entityType === 'assignment' || log.entityType === 'repository') {
      repoIds.add(log.entityId);
    }
  }

  const [users, repos] = await Promise.all([
    userIds.size > 0
      ? db.user.findMany({
          where: { id: { in: Array.from(userIds) } },
          select: { id: true, displayName: true },
        })
      : [],
    repoIds.size > 0
      ? db.repository.findMany({
          where: { id: { in: Array.from(repoIds) } },
          select: { id: true, fullName: true },
        })
      : [],
  ]);

  const userMap = new Map(users.map((u) => [u.id, u.displayName]));
  const repoMap = new Map(repos.map((r) => [r.id, r.fullName]));

  return logs.map((log) => {
    const activityType = mapAuditActionToActivityType(log.action, log.entityType);
    const description = generateActivityDescription(log, userMap, repoMap);

    return {
      id: log.id,
      type: activityType,
      description,
      userId: log.userId,
      userDisplayName: log.userId ? userMap.get(log.userId) ?? null : null,
      repositoryId: log.entityType === 'repository' || log.entityType === 'assignment'
        ? log.entityId
        : null,
      repositoryName: log.entityType === 'repository'
        ? repoMap.get(log.entityId) ?? null
        : null,
      timestamp: log.createdAt,
      metadata: (log.changes as Record<string, unknown>) ?? {},
    };
  });
};

/**
 * Map audit log action to admin activity type
 */
const mapAuditActionToActivityType = (
  action: string,
  entityType: string
): AdminActivityEntry['type'] => {
  if (entityType === 'assignment') {
    if (action === 'create') return 'assignment_created';
    if (action === 'update') return 'assignment_completed';
  }

  if (entityType === 'user') {
    if (action === 'create') return 'user_added';
    if (action === 'update') return 'user_updated';
  }

  if (entityType === 'repository') {
    if (action === 'create') return 'repository_added';
    if (action === 'update') return 'repository_updated';
  }

  if (entityType === 'user_achievement') {
    return 'achievement_unlocked';
  }

  return 'config_changed';
};

/**
 * Generate human-readable description for activity
 */
const generateActivityDescription = (
  log: { action: string; entityType: string; entityId: string; userId: string | null; changes: unknown },
  userMap: Map<string, string>,
  repoMap: Map<string, string>
): string => {
  const userName = log.userId ? userMap.get(log.userId) ?? 'Unknown user' : 'System';

  switch (log.entityType) {
    case 'assignment':
      if (log.action === 'create') {
        return `New PR assignment created`;
      }
      return `Assignment updated`;

    case 'user':
      if (log.action === 'create') {
        return `${userName} was added`;
      }
      return `${userName}'s profile was updated`;

    case 'repository': {
      const repoName = repoMap.get(log.entityId) ?? 'Unknown repository';
      if (log.action === 'create') {
        return `Repository ${repoName} was added`;
      }
      return `Repository ${repoName} settings were updated`;
    }

    case 'repository_reviewer':
      return `Reviewer settings updated`;

    case 'user_achievement':
      return `Achievement unlocked by ${userName}`;

    default:
      return `${log.action} on ${log.entityType}`;
  }
};
