/**
 * Slack App Home View Builder
 *
 * Generates Block Kit views for the App Home tab.
 * - Auto-registers users on first visit (first user = ADMIN)
 * - Shows onboarding view for new users
 * - Full dashboard for registered users
 * - Admin configuration panel for ADMIN/TEAM_LEAD
 */

import { db } from '@/lib/db';
import { getUserInfo } from '@/lib/slack/client';
import { getUserStatsSummary, getLeaderboard } from '@/lib/stats';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('slack:app-home');

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

// ============================================================================
// AUTO-REGISTRATION
// ============================================================================

/**
 * Find or auto-register a user when they open App Home.
 * First user in the system gets ADMIN role.
 */
const findOrCreateUserOnHomeOpen = async (slackUserId: string) => {
  const existing = await db.user.findUnique({
    where: { slackId: slackUserId },
    include: {
      achievements: {
        include: { achievement: true },
        orderBy: { earnedAt: 'desc' },
        take: 5,
      },
    },
  });

  if (existing) return { user: existing, isNew: false };

  // Fetch Slack profile
  const slackUser = await getUserInfo(slackUserId);
  if (!slackUser) {
    log.error('Could not fetch Slack user info for auto-register', { slackUserId });
    return { user: null, isNew: false };
  }

  // First user in the system gets ADMIN role
  const userCount = await db.user.count({ where: { deletedAt: null } });
  const role = userCount === 0 ? 'ADMIN' as const : 'DEVELOPER' as const;

  const user = await db.user.create({
    data: {
      slackId: slackUserId,
      displayName: slackUser.profile.display_name || slackUser.real_name || slackUser.name,
      email: slackUser.profile.email,
      avatarUrl: slackUser.profile.image_48,
      role,
    },
    include: {
      achievements: {
        include: { achievement: true },
        orderBy: { earnedAt: 'desc' },
        take: 5,
      },
    },
  });

  log.info('Auto-registered user on App Home open', {
    slackId: slackUserId,
    displayName: user.displayName,
    role,
    isFirstUser: userCount === 0,
  });

  return { user, isNew: true };
};

// ============================================================================
// ONBOARDING VIEW
// ============================================================================

/**
 * Build onboarding view for newly registered users
 */
const buildOnboardingView = (displayName: string, isAdmin: boolean): Block[] => [
  {
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Welcome to PR Roulette, ${displayName}!`,
      emoji: true,
    },
  },
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: isAdmin
        ? '*You are the first user — you have been assigned the ADMIN role.*\n\nPR Roulette automates code review assignments by analyzing GitHub PRs, balancing workloads, and gamifying the review process.'
        : 'PR Roulette automates code review assignments by analyzing GitHub PRs, balancing workloads, and gamifying the review process.',
    },
  },
  { type: 'divider' },
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Complete your setup:*\nLink your GitHub account and configure your preferences.',
    },
  },
  {
    type: 'actions',
    block_id: 'onboarding_actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Complete Setup',
          emoji: true,
        },
        style: 'primary',
        action_id: 'onboarding_setup',
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Skip for Now',
          emoji: true,
        },
        action_id: 'onboarding_skip',
      },
    ],
  },
  { type: 'divider' },
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*How it works:*',
    },
  },
  {
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: '*1. Post a PR link*\nPaste a GitHub PR URL in any channel where the bot is added',
      },
      {
        type: 'mrkdwn',
        text: '*2. Auto-assignment*\nThe bot detects the PR, analyzes it, and assigns a reviewer',
      },
      {
        type: 'mrkdwn',
        text: '*3. React to review*\nUse emoji reactions to track review status (eyes, check, x)',
      },
      {
        type: 'mrkdwn',
        text: '*4. Earn points*\nFast and thorough reviews earn points, achievements, and streak bonuses',
      },
    ],
  },
  ...(isAdmin ? [
    { type: 'divider' } as Block,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Admin Quick Start:*\n1. Click *Complete Setup* to link your GitHub\n2. Use *Manage Repos* below to add your repositories\n3. Invite the bot to your PR channels: `/invite @PR Roulette`\n4. Team members will auto-register when they open the app',
      },
    } as Block,
    {
      type: 'actions',
      block_id: 'onboarding_admin_actions',
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
      ],
    } as Block,
  ] : []),
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

// ============================================================================
// USER HOME SECTIONS
// ============================================================================

/**
 * Build header section with avatar, role badge, and availability
 */
const buildHeader = (user: {
  displayName: string;
  role: string;
  githubUsername: string | null;
  availabilityStatus: string;
}): Block[] => {
  const roleBadge = user.role === 'ADMIN' ? ' [Admin]'
    : user.role === 'TEAM_LEAD' ? ' [Team Lead]'
    : '';
  const availabilityEmoji = user.availabilityStatus === 'AVAILABLE' ? '🟢'
    : user.availabilityStatus === 'BUSY' ? '🟡'
    : user.availabilityStatus === 'VACATION' ? '🏖️'
    : '🔴';
  const githubText = user.githubUsername ? ` | GitHub: \`${user.githubUsername}\`` : '';

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Welcome back, ${user.displayName}!`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${availabilityEmoji} ${user.availabilityStatus}${roleBadge}${githubText}`,
        },
      ],
    },
    {
      type: 'actions',
      block_id: 'availability_actions',
      elements: [
        {
          type: 'static_select',
          action_id: 'change_availability',
          placeholder: {
            type: 'plain_text',
            text: 'Change availability',
          },
          initial_option: {
            text: { type: 'plain_text', text: `${availabilityEmoji} ${user.availabilityStatus}` },
            value: user.availabilityStatus,
          },
          options: [
            { text: { type: 'plain_text', text: '🟢 AVAILABLE' }, value: 'AVAILABLE' },
            { text: { type: 'plain_text', text: '🟡 BUSY' }, value: 'BUSY' },
            { text: { type: 'plain_text', text: '🏖️ VACATION' }, value: 'VACATION' },
            { text: { type: 'plain_text', text: '🔴 UNAVAILABLE' }, value: 'UNAVAILABLE' },
          ],
        },
      ],
    },
    { type: 'divider' },
  ];
};

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
        text: `Current streak: ${stats.streak} day${stats.streak !== 1 ? 's' : ''} ${stats.streak >= 3 ? '🔥' : ''}`,
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
 * Build recent activity section (last 5 completed reviews)
 */
const buildRecentActivity = (activity: Array<{
  prTitle: string | null;
  prNumber: number;
  prUrl: string;
  repositoryName: string;
  status: string;
  completedAt: Date | null;
}>): Block[] => {
  if (activity.length === 0) return [];

  const blocks: Block[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Recent Activity*',
      },
    },
  ];

  for (const item of activity) {
    const statusEmoji = item.status === 'APPROVED' ? '✅'
      : item.status === 'COMPLETED' ? '✅'
      : item.status === 'CHANGES_REQUESTED' ? '❌'
      : '📝';
    const timeAgo = item.completedAt
      ? `${Math.floor((Date.now() - item.completedAt.getTime()) / (1000 * 60 * 60 * 24))}d ago`
      : '';

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${statusEmoji} *<${item.prUrl}|#${item.prNumber}>* ${item.prTitle || 'Untitled'} — ${item.repositoryName} ${timeAgo}`,
        },
      ],
    });
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
 * Build quick actions section - buttons that open modals with real content
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

// ============================================================================
// TEAM LEADERBOARD SECTION
// ============================================================================

/**
 * Build team leaderboard section (top 5 this week)
 */
const buildTeamLeaderboard = async (currentUserId: string): Promise<Block[]> => {
  const leaders = await getLeaderboard('week', 5);
  if (leaders.length === 0) return [];

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const rows = leaders.map((entry, i) => {
    const isMe = entry.userId === currentUserId;
    const name = isMe ? `*${entry.user.displayName}* (you)` : entry.user.displayName;
    return `${medals[i]} ${name} — ${entry.completed} reviews, ${entry.points} pts`;
  });

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Team Leaderboard This Week*',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: rows.join('\n'),
      },
    },
    { type: 'divider' },
  ];
};

// ============================================================================
// SETTINGS SECTION
// ============================================================================

/**
 * Build user settings section (skills display + edit button)
 */
const buildSettingsSection = (user: {
  id: string;
  skills: Array<{ skill: { name: string } }>;
  maxConcurrent?: number;
  timezone: string;
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
}): Block[] => {
  const skillsList = user.skills.length > 0
    ? user.skills.map(us => us.skill.name).join(', ')
    : '_None configured_';
  const hours = user.workingHoursStart && user.workingHoursEnd
    ? `${user.workingHoursStart} – ${user.workingHoursEnd}`
    : '_Not set_';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Your Settings*',
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Skills*\n${skillsList}` },
        { type: 'mrkdwn', text: `*Timezone*\n${user.timezone}` },
        { type: 'mrkdwn', text: `*Working Hours*\n${hours}` },
      ],
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Edit Profile', emoji: true },
        action_id: 'show_profile',
      },
    },
    { type: 'divider' },
  ];
};

// ============================================================================
// ADMIN SECTIONS
// ============================================================================

/**
 * Build admin section with system stats and all management buttons
 */
const buildAdminSection = (stats: {
  repoCount: number;
  userCount: number;
  pendingCount: number;
  problemCount: number;
  weeklyReviews: number;
}): Block[] => [
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
        text: `*Repositories*\n${stats.repoCount}`,
      },
      {
        type: 'mrkdwn',
        text: `*Team Members*\n${stats.userCount}`,
      },
      {
        type: 'mrkdwn',
        text: `*Pending Reviews*\n${stats.pendingCount}`,
      },
      {
        type: 'mrkdwn',
        text: `*This Week*\n${stats.weeklyReviews} reviews`,
      },
    ],
  },
  // Problem alert if any
  ...(stats.problemCount > 0 ? [{
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `⚠️ *${stats.problemCount} active problem${stats.problemCount !== 1 ? 's' : ''} detected* — check problem rules`,
    }],
  } as Block] : []),
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
          text: 'Problem Rules',
          emoji: true,
        },
        action_id: 'admin_manage_rules',
      },
    ],
  },
  {
    type: 'actions',
    block_id: 'admin_actions_2',
    elements: [
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
          text: 'Bottlenecks',
          emoji: true,
        },
        action_id: 'admin_view_bottlenecks',
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
  {
    type: 'actions',
    block_id: 'admin_actions_3',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Sync Members',
          emoji: true,
        },
        action_id: 'admin_sync_now',
        confirm: {
          title: { type: 'plain_text', text: 'Sync Channel Members' },
          text: { type: 'mrkdwn', text: 'This will sync all members from the PR channel. New members will be added and departed members deactivated.' },
          confirm: { type: 'plain_text', text: 'Sync Now' },
          deny: { type: 'plain_text', text: 'Cancel' },
        },
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Reaction Config',
          emoji: true,
        },
        action_id: 'admin_reaction_config',
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

// ============================================================================
// MAIN BUILD FUNCTION
// ============================================================================

/**
 * Build complete App Home view for a user.
 * Auto-registers the user if they don't exist.
 */
export const buildAppHomeView = async (slackUserId: string): Promise<AppHomeView> => {
  const { user, isNew } = await findOrCreateUserOnHomeOpen(slackUserId);

  const blocks: Block[] = [];

  if (!user) {
    // Couldn't fetch Slack profile — show error
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
          text: 'Something went wrong setting up your account. Please try again or use `/pr-roulette help` to get started.',
        },
      }
    );
    return { type: 'home', blocks };
  }

  // New user — show onboarding
  if (isNew) {
    blocks.push(...buildOnboardingView(user.displayName, user.role === 'ADMIN'));
    return { type: 'home', blocks };
  }

  // Existing user — full dashboard
  blocks.push(...buildHeader({
    displayName: user.displayName,
    role: user.role,
    githubUsername: user.githubUsername,
    availabilityStatus: user.availabilityStatus,
  }));

  // Fetch all user data in parallel
  const [stats, pendingAssignments, totalAchievements, recentCompleted, userWithSkills] = await Promise.all([
    getUserStatsSummary(user.id),
    db.assignment.findMany({
      where: {
        reviewerId: user.id,
        status: { in: ['PENDING', 'ASSIGNED', 'IN_REVIEW'] },
      },
      include: { repository: true },
      orderBy: { assignedAt: 'asc' },
      take: 10,
    }),
    db.userAchievement.count({
      where: { userId: user.id },
    }),
    db.assignment.findMany({
      where: {
        reviewerId: user.id,
        status: { in: ['COMPLETED', 'APPROVED', 'CHANGES_REQUESTED'] },
        completedAt: { not: null },
      },
      include: { repository: true },
      orderBy: { completedAt: 'desc' },
      take: 5,
    }),
    db.user.findUnique({
      where: { id: user.id },
      include: { skills: { include: { skill: true } } },
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

  // Recent activity
  blocks.push(...buildRecentActivity(
    recentCompleted.map(a => ({
      prTitle: a.prTitle,
      prNumber: a.prNumber,
      prUrl: a.prUrl,
      repositoryName: a.repository.name,
      status: a.status,
      completedAt: a.completedAt,
    }))
  ));

  // Achievements preview
  const achievementData = user.achievements.map(ua => ({
    icon: ua.achievement.icon,
    displayName: ua.achievement.displayName,
  }));
  blocks.push(...buildAchievementsPreview(achievementData, totalAchievements));

  // Quick actions
  blocks.push(...buildQuickActions());

  // Settings section
  if (userWithSkills) {
    blocks.push(...buildSettingsSection({
      id: userWithSkills.id,
      skills: userWithSkills.skills,
      timezone: userWithSkills.timezone,
      workingHoursStart: userWithSkills.workingHoursStart,
      workingHoursEnd: userWithSkills.workingHoursEnd,
    }));
  }

  // Team leaderboard
  const leaderboardBlocks = await buildTeamLeaderboard(user.id);
  blocks.push(...leaderboardBlocks);

  // Admin section (for ADMIN and TEAM_LEAD only)
  if (user.role === 'ADMIN' || user.role === 'TEAM_LEAD') {
    const [repoCount, userCount, pendingCount, problemCount, weeklyReviewCount] = await Promise.all([
      db.repository.count({ where: { deletedAt: null } }),
      db.user.count({ where: { deletedAt: null } }),
      db.assignment.count({ where: { status: { in: ['PENDING', 'ASSIGNED'] } } }),
      db.assignmentProblem.count({ where: { resolvedAt: null } }),
      db.assignment.count({
        where: {
          status: { in: ['COMPLETED', 'APPROVED'] },
          completedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    blocks.push(...buildAdminSection({
      repoCount,
      userCount,
      pendingCount,
      problemCount,
      weeklyReviews: weeklyReviewCount,
    }));
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
