/**
 * Redis Cache Module
 *
 * Provides caching utilities with Redis backend and in-memory fallback.
 * Uses cache-aside pattern for transparent caching.
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('cache');

// =============================================================================
// TYPES
// =============================================================================

export interface CacheOptions {
  /** Time-to-live in seconds */
  ttl?: number;
  /** Cache key prefix */
  prefix?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
}

type RedisClientType = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<unknown>;
  del: (key: string | string[]) => Promise<number>;
  keys: (pattern: string) => Promise<string[]>;
  ping: () => Promise<string>;
  quit: () => Promise<unknown>;
};

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_TTL = 300; // 5 minutes
const CACHE_PREFIX = 'pr-roulette:';

// TTL presets for different data types
export const TTL = {
  /** Very short-lived data (30 seconds) */
  SHORT: 30,
  /** Standard cache duration (5 minutes) */
  STANDARD: 300,
  /** Medium duration for semi-static data (15 minutes) */
  MEDIUM: 900,
  /** Long duration for rarely changing data (1 hour) */
  LONG: 3600,
  /** Very long duration for static data (24 hours) */
  DAY: 86400,
} as const;

// Cache key patterns for different data types
export const CacheKeys = {
  // User-related
  userProfile: (userId: string) => `user:${userId}:profile`,
  userStats: (userId: string, period: string) => `user:${userId}:stats:${period}`,
  userAchievements: (userId: string) => `user:${userId}:achievements`,

  // Repository-related
  repoConfig: (repoId: string) => `repo:${repoId}:config`,
  repoReviewers: (repoId: string) => `repo:${repoId}:reviewers`,
  repoStats: (repoId: string, period: string) => `repo:${repoId}:stats:${period}`,

  // Leaderboard
  leaderboard: (period: string, repoId?: string) =>
    repoId ? `leaderboard:${period}:${repoId}` : `leaderboard:${period}`,

  // Challenges
  activeChallenges: () => 'challenges:active',
  challengeProgress: (challengeId: string) => `challenge:${challengeId}:progress`,

  // Analytics
  analyticsSnapshot: (period: string) => `analytics:${period}`,
  bottleneckReport: (period: string) => `bottleneck:${period}`,

  // Weekly digest
  weeklyDigest: (week: string, repoId?: string) =>
    repoId ? `digest:${week}:${repoId}` : `digest:${week}`,
} as const;

// =============================================================================
// IN-MEMORY FALLBACK CACHE
// =============================================================================

interface MemoryCacheEntry {
  value: string;
  expiresAt: number;
}

class MemoryCache {
  private cache = new Map<string, MemoryCacheEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, options?: { EX?: number }): Promise<void> {
    const ttl = options?.EX ?? DEFAULT_TTL;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  async del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let deleted = 0;
    for (const k of keys) {
      if (this.cache.delete(k)) deleted++;
    }
    return deleted;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    const matches: string[] = [];
    for (const key of this.cache.keys()) {
      if (regex.test(key)) matches.push(key);
    }
    return matches;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async quit(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  size(): number {
    return this.cache.size;
  }
}

// =============================================================================
// REDIS CLIENT
// =============================================================================

let redisClient: RedisClientType | null = null;
let memoryCache: MemoryCache | null = null;
let useMemoryFallback = false;

const getRedisUrl = (): string | undefined => {
  return process.env.REDIS_URL;
};

/**
 * Initialize Redis client or fall back to in-memory cache
 */
const initializeClient = async (): Promise<RedisClientType> => {
  // Return existing client if available
  if (redisClient && !useMemoryFallback) {
    return redisClient;
  }

  if (useMemoryFallback && memoryCache) {
    return memoryCache as unknown as RedisClientType;
  }

  const redisUrl = getRedisUrl();

  // In test environment or when REDIS_URL is not set, use memory cache
  if (!redisUrl || process.env.NODE_ENV === 'test') {
    if (!redisUrl) {
      log.debug('REDIS_URL not configured, using in-memory cache');
    }
    useMemoryFallback = true;
    memoryCache = new MemoryCache();
    return memoryCache as unknown as RedisClientType;
  }

  try {
    // Dynamic import to avoid build issues when redis is not installed
    const { createClient } = await import('redis');
    const client = createClient({ url: redisUrl });

    client.on('error', (err) => {
      log.error('Redis client error', err);
    });

    client.on('connect', () => {
      log.info('Redis client connected');
    });

    client.on('disconnect', () => {
      log.warn('Redis client disconnected');
    });

    await client.connect();
    redisClient = client as unknown as RedisClientType;
    return redisClient;
  } catch (error) {
    log.warn('Failed to connect to Redis, using in-memory cache', { error });
    useMemoryFallback = true;
    memoryCache = new MemoryCache();
    return memoryCache as unknown as RedisClientType;
  }
};

// =============================================================================
// CACHE OPERATIONS
// =============================================================================

const stats: CacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
  errors: 0,
};

/**
 * Build full cache key with prefix
 */
const buildKey = (key: string, prefix?: string): string => {
  const fullPrefix = prefix ? `${CACHE_PREFIX}${prefix}:` : CACHE_PREFIX;
  return `${fullPrefix}${key}`;
};

/**
 * Get value from cache
 */
export const get = async <T>(
  key: string,
  options?: CacheOptions
): Promise<T | null> => {
  try {
    const client = await initializeClient();
    const fullKey = buildKey(key, options?.prefix);
    const value = await client.get(fullKey);

    if (value === null) {
      stats.misses++;
      return null;
    }

    stats.hits++;
    return JSON.parse(value) as T;
  } catch (error) {
    stats.errors++;
    log.error('Cache get error', error, { key });
    return null;
  }
};

/**
 * Set value in cache
 */
export const set = async <T>(
  key: string,
  value: T,
  options?: CacheOptions
): Promise<boolean> => {
  try {
    const client = await initializeClient();
    const fullKey = buildKey(key, options?.prefix);
    const ttl = options?.ttl ?? DEFAULT_TTL;

    await client.set(fullKey, JSON.stringify(value), { EX: ttl });
    stats.sets++;
    return true;
  } catch (error) {
    stats.errors++;
    log.error('Cache set error', error, { key });
    return false;
  }
};

/**
 * Delete value from cache
 */
export const del = async (
  key: string | string[],
  options?: CacheOptions
): Promise<number> => {
  try {
    const client = await initializeClient();
    const keys = Array.isArray(key) ? key : [key];
    const fullKeys = keys.map((k) => buildKey(k, options?.prefix));

    const deleted = await client.del(fullKeys);
    stats.deletes += deleted;
    return deleted;
  } catch (error) {
    stats.errors++;
    log.error('Cache delete error', error, { key });
    return 0;
  }
};

/**
 * Delete all keys matching a pattern
 */
export const delPattern = async (
  pattern: string,
  options?: CacheOptions
): Promise<number> => {
  try {
    const client = await initializeClient();
    const fullPattern = buildKey(pattern, options?.prefix);
    const keys = await client.keys(fullPattern);

    if (keys.length === 0) return 0;

    const deleted = await client.del(keys);
    stats.deletes += deleted;
    return deleted;
  } catch (error) {
    stats.errors++;
    log.error('Cache delete pattern error', error, { pattern });
    return 0;
  }
};

/**
 * Get or set value (cache-aside pattern)
 *
 * If the value exists in cache, return it.
 * If not, call the factory function, cache the result, and return it.
 */
export const getOrSet = async <T>(
  key: string,
  factory: () => Promise<T>,
  options?: CacheOptions
): Promise<T> => {
  // Try to get from cache
  const cached = await get<T>(key, options);
  if (cached !== null) {
    return cached;
  }

  // Generate value using factory
  const value = await factory();

  // Cache the result (don't await to avoid blocking)
  set(key, value, options).catch((err) => {
    log.error('Failed to cache value', err, { key });
  });

  return value;
};

/**
 * Invalidate cache for a specific entity
 */
export const invalidateUser = async (userId: string): Promise<void> => {
  await delPattern(`user:${userId}:*`);
};

export const invalidateRepo = async (repoId: string): Promise<void> => {
  await delPattern(`repo:${repoId}:*`);
};

export const invalidateLeaderboards = async (): Promise<void> => {
  await delPattern('leaderboard:*');
};

export const invalidateChallenges = async (): Promise<void> => {
  await delPattern('challenge*');
};

/**
 * Get cache statistics
 */
export const getStats = (): CacheStats => ({ ...stats });

/**
 * Reset cache statistics
 */
export const resetStats = (): void => {
  stats.hits = 0;
  stats.misses = 0;
  stats.sets = 0;
  stats.deletes = 0;
  stats.errors = 0;
};

/**
 * Check if cache is healthy
 */
export const healthCheck = async (): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  backend: 'redis' | 'memory';
  latencyMs: number;
}> => {
  const start = Date.now();
  try {
    const client = await initializeClient();
    await client.ping();
    return {
      status: 'healthy',
      backend: useMemoryFallback ? 'memory' : 'redis',
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      status: 'unhealthy',
      backend: useMemoryFallback ? 'memory' : 'redis',
      latencyMs: Date.now() - start,
    };
  }
};

/**
 * Gracefully close cache connection
 */
export const close = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  if (memoryCache) {
    await memoryCache.quit();
    memoryCache = null;
  }
  useMemoryFallback = false;
};

// =============================================================================
// CACHE DECORATORS / HELPERS
// =============================================================================

/**
 * Create a cached version of a function
 */
export const cached = <TArgs extends unknown[], TResult>(
  keyFn: (...args: TArgs) => string,
  fn: (...args: TArgs) => Promise<TResult>,
  options?: CacheOptions
): ((...args: TArgs) => Promise<TResult>) => {
  return async (...args: TArgs): Promise<TResult> => {
    const key = keyFn(...args);
    return getOrSet(key, () => fn(...args), options);
  };
};

// Export cache module
export const cache = {
  get,
  set,
  del,
  delPattern,
  getOrSet,
  invalidateUser,
  invalidateRepo,
  invalidateLeaderboards,
  invalidateChallenges,
  getStats,
  resetStats,
  healthCheck,
  close,
  cached,
  keys: CacheKeys,
  ttl: TTL,
};

export default cache;
