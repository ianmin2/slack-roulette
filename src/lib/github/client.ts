/**
 * GitHub API Client
 *
 * Provides typed access to GitHub REST API for PR operations.
 * Uses native fetch - no SDK required.
 */

import { loggers } from '@/lib/utils/logger';

const log = loggers.github;
const GITHUB_API_BASE = 'https://api.github.com';

interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  email?: string;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  user: GitHubUser;
  html_url: string;
  body: string | null;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable: boolean | null;
  merged: boolean;
  draft: boolean;
  labels: Array<{ name: string; color: string }>;
  requested_reviewers: GitHubUser[];
  created_at: string;
  updated_at: string;
}

interface GitHubFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface GitHubError {
  message: string;
  documentation_url?: string;
}

const getToken = (): string | null => {
  // For now, use a personal access token from env
  // Later: use GitHub App installation tokens
  return process.env.GITHUB_TOKEN ?? null;
};

/**
 * Make an authenticated request to GitHub API
 */
const githubRequest = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: string | null }> => {
  const token = getToken();

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'PR-Roulette-Bot',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error: GitHubError = await response.json();
      log.error('GitHub API error', { status: response.status, message: error.message, endpoint });
      return { data: null, error: error.message };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('GitHub API request failed', { endpoint, message });
    return { data: null, error: message };
  }
};

/**
 * Get pull request details
 */
export const getPullRequest = async (
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubPullRequest | null> => {
  const { data, error } = await githubRequest<GitHubPullRequest>(
    `/repos/${owner}/${repo}/pulls/${prNumber}`
  );

  if (error) {
    log.error('Failed to get PR', { owner, repo, prNumber, error });
    return null;
  }

  return data;
};

/**
 * Get files changed in a pull request
 */
export const getPullRequestFiles = async (
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubFile[]> => {
  const { data, error } = await githubRequest<GitHubFile[]>(
    `/repos/${owner}/${repo}/pulls/${prNumber}/files`
  );

  if (error || !data) {
    log.error('Failed to get PR files', { owner, repo, prNumber, error });
    return [];
  }

  return data;
};

/**
 * Add a reviewer to a pull request
 */
export const addReviewer = async (
  owner: string,
  repo: string,
  prNumber: number,
  reviewers: string[]
): Promise<boolean> => {
  const { error } = await githubRequest(
    `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
    {
      method: 'POST',
      body: JSON.stringify({ reviewers }),
    }
  );

  if (error) {
    log.error('Failed to add reviewers', { owner, repo, prNumber, reviewers, error });
    return false;
  }

  return true;
};

/**
 * Add labels to a pull request
 */
export const addLabels = async (
  owner: string,
  repo: string,
  prNumber: number,
  labels: string[]
): Promise<boolean> => {
  const { error } = await githubRequest(
    `/repos/${owner}/${repo}/issues/${prNumber}/labels`,
    {
      method: 'POST',
      body: JSON.stringify({ labels }),
    }
  );

  if (error) {
    log.error('Failed to add labels', { owner, repo, prNumber, labels, error });
    return false;
  }

  return true;
};

/**
 * Post a comment on a pull request
 */
export const postComment = async (
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<boolean> => {
  const { error } = await githubRequest(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    }
  );

  if (error) {
    log.error('Failed to post comment', { owner, repo, prNumber, error });
    return false;
  }

  return true;
};

/**
 * Find GitHub user by email
 */
export const findUserByEmail = async (email: string): Promise<GitHubUser | null> => {
  const { data, error } = await githubRequest<{ items: GitHubUser[] }>(
    `/search/users?q=${encodeURIComponent(email)}+in:email`
  );

  if (error || !data || data.items.length === 0) {
    return null;
  }

  return data.items[0];
};

export type { GitHubPullRequest, GitHubFile, GitHubUser };
