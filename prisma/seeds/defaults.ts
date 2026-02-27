/**
 * Seed default data for PR Roulette
 * Run with: npx ts-node prisma/seeds/defaults.ts
 */

import { PrismaClient } from '../../src/generated/prisma/index.js';

const prisma = new PrismaClient();

async function seedStatusMappings() {
  console.log('Seeding status reaction mappings...');

  const defaults = [
    {
      status: 'IN_REVIEW' as const,
      emojis: ['eyes', 'eyeglasses', 'speech_balloon', 'comment'],
      displayEmoji: '👀',
      sortOrder: 1,
    },
    {
      status: 'CHANGES_REQUESTED' as const,
      emojis: ['x', 'no_entry', 'no_entry_sign'],
      displayEmoji: '❌',
      sortOrder: 2,
    },
    {
      status: 'APPROVED' as const,
      emojis: ['white_check_mark', 'heavy_check_mark', 'checkmark', '+1', 'thumbsup'],
      displayEmoji: '✅',
      sortOrder: 3,
    },
  ];

  for (const mapping of defaults) {
    await prisma.statusReactionMapping.upsert({
      where: { status: mapping.status },
      create: mapping,
      update: {
        emojis: mapping.emojis,
        displayEmoji: mapping.displayEmoji,
        sortOrder: mapping.sortOrder,
      },
    });
  }

  console.log(`  Created ${defaults.length} status mappings`);
}

async function seedProblemRules() {
  console.log('Seeding problem detection rules...');

  const defaults = [
    {
      name: 'stalled_review',
      description: 'No review activity for 48 hours',
      severity: 'WARNING' as const,
      conditionType: 'NO_ACTIVITY_FOR' as const,
      conditionValue: 48,
      autoNotify: true,
    },
    {
      name: 'stalled_critical',
      description: 'No review activity for 72 hours',
      severity: 'PROBLEM' as const,
      conditionType: 'NO_ACTIVITY_FOR' as const,
      conditionValue: 72,
      autoNotify: true,
    },
    {
      name: 'multiple_rejections',
      description: 'PR rejected 3 or more times',
      severity: 'PROBLEM' as const,
      conditionType: 'REJECTION_COUNT_GTE' as const,
      conditionValue: 3,
      autoNotify: true,
    },
    {
      name: 'reviewer_churn',
      description: 'Reviewer changed 2 or more times',
      severity: 'WARNING' as const,
      conditionType: 'REVIEWER_CHANGES_GTE' as const,
      conditionValue: 2,
      autoNotify: false,
    },
    {
      name: 'ancient_pr',
      description: 'PR open for more than 7 days',
      severity: 'CRITICAL' as const,
      conditionType: 'TOTAL_AGE_GTE' as const,
      conditionValue: 168, // 7 days in hours
      autoNotify: true,
    },
  ];

  for (const rule of defaults) {
    await prisma.problemRule.upsert({
      where: { name: rule.name },
      create: rule,
      update: {
        description: rule.description,
        severity: rule.severity,
        conditionType: rule.conditionType,
        conditionValue: rule.conditionValue,
        autoNotify: rule.autoNotify,
      },
    });
  }

  console.log(`  Created ${defaults.length} problem rules`);
}

async function seedSkills() {
  console.log('Seeding default skills...');

  const skills = [
    { name: 'TypeScript', category: 'language' },
    { name: 'JavaScript', category: 'language' },
    { name: 'Python', category: 'language' },
    { name: 'Go', category: 'language' },
    { name: 'Rust', category: 'language' },
    { name: 'Java', category: 'language' },
    { name: 'React', category: 'frontend' },
    { name: 'Next.js', category: 'frontend' },
    { name: 'Vue', category: 'frontend' },
    { name: 'CSS', category: 'frontend' },
    { name: 'Node.js', category: 'backend' },
    { name: 'PostgreSQL', category: 'database' },
    { name: 'Prisma', category: 'database' },
    { name: 'Docker', category: 'devops' },
    { name: 'Kubernetes', category: 'devops' },
    { name: 'AWS', category: 'devops' },
    { name: 'Testing', category: 'practice' },
    { name: 'Security', category: 'practice' },
  ];

  for (const skill of skills) {
    await prisma.skill.upsert({
      where: { name: skill.name },
      create: skill,
      update: { category: skill.category },
    });
  }

  console.log(`  Created ${skills.length} skills`);
}

async function seedAchievements() {
  console.log('Seeding achievements...');

  const achievements = [
    // Speed
    { name: 'speed_demon', displayName: 'Speed Demon', description: 'Complete a review in under 30 minutes', icon: '⚡', category: 'speed', criteria: { type: 'fastest_response', threshold: 30 } },
    { name: 'lightning_fast', displayName: 'Lightning Fast', description: 'Complete a review in under 15 minutes', icon: '🌩️', category: 'speed', criteria: { type: 'fastest_response', threshold: 15 } },
    { name: 'consistent_responder', displayName: 'Consistent Responder', description: 'Maintain an average response time under 2 hours', icon: '⏱️', category: 'speed', criteria: { type: 'avg_response_time', threshold: 120 } },
    // Volume
    { name: 'first_review', displayName: 'First Steps', description: 'Complete your first code review', icon: '🎯', category: 'volume', criteria: { type: 'reviews_completed', threshold: 1 } },
    { name: 'getting_started', displayName: 'Getting Started', description: 'Complete 5 code reviews', icon: '🚀', category: 'volume', criteria: { type: 'reviews_completed', threshold: 5 } },
    { name: 'review_veteran', displayName: 'Review Veteran', description: 'Complete 25 code reviews', icon: '🎖️', category: 'volume', criteria: { type: 'reviews_completed', threshold: 25 } },
    { name: 'review_master', displayName: 'Review Master', description: 'Complete 50 code reviews', icon: '👑', category: 'volume', criteria: { type: 'reviews_completed', threshold: 50 } },
    { name: 'review_legend', displayName: 'Review Legend', description: 'Complete 100 code reviews', icon: '🏆', category: 'volume', criteria: { type: 'reviews_completed', threshold: 100 } },
    // Streak
    { name: 'on_a_roll', displayName: 'On a Roll', description: 'Maintain a 3-review streak', icon: '🔥', category: 'streak', criteria: { type: 'streak', threshold: 3 } },
    { name: 'unstoppable', displayName: 'Unstoppable', description: 'Maintain a 7-review streak', icon: '💪', category: 'streak', criteria: { type: 'streak', threshold: 7 } },
    { name: 'iron_reviewer', displayName: 'Iron Reviewer', description: 'Maintain a 14-review streak', icon: '🛡️', category: 'streak', criteria: { type: 'streak', threshold: 14 } },
    // Quality
    { name: 'point_collector', displayName: 'Point Collector', description: 'Earn 100 points', icon: '⭐', category: 'quality', criteria: { type: 'points', threshold: 100 } },
    { name: 'high_scorer', displayName: 'High Scorer', description: 'Earn 500 points', icon: '🌟', category: 'quality', criteria: { type: 'points', threshold: 500 } },
    { name: 'point_master', displayName: 'Point Master', description: 'Earn 1000 points', icon: '💫', category: 'quality', criteria: { type: 'points', threshold: 1000 } },
    // Special
    { name: 'polyglot', displayName: 'Polyglot', description: 'Review PRs using 5 different skills/languages', icon: '🌐', category: 'special', criteria: { type: 'skills_used', threshold: 5 } },
    { name: 'explorer', displayName: 'Explorer', description: 'Review PRs in 3 different repositories', icon: '🗺️', category: 'special', criteria: { type: 'repos_reviewed', threshold: 3 } },
  ];

  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: { name: achievement.name },
      create: {
        name: achievement.name,
        displayName: achievement.displayName,
        description: achievement.description,
        icon: achievement.icon,
        category: achievement.category,
        criteria: achievement.criteria,
      },
      update: {
        displayName: achievement.displayName,
        description: achievement.description,
        icon: achievement.icon,
        category: achievement.category,
        criteria: achievement.criteria,
      },
    });
  }

  console.log(`  Created ${achievements.length} achievements`);
}

async function seedAppConfig() {
  console.log('Seeding app configuration...');

  const defaults: { key: string; value: string; description: string }[] = [
    { key: 'default_timezone', value: 'UTC', description: 'Default timezone for new users' },
    { key: 'digest_day', value: 'monday', description: 'Day of week to send weekly digest' },
    { key: 'digest_hour', value: '9', description: 'Hour of day (0-23) to send weekly digest' },
    { key: 'max_pending_reviews', value: '5', description: 'Max pending reviews before a reviewer is considered overloaded' },
    { key: 'points_per_review', value: '10', description: 'Base points awarded per completed review' },
    { key: 'points_speed_bonus_threshold', value: '60', description: 'Minutes under which a speed bonus is awarded' },
    { key: 'points_speed_bonus', value: '5', description: 'Extra points for reviews completed under speed threshold' },
    { key: 'stale_review_hours', value: '48', description: 'Hours after which a review is considered stale' },
    { key: 'problem_check_interval', value: '15', description: 'Minutes between problem detection runs' },
    { key: 'dashboard_enabled', value: 'true', description: 'Whether the web dashboard is enabled' },
  ];

  for (const config of defaults) {
    await prisma.appConfig.upsert({
      where: { key: config.key },
      create: config,
      update: {
        value: config.value,
        description: config.description,
      },
    });
  }

  console.log(`  Created ${defaults.length} config entries`);
}

async function main() {
  console.log('Seeding PR Roulette defaults...\n');

  await seedStatusMappings();
  await seedProblemRules();
  await seedSkills();
  await seedAchievements();
  await seedAppConfig();

  console.log('\nSeed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
