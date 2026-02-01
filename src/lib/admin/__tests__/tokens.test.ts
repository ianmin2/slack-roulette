/**
 * Tests for Token Rotation Strategy
 */

import { tokens, tokenManager } from '../tokens';

describe('Token Management', () => {
  beforeEach(() => {
    tokens.reset();
  });

  describe('create', () => {
    it('creates a token with correct properties', () => {
      const { token, plainValue } = tokens.create({
        type: 'api_key',
        name: 'Test API Key',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      expect(token.id).toMatch(/^tok_\d+_\d+$/);
      expect(token.type).toBe('api_key');
      expect(token.name).toBe('Test API Key');
      expect(token.ownerId).toBe('user-1');
      expect(token.ownerType).toBe('user');
      expect(token.createdAt).toBeInstanceOf(Date);
      expect(token.revokedAt).toBeNull();
    });

    it('generates token with correct prefix', () => {
      const { plainValue: apiKey } = tokens.create({
        type: 'api_key',
        name: 'API Key',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      const { plainValue: webhookSecret } = tokens.create({
        type: 'webhook_secret',
        name: 'Webhook',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      expect(apiKey).toMatch(/^prr_ak_/);
      expect(webhookSecret).toMatch(/^prr_ws_/);
    });

    it('masks token value for storage', () => {
      const { token, plainValue } = tokens.create({
        type: 'api_key',
        name: 'Test',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      expect(token.value).not.toBe(plainValue);
      expect(token.value).toContain('...'); // Masked format: first8...last4
      expect(token.value.length).toBeLessThan(plainValue.length);
    });

    it('sets expiry based on token type', () => {
      const { token: apiKey } = tokens.create({
        type: 'api_key',
        name: 'API Key',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      const { token: webhookSecret } = tokens.create({
        type: 'webhook_secret',
        name: 'Webhook',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      expect(apiKey.expiresAt).not.toBeNull();
      expect(webhookSecret.expiresAt).toBeNull(); // No expiry for webhook secrets
    });

    it('allows custom expiry', () => {
      const { token } = tokens.create({
        type: 'api_key',
        name: 'Short-lived key',
        ownerId: 'user-1',
        ownerType: 'user',
        expiresInDays: 7,
      });

      const expectedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const diff = Math.abs(token.expiresAt!.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(1000); // Within 1 second
    });

    it('stores scopes', () => {
      const { token } = tokens.create({
        type: 'api_key',
        name: 'Scoped key',
        ownerId: 'user-1',
        ownerType: 'user',
        scopes: ['read:users', 'write:assignments'],
      });

      expect(token.scopes).toEqual(['read:users', 'write:assignments']);
    });

    it('stores metadata', () => {
      const { token } = tokens.create({
        type: 'api_key',
        name: 'With metadata',
        ownerId: 'user-1',
        ownerType: 'user',
        metadata: { description: 'CI/CD token', environment: 'production' },
      });

      expect(token.metadata).toEqual({
        description: 'CI/CD token',
        environment: 'production',
      });
    });
  });

  describe('validate', () => {
    it('validates a valid token', () => {
      const { plainValue } = tokens.create({
        type: 'api_key',
        name: 'Valid key',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      const result = tokens.validate(plainValue);

      expect(result.valid).toBe(true);
      expect(result.token).toBeDefined();
    });

    it('rejects non-existent token', () => {
      const result = tokens.validate('prr_ak_nonexistent123456789');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token not found');
    });

    it('rejects revoked token', () => {
      const { token, plainValue } = tokens.create({
        type: 'api_key',
        name: 'To revoke',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      tokens.revoke(token.id, 'admin');
      const result = tokens.validate(plainValue);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token has been revoked');
    });

    it('rejects expired token', () => {
      const { token, plainValue } = tokens.create({
        type: 'api_key',
        name: 'Expired',
        ownerId: 'user-1',
        ownerType: 'user',
        expiresInDays: -1, // Already expired
      });

      const result = tokens.validate(plainValue);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token has expired');
    });

    it('validates required scopes', () => {
      const { plainValue } = tokens.create({
        type: 'api_key',
        name: 'Scoped',
        ownerId: 'user-1',
        ownerType: 'user',
        scopes: ['read:users'],
      });

      const validResult = tokens.validate(plainValue, ['read:users']);
      expect(validResult.valid).toBe(true);

      const invalidResult = tokens.validate(plainValue, ['write:users']);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.reason).toBe('Insufficient scopes');
    });

    it('updates lastUsedAt on validation', () => {
      const { token, plainValue } = tokens.create({
        type: 'api_key',
        name: 'Track usage',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      expect(token.lastUsedAt).toBeNull();

      tokens.validate(plainValue);

      expect(token.lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe('rotate', () => {
    it('creates new token with same properties', () => {
      const { token: oldToken } = tokens.create({
        type: 'api_key',
        name: 'To rotate',
        ownerId: 'user-1',
        ownerType: 'user',
        scopes: ['read:all'],
      });

      const result = tokens.rotate(oldToken.id);

      expect(result).not.toBeNull();
      expect(result!.newToken.type).toBe(oldToken.type);
      expect(result!.newToken.name).toBe(oldToken.name);
      expect(result!.newToken.ownerId).toBe(oldToken.ownerId);
      expect(result!.newToken.scopes).toEqual(oldToken.scopes);
    });

    it('links new token to previous', () => {
      const { token: oldToken } = tokens.create({
        type: 'api_key',
        name: 'Original',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      const result = tokens.rotate(oldToken.id);

      expect(result!.newToken.previousTokenId).toBe(oldToken.id);
      expect(result!.newToken.rotatedAt).toBeInstanceOf(Date);
    });

    it('revokes old token by default', () => {
      const { token: oldToken } = tokens.create({
        type: 'api_key',
        name: 'To revoke',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      tokens.rotate(oldToken.id);

      expect(oldToken.revokedAt).toBeInstanceOf(Date);
      expect(oldToken.revokedBy).toBe('system:rotation');
    });

    it('can keep old token active', () => {
      const { token: oldToken } = tokens.create({
        type: 'api_key',
        name: 'Keep active',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      tokens.rotate(oldToken.id, { revokeOld: false });

      expect(oldToken.revokedAt).toBeNull();
    });

    it('returns null for non-existent token', () => {
      const result = tokens.rotate('tok_nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for already revoked token', () => {
      const { token } = tokens.create({
        type: 'api_key',
        name: 'Revoked',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      tokens.revoke(token.id, 'admin');
      const result = tokens.rotate(token.id);

      expect(result).toBeNull();
    });
  });

  describe('revoke', () => {
    it('revokes a token', () => {
      const { token } = tokens.create({
        type: 'api_key',
        name: 'To revoke',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      const result = tokens.revoke(token.id, 'admin@example.com');

      expect(result).toBe(true);
      expect(token.revokedAt).toBeInstanceOf(Date);
      expect(token.revokedBy).toBe('admin@example.com');
    });

    it('returns false for non-existent token', () => {
      const result = tokens.revoke('tok_nonexistent', 'admin');
      expect(result).toBe(false);
    });

    it('returns false for already revoked token', () => {
      const { token } = tokens.create({
        type: 'api_key',
        name: 'Already revoked',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      tokens.revoke(token.id, 'admin');
      const result = tokens.revoke(token.id, 'admin2');

      expect(result).toBe(false);
    });
  });

  describe('revokeAllForOwner', () => {
    it('revokes all tokens for an owner', () => {
      tokens.create({ type: 'api_key', name: 'Key 1', ownerId: 'user-1', ownerType: 'user' });
      tokens.create({ type: 'api_key', name: 'Key 2', ownerId: 'user-1', ownerType: 'user' });
      tokens.create({ type: 'api_key', name: 'Key 3', ownerId: 'user-2', ownerType: 'user' });

      const count = tokens.revokeAllForOwner('user-1', 'admin');

      expect(count).toBe(2);
      expect(tokens.getByOwner('user-1').length).toBe(0);
      expect(tokens.getByOwner('user-2').length).toBe(1);
    });
  });

  describe('getByOwner', () => {
    it('returns all tokens for an owner', () => {
      tokens.create({ type: 'api_key', name: 'Key 1', ownerId: 'user-1', ownerType: 'user' });
      tokens.create({ type: 'webhook_secret', name: 'Webhook', ownerId: 'user-1', ownerType: 'user' });

      const ownerTokens = tokens.getByOwner('user-1');

      expect(ownerTokens).toHaveLength(2);
    });

    it('excludes revoked tokens by default', () => {
      const { token } = tokens.create({
        type: 'api_key',
        name: 'Revoked',
        ownerId: 'user-1',
        ownerType: 'user',
      });
      tokens.create({ type: 'api_key', name: 'Active', ownerId: 'user-1', ownerType: 'user' });

      tokens.revoke(token.id, 'admin');

      expect(tokens.getByOwner('user-1').length).toBe(1);
      expect(tokens.getByOwner('user-1', true).length).toBe(2);
    });
  });

  describe('getExpiringSoon', () => {
    it('returns tokens expiring within specified days', () => {
      tokens.create({
        type: 'api_key',
        name: 'Expiring soon',
        ownerId: 'user-1',
        ownerType: 'user',
        expiresInDays: 5,
      });
      tokens.create({
        type: 'api_key',
        name: 'Not expiring soon',
        ownerId: 'user-1',
        ownerType: 'user',
        expiresInDays: 30,
      });

      const expiringSoon = tokens.getExpiringSoon(7);

      expect(expiringSoon).toHaveLength(1);
      expect(expiringSoon[0].name).toBe('Expiring soon');
    });
  });

  describe('cleanup', () => {
    it('removes old revoked tokens', () => {
      const { token } = tokens.create({
        type: 'api_key',
        name: 'Old revoked',
        ownerId: 'user-1',
        ownerType: 'user',
      });

      tokens.revoke(token.id, 'admin');
      // Manually set old revocation date
      token.revokedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

      const removed = tokens.cleanup(30);

      expect(removed).toBe(1);
      expect(tokens.get(token.id)).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      tokens.create({ type: 'api_key', name: 'Active', ownerId: 'user-1', ownerType: 'user' });
      tokens.create({ type: 'webhook_secret', name: 'Active 2', ownerId: 'user-1', ownerType: 'user' });

      const { token: toRevoke } = tokens.create({
        type: 'api_key',
        name: 'Revoked',
        ownerId: 'user-1',
        ownerType: 'user',
      });
      tokens.revoke(toRevoke.id, 'admin');

      tokens.create({
        type: 'integration_token',
        name: 'Expired',
        ownerId: 'user-1',
        ownerType: 'user',
        expiresInDays: -1,
      });

      const stats = tokens.getStats();

      expect(stats.total).toBe(4);
      expect(stats.active).toBe(2);
      expect(stats.revoked).toBe(1);
      expect(stats.expired).toBe(1);
      expect(stats.byType.api_key).toBe(2);
      expect(stats.byType.webhook_secret).toBe(1);
      expect(stats.byType.integration_token).toBe(1);
    });
  });

  describe('hashToken', () => {
    it('produces consistent hashes', () => {
      const value = 'prr_ak_test123456789';
      const hash1 = tokens.hashToken(value);
      const hash2 = tokens.hashToken(value);

      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different values', () => {
      const hash1 = tokens.hashToken('prr_ak_value1');
      const hash2 = tokens.hashToken('prr_ak_value2');

      expect(hash1).not.toBe(hash2);
    });
  });
});
