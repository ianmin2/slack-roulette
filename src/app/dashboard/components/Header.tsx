'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DashboardUser } from '@/types/dashboard';
import { cn } from '@/lib/utils';

export const Header = () => {
  const router = useRouter();
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          setUser(null);
          return;
        }
        const json = await res.json();
        setUser((json.data?.user as DashboardUser) ?? null);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUser();
  }, []);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort logout; redirect regardless
    } finally {
      router.push('/dashboard/login');
    }
  }, [router]);

  const ROLE_BADGE_COLORS: Record<string, string> = {
    ADMIN: 'bg-red-100 text-red-700',
    TEAM_LEAD: 'bg-blue-100 text-blue-700',
    DEVELOPER: 'bg-green-100 text-green-700',
    VIEWER: 'bg-gray-100 text-gray-600',
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      {/* Left: Page title area */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-gray-900">PR Roulette</h1>
      </div>

      {/* Right: User info + logout */}
      <div className="flex items-center gap-4">
        {isLoading ? (
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
          </div>
        ) : user !== null ? (
          <div className="flex items-center gap-3">
            {/* Avatar */}
            {user.avatarUrl !== null ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-600">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Name + role badge */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">{user.displayName}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  ROLE_BADGE_COLORS[user.role] ?? 'bg-gray-100 text-gray-600',
                )}
              >
                {user.role}
              </span>
            </div>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="ml-2 rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
            >
              {isLoggingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        ) : (
          <a
            href="/dashboard/login"
            className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Sign in
          </a>
        )}
      </div>
    </header>
  );
};
