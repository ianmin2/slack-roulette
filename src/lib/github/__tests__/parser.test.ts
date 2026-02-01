/**
 * GitHub Parser Tests
 *
 * Tests for PR URL parsing and extraction.
 */

import { parsePRUrl, extractPRUrls, buildPRUrl } from '../parser';

describe('parsePRUrl', () => {
  describe('valid URLs', () => {
    it('parses standard GitHub PR URL', () => {
      const result = parsePRUrl('https://github.com/owner/repo/pull/123');

      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
        fullName: 'owner/repo',
        url: 'https://github.com/owner/repo/pull/123',
      });
    });

    it('parses PR URL with http protocol', () => {
      const result = parsePRUrl('http://github.com/owner/repo/pull/456');

      expect(result).not.toBeNull();
      expect(result?.prNumber).toBe(456);
    });

    it('parses PR URL with query parameters', () => {
      const result = parsePRUrl('https://github.com/owner/repo/pull/789?diff=split');

      expect(result).not.toBeNull();
      expect(result?.prNumber).toBe(789);
    });

    it('parses PR URL with hash fragment', () => {
      const result = parsePRUrl('https://github.com/owner/repo/pull/111#discussion_r12345');

      expect(result).not.toBeNull();
      expect(result?.prNumber).toBe(111);
    });

    it('parses PR URL with complex owner/repo names', () => {
      const result = parsePRUrl('https://github.com/my-org-name/my-repo.js/pull/42');

      expect(result).toEqual({
        owner: 'my-org-name',
        repo: 'my-repo.js',
        prNumber: 42,
        fullName: 'my-org-name/my-repo.js',
        url: 'https://github.com/my-org-name/my-repo.js/pull/42',
      });
    });

    it('parses PR URL with large PR number', () => {
      const result = parsePRUrl('https://github.com/owner/repo/pull/99999');

      expect(result?.prNumber).toBe(99999);
    });
  });

  describe('invalid URLs', () => {
    it('returns null for non-PR GitHub URLs', () => {
      expect(parsePRUrl('https://github.com/owner/repo')).toBeNull();
      expect(parsePRUrl('https://github.com/owner/repo/issues/123')).toBeNull();
      expect(parsePRUrl('https://github.com/owner/repo/commit/abc123')).toBeNull();
    });

    it('returns null for non-GitHub URLs', () => {
      expect(parsePRUrl('https://gitlab.com/owner/repo/pull/123')).toBeNull();
      expect(parsePRUrl('https://bitbucket.org/owner/repo/pull/123')).toBeNull();
    });

    it('returns null for malformed URLs', () => {
      expect(parsePRUrl('not a url')).toBeNull();
      expect(parsePRUrl('')).toBeNull();
      expect(parsePRUrl('https://github.com')).toBeNull();
    });

    it('returns null for PR URL without number', () => {
      expect(parsePRUrl('https://github.com/owner/repo/pull/')).toBeNull();
      expect(parsePRUrl('https://github.com/owner/repo/pull/abc')).toBeNull();
    });
  });
});

describe('extractPRUrls', () => {
  describe('single URL extraction', () => {
    it('extracts single PR URL from text', () => {
      const text = 'Check out this PR: https://github.com/owner/repo/pull/123';
      const results = extractPRUrls(text);

      expect(results).toHaveLength(1);
      expect(results[0].prNumber).toBe(123);
    });

    it('extracts PR URL from beginning of text', () => {
      const text = 'https://github.com/owner/repo/pull/123 is ready for review';
      const results = extractPRUrls(text);

      expect(results).toHaveLength(1);
    });

    it('extracts PR URL from end of text', () => {
      const text = 'Please review https://github.com/owner/repo/pull/123';
      const results = extractPRUrls(text);

      expect(results).toHaveLength(1);
    });
  });

  describe('multiple URL extraction', () => {
    it('extracts multiple different PR URLs', () => {
      const text = `
        First PR: https://github.com/owner/repo/pull/1
        Second PR: https://github.com/owner/repo/pull/2
        Third PR: https://github.com/other/project/pull/99
      `;
      const results = extractPRUrls(text);

      expect(results).toHaveLength(3);
      expect(results.map(r => r.prNumber)).toEqual([1, 2, 99]);
    });

    it('deduplicates identical PR URLs', () => {
      const text = `
        https://github.com/owner/repo/pull/123
        Check again: https://github.com/owner/repo/pull/123
        Once more: https://github.com/owner/repo/pull/123
      `;
      const results = extractPRUrls(text);

      expect(results).toHaveLength(1);
    });

    it('handles URLs with different query params as same PR', () => {
      const text = `
        https://github.com/owner/repo/pull/123
        https://github.com/owner/repo/pull/123?diff=unified
      `;
      const results = extractPRUrls(text);

      // Should deduplicate based on canonical URL
      expect(results).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for text with no URLs', () => {
      const text = 'No URLs here, just regular text about pull requests.';
      const results = extractPRUrls(text);

      expect(results).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(extractPRUrls('')).toEqual([]);
    });

    it('ignores non-PR GitHub URLs in text', () => {
      const text = `
        Repo: https://github.com/owner/repo
        Issue: https://github.com/owner/repo/issues/123
        PR: https://github.com/owner/repo/pull/456
      `;
      const results = extractPRUrls(text);

      expect(results).toHaveLength(1);
      expect(results[0].prNumber).toBe(456);
    });

    it('handles Slack message formatting', () => {
      // Slack sometimes adds angle brackets around URLs
      const text = 'Check out <https://github.com/owner/repo/pull/123|this PR>';
      const results = extractPRUrls(text);

      expect(results).toHaveLength(1);
    });
  });
});

describe('buildPRUrl', () => {
  it('builds correct URL from components', () => {
    expect(buildPRUrl('owner', 'repo', 123)).toBe(
      'https://github.com/owner/repo/pull/123'
    );
  });

  it('handles special characters in owner/repo', () => {
    expect(buildPRUrl('my-org', 'my-repo.js', 42)).toBe(
      'https://github.com/my-org/my-repo.js/pull/42'
    );
  });
});
