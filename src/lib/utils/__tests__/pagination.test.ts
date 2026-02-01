/**
 * Tests for Pagination Utilities
 */

import {
  parsePaginationParams,
  normalizePaginationOptions,
  calculateOffset,
  calculateTotalPages,
  encodeCursor,
  decodeCursor,
  buildOffsetPaginationArgs,
  buildCursorPaginationArgs,
  buildOffsetPaginatedResponse,
  buildCursorPaginatedResponse,
  paginateArray,
  buildNextPageUrl,
  PAGINATION_DEFAULTS,
  PaginationSchema,
} from '../pagination';

describe('Pagination Utilities', () => {
  describe('parsePaginationParams', () => {
    it('parses valid page and limit', () => {
      const params = new URLSearchParams('page=2&limit=25');
      const result = parsePaginationParams(params);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(25);
    });

    it('parses cursor parameter', () => {
      const params = new URLSearchParams('cursor=abc123&limit=10');
      const result = parsePaginationParams(params);

      expect(result.cursor).toBe('abc123');
      expect(result.limit).toBe(10);
    });

    it('parses sort parameters', () => {
      const params = new URLSearchParams('sortBy=createdAt&sortOrder=asc');
      const result = parsePaginationParams(params);

      expect(result.sortBy).toBe('createdAt');
      expect(result.sortOrder).toBe('asc');
    });

    it('returns defaults for empty params', () => {
      const params = new URLSearchParams('');
      const result = parsePaginationParams(params);

      expect(result.page).toBe(PAGINATION_DEFAULTS.DEFAULT_PAGE);
      expect(result.limit).toBe(PAGINATION_DEFAULTS.DEFAULT_LIMIT);
    });

    it('returns defaults for invalid values', () => {
      const params = new URLSearchParams('page=invalid&limit=-5');
      const result = parsePaginationParams(params);

      expect(result.page).toBe(PAGINATION_DEFAULTS.DEFAULT_PAGE);
      expect(result.limit).toBe(PAGINATION_DEFAULTS.DEFAULT_LIMIT);
    });
  });

  describe('normalizePaginationOptions', () => {
    it('applies defaults for missing options', () => {
      const result = normalizePaginationOptions({});

      expect(result.page).toBe(PAGINATION_DEFAULTS.DEFAULT_PAGE);
      expect(result.limit).toBe(PAGINATION_DEFAULTS.DEFAULT_LIMIT);
      expect(result.sortOrder).toBe('desc');
    });

    it('preserves provided options', () => {
      const result = normalizePaginationOptions({
        page: 3,
        limit: 50,
        sortOrder: 'asc',
      });

      expect(result.page).toBe(3);
      expect(result.limit).toBe(50);
      expect(result.sortOrder).toBe('asc');
    });

    it('caps limit at maximum', () => {
      const result = normalizePaginationOptions({ limit: 500 });

      expect(result.limit).toBe(PAGINATION_DEFAULTS.MAX_LIMIT);
    });
  });

  describe('calculateOffset', () => {
    it('calculates offset for page 1', () => {
      expect(calculateOffset(1, 20)).toBe(0);
    });

    it('calculates offset for page 2', () => {
      expect(calculateOffset(2, 20)).toBe(20);
    });

    it('calculates offset for page 5 with limit 10', () => {
      expect(calculateOffset(5, 10)).toBe(40);
    });
  });

  describe('calculateTotalPages', () => {
    it('calculates total pages exactly divisible', () => {
      expect(calculateTotalPages(100, 20)).toBe(5);
    });

    it('rounds up for remainder', () => {
      expect(calculateTotalPages(101, 20)).toBe(6);
    });

    it('returns 1 for items less than limit', () => {
      expect(calculateTotalPages(5, 20)).toBe(1);
    });

    it('returns 0 for empty dataset', () => {
      expect(calculateTotalPages(0, 20)).toBe(0);
    });
  });

  describe('cursor encoding/decoding', () => {
    it('encodes and decodes cursor correctly', () => {
      const original = { id: 'item-123' };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(original);
    });

    it('handles cursor with createdAt', () => {
      const date = new Date('2026-01-15T10:00:00Z');
      const original = { id: 'item-456', createdAt: date };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded?.id).toBe('item-456');
    });

    it('returns null for invalid cursor', () => {
      expect(decodeCursor('invalid-base64!')).toBeNull();
    });

    it('returns null for non-JSON cursor', () => {
      const notJson = Buffer.from('not json').toString('base64url');
      expect(decodeCursor(notJson)).toBeNull();
    });
  });

  describe('buildOffsetPaginationArgs', () => {
    it('builds correct Prisma args', () => {
      const result = buildOffsetPaginationArgs({ page: 2, limit: 25 });

      expect(result.skip).toBe(25);
      expect(result.take).toBe(25);
      expect(result.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('uses custom orderBy field', () => {
      const result = buildOffsetPaginationArgs({ page: 1, limit: 10 }, 'updatedAt');

      expect(result.orderBy).toEqual({ updatedAt: 'desc' });
    });

    it('respects sortBy option', () => {
      const result = buildOffsetPaginationArgs({
        page: 1,
        limit: 10,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(result.orderBy).toEqual({ name: 'asc' });
    });
  });

  describe('buildCursorPaginationArgs', () => {
    it('builds args without cursor', () => {
      const result = buildCursorPaginationArgs({ limit: 20 });

      expect(result.take).toBe(21); // One extra for hasMore check
      expect(result.cursor).toBeUndefined();
      expect(result.skip).toBeUndefined();
    });

    it('builds args with cursor', () => {
      const cursor = encodeCursor({ id: 'item-100' });
      const result = buildCursorPaginationArgs({ cursor, limit: 20 });

      expect(result.take).toBe(21);
      expect(result.cursor).toEqual({ id: 'item-100' });
      expect(result.skip).toBe(1);
    });

    it('uses custom orderBy', () => {
      const result = buildCursorPaginationArgs(
        { limit: 10, sortOrder: 'asc' },
        'score'
      );

      expect(result.orderBy).toEqual({ score: 'asc' });
    });
  });

  describe('buildOffsetPaginatedResponse', () => {
    it('builds correct response for first page', () => {
      const data = [{ id: '1' }, { id: '2' }];
      const result = buildOffsetPaginatedResponse(data, 50, { page: 1, limit: 20 });

      expect(result.data).toBe(data);
      expect(result.pagination.total).toBe(50);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasMore).toBe(true);
    });

    it('builds correct response for last page', () => {
      const data = [{ id: '1' }];
      const result = buildOffsetPaginatedResponse(data, 41, { page: 3, limit: 20 });

      expect(result.pagination.page).toBe(3);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('handles single page result', () => {
      const data = [{ id: '1' }, { id: '2' }];
      const result = buildOffsetPaginatedResponse(data, 2, { page: 1, limit: 20 });

      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe('buildCursorPaginatedResponse', () => {
    it('builds response without cursor (first page)', () => {
      const data = [
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
        { id: '3', name: 'c' }, // Extra item indicating hasMore
      ];
      const result = buildCursorPaginatedResponse(data, { limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBeDefined();
    });

    it('builds response for last page', () => {
      const data = [
        { id: '4', name: 'd' },
        { id: '5', name: 'e' },
      ];
      const result = buildCursorPaginatedResponse(data, { limit: 3 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.nextCursor).toBeUndefined();
    });

    it('includes prevCursor when cursor provided', () => {
      const cursor = encodeCursor({ id: 'prev-item' });
      const data = [
        { id: '4', name: 'd' },
        { id: '5', name: 'e' },
      ];
      const result = buildCursorPaginatedResponse(data, { cursor, limit: 3 });

      expect(result.pagination.prevCursor).toBeDefined();
    });

    it('includes total when provided', () => {
      const data = [{ id: '1', name: 'a' }];
      const result = buildCursorPaginatedResponse(data, { limit: 10 }, 100);

      expect(result.pagination.total).toBe(100);
    });
  });

  describe('paginateArray', () => {
    const items = Array.from({ length: 55 }, (_, i) => ({ id: String(i + 1) }));

    it('paginates first page correctly', () => {
      const result = paginateArray(items, { page: 1, limit: 20 });

      expect(result.data).toHaveLength(20);
      expect(result.data[0].id).toBe('1');
      expect(result.pagination.hasMore).toBe(true);
    });

    it('paginates middle page correctly', () => {
      const result = paginateArray(items, { page: 2, limit: 20 });

      expect(result.data).toHaveLength(20);
      expect(result.data[0].id).toBe('21');
      expect(result.pagination.hasMore).toBe(true);
    });

    it('paginates last page correctly', () => {
      const result = paginateArray(items, { page: 3, limit: 20 });

      expect(result.data).toHaveLength(15);
      expect(result.data[0].id).toBe('41');
      expect(result.pagination.hasMore).toBe(false);
    });

    it('returns empty for page beyond data', () => {
      const result = paginateArray(items, { page: 10, limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe('buildNextPageUrl', () => {
    it('builds URL for offset pagination', () => {
      const pagination = {
        page: 2,
        limit: 20,
        hasMore: true,
      };
      const result = buildNextPageUrl('https://api.example.com/items', pagination);

      expect(result).toBe('https://api.example.com/items?page=3&limit=20');
    });

    it('builds URL for cursor pagination', () => {
      const pagination = {
        limit: 20,
        hasMore: true,
        nextCursor: 'abc123',
      };
      const result = buildNextPageUrl('https://api.example.com/items', pagination);

      expect(result).toBe('https://api.example.com/items?cursor=abc123&limit=20');
    });

    it('returns null when no more pages', () => {
      const pagination = {
        page: 5,
        limit: 20,
        hasMore: false,
      };
      const result = buildNextPageUrl('https://api.example.com/items', pagination);

      expect(result).toBeNull();
    });
  });

  describe('PaginationSchema', () => {
    it('validates correct input', () => {
      const result = PaginationSchema.safeParse({
        page: '2',
        limit: '25',
        sortOrder: 'asc',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(25);
        expect(result.data.sortOrder).toBe('asc');
      }
    });

    it('rejects limit above maximum', () => {
      const result = PaginationSchema.safeParse({
        limit: '500',
      });

      expect(result.success).toBe(false);
    });

    it('rejects negative page', () => {
      const result = PaginationSchema.safeParse({
        page: '-1',
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid sortOrder', () => {
      const result = PaginationSchema.safeParse({
        sortOrder: 'random',
      });

      expect(result.success).toBe(false);
    });
  });
});
