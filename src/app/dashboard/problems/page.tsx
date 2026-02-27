'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DashboardProblem, ProblemSeverity } from '@/types/dashboard';
import { cn } from '@/lib/utils';

// =============================================================================
// HELPERS
// =============================================================================

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

const SEVERITY_CONFIG: Record<ProblemSeverity, { label: string; iconColor: string; bgColor: string; textColor: string; animate: boolean }> = {
  WARNING: {
    label: 'Warning',
    iconColor: 'text-yellow-500',
    bgColor: 'bg-yellow-50 border-yellow-200',
    textColor: 'text-yellow-800',
    animate: false,
  },
  PROBLEM: {
    label: 'Problem',
    iconColor: 'text-red-500',
    bgColor: 'bg-red-50 border-red-200',
    textColor: 'text-red-800',
    animate: false,
  },
  CRITICAL: {
    label: 'Critical',
    iconColor: 'text-red-600',
    bgColor: 'bg-red-50 border-red-300',
    textColor: 'text-red-900',
    animate: true,
  },
};

// =============================================================================
// SEVERITY ICON
// =============================================================================

const SeverityIcon = ({ severity }: { severity: ProblemSeverity }) => {
  const config = SEVERITY_CONFIG[severity];

  return (
    <div className={cn('flex-shrink-0', config.animate && 'animate-pulse')}>
      {severity === 'WARNING' ? (
        <svg className={cn('h-5 w-5', config.iconColor)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      ) : (
        <svg className={cn('h-5 w-5', config.iconColor)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      )}
    </div>
  );
};

// =============================================================================
// COMPONENT
// =============================================================================

const ProblemsPage = () => {
  const [problems, setProblems] = useState<DashboardProblem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProblems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/dashboard/problems');
      if (!res.ok) throw new Error('Failed to load problems');

      const json = await res.json();
      // API returns { success, data: { problems: [...] } }
      // Transform to match DashboardProblem type
      const rawProblems = json.data?.problems ?? [];
      setProblems(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawProblems.map((p: any) => ({
          id: p.id,
          severity: p.severity ?? p.rule?.severity,
          ruleName: p.rule?.name ?? p.ruleName,
          ruleDescription: p.description ?? p.rule?.description ?? null,
          assignment: {
            id: p.assignment?.id,
            prTitle: p.assignment?.prTitle,
            prNumber: p.assignment?.prNumber,
            prUrl: p.assignment?.prUrl,
            repositoryFullName: p.assignment?.repository?.fullName ?? '',
            reviewer: p.assignment?.reviewer ?? null,
          },
          triggeredAt: p.triggeredAt,
          resolvedAt: p.resolvedAt ?? null,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProblems();
  }, [fetchProblems]);

  // -------------------------------------------
  // Render
  // -------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Active Problems</h2>
          <p className="mt-1 text-sm text-gray-500">
            Assignments that need attention based on configured rules
          </p>
        </div>
        {!isLoading && problems.length > 0 && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700">
            {problems.length} active
          </span>
        )}
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-white shadow-sm" />
          ))}
        </div>
      ) : error !== null ? (
        /* Error state */
        <div className="flex flex-col items-center justify-center py-16">
          <svg className="h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="mt-4 text-lg font-medium text-gray-900">Failed to load problems</p>
          <p className="mt-1 text-sm text-gray-500">{error}</p>
          <button
            onClick={fetchProblems}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      ) : problems.length === 0 ? (
        /* Empty state */
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <svg className="mx-auto h-10 w-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-gray-900">All clear</p>
          <p className="mt-1 text-sm text-gray-500">No active problems detected</p>
        </div>
      ) : (
        /* Problems list */
        <div className="space-y-3">
          {problems.map((problem) => {
            const severityConfig = SEVERITY_CONFIG[problem.severity];

            return (
              <div
                key={problem.id}
                className={cn(
                  'flex items-start gap-4 rounded-lg border px-5 py-4 transition-colors',
                  severityConfig.bgColor,
                )}
              >
                {/* Severity icon */}
                <SeverityIcon severity={problem.severity} />

                {/* Problem details */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-semibold', severityConfig.textColor)}>
                      {problem.ruleName}
                    </span>
                    <span className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      problem.severity === 'WARNING'
                        ? 'bg-yellow-100 text-yellow-700'
                        : problem.severity === 'PROBLEM'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-red-200 text-red-800',
                    )}>
                      {severityConfig.label}
                    </span>
                  </div>
                  {problem.ruleDescription !== null && (
                    <p className="mt-0.5 text-xs text-gray-600">{problem.ruleDescription}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    {/* PR link */}
                    <a
                      href={problem.assignment.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-600 hover:text-blue-800"
                    >
                      {problem.assignment.repositoryFullName}#{problem.assignment.prNumber}
                    </a>
                    {/* PR title */}
                    {problem.assignment.prTitle && (
                      <span className="truncate text-gray-600">
                        {problem.assignment.prTitle}
                      </span>
                    )}
                  </div>
                </div>

                {/* Reviewer */}
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  {problem.assignment.reviewer !== null ? (
                    <div className="flex items-center gap-2">
                      {problem.assignment.reviewer.avatarUrl !== null ? (
                        <img
                          src={problem.assignment.reviewer.avatarUrl}
                          alt={problem.assignment.reviewer.displayName}
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                          {problem.assignment.reviewer.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs text-gray-600">
                        {problem.assignment.reviewer.displayName}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs italic text-gray-400">No reviewer</span>
                  )}
                  <span className="text-xs text-gray-400">{timeAgo(problem.triggeredAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProblemsPage;
