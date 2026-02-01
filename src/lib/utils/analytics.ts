/**
 * Usage Analytics
 *
 * Tracks feature usage, user engagement, and business metrics.
 */

import { createLogger } from './logger';

const log = createLogger('analytics');

// =============================================================================
// TYPES
// =============================================================================

export type EventCategory =
  | 'assignment'
  | 'review'
  | 'command'
  | 'interaction'
  | 'achievement'
  | 'challenge'
  | 'admin'
  | 'api';

export interface AnalyticsEvent {
  id: string;
  category: EventCategory;
  action: string;
  label?: string;
  value?: number;
  userId?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface EventFilter {
  category?: EventCategory;
  action?: string;
  userId?: string;
  workspaceId?: string;
  since?: Date;
  until?: Date;
}

export interface AnalyticsSummary {
  totalEvents: number;
  uniqueUsers: number;
  byCategory: Record<string, number>;
  byAction: Record<string, number>;
  topActions: Array<{ action: string; count: number }>;
  eventsByHour: Record<number, number>;
  eventsByDay: Record<string, number>;
}

export interface FeatureUsage {
  feature: string;
  totalUses: number;
  uniqueUsers: number;
  avgUsesPerUser: number;
  lastUsed: Date | null;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
}

// =============================================================================
// ANALYTICS TRACKER
// =============================================================================

class AnalyticsTracker {
  private events: AnalyticsEvent[] = [];
  private eventIdCounter = 0;
  private maxEvents = 50000;
  private featureUsage = new Map<string, { uses: number; users: Set<string>; lastUsed: Date }>();

  /**
   * Track an analytics event
   */
  track(
    category: EventCategory,
    action: string,
    options?: {
      label?: string;
      value?: number;
      userId?: string;
      workspaceId?: string;
      metadata?: Record<string, unknown>;
    }
  ): string {
    const event: AnalyticsEvent = {
      id: `evt_${Date.now()}_${++this.eventIdCounter}`,
      category,
      action,
      label: options?.label,
      value: options?.value,
      userId: options?.userId,
      workspaceId: options?.workspaceId,
      metadata: options?.metadata,
      timestamp: new Date(),
    };

    this.events.push(event);
    this.trimEvents();

    // Update feature usage
    const featureKey = `${category}:${action}`;
    const usage = this.featureUsage.get(featureKey) ?? {
      uses: 0,
      users: new Set<string>(),
      lastUsed: new Date(),
    };
    usage.uses++;
    if (options?.userId) {
      usage.users.add(options.userId);
    }
    usage.lastUsed = new Date();
    this.featureUsage.set(featureKey, usage);

    log.debug('Analytics event tracked', {
      category,
      action,
      label: options?.label,
      userId: options?.userId,
    });

    return event.id;
  }

  /**
   * Convenience methods for common event types
   */
  trackAssignment(action: string, userId?: string, metadata?: Record<string, unknown>): string {
    return this.track('assignment', action, { userId, metadata });
  }

  trackReview(action: string, userId?: string, metadata?: Record<string, unknown>): string {
    return this.track('review', action, { userId, metadata });
  }

  trackCommand(command: string, userId?: string, metadata?: Record<string, unknown>): string {
    return this.track('command', command, { userId, metadata });
  }

  trackInteraction(action: string, userId?: string, metadata?: Record<string, unknown>): string {
    return this.track('interaction', action, { userId, metadata });
  }

  trackAchievement(achievement: string, userId?: string): string {
    return this.track('achievement', 'earned', { label: achievement, userId });
  }

  trackApiCall(endpoint: string, userId?: string, metadata?: Record<string, unknown>): string {
    return this.track('api', endpoint, { userId, metadata });
  }

  /**
   * Trim old events
   */
  private trimEvents(): void {
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /**
   * Get events with optional filtering
   */
  getEvents(filter?: EventFilter, limit = 100): AnalyticsEvent[] {
    let filtered = this.events;

    if (filter) {
      if (filter.category) {
        filtered = filtered.filter((e) => e.category === filter.category);
      }
      if (filter.action) {
        filtered = filtered.filter((e) => e.action === filter.action);
      }
      if (filter.userId) {
        filtered = filtered.filter((e) => e.userId === filter.userId);
      }
      if (filter.workspaceId) {
        filtered = filtered.filter((e) => e.workspaceId === filter.workspaceId);
      }
      if (filter.since) {
        filtered = filtered.filter((e) => e.timestamp >= filter.since!);
      }
      if (filter.until) {
        filtered = filtered.filter((e) => e.timestamp <= filter.until!);
      }
    }

    return filtered.slice(-limit).reverse();
  }

  /**
   * Get analytics summary
   */
  getSummary(filter?: EventFilter): AnalyticsSummary {
    const events = this.getEvents(filter, this.maxEvents);
    const uniqueUsers = new Set<string>();
    const byCategory: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    const eventsByHour: Record<number, number> = {};
    const eventsByDay: Record<string, number> = {};

    for (const event of events) {
      // Unique users
      if (event.userId) {
        uniqueUsers.add(event.userId);
      }

      // By category
      byCategory[event.category] = (byCategory[event.category] ?? 0) + 1;

      // By action
      const actionKey = `${event.category}:${event.action}`;
      byAction[actionKey] = (byAction[actionKey] ?? 0) + 1;

      // By hour
      const hour = event.timestamp.getHours();
      eventsByHour[hour] = (eventsByHour[hour] ?? 0) + 1;

      // By day
      const day = event.timestamp.toISOString().split('T')[0];
      eventsByDay[day] = (eventsByDay[day] ?? 0) + 1;
    }

    // Top actions
    const topActions = Object.entries(byAction)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEvents: events.length,
      uniqueUsers: uniqueUsers.size,
      byCategory,
      byAction,
      topActions,
      eventsByHour,
      eventsByDay,
    };
  }

  /**
   * Get feature usage statistics
   */
  getFeatureUsage(): FeatureUsage[] {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekAgo = new Date(now - 7 * dayMs);

    const usageList: FeatureUsage[] = [];

    for (const [feature, data] of this.featureUsage.entries()) {
      // Calculate trend (simplified - would need historical data for real trend)
      const recentEvents = this.events.filter(
        (e) => `${e.category}:${e.action}` === feature && e.timestamp >= weekAgo
      );
      const olderEvents = this.events.filter(
        (e) =>
          `${e.category}:${e.action}` === feature &&
          e.timestamp < weekAgo &&
          e.timestamp >= new Date(now - 14 * dayMs)
      );

      let trend: 'up' | 'down' | 'stable' = 'stable';
      let trendPercentage = 0;

      if (olderEvents.length > 0) {
        trendPercentage = ((recentEvents.length - olderEvents.length) / olderEvents.length) * 100;
        trend = trendPercentage > 10 ? 'up' : trendPercentage < -10 ? 'down' : 'stable';
      }

      usageList.push({
        feature,
        totalUses: data.uses,
        uniqueUsers: data.users.size,
        avgUsesPerUser: data.users.size > 0 ? data.uses / data.users.size : 0,
        lastUsed: data.lastUsed,
        trend,
        trendPercentage: Math.round(trendPercentage),
      });
    }

    return usageList.sort((a, b) => b.totalUses - a.totalUses);
  }

  /**
   * Get user activity
   */
  getUserActivity(userId: string, since?: Date): {
    totalEvents: number;
    byCategory: Record<string, number>;
    recentActions: string[];
    firstSeen: Date | null;
    lastSeen: Date | null;
  } {
    const userEvents = this.events.filter(
      (e) => e.userId === userId && (!since || e.timestamp >= since)
    );

    const byCategory: Record<string, number> = {};
    let firstSeen: Date | null = null;
    let lastSeen: Date | null = null;

    for (const event of userEvents) {
      byCategory[event.category] = (byCategory[event.category] ?? 0) + 1;

      if (!firstSeen || event.timestamp < firstSeen) {
        firstSeen = event.timestamp;
      }
      if (!lastSeen || event.timestamp > lastSeen) {
        lastSeen = event.timestamp;
      }
    }

    const recentActions = userEvents
      .slice(-10)
      .reverse()
      .map((e) => `${e.category}:${e.action}`);

    return {
      totalEvents: userEvents.length,
      byCategory,
      recentActions,
      firstSeen,
      lastSeen,
    };
  }

  /**
   * Get daily active users
   */
  getDailyActiveUsers(days = 7): Array<{ date: string; users: number }> {
    const result: Array<{ date: string; users: number }> = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const uniqueUsers = new Set<string>();
      for (const event of this.events) {
        if (event.userId && event.timestamp.toISOString().split('T')[0] === dateStr) {
          uniqueUsers.add(event.userId);
        }
      }

      result.push({ date: dateStr, users: uniqueUsers.size });
    }

    return result;
  }

  /**
   * Export events for external analysis
   */
  export(filter?: EventFilter): AnalyticsEvent[] {
    return this.getEvents(filter, this.maxEvents);
  }

  /**
   * Clear events (for testing)
   */
  clear(): void {
    this.events = [];
    this.featureUsage.clear();
    this.eventIdCounter = 0;
  }

  /**
   * Reset (for testing)
   */
  reset(): void {
    this.clear();
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const analyticsTracker = new AnalyticsTracker();

// =============================================================================
// EXPORTS
// =============================================================================

export const analytics = {
  track: analyticsTracker.track.bind(analyticsTracker),
  trackAssignment: analyticsTracker.trackAssignment.bind(analyticsTracker),
  trackReview: analyticsTracker.trackReview.bind(analyticsTracker),
  trackCommand: analyticsTracker.trackCommand.bind(analyticsTracker),
  trackInteraction: analyticsTracker.trackInteraction.bind(analyticsTracker),
  trackAchievement: analyticsTracker.trackAchievement.bind(analyticsTracker),
  trackApiCall: analyticsTracker.trackApiCall.bind(analyticsTracker),
  getEvents: analyticsTracker.getEvents.bind(analyticsTracker),
  getSummary: analyticsTracker.getSummary.bind(analyticsTracker),
  getFeatureUsage: analyticsTracker.getFeatureUsage.bind(analyticsTracker),
  getUserActivity: analyticsTracker.getUserActivity.bind(analyticsTracker),
  getDailyActiveUsers: analyticsTracker.getDailyActiveUsers.bind(analyticsTracker),
  export: analyticsTracker.export.bind(analyticsTracker),
  clear: analyticsTracker.clear.bind(analyticsTracker),
  reset: analyticsTracker.reset.bind(analyticsTracker),
};

export default analytics;
