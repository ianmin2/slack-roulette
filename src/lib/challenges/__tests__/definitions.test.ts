/**
 * Challenge Definitions Tests
 *
 * Tests for challenge presets and helper functions.
 */

import {
  CHALLENGE_PRESETS,
  getChallengePreset,
  getChallengesByDifficulty,
  getChallengesByScope,
  getWeekChallenges,
  getWeekInfo,
  getDifficultyEmoji,
  getScopeIcon,
} from '../definitions';

describe('CHALLENGE_PRESETS', () => {
  it('contains at least 10 challenge presets', () => {
    expect(CHALLENGE_PRESETS.length).toBeGreaterThanOrEqual(10);
  });

  it('has unique names for all presets', () => {
    const names = CHALLENGE_PRESETS.map(c => c.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length);
  });

  it('has unique display names for all presets', () => {
    const displayNames = CHALLENGE_PRESETS.map(c => c.displayName);
    const uniqueDisplayNames = new Set(displayNames);

    expect(uniqueDisplayNames.size).toBe(displayNames.length);
  });

  it('has valid challenge types for all presets', () => {
    const validTypes = [
      'REVIEWS_COMPLETED',
      'FAST_REVIEWS',
      'STREAK_DAYS',
      'POINTS_EARNED',
      'TEAM_REVIEWS',
      'RESPONSE_TIME_AVG',
      'ZERO_PENDING',
    ];

    for (const preset of CHALLENGE_PRESETS) {
      expect(validTypes).toContain(preset.type);
    }
  });

  it('has valid scopes for all presets', () => {
    const validScopes = ['INDIVIDUAL', 'TEAM', 'REPOSITORY'];

    for (const preset of CHALLENGE_PRESETS) {
      expect(validScopes).toContain(preset.scope);
    }
  });

  it('has valid difficulties for all presets', () => {
    const validDifficulties = ['easy', 'medium', 'hard'];

    for (const preset of CHALLENGE_PRESETS) {
      expect(validDifficulties).toContain(preset.difficulty);
    }
  });

  it('has positive targets for all presets', () => {
    for (const preset of CHALLENGE_PRESETS) {
      expect(preset.target).toBeGreaterThanOrEqual(0);
    }
  });

  it('has positive reward values for all presets', () => {
    for (const preset of CHALLENGE_PRESETS) {
      expect(preset.rewardValue).toBeGreaterThanOrEqual(0);
    }
  });

  it('has valid reward types for all presets', () => {
    const validRewardTypes = ['POINTS', 'BADGE', 'ACHIEVEMENT'];

    for (const preset of CHALLENGE_PRESETS) {
      expect(validRewardTypes).toContain(preset.rewardType);
    }
  });

  it('has descriptions for all presets', () => {
    for (const preset of CHALLENGE_PRESETS) {
      expect(preset.description).toBeTruthy();
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it('has reward descriptions for all presets', () => {
    for (const preset of CHALLENGE_PRESETS) {
      expect(preset.rewardDesc).toBeTruthy();
      expect(preset.rewardDesc.length).toBeGreaterThan(0);
    }
  });
});

describe('getChallengePreset', () => {
  it('returns preset by name', () => {
    const lightningWeek = getChallengePreset('lightning_week');

    expect(lightningWeek).toBeDefined();
    expect(lightningWeek?.displayName).toBe('Lightning Week');
  });

  it('returns undefined for non-existent preset', () => {
    const result = getChallengePreset('non_existent_preset');

    expect(result).toBeUndefined();
  });

  it('is case-sensitive', () => {
    const result = getChallengePreset('LIGHTNING_WEEK');

    expect(result).toBeUndefined();
  });
});

describe('getChallengesByDifficulty', () => {
  it('returns only easy challenges for easy difficulty', () => {
    const easy = getChallengesByDifficulty('easy');

    expect(easy.length).toBeGreaterThan(0);
    for (const challenge of easy) {
      expect(challenge.difficulty).toBe('easy');
    }
  });

  it('returns only medium challenges for medium difficulty', () => {
    const medium = getChallengesByDifficulty('medium');

    expect(medium.length).toBeGreaterThan(0);
    for (const challenge of medium) {
      expect(challenge.difficulty).toBe('medium');
    }
  });

  it('returns only hard challenges for hard difficulty', () => {
    const hard = getChallengesByDifficulty('hard');

    expect(hard.length).toBeGreaterThan(0);
    for (const challenge of hard) {
      expect(challenge.difficulty).toBe('hard');
    }
  });
});

describe('getChallengesByScope', () => {
  it('returns only individual challenges for INDIVIDUAL scope', () => {
    const individual = getChallengesByScope('INDIVIDUAL');

    expect(individual.length).toBeGreaterThan(0);
    for (const challenge of individual) {
      expect(challenge.scope).toBe('INDIVIDUAL');
    }
  });

  it('returns only team challenges for TEAM scope', () => {
    const team = getChallengesByScope('TEAM');

    expect(team.length).toBeGreaterThan(0);
    for (const challenge of team) {
      expect(challenge.scope).toBe('TEAM');
    }
  });
});

describe('getWeekChallenges', () => {
  it('returns both individual and team challenges', () => {
    const { individual, team } = getWeekChallenges(1);

    expect(individual).toBeDefined();
    expect(team).toBeDefined();
    expect(individual.scope).toBe('INDIVIDUAL');
    expect(team.scope).toBe('TEAM');
  });

  it('returns valid presets for any week number', () => {
    for (let week = 1; week <= 52; week++) {
      const { individual, team } = getWeekChallenges(week);

      expect(individual).toBeDefined();
      expect(team).toBeDefined();
      expect(CHALLENGE_PRESETS).toContainEqual(individual);
      expect(CHALLENGE_PRESETS).toContainEqual(team);
    }
  });

  it('cycles through presets for weeks beyond rotation pattern', () => {
    const week1 = getWeekChallenges(1);
    const week11 = getWeekChallenges(11);

    // Week 11 should match week 1 in a 10-week rotation
    expect(week1.individual.name).toBe(week11.individual.name);
    expect(week1.team.name).toBe(week11.team.name);
  });
});

describe('getWeekInfo', () => {
  it('returns correct week number for a known date', () => {
    const date = new Date('2026-02-01');
    const info = getWeekInfo(date);

    expect(info.weekNumber).toBeGreaterThanOrEqual(1);
    expect(info.weekNumber).toBeLessThanOrEqual(53);
    expect(info.year).toBe(2026);
  });

  it('returns start date as a Monday', () => {
    const info = getWeekInfo(new Date());

    expect(info.startDate.getDay()).toBe(1); // Monday
  });

  it('returns end date as a Sunday', () => {
    const info = getWeekInfo(new Date());

    expect(info.endDate.getDay()).toBe(0); // Sunday
  });

  it('end date is exactly 6 days after start date', () => {
    const info = getWeekInfo(new Date());

    const diffMs = info.endDate.getTime() - info.startDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    expect(diffDays).toBe(6);
  });

  it('uses current date when no date provided', () => {
    const info = getWeekInfo();

    expect(info.year).toBeGreaterThanOrEqual(2026);
    expect(info.weekNumber).toBeGreaterThanOrEqual(1);
  });
});

describe('getDifficultyEmoji', () => {
  it('returns green for easy', () => {
    expect(getDifficultyEmoji('easy')).toBe('🟢');
  });

  it('returns yellow for medium', () => {
    expect(getDifficultyEmoji('medium')).toBe('🟡');
  });

  it('returns red for hard', () => {
    expect(getDifficultyEmoji('hard')).toBe('🔴');
  });
});

describe('getScopeIcon', () => {
  it('returns person icon for INDIVIDUAL', () => {
    expect(getScopeIcon('INDIVIDUAL')).toBe('👤');
  });

  it('returns group icon for TEAM', () => {
    expect(getScopeIcon('TEAM')).toBe('👥');
  });

  it('returns package icon for REPOSITORY', () => {
    expect(getScopeIcon('REPOSITORY')).toBe('📦');
  });
});

describe('challenge types coverage', () => {
  it('has at least one preset for each challenge type', () => {
    const types = [
      'REVIEWS_COMPLETED',
      'FAST_REVIEWS',
      'STREAK_DAYS',
      'POINTS_EARNED',
      'TEAM_REVIEWS',
      'ZERO_PENDING',
    ];

    for (const type of types) {
      const presetsOfType = CHALLENGE_PRESETS.filter(p => p.type === type);
      expect(presetsOfType.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('specific challenge criteria', () => {
  it('lightning_week requires fast reviews under 2 hours', () => {
    const challenge = getChallengePreset('lightning_week');

    expect(challenge?.type).toBe('FAST_REVIEWS');
    expect(challenge?.targetMeta?.maxMinutes).toBe(120);
  });

  it('review_blitz requires 5 reviews', () => {
    const challenge = getChallengePreset('review_blitz');

    expect(challenge?.type).toBe('REVIEWS_COMPLETED');
    expect(challenge?.target).toBe(5);
  });

  it('team_effort is a team challenge', () => {
    const challenge = getChallengePreset('team_effort');

    expect(challenge?.scope).toBe('TEAM');
    expect(challenge?.type).toBe('TEAM_REVIEWS');
  });

  it('clean_slate requires zero pending', () => {
    const challenge = getChallengePreset('clean_slate');

    expect(challenge?.type).toBe('ZERO_PENDING');
    expect(challenge?.target).toBe(0);
  });
});
