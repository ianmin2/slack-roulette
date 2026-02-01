/**
 * Token Rotation Strategy
 *
 * Manages secure token generation, rotation, and revocation for API keys,
 * webhook secrets, and integration tokens.
 */

import crypto from 'crypto';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('tokens');

// =============================================================================
// TYPES
// =============================================================================

export type TokenType = 'api_key' | 'webhook_secret' | 'integration_token' | 'refresh_token';

export interface Token {
  id: string;
  type: TokenType;
  value: string;
  hashedValue: string;
  name: string;
  ownerId: string;
  ownerType: 'user' | 'workspace' | 'system';
  scopes: string[];
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  rotatedAt: Date | null;
  previousTokenId: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  metadata?: Record<string, unknown>;
}

export interface TokenCreateOptions {
  type: TokenType;
  name: string;
  ownerId: string;
  ownerType: 'user' | 'workspace' | 'system';
  scopes?: string[];
  expiresInDays?: number;
  metadata?: Record<string, unknown>;
}

export interface TokenRotateOptions {
  gracePeriodMs?: number;
  revokeOld?: boolean;
}

export interface TokenValidationResult {
  valid: boolean;
  token?: Token;
  reason?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const TOKEN_PREFIXES: Record<TokenType, string> = {
  api_key: 'prr_ak_',
  webhook_secret: 'prr_ws_',
  integration_token: 'prr_it_',
  refresh_token: 'prr_rt_',
};

const DEFAULT_EXPIRY_DAYS: Record<TokenType, number | null> = {
  api_key: 365,
  webhook_secret: null, // No expiry
  integration_token: 90,
  refresh_token: 30,
};

const TOKEN_LENGTH = 32; // 256 bits

// =============================================================================
// TOKEN MANAGER
// =============================================================================

class TokenManager {
  private tokens = new Map<string, Token>();
  private tokensByHash = new Map<string, Token>();
  private tokenIdCounter = 0;

  /**
   * Generate a secure random token
   */
  generateTokenValue(type: TokenType): string {
    const prefix = TOKEN_PREFIXES[type];
    const randomBytes = crypto.randomBytes(TOKEN_LENGTH);
    const tokenValue = randomBytes.toString('base64url');
    return `${prefix}${tokenValue}`;
  }

  /**
   * Hash a token value for secure storage
   */
  hashToken(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  /**
   * Create a new token
   */
  create(options: TokenCreateOptions): { token: Token; plainValue: string } {
    const {
      type,
      name,
      ownerId,
      ownerType,
      scopes = [],
      expiresInDays = DEFAULT_EXPIRY_DAYS[type],
      metadata,
    } = options;

    const plainValue = this.generateTokenValue(type);
    const hashedValue = this.hashToken(plainValue);
    const now = new Date();

    const token: Token = {
      id: `tok_${Date.now()}_${++this.tokenIdCounter}`,
      type,
      value: this.maskToken(plainValue),
      hashedValue,
      name,
      ownerId,
      ownerType,
      scopes,
      createdAt: now,
      expiresAt: expiresInDays ? new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000) : null,
      lastUsedAt: null,
      rotatedAt: null,
      previousTokenId: null,
      revokedAt: null,
      revokedBy: null,
      metadata,
    };

    this.tokens.set(token.id, token);
    this.tokensByHash.set(hashedValue, token);

    log.info('Token created', {
      id: token.id,
      type,
      name,
      ownerId,
      ownerType,
      expiresAt: token.expiresAt?.toISOString(),
    });

    return { token, plainValue };
  }

  /**
   * Mask a token value for display (show only prefix and last 4 chars)
   */
  maskToken(value: string): string {
    if (value.length <= 12) return '***';
    return `${value.slice(0, 8)}...${value.slice(-4)}`;
  }

  /**
   * Validate a token
   */
  validate(plainValue: string, requiredScopes?: string[]): TokenValidationResult {
    const hashedValue = this.hashToken(plainValue);
    const token = this.tokensByHash.get(hashedValue);

    if (!token) {
      return { valid: false, reason: 'Token not found' };
    }

    if (token.revokedAt) {
      return { valid: false, reason: 'Token has been revoked', token };
    }

    if (token.expiresAt && token.expiresAt < new Date()) {
      return { valid: false, reason: 'Token has expired', token };
    }

    if (requiredScopes && requiredScopes.length > 0) {
      const hasAllScopes = requiredScopes.every((scope) => token.scopes.includes(scope));
      if (!hasAllScopes) {
        return { valid: false, reason: 'Insufficient scopes', token };
      }
    }

    // Update last used time
    token.lastUsedAt = new Date();

    return { valid: true, token };
  }

  /**
   * Rotate a token (create new, optionally revoke old)
   */
  rotate(
    tokenId: string,
    options: TokenRotateOptions = {}
  ): { newToken: Token; plainValue: string } | null {
    const { gracePeriodMs = 0, revokeOld = true } = options;
    const oldToken = this.tokens.get(tokenId);

    if (!oldToken) {
      log.warn('Cannot rotate non-existent token', { tokenId });
      return null;
    }

    if (oldToken.revokedAt) {
      log.warn('Cannot rotate revoked token', { tokenId });
      return null;
    }

    // Create new token with same properties
    const { token: newToken, plainValue } = this.create({
      type: oldToken.type,
      name: oldToken.name,
      ownerId: oldToken.ownerId,
      ownerType: oldToken.ownerType,
      scopes: oldToken.scopes,
      expiresInDays: oldToken.expiresAt
        ? Math.ceil((oldToken.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : undefined,
      metadata: oldToken.metadata,
    });

    // Link to previous token
    newToken.previousTokenId = oldToken.id;
    newToken.rotatedAt = new Date();

    // Handle old token
    if (revokeOld) {
      if (gracePeriodMs > 0) {
        // Schedule revocation after grace period
        setTimeout(() => {
          this.revoke(oldToken.id, 'system:rotation');
        }, gracePeriodMs);

        log.info('Token rotation scheduled', {
          oldTokenId: oldToken.id,
          newTokenId: newToken.id,
          gracePeriodMs,
        });
      } else {
        this.revoke(oldToken.id, 'system:rotation');
      }
    }

    log.info('Token rotated', {
      oldTokenId: oldToken.id,
      newTokenId: newToken.id,
      revokeOld,
    });

    return { newToken, plainValue };
  }

  /**
   * Revoke a token
   */
  revoke(tokenId: string, revokedBy: string): boolean {
    const token = this.tokens.get(tokenId);

    if (!token) {
      return false;
    }

    if (token.revokedAt) {
      return false; // Already revoked
    }

    token.revokedAt = new Date();
    token.revokedBy = revokedBy;

    log.info('Token revoked', { tokenId, revokedBy });

    return true;
  }

  /**
   * Revoke all tokens for an owner
   */
  revokeAllForOwner(ownerId: string, revokedBy: string): number {
    let count = 0;

    for (const token of this.tokens.values()) {
      if (token.ownerId === ownerId && !token.revokedAt) {
        this.revoke(token.id, revokedBy);
        count++;
      }
    }

    log.info('Revoked all tokens for owner', { ownerId, count, revokedBy });

    return count;
  }

  /**
   * Get a token by ID
   */
  get(tokenId: string): Token | undefined {
    return this.tokens.get(tokenId);
  }

  /**
   * Get all tokens for an owner
   */
  getByOwner(ownerId: string, includeRevoked = false): Token[] {
    return Array.from(this.tokens.values()).filter(
      (t) => t.ownerId === ownerId && (includeRevoked || !t.revokedAt)
    );
  }

  /**
   * Get tokens by type
   */
  getByType(type: TokenType, includeRevoked = false): Token[] {
    return Array.from(this.tokens.values()).filter(
      (t) => t.type === type && (includeRevoked || !t.revokedAt)
    );
  }

  /**
   * Get tokens expiring soon
   */
  getExpiringSoon(withinDays: number): Token[] {
    const threshold = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

    return Array.from(this.tokens.values()).filter(
      (t) => !t.revokedAt && t.expiresAt && t.expiresAt <= threshold
    );
  }

  /**
   * Clean up expired and old revoked tokens
   */
  cleanup(revokedOlderThanDays = 30): number {
    const cutoff = new Date(Date.now() - revokedOlderThanDays * 24 * 60 * 60 * 1000);
    let removed = 0;

    for (const [id, token] of this.tokens.entries()) {
      // Remove revoked tokens older than cutoff
      if (token.revokedAt && token.revokedAt < cutoff) {
        this.tokens.delete(id);
        this.tokensByHash.delete(token.hashedValue);
        removed++;
        continue;
      }

      // Remove expired tokens (older than cutoff)
      if (token.expiresAt && token.expiresAt < cutoff) {
        this.tokens.delete(id);
        this.tokensByHash.delete(token.hashedValue);
        removed++;
      }
    }

    if (removed > 0) {
      log.info('Token cleanup completed', { removed });
    }

    return removed;
  }

  /**
   * Get token statistics
   */
  getStats(): {
    total: number;
    active: number;
    revoked: number;
    expired: number;
    byType: Record<TokenType, number>;
  } {
    const now = new Date();
    const tokens = Array.from(this.tokens.values());
    const byType: Record<TokenType, number> = {
      api_key: 0,
      webhook_secret: 0,
      integration_token: 0,
      refresh_token: 0,
    };

    let active = 0;
    let revoked = 0;
    let expired = 0;

    for (const token of tokens) {
      byType[token.type]++;

      if (token.revokedAt) {
        revoked++;
      } else if (token.expiresAt && token.expiresAt < now) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      total: tokens.length,
      active,
      revoked,
      expired,
      byType,
    };
  }

  /**
   * Reset for testing
   */
  reset(): void {
    this.tokens.clear();
    this.tokensByHash.clear();
    this.tokenIdCounter = 0;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const tokenManager = new TokenManager();

// =============================================================================
// EXPORTS
// =============================================================================

export const tokens = {
  create: tokenManager.create.bind(tokenManager),
  validate: tokenManager.validate.bind(tokenManager),
  rotate: tokenManager.rotate.bind(tokenManager),
  revoke: tokenManager.revoke.bind(tokenManager),
  revokeAllForOwner: tokenManager.revokeAllForOwner.bind(tokenManager),
  get: tokenManager.get.bind(tokenManager),
  getByOwner: tokenManager.getByOwner.bind(tokenManager),
  getByType: tokenManager.getByType.bind(tokenManager),
  getExpiringSoon: tokenManager.getExpiringSoon.bind(tokenManager),
  cleanup: tokenManager.cleanup.bind(tokenManager),
  getStats: tokenManager.getStats.bind(tokenManager),
  hashToken: tokenManager.hashToken.bind(tokenManager),
  maskToken: tokenManager.maskToken.bind(tokenManager),
  reset: tokenManager.reset.bind(tokenManager),
};

export default tokens;
