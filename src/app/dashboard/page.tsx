'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DashboardAssignment,
  DashboardStats,
} from '@/types/dashboard';
import { StatCard } from '@/app/dashboard/components/StatCard';
import { StatusBadge } from '@/app/dashboard/components/StatusBadge';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Format an ISO timestamp to a human-readable "time ago" string.
 */
const timeAgo = (isoString: string): string => {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
};

/**
 * Format minutes into a readable string (e.g. "2h 15m" or "45m").
 */
const formatMinutes = (minutes: number): string => {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
};

// =============================================================================
// STAT ICONS (inline SVGs to avoid external dependencies)
// =============================================================================

const ReviewsIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
  </svg>
);

const ReviewersIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>
);

const ClockIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const PendingIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ProblemsIcon = () => (
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);

// =============================================================================
// COMPONENT
// =============================================================================

const DashboardPage = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [assignments, setAssignments] = useState<DashboardAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // -------------------------------------------
  // Initial data fetch
  // -------------------------------------------
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [statsRes, assignmentsRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/dashboard/assignments'),
      ]);

      if (!statsRes.ok || !assignmentsRes.ok) {
        throw new Error('Failed to load dashboard data');
      }

      const statsJson = await statsRes.json();
      const assignmentsJson = await assignmentsRes.json();

      setStats(statsJson.data as DashboardStats);
      // Transform nested API response to flat DashboardAssignment shape
      const rawAssignments = assignmentsJson.data?.assignments ?? [];
      setAssignments(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawAssignments.map((a: any) => ({
          ...a,
          repositoryFullName: a.repository?.fullName ?? a.repositoryFullName ?? '',
        })) as DashboardAssignment[]
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // -------------------------------------------
  // SSE real-time updates
  // -------------------------------------------
  useEffect(() => {
    const eventSource = new EventSource('/api/dashboard/events');
    eventSourceRef.current = eventSource;

    // Named event handlers (server sends `event: assignment_created\n`)
    const handleAssignmentEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as DashboardAssignment;
        setAssignments((prev) => {
          const existingIdx = prev.findIndex((a) => a.id === data.id);
          if (existingIdx !== -1) {
            const updated = [...prev];
            updated[existingIdx] = data;
            return updated;
          }
          return [data, ...prev];
        });
      } catch { /* ignore malformed */ }
    };

    const handleCompletedEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        setAssignments((prev) =>
          prev.map((a) => (a.id === data.id ? { ...a, status: data.status } : a))
        );
      } catch { /* ignore */ }
    };

    eventSource.addEventListener('assignment_created', handleAssignmentEvent);
    eventSource.addEventListener('assignment_completed', handleCompletedEvent);

    eventSource.onerror = () => {
      // EventSource will automatically reconnect
    };

    return () => {
      eventSource.removeEventListener('assignment_created', handleAssignmentEvent);
      eventSource.removeEventListener('assignment_completed', handleCompletedEvent);
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, []);

  // -------------------------------------------
  // Render: loading state
  // -------------------------------------------
  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Stat cards skeleton */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-white shadow-sm" />
          ))}
        </div>
        {/* Feed skeleton */}
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-white shadow-sm" />
          ))}
        </div>
      </div>
    );
  }

  // -------------------------------------------
  // Render: error state
  // -------------------------------------------
  if (error !== null) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <svg className="h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p className="mt-4 text-lg font-medium text-gray-900">Failed to load dashboard</p>
        <p className="mt-1 text-sm text-gray-500">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Retry
        </button>
      </div>
    );
  }

  // -------------------------------------------
  // Render: main content
  // -------------------------------------------
  return (
    <div className="space-y-6">
      {/* Stat cards */}
      {stats !== null && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Total Reviews"
            value={stats.totalReviews}
            icon={<ReviewsIcon />}
          />
          <StatCard
            label="Active Reviewers"
            value={stats.activeReviewers}
            icon={<ReviewersIcon />}
          />
          <StatCard
            label="Avg Response Time"
            value={formatMinutes(stats.avgResponseTimeMinutes)}
            icon={<ClockIcon />}
          />
          <StatCard
            label="Pending"
            value={stats.pendingAssignments}
            icon={<PendingIcon />}
          />
          <StatCard
            label="Problems"
            value={stats.activeProblems}
            icon={<ProblemsIcon />}
          />
        </div>
      )}

      {/* Live feed header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Live Feed</h2>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <span className="text-xs text-gray-500">Live</span>
        </div>
      </div>

      {/* Assignment list */}
      {assignments.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
          <p className="mt-3 text-sm text-gray-500">No assignments yet</p>
        </div>
      ) : (
        <div className="max-h-[calc(100vh-22rem)] space-y-3 overflow-y-auto">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm transition-colors hover:border-gray-300"
            >
              {/* PR info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <a
                    href={assignment.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-medium text-gray-900 hover:text-blue-600"
                  >
                    {assignment.prTitle ?? `PR #${assignment.prNumber}`}
                  </a>
                  <StatusBadge status={assignment.status} />
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                  <span className="font-medium text-gray-600">{assignment.repositoryFullName}</span>
                  <span>#{assignment.prNumber}</span>
                </div>
              </div>

              {/* Author */}
              <div className="flex flex-shrink-0 items-center gap-2">
                <div className="text-right">
                  <p className="text-xs text-gray-400">Author</p>
                  <p className="text-sm text-gray-700">{assignment.author.displayName}</p>
                </div>
                {assignment.author.avatarUrl !== null ? (
                  <img
                    src={assignment.author.avatarUrl}
                    alt={assignment.author.displayName}
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                    {assignment.author.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Arrow */}
              <svg className="h-4 w-4 flex-shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>

              {/* Reviewer */}
              <div className="flex flex-shrink-0 items-center gap-2">
                {assignment.reviewer !== null ? (
                  <>
                    {assignment.reviewer.avatarUrl !== null ? (
                      <img
                        src={assignment.reviewer.avatarUrl}
                        alt={assignment.reviewer.displayName}
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700">
                        {assignment.reviewer.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-gray-400">Reviewer</p>
                      <p className="text-sm text-gray-700">{assignment.reviewer.displayName}</p>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-yellow-100 text-xs text-yellow-600">
                      ?
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Reviewer</p>
                      <p className="text-sm italic text-gray-400">Unassigned</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Time ago */}
              <span className="w-16 flex-shrink-0 text-right text-xs text-gray-400">
                {timeAgo(assignment.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
