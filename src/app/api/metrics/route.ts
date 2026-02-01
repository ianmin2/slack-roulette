/**
 * Metrics API Endpoint
 *
 * Exposes application metrics in Prometheus format.
 * Protected by basic authentication in production.
 */

import { NextRequest, NextResponse } from 'next/server';
import { metrics } from '@/lib/utils/metrics';

const METRICS_TOKEN = process.env.METRICS_TOKEN;

/**
 * Verify metrics access token
 */
const verifyAccess = (request: NextRequest): boolean => {
  // In development, allow access without token
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  // If no token configured, deny access in production
  if (!METRICS_TOKEN) {
    return false;
  }

  // Check Authorization header
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);
  return token === METRICS_TOKEN;
};

/**
 * GET /api/metrics
 *
 * Returns metrics in Prometheus format
 */
export async function GET(request: NextRequest) {
  // Verify access
  if (!verifyAccess(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const format = request.nextUrl.searchParams.get('format') ?? 'prometheus';

  if (format === 'json') {
    return NextResponse.json({
      metrics: metrics.getSnapshots(),
      timestamp: new Date().toISOString(),
    });
  }

  // Default: Prometheus format
  const prometheusOutput = metrics.toPrometheusFormat();

  return new NextResponse(prometheusOutput, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
