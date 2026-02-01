/**
 * Metrics Collection
 *
 * Provides simple metrics collection for monitoring application performance.
 * Supports counters, gauges, histograms, and timing measurements.
 */

import { createLogger } from './logger';

const log = createLogger('metrics');

// =============================================================================
// TYPES
// =============================================================================

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'timing';

export interface MetricValue {
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
  timestamp: Date;
}

export interface HistogramBuckets {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

export interface MetricDefinition {
  name: string;
  type: MetricType;
  description: string;
  labels?: string[];
}

export interface MetricSnapshot {
  name: string;
  type: MetricType;
  value: number | HistogramBuckets;
  labels?: Record<string, string>;
  timestamp: Date;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_HISTOGRAM_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

// =============================================================================
// METRICS STORAGE
// =============================================================================

class MetricsStore {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, { buckets: number[]; values: number[] }>();
  private definitions = new Map<string, MetricDefinition>();
  private timers = new Map<string, number>();

  /**
   * Register a metric definition
   */
  register(definition: MetricDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  /**
   * Get metric key with labels
   */
  private getKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  // ---------------------------------------------------------------------------
  // COUNTERS
  // ---------------------------------------------------------------------------

  /**
   * Increment a counter
   */
  inc(name: string, value = 1, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
  }

  /**
   * Get counter value
   */
  getCounter(name: string, labels?: Record<string, string>): number {
    const key = this.getKey(name, labels);
    return this.counters.get(key) ?? 0;
  }

  // ---------------------------------------------------------------------------
  // GAUGES
  // ---------------------------------------------------------------------------

  /**
   * Set a gauge value
   */
  set(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
   * Increment a gauge
   */
  incGauge(name: string, value = 1, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    const current = this.gauges.get(key) ?? 0;
    this.gauges.set(key, current + value);
  }

  /**
   * Decrement a gauge
   */
  decGauge(name: string, value = 1, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    const current = this.gauges.get(key) ?? 0;
    this.gauges.set(key, current - value);
  }

  /**
   * Get gauge value
   */
  getGauge(name: string, labels?: Record<string, string>): number {
    const key = this.getKey(name, labels);
    return this.gauges.get(key) ?? 0;
  }

  // ---------------------------------------------------------------------------
  // HISTOGRAMS
  // ---------------------------------------------------------------------------

  /**
   * Observe a value for a histogram
   */
  observe(
    name: string,
    value: number,
    labels?: Record<string, string>,
    buckets = DEFAULT_HISTOGRAM_BUCKETS
  ): void {
    const key = this.getKey(name, labels);
    let histogram = this.histograms.get(key);

    if (!histogram) {
      histogram = { buckets: [...buckets], values: [] };
      this.histograms.set(key, histogram);
    }

    histogram.values.push(value);
  }

  /**
   * Get histogram data
   */
  getHistogram(name: string, labels?: Record<string, string>): HistogramBuckets | null {
    const key = this.getKey(name, labels);
    const histogram = this.histograms.get(key);

    if (!histogram || histogram.values.length === 0) {
      return null;
    }

    const counts = histogram.buckets.map(
      (bucket) => histogram.values.filter((v) => v <= bucket).length
    );

    return {
      buckets: histogram.buckets,
      counts,
      sum: histogram.values.reduce((a, b) => a + b, 0),
      count: histogram.values.length,
    };
  }

  // ---------------------------------------------------------------------------
  // TIMING
  // ---------------------------------------------------------------------------

  /**
   * Start a timer
   */
  startTimer(name: string): string {
    const timerId = `${name}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.timers.set(timerId, performance.now());
    return timerId;
  }

  /**
   * End a timer and record the duration
   */
  endTimer(timerId: string, labels?: Record<string, string>): number | null {
    const startTime = this.timers.get(timerId);
    if (startTime === undefined) {
      return null;
    }

    this.timers.delete(timerId);
    const duration = performance.now() - startTime;

    // Extract name from timer ID
    const name = timerId.split('_').slice(0, -2).join('_');
    this.observe(name, duration, labels);

    return duration;
  }

  /**
   * Time an async function
   */
  async time<T>(
    name: string,
    fn: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      this.observe(name, duration, labels);
    }
  }

  /**
   * Time a sync function
   */
  timeSync<T>(name: string, fn: () => T, labels?: Record<string, string>): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const duration = performance.now() - start;
      this.observe(name, duration, labels);
    }
  }

  // ---------------------------------------------------------------------------
  // SNAPSHOTS & EXPORT
  // ---------------------------------------------------------------------------

  /**
   * Get all metrics as snapshots
   */
  getSnapshots(): MetricSnapshot[] {
    const now = new Date();
    const snapshots: MetricSnapshot[] = [];

    // Counters
    for (const [key, value] of this.counters.entries()) {
      const { name, labels } = this.parseKey(key);
      snapshots.push({
        name,
        type: 'counter',
        value,
        labels,
        timestamp: now,
      });
    }

    // Gauges
    for (const [key, value] of this.gauges.entries()) {
      const { name, labels } = this.parseKey(key);
      snapshots.push({
        name,
        type: 'gauge',
        value,
        labels,
        timestamp: now,
      });
    }

    // Histograms
    for (const [key] of this.histograms.entries()) {
      const { name, labels } = this.parseKey(key);
      const histogram = this.getHistogram(name, labels);
      if (histogram) {
        snapshots.push({
          name,
          type: 'histogram',
          value: histogram,
          labels,
          timestamp: now,
        });
      }
    }

    return snapshots;
  }

  /**
   * Parse a metric key into name and labels
   */
  private parseKey(key: string): { name: string; labels?: Record<string, string> } {
    const match = key.match(/^([^{]+)(?:\{(.+)\})?$/);
    if (!match) {
      return { name: key };
    }

    const name = match[1];
    if (!match[2]) {
      return { name };
    }

    const labels: Record<string, string> = {};
    const labelPairs = match[2].split(',');
    for (const pair of labelPairs) {
      const [k, v] = pair.split('=');
      labels[k] = v.replace(/^"|"$/g, '');
    }

    return { name, labels };
  }

  /**
   * Export metrics in Prometheus format
   */
  toPrometheusFormat(): string {
    const lines: string[] = [];

    // Counters
    for (const [key, value] of this.counters.entries()) {
      lines.push(`${key.replace(/[^a-zA-Z0-9_{}=",]/g, '_')} ${value}`);
    }

    // Gauges
    for (const [key, value] of this.gauges.entries()) {
      lines.push(`${key.replace(/[^a-zA-Z0-9_{}=",]/g, '_')} ${value}`);
    }

    // Histograms
    for (const [key] of this.histograms.entries()) {
      const { name, labels } = this.parseKey(key);
      const histogram = this.getHistogram(name, labels);
      if (histogram) {
        const labelStr = labels
          ? Object.entries(labels)
              .map(([k, v]) => `${k}="${v}"`)
              .join(',')
          : '';

        for (let i = 0; i < histogram.buckets.length; i++) {
          const le = histogram.buckets[i];
          const count = histogram.counts[i];
          const bucketLabels = labelStr ? `${labelStr},le="${le}"` : `le="${le}"`;
          lines.push(`${name}_bucket{${bucketLabels}} ${count}`);
        }
        lines.push(`${name}_sum${labels ? `{${labelStr}}` : ''} ${histogram.sum}`);
        lines.push(`${name}_count${labels ? `{${labelStr}}` : ''} ${histogram.count}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timers.clear();
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const metricsStore = new MetricsStore();

// =============================================================================
// PRE-DEFINED METRICS
// =============================================================================

// Register common metrics
metricsStore.register({
  name: 'http_requests_total',
  type: 'counter',
  description: 'Total number of HTTP requests',
  labels: ['method', 'path', 'status'],
});

metricsStore.register({
  name: 'http_request_duration_ms',
  type: 'histogram',
  description: 'HTTP request duration in milliseconds',
  labels: ['method', 'path'],
});

metricsStore.register({
  name: 'assignments_total',
  type: 'counter',
  description: 'Total number of PR assignments',
  labels: ['status'],
});

metricsStore.register({
  name: 'slack_messages_sent',
  type: 'counter',
  description: 'Total number of Slack messages sent',
  labels: ['type'],
});

metricsStore.register({
  name: 'github_api_calls',
  type: 'counter',
  description: 'Total number of GitHub API calls',
  labels: ['endpoint', 'status'],
});

metricsStore.register({
  name: 'job_queue_size',
  type: 'gauge',
  description: 'Current number of jobs in queue',
  labels: ['status'],
});

metricsStore.register({
  name: 'active_users',
  type: 'gauge',
  description: 'Number of currently active users',
});

// =============================================================================
// EXPORTS
// =============================================================================

export const metrics = {
  // Counters
  inc: metricsStore.inc.bind(metricsStore),
  getCounter: metricsStore.getCounter.bind(metricsStore),

  // Gauges
  set: metricsStore.set.bind(metricsStore),
  incGauge: metricsStore.incGauge.bind(metricsStore),
  decGauge: metricsStore.decGauge.bind(metricsStore),
  getGauge: metricsStore.getGauge.bind(metricsStore),

  // Histograms
  observe: metricsStore.observe.bind(metricsStore),
  getHistogram: metricsStore.getHistogram.bind(metricsStore),

  // Timing
  startTimer: metricsStore.startTimer.bind(metricsStore),
  endTimer: metricsStore.endTimer.bind(metricsStore),
  time: metricsStore.time.bind(metricsStore),
  timeSync: metricsStore.timeSync.bind(metricsStore),

  // Export
  getSnapshots: metricsStore.getSnapshots.bind(metricsStore),
  toPrometheusFormat: metricsStore.toPrometheusFormat.bind(metricsStore),
  register: metricsStore.register.bind(metricsStore),
  reset: metricsStore.reset.bind(metricsStore),
};

export default metrics;
