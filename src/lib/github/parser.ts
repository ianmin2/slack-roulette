/**
 * GitHub PR URL Parser
 *
 * Extracts owner, repo, and PR number from GitHub pull request URLs.
 * Supports various GitHub URL formats.
 */

export interface ParsedPRUrl {
  owner: string;
  repo: string;
  prNumber: number;
  fullName: string; // "owner/repo"
  url: string;
}

const PR_URL_PATTERNS = [
  // Standard format: https://github.com/owner/repo/pull/123
  /https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/,
  // With query params or hash: https://github.com/owner/repo/pull/123?diff=split
  /https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)[?#]?/,
] as const;

/**
 * Parse a single GitHub PR URL
 */
export const parsePRUrl = (url: string): ParsedPRUrl | null => {
  for (const pattern of PR_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      const [, owner, repo, prNumberStr] = match;
      const prNumber = parseInt(prNumberStr, 10);

      if (isNaN(prNumber)) continue;

      return {
        owner,
        repo,
        prNumber,
        fullName: `${owner}/${repo}`,
        url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      };
    }
  }
  return null;
};

/**
 * Extract all GitHub PR URLs from a text string
 */
export const extractPRUrls = (text: string): ParsedPRUrl[] => {
  const globalPattern = /https?:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/g;
  const matches = text.match(globalPattern) ?? [];

  const parsed: ParsedPRUrl[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const pr = parsePRUrl(match);
    if (pr && !seen.has(pr.url)) {
      seen.add(pr.url);
      parsed.push(pr);
    }
  }

  return parsed;
};

/**
 * Build a GitHub PR URL from components
 */
export const buildPRUrl = (owner: string, repo: string, prNumber: number): string =>
  `https://github.com/${owner}/${repo}/pull/${prNumber}`;
