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

async function main() {
  console.log('🌱 Seeding PR Roulette defaults...\n');

  await seedStatusMappings();
  await seedProblemRules();
  await seedSkills();

  console.log('\n✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
