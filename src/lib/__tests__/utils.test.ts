/**
 * Tests for Utility Functions
 */

import { cn, shuffleArray, createPairs, formatDate } from '../utils';

describe('Utility Functions', () => {
  describe('cn', () => {
    it('merges tailwind classes', () => {
      const result = cn('px-2 py-1', 'px-4');
      expect(result).toContain('px-4');
      expect(result).not.toContain('px-2');
    });

    it('handles conditional classes', () => {
      const isActive = true;
      const result = cn('base', isActive && 'active');
      expect(result).toContain('active');
    });

    it('filters falsy values', () => {
      const result = cn('base', false, null, undefined, 'extra');
      expect(result).toBe('base extra');
    });
  });

  describe('shuffleArray', () => {
    it('returns array of same length', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result).toHaveLength(5);
    });

    it('does not modify original array', () => {
      const input = [1, 2, 3, 4, 5];
      const original = [...input];
      shuffleArray(input);
      expect(input).toEqual(original);
    });

    it('contains same elements', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result.sort()).toEqual(input.sort());
    });

    it('handles empty array', () => {
      const result = shuffleArray([]);
      expect(result).toEqual([]);
    });

    it('handles single element array', () => {
      const result = shuffleArray([1]);
      expect(result).toEqual([1]);
    });
  });

  describe('createPairs', () => {
    it('creates pairs from even array', () => {
      const input = ['a', 'b', 'c', 'd'];
      const [pairs, unpaired] = createPairs(input);

      expect(pairs).toHaveLength(2);
      expect(unpaired).toBeNull();

      // Check all elements are accounted for
      const allPaired = pairs.flat();
      expect(allPaired.sort()).toEqual(input.sort());
    });

    it('handles odd array with unpaired element', () => {
      const input = ['a', 'b', 'c'];
      const [pairs, unpaired] = createPairs(input);

      expect(pairs).toHaveLength(1);
      expect(unpaired).not.toBeNull();

      // Check all elements are accounted for
      const allElements = [...pairs.flat(), unpaired!];
      expect(allElements.sort()).toEqual(input.sort());
    });

    it('handles empty array', () => {
      const [pairs, unpaired] = createPairs([]);
      expect(pairs).toEqual([]);
      expect(unpaired).toBeNull();
    });

    it('handles single element array', () => {
      const [pairs, unpaired] = createPairs(['solo']);
      expect(pairs).toEqual([]);
      expect(unpaired).toBe('solo');
    });

    it('handles two elements', () => {
      const [pairs, unpaired] = createPairs(['a', 'b']);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].sort()).toEqual(['a', 'b']);
      expect(unpaired).toBeNull();
    });
  });

  describe('formatDate', () => {
    it('formats date correctly', () => {
      const date = new Date('2024-01-15T10:30:00');
      const result = formatDate(date);

      // Format varies by locale, just check it includes key parts
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      expect(result).toMatch(/2024/);
    });

    it('includes time', () => {
      const date = new Date('2024-01-15T14:30:00');
      const result = formatDate(date);

      // Should include time portion
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });
});
