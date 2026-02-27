/**
 * Problem Detection Cron Endpoint
 * Run periodically (every 15 minutes) to check for stalled/problematic PRs
 *
 * Security: Protected by CRON_SECRET header
 */

import { NextRequest, NextResponse } from 'next/server';

import { runProblemDetection } from '@/lib/rules/evaluator';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('cron:check-problems');

/**
 * Verify cron request authenticity
 */
const verifyCronSecret = (request: NextRequest): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.warn('CRON_SECRET not configured - cron endpoint disabled');
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  // Support both "Bearer <token>" and plain token
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  return token === secret;
};

export async function GET(request: NextRequest) {
  // Verify secret
  if (!verifyCronSecret(request)) {
    log.warn('Unauthorized cron request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const stats = await runProblemDetection();

    const duration = Date.now() - startTime;
    log.info('Problem detection cron completed', { ...stats, durationMs: duration });

    return NextResponse.json({
      ok: true,
      ...stats,
      durationMs: duration,
    });
  } catch (error) {
    log.error('Problem detection cron failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      { ok: false, error: 'Problem detection failed' },
      { status: 500 }
    );
  }
}

// Also support POST for flexibility
export async function POST(request: NextRequest) {
  return GET(request);
}
