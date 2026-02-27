/**
 * Edit Repository Modal
 * Allows admins to configure repository settings
 */

import type { Repository } from '@/generated/prisma';

export interface EditRepositoryModalState {
  repositoryId: string;
}

/**
 * Build Edit Repository modal view
 */
export const buildEditRepositoryModal = (
  repo: Repository,
  triggerId: string
): { trigger_id: string; view: object } => ({
  trigger_id: triggerId,
  view: {
    type: 'modal',
    callback_id: 'edit_repository_modal',
    private_metadata: JSON.stringify({ repositoryId: repo.id }),
    title: {
      type: 'plain_text',
      text: 'Edit Repository',
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
          text: `*Repository:* ${repo.fullName}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'input',
        block_id: 'auto_assignment',
        element: {
          type: 'static_select',
          action_id: 'auto_assignment_select',
          initial_option: {
            text: {
              type: 'plain_text',
              text: repo.autoAssignment ? 'Enabled' : 'Disabled',
            },
            value: repo.autoAssignment ? 'true' : 'false',
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
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Automatically assign reviewers when PRs are detected',
        },
      },
      {
        type: 'input',
        block_id: 'min_reviewers',
        element: {
          type: 'static_select',
          action_id: 'min_reviewers_select',
          initial_option: {
            text: { type: 'plain_text', text: String(repo.minReviewers) },
            value: String(repo.minReviewers),
          },
          options: [1, 2, 3, 4, 5].map((n) => ({
            text: { type: 'plain_text', text: String(n) },
            value: String(n),
          })),
        },
        label: {
          type: 'plain_text',
          text: 'Minimum Reviewers',
          emoji: true,
        },
      },
      {
        type: 'input',
        block_id: 'max_reviewers',
        element: {
          type: 'static_select',
          action_id: 'max_reviewers_select',
          initial_option: {
            text: { type: 'plain_text', text: String(repo.maxReviewers) },
            value: String(repo.maxReviewers),
          },
          options: [1, 2, 3, 4, 5].map((n) => ({
            text: { type: 'plain_text', text: String(n) },
            value: String(n),
          })),
        },
        label: {
          type: 'plain_text',
          text: 'Maximum Reviewers',
          emoji: true,
        },
      },
      {
        type: 'input',
        block_id: 'require_senior',
        element: {
          type: 'static_select',
          action_id: 'require_senior_select',
          initial_option: {
            text: {
              type: 'plain_text',
              text: repo.requireSeniorComplex ? 'Yes' : 'No',
            },
            value: repo.requireSeniorComplex ? 'true' : 'false',
          },
          options: [
            { text: { type: 'plain_text', text: 'Yes' }, value: 'true' },
            { text: { type: 'plain_text', text: 'No' }, value: 'false' },
          ],
        },
        label: {
          type: 'plain_text',
          text: 'Require Senior for Complex PRs',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Ensure complex PRs get a senior reviewer',
        },
      },
      {
        type: 'input',
        block_id: 'complexity_multiplier',
        element: {
          type: 'static_select',
          action_id: 'complexity_multiplier_select',
          initial_option: {
            text: { type: 'plain_text', text: `${repo.complexityMultiplier}x` },
            value: String(repo.complexityMultiplier),
          },
          options: [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((n) => ({
            text: { type: 'plain_text', text: `${n}x` },
            value: String(n),
          })),
        },
        label: {
          type: 'plain_text',
          text: 'Complexity Multiplier',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Adjust workload calculation (higher = more effort per PR)',
        },
      },
    ],
  },
});

/**
 * Parse Edit Repository modal submission
 */
export const parseEditRepositorySubmission = (
  values: Record<string, Record<string, { selected_option?: { value: string } }>>
): {
  autoAssignment: boolean;
  minReviewers: number;
  maxReviewers: number;
  requireSeniorComplex: boolean;
  complexityMultiplier: number;
} => ({
  autoAssignment: values.auto_assignment?.auto_assignment_select?.selected_option?.value === 'true',
  minReviewers: parseInt(values.min_reviewers?.min_reviewers_select?.selected_option?.value ?? '1', 10),
  maxReviewers: parseInt(values.max_reviewers?.max_reviewers_select?.selected_option?.value ?? '2', 10),
  requireSeniorComplex: values.require_senior?.require_senior_select?.selected_option?.value === 'true',
  complexityMultiplier: parseFloat(values.complexity_multiplier?.complexity_multiplier_select?.selected_option?.value ?? '1.0'),
});
