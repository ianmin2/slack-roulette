/**
 * Achievement Definitions Tests
 *
 * Tests for achievement definitions and helper functions.
 */

import {
  ACHIEVEMENTS,
  getAchievement,
  getAchievementsByCategory,
} from '../definitions';

describe('ACHIEVEMENTS', () => {
  it('contains at least 15 achievements', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(15);
  });

  it('has unique names for all achievements', () => {
    const names = ACHIEVEMENTS.map(a => a.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length);
  });

  it('has unique display names for all achievements', () => {
    const displayNames = ACHIEVEMENTS.map(a => a.displayName);
    const uniqueDisplayNames = new Set(displayNames);

    expect(uniqueDisplayNames.size).toBe(displayNames.length);
  });

  it('has valid categories for all achievements', () => {
    const validCategories = ['speed', 'quality', 'volume', 'streak', 'special'];

    for (const achievement of ACHIEVEMENTS) {
      expect(validCategories).toContain(achievement.category);
    }
  });

  it('has positive points for all achievements', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.points).toBeGreaterThan(0);
    }
  });

  it('has valid criteria types for all achievements', () => {
    const validTypes = [
      'reviews_completed',
      'avg_response_time',
      'fastest_response',
      'streak',
      'points',
      'skills_used',
      'repos_reviewed',
    ];

    for (const achievement of ACHIEVEMENTS) {
      expect(validTypes).toContain(achievement.criteria.type);
    }
  });

  it('has positive thresholds for all achievements', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.criteria.threshold).toBeGreaterThan(0);
    }
  });

  it('has icons for all achievements', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.icon).toBeTruthy();
      expect(achievement.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('getAchievement', () => {
  it('returns achievement by name', () => {
    const speedDemon = getAchievement('speed_demon');

    expect(speedDemon).toBeDefined();
    expect(speedDemon?.displayName).toBe('Speed Demon');
  });

  it('returns undefined for non-existent achievement', () => {
    const result = getAchievement('non_existent_achievement');

    expect(result).toBeUndefined();
  });

  it('is case-sensitive', () => {
    const result = getAchievement('SPEED_DEMON');

    expect(result).toBeUndefined();
  });
});

describe('getAchievementsByCategory', () => {
  it('returns only speed achievements for speed category', () => {
    const speedAchievements = getAchievementsByCategory('speed');

    expect(speedAchievements.length).toBeGreaterThan(0);
    for (const achievement of speedAchievements) {
      expect(achievement.category).toBe('speed');
    }
  });

  it('returns only volume achievements for volume category', () => {
    const volumeAchievements = getAchievementsByCategory('volume');

    expect(volumeAchievements.length).toBeGreaterThan(0);
    for (const achievement of volumeAchievements) {
      expect(achievement.category).toBe('volume');
    }
  });

  it('returns only streak achievements for streak category', () => {
    const streakAchievements = getAchievementsByCategory('streak');

    expect(streakAchievements.length).toBeGreaterThan(0);
    for (const achievement of streakAchievements) {
      expect(achievement.category).toBe('streak');
    }
  });

  it('returns empty array for non-existent category', () => {
    const result = getAchievementsByCategory('non_existent' as never);

    expect(result).toEqual([]);
  });
});

describe('achievement progression', () => {
  describe('volume achievements have increasing thresholds', () => {
    it('review milestones increase progressively', () => {
      const volumeAchievements = ACHIEVEMENTS
        .filter(a => a.criteria.type === 'reviews_completed')
        .sort((a, b) => a.criteria.threshold - b.criteria.threshold);

      for (let i = 1; i < volumeAchievements.length; i++) {
        expect(volumeAchievements[i].criteria.threshold)
          .toBeGreaterThan(volumeAchievements[i - 1].criteria.threshold);
      }
    });
  });

  describe('streak achievements have increasing thresholds', () => {
    it('streak milestones increase progressively', () => {
      const streakAchievements = ACHIEVEMENTS
        .filter(a => a.criteria.type === 'streak')
        .sort((a, b) => a.criteria.threshold - b.criteria.threshold);

      for (let i = 1; i < streakAchievements.length; i++) {
        expect(streakAchievements[i].criteria.threshold)
          .toBeGreaterThan(streakAchievements[i - 1].criteria.threshold);
      }
    });
  });

  describe('points achievements have increasing thresholds', () => {
    it('point milestones increase progressively', () => {
      const pointsAchievements = ACHIEVEMENTS
        .filter(a => a.criteria.type === 'points')
        .sort((a, b) => a.criteria.threshold - b.criteria.threshold);

      for (let i = 1; i < pointsAchievements.length; i++) {
        expect(pointsAchievements[i].criteria.threshold)
          .toBeGreaterThan(pointsAchievements[i - 1].criteria.threshold);
      }
    });
  });
});

describe('specific achievement criteria', () => {
  it('speed_demon requires fast response time', () => {
    const speedDemon = getAchievement('speed_demon');

    expect(speedDemon?.criteria.type).toBe('fastest_response');
    expect(speedDemon?.criteria.threshold).toBeLessThanOrEqual(30);
  });

  it('first_review requires just 1 review', () => {
    const firstReview = getAchievement('first_review');

    expect(firstReview?.criteria.type).toBe('reviews_completed');
    expect(firstReview?.criteria.threshold).toBe(1);
  });

  it('review_legend requires 100 reviews', () => {
    const legend = getAchievement('review_legend');

    expect(legend?.criteria.type).toBe('reviews_completed');
    expect(legend?.criteria.threshold).toBe(100);
  });
});
