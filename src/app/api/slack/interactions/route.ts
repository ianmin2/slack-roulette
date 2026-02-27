/**
 * Slack Interactions Endpoint
 *
 * Handles interactive components:
 * - Block actions (button clicks, select changes)
 * - Modal submissions
 * - Shortcuts
 *
 * All quick action buttons open modals with real content
 * instead of redirecting to slash commands.
 */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { publishAppHome } from '@/lib/slack/views/app-home';
import { verifySlackSignature, getBotToken } from '@/lib/slack/security';
import { getUserAchievements, ACHIEVEMENTS } from '@/lib/achievements';
import { getActiveChallenges, formatChallengeDisplay, getWeekInfo } from '@/lib/challenges';
import { generateWeeklyDigest } from '@/lib/digest';
import {
  generateBottleneckReport,
  formatBottleneckReportForSlack,
} from '@/lib/analytics';
import { syncChannelMembers, formatSyncReport } from '@/lib/sync';
import { sendWeeklyDigest, generateWeeklyDigest as generateDigestForSend } from '@/lib/digest';
import { createLogger } from '@/lib/utils/logger';
import {
  buildEditRepositoryModal,
  parseEditRepositorySubmission,
} from '@/lib/slack/views/modals/edit-repository';
import {
  buildEditUserModal,
  parseEditUserSubmission,
} from '@/lib/slack/views/modals/edit-user';
import {
  buildEditRuleModal,
  parseEditRuleSubmission,
} from '@/lib/slack/views/modals/edit-rule';
import {
  buildConfirmModal,
  parseConfirmState,
  type ConfirmModalState,
} from '@/lib/slack/views/modals/confirm';
import {
  buildEditReactionMappingModal,
  parseEditReactionMappingSubmission,
} from '@/lib/slack/views/modals/edit-reaction-mapping';

const log = createLogger('slack:interactions');

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Send ephemeral message via response_url
 */
const sendEphemeral = async (responseUrl: string, text: string): Promise<void> => {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: 'ephemeral',
      replace_original: false,
      text,
    }),
  });
};

/**
 * Open a modal
 */
const openModal = async (triggerId: string, view: object): Promise<boolean> => {
  const response = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getBotToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view,
    }),
  });

  const result = await response.json();
  if (!result.ok) {
    log.error('Failed to open modal', { error: result.error });
  }
  return result.ok;
};

/**
 * Format minutes into human-readable time
 */
const formatMinutes = (minutes: number | null | undefined): string => {
  if (!minutes) return 'N/A';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

// ============================================================================
// QUICK ACTION MODAL BUILDERS
// ============================================================================

/**
 * Build stats modal with real data
 */
const buildStatsModal = async (slackUserId: string) => {
  const user = await db.user.findUnique({
    where: { slackId: slackUserId },
    include: {
      assignmentsAsReviewer: {
        where: { status: { in: ['COMPLETED', 'APPROVED'] } },
      },
      statistics: {
        where: { periodType: 'week' },
        orderBy: { period: 'desc' },
        take: 1,
      },
    },
  });

  if (!user) {
    return {
      type: 'modal',
      title: { type: 'plain_text', text: 'Your Stats' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: '_No review data yet. Post a PR link to get started!_' },
      }],
    };
  }

  const totalReviews = user.assignmentsAsReviewer.length;
  const weeklyStats = user.statistics[0];
  const allStats = await db.statistics.findMany({
    where: { userId: user.id },
    select: { points: true },
  });
  const totalPoints = allStats.reduce((sum, s) => sum + s.points, 0);

  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Your Stats' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'All Time', emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Reviews Completed*\n${totalReviews}` },
          { type: 'mrkdwn', text: `*Total Points*\n${totalPoints}` },
        ],
      },
      { type: 'divider' },
      {
        type: 'header',
        text: { type: 'plain_text', text: 'This Week', emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Reviews*\n${weeklyStats?.completed ?? 0}` },
          { type: 'mrkdwn', text: `*Points*\n${weeklyStats?.points ?? 0}` },
          { type: 'mrkdwn', text: `*Avg Response*\n${formatMinutes(weeklyStats?.avgResponseTime)}` },
          { type: 'mrkdwn', text: `*Streak*\n${weeklyStats?.streak ?? 0} ${(weeklyStats?.streak ?? 0) > 0 ? '🔥' : ''}` },
        ],
      },
    ],
  };
};

/**
 * Build leaderboard modal with real data
 */
const buildLeaderboardModal = async () => {
  const now = new Date();
  const weekNumber = Math.ceil(
    (now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7
  );
  const periodString = `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;

  const stats = await db.statistics.findMany({
    where: { periodType: 'week', period: periodString },
    include: { user: true },
    orderBy: { completed: 'desc' },
    take: 10,
  });

  const medals = ['🥇', '🥈', '🥉'];
  const leaderboardBlocks = stats.length > 0
    ? stats.map((s, i) => ({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${medals[i] ?? `${i + 1}.`} <@${s.user.slackId}> — ${s.completed} reviews (avg ${formatMinutes(s.avgResponseTime)}) • ${s.points} pts`,
        },
      }))
    : [{
        type: 'section',
        text: { type: 'mrkdwn', text: '_No reviews recorded yet this week. Be the first!_' },
      }];

  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Leaderboard' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'This Week', emoji: true },
      },
      ...leaderboardBlocks,
    ],
  };
};

/**
 * Build challenges modal with real data
 */
const buildChallengesModal = async (slackUserId: string) => {
  const user = await db.user.findUnique({
    where: { slackId: slackUserId },
  });

  if (!user) {
    return {
      type: 'modal',
      title: { type: 'plain_text', text: 'Challenges' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: '_Complete your first review to participate in challenges!_' },
      }],
    };
  }

  const activeChallenges = await getActiveChallenges(user.id);
  const { weekNumber, year } = getWeekInfo();

  if (activeChallenges.length === 0) {
    return {
      type: 'modal',
      title: { type: 'plain_text', text: 'Challenges' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: '_No active challenges this week. Check back soon!_' },
      }],
    };
  }

  const individual = activeChallenges.filter(c => c.challenge.scope === 'INDIVIDUAL');
  const team = activeChallenges.filter(c => c.challenge.scope === 'TEAM');

  const blocks: object[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Week ${weekNumber}, ${year}`, emoji: true },
    },
  ];

  if (individual.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Personal Challenges*' },
    });
    for (const c of individual) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: formatChallengeDisplay(c) },
      });
    }
  }

  if (team.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Team Challenges*' },
    });
    for (const c of team) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: formatChallengeDisplay(c) },
      });
    }
  }

  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Challenges' },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
  };
};

/**
 * Build achievements modal with real data
 */
const buildAchievementsModal = async (slackUserId: string) => {
  const user = await db.user.findUnique({
    where: { slackId: slackUserId },
  });

  if (!user) {
    return {
      type: 'modal',
      title: { type: 'plain_text', text: 'Achievements' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: '_Start reviewing to earn achievements!_' },
      }],
    };
  }

  const { earned, progress } = await getUserAchievements(user.id);

  const earnedList = earned.length > 0
    ? earned.map(e => `${e.achievement.icon} *${e.achievement.displayName}* — ${e.achievement.description}`).join('\n')
    : '_None yet — start reviewing!_';

  const progressEntries = Array.from(progress.entries())
    .map(([name, { current, required }]) => {
      const achievement = ACHIEVEMENTS.find(a => a.name === name);
      const percent = required > 0 ? Math.round((current / required) * 100) : 0;
      return { achievement, percent, current, required };
    })
    .filter((p): p is typeof p & { achievement: NonNullable<typeof p.achievement> } =>
      !!p.achievement && p.percent > 0 && p.percent < 100
    )
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5);

  const progressList = progressEntries.length > 0
    ? progressEntries.map(p => {
        const bar = '█'.repeat(Math.floor(p.percent / 10)) + '░'.repeat(10 - Math.floor(p.percent / 10));
        return `${p.achievement.icon} ${p.achievement.displayName}\n${bar} ${p.percent}% (${p.current}/${p.required})`;
      }).join('\n\n')
    : '_Complete reviews to see progress!_';

  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Achievements' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `Earned (${earned.length}/${ACHIEVEMENTS.length})`, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: earnedList },
      },
      { type: 'divider' },
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Almost There', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: progressList },
      },
    ],
  };
};

/**
 * Build weekly report modal
 */
const buildReportModal = async () => {
  const digest = await generateWeeklyDigest();
  const { period, summary, topReviewers, speedChampions } = digest;

  const medals = ['🥇', '🥈', '🥉'];
  const topBlocks = topReviewers.slice(0, 3).map((r, i) =>
    `${medals[i]} <@${r.slackId}> — ${r.reviewsCompleted} reviews`
  ).join('\n');

  const speedBlocks = speedChampions.slice(0, 3).map((c, i) =>
    `${['🏎️', '🚀', '👟'][i]} <@${c.slackId}> — avg ${formatMinutes(c.avgResponseTimeMinutes)}`
  ).join('\n');

  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Weekly Report' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `Week ${period.weekNumber}`, emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Total Reviews*\n${summary.totalReviews}` },
          { type: 'mrkdwn', text: `*Avg Response*\n${formatMinutes(summary.avgResponseTimeMinutes)}` },
          { type: 'mrkdwn', text: `*Completion Rate*\n${Math.round(summary.completionRate * 100)}%` },
          { type: 'mrkdwn', text: `*Active Reviewers*\n${summary.activeReviewers}` },
        ],
      },
      { type: 'divider' },
      ...(topBlocks ? [
        { type: 'section', text: { type: 'mrkdwn', text: `*Top Reviewers*\n${topBlocks}` } },
      ] : []),
      ...(speedBlocks ? [
        { type: 'section', text: { type: 'mrkdwn', text: `*Speed Champions*\n${speedBlocks}` } },
      ] : []),
    ],
  };
};

/**
 * Build bottleneck report modal
 */
const buildBottleneckModal = async () => {
  const report = await generateBottleneckReport('week');
  const text = formatBottleneckReportForSlack(report);

  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Bottlenecks' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ],
  };
};

// ============================================================================
// REACTION CONFIG MODAL
// ============================================================================

/**
 * Build reaction config list modal (admin)
 */
const buildReactionConfigModal = async () => {
  const mappings = await db.statusReactionMapping.findMany({
    orderBy: { sortOrder: 'asc' },
  });

  const mappingBlocks = mappings.flatMap((m) => [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${m.displayEmoji} ${m.status}*\nEmojis: \`${m.emojis.join('`, `')}\`\nActive: ${m.isActive ? '✅' : '❌'} | Priority: ${m.sortOrder}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Edit' },
        action_id: `edit_reaction_mapping_${m.id}`,
      },
    },
  ]);

  return {
    type: 'modal',
    callback_id: 'reaction_config_modal',
    title: { type: 'plain_text', text: 'Reaction Config' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Emoji → Status Mappings*\nConfigure which emoji reactions map to which review statuses.',
        },
      },
      { type: 'divider' },
      ...mappingBlocks,
      ...(mappings.length === 0
        ? [{
            type: 'section',
            text: { type: 'mrkdwn', text: '_No mappings configured. Run the seed script to create defaults._' },
          }]
        : []),
    ],
  };
};

// ============================================================================
// SEND DIGEST MODAL
// ============================================================================

/**
 * Build send digest modal with channel input
 */
const buildSendDigestModal = () => ({
  type: 'modal',
  callback_id: 'send_digest_modal',
  title: { type: 'plain_text', text: 'Send Weekly Digest' },
  submit: { type: 'plain_text', text: 'Send' },
  close: { type: 'plain_text', text: 'Cancel' },
  blocks: [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: 'Send the weekly digest report to a channel.' },
    },
    {
      type: 'input',
      block_id: 'channel',
      element: {
        type: 'conversations_select',
        action_id: 'input',
        filter: { include: ['public', 'private'] },
        placeholder: { type: 'plain_text', text: 'Select a channel' },
      },
      label: { type: 'plain_text', text: 'Channel' },
    },
  ],
});

// ============================================================================
// ONBOARDING SETUP MODAL
// ============================================================================

/**
 * Build onboarding setup modal (GitHub link + timezone + availability)
 */
const buildOnboardingSetupModal = async (userId: string) => {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  return {
    type: 'modal',
    callback_id: 'onboarding_setup_modal',
    private_metadata: userId,
    title: { type: 'plain_text', text: 'Complete Setup' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Link your accounts and set your preferences*' },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'github_username',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.githubUsername || '',
          placeholder: { type: 'plain_text', text: 'your-github-username' },
        },
        label: { type: 'plain_text', text: 'GitHub Username' },
        hint: { type: 'plain_text', text: 'Used to auto-assign you as reviewer on GitHub PRs' },
      },
      {
        type: 'input',
        block_id: 'timezone',
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.timezone,
          placeholder: { type: 'plain_text', text: 'e.g., Africa/Nairobi' },
        },
        label: { type: 'plain_text', text: 'Timezone' },
      },
      {
        type: 'input',
        block_id: 'working_hours_start',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.workingHoursStart || '',
          placeholder: { type: 'plain_text', text: '09:00' },
        },
        label: { type: 'plain_text', text: 'Working Hours Start' },
      },
      {
        type: 'input',
        block_id: 'working_hours_end',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.workingHoursEnd || '',
          placeholder: { type: 'plain_text', text: '18:00' },
        },
        label: { type: 'plain_text', text: 'Working Hours End' },
      },
      {
        type: 'input',
        block_id: 'availability',
        element: {
          type: 'static_select',
          action_id: 'input',
          initial_option: {
            text: { type: 'plain_text', text: user.availabilityStatus },
            value: user.availabilityStatus,
          },
          options: [
            { text: { type: 'plain_text', text: 'AVAILABLE' }, value: 'AVAILABLE' },
            { text: { type: 'plain_text', text: 'BUSY' }, value: 'BUSY' },
            { text: { type: 'plain_text', text: 'VACATION' }, value: 'VACATION' },
            { text: { type: 'plain_text', text: 'UNAVAILABLE' }, value: 'UNAVAILABLE' },
          ],
        },
        label: { type: 'plain_text', text: 'Availability' },
      },
    ],
  };
};

// ============================================================================
// EXISTING MODAL BUILDERS
// ============================================================================

const buildManageReposModal = async () => {
  const repos = await db.repository.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    take: 20,
    include: {
      _count: {
        select: {
          assignments: {
            where: { status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW', 'CHANGES_REQUESTED'] } },
          },
        },
      },
    },
  });

  const repoBlocks = repos.flatMap((r) => [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${r.fullName}*\nAuto-assign: ${r.autoAssignment ? '✅' : '❌'} | Active PRs: ${r._count.assignments}`,
      },
      accessory: {
        type: 'overflow',
        action_id: `repo_overflow_${r.id}`,
        options: [
          {
            text: { type: 'plain_text', text: '✏️ Edit Settings' },
            value: `edit_${r.id}`,
          },
          {
            text: { type: 'plain_text', text: '🗑️ Remove' },
            value: `remove_${r.id}`,
          },
        ],
      },
    },
  ]);

  return {
    type: 'modal',
    callback_id: 'manage_repos_modal',
    title: { type: 'plain_text', text: 'Manage Repositories' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${repos.length} repositories configured*` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '➕ Add Repository' },
          style: 'primary',
          action_id: 'open_add_repo_modal',
        },
      },
      { type: 'divider' },
      ...repoBlocks,
      ...(repos.length === 0 ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: '_No repositories configured yet. Add one to get started!_' },
      }] : []),
    ],
  };
};

const buildAddRepoModal = () => ({
  type: 'modal',
  callback_id: 'add_repo_modal',
  title: { type: 'plain_text', text: 'Add Repository' },
  submit: { type: 'plain_text', text: 'Add' },
  close: { type: 'plain_text', text: 'Cancel' },
  blocks: [
    {
      type: 'input',
      block_id: 'repo_full_name',
      element: {
        type: 'plain_text_input',
        action_id: 'input',
        placeholder: { type: 'plain_text', text: 'owner/repository' },
      },
      label: { type: 'plain_text', text: 'Repository (owner/repo)' },
    },
    {
      type: 'input',
      block_id: 'repo_url',
      element: {
        type: 'url_text_input',
        action_id: 'input',
        placeholder: { type: 'plain_text', text: 'https://github.com/owner/repo' },
      },
      label: { type: 'plain_text', text: 'GitHub URL' },
    },
    {
      type: 'input',
      block_id: 'auto_assignment',
      element: {
        type: 'static_select',
        action_id: 'input',
        initial_option: {
          text: { type: 'plain_text', text: 'Enabled' },
          value: 'true',
        },
        options: [
          { text: { type: 'plain_text', text: 'Enabled' }, value: 'true' },
          { text: { type: 'plain_text', text: 'Disabled' }, value: 'false' },
        ],
      },
      label: { type: 'plain_text', text: 'Auto-Assignment' },
    },
  ],
});

const buildManageTeamModal = async () => {
  const users = await db.user.findMany({
    where: { deletedAt: null },
    orderBy: { displayName: 'asc' },
    select: {
      id: true,
      displayName: true,
      slackId: true,
      role: true,
      availabilityStatus: true,
      _count: {
        select: {
          assignmentsAsReviewer: {
            where: { status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW'] } },
          },
        },
      },
    },
    take: 50,
  });

  const statusEmoji = (s: string) =>
    s === 'AVAILABLE' ? '🟢' : s === 'BUSY' ? '🟡' : s === 'VACATION' ? '🏖️' : '🔴';

  const userBlocks = users.map(u => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${u.displayName}* (<@${u.slackId}>)\n` +
        `${statusEmoji(u.availabilityStatus)} ${u.role} | Pending: ${u._count.assignmentsAsReviewer}`,
    },
    accessory: {
      type: 'button',
      text: { type: 'plain_text', text: 'Edit' },
      action_id: `edit_user_${u.id}`,
    },
  }));

  return {
    type: 'modal',
    callback_id: 'manage_team_modal',
    title: { type: 'plain_text', text: 'Team Management' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${users.length} team members*` },
      },
      { type: 'divider' },
      ...userBlocks.slice(0, 10),
      ...(users.length > 10 ? [{
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `_...and ${users.length - 10} more._`,
        }],
      }] : []),
    ],
  };
};

const buildProfileModal = async (userId: string) => {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      skills: { include: { skill: true } },
      _count: {
        select: {
          assignmentsAsReviewer: true,
          achievements: true,
        },
      },
    },
  });

  if (!user) {
    return {
      type: 'modal',
      title: { type: 'plain_text', text: 'Error' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: 'User not found.' },
      }],
    };
  }

  const skills = user.skills.map(us => us.skill.name).join(', ') || 'None set';

  return {
    type: 'modal',
    callback_id: 'edit_profile_modal',
    private_metadata: userId,
    title: { type: 'plain_text', text: 'Edit Profile' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${user.displayName}*\nReviews: ${user._count.assignmentsAsReviewer} | Achievements: ${user._count.achievements}`,
        },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'github_username',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.githubUsername || '',
          placeholder: { type: 'plain_text', text: 'your-github-username' },
        },
        label: { type: 'plain_text', text: 'GitHub Username' },
      },
      {
        type: 'input',
        block_id: 'timezone',
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.timezone,
          placeholder: { type: 'plain_text', text: 'e.g., Africa/Nairobi' },
        },
        label: { type: 'plain_text', text: 'Timezone' },
      },
      {
        type: 'input',
        block_id: 'working_hours_start',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.workingHoursStart || '',
          placeholder: { type: 'plain_text', text: '09:00' },
        },
        label: { type: 'plain_text', text: 'Working Hours Start' },
      },
      {
        type: 'input',
        block_id: 'working_hours_end',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.workingHoursEnd || '',
          placeholder: { type: 'plain_text', text: '18:00' },
        },
        label: { type: 'plain_text', text: 'Working Hours End' },
      },
      {
        type: 'input',
        block_id: 'availability',
        element: {
          type: 'static_select',
          action_id: 'input',
          initial_option: {
            text: { type: 'plain_text', text: user.availabilityStatus },
            value: user.availabilityStatus,
          },
          options: [
            { text: { type: 'plain_text', text: 'AVAILABLE' }, value: 'AVAILABLE' },
            { text: { type: 'plain_text', text: 'BUSY' }, value: 'BUSY' },
            { text: { type: 'plain_text', text: 'VACATION' }, value: 'VACATION' },
            { text: { type: 'plain_text', text: 'UNAVAILABLE' }, value: 'UNAVAILABLE' },
          ],
        },
        label: { type: 'plain_text', text: 'Availability Status' },
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `Current skills: ${skills}`,
        }],
      },
    ],
  };
};

// ============================================================================
// BLOCK ACTION HANDLER
// ============================================================================

const handleBlockActions = async (payload: {
  user: { id: string };
  trigger_id: string;
  response_url: string;
  actions: Array<{ action_id: string; value?: string; selected_option?: { value: string } }>;
}): Promise<void> => {
  const action = payload.actions[0];
  const actionId = action.action_id;

  log.info('Block action received', { actionId, user: payload.user.id });

  // ── Quick action buttons (open modals with real content) ──

  if (actionId === 'show_stats') {
    const modal = await buildStatsModal(payload.user.id);
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'show_leaderboard') {
    const modal = await buildLeaderboardModal();
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'show_challenges') {
    const modal = await buildChallengesModal(payload.user.id);
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'view_achievements') {
    const modal = await buildAchievementsModal(payload.user.id);
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'show_profile') {
    const user = await db.user.findUnique({
      where: { slackId: payload.user.id },
    });

    if (user) {
      const modal = await buildProfileModal(user.id);
      await openModal(payload.trigger_id, modal);
    } else {
      await sendEphemeral(payload.response_url, "You're not set up in the system yet. Reopen the App Home tab.");
    }
    return;
  }

  // ── Onboarding actions ──

  if (actionId === 'onboarding_setup') {
    const user = await db.user.findUnique({
      where: { slackId: payload.user.id },
    });
    if (user) {
      const modal = await buildOnboardingSetupModal(user.id);
      if (modal) await openModal(payload.trigger_id, modal);
    }
    return;
  }

  if (actionId === 'onboarding_skip') {
    // Just refresh App Home — user is already created, they'll see the full dashboard
    await publishAppHome(payload.user.id);
    return;
  }

  // ── Availability toggle (select on App Home) ──

  if (actionId === 'change_availability') {
    const newStatus = action.selected_option?.value;
    if (newStatus) {
      await db.user.update({
        where: { slackId: payload.user.id },
        data: { availabilityStatus: newStatus as 'AVAILABLE' | 'BUSY' | 'VACATION' | 'UNAVAILABLE' },
      });
      log.info('Availability changed via App Home', { user: payload.user.id, status: newStatus });
      await publishAppHome(payload.user.id);
    }
    return;
  }

  // ── Admin actions ──

  if (actionId === 'admin_manage_repos') {
    const modal = await buildManageReposModal();
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'admin_manage_team') {
    const modal = await buildManageTeamModal();
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'admin_view_reports') {
    const modal = await buildReportModal();
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'admin_view_bottlenecks') {
    const modal = await buildBottleneckModal();
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'admin_send_digest') {
    const modal = buildSendDigestModal();
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'admin_sync_now') {
    await sendEphemeral(payload.response_url, 'Syncing channel members... This may take a moment.');
    // Run sync in background
    (async () => {
      try {
        // Find the first channel with an assignment to use as the sync target
        const recentAssignment = await db.assignment.findFirst({
          where: { slackChannelId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { slackChannelId: true },
        });
        if (!recentAssignment?.slackChannelId) {
          log.warn('No channel found for sync');
          return;
        }
        const report = await syncChannelMembers(recentAssignment.slackChannelId);
        const text = formatSyncReport(report);
        await sendEphemeral(payload.response_url, text);
        await publishAppHome(payload.user.id);
      } catch (err) {
        log.error('Sync failed', err instanceof Error ? err : undefined);
        await sendEphemeral(payload.response_url, 'Sync failed. Check server logs.');
      }
    })();
    return;
  }

  if (actionId === 'open_add_repo_modal') {
    const modal = buildAddRepoModal();
    await openModal(payload.trigger_id, modal);
    return;
  }

  // ── Edit user button ──

  if (actionId.startsWith('edit_user_')) {
    const userId = actionId.replace('edit_user_', '');
    const modal = await buildProfileModal(userId);
    await openModal(payload.trigger_id, modal);
    return;
  }

  // ── Repository overflow menu ──

  if (actionId.startsWith('repo_overflow_')) {
    const selectedValue = action.selected_option?.value;
    if (!selectedValue) return;

    if (selectedValue.startsWith('edit_')) {
      const repoId = selectedValue.replace('edit_', '');
      const repo = await db.repository.findUnique({ where: { id: repoId } });
      if (repo) {
        const modalData = buildEditRepositoryModal(repo, payload.trigger_id);
        await openModal(payload.trigger_id, modalData.view);
      }
    } else if (selectedValue.startsWith('remove_')) {
      const repoId = selectedValue.replace('remove_', '');
      const repo = await db.repository.findUnique({
        where: { id: repoId },
        include: {
          _count: {
            select: {
              assignments: {
                where: { status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW', 'CHANGES_REQUESTED'] } },
              },
            },
          },
        },
      });
      if (repo) {
        const state: ConfirmModalState = {
          action: 'remove_repository',
          entityId: repoId,
          entityName: repo.fullName,
          impact: repo._count.assignments > 0
            ? `${repo._count.assignments} active PRs will be untracked`
            : undefined,
        };
        const modalData = buildConfirmModal(state, payload.trigger_id);
        await openModal(payload.trigger_id, modalData.view);
      }
    }
    return;
  }

  // ── Admin edit user with full modal ──

  if (actionId.startsWith('admin_edit_user_')) {
    const userId = actionId.replace('admin_edit_user_', '');
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { repositoryReviewers: true },
    });
    const skills = await db.skill.findMany({ orderBy: { name: 'asc' } });
    if (user) {
      const modalData = buildEditUserModal(user, payload.trigger_id, skills);
      await openModal(payload.trigger_id, modalData.view);
    }
    return;
  }

  // ── Admin manage rules ──

  if (actionId === 'admin_manage_rules') {
    const rules = await db.problemRule.findMany({ orderBy: { name: 'asc' } });
    const ruleBlocks = rules.flatMap((r) => [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${r.name}*\n${r.description ?? 'No description'}\nSeverity: ${r.severity} | Active: ${r.isActive ? '✅' : '❌'}`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Edit' },
          action_id: `edit_rule_${r.id}`,
        },
      },
    ]);

    const modal = {
      type: 'modal',
      callback_id: 'manage_rules_modal',
      title: { type: 'plain_text', text: 'Problem Rules' },
      close: { type: 'plain_text', text: 'Close' },
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${rules.length} rules configured*` },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '➕ Add Rule' },
            style: 'primary',
            action_id: 'open_add_rule_modal',
          },
        },
        { type: 'divider' },
        ...ruleBlocks,
      ],
    };
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId === 'open_add_rule_modal') {
    const modalData = buildEditRuleModal(null, payload.trigger_id);
    await openModal(payload.trigger_id, modalData.view);
    return;
  }

  if (actionId.startsWith('edit_rule_')) {
    const ruleId = actionId.replace('edit_rule_', '');
    const rule = await db.problemRule.findUnique({ where: { id: ruleId } });
    if (rule) {
      const modalData = buildEditRuleModal(rule, payload.trigger_id);
      await openModal(payload.trigger_id, modalData.view);
    }
    return;
  }

  // ── Toggle rule active/inactive ──

  if (actionId.startsWith('toggle_rule_')) {
    const ruleId = actionId.replace('toggle_rule_', '');
    const rule = await db.problemRule.findUnique({ where: { id: ruleId } });
    if (rule) {
      await db.problemRule.update({
        where: { id: ruleId },
        data: { isActive: !rule.isActive },
      });
      log.info('Rule toggled', { ruleId, isActive: !rule.isActive });
      await sendEphemeral(payload.response_url, `Rule "${rule.name}" is now ${!rule.isActive ? 'enabled' : 'disabled'}.`);
    }
    return;
  }

  // ── Admin reaction config ──

  if (actionId === 'admin_reaction_config') {
    const modal = await buildReactionConfigModal();
    await openModal(payload.trigger_id, modal);
    return;
  }

  if (actionId.startsWith('edit_reaction_mapping_')) {
    const mappingId = actionId.replace('edit_reaction_mapping_', '');
    const mapping = await db.statusReactionMapping.findUnique({ where: { id: mappingId } });
    if (mapping) {
      const modalData = buildEditReactionMappingModal(mapping, payload.trigger_id);
      await openModal(payload.trigger_id, modalData.view);
    }
    return;
  }

  log.debug('Unhandled action', { actionId });
};

// ============================================================================
// VIEW SUBMISSION HANDLER
// ============================================================================

const handleViewSubmission = async (payload: {
  user: { id: string };
  view: {
    callback_id: string;
    private_metadata?: string;
    state: {
      values: Record<string, Record<string, { value?: string; selected_option?: { value: string }; selected_conversation?: string }>>;
    };
  };
}): Promise<{ response_action?: string; errors?: Record<string, string> } | null> => {
  const callbackId = payload.view.callback_id;
  const values = payload.view.state.values;

  log.info('View submission received', { callbackId, user: payload.user.id });

  // ── Onboarding setup modal ──

  if (callbackId === 'onboarding_setup_modal') {
    const userId = payload.view.private_metadata;
    if (!userId) return null;

    const githubUsername = values.github_username?.input?.value?.trim() || null;
    const timezone = values.timezone?.input?.value?.trim() || 'UTC';
    const workingHoursStart = values.working_hours_start?.input?.value?.trim() || null;
    const workingHoursEnd = values.working_hours_end?.input?.value?.trim() || null;
    const availability = values.availability?.input?.selected_option?.value as 'AVAILABLE' | 'BUSY' | 'VACATION' | 'UNAVAILABLE';

    await db.user.update({
      where: { id: userId },
      data: {
        githubUsername,
        timezone,
        workingHoursStart,
        workingHoursEnd,
        availabilityStatus: availability,
      },
    });

    log.info('Onboarding setup completed', { userId, githubUsername });
    await publishAppHome(payload.user.id);
    return null;
  }

  // ── Add repository modal ──

  if (callbackId === 'add_repo_modal') {
    const fullName = values.repo_full_name?.input?.value?.trim();
    const url = values.repo_url?.input?.value?.trim();
    const autoAssignment = values.auto_assignment?.input?.selected_option?.value === 'true';

    if (!fullName || !url) {
      return {
        response_action: 'errors',
        errors: {
          repo_full_name: fullName ? '' : 'Repository name is required',
          repo_url: url ? '' : 'URL is required',
        },
      };
    }

    const parts = fullName.split('/');
    if (parts.length !== 2) {
      return {
        response_action: 'errors',
        errors: { repo_full_name: 'Format must be owner/repository' },
      };
    }

    const [owner, name] = parts;

    const existing = await db.repository.findUnique({ where: { fullName } });
    if (existing) {
      return {
        response_action: 'errors',
        errors: { repo_full_name: 'Repository already exists' },
      };
    }

    await db.repository.create({
      data: { name, fullName, url, owner, autoAssignment },
    });

    log.info('Repository created via modal', { fullName });
    await publishAppHome(payload.user.id);
    return null;
  }

  // ── Edit profile modal ──

  if (callbackId === 'edit_profile_modal') {
    const userId = payload.view.private_metadata;
    if (!userId) return null;

    const githubUsername = values.github_username?.input?.value?.trim() || null;
    const timezone = values.timezone?.input?.value?.trim() || 'UTC';
    const workingHoursStart = values.working_hours_start?.input?.value?.trim() || null;
    const workingHoursEnd = values.working_hours_end?.input?.value?.trim() || null;
    const availability = values.availability?.input?.selected_option?.value as 'AVAILABLE' | 'BUSY' | 'VACATION' | 'UNAVAILABLE';

    await db.user.update({
      where: { id: userId },
      data: {
        githubUsername,
        timezone,
        workingHoursStart,
        workingHoursEnd,
        availabilityStatus: availability,
      },
    });

    log.info('User profile updated via modal', { userId });
    await publishAppHome(payload.user.id);
    return null;
  }

  // ── Edit Repository modal (with optimistic locking) ──

  if (callbackId === 'edit_repository_modal') {
    const metadata = JSON.parse(payload.view.private_metadata ?? '{}');
    const repoId = metadata.repositoryId;
    const savedAt = metadata.updatedAt;
    if (!repoId) return null;

    // Optimistic lock check
    if (savedAt) {
      const current = await db.repository.findUnique({ where: { id: repoId }, select: { updatedAt: true } });
      if (current && current.updatedAt.toISOString() !== savedAt) {
        return {
          response_action: 'errors',
          errors: { auto_assignment: 'This repository was modified by someone else. Please close and reopen.' },
        };
      }
    }

    const data = parseEditRepositorySubmission(values);

    await db.repository.update({
      where: { id: repoId },
      data: {
        autoAssignment: data.autoAssignment,
        minReviewers: data.minReviewers,
        maxReviewers: data.maxReviewers,
        requireSeniorComplex: data.requireSeniorComplex,
        complexityMultiplier: data.complexityMultiplier,
      },
    });

    log.info('Repository updated via modal', { repoId });
    await publishAppHome(payload.user.id);
    return null;
  }

  // ── Edit User modal (admin, with optimistic locking + confirmation for role changes) ──

  if (callbackId === 'edit_user_modal') {
    const metadata = JSON.parse(payload.view.private_metadata ?? '{}');
    const userId = metadata.userId;
    const savedAt = metadata.updatedAt;
    if (!userId) return null;

    // Optimistic lock check
    if (savedAt) {
      const current = await db.user.findUnique({ where: { id: userId }, select: { updatedAt: true } });
      if (current && current.updatedAt.toISOString() !== savedAt) {
        return {
          response_action: 'errors',
          errors: { role: 'This user was modified by someone else. Please close and reopen.' },
        };
      }
    }

    const data = parseEditUserSubmission(values);

    // Check if changing to VIEWER — warn about removing from review pool
    const existingUser = await db.user.findUnique({
      where: { id: userId },
      select: { role: true, displayName: true },
    });
    if (existingUser && existingUser.role !== 'VIEWER' && data.role === 'VIEWER') {
      // Deactivate all repository reviewer records
      await db.repositoryReviewer.updateMany({
        where: { userId },
        data: { isActive: false },
      });
      log.info('User changed to VIEWER — deactivated from review pools', { userId });
    }

    await db.user.update({
      where: { id: userId },
      data: { role: data.role },
    });

    await db.repositoryReviewer.updateMany({
      where: { userId },
      data: {
        weight: data.weight,
        maxConcurrent: data.maxConcurrent,
      },
    });

    if (data.skillIds.length > 0) {
      await db.userSkill.deleteMany({ where: { userId } });
      await db.userSkill.createMany({
        data: data.skillIds.map((skillId) => ({ userId, skillId })),
      });
    }

    log.info('User updated via admin modal', { userId, role: data.role });
    await publishAppHome(payload.user.id);
    return null;
  }

  // ── Edit Rule modal (with optimistic locking) ──

  if (callbackId === 'edit_rule_modal') {
    const metadata = JSON.parse(payload.view.private_metadata ?? '{}');
    const ruleId = metadata.ruleId;
    const savedAt = metadata.updatedAt;
    const data = parseEditRuleSubmission(values);

    if (!data.name) {
      return {
        response_action: 'errors',
        errors: { name: 'Rule name is required' },
      };
    }

    if (ruleId) {
      // Optimistic lock check
      if (savedAt) {
        const current = await db.problemRule.findUnique({ where: { id: ruleId }, select: { updatedAt: true } });
        if (current && current.updatedAt.toISOString() !== savedAt) {
          return {
            response_action: 'errors',
            errors: { name: 'This rule was modified by someone else. Please close and reopen.' },
          };
        }
      }

      await db.problemRule.update({
        where: { id: ruleId },
        data,
      });
      log.info('Problem rule updated', { ruleId, name: data.name });
    } else {
      await db.problemRule.create({ data });
      log.info('Problem rule created', { name: data.name });
    }

    await publishAppHome(payload.user.id);
    return null;
  }

  // ── Send Digest modal ──

  if (callbackId === 'send_digest_modal') {
    const channelId = values.channel?.input?.selected_conversation;
    if (!channelId) {
      return {
        response_action: 'errors',
        errors: { channel: 'Please select a channel' },
      };
    }

    // Send async to avoid timeout
    (async () => {
      try {
        const digest = await generateDigestForSend();
        await sendWeeklyDigest(channelId, digest);
        log.info('Weekly digest sent via modal', { channelId, user: payload.user.id });
      } catch (err) {
        log.error('Failed to send digest', err instanceof Error ? err : undefined);
      }
    })();

    return null;
  }

  // ── Edit Reaction Mapping modal (with optimistic locking) ──

  if (callbackId === 'edit_reaction_mapping_modal') {
    const metadata = JSON.parse(payload.view.private_metadata ?? '{}');
    const mappingId = metadata.mappingId;
    const savedAt = metadata.updatedAt;
    if (!mappingId) return null;

    // Optimistic lock check
    if (savedAt) {
      const current = await db.statusReactionMapping.findUnique({ where: { id: mappingId }, select: { updatedAt: true } });
      if (current && current.updatedAt.toISOString() !== savedAt) {
        return {
          response_action: 'errors',
          errors: { emojis: 'This mapping was modified by someone else. Please close and reopen.' },
        };
      }
    }

    const data = parseEditReactionMappingSubmission(values);

    if (data.emojis.length === 0) {
      return {
        response_action: 'errors',
        errors: { emojis: 'At least one emoji is required' },
      };
    }

    await db.statusReactionMapping.update({
      where: { id: mappingId },
      data: {
        emojis: data.emojis,
        displayEmoji: data.displayEmoji,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      },
    });

    log.info('Reaction mapping updated', { mappingId });
    await publishAppHome(payload.user.id);
    return null;
  }

  // ── Confirm Action modal ──

  if (callbackId === 'confirm_action_modal') {
    // Defense-in-depth: verify submitter has admin/team_lead role
    const submitter = await db.user.findUnique({
      where: { slackId: payload.user.id },
      select: { role: true },
    });
    if (!submitter || !['ADMIN', 'TEAM_LEAD'].includes(submitter.role)) {
      log.warn('Non-admin attempted confirm action', { slackId: payload.user.id });
      return { response_action: 'errors' as const, errors: { _: 'Insufficient permissions' } };
    }

    const state = parseConfirmState(payload.view.private_metadata ?? '{}');

    if (state.action === 'remove_repository') {
      // Soft-delete and expire active assignments
      await db.repository.update({
        where: { id: state.entityId },
        data: { deletedAt: new Date() },
      });
      await db.assignment.updateMany({
        where: {
          repositoryId: state.entityId,
          status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW', 'CHANGES_REQUESTED'] },
        },
        data: { status: 'EXPIRED' },
      });
      log.info('Repository removed + active assignments expired', { repoId: state.entityId, name: state.entityName });
    } else if (state.action === 'delete_user') {
      // Soft-delete user, deactivate from review pools, expire pending reviews
      await db.user.update({
        where: { id: state.entityId },
        data: { deletedAt: new Date() },
      });
      await db.repositoryReviewer.updateMany({
        where: { userId: state.entityId },
        data: { isActive: false },
      });
      await db.assignment.updateMany({
        where: {
          reviewerId: state.entityId,
          status: { in: ['PENDING', 'ASSIGNED'] },
        },
        data: { status: 'EXPIRED' },
      });
      log.info('User soft-deleted', { userId: state.entityId, name: state.entityName });
    } else if (state.action === 'delete_rule') {
      await db.problemRule.delete({ where: { id: state.entityId } });
      log.info('Problem rule deleted', { ruleId: state.entityId });
    }

    await publishAppHome(payload.user.id);
    return null;
  }

  return null;
};

// ============================================================================
// ROUTE HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('x-slack-signature') ?? '';
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';

  if (!verifySlackSignature(signature, timestamp, body)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const params = new URLSearchParams(body);
  const payloadStr = params.get('payload');

  if (!payloadStr) {
    return NextResponse.json({ error: 'No payload' }, { status: 400 });
  }

  const payload = JSON.parse(payloadStr);

  try {
    if (payload.type === 'block_actions') {
      handleBlockActions(payload).catch((err) =>
        log.error('Block action handler failed', err instanceof Error ? err : undefined)
      );
      return NextResponse.json({ ok: true });
    }

    if (payload.type === 'view_submission') {
      const result = await handleViewSubmission(payload);
      if (result) {
        return NextResponse.json(result);
      }
      return NextResponse.json({ ok: true });
    }

    if (payload.type === 'view_closed') {
      return NextResponse.json({ ok: true });
    }

    log.debug('Unhandled interaction type', { type: payload.type });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error('Interaction handler error', error instanceof Error ? error : undefined);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
