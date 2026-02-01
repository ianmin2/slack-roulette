/**
 * Weekly Digest API
 *
 * GET  - Preview digest data without sending
 * POST - Generate and send digest to a Slack channel
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { generateWeeklyDigest, formatDigestMessage, sendWeeklyDigest } from '@/lib/digest';
import { loggers } from '@/lib/utils/logger';
import type { ApiResponse, WeeklyDigest } from '@/types';

const log = loggers.digest;

/**
 * Schema for POST request body
 */
const SendDigestSchema = z.object({
  channelId: z.string().min(1, 'channelId is required'),
  repositoryId: z.string().optional(),
});

/**
 * Schema for GET query params
 */
const PreviewDigestSchema = z.object({
  repositoryId: z.string().optional(),
  format: z.enum(['json', 'slack']).optional().default('json'),
});

/**
 * GET /api/digest
 *
 * Preview the weekly digest data without sending to Slack.
 * Useful for testing and debugging.
 *
 * Query params:
 * - repositoryId?: string - Filter to a specific repository
 * - format?: 'json' | 'slack' - Response format (default: json)
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<WeeklyDigest | { formatted: string }>>> {
  try {
    const { searchParams } = new URL(request.url);

    const params = PreviewDigestSchema.parse({
      repositoryId: searchParams.get('repositoryId') ?? undefined,
      format: searchParams.get('format') ?? 'json',
    });

    const digest = await generateWeeklyDigest(params.repositoryId);

    if (params.format === 'slack') {
      const formatted = formatDigestMessage(digest);
      return NextResponse.json({
        success: true,
        data: { formatted },
      });
    }

    return NextResponse.json({
      success: true,
      data: digest,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: error.issues,
        },
        { status: 400 }
      );
    }

    log.error('Digest preview failed', error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate digest preview',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/digest
 *
 * Generate and send the weekly digest to a Slack channel.
 *
 * Request body:
 * - channelId: string - Slack channel ID to send to
 * - repositoryId?: string - Filter to a specific repository
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<{ digest: WeeklyDigest; sent: boolean }>>> {
  try {
    const body = await request.json();
    const validated = SendDigestSchema.parse(body);

    const digest = await generateWeeklyDigest(validated.repositoryId);

    await sendWeeklyDigest(validated.channelId, digest);

    return NextResponse.json({
      success: true,
      data: {
        digest,
        sent: true,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          details: error.issues,
        },
        { status: 400 }
      );
    }

    log.error('Digest send failed', error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to send digest',
      },
      { status: 500 }
    );
  }
}
