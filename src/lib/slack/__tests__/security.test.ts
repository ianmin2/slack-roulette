/**
 * Tests for Slack Security Utilities
 */

import crypto from 'crypto';

// Store original env
const originalEnv = process.env;

describe('Slack Security', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('verifySlackSignature', () => {
    const testSecret = 'test-signing-secret';
    const testBody = 'test-body-content';

    const generateValidSignature = (timestamp: string, body: string, secret: string): string => {
      const baseString = `v0:${timestamp}:${body}`;
      const hash = crypto.createHmac('sha256', secret).update(baseString).digest('hex');
      return `v0=${hash}`;
    };

    it('returns true for valid signature', async () => {
      process.env.SLACK_SIGNING_SECRET = testSecret;
      const { verifySlackSignature } = await import('../security');

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = generateValidSignature(timestamp, testBody, testSecret);

      expect(verifySlackSignature(signature, timestamp, testBody)).toBe(true);
    });

    it('returns false for invalid signature', async () => {
      process.env.SLACK_SIGNING_SECRET = testSecret;
      const { verifySlackSignature } = await import('../security');

      const timestamp = String(Math.floor(Date.now() / 1000));
      const invalidSignature = 'v0=invalidsignaturexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

      expect(verifySlackSignature(invalidSignature, timestamp, testBody)).toBe(false);
    });

    it('returns false for old timestamp (replay attack prevention)', async () => {
      process.env.SLACK_SIGNING_SECRET = testSecret;
      const { verifySlackSignature } = await import('../security');

      // Timestamp from 10 minutes ago
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600);
      const signature = generateValidSignature(oldTimestamp, testBody, testSecret);

      expect(verifySlackSignature(signature, oldTimestamp, testBody)).toBe(false);
    });

    it('returns false for wrong body content', async () => {
      process.env.SLACK_SIGNING_SECRET = testSecret;
      const { verifySlackSignature } = await import('../security');

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = generateValidSignature(timestamp, 'different-body', testSecret);

      expect(verifySlackSignature(signature, timestamp, testBody)).toBe(false);
    });

    it('returns false for signature with wrong length', async () => {
      process.env.SLACK_SIGNING_SECRET = testSecret;
      const { verifySlackSignature } = await import('../security');

      const timestamp = String(Math.floor(Date.now() / 1000));
      const shortSignature = 'v0=short';

      expect(verifySlackSignature(shortSignature, timestamp, testBody)).toBe(false);
    });

    it('returns true when no signing secret configured (dev mode)', async () => {
      process.env.SLACK_SIGNING_SECRET = '';
      const { verifySlackSignature } = await import('../security');

      expect(verifySlackSignature('any', 'any', 'any')).toBe(true);
    });
  });

  describe('getSlackHeaders', () => {
    it('extracts Slack headers from request', async () => {
      const { getSlackHeaders } = await import('../security');

      const mockRequest = {
        headers: {
          get: (name: string) => {
            if (name === 'x-slack-signature') return 'v0=testsig';
            if (name === 'x-slack-request-timestamp') return '1234567890';
            return null;
          },
        },
      } as unknown as Request;

      const headers = getSlackHeaders(mockRequest);

      expect(headers.signature).toBe('v0=testsig');
      expect(headers.timestamp).toBe('1234567890');
    });

    it('returns empty strings for missing headers', async () => {
      const { getSlackHeaders } = await import('../security');

      const mockRequest = {
        headers: {
          get: () => null,
        },
      } as unknown as Request;

      const headers = getSlackHeaders(mockRequest);

      expect(headers.signature).toBe('');
      expect(headers.timestamp).toBe('');
    });
  });

  describe('verifyRequestOrError', () => {
    const testSecret = 'test-signing-secret';

    it('returns null for valid request', async () => {
      process.env.SLACK_SIGNING_SECRET = testSecret;
      const { verifyRequestOrError } = await import('../security');

      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = 'test-body';
      const baseString = `v0:${timestamp}:${body}`;
      const hash = crypto.createHmac('sha256', testSecret).update(baseString).digest('hex');
      const signature = `v0=${hash}`;

      expect(verifyRequestOrError(signature, timestamp, body)).toBeNull();
    });

    it('returns error object for invalid request', async () => {
      process.env.SLACK_SIGNING_SECRET = testSecret;
      const { verifyRequestOrError } = await import('../security');

      const result = verifyRequestOrError('invalid', '1234567890', 'body');

      expect(result).not.toBeNull();
      expect(result?.error).toBe('Invalid signature');
      expect(result?.status).toBe(401);
    });
  });

  describe('getBotToken', () => {
    it('returns token when configured', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
      const { getBotToken } = await import('../security');

      expect(getBotToken()).toBe('xoxb-test-token');
    });

    it('throws when token not configured', async () => {
      process.env.SLACK_BOT_TOKEN = '';
      const { getBotToken } = await import('../security');

      expect(() => getBotToken()).toThrow('SLACK_BOT_TOKEN not configured');
    });
  });
});
