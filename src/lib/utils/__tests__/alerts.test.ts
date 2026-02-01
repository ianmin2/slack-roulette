/**
 * Tests for Alerting System
 */

import {
  alertManager,
  alerts,
  consoleChannel,
  createSlackAlertChannel,
  createWebhookChannel,
  type Alert,
  type AlertChannel,
} from '../alerts';

describe('Alerting System', () => {
  beforeEach(() => {
    alerts.reset();
  });

  describe('alert', () => {
    it('creates alert with correct properties', async () => {
      const result = await alerts.alert(
        'warning',
        'Test Alert',
        'This is a test message',
        'test-source',
        { key: 'value' }
      );

      expect(result).toBeDefined();
      expect(result?.severity).toBe('warning');
      expect(result?.title).toBe('Test Alert');
      expect(result?.message).toBe('This is a test message');
      expect(result?.source).toBe('test-source');
      expect(result?.context).toEqual({ key: 'value' });
      expect(result?.timestamp).toBeInstanceOf(Date);
      expect(result?.id).toMatch(/^alert_\d+_\d+$/);
    });

    it('filters alerts below minimum severity', async () => {
      alerts.configure({ minSeverity: 'error' });

      const info = await alerts.info('Info', 'msg', 'src');
      const warning = await alerts.warning('Warning', 'msg', 'src');
      const error = await alerts.error('Error', 'msg', 'src');

      expect(info).toBeNull();
      expect(warning).toBeNull();
      expect(error).not.toBeNull();
    });

    it('rate limits alerts from same source', async () => {
      alerts.configure({ rateLimitPerMinute: 2 });

      const alert1 = await alerts.warning('Alert 1', 'msg', 'rate-test');
      const alert2 = await alerts.warning('Alert 2', 'msg', 'rate-test');
      const alert3 = await alerts.warning('Alert 3', 'msg', 'rate-test');

      expect(alert1).not.toBeNull();
      expect(alert2).not.toBeNull();
      expect(alert3).toBeNull(); // Rate limited
    });

    it('deduplicates identical alerts within window', async () => {
      alerts.configure({ dedupeWindow: 60000 });

      const alert1 = await alerts.warning('Duplicate', 'msg', 'dedup-test');
      const alert2 = await alerts.warning('Duplicate', 'msg', 'dedup-test');
      const alert3 = await alerts.warning('Different', 'msg', 'dedup-test');

      expect(alert1).not.toBeNull();
      expect(alert2).toBeNull(); // Deduplicated
      expect(alert3).not.toBeNull(); // Different title
    });
  });

  describe('convenience methods', () => {
    it('info creates info-level alert', async () => {
      alerts.configure({ minSeverity: 'info' });
      const result = await alerts.info('Info Alert', 'message', 'source');
      expect(result?.severity).toBe('info');
    });

    it('warning creates warning-level alert', async () => {
      const result = await alerts.warning('Warning Alert', 'message', 'source');
      expect(result?.severity).toBe('warning');
    });

    it('error creates error-level alert', async () => {
      const result = await alerts.error('Error Alert', 'message', 'source');
      expect(result?.severity).toBe('error');
    });

    it('critical creates critical-level alert', async () => {
      const result = await alerts.critical('Critical Alert', 'message', 'source');
      expect(result?.severity).toBe('critical');
    });
  });

  describe('acknowledge', () => {
    it('acknowledges an alert', async () => {
      const alert = await alerts.warning('Test', 'msg', 'src');
      expect(alert).not.toBeNull();

      const result = alerts.acknowledge(alert!.id, 'admin@example.com');

      expect(result).toBe(true);
      const recent = alerts.getRecent();
      const found = recent.find((a) => a.id === alert!.id);
      expect(found?.acknowledged).toBe(true);
      expect(found?.acknowledgedBy).toBe('admin@example.com');
      expect(found?.acknowledgedAt).toBeInstanceOf(Date);
    });

    it('returns false for non-existent alert', () => {
      const result = alerts.acknowledge('fake-id', 'admin');
      expect(result).toBe(false);
    });
  });

  describe('getRecentAlerts', () => {
    it('returns recent alerts sorted by timestamp', async () => {
      await alerts.warning('Alert 1', 'msg', 'src');
      await new Promise((r) => setTimeout(r, 10));
      await alerts.warning('Alert 2', 'msg', 'src');
      await new Promise((r) => setTimeout(r, 10));
      await alerts.warning('Alert 3', 'msg', 'src');

      const recent = alerts.getRecent(10);

      expect(recent).toHaveLength(3);
      expect(recent[0].title).toBe('Alert 3');
      expect(recent[2].title).toBe('Alert 1');
    });

    it('limits number of results', async () => {
      for (let i = 0; i < 5; i++) {
        await alerts.warning(`Alert ${i}`, 'msg', 'src');
      }

      const recent = alerts.getRecent(3);
      expect(recent).toHaveLength(3);
    });
  });

  describe('getUnacknowledgedAlerts', () => {
    it('returns only unacknowledged alerts', async () => {
      const alert1 = await alerts.warning('Alert 1', 'msg', 'src');
      await alerts.warning('Alert 2', 'msg', 'src');

      alerts.acknowledge(alert1!.id, 'admin');

      const unacked = alerts.getUnacknowledged();
      expect(unacked).toHaveLength(1);
      expect(unacked[0].title).toBe('Alert 2');
    });
  });

  describe('channels', () => {
    it('sends alerts to registered channels', async () => {
      const mockSend = jest.fn().mockResolvedValue(undefined);
      const testChannel: AlertChannel = {
        name: 'test',
        enabled: true,
        send: mockSend,
      };

      alerts.registerChannel(testChannel);
      await alerts.warning('Test', 'msg', 'src');

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test',
          severity: 'warning',
        })
      );
    });

    it('skips disabled channels', async () => {
      const mockSend = jest.fn();
      const testChannel: AlertChannel = {
        name: 'disabled-channel',
        enabled: false,
        send: mockSend,
      };

      alerts.registerChannel(testChannel);
      await alerts.warning('Test', 'msg', 'src');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('handles channel errors gracefully', async () => {
      const failingChannel: AlertChannel = {
        name: 'failing',
        enabled: true,
        send: jest.fn().mockRejectedValue(new Error('Channel failed')),
      };

      alerts.registerChannel(failingChannel);

      // Should not throw
      await expect(alerts.warning('Test', 'msg', 'src')).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('removes old alerts', async () => {
      // Create an alert and manually set old timestamp
      await alerts.warning('Old Alert', 'msg', 'src');
      await alerts.warning('New Alert', 'msg', 'src');

      const before = alerts.getRecent();
      expect(before).toHaveLength(2);

      // Cleanup with 0 max age removes everything
      const removed = alerts.cleanup(0);
      expect(removed).toBe(2);

      const after = alerts.getRecent();
      expect(after).toHaveLength(0);
    });
  });

  describe('channel factories', () => {
    describe('createSlackAlertChannel', () => {
      it('creates a channel with correct properties', () => {
        const channel = createSlackAlertChannel('https://hooks.slack.com/test');
        expect(channel.name).toBe('slack');
        expect(channel.enabled).toBe(true);
      });

      it('is disabled when no webhook URL', () => {
        const channel = createSlackAlertChannel('');
        expect(channel.enabled).toBe(false);
      });
    });

    describe('createWebhookChannel', () => {
      it('creates a channel with correct properties', () => {
        const channel = createWebhookChannel('custom', 'https://example.com/hook');
        expect(channel.name).toBe('custom');
        expect(channel.enabled).toBe(true);
      });

      it('is disabled when no webhook URL', () => {
        const channel = createWebhookChannel('custom', '');
        expect(channel.enabled).toBe(false);
      });
    });

    describe('consoleChannel', () => {
      it('is enabled by default', () => {
        expect(consoleChannel.enabled).toBe(true);
      });

      it('send is a no-op (logging done by manager)', async () => {
        await expect(consoleChannel.send({} as Alert)).resolves.not.toThrow();
      });
    });
  });
});
