/**
 * Slack Interactions Endpoint
 *
 * Handles interactive components:
 * - Block actions (button clicks)
 * - Modal submissions
 * - Shortcuts
 */

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { publishAppHome } from '@/lib/slack/views/app-home';
import { verifySlackSignature, getBotToken } from '@/lib/slack/security';
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

const log = createLogger('slack:interactions');

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
  return result.ok;
};

/**
 * Build repository management modal
 */
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
    title: {
      type: 'plain_text',
      text: 'Manage Repositories',
    },
    close: {
      type: 'plain_text',
      text: 'Close',
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${repos.length} repositories configured*`,
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '➕ Add Repository',
          },
          style: 'primary',
          action_id: 'open_add_repo_modal',
        },
      },
      {
        type: 'divider',
      },
      ...repoBlocks,
      ...(repos.length === 0 ? [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_No repositories configured yet. Add one to get started!_',
        },
      }] : []),
    ],
  };
};

/**
 * Build add repository modal
 */
const buildAddRepoModal = () => ({
  type: 'modal',
  callback_id: 'add_repo_modal',
  title: {
    type: 'plain_text',
    text: 'Add Repository',
  },
  submit: {
    type: 'plain_text',
    text: 'Add',
  },
  close: {
    type: 'plain_text',
    text: 'Cancel',
  },
  blocks: [
    {
      type: 'input',
      block_id: 'repo_full_name',
      element: {
        type: 'plain_text_input',
        action_id: 'input',
        placeholder: {
          type: 'plain_text',
          text: 'owner/repository',
        },
      },
      label: {
        type: 'plain_text',
        text: 'Repository (owner/repo)',
      },
    },
    {
      type: 'input',
      block_id: 'repo_url',
      element: {
        type: 'url_text_input',
        action_id: 'input',
        placeholder: {
          type: 'plain_text',
          text: 'https://github.com/owner/repo',
        },
      },
      label: {
        type: 'plain_text',
        text: 'GitHub URL',
      },
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
          {
            text: { type: 'plain_text', text: 'Enabled' },
            value: 'true',
          },
          {
            text: { type: 'plain_text', text: 'Disabled' },
            value: 'false',
          },
        ],
      },
      label: {
        type: 'plain_text',
        text: 'Auto-Assignment',
      },
    },
  ],
});

/**
 * Build team management modal
 */
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

  const userBlocks = users.map(u => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${u.displayName}* (<@${u.slackId}>)\n` +
        `Role: ${u.role} | Status: ${u.availabilityStatus} | Pending: ${u._count.assignmentsAsReviewer}`,
    },
    accessory: {
      type: 'button',
      text: {
        type: 'plain_text',
        text: 'Edit',
      },
      action_id: `edit_user_${u.id}`,
    },
  }));

  return {
    type: 'modal',
    callback_id: 'manage_team_modal',
    title: {
      type: 'plain_text',
      text: 'Team Management',
    },
    close: {
      type: 'plain_text',
      text: 'Close',
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${users.length} team members*`,
        },
      },
      { type: 'divider' },
      ...userBlocks.slice(0, 10), // Show first 10
      ...(users.length > 10 ? [{
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `_...and ${users.length - 10} more. Use \`/pr-roulette stats @user\` to view individual users._`,
        }],
      }] : []),
    ],
  };
};

/**
 * Build user profile modal
 */
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
    title: {
      type: 'plain_text',
      text: 'Edit Profile',
    },
    submit: {
      type: 'plain_text',
      text: 'Save',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
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
        block_id: 'timezone',
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.timezone,
          placeholder: {
            type: 'plain_text',
            text: 'e.g., America/New_York',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Timezone',
        },
      },
      {
        type: 'input',
        block_id: 'working_hours_start',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.workingHoursStart || '',
          placeholder: {
            type: 'plain_text',
            text: '09:00',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Working Hours Start',
        },
      },
      {
        type: 'input',
        block_id: 'working_hours_end',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          initial_value: user.workingHoursEnd || '',
          placeholder: {
            type: 'plain_text',
            text: '18:00',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Working Hours End',
        },
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
        label: {
          type: 'plain_text',
          text: 'Availability Status',
        },
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

/**
 * Handle block actions (button clicks, select changes)
 */
const handleBlockActions = async (payload: {
  user: { id: string };
  trigger_id: string;
  response_url: string;
  actions: Array<{ action_id: string; value?: string; selected_option?: { value: string } }>;
}): Promise<void> => {
  const action = payload.actions[0];
  const actionId = action.action_id;

  log.info('Block action received', { actionId, user: payload.user.id });

  // Quick action buttons from App Home
  if (actionId === 'show_stats') {
    await sendEphemeral(payload.response_url, 'Use `/pr-roulette stats` to see your detailed statistics.');
    return;
  }

  if (actionId === 'show_leaderboard') {
    await sendEphemeral(payload.response_url, 'Use `/pr-roulette leaderboard` to see the current rankings.');
    return;
  }

  if (actionId === 'show_challenges') {
    await sendEphemeral(payload.response_url, 'Use `/pr-roulette challenges` to see active challenges.');
    return;
  }

  if (actionId === 'show_profile') {
    // Get user's internal ID
    const user = await db.user.findUnique({
      where: { slackId: payload.user.id },
    });

    if (user) {
      const modal = await buildProfileModal(user.id);
      await openModal(payload.trigger_id, modal);
    } else {
      await sendEphemeral(payload.response_url, "You're not set up in the system yet.");
    }
    return;
  }

  if (actionId === 'view_achievements') {
    await sendEphemeral(payload.response_url, 'Use `/pr-roulette achievements` to see all your achievements and progress.');
    return;
  }

  // Admin actions
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
    await sendEphemeral(payload.response_url, 'Use `/pr-roulette report` to generate team reports.');
    return;
  }

  if (actionId === 'admin_send_digest') {
    await sendEphemeral(payload.response_url, 'Use `/pr-roulette digest #channel` to send the weekly digest.');
    return;
  }

  if (actionId === 'open_add_repo_modal') {
    const modal = buildAddRepoModal();
    await openModal(payload.trigger_id, modal);
    return;
  }

  // Edit user button
  if (actionId.startsWith('edit_user_')) {
    const userId = actionId.replace('edit_user_', '');
    const modal = await buildProfileModal(userId);
    await openModal(payload.trigger_id, modal);
    return;
  }

  // Repository overflow menu
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

  // Admin edit user with full modal
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

  // Admin manage rules
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

  log.debug('Unhandled action', { actionId });
};

/**
 * Handle modal submissions
 */
const handleViewSubmission = async (payload: {
  user: { id: string };
  view: {
    callback_id: string;
    private_metadata?: string;
    state: {
      values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>>;
    };
  };
}): Promise<{ response_action?: string; errors?: Record<string, string> } | null> => {
  const callbackId = payload.view.callback_id;
  const values = payload.view.state.values;

  log.info('View submission received', { callbackId, user: payload.user.id });

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

    // Parse owner from fullName
    const parts = fullName.split('/');
    if (parts.length !== 2) {
      return {
        response_action: 'errors',
        errors: {
          repo_full_name: 'Format must be owner/repository',
        },
      };
    }

    const [owner, name] = parts;

    // Check if already exists
    const existing = await db.repository.findUnique({
      where: { fullName },
    });

    if (existing) {
      return {
        response_action: 'errors',
        errors: {
          repo_full_name: 'Repository already exists',
        },
      };
    }

    // Create repository
    await db.repository.create({
      data: {
        name,
        fullName,
        url,
        owner,
        autoAssignment,
      },
    });

    log.info('Repository created via modal', { fullName });

    // Refresh App Home
    await publishAppHome(payload.user.id);

    return null; // Close modal
  }

  if (callbackId === 'edit_profile_modal') {
    const userId = payload.view.private_metadata;
    if (!userId) return null;

    const timezone = values.timezone?.input?.value?.trim() || 'UTC';
    const workingHoursStart = values.working_hours_start?.input?.value?.trim() || null;
    const workingHoursEnd = values.working_hours_end?.input?.value?.trim() || null;
    const availability = values.availability?.input?.selected_option?.value as 'AVAILABLE' | 'BUSY' | 'VACATION' | 'UNAVAILABLE';

    await db.user.update({
      where: { id: userId },
      data: {
        timezone,
        workingHoursStart,
        workingHoursEnd,
        availabilityStatus: availability,
      },
    });

    log.info('User profile updated via modal', { userId });

    // Refresh App Home
    await publishAppHome(payload.user.id);

    return null;
  }

  // Edit Repository modal
  if (callbackId === 'edit_repository_modal') {
    const metadata = JSON.parse(payload.view.private_metadata ?? '{}');
    const repoId = metadata.repositoryId;
    if (!repoId) return null;

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

  // Edit User modal (admin)
  if (callbackId === 'edit_user_modal') {
    const metadata = JSON.parse(payload.view.private_metadata ?? '{}');
    const userId = metadata.userId;
    if (!userId) return null;

    const data = parseEditUserSubmission(values);

    // Update user role
    await db.user.update({
      where: { id: userId },
      data: { role: data.role },
    });

    // Update reviewer settings for all repos
    await db.repositoryReviewer.updateMany({
      where: { userId },
      data: {
        weight: data.weight,
        maxConcurrent: data.maxConcurrent,
      },
    });

    // Update skills if provided
    if (data.skillIds.length > 0) {
      // Remove existing skills
      await db.userSkill.deleteMany({ where: { userId } });
      // Add new skills
      await db.userSkill.createMany({
        data: data.skillIds.map((skillId) => ({ userId, skillId })),
      });
    }

    log.info('User updated via admin modal', { userId, role: data.role });
    await publishAppHome(payload.user.id);
    return null;
  }

  // Edit Rule modal
  if (callbackId === 'edit_rule_modal') {
    const metadata = JSON.parse(payload.view.private_metadata ?? '{}');
    const ruleId = metadata.ruleId;
    const data = parseEditRuleSubmission(values);

    if (!data.name) {
      return {
        response_action: 'errors',
        errors: { name: 'Rule name is required' },
      };
    }

    if (ruleId) {
      // Update existing rule
      await db.problemRule.update({
        where: { id: ruleId },
        data,
      });
      log.info('Problem rule updated', { ruleId, name: data.name });
    } else {
      // Create new rule
      await db.problemRule.create({ data });
      log.info('Problem rule created', { name: data.name });
    }

    await publishAppHome(payload.user.id);
    return null;
  }

  // Confirm Action modal
  if (callbackId === 'confirm_action_modal') {
    const state = parseConfirmState(payload.view.private_metadata ?? '{}');

    if (state.action === 'remove_repository') {
      // Soft delete repository
      await db.repository.update({
        where: { id: state.entityId },
        data: { deletedAt: new Date() },
      });
      log.info('Repository removed', { repoId: state.entityId, name: state.entityName });
    } else if (state.action === 'delete_rule') {
      await db.problemRule.delete({ where: { id: state.entityId } });
      log.info('Problem rule deleted', { ruleId: state.entityId });
    }

    await publishAppHome(payload.user.id);
    return null;
  }

  return null;
};

/**
 * POST /api/slack/interactions
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('x-slack-signature') ?? '';
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';

  // Verify signature
  if (!verifySlackSignature(signature, timestamp, body)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse form data
  const params = new URLSearchParams(body);
  const payloadStr = params.get('payload');

  if (!payloadStr) {
    return NextResponse.json({ error: 'No payload' }, { status: 400 });
  }

  const payload = JSON.parse(payloadStr);

  try {
    if (payload.type === 'block_actions') {
      // Handle async to avoid timeout
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
      // Modal was closed, no action needed
      return NextResponse.json({ ok: true });
    }

    log.debug('Unhandled interaction type', { type: payload.type });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error('Interaction handler error', error instanceof Error ? error : undefined);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
