/**
 * Tests for Metrics Collection
 */

import { metrics, metricsStore } from '../metrics';

describe('Metrics Collection', () => {
  beforeEach(() => {
    metrics.reset();
  });

  describe('counters', () => {
    it('increments counter by default value (1)', () => {
      metrics.inc('test_counter');
      expect(metrics.getCounter('test_counter')).toBe(1);

      metrics.inc('test_counter');
      expect(metrics.getCounter('test_counter')).toBe(2);
    });

    it('increments counter by specified value', () => {
      metrics.inc('test_counter', 5);
      expect(metrics.getCounter('test_counter')).toBe(5);

      metrics.inc('test_counter', 3);
      expect(metrics.getCounter('test_counter')).toBe(8);
    });

    it('supports labels', () => {
      metrics.inc('requests', 1, { method: 'GET', status: '200' });
      metrics.inc('requests', 1, { method: 'GET', status: '200' });
      metrics.inc('requests', 1, { method: 'POST', status: '201' });

      expect(metrics.getCounter('requests', { method: 'GET', status: '200' })).toBe(2);
      expect(metrics.getCounter('requests', { method: 'POST', status: '201' })).toBe(1);
    });

    it('returns 0 for non-existent counter', () => {
      expect(metrics.getCounter('non_existent')).toBe(0);
    });
  });

  describe('gauges', () => {
    it('sets gauge value', () => {
      metrics.set('active_connections', 10);
      expect(metrics.getGauge('active_connections')).toBe(10);

      metrics.set('active_connections', 5);
      expect(metrics.getGauge('active_connections')).toBe(5);
    });

    it('increments gauge', () => {
      metrics.set('queue_size', 0);
      metrics.incGauge('queue_size', 3);
      expect(metrics.getGauge('queue_size')).toBe(3);

      metrics.incGauge('queue_size');
      expect(metrics.getGauge('queue_size')).toBe(4);
    });

    it('decrements gauge', () => {
      metrics.set('queue_size', 10);
      metrics.decGauge('queue_size', 3);
      expect(metrics.getGauge('queue_size')).toBe(7);

      metrics.decGauge('queue_size');
      expect(metrics.getGauge('queue_size')).toBe(6);
    });

    it('supports labels', () => {
      metrics.set('memory_usage', 100, { service: 'api' });
      metrics.set('memory_usage', 200, { service: 'worker' });

      expect(metrics.getGauge('memory_usage', { service: 'api' })).toBe(100);
      expect(metrics.getGauge('memory_usage', { service: 'worker' })).toBe(200);
    });

    it('returns 0 for non-existent gauge', () => {
      expect(metrics.getGauge('non_existent')).toBe(0);
    });
  });

  describe('histograms', () => {
    it('observes values', () => {
      metrics.observe('response_time', 50);
      metrics.observe('response_time', 100);
      metrics.observe('response_time', 150);

      const histogram = metrics.getHistogram('response_time');
      expect(histogram).not.toBeNull();
      expect(histogram?.count).toBe(3);
      expect(histogram?.sum).toBe(300);
    });

    it('calculates bucket counts correctly', () => {
      metrics.observe('latency', 5, undefined, [10, 50, 100]);
      metrics.observe('latency', 15, undefined, [10, 50, 100]);
      metrics.observe('latency', 75, undefined, [10, 50, 100]);
      metrics.observe('latency', 200, undefined, [10, 50, 100]);

      const histogram = metrics.getHistogram('latency');
      expect(histogram?.buckets).toEqual([10, 50, 100]);
      expect(histogram?.counts).toEqual([1, 2, 3]); // 5<=10, 5+15<=50, 5+15+75<=100
      expect(histogram?.count).toBe(4);
    });

    it('supports labels', () => {
      metrics.observe('request_duration', 100, { endpoint: '/api/users' });
      metrics.observe('request_duration', 200, { endpoint: '/api/users' });
      metrics.observe('request_duration', 50, { endpoint: '/api/health' });

      const usersHist = metrics.getHistogram('request_duration', { endpoint: '/api/users' });
      const healthHist = metrics.getHistogram('request_duration', { endpoint: '/api/health' });

      expect(usersHist?.count).toBe(2);
      expect(usersHist?.sum).toBe(300);
      expect(healthHist?.count).toBe(1);
    });

    it('returns null for non-existent histogram', () => {
      expect(metrics.getHistogram('non_existent')).toBeNull();
    });
  });

  describe('timing', () => {
    it('measures time with start/end', async () => {
      const timerId = metrics.startTimer('operation');

      // Simulate some work
      await new Promise((r) => setTimeout(r, 50));

      const duration = metrics.endTimer(timerId);

      expect(duration).toBeGreaterThanOrEqual(50);
      expect(duration).toBeLessThan(150); // Allow some slack

      // Should be recorded in histogram
      const histogram = metrics.getHistogram('operation');
      expect(histogram?.count).toBe(1);
    });

    it('returns null for invalid timer', () => {
      const duration = metrics.endTimer('invalid_timer_id');
      expect(duration).toBeNull();
    });

    it('times async functions', async () => {
      const result = await metrics.time('async_op', async () => {
        await new Promise((r) => setTimeout(r, 20));
        return 'done';
      });

      expect(result).toBe('done');

      const histogram = metrics.getHistogram('async_op');
      expect(histogram?.count).toBe(1);
      expect(histogram?.sum).toBeGreaterThanOrEqual(20);
    });

    it('times sync functions', () => {
      const result = metrics.timeSync('sync_op', () => {
        // Simulate work
        let sum = 0;
        for (let i = 0; i < 10000; i++) {
          sum += i;
        }
        return sum;
      });

      expect(result).toBeGreaterThan(0);

      const histogram = metrics.getHistogram('sync_op');
      expect(histogram?.count).toBe(1);
    });

    it('records timing even when function throws', async () => {
      await expect(
        metrics.time('failing_op', async () => {
          throw new Error('Oops');
        })
      ).rejects.toThrow('Oops');

      const histogram = metrics.getHistogram('failing_op');
      expect(histogram?.count).toBe(1);
    });
  });

  describe('snapshots', () => {
    it('returns all metrics as snapshots', () => {
      metrics.inc('counter1', 5);
      metrics.set('gauge1', 10);
      metrics.observe('histogram1', 100);

      const snapshots = metrics.getSnapshots();

      expect(snapshots).toHaveLength(3);

      const counter = snapshots.find((s) => s.name === 'counter1');
      expect(counter?.type).toBe('counter');
      expect(counter?.value).toBe(5);

      const gauge = snapshots.find((s) => s.name === 'gauge1');
      expect(gauge?.type).toBe('gauge');
      expect(gauge?.value).toBe(10);

      const histogram = snapshots.find((s) => s.name === 'histogram1');
      expect(histogram?.type).toBe('histogram');
    });

    it('includes labels in snapshots', () => {
      metrics.inc('labeled_counter', 1, { service: 'api', region: 'us-east' });

      const snapshots = metrics.getSnapshots();
      const counter = snapshots.find((s) => s.name === 'labeled_counter');

      expect(counter?.labels).toEqual({ service: 'api', region: 'us-east' });
    });
  });

  describe('prometheus format', () => {
    it('exports metrics in prometheus format', () => {
      metrics.inc('http_requests', 100, { method: 'GET' });
      metrics.set('active_users_gauge', 42);
      metrics.observe('response_time_ms', 50, undefined, [10, 50, 100]);
      metrics.observe('response_time_ms', 75, undefined, [10, 50, 100]);

      const output = metrics.toPrometheusFormat();

      expect(output).toContain('http_requests');
      expect(output).toContain('100');
      expect(output).toContain('active_users_gauge 42');
      expect(output).toContain('response_time_ms_bucket');
      expect(output).toContain('response_time_ms_sum 125');
      expect(output).toContain('response_time_ms_count 2');
    });
  });

  describe('reset', () => {
    it('clears all metrics', () => {
      metrics.inc('counter', 10);
      metrics.set('gauge', 5);
      metrics.observe('histogram', 100);

      metrics.reset();

      expect(metrics.getCounter('counter')).toBe(0);
      expect(metrics.getGauge('gauge')).toBe(0);
      expect(metrics.getHistogram('histogram')).toBeNull();
    });
  });

  describe('register', () => {
    it('registers metric definitions', () => {
      metrics.register({
        name: 'custom_metric',
        type: 'counter',
        description: 'A custom metric',
        labels: ['label1', 'label2'],
      });

      // Can use the metric
      metrics.inc('custom_metric', 1, { label1: 'a', label2: 'b' });
      expect(metrics.getCounter('custom_metric', { label1: 'a', label2: 'b' })).toBe(1);
    });
  });

  describe('label ordering', () => {
    it('treats labels with same values as identical regardless of order', () => {
      metrics.inc('ordered_test', 1, { a: '1', b: '2' });
      metrics.inc('ordered_test', 1, { b: '2', a: '1' });

      // Both should increment the same counter
      expect(metrics.getCounter('ordered_test', { a: '1', b: '2' })).toBe(2);
      expect(metrics.getCounter('ordered_test', { b: '2', a: '1' })).toBe(2);
    });
  });
});
