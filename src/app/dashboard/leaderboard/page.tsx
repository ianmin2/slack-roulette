'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@/types/dashboard';
import { cn } from '@/lib/utils';

// =============================================================================
// HELPERS
// =============================================================================

type Period = 'week' | 'month';

const RANK_MEDALS: Record<number, string> = {
  1: '\u{1F947}', // gold medal
  2: '\u{1F948}', // silver medal
  3: '\u{1F949}', // bronze medal
};

const formatMinutes = (minutes: number | null): string => {
  if (minutes === null) return '--';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
};

// =============================================================================
// COMPONENT
// =============================================================================

const LeaderboardPage = () => {
  const [period, setPeriod] = useState<Period>('week');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async (selectedPeriod: Period) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/dashboard/leaderboard?period=${selectedPeriod}`);
      if (!res.ok) throw new Error('Failed to load leaderboard');

      const json = await res.json();
      // API returns { success, data: { leaderboard: [...] } }
      // Transform to match LeaderboardEntry type
      const rawEntries = json.data?.leaderboard ?? [];
      setEntries(
        rawEntries.map((e: { rank: number; user: { id: string; displayName: string; avatarUrl: string | null }; completed: number; points: number; avgResponseTime: number | null }) => ({
          rank: e.rank,
          userId: e.user.id,
          displayName: e.user.displayName,
          avatarUrl: e.user.avatarUrl,
          reviewsCompleted: e.completed,
          avgResponseTimeMinutes: e.avgResponseTime,
          points: e.points,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard(period);
  }, [period, fetchLeaderboard]);

  const handlePeriodChange = (newPeriod: Period) => {
    setPeriod(newPeriod);
  };

  // -------------------------------------------
  // Render
  // -------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header + period toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Leaderboard</h2>

        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          <button
            onClick={() => handlePeriodChange('week')}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              period === 'week'
                ? 'bg-slate-900 text-white'
                : 'text-gray-600 hover:text-gray-900',
            )}
          >
            This Week
          </button>
          <button
            onClick={() => handlePeriodChange('month')}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              period === 'month'
                ? 'bg-slate-900 text-white'
                : 'text-gray-600 hover:text-gray-900',
            )}
          >
            This Month
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-white shadow-sm" />
          ))}
        </div>
      ) : error !== null ? (
        /* Error state */
        <div className="flex flex-col items-center justify-center py-16">
          <svg className="h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="mt-4 text-lg font-medium text-gray-900">Failed to load leaderboard</p>
          <p className="mt-1 text-sm text-gray-500">{error}</p>
          <button
            onClick={() => fetchLeaderboard(period)}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        /* Empty state */
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-5.54 0" />
          </svg>
          <p className="mt-3 text-sm text-gray-500">No leaderboard data for this period</p>
        </div>
      ) : (
        /* Leaderboard table */
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-16 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Rank
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Reviewer
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Reviews
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Avg Response
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Points
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((entry) => (
                <tr
                  key={entry.userId}
                  className={cn(
                    'transition-colors hover:bg-gray-50',
                    entry.rank <= 3 && 'bg-amber-50/30',
                  )}
                >
                  {/* Rank */}
                  <td className="whitespace-nowrap px-4 py-3 text-center">
                    {entry.rank <= 3 ? (
                      <span className="text-lg">{RANK_MEDALS[entry.rank]}</span>
                    ) : (
                      <span className="text-sm font-medium text-gray-500">{entry.rank}</span>
                    )}
                  </td>

                  {/* User avatar + name */}
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-3">
                      {entry.avatarUrl !== null ? (
                        <img
                          src={entry.avatarUrl}
                          alt={entry.displayName}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-600">
                          {entry.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm font-medium text-gray-900">
                        {entry.displayName}
                      </span>
                    </div>
                  </td>

                  {/* Reviews completed */}
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-700">
                    {entry.reviewsCompleted}
                  </td>

                  {/* Avg response time */}
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-700">
                    {formatMinutes(entry.avgResponseTimeMinutes)}
                  </td>

                  {/* Points */}
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className="text-sm font-semibold text-gray-900">{entry.points}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LeaderboardPage;
