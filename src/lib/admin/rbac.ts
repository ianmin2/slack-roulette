/**
 * Role-Based Access Control (RBAC)
 *
 * Defines roles, permissions, and access control for the application.
 * Integrates with the User model's role field.
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('rbac');

// =============================================================================
// TYPES
// =============================================================================

export type UserRole = 'ADMIN' | 'TEAM_LEAD' | 'DEVELOPER' | 'VIEWER';

export type Permission =
  // User management
  | 'users:read'
  | 'users:write'
  | 'users:delete'
  | 'users:manage-roles'
  // Repository management
  | 'repos:read'
  | 'repos:write'
  | 'repos:delete'
  | 'repos:manage-reviewers'
  // Assignment management
  | 'assignments:read'
  | 'assignments:create'
  | 'assignments:reassign'
  | 'assignments:delete'
  // Statistics & Analytics
  | 'stats:read-own'
  | 'stats:read-team'
  | 'stats:read-all'
  | 'stats:export'
  // System administration
  | 'system:health'
  | 'system:config'
  | 'system:audit-logs'
  | 'system:dead-letter-queue';

export interface RoleDefinition {
  name: UserRole;
  displayName: string;
  description: string;
  permissions: Permission[];
  /** Roles this role can assign to others */
  canAssignRoles: UserRole[];
}

export interface AccessContext {
  userId: string;
  role: UserRole;
  targetUserId?: string;
  targetRepoId?: string;
  teamId?: string;
}

// =============================================================================
// ROLE DEFINITIONS
// =============================================================================

export const ROLES: Record<UserRole, RoleDefinition> = {
  ADMIN: {
    name: 'ADMIN',
    displayName: 'Administrator',
    description: 'Full system access, can manage all aspects of the application',
    permissions: [
      // All permissions
      'users:read',
      'users:write',
      'users:delete',
      'users:manage-roles',
      'repos:read',
      'repos:write',
      'repos:delete',
      'repos:manage-reviewers',
      'assignments:read',
      'assignments:create',
      'assignments:reassign',
      'assignments:delete',
      'stats:read-own',
      'stats:read-team',
      'stats:read-all',
      'stats:export',
      'system:health',
      'system:config',
      'system:audit-logs',
      'system:dead-letter-queue',
    ],
    canAssignRoles: ['ADMIN', 'TEAM_LEAD', 'DEVELOPER', 'VIEWER'],
  },

  TEAM_LEAD: {
    name: 'TEAM_LEAD',
    displayName: 'Team Lead',
    description: 'Can manage team members and repositories, view team analytics',
    permissions: [
      'users:read',
      'users:write', // Can edit team members
      'repos:read',
      'repos:write',
      'repos:manage-reviewers',
      'assignments:read',
      'assignments:create',
      'assignments:reassign',
      'stats:read-own',
      'stats:read-team',
      'stats:export',
      'system:health',
    ],
    canAssignRoles: ['DEVELOPER', 'VIEWER'],
  },

  DEVELOPER: {
    name: 'DEVELOPER',
    displayName: 'Developer',
    description: 'Standard access for team members, can participate in reviews',
    permissions: [
      'users:read',
      'repos:read',
      'assignments:read',
      'assignments:create', // Can create manual assignments
      'stats:read-own',
      'stats:read-team', // Can see team leaderboard
    ],
    canAssignRoles: [],
  },

  VIEWER: {
    name: 'VIEWER',
    displayName: 'Viewer',
    description: 'Read-only access to view statistics and assignments',
    permissions: [
      'repos:read',
      'assignments:read',
      'stats:read-own',
    ],
    canAssignRoles: [],
  },
};

// =============================================================================
// PERMISSION CHECKING
// =============================================================================

/**
 * Check if a role has a specific permission
 */
export const hasPermission = (role: UserRole, permission: Permission): boolean => {
  const roleDefinition = ROLES[role];
  if (!roleDefinition) return false;
  return roleDefinition.permissions.includes(permission);
};

/**
 * Check if a role can assign another role
 */
export const canAssignRole = (assignerRole: UserRole, targetRole: UserRole): boolean => {
  const roleDefinition = ROLES[assignerRole];
  if (!roleDefinition) return false;
  return roleDefinition.canAssignRoles.includes(targetRole);
};

/**
 * Get all permissions for a role
 */
export const getPermissions = (role: UserRole): Permission[] => {
  return ROLES[role]?.permissions ?? [];
};

/**
 * Check if a user can access a specific resource
 */
export const checkAccess = (
  context: AccessContext,
  permission: Permission
): { allowed: boolean; reason?: string } => {
  // Check for self-targeting actions first (overrides basic permission check)
  if (context.targetUserId && context.targetUserId === context.userId) {
    // Users can always read their own profile and stats
    if (permission === 'users:read' || permission === 'stats:read-own') {
      return { allowed: true };
    }
  }

  // Basic permission check
  if (!hasPermission(context.role, permission)) {
    return {
      allowed: false,
      reason: `Role ${context.role} does not have permission ${permission}`,
    };
  }

  // Additional context-based checks for team-scoped permissions
  if (permission === 'stats:read-team') {
    // Team leads can only see their team's stats (would need team context)
    // For now, allow if they have the base permission
    return { allowed: true };
  }

  // Prevent role escalation
  if (permission === 'users:manage-roles' && context.targetUserId) {
    // Can't change your own role (must be done by another admin)
    if (context.targetUserId === context.userId && context.role !== 'ADMIN') {
      return {
        allowed: false,
        reason: 'Cannot modify your own role',
      };
    }
  }

  return { allowed: true };
};

// =============================================================================
// ROLE HIERARCHY
// =============================================================================

const ROLE_HIERARCHY: Record<UserRole, number> = {
  ADMIN: 100,
  TEAM_LEAD: 75,
  DEVELOPER: 50,
  VIEWER: 25,
};

/**
 * Check if one role is higher than another in the hierarchy
 */
export const isHigherRole = (role1: UserRole, role2: UserRole): boolean => {
  return ROLE_HIERARCHY[role1] > ROLE_HIERARCHY[role2];
};

/**
 * Check if one role is at least as high as another
 */
export const isAtLeastRole = (role: UserRole, minimumRole: UserRole): boolean => {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimumRole];
};

/**
 * Get all roles at or below a given level
 */
export const getRolesAtOrBelow = (role: UserRole): UserRole[] => {
  const level = ROLE_HIERARCHY[role];
  return (Object.entries(ROLE_HIERARCHY) as [UserRole, number][])
    .filter(([, roleLevel]) => roleLevel <= level)
    .map(([roleName]) => roleName);
};

// =============================================================================
// MIDDLEWARE HELPERS
// =============================================================================

export type PermissionCheck = Permission | Permission[] | ((context: AccessContext) => boolean);

/**
 * Create a permission guard function
 */
export const requirePermission = (
  check: PermissionCheck
): ((context: AccessContext) => { allowed: boolean; reason?: string }) => {
  return (context: AccessContext) => {
    // Function check
    if (typeof check === 'function') {
      const allowed = check(context);
      return {
        allowed,
        reason: allowed ? undefined : 'Custom permission check failed',
      };
    }

    // Single permission
    if (typeof check === 'string') {
      return checkAccess(context, check);
    }

    // Array of permissions (require all)
    for (const permission of check) {
      const result = checkAccess(context, permission);
      if (!result.allowed) {
        return result;
      }
    }

    return { allowed: true };
  };
};

/**
 * Create a guard that requires any of the given permissions
 */
export const requireAnyPermission = (
  permissions: Permission[]
): ((context: AccessContext) => { allowed: boolean; reason?: string }) => {
  return (context: AccessContext) => {
    for (const permission of permissions) {
      const result = checkAccess(context, permission);
      if (result.allowed) {
        return result;
      }
    }

    return {
      allowed: false,
      reason: `None of the required permissions: ${permissions.join(', ')}`,
    };
  };
};

/**
 * Create a guard that requires a minimum role level
 */
export const requireRole = (
  minimumRole: UserRole
): ((context: AccessContext) => { allowed: boolean; reason?: string }) => {
  return (context: AccessContext) => {
    if (isAtLeastRole(context.role, minimumRole)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Requires at least ${minimumRole} role`,
    };
  };
};

// =============================================================================
// AUDIT LOGGING
// =============================================================================

export interface AccessLogEntry {
  timestamp: Date;
  userId: string;
  role: UserRole;
  action: string;
  permission: Permission;
  allowed: boolean;
  reason?: string;
  context?: Record<string, unknown>;
}

const accessLog: AccessLogEntry[] = [];
const MAX_LOG_SIZE = 1000;

/**
 * Log an access attempt
 */
export const logAccess = (
  context: AccessContext,
  action: string,
  permission: Permission,
  allowed: boolean,
  reason?: string
): void => {
  const entry: AccessLogEntry = {
    timestamp: new Date(),
    userId: context.userId,
    role: context.role,
    action,
    permission,
    allowed,
    reason,
    context: {
      targetUserId: context.targetUserId,
      targetRepoId: context.targetRepoId,
      teamId: context.teamId,
    },
  };

  accessLog.push(entry);

  // Trim old entries
  while (accessLog.length > MAX_LOG_SIZE) {
    accessLog.shift();
  }

  // Log denied access attempts
  if (!allowed) {
    log.warn('Access denied', {
      userId: context.userId,
      role: context.role,
      action,
      permission,
      reason,
    });
  }
};

/**
 * Get recent access log entries
 */
export const getAccessLog = (limit = 100): AccessLogEntry[] => {
  return accessLog.slice(-limit).reverse();
};

/**
 * Clear access log (for testing)
 */
export const clearAccessLog = (): void => {
  accessLog.length = 0;
};

// =============================================================================
// EXPORTS
// =============================================================================

export const rbac = {
  roles: ROLES,
  hasPermission,
  canAssignRole,
  getPermissions,
  checkAccess,
  isHigherRole,
  isAtLeastRole,
  getRolesAtOrBelow,
  requirePermission,
  requireAnyPermission,
  requireRole,
  logAccess,
  getAccessLog,
  clearAccessLog,
};

export default rbac;
