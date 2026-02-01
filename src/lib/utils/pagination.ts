/**
 * Pagination Utilities
 *
 * Provides cursor-based and offset-based pagination for API responses.
 * Supports Prisma integration for database queries.
 */

import { z } from 'zod';

// =============================================================================
// TYPES
// =============================================================================

export interface PaginationOptions {
  /** Page number (1-indexed) for offset pagination */
  page?: number;
  /** Number of items per page */
  limit?: number;
  /** Cursor for cursor-based pagination */
  cursor?: string;
  /** Sort field */
  sortBy?: string;
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    /** Total number of items (when available) */
    total?: number;
    /** Number of items per page */
    limit: number;
    /** Current page (1-indexed) for offset pagination */
    page?: number;
    /** Total number of pages (when total is available) */
    totalPages?: number;
    /** Whether there are more items */
    hasMore: boolean;
    /** Cursor for next page (cursor pagination) */
    nextCursor?: string;
    /** Cursor for previous page (cursor pagination) */
    prevCursor?: string;
  };
}

export interface CursorInfo {
  id: string;
  createdAt?: Date;
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const PAGINATION_DEFAULTS = {
  /** Default items per page */
  DEFAULT_LIMIT: 20,
  /** Maximum items per page */
  MAX_LIMIT: 100,
  /** Default page number */
  DEFAULT_PAGE: 1,
} as const;

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Zod schema for validating pagination query parameters
 */
export const PaginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().positive().optional()),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(
      z
        .number()
        .int()
        .positive()
        .max(PAGINATION_DEFAULTS.MAX_LIMIT)
        .optional()
    ),
  cursor: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Parse pagination options from request URL
 */
export const parsePaginationParams = (
  searchParams: URLSearchParams
): PaginationOptions => {
  const params = {
    page: searchParams.get('page') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    cursor: searchParams.get('cursor') ?? undefined,
    sortBy: searchParams.get('sortBy') ?? undefined,
    sortOrder: searchParams.get('sortOrder') ?? undefined,
  };

  const parsed = PaginationSchema.safeParse(params);
  if (!parsed.success) {
    return {
      page: PAGINATION_DEFAULTS.DEFAULT_PAGE,
      limit: PAGINATION_DEFAULTS.DEFAULT_LIMIT,
    };
  }

  // Apply defaults for missing values
  return {
    page: parsed.data.page ?? PAGINATION_DEFAULTS.DEFAULT_PAGE,
    limit: parsed.data.limit ?? PAGINATION_DEFAULTS.DEFAULT_LIMIT,
    cursor: parsed.data.cursor,
    sortBy: parsed.data.sortBy,
    sortOrder: parsed.data.sortOrder,
  };
};

/**
 * Normalize pagination options with defaults
 */
export const normalizePaginationOptions = (
  options: PaginationOptions
): Required<Omit<PaginationOptions, 'cursor' | 'sortBy'>> & {
  cursor?: string;
  sortBy?: string;
} => ({
  page: options.page ?? PAGINATION_DEFAULTS.DEFAULT_PAGE,
  limit: Math.min(
    options.limit ?? PAGINATION_DEFAULTS.DEFAULT_LIMIT,
    PAGINATION_DEFAULTS.MAX_LIMIT
  ),
  cursor: options.cursor,
  sortBy: options.sortBy,
  sortOrder: options.sortOrder ?? 'desc',
});

/**
 * Calculate offset for database query
 */
export const calculateOffset = (page: number, limit: number): number =>
  (page - 1) * limit;

/**
 * Calculate total pages
 */
export const calculateTotalPages = (total: number, limit: number): number =>
  Math.ceil(total / limit);

/**
 * Encode cursor for client
 */
export const encodeCursor = (info: CursorInfo): string =>
  Buffer.from(JSON.stringify(info)).toString('base64url');

/**
 * Decode cursor from client
 */
export const decodeCursor = (cursor: string): CursorInfo | null => {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as CursorInfo;
  } catch {
    return null;
  }
};

// =============================================================================
// PRISMA HELPERS
// =============================================================================

/**
 * Build Prisma query args for offset-based pagination
 */
export const buildOffsetPaginationArgs = (
  options: PaginationOptions,
  orderByField = 'createdAt'
): {
  skip: number;
  take: number;
  orderBy: Record<string, 'asc' | 'desc'>;
} => {
  const normalized = normalizePaginationOptions(options);

  return {
    skip: calculateOffset(normalized.page, normalized.limit),
    take: normalized.limit,
    orderBy: {
      [options.sortBy ?? orderByField]: normalized.sortOrder,
    },
  };
};

/**
 * Build Prisma query args for cursor-based pagination
 */
export const buildCursorPaginationArgs = (
  options: PaginationOptions,
  orderByField = 'createdAt'
): {
  take: number;
  skip?: number;
  cursor?: { id: string };
  orderBy: Record<string, 'asc' | 'desc'>;
} => {
  const normalized = normalizePaginationOptions(options);
  const cursorInfo = options.cursor ? decodeCursor(options.cursor) : null;

  return {
    take: normalized.limit + 1, // Fetch one extra to determine hasMore
    ...(cursorInfo && {
      skip: 1, // Skip the cursor item itself
      cursor: { id: cursorInfo.id },
    }),
    orderBy: {
      [options.sortBy ?? orderByField]: normalized.sortOrder,
    },
  };
};

// =============================================================================
// RESPONSE BUILDERS
// =============================================================================

/**
 * Build paginated response for offset-based pagination
 */
export const buildOffsetPaginatedResponse = <T>(
  data: T[],
  total: number,
  options: PaginationOptions
): PaginatedResult<T> => {
  const normalized = normalizePaginationOptions(options);
  const totalPages = calculateTotalPages(total, normalized.limit);

  return {
    data,
    pagination: {
      total,
      limit: normalized.limit,
      page: normalized.page,
      totalPages,
      hasMore: normalized.page < totalPages,
    },
  };
};

/**
 * Build paginated response for cursor-based pagination
 *
 * @param data Data array (should include one extra item if hasMore)
 * @param options Pagination options
 * @param getItemId Function to extract ID from item
 */
export const buildCursorPaginatedResponse = <T extends { id: string }>(
  data: T[],
  options: PaginationOptions,
  total?: number
): PaginatedResult<T> => {
  const normalized = normalizePaginationOptions(options);
  const hasMore = data.length > normalized.limit;

  // Remove the extra item we fetched to determine hasMore
  const items = hasMore ? data.slice(0, normalized.limit) : data;
  const lastItem = items[items.length - 1];
  const firstItem = items[0];

  return {
    data: items,
    pagination: {
      ...(total !== undefined && { total }),
      limit: normalized.limit,
      hasMore,
      ...(hasMore &&
        lastItem && {
          nextCursor: encodeCursor({ id: lastItem.id }),
        }),
      ...(options.cursor &&
        firstItem && {
          prevCursor: encodeCursor({ id: firstItem.id }),
        }),
    },
  };
};

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Paginate an in-memory array (useful for testing or small datasets)
 */
export const paginateArray = <T>(
  items: T[],
  options: PaginationOptions
): PaginatedResult<T> => {
  const normalized = normalizePaginationOptions(options);
  const offset = calculateOffset(normalized.page, normalized.limit);
  const paginatedItems = items.slice(offset, offset + normalized.limit);

  return buildOffsetPaginatedResponse(paginatedItems, items.length, options);
};

/**
 * Build URL query string for next page
 */
export const buildNextPageUrl = (
  baseUrl: string,
  pagination: PaginatedResult<unknown>['pagination']
): string | null => {
  if (!pagination.hasMore) return null;

  const url = new URL(baseUrl);

  if (pagination.nextCursor) {
    url.searchParams.set('cursor', pagination.nextCursor);
  } else if (pagination.page !== undefined) {
    url.searchParams.set('page', String(pagination.page + 1));
  }

  url.searchParams.set('limit', String(pagination.limit));

  return url.toString();
};

// =============================================================================
// EXPORTS
// =============================================================================

export const pagination = {
  parse: parsePaginationParams,
  normalize: normalizePaginationOptions,
  defaults: PAGINATION_DEFAULTS,
  schema: PaginationSchema,
  offset: {
    calculate: calculateOffset,
    buildArgs: buildOffsetPaginationArgs,
    buildResponse: buildOffsetPaginatedResponse,
  },
  cursor: {
    encode: encodeCursor,
    decode: decodeCursor,
    buildArgs: buildCursorPaginationArgs,
    buildResponse: buildCursorPaginatedResponse,
  },
  array: paginateArray,
  buildNextPageUrl,
};

export default pagination;
