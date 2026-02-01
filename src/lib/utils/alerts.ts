/**
 * Alerting System
 *
 * Provides infrastructure for alerting on critical failures.
 * Supports multiple channels: Slack, logging, webhooks.
 */

import { createLogger } from './logger';

const log = createLogger('alerts');

// =============================================================================
// TYPES
// =============================================================================

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  context?: Record<string, unknown>;
  timestamp: Date;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
}

export interface AlertChannel {
  name: string;
  enabled: boolean;
  send: (alert: Alert) => Promise<void>;
}

export interface AlertConfig {
  /** Minimum severity to trigger alerts */
  minSeverity: AlertSeverity;
  /** Channels to send alerts to */
  channels: AlertChannel[];
  /** Rate limit: max alerts per minute per source */
  rateLimitPerMinute: number;
  /** Whether to dedupe repeated alerts */
  dedupeWindow: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SEVERITY_LEVELS: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

const DEFAULT_CONFIG: AlertConfig = {
  minSeverity: 'warning',
  channels: [],
  rateLimitPerMinute: 10,
  dedupeWindow: 300000, // 5 minutes
};

// =============================================================================
// ALERT MANAGER
// =============================================================================

class AlertManager {
  private config: AlertConfig = { ...DEFAULT_CONFIG };
  private alertHistory = new Map<string, Alert>();
  private rateLimitCounters = new Map<string, { count: number; resetAt: number }>();
  private alertIdCounter = 0;

  /**
   * Configure the alert manager
   */
  configure(config: Partial<AlertConfig>): void {
    this.config = { ...this.config, ...config };
    log.info('Alert manager configured', {
      minSeverity: this.config.minSeverity,
      channels: this.config.channels.map((c) => c.name),
    });
  }

  /**
   * Register an alert channel
   */
  registerChannel(channel: AlertChannel): void {
    const existingIndex = this.config.channels.findIndex((c) => c.name === channel.name);
    if (existingIndex >= 0) {
      this.config.channels[existingIndex] = channel;
    } else {
      this.config.channels.push(channel);
    }
    log.debug('Alert channel registered', { name: channel.name, enabled: channel.enabled });
  }

  /**
   * Send an alert
   */
  async alert(
    severity: AlertSeverity,
    title: string,
    message: string,
    source: string,
    context?: Record<string, unknown>
  ): Promise<Alert | null> {
    // Check severity threshold
    if (SEVERITY_LEVELS[severity] < SEVERITY_LEVELS[this.config.minSeverity]) {
      return null;
    }

    // Check rate limit
    if (!this.checkRateLimit(source)) {
      log.warn('Alert rate limited', { source, severity, title });
      return null;
    }

    // Check deduplication
    const dedupeKey = `${source}:${severity}:${title}`;
    if (this.isDuplicate(dedupeKey)) {
      log.debug('Alert deduplicated', { source, severity, title });
      return null;
    }

    const alert: Alert = {
      id: `alert_${Date.now()}_${++this.alertIdCounter}`,
      severity,
      title,
      message,
      source,
      context,
      timestamp: new Date(),
    };

    // Store in history
    this.alertHistory.set(alert.id, alert);
    this.alertHistory.set(dedupeKey, alert);

    // Log the alert
    const logMethod = severity === 'critical' || severity === 'error' ? 'error' : 'warn';
    log[logMethod](`[ALERT] ${title}`, { severity, source, message, context });

    // Send to channels
    await this.sendToChannels(alert);

    return alert;
  }

  /**
   * Convenience methods for different severity levels
   */
  async info(
    title: string,
    message: string,
    source: string,
    context?: Record<string, unknown>
  ): Promise<Alert | null> {
    return this.alert('info', title, message, source, context);
  }

  async warning(
    title: string,
    message: string,
    source: string,
    context?: Record<string, unknown>
  ): Promise<Alert | null> {
    return this.alert('warning', title, message, source, context);
  }

  async error(
    title: string,
    message: string,
    source: string,
    context?: Record<string, unknown>
  ): Promise<Alert | null> {
    return this.alert('error', title, message, source, context);
  }

  async critical(
    title: string,
    message: string,
    source: string,
    context?: Record<string, unknown>
  ): Promise<Alert | null> {
    return this.alert('critical', title, message, source, context);
  }

  /**
   * Acknowledge an alert
   */
  acknowledge(alertId: string, acknowledgedBy: string): boolean {
    const alert = this.alertHistory.get(alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    log.info('Alert acknowledged', { alertId, acknowledgedBy });
    return true;
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit = 50): Alert[] {
    const seen = new Set<string>();
    return Array.from(this.alertHistory.values())
      .filter((a) => {
        if (!a.id.startsWith('alert_') || seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get unacknowledged alerts
   */
  getUnacknowledgedAlerts(): Alert[] {
    return this.getRecentAlerts(100).filter((a) => !a.acknowledged);
  }

  /**
   * Clear old alerts from history
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    const removedIds = new Set<string>();

    for (const [key, alert] of this.alertHistory.entries()) {
      if (alert.timestamp.getTime() <= cutoff) {
        this.alertHistory.delete(key);
        if (alert.id.startsWith('alert_')) {
          removedIds.add(alert.id);
        }
      }
    }

    return removedIds.size;
  }

  /**
   * Reset for testing
   */
  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.alertHistory.clear();
    this.rateLimitCounters.clear();
    this.alertIdCounter = 0;
  }

  private checkRateLimit(source: string): boolean {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(source);

    if (!counter || counter.resetAt < now) {
      this.rateLimitCounters.set(source, { count: 1, resetAt: now + 60000 });
      return true;
    }

    if (counter.count >= this.config.rateLimitPerMinute) {
      return false;
    }

    counter.count++;
    return true;
  }

  private isDuplicate(dedupeKey: string): boolean {
    const existing = this.alertHistory.get(dedupeKey);
    if (!existing) return false;

    const age = Date.now() - existing.timestamp.getTime();
    return age < this.config.dedupeWindow;
  }

  private async sendToChannels(alert: Alert): Promise<void> {
    const enabledChannels = this.config.channels.filter((c) => c.enabled);

    await Promise.allSettled(
      enabledChannels.map(async (channel) => {
        try {
          await channel.send(alert);
        } catch (error) {
          log.error('Failed to send alert to channel', error instanceof Error ? error : new Error(String(error)), {
            channel: channel.name,
            alertId: alert.id,
          });
        }
      })
    );
  }
}

// =============================================================================
// BUILT-IN CHANNELS
// =============================================================================

/**
 * Console channel - logs alerts to console (already done by alert manager)
 */
export const consoleChannel: AlertChannel = {
  name: 'console',
  enabled: true,
  send: async () => {
    // Already logged by alert manager
  },
};

/**
 * Create a Slack channel for alerts
 */
export const createSlackAlertChannel = (
  webhookUrl: string,
  options?: { channel?: string; username?: string }
): AlertChannel => ({
  name: 'slack',
  enabled: !!webhookUrl,
  send: async (alert) => {
    if (!webhookUrl) return;

    const emoji =
      alert.severity === 'critical'
        ? '🚨'
        : alert.severity === 'error'
          ? '❌'
          : alert.severity === 'warning'
            ? '⚠️'
            : 'ℹ️';

    const color =
      alert.severity === 'critical'
        ? '#dc3545'
        : alert.severity === 'error'
          ? '#fd7e14'
          : alert.severity === 'warning'
            ? '#ffc107'
            : '#17a2b8';

    const payload = {
      ...(options?.channel && { channel: options.channel }),
      ...(options?.username && { username: options.username }),
      attachments: [
        {
          color,
          title: `${emoji} ${alert.title}`,
          text: alert.message,
          fields: [
            { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
            { title: 'Source', value: alert.source, short: true },
          ],
          footer: `Alert ID: ${alert.id}`,
          ts: Math.floor(alert.timestamp.getTime() / 1000),
        },
      ],
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },
});

/**
 * Create a webhook channel for alerts
 */
export const createWebhookChannel = (
  name: string,
  webhookUrl: string,
  options?: { headers?: Record<string, string> }
): AlertChannel => ({
  name,
  enabled: !!webhookUrl,
  send: async (alert) => {
    if (!webhookUrl) return;

    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(alert),
    });
  },
});

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const alertManager = new AlertManager();

// =============================================================================
// EXPORTS
// =============================================================================

export const alerts = {
  configure: alertManager.configure.bind(alertManager),
  registerChannel: alertManager.registerChannel.bind(alertManager),
  alert: alertManager.alert.bind(alertManager),
  info: alertManager.info.bind(alertManager),
  warning: alertManager.warning.bind(alertManager),
  error: alertManager.error.bind(alertManager),
  critical: alertManager.critical.bind(alertManager),
  acknowledge: alertManager.acknowledge.bind(alertManager),
  getRecent: alertManager.getRecentAlerts.bind(alertManager),
  getUnacknowledged: alertManager.getUnacknowledgedAlerts.bind(alertManager),
  cleanup: alertManager.cleanup.bind(alertManager),
  reset: alertManager.reset.bind(alertManager),
};

export default alerts;
