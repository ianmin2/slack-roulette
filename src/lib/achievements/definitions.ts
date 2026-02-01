/**
 * Achievement Definitions
 *
 * All available achievements and their unlock criteria.
 */

export interface AchievementDefinition {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  category: 'speed' | 'quality' | 'volume' | 'streak' | 'special';
  criteria: AchievementCriteria;
  points: number;
}

export type AchievementCriteria =
  | { type: 'reviews_completed'; threshold: number }
  | { type: 'avg_response_time'; threshold: number } // minutes
  | { type: 'fastest_response'; threshold: number } // minutes
  | { type: 'streak'; threshold: number }
  | { type: 'points'; threshold: number }
  | { type: 'skills_used'; threshold: number }
  | { type: 'repos_reviewed'; threshold: number };

/**
 * All available achievements
 */
export const ACHIEVEMENTS: AchievementDefinition[] = [
  // Speed achievements
  {
    name: 'speed_demon',
    displayName: 'Speed Demon',
    description: 'Complete a review in under 30 minutes',
    icon: '⚡',
    category: 'speed',
    criteria: { type: 'fastest_response', threshold: 30 },
    points: 50,
  },
  {
    name: 'lightning_fast',
    displayName: 'Lightning Fast',
    description: 'Complete a review in under 15 minutes',
    icon: '🌩️',
    category: 'speed',
    criteria: { type: 'fastest_response', threshold: 15 },
    points: 100,
  },
  {
    name: 'consistent_responder',
    displayName: 'Consistent Responder',
    description: 'Maintain an average response time under 2 hours',
    icon: '⏱️',
    category: 'speed',
    criteria: { type: 'avg_response_time', threshold: 120 },
    points: 75,
  },

  // Volume achievements
  {
    name: 'first_review',
    displayName: 'First Steps',
    description: 'Complete your first code review',
    icon: '🎯',
    category: 'volume',
    criteria: { type: 'reviews_completed', threshold: 1 },
    points: 10,
  },
  {
    name: 'getting_started',
    displayName: 'Getting Started',
    description: 'Complete 5 code reviews',
    icon: '🚀',
    category: 'volume',
    criteria: { type: 'reviews_completed', threshold: 5 },
    points: 25,
  },
  {
    name: 'review_veteran',
    displayName: 'Review Veteran',
    description: 'Complete 25 code reviews',
    icon: '🎖️',
    category: 'volume',
    criteria: { type: 'reviews_completed', threshold: 25 },
    points: 100,
  },
  {
    name: 'review_master',
    displayName: 'Review Master',
    description: 'Complete 50 code reviews',
    icon: '👑',
    category: 'volume',
    criteria: { type: 'reviews_completed', threshold: 50 },
    points: 200,
  },
  {
    name: 'review_legend',
    displayName: 'Review Legend',
    description: 'Complete 100 code reviews',
    icon: '🏆',
    category: 'volume',
    criteria: { type: 'reviews_completed', threshold: 100 },
    points: 500,
  },

  // Streak achievements
  {
    name: 'on_a_roll',
    displayName: 'On a Roll',
    description: 'Maintain a 3-review streak',
    icon: '🔥',
    category: 'streak',
    criteria: { type: 'streak', threshold: 3 },
    points: 30,
  },
  {
    name: 'unstoppable',
    displayName: 'Unstoppable',
    description: 'Maintain a 7-review streak',
    icon: '💪',
    category: 'streak',
    criteria: { type: 'streak', threshold: 7 },
    points: 75,
  },
  {
    name: 'iron_reviewer',
    displayName: 'Iron Reviewer',
    description: 'Maintain a 14-review streak',
    icon: '🛡️',
    category: 'streak',
    criteria: { type: 'streak', threshold: 14 },
    points: 150,
  },

  // Quality/Points achievements
  {
    name: 'point_collector',
    displayName: 'Point Collector',
    description: 'Earn 100 points',
    icon: '⭐',
    category: 'quality',
    criteria: { type: 'points', threshold: 100 },
    points: 25,
  },
  {
    name: 'high_scorer',
    displayName: 'High Scorer',
    description: 'Earn 500 points',
    icon: '🌟',
    category: 'quality',
    criteria: { type: 'points', threshold: 500 },
    points: 100,
  },
  {
    name: 'point_master',
    displayName: 'Point Master',
    description: 'Earn 1000 points',
    icon: '💫',
    category: 'quality',
    criteria: { type: 'points', threshold: 1000 },
    points: 250,
  },

  // Special achievements
  {
    name: 'polyglot',
    displayName: 'Polyglot',
    description: 'Review PRs using 5 different skills/languages',
    icon: '🌐',
    category: 'special',
    criteria: { type: 'skills_used', threshold: 5 },
    points: 100,
  },
  {
    name: 'explorer',
    displayName: 'Explorer',
    description: 'Review PRs in 3 different repositories',
    icon: '🗺️',
    category: 'special',
    criteria: { type: 'repos_reviewed', threshold: 3 },
    points: 75,
  },
];

/**
 * Get achievement by name
 */
export const getAchievement = (name: string): AchievementDefinition | undefined =>
  ACHIEVEMENTS.find(a => a.name === name);

/**
 * Get achievements by category
 */
export const getAchievementsByCategory = (
  category: AchievementDefinition['category']
): AchievementDefinition[] =>
  ACHIEVEMENTS.filter(a => a.category === category);
