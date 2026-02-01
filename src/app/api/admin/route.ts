/**
 * Admin Dashboard API
 *
 * GET /api/admin - Returns full dashboard data
 */

import { NextResponse } from 'next/server';

import { getAdminDashboard } from '@/lib/admin';
import { loggers } from '@/lib/utils/logger';
import type { ApiResponse, AdminDashboardData } from '@/types';

const log = loggers.admin;

export async function GET(): Promise<NextResponse<ApiResponse<AdminDashboardData>>> {
  try {
    const dashboard = await getAdminDashboard();

    return NextResponse.json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    log.error('Dashboard fetch failed', error instanceof Error ? error : undefined);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch admin dashboard',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
