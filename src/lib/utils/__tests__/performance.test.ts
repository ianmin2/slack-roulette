/**
 * Tests for Performance Monitoring
 */

import { perf, performanceMonitor } from '../performance';

describe('Performance Monitoring', () => {
  beforeEach(() => {
    perf.reset();
  });

  describe('startSpan and endSpan', () => {
    it('creates and ends a span', () => {
      const spanId = perf.startSpan('test_operation');

      expect(spanId).toMatch(/^span_\d+_\d+$/);

      const entry = perf.endSpan(spanId);

      expect(entry).toBeDefined();
      expect(entry?.name).toBe('test_operation');
      expect(entry?.duration).toBeGreaterThanOrEqual(0);
      expect(entry?.success).toBe(true);
    });

    it('tracks operation type', () => {
      const spanId = perf.startSpan('db_query', 'db');
      const entry = perf.endSpan(spanId);

      expect(entry?.type).toBe('db');
    });

    it('includes metadata', () => {
      const spanId = perf.startSpan('api_call', 'external', { endpoint: '/users' });
      const entry = perf.endSpan(spanId);

      expect(entry?.metadata?.endpoint).toBe('/users');
    });

    it('records errors', () => {
      const spanId = perf.startSpan('failing_op');
      const entry = perf.endSpan(spanId, { success: false, error: 'Connection timeout' });

      expect(entry?.success).toBe(false);
      expect(entry?.error).toBe('Connection timeout');
    });

    it('returns null for non-existent span', () => {
      const entry = perf.endSpan('non_existent_span');
      expect(entry).toBeNull();
    });
  });

  describe('measure', () => {
    it('measures async function duration', async () => {
      const result = await perf.measure(
        'async_operation',
        async () => {
          await new Promise((r) => setTimeout(r, 20));
          return 'result';
        },
        'custom'
      );

      expect(result).toBe('result');

      const summary = perf.getSummary('async_operation');
      expect(summary).toBeDefined();
      expect(summary?.count).toBe(1);
      expect(summary?.avgMs).toBeGreaterThanOrEqual(15); // Allow some timing variance
    });

    it('records success on completion', async () => {
      await perf.measure('successful_op', async () => 'ok');

      const summary = perf.getSummary('successful_op');
      expect(summary?.errorRate).toBe(0);
    });

    it('records error and rethrows', async () => {
      await expect(
        perf.measure('failing_op', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      const summary = perf.getSummary('failing_op');
      expect(summary?.errorRate).toBe(1);
    });
  });

  describe('measureSync', () => {
    it('measures sync function duration', () => {
      const result = perf.measureSync('sync_operation', () => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += i;
        return sum;
      });

      expect(result).toBeGreaterThan(0);

      const summary = perf.getSummary('sync_operation');
      expect(summary?.count).toBe(1);
    });

    it('records error on throw', () => {
      expect(() =>
        perf.measureSync('failing_sync', () => {
          throw new Error('Sync error');
        })
      ).toThrow('Sync error');

      const summary = perf.getSummary('failing_sync');
      expect(summary?.errorRate).toBe(1);
    });
  });

  describe('getSummary', () => {
    beforeEach(async () => {
      // Create some performance data
      await perf.measure('test_op', async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      await perf.measure('test_op', async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      await perf.measure('test_op', async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    });

    it('calculates count correctly', () => {
      const summary = perf.getSummary('test_op');
      expect(summary?.count).toBe(3);
    });

    it('calculates avg correctly', () => {
      const summary = perf.getSummary('test_op');
      expect(summary?.avgMs).toBeGreaterThanOrEqual(15);
    });

    it('calculates min and max', () => {
      const summary = perf.getSummary('test_op');
      expect(summary?.minMs).toBeGreaterThanOrEqual(10);
      expect(summary?.maxMs).toBeGreaterThanOrEqual(30);
    });

    it('calculates percentiles', () => {
      const summary = perf.getSummary('test_op');
      expect(summary?.p50Ms).toBeGreaterThanOrEqual(10);
      expect(summary?.p95Ms).toBeGreaterThanOrEqual(20);
      expect(summary?.p99Ms).toBeGreaterThanOrEqual(20);
    });

    it('returns null for unknown operation', () => {
      const summary = perf.getSummary('unknown_op');
      expect(summary).toBeNull();
    });
  });

  describe('getAllSummaries', () => {
    it('returns summaries for all operations', async () => {
      await perf.measure('op1', async () => {});
      await perf.measure('op2', async () => {});
      await perf.measure('op1', async () => {});

      const summaries = perf.getAllSummaries();

      expect(summaries).toHaveLength(2);
      expect(summaries[0].name).toBe('op1'); // Most used first
      expect(summaries[0].count).toBe(2);
    });
  });

  describe('getSlowOperations', () => {
    it('returns operations exceeding threshold', async () => {
      await perf.measure('fast_op', async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      await perf.measure('slow_op', async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const slow = perf.getSlowOperations(30);

      expect(slow).toHaveLength(1);
      expect(slow[0].name).toBe('slow_op');
    });
  });

  describe('getRecentErrors', () => {
    it('returns only failed operations', async () => {
      await perf.measure('success', async () => 'ok');

      try {
        await perf.measure('failure', async () => {
          throw new Error('Oops');
        });
      } catch {
        // Expected
      }

      const errors = perf.getRecentErrors();

      expect(errors).toHaveLength(1);
      expect(errors[0].name).toBe('failure');
    });
  });

  describe('setThreshold', () => {
    it('allows custom thresholds', async () => {
      perf.setThreshold({
        name: 'custom_op',
        warningMs: 10,
        criticalMs: 50,
      });

      // This would trigger threshold checks internally
      await perf.measure('custom_op', async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      const summary = perf.getSummary('custom_op');
      expect(summary?.count).toBe(1);
    });
  });

  describe('clear and reset', () => {
    it('clear removes all entries', async () => {
      await perf.measure('op', async () => {});
      perf.clear();

      const summaries = perf.getAllSummaries();
      expect(summaries).toHaveLength(0);
    });

    it('reset restores default state', async () => {
      perf.setThreshold({ name: 'custom', warningMs: 1, criticalMs: 2 });
      await perf.measure('op', async () => {});

      perf.reset();

      expect(perf.getAllSummaries()).toHaveLength(0);
    });
  });
});
