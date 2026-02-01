/**
 * Performance Monitoring
 *
 * Tracks application performance metrics including response times,
 * database query performance, and resource utilization.
 */

import { createLogger } from './logger';
import { metrics } from './metrics';

const log = createLogger('performance');

// =============================================================================
// TYPES
// =============================================================================

export interface PerformanceEntry {
  id: string;
  name: string;
  type: 'http' | 'db' | 'external' | 'custom';
  startTime: number;
  duration: number;
  metadata?: Record<string, unknown>;
  success: boolean;
  error?: string;
}

export interface PerformanceThreshold {
  name: string;
  warningMs: number;
  criticalMs: number;
}

export interface PerformanceSummary {
  name: string;
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_THRESHOLDS: PerformanceThreshold[] = [
  { name: 'http_request', warningMs: 500, criticalMs: 2000 },
  { name: 'db_query', warningMs: 100, criticalMs: 500 },
  { name: 'external_api', warningMs: 1000, criticalMs: 5000 },
];

// =============================================================================
// PERFORMANCE MONITOR
// =============================================================================

class PerformanceMonitor {
  private entries: PerformanceEntry[] = [];
  private thresholds = new Map<string, PerformanceThreshold>();
  private activeSpans = new Map<string, { name: string; type: string; startTime: number; metadata?: Record<string, unknown> }>();
  private entryIdCounter = 0;
  private maxEntries = 10000;

  constructor() {
    for (const threshold of DEFAULT_THRESHOLDS) {
      this.thresholds.set(threshold.name, threshold);
    }
  }

  /**
   * Start a performance measurement span
   */
  startSpan(
    name: string,
    type: 'http' | 'db' | 'external' | 'custom' = 'custom',
    metadata?: Record<string, unknown>
  ): string {
    const spanId = `span_${Date.now()}_${++this.entryIdCounter}`;
    this.activeSpans.set(spanId, {
      name,
      type,
      startTime: performance.now(),
      metadata,
    });
    return spanId;
  }

  /**
   * End a performance measurement span
   */
  endSpan(spanId: string, options?: { success?: boolean; error?: string }): PerformanceEntry | null {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      log.warn('Attempted to end non-existent span', { spanId });
      return null;
    }

    this.activeSpans.delete(spanId);
    const duration = performance.now() - span.startTime;
    const { success = true, error } = options ?? {};

    const entry: PerformanceEntry = {
      id: spanId,
      name: span.name,
      type: span.type as 'http' | 'db' | 'external' | 'custom',
      startTime: span.startTime,
      duration,
      metadata: span.metadata,
      success,
      error,
    };

    this.recordEntry(entry);
    return entry;
  }

  /**
   * Record a performance entry
   */
  private recordEntry(entry: PerformanceEntry): void {
    this.entries.push(entry);
    this.trimEntries();

    // Update metrics
    metrics.observe(`perf_${entry.type}_duration_ms`, entry.duration, {
      name: entry.name,
      success: String(entry.success),
    });

    // Check thresholds
    this.checkThreshold(entry);
  }

  /**
   * Trim old entries
   */
  private trimEntries(): void {
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * Check performance against thresholds
   */
  private checkThreshold(entry: PerformanceEntry): void {
    const threshold = this.thresholds.get(entry.type) ?? this.thresholds.get(entry.name);
    if (!threshold) return;

    if (entry.duration >= threshold.criticalMs) {
      log.error('Critical performance threshold exceeded', new Error('Performance critical'), {
        name: entry.name,
        type: entry.type,
        duration: entry.duration,
        threshold: threshold.criticalMs,
      });
      metrics.inc('perf_threshold_exceeded', 1, { level: 'critical', name: entry.name });
    } else if (entry.duration >= threshold.warningMs) {
      log.warn('Performance warning threshold exceeded', {
        name: entry.name,
        type: entry.type,
        duration: entry.duration,
        threshold: threshold.warningMs,
      });
      metrics.inc('perf_threshold_exceeded', 1, { level: 'warning', name: entry.name });
    }
  }

  /**
   * Set a custom threshold
   */
  setThreshold(threshold: PerformanceThreshold): void {
    this.thresholds.set(threshold.name, threshold);
  }

  /**
   * Measure an async function
   */
  async measure<T>(
    name: string,
    fn: () => Promise<T>,
    type: 'http' | 'db' | 'external' | 'custom' = 'custom',
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const spanId = this.startSpan(name, type, metadata);
    try {
      const result = await fn();
      this.endSpan(spanId, { success: true });
      return result;
    } catch (error) {
      this.endSpan(spanId, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Measure a sync function
   */
  measureSync<T>(
    name: string,
    fn: () => T,
    type: 'http' | 'db' | 'external' | 'custom' = 'custom',
    metadata?: Record<string, unknown>
  ): T {
    const spanId = this.startSpan(name, type, metadata);
    try {
      const result = fn();
      this.endSpan(spanId, { success: true });
      return result;
    } catch (error) {
      this.endSpan(spanId, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get performance summary for a specific operation
   */
  getSummary(name: string, since?: Date): PerformanceSummary | null {
    const cutoff = since?.getTime() ?? 0;
    const matching = this.entries.filter(
      (e) => e.name === name && e.startTime >= cutoff
    );

    if (matching.length === 0) return null;

    const durations = matching.map((e) => e.duration).sort((a, b) => a - b);
    const errors = matching.filter((e) => !e.success).length;

    return {
      name,
      count: matching.length,
      totalMs: durations.reduce((a, b) => a + b, 0),
      avgMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      minMs: durations[0],
      maxMs: durations[durations.length - 1],
      p50Ms: this.percentile(durations, 50),
      p95Ms: this.percentile(durations, 95),
      p99Ms: this.percentile(durations, 99),
      errorRate: errors / matching.length,
    };
  }

  /**
   * Get all summaries
   */
  getAllSummaries(since?: Date): PerformanceSummary[] {
    const names = new Set(this.entries.map((e) => e.name));
    const summaries: PerformanceSummary[] = [];

    for (const name of names) {
      const summary = this.getSummary(name, since);
      if (summary) summaries.push(summary);
    }

    return summaries.sort((a, b) => b.count - a.count);
  }

  /**
   * Calculate percentile
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get recent slow operations
   */
  getSlowOperations(thresholdMs: number, limit = 20): PerformanceEntry[] {
    return this.entries
      .filter((e) => e.duration >= thresholdMs)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit = 20): PerformanceEntry[] {
    return this.entries
      .filter((e) => !e.success)
      .slice(-limit)
      .reverse();
  }

  /**
   * Clear entries (for testing)
   */
  clear(): void {
    this.entries = [];
    this.activeSpans.clear();
  }

  /**
   * Reset (for testing)
   */
  reset(): void {
    this.clear();
    this.thresholds.clear();
    for (const threshold of DEFAULT_THRESHOLDS) {
      this.thresholds.set(threshold.name, threshold);
    }
    this.entryIdCounter = 0;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const performanceMonitor = new PerformanceMonitor();

// =============================================================================
// EXPORTS
// =============================================================================

export const perf = {
  startSpan: performanceMonitor.startSpan.bind(performanceMonitor),
  endSpan: performanceMonitor.endSpan.bind(performanceMonitor),
  measure: performanceMonitor.measure.bind(performanceMonitor),
  measureSync: performanceMonitor.measureSync.bind(performanceMonitor),
  setThreshold: performanceMonitor.setThreshold.bind(performanceMonitor),
  getSummary: performanceMonitor.getSummary.bind(performanceMonitor),
  getAllSummaries: performanceMonitor.getAllSummaries.bind(performanceMonitor),
  getSlowOperations: performanceMonitor.getSlowOperations.bind(performanceMonitor),
  getRecentErrors: performanceMonitor.getRecentErrors.bind(performanceMonitor),
  clear: performanceMonitor.clear.bind(performanceMonitor),
  reset: performanceMonitor.reset.bind(performanceMonitor),
};

export default perf;
