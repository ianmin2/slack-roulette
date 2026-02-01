/**
 * Tests for Usage Analytics
 */

import { analytics, analyticsTracker } from '../analytics';

describe('Usage Analytics', () => {
  beforeEach(() => {
    analytics.reset();
  });

  describe('track', () => {
    it('tracks basic event', () => {
      const eventId = analytics.track('assignment', 'created');

      expect(eventId).toMatch(/^evt_\d+_\d+$/);

      const events = analytics.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].category).toBe('assignment');
      expect(events[0].action).toBe('created');
    });

    it('tracks event with all options', () => {
      const eventId = analytics.track('review', 'completed', {
        label: 'PR #123',
        value: 42,
        userId: 'user-1',
        workspaceId: 'ws-1',
        metadata: { prNumber: 123 },
      });

      const events = analytics.getEvents();
      expect(events[0].label).toBe('PR #123');
      expect(events[0].value).toBe(42);
      expect(events[0].userId).toBe('user-1');
      expect(events[0].workspaceId).toBe('ws-1');
      expect(events[0].metadata?.prNumber).toBe(123);
    });
  });

  describe('convenience methods', () => {
    it('trackAssignment', () => {
      analytics.trackAssignment('auto_assigned', 'user-1', { repo: 'test-repo' });

      const events = analytics.getEvents();
      expect(events[0].category).toBe('assignment');
      expect(events[0].action).toBe('auto_assigned');
    });

    it('trackReview', () => {
      analytics.trackReview('started', 'user-1');

      const events = analytics.getEvents();
      expect(events[0].category).toBe('review');
    });

    it('trackCommand', () => {
      analytics.trackCommand('/pr-roulette stats', 'user-1');

      const events = analytics.getEvents();
      expect(events[0].category).toBe('command');
      expect(events[0].action).toBe('/pr-roulette stats');
    });

    it('trackInteraction', () => {
      analytics.trackInteraction('button_click', 'user-1', { button: 'approve' });

      const events = analytics.getEvents();
      expect(events[0].category).toBe('interaction');
    });

    it('trackAchievement', () => {
      analytics.trackAchievement('speed_demon', 'user-1');

      const events = analytics.getEvents();
      expect(events[0].category).toBe('achievement');
      expect(events[0].action).toBe('earned');
      expect(events[0].label).toBe('speed_demon');
    });

    it('trackApiCall', () => {
      analytics.trackApiCall('/api/assignments', 'user-1');

      const events = analytics.getEvents();
      expect(events[0].category).toBe('api');
    });
  });

  describe('getEvents', () => {
    beforeEach(() => {
      analytics.track('assignment', 'created', { userId: 'user-1' });
      analytics.track('review', 'completed', { userId: 'user-2' });
      analytics.track('assignment', 'reassigned', { userId: 'user-1' });
    });

    it('returns all events', () => {
      const events = analytics.getEvents();
      expect(events).toHaveLength(3);
    });

    it('filters by category', () => {
      const events = analytics.getEvents({ category: 'assignment' });
      expect(events).toHaveLength(2);
    });

    it('filters by action', () => {
      const events = analytics.getEvents({ action: 'completed' });
      expect(events).toHaveLength(1);
    });

    it('filters by userId', () => {
      const events = analytics.getEvents({ userId: 'user-1' });
      expect(events).toHaveLength(2);
    });

    it('respects limit', () => {
      const events = analytics.getEvents(undefined, 2);
      expect(events).toHaveLength(2);
    });

    it('returns most recent first', () => {
      const events = analytics.getEvents();
      expect(events[0].action).toBe('reassigned');
    });
  });

  describe('getSummary', () => {
    beforeEach(() => {
      analytics.track('assignment', 'created', { userId: 'user-1' });
      analytics.track('assignment', 'created', { userId: 'user-2' });
      analytics.track('review', 'completed', { userId: 'user-1' });
    });

    it('returns total events', () => {
      const summary = analytics.getSummary();
      expect(summary.totalEvents).toBe(3);
    });

    it('counts unique users', () => {
      const summary = analytics.getSummary();
      expect(summary.uniqueUsers).toBe(2);
    });

    it('groups by category', () => {
      const summary = analytics.getSummary();
      expect(summary.byCategory.assignment).toBe(2);
      expect(summary.byCategory.review).toBe(1);
    });

    it('groups by action', () => {
      const summary = analytics.getSummary();
      expect(summary.byAction['assignment:created']).toBe(2);
      expect(summary.byAction['review:completed']).toBe(1);
    });

    it('returns top actions', () => {
      const summary = analytics.getSummary();
      expect(summary.topActions[0].action).toBe('assignment:created');
      expect(summary.topActions[0].count).toBe(2);
    });
  });

  describe('getFeatureUsage', () => {
    it('tracks feature usage', () => {
      analytics.track('command', '/stats', { userId: 'user-1' });
      analytics.track('command', '/stats', { userId: 'user-2' });
      analytics.track('command', '/stats', { userId: 'user-1' });
      analytics.track('command', '/help', { userId: 'user-1' });

      const usage = analytics.getFeatureUsage();

      const statsFeature = usage.find((f) => f.feature === 'command:/stats');
      expect(statsFeature?.totalUses).toBe(3);
      expect(statsFeature?.uniqueUsers).toBe(2);
      expect(statsFeature?.avgUsesPerUser).toBe(1.5);
    });

    it('sorts by total uses', () => {
      analytics.track('command', '/stats', { userId: 'user-1' });
      analytics.track('command', '/stats', { userId: 'user-1' });
      analytics.track('command', '/help', { userId: 'user-1' });

      const usage = analytics.getFeatureUsage();
      expect(usage[0].feature).toBe('command:/stats');
    });
  });

  describe('getUserActivity', () => {
    it('returns user activity summary', () => {
      analytics.track('assignment', 'received', { userId: 'user-1' });
      analytics.track('review', 'completed', { userId: 'user-1' });
      analytics.track('review', 'started', { userId: 'user-1' });

      const activity = analytics.getUserActivity('user-1');

      expect(activity.totalEvents).toBe(3);
      expect(activity.byCategory.assignment).toBe(1);
      expect(activity.byCategory.review).toBe(2);
      expect(activity.recentActions).toHaveLength(3);
      expect(activity.firstSeen).toBeInstanceOf(Date);
      expect(activity.lastSeen).toBeInstanceOf(Date);
    });

    it('returns empty for unknown user', () => {
      const activity = analytics.getUserActivity('unknown');

      expect(activity.totalEvents).toBe(0);
      expect(activity.firstSeen).toBeNull();
    });
  });

  describe('getDailyActiveUsers', () => {
    it('returns DAU for specified days', () => {
      // Track events (will all be today)
      analytics.track('command', 'test', { userId: 'user-1' });
      analytics.track('command', 'test', { userId: 'user-2' });
      analytics.track('command', 'test', { userId: 'user-1' });

      const dau = analytics.getDailyActiveUsers(7);

      expect(dau).toHaveLength(7);
      // Today should have 2 unique users
      const today = dau[dau.length - 1];
      expect(today.users).toBe(2);
    });
  });

  describe('export', () => {
    it('exports all events', () => {
      analytics.track('assignment', 'created');
      analytics.track('review', 'completed');

      const exported = analytics.export();

      expect(exported).toHaveLength(2);
    });

    it('respects filters', () => {
      analytics.track('assignment', 'created');
      analytics.track('review', 'completed');

      const exported = analytics.export({ category: 'assignment' });

      expect(exported).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('removes all events', () => {
      analytics.track('test', 'event');
      analytics.clear();

      expect(analytics.getEvents()).toHaveLength(0);
      expect(analytics.getFeatureUsage()).toHaveLength(0);
    });
  });
});
