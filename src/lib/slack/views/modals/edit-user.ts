/**
 * Edit User Modal
 * Allows admins to configure user settings
 */

import type { User, UserRole } from '@/generated/prisma';

export interface EditUserModalState {
  userId: string;
  updatedAt: string; // ISO string for optimistic locking
}

const ROLE_OPTIONS: { text: string; value: UserRole }[] = [
  { text: 'Admin', value: 'ADMIN' },
  { text: 'Team Lead', value: 'TEAM_LEAD' },
  { text: 'Developer', value: 'DEVELOPER' },
  { text: 'Viewer', value: 'VIEWER' },
];

const WEIGHT_OPTIONS = [
  { text: 'Junior (0.5)', value: '0.5' },
  { text: 'Mid-level (1.0)', value: '1.0' },
  { text: 'Senior (1.5)', value: '1.5' },
  { text: 'Principal (2.0)', value: '2.0' },
];

/**
 * Build Edit User modal view
 */
export const buildEditUserModal = (
  user: User & { repositoryReviewers?: { weight: number; maxConcurrent: number }[] },
  triggerId: string,
  availableSkills: { id: string; name: string }[] = []
): { trigger_id: string; view: object } => {
  // Get default weight from first repository reviewer or default to 1.0
  const defaultWeight = user.repositoryReviewers?.[0]?.weight ?? 1.0;
  const maxConcurrent = user.repositoryReviewers?.[0]?.maxConcurrent ?? 5;

  const weightOption = WEIGHT_OPTIONS.find((w) => parseFloat(w.value) === defaultWeight) ?? WEIGHT_OPTIONS[1];
  const roleOption = ROLE_OPTIONS.find((r) => r.value === user.role) ?? ROLE_OPTIONS[2];

  return {
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'edit_user_modal',
      private_metadata: JSON.stringify({ userId: user.id, updatedAt: user.updatedAt.toISOString() } satisfies EditUserModalState),
      title: {
        type: 'plain_text',
        text: 'Edit User',
        emoji: true,
      },
      submit: {
        type: 'plain_text',
        text: 'Save',
        emoji: true,
      },
      close: {
        type: 'plain_text',
        text: 'Cancel',
        emoji: true,
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*User:* ${user.displayName}`,
          },
          accessory: user.avatarUrl
            ? {
                type: 'image',
                image_url: user.avatarUrl,
                alt_text: user.displayName,
              }
            : undefined,
        },
        {
          type: 'divider',
        },
        {
          type: 'input',
          block_id: 'role',
          element: {
            type: 'static_select',
            action_id: 'role_select',
            initial_option: {
              text: { type: 'plain_text', text: roleOption.text },
              value: roleOption.value,
            },
            options: ROLE_OPTIONS.map((r) => ({
              text: { type: 'plain_text', text: r.text },
              value: r.value,
            })),
          },
          label: {
            type: 'plain_text',
            text: 'Role',
            emoji: true,
          },
        },
        {
          type: 'input',
          block_id: 'reviewer_weight',
          element: {
            type: 'static_select',
            action_id: 'weight_select',
            initial_option: {
              text: { type: 'plain_text', text: weightOption.text },
              value: weightOption.value,
            },
            options: WEIGHT_OPTIONS.map((w) => ({
              text: { type: 'plain_text', text: w.text },
              value: w.value,
            })),
          },
          label: {
            type: 'plain_text',
            text: 'Reviewer Weight',
            emoji: true,
          },
          hint: {
            type: 'plain_text',
            text: 'Higher weight = more complex PRs assigned',
          },
        },
        {
          type: 'input',
          block_id: 'max_concurrent',
          element: {
            type: 'static_select',
            action_id: 'max_concurrent_select',
            initial_option: {
              text: { type: 'plain_text', text: String(maxConcurrent) },
              value: String(maxConcurrent),
            },
            options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
              text: { type: 'plain_text', text: String(n) },
              value: String(n),
            })),
          },
          label: {
            type: 'plain_text',
            text: 'Max Concurrent Reviews',
            emoji: true,
          },
        },
        ...(availableSkills.length > 0
          ? [
              {
                type: 'input',
                block_id: 'skills',
                optional: true,
                element: {
                  type: 'multi_static_select',
                  action_id: 'skills_select',
                  placeholder: {
                    type: 'plain_text',
                    text: 'Select skills',
                  },
                  options: availableSkills.map((s) => ({
                    text: { type: 'plain_text', text: s.name },
                    value: s.id,
                  })),
                },
                label: {
                  type: 'plain_text',
                  text: 'Skills',
                  emoji: true,
                },
              },
            ]
          : []),
      ],
    },
  };
};

/**
 * Parse Edit User modal submission
 */
export const parseEditUserSubmission = (
  values: Record<string, Record<string, { selected_option?: { value: string }; selected_options?: { value: string }[] }>>
): {
  role: UserRole;
  weight: number;
  maxConcurrent: number;
  skillIds: string[];
} => ({
  role: (values.role?.role_select?.selected_option?.value as UserRole) ?? 'DEVELOPER',
  weight: parseFloat(values.reviewer_weight?.weight_select?.selected_option?.value ?? '1.0'),
  maxConcurrent: parseInt(values.max_concurrent?.max_concurrent_select?.selected_option?.value ?? '5', 10),
  skillIds: values.skills?.skills_select?.selected_options?.map((o) => o.value) ?? [],
});
