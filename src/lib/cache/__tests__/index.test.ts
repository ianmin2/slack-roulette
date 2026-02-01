/**
 * Tests for Cache Module
 */

import {
  cache,
  get,
  set,
  del,
  delPattern,
  getOrSet,
  invalidateUser,
  invalidateRepo,
  invalidateLeaderboards,
  getStats,
  resetStats,
  healthCheck,
  CacheKeys,
  TTL,
} from '../index';

describe('Cache Module', () => {
  beforeEach(() => {
    resetStats();
  });

  describe('basic operations', () => {
    it('sets and gets a value', async () => {
      const key = 'test:basic:set-get';
      const value = { foo: 'bar', num: 42 };

      await set(key, value);
      const result = await get(key);

      expect(result).toEqual(value);
    });

    it('returns null for non-existent key', async () => {
      const result = await get('test:nonexistent:key');
      expect(result).toBeNull();
    });

    it('deletes a value', async () => {
      const key = 'test:basic:delete';
      await set(key, { data: 'test' });

      const deleted = await del(key);
      expect(deleted).toBe(1);

      const result = await get(key);
      expect(result).toBeNull();
    });

    it('handles multiple keys deletion', async () => {
      const keys = ['test:multi:1', 'test:multi:2', 'test:multi:3'];
      for (const key of keys) {
        await set(key, { key });
      }

      const deleted = await del(keys);
      expect(deleted).toBe(3);

      for (const key of keys) {
        const result = await get(key);
        expect(result).toBeNull();
      }
    });
  });

  describe('TTL presets', () => {
    it('has correct TTL values', () => {
      expect(TTL.SHORT).toBe(30);
      expect(TTL.STANDARD).toBe(300);
      expect(TTL.MEDIUM).toBe(900);
      expect(TTL.LONG).toBe(3600);
      expect(TTL.DAY).toBe(86400);
    });
  });

  describe('CacheKeys', () => {
    it('generates user profile key', () => {
      expect(CacheKeys.userProfile('user-123')).toBe('user:user-123:profile');
    });

    it('generates user stats key', () => {
      expect(CacheKeys.userStats('user-123', '2024-W05')).toBe(
        'user:user-123:stats:2024-W05'
      );
    });

    it('generates leaderboard key without repoId', () => {
      expect(CacheKeys.leaderboard('2024-W05')).toBe('leaderboard:2024-W05');
    });

    it('generates leaderboard key with repoId', () => {
      expect(CacheKeys.leaderboard('2024-W05', 'repo-123')).toBe(
        'leaderboard:2024-W05:repo-123'
      );
    });

    it('generates repo config key', () => {
      expect(CacheKeys.repoConfig('repo-123')).toBe('repo:repo-123:config');
    });

    it('generates active challenges key', () => {
      expect(CacheKeys.activeChallenges()).toBe('challenges:active');
    });

    it('generates weekly digest key', () => {
      expect(CacheKeys.weeklyDigest('2024-W05')).toBe('digest:2024-W05');
      expect(CacheKeys.weeklyDigest('2024-W05', 'repo-1')).toBe(
        'digest:2024-W05:repo-1'
      );
    });
  });

  describe('getOrSet (cache-aside pattern)', () => {
    it('returns cached value on hit', async () => {
      const key = 'test:cache-aside:hit';
      const cachedValue = { cached: true };
      await set(key, cachedValue);

      let factoryCalled = false;
      const result = await getOrSet(key, async () => {
        factoryCalled = true;
        return { cached: false };
      });

      expect(result).toEqual(cachedValue);
      expect(factoryCalled).toBe(false);
    });

    it('calls factory on miss and caches result', async () => {
      const key = 'test:cache-aside:miss';
      const freshValue = { fresh: true, timestamp: Date.now() };

      const result = await getOrSet(key, async () => freshValue);

      expect(result).toEqual(freshValue);

      // Should be cached now
      const cached = await get(key);
      expect(cached).toEqual(freshValue);
    });

    it('uses custom TTL options', async () => {
      const key = 'test:cache-aside:ttl';

      await getOrSet(key, async () => ({ data: 'test' }), { ttl: TTL.SHORT });

      const result = await get(key);
      expect(result).not.toBeNull();
    });
  });

  describe('pattern deletion', () => {
    it('deletes keys matching pattern', async () => {
      // Set up multiple keys
      await set('test:pattern:a', { a: 1 });
      await set('test:pattern:b', { b: 2 });
      await set('test:other:c', { c: 3 });

      const deleted = await delPattern('test:pattern:*');
      expect(deleted).toBe(2);

      // Pattern matches should be deleted
      expect(await get('test:pattern:a')).toBeNull();
      expect(await get('test:pattern:b')).toBeNull();
      // Non-matching should remain
      expect(await get('test:other:c')).not.toBeNull();
    });
  });

  describe('invalidation helpers', () => {
    it('invalidates user cache', async () => {
      const userId = 'user-invalidate-test';
      await set(`user:${userId}:profile`, { name: 'Test' });
      await set(`user:${userId}:stats:week`, { completed: 5 });

      await invalidateUser(userId);

      expect(await get(`user:${userId}:profile`)).toBeNull();
      expect(await get(`user:${userId}:stats:week`)).toBeNull();
    });

    it('invalidates repo cache', async () => {
      const repoId = 'repo-invalidate-test';
      await set(`repo:${repoId}:config`, { auto: true });
      await set(`repo:${repoId}:reviewers`, []);

      await invalidateRepo(repoId);

      expect(await get(`repo:${repoId}:config`)).toBeNull();
      expect(await get(`repo:${repoId}:reviewers`)).toBeNull();
    });

    it('invalidates leaderboards', async () => {
      await set('leaderboard:2024-W05', []);
      await set('leaderboard:2024-W05:repo-1', []);

      await invalidateLeaderboards();

      expect(await get('leaderboard:2024-W05')).toBeNull();
      expect(await get('leaderboard:2024-W05:repo-1')).toBeNull();
    });
  });

  describe('statistics', () => {
    it('tracks hits and misses', async () => {
      const key = 'test:stats:tracking';
      await set(key, { data: 'test' });

      // Hit
      await get(key);
      // Miss
      await get('test:stats:nonexistent');

      const stats = getStats();
      expect(stats.hits).toBeGreaterThanOrEqual(1);
      expect(stats.misses).toBeGreaterThanOrEqual(1);
    });

    it('resets statistics', async () => {
      await set('test:stats:reset', { data: 'test' });
      await get('test:stats:reset');

      resetStats();

      const stats = getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
    });
  });

  describe('health check', () => {
    it('returns healthy status', async () => {
      const health = await healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.backend).toBe('memory'); // Falls back to memory in tests
      expect(typeof health.latencyMs).toBe('number');
    });
  });

  describe('cache helper', () => {
    it('exports cache object with all methods', () => {
      expect(cache.get).toBeDefined();
      expect(cache.set).toBeDefined();
      expect(cache.del).toBeDefined();
      expect(cache.delPattern).toBeDefined();
      expect(cache.getOrSet).toBeDefined();
      expect(cache.invalidateUser).toBeDefined();
      expect(cache.invalidateRepo).toBeDefined();
      expect(cache.invalidateLeaderboards).toBeDefined();
      expect(cache.getStats).toBeDefined();
      expect(cache.resetStats).toBeDefined();
      expect(cache.healthCheck).toBeDefined();
      expect(cache.keys).toBeDefined();
      expect(cache.ttl).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles null/undefined values', async () => {
      const key = 'test:edge:null';

      // null should be storable
      await set(key, null);
      const result = await get(key);
      expect(result).toBeNull();
    });

    it('handles complex nested objects', async () => {
      const key = 'test:edge:complex';
      const complex = {
        users: [
          { id: 1, name: 'Alice', skills: ['ts', 'js'] },
          { id: 2, name: 'Bob', skills: ['go', 'rust'] },
        ],
        metadata: {
          created: new Date().toISOString(),
          nested: { deep: { value: true } },
        },
      };

      await set(key, complex);
      const result = await get(key);

      expect(result).toEqual(complex);
    });

    it('handles empty strings as keys', async () => {
      // Empty string key should still work (with prefix)
      await set('', { empty: true });
      const result = await get('');
      expect(result).toEqual({ empty: true });
    });
  });
});
