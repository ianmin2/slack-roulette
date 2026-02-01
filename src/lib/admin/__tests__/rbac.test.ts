/**
 * Tests for Role-Based Access Control
 */

import {
  ROLES,
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
  type UserRole,
  type Permission,
  type AccessContext,
} from '../rbac';

describe('RBAC', () => {
  beforeEach(() => {
    clearAccessLog();
  });

  describe('ROLES', () => {
    it('defines all four roles', () => {
      expect(Object.keys(ROLES)).toEqual(['ADMIN', 'TEAM_LEAD', 'DEVELOPER', 'VIEWER']);
    });

    it('ADMIN has all permissions', () => {
      const adminPerms = ROLES.ADMIN.permissions;
      expect(adminPerms).toContain('users:manage-roles');
      expect(adminPerms).toContain('system:config');
      expect(adminPerms).toContain('system:dead-letter-queue');
    });

    it('VIEWER has minimal permissions', () => {
      const viewerPerms = ROLES.VIEWER.permissions;
      expect(viewerPerms).toContain('repos:read');
      expect(viewerPerms).toContain('stats:read-own');
      expect(viewerPerms).not.toContain('users:write');
      expect(viewerPerms).not.toContain('system:config');
    });

    it('each role has a display name and description', () => {
      for (const role of Object.values(ROLES)) {
        expect(role.displayName).toBeTruthy();
        expect(role.description).toBeTruthy();
      }
    });
  });

  describe('hasPermission', () => {
    it('returns true when role has permission', () => {
      expect(hasPermission('ADMIN', 'users:manage-roles')).toBe(true);
      expect(hasPermission('DEVELOPER', 'repos:read')).toBe(true);
    });

    it('returns false when role lacks permission', () => {
      expect(hasPermission('VIEWER', 'users:write')).toBe(false);
      expect(hasPermission('DEVELOPER', 'system:config')).toBe(false);
    });

    it('returns false for invalid role', () => {
      expect(hasPermission('INVALID' as UserRole, 'users:read')).toBe(false);
    });
  });

  describe('canAssignRole', () => {
    it('ADMIN can assign all roles', () => {
      expect(canAssignRole('ADMIN', 'ADMIN')).toBe(true);
      expect(canAssignRole('ADMIN', 'TEAM_LEAD')).toBe(true);
      expect(canAssignRole('ADMIN', 'DEVELOPER')).toBe(true);
      expect(canAssignRole('ADMIN', 'VIEWER')).toBe(true);
    });

    it('TEAM_LEAD can assign lower roles', () => {
      expect(canAssignRole('TEAM_LEAD', 'DEVELOPER')).toBe(true);
      expect(canAssignRole('TEAM_LEAD', 'VIEWER')).toBe(true);
      expect(canAssignRole('TEAM_LEAD', 'ADMIN')).toBe(false);
      expect(canAssignRole('TEAM_LEAD', 'TEAM_LEAD')).toBe(false);
    });

    it('DEVELOPER cannot assign roles', () => {
      expect(canAssignRole('DEVELOPER', 'VIEWER')).toBe(false);
      expect(canAssignRole('DEVELOPER', 'DEVELOPER')).toBe(false);
    });

    it('VIEWER cannot assign roles', () => {
      expect(canAssignRole('VIEWER', 'VIEWER')).toBe(false);
    });
  });

  describe('getPermissions', () => {
    it('returns all permissions for a role', () => {
      const adminPerms = getPermissions('ADMIN');
      expect(adminPerms.length).toBeGreaterThan(10);
    });

    it('returns empty array for invalid role', () => {
      expect(getPermissions('INVALID' as UserRole)).toEqual([]);
    });
  });

  describe('checkAccess', () => {
    it('allows access when permission exists', () => {
      const context: AccessContext = {
        userId: 'user-1',
        role: 'ADMIN',
      };

      const result = checkAccess(context, 'users:manage-roles');
      expect(result.allowed).toBe(true);
    });

    it('denies access when permission missing', () => {
      const context: AccessContext = {
        userId: 'user-1',
        role: 'VIEWER',
      };

      const result = checkAccess(context, 'users:write');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not have permission');
    });

    it('allows users to read their own profile', () => {
      const context: AccessContext = {
        userId: 'user-1',
        role: 'VIEWER',
        targetUserId: 'user-1',
      };

      const result = checkAccess(context, 'users:read');
      expect(result.allowed).toBe(true);
    });

    it('allows users to view their own stats', () => {
      const context: AccessContext = {
        userId: 'user-1',
        role: 'VIEWER',
        targetUserId: 'user-1',
      };

      const result = checkAccess(context, 'stats:read-own');
      expect(result.allowed).toBe(true);
    });
  });

  describe('role hierarchy', () => {
    describe('isHigherRole', () => {
      it('ADMIN is higher than all other roles', () => {
        expect(isHigherRole('ADMIN', 'TEAM_LEAD')).toBe(true);
        expect(isHigherRole('ADMIN', 'DEVELOPER')).toBe(true);
        expect(isHigherRole('ADMIN', 'VIEWER')).toBe(true);
      });

      it('TEAM_LEAD is higher than DEVELOPER and VIEWER', () => {
        expect(isHigherRole('TEAM_LEAD', 'DEVELOPER')).toBe(true);
        expect(isHigherRole('TEAM_LEAD', 'VIEWER')).toBe(true);
        expect(isHigherRole('TEAM_LEAD', 'ADMIN')).toBe(false);
      });

      it('same role is not higher', () => {
        expect(isHigherRole('ADMIN', 'ADMIN')).toBe(false);
        expect(isHigherRole('DEVELOPER', 'DEVELOPER')).toBe(false);
      });
    });

    describe('isAtLeastRole', () => {
      it('role is at least itself', () => {
        expect(isAtLeastRole('ADMIN', 'ADMIN')).toBe(true);
        expect(isAtLeastRole('DEVELOPER', 'DEVELOPER')).toBe(true);
      });

      it('ADMIN is at least every role', () => {
        expect(isAtLeastRole('ADMIN', 'TEAM_LEAD')).toBe(true);
        expect(isAtLeastRole('ADMIN', 'DEVELOPER')).toBe(true);
        expect(isAtLeastRole('ADMIN', 'VIEWER')).toBe(true);
      });

      it('VIEWER is not at least DEVELOPER', () => {
        expect(isAtLeastRole('VIEWER', 'DEVELOPER')).toBe(false);
      });
    });

    describe('getRolesAtOrBelow', () => {
      it('ADMIN includes all roles', () => {
        const roles = getRolesAtOrBelow('ADMIN');
        expect(roles).toContain('ADMIN');
        expect(roles).toContain('TEAM_LEAD');
        expect(roles).toContain('DEVELOPER');
        expect(roles).toContain('VIEWER');
      });

      it('DEVELOPER includes DEVELOPER and VIEWER', () => {
        const roles = getRolesAtOrBelow('DEVELOPER');
        expect(roles).toContain('DEVELOPER');
        expect(roles).toContain('VIEWER');
        expect(roles).not.toContain('ADMIN');
        expect(roles).not.toContain('TEAM_LEAD');
      });

      it('VIEWER only includes VIEWER', () => {
        const roles = getRolesAtOrBelow('VIEWER');
        expect(roles).toEqual(['VIEWER']);
      });
    });
  });

  describe('middleware helpers', () => {
    describe('requirePermission', () => {
      it('creates guard for single permission', () => {
        const guard = requirePermission('users:read');
        const context: AccessContext = { userId: 'u1', role: 'DEVELOPER' };

        expect(guard(context).allowed).toBe(true);
      });

      it('creates guard for multiple permissions (all required)', () => {
        const guard = requirePermission(['users:read', 'users:write']);
        const devContext: AccessContext = { userId: 'u1', role: 'DEVELOPER' };
        const leadContext: AccessContext = { userId: 'u1', role: 'TEAM_LEAD' };

        expect(guard(devContext).allowed).toBe(false);
        expect(guard(leadContext).allowed).toBe(true);
      });

      it('creates guard for custom function', () => {
        const guard = requirePermission((ctx) => ctx.userId === 'special-user');
        const specialContext: AccessContext = { userId: 'special-user', role: 'VIEWER' };
        const normalContext: AccessContext = { userId: 'normal-user', role: 'ADMIN' };

        expect(guard(specialContext).allowed).toBe(true);
        expect(guard(normalContext).allowed).toBe(false);
      });
    });

    describe('requireAnyPermission', () => {
      it('allows if any permission matches', () => {
        const guard = requireAnyPermission(['users:delete', 'users:read']);
        const context: AccessContext = { userId: 'u1', role: 'DEVELOPER' };

        expect(guard(context).allowed).toBe(true);
      });

      it('denies if no permissions match', () => {
        const guard = requireAnyPermission(['users:delete', 'system:config']);
        const context: AccessContext = { userId: 'u1', role: 'DEVELOPER' };

        expect(guard(context).allowed).toBe(false);
      });
    });

    describe('requireRole', () => {
      it('allows if role meets minimum', () => {
        const guard = requireRole('DEVELOPER');

        expect(guard({ userId: 'u1', role: 'ADMIN' }).allowed).toBe(true);
        expect(guard({ userId: 'u1', role: 'TEAM_LEAD' }).allowed).toBe(true);
        expect(guard({ userId: 'u1', role: 'DEVELOPER' }).allowed).toBe(true);
      });

      it('denies if role below minimum', () => {
        const guard = requireRole('TEAM_LEAD');

        expect(guard({ userId: 'u1', role: 'DEVELOPER' }).allowed).toBe(false);
        expect(guard({ userId: 'u1', role: 'VIEWER' }).allowed).toBe(false);
      });
    });
  });

  describe('access logging', () => {
    it('logs access attempts', () => {
      const context: AccessContext = { userId: 'user-1', role: 'DEVELOPER' };
      logAccess(context, 'read user', 'users:read', true);

      const log = getAccessLog();
      expect(log).toHaveLength(1);
      expect(log[0].userId).toBe('user-1');
      expect(log[0].action).toBe('read user');
      expect(log[0].allowed).toBe(true);
    });

    it('records denied attempts', () => {
      const context: AccessContext = { userId: 'user-1', role: 'VIEWER' };
      logAccess(context, 'delete user', 'users:delete', false, 'Permission denied');

      const log = getAccessLog();
      expect(log[0].allowed).toBe(false);
      expect(log[0].reason).toBe('Permission denied');
    });

    it('limits log size', () => {
      const context: AccessContext = { userId: 'user-1', role: 'ADMIN' };

      for (let i = 0; i < 1100; i++) {
        logAccess(context, `action ${i}`, 'users:read', true);
      }

      const log = getAccessLog(2000);
      expect(log.length).toBeLessThanOrEqual(1000);
    });

    it('returns most recent entries first', () => {
      const context: AccessContext = { userId: 'user-1', role: 'ADMIN' };

      logAccess(context, 'first', 'users:read', true);
      logAccess(context, 'second', 'users:read', true);
      logAccess(context, 'third', 'users:read', true);

      const log = getAccessLog();
      expect(log[0].action).toBe('third');
      expect(log[2].action).toBe('first');
    });

    it('clearAccessLog removes all entries', () => {
      const context: AccessContext = { userId: 'user-1', role: 'ADMIN' };
      logAccess(context, 'action', 'users:read', true);

      clearAccessLog();

      expect(getAccessLog()).toHaveLength(0);
    });
  });
});
