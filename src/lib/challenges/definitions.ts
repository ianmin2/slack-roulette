/**
 * Challenge Definitions
 *
 * Preset challenges for weekly rotation and custom challenges.
 * Challenges differ from achievements: they're time-boxed, can be team-wide,
 * and rotate on a schedule.
 */

import type {
  ChallengeType,
  ChallengeScope,
  RewardType,
} from '@/generated/prisma';

export interface ChallengePreset {
  name: string;
  displayName: string;
  description: string;
  type: ChallengeType;
  scope: ChallengeScope;
  target: number;
  targetMeta?: Record<string, unknown>;
  rewardType: RewardType;
  rewardValue: number;
  rewardDesc: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

/**
 * Preset challenges available for rotation
 */
export const CHALLENGE_PRESETS: ChallengePreset[] = [
  // Speed Challenges
  {
    name: 'lightning_week',
    displayName: 'Lightning Week',
    description: 'Complete all your reviews in under 2 hours',
    type: 'FAST_REVIEWS',
    scope: 'INDIVIDUAL',
    target: 5,
    targetMeta: { maxMinutes: 120 },
    rewardType: 'POINTS',
    rewardValue: 150,
    rewardDesc: '+150 bonus points',
    difficulty: 'hard',
  },
  {
    name: 'speed_sprint',
    displayName: 'Speed Sprint',
    description: 'Complete 3 reviews in under 1 hour each',
    type: 'FAST_REVIEWS',
    scope: 'INDIVIDUAL',
    target: 3,
    targetMeta: { maxMinutes: 60 },
    rewardType: 'POINTS',
    rewardValue: 75,
    rewardDesc: '+75 bonus points',
    difficulty: 'medium',
  },
  {
    name: 'quick_responder',
    displayName: 'Quick Responder',
    description: 'Maintain average response time under 30 minutes',
    type: 'RESPONSE_TIME_AVG',
    scope: 'INDIVIDUAL',
    target: 30,
    rewardType: 'POINTS',
    rewardValue: 100,
    rewardDesc: '+100 bonus points',
    difficulty: 'hard',
  },

  // Volume Challenges
  {
    name: 'review_marathon',
    displayName: 'Review Marathon',
    description: 'Complete 10 code reviews this week',
    type: 'REVIEWS_COMPLETED',
    scope: 'INDIVIDUAL',
    target: 10,
    rewardType: 'POINTS',
    rewardValue: 100,
    rewardDesc: '+100 bonus points',
    difficulty: 'medium',
  },
  {
    name: 'review_blitz',
    displayName: 'Review Blitz',
    description: 'Complete 5 code reviews this week',
    type: 'REVIEWS_COMPLETED',
    scope: 'INDIVIDUAL',
    target: 5,
    rewardType: 'POINTS',
    rewardValue: 50,
    rewardDesc: '+50 bonus points',
    difficulty: 'easy',
  },
  {
    name: 'team_effort',
    displayName: 'Team Effort',
    description: 'Team completes 25 reviews collectively',
    type: 'TEAM_REVIEWS',
    scope: 'TEAM',
    target: 25,
    rewardType: 'POINTS',
    rewardValue: 50,
    rewardDesc: '+50 bonus points for all participants',
    difficulty: 'medium',
  },
  {
    name: 'team_surge',
    displayName: 'Team Surge',
    description: 'Team completes 50 reviews collectively',
    type: 'TEAM_REVIEWS',
    scope: 'TEAM',
    target: 50,
    rewardType: 'POINTS',
    rewardValue: 100,
    rewardDesc: '+100 bonus points for all participants',
    difficulty: 'hard',
  },

  // Streak Challenges
  {
    name: 'consistency_king',
    displayName: 'Consistency King',
    description: 'Maintain a 5-day review streak',
    type: 'STREAK_DAYS',
    scope: 'INDIVIDUAL',
    target: 5,
    rewardType: 'POINTS',
    rewardValue: 75,
    rewardDesc: '+75 bonus points',
    difficulty: 'medium',
  },
  {
    name: 'iron_will',
    displayName: 'Iron Will',
    description: 'Maintain a 7-day review streak',
    type: 'STREAK_DAYS',
    scope: 'INDIVIDUAL',
    target: 7,
    rewardType: 'BADGE',
    rewardValue: 1,
    rewardDesc: 'Iron Will badge',
    difficulty: 'hard',
  },

  // Points Challenges
  {
    name: 'point_hunter',
    displayName: 'Point Hunter',
    description: 'Earn 200 points this week',
    type: 'POINTS_EARNED',
    scope: 'INDIVIDUAL',
    target: 200,
    rewardType: 'POINTS',
    rewardValue: 50,
    rewardDesc: '+50 bonus points',
    difficulty: 'medium',
  },
  {
    name: 'point_master',
    displayName: 'Point Master',
    description: 'Earn 500 points this week',
    type: 'POINTS_EARNED',
    scope: 'INDIVIDUAL',
    target: 500,
    rewardType: 'POINTS',
    rewardValue: 125,
    rewardDesc: '+125 bonus points',
    difficulty: 'hard',
  },

  // Cleanup Challenges
  {
    name: 'clean_slate',
    displayName: 'Clean Slate',
    description: 'End the week with zero pending reviews',
    type: 'ZERO_PENDING',
    scope: 'INDIVIDUAL',
    target: 0,
    rewardType: 'POINTS',
    rewardValue: 75,
    rewardDesc: '+75 bonus points',
    difficulty: 'medium',
  },
  {
    name: 'inbox_zero',
    displayName: 'Inbox Zero',
    description: 'Team ends the week with zero pending reviews',
    type: 'ZERO_PENDING',
    scope: 'TEAM',
    target: 0,
    rewardType: 'POINTS',
    rewardValue: 100,
    rewardDesc: '+100 bonus points for all',
    difficulty: 'hard',
  },
];

/**
 * Weekly rotation schedule
 * Maps week number (1-52) to challenge presets
 * Uses a mix of difficulties to keep things interesting
 */
const ROTATION_PATTERN: Array<{ individual: string; team: string }> = [
  { individual: 'review_blitz', team: 'team_effort' },
  { individual: 'speed_sprint', team: 'team_effort' },
  { individual: 'consistency_king', team: 'team_surge' },
  { individual: 'lightning_week', team: 'inbox_zero' },
  { individual: 'point_hunter', team: 'team_effort' },
  { individual: 'review_marathon', team: 'team_surge' },
  { individual: 'quick_responder', team: 'team_effort' },
  { individual: 'clean_slate', team: 'inbox_zero' },
  { individual: 'iron_will', team: 'team_surge' },
  { individual: 'point_master', team: 'team_effort' },
];

/**
 * Get the challenge preset for a given week
 */
export const getWeekChallenges = (weekNumber: number): {
  individual: ChallengePreset;
  team: ChallengePreset;
} => {
  const index = (weekNumber - 1) % ROTATION_PATTERN.length;
  const pattern = ROTATION_PATTERN[index];

  const individual = CHALLENGE_PRESETS.find(c => c.name === pattern.individual);
  const team = CHALLENGE_PRESETS.find(c => c.name === pattern.team);

  if (!individual || !team) {
    throw new Error(`Invalid rotation pattern for week ${weekNumber}`);
  }

  return { individual, team };
};

/**
 * Get a challenge preset by name
 */
export const getChallengePreset = (name: string): ChallengePreset | undefined =>
  CHALLENGE_PRESETS.find(c => c.name === name);

/**
 * Get all presets by difficulty
 */
export const getChallengesByDifficulty = (
  difficulty: ChallengePreset['difficulty']
): ChallengePreset[] =>
  CHALLENGE_PRESETS.filter(c => c.difficulty === difficulty);

/**
 * Get all presets by scope
 */
export const getChallengesByScope = (
  scope: ChallengeScope
): ChallengePreset[] =>
  CHALLENGE_PRESETS.filter(c => c.scope === scope);

/**
 * Calculate week number and dates for a given date
 */
export const getWeekInfo = (date: Date = new Date()): {
  weekNumber: number;
  year: number;
  startDate: Date;
  endDate: Date;
} => {
  const d = new Date(date);

  // Get ISO week number
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNumber = 1 + Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  );

  // Calculate week start (Monday) and end (Sunday)
  const dayOfWeek = date.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const startDate = new Date(date);
  startDate.setDate(date.getDate() + mondayOffset);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  endDate.setHours(23, 59, 59, 999);

  return {
    weekNumber,
    year: d.getFullYear(),
    startDate,
    endDate,
  };
};

/**
 * Get difficulty emoji
 */
export const getDifficultyEmoji = (difficulty: ChallengePreset['difficulty']): string => {
  const emojis: Record<ChallengePreset['difficulty'], string> = {
    easy: '🟢',
    medium: '🟡',
    hard: '🔴',
  };
  return emojis[difficulty];
};

/**
 * Get scope icon
 */
export const getScopeIcon = (scope: ChallengeScope): string => {
  const icons: Record<ChallengeScope, string> = {
    INDIVIDUAL: '👤',
    TEAM: '👥',
    REPOSITORY: '📦',
  };
  return icons[scope];
};
