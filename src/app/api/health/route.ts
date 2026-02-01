/**
 * Health Check Endpoint
 *
 * Returns system health status including:
 * - Database connectivity
 * - Cache connectivity
 * - Overall system status
 * - Version info
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cache } from '@/lib/cache';

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: ComponentHealth;
    cache: CacheHealth;
  };
}

interface ComponentHealth {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

interface CacheHealth extends ComponentHealth {
  backend?: 'redis' | 'memory';
}

// Track server start time
const startTime = Date.now();

/**
 * Check database connectivity
 */
const checkDatabase = async (): Promise<ComponentHealth> => {
  const start = Date.now();

  try {
    // Simple query to check connectivity
    await db.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;

    return {
      status: 'up',
      latencyMs,
    };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
};

/**
 * Check cache connectivity
 */
const checkCache = async (): Promise<CacheHealth> => {
  try {
    const result = await cache.healthCheck();
    return {
      status: result.status === 'healthy' ? 'up' : 'down',
      latencyMs: result.latencyMs,
      backend: result.backend,
    };
  } catch (error) {
    return {
      status: 'down',
      error: error instanceof Error ? error.message : 'Unknown cache error',
    };
  }
};

/**
 * Determine overall health status
 */
const getOverallStatus = (checks: HealthCheck['checks']): HealthCheck['status'] => {
  // If database is down, system is unhealthy
  if (checks.database.status === 'down') {
    return 'unhealthy';
  }

  // If cache is down (and using Redis), system is degraded but functional
  // Memory fallback means the system is still operational
  if (checks.cache.status === 'down' && checks.cache.backend === 'redis') {
    return 'degraded';
  }

  return 'healthy';
};

/**
 * GET /api/health
 *
 * Returns health check status
 */
export async function GET() {
  const [database, cacheHealth] = await Promise.all([
    checkDatabase(),
    checkCache(),
  ]);

  const checks = {
    database,
    cache: cacheHealth,
  };

  const health: HealthCheck = {
    status: getOverallStatus(checks),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.1.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  };

  // Return 503 if unhealthy, 200 otherwise
  const statusCode = health.status === 'unhealthy' ? 503 : 200;

  return NextResponse.json(health, { status: statusCode });
}

/**
 * HEAD /api/health
 *
 * Simple liveness check (no body)
 */
export async function HEAD() {
  try {
    await db.$queryRaw`SELECT 1`;
    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
