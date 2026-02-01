/**
 * Slack App Home View Builder
 *
 * Generates Block Kit views for the App Home tab.
 */

import { db } from '@/lib/db';
import { getUserStatsSummary } from '@/lib/stats';

// Slack Block Kit types
interface TextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
}

interface Block {
  type: string;
  block_id?: string;
  text?: TextObject;
  fields?: TextObject[];
  elements?: unknown[];
  accessory?: unknown;
  [key: string]: unknown;
}

interface AppHomeView {
  type: 'home';
  blocks: Block[];
}

/**
 * Build header section
 */
const buildHeader = (displayName: string): Block[] => [
  {
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Welcome back, ${displayName}!`,
      emoji: true,
    },
  },
  {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Your PR Roulette dashboard',
      },
    ],
  },
  { type: 'divider' },
];

/**
 * Build stats section
 */
const buildStatsSection = (stats: {
  pending: number;
  completed: number;
  avgResponseMinutes: number | null;
  points: number;
  streak: number;
}): Block[] => [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Your Stats This Week*',
    },
  },
  {
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: `*Pending Reviews*\n${stats.pending}`,
      },
      {
        type: 'mrkdwn',
        text: `*Completed*\n${stats.completed}`,
      },
      {
        type: 'mrkdwn',
        text: `*Avg Response*\n${stats.avgResponseMinutes ? `${stats.avgResponseMinutes}m` : 'N/A'}`,
      },
      {
        type: 'mrkdwn',
        text: `*Points*\n${stats.points}`,
      },
    ],
  },
  {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Current streak: ${stats.streak} day${stats.streak !== 1 ? 's' : ''}`,
      },
    ],
  },
  { type: 'divider' },
];

/**
 * Build pending assignments section
 */
const buildAssignmentsSection = (assignments: Array<{
  id: string;
  prTitle: string | null;
  prNumber: number;
  prUrl: string;
  repositoryName: string;
  complexity: string;
  assignedAt: Date | null;
}>): Block[] => {
  const blocks: Block[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Your Pending Reviews*',
      },
    },
  ];

  if (assignments.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_No pending reviews - nice work!_',
      },
    });
  } else {
    // Show up to 5 assignments
    const toShow = assignments.slice(0, 5);

    for (const assignment of toShow) {
      const age = assignment.assignedAt
        ? Math.floor((Date.now() - assignment.assignedAt.getTime()) / (1000 * 60 * 60))
        : null;
      const ageText = age !== null ? `${age}h ago` : '';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${assignment.prUrl}|#${assignment.prNumber}>* ${assignment.prTitle || 'Untitled'}\n` +
            `${assignment.repositoryName} | ${assignment.complexity} | ${ageText}`,
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View PR',
            emoji: true,
          },
          url: assignment.prUrl,
          action_id: `view_pr_${assignment.id}`,
        },
      });
    }

    if (assignments.length > 5) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_...and ${assignments.length - 5} more_`,
          },
        ],
      });
    }
  }

  blocks.push({ type: 'divider' });
  return blocks;
};

/**
 * Build achievements preview
 */
const buildAchievementsPreview = (achievements: Array<{
  icon: string;
  displayName: string;
}>, totalCount: number): Block[] => {
  const recentIcons = achievements.slice(0, 5).map(a => a.icon).join(' ');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Achievements* (${totalCount} earned)\n${recentIcons || '_None yet - start reviewing!_'}`,
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View All',
          emoji: true,
        },
        action_id: 'view_achievements',
      },
    },
    { type: 'divider' },
  ];
};

/**
 * Build quick actions section
 */
const buildQuickActions = (): Block[] => [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Quick Actions*',
    },
  },
  {
    type: 'actions',
    block_id: 'quick_actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'My Stats',
          emoji: true,
        },
        action_id: 'show_stats',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Leaderboard',
          emoji: true,
        },
        action_id: 'show_leaderboard',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Challenges',
          emoji: true,
        },
        action_id: 'show_challenges',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'My Profile',
          emoji: true,
        },
        action_id: 'show_profile',
      },
    ],
  },
  { type: 'divider' },
];

/**
 * Build admin section (only for ADMIN and TEAM_LEAD roles)
 */
const buildAdminSection = (repoCount: number, userCount: number, pendingCount: number): Block[] => [
  {
    type: 'header',
    text: {
      type: 'plain_text',
      text: 'Admin Dashboard',
      emoji: true,
    },
  },
  {
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: `*Repositories*\n${repoCount}`,
      },
      {
        type: 'mrkdwn',
        text: `*Team Members*\n${userCount}`,
      },
      {
        type: 'mrkdwn',
        text: `*Pending Reviews*\n${pendingCount}`,
      },
    ],
  },
  {
    type: 'actions',
    block_id: 'admin_actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Manage Repos',
          emoji: true,
        },
        action_id: 'admin_manage_repos',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Manage Team',
          emoji: true,
        },
        action_id: 'admin_manage_team',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Reports',
          emoji: true,
        },
        action_id: 'admin_view_reports',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Send Digest',
          emoji: true,
        },
        style: 'primary',
        action_id: 'admin_send_digest',
      },
    ],
  },
  { type: 'divider' },
];

/**
 * Build footer
 */
const buildFooter = (): Block[] => [
  {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Use `/pr-roulette help` for all commands | <https://pr-roulette.bixbyte.io|Documentation>',
      },
    ],
  },
];

/**
 * Build complete App Home view for a user
 */
export const buildAppHomeView = async (slackUserId: string): Promise<AppHomeView> => {
  // Get user from database
  const user = await db.user.findUnique({
    where: { slackId: slackUserId },
    include: {
      achievements: {
        include: { achievement: true },
        orderBy: { earnedAt: 'desc' },
        take: 5,
      },
    },
  });

  const blocks: Block[] = [];

  if (!user) {
    // User not in system yet
    blocks.push(
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Welcome to PR Roulette!',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: "You're not set up in the system yet. Ask your team admin to add you, or use `/pr-roulette help` to get started.",
        },
      }
    );

    return { type: 'home', blocks };
  }

  // Build header
  blocks.push(...buildHeader(user.displayName));

  // Fetch all user data in parallel (avoid sequential queries)
  const [stats, pendingAssignments, totalAchievements] = await Promise.all([
    getUserStatsSummary(user.id),
    db.assignment.findMany({
      where: {
        reviewerId: user.id,
        status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW'] },
      },
      include: {
        repository: true,
      },
      orderBy: { assignedAt: 'asc' },
      take: 10,
    }),
    db.userAchievement.count({
      where: { userId: user.id },
    }),
  ]);

  // Stats section
  blocks.push(...buildStatsSection({
    pending: pendingAssignments.length,
    completed: stats?.week?.completed ?? 0,
    avgResponseMinutes: stats?.week?.avgResponseTime ?? null,
    points: stats?.week?.points ?? 0,
    streak: stats?.week?.streak ?? 0,
  }));

  // Pending assignments
  blocks.push(...buildAssignmentsSection(
    pendingAssignments.map(a => ({
      id: a.id,
      prTitle: a.prTitle,
      prNumber: a.prNumber,
      prUrl: a.prUrl,
      repositoryName: a.repository.name,
      complexity: a.complexity,
      assignedAt: a.assignedAt,
    }))
  ));

  // Achievements preview (data already fetched with user)
  const achievementData = user.achievements.map(ua => ({
    icon: ua.achievement.icon,
    displayName: ua.achievement.displayName,
  }));
  blocks.push(...buildAchievementsPreview(achievementData, totalAchievements));

  // Quick actions
  blocks.push(...buildQuickActions());

  // Admin section (for ADMIN and TEAM_LEAD only)
  if (user.role === 'ADMIN' || user.role === 'TEAM_LEAD') {
    const [repoCount, userCount, pendingCount] = await Promise.all([
      db.repository.count({ where: { deletedAt: null } }),
      db.user.count({ where: { deletedAt: null } }),
      db.assignment.count({ where: { status: { in: ['PENDING', 'ASSIGNED'] } } }),
    ]);

    blocks.push(...buildAdminSection(repoCount, userCount, pendingCount));
  }

  // Footer
  blocks.push(...buildFooter());

  return { type: 'home', blocks };
};

/**
 * Publish App Home view to Slack
 */
export const publishAppHome = async (slackUserId: string): Promise<boolean> => {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN not configured');
  }

  const view = await buildAppHomeView(slackUserId);

  const response = await fetch('https://slack.com/api/views.publish', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: slackUserId,
      view,
    }),
  });

  const result = await response.json();

  if (!result.ok) {
    throw new Error(`Failed to publish App Home: ${result.error}`);
  }

  return true;
};
