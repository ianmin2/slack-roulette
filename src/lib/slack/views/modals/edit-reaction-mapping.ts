/**
 * Edit Reaction Mapping Modal
 * Allows admins to configure emoji → status mappings
 */

import type { StatusReactionMapping } from '@/generated/prisma';

export interface EditReactionMappingModalState {
  mappingId: string;
  updatedAt: string; // ISO string for optimistic locking
}

/**
 * Build Edit Reaction Mapping modal view
 */
export const buildEditReactionMappingModal = (
  mapping: StatusReactionMapping,
  triggerId: string
): { trigger_id: string; view: object } => {
  return {
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'edit_reaction_mapping_modal',
      private_metadata: JSON.stringify({
        mappingId: mapping.id,
        updatedAt: mapping.updatedAt.toISOString(),
      } satisfies EditReactionMappingModalState),
      title: {
        type: 'plain_text',
        text: 'Edit Reaction Mapping',
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
            text: `*Status:* ${mapping.displayEmoji} ${mapping.status}`,
          },
        },
        { type: 'divider' },
        {
          type: 'input',
          block_id: 'emojis',
          element: {
            type: 'plain_text_input',
            action_id: 'input',
            initial_value: mapping.emojis.join(', '),
            placeholder: {
              type: 'plain_text',
              text: 'eyes, eyeglasses, speech_balloon',
            },
          },
          label: {
            type: 'plain_text',
            text: 'Emoji Names (comma-separated)',
            emoji: true,
          },
          hint: {
            type: 'plain_text',
            text: 'Slack emoji names without colons (e.g., white_check_mark, +1, thumbsup)',
          },
        },
        {
          type: 'input',
          block_id: 'display_emoji',
          element: {
            type: 'plain_text_input',
            action_id: 'input',
            initial_value: mapping.displayEmoji,
            placeholder: {
              type: 'plain_text',
              text: 'e.g., ✅',
            },
          },
          label: {
            type: 'plain_text',
            text: 'Display Emoji',
            emoji: true,
          },
          hint: {
            type: 'plain_text',
            text: 'The emoji shown in the UI to represent this status',
          },
        },
        {
          type: 'input',
          block_id: 'sort_order',
          element: {
            type: 'static_select',
            action_id: 'input',
            initial_option: {
              text: { type: 'plain_text', text: String(mapping.sortOrder) },
              value: String(mapping.sortOrder),
            },
            options: [1, 2, 3, 4, 5].map((n) => ({
              text: { type: 'plain_text', text: String(n) },
              value: String(n),
            })),
          },
          label: {
            type: 'plain_text',
            text: 'Sort Order',
            emoji: true,
          },
          hint: {
            type: 'plain_text',
            text: 'Priority when multiple emojis match (lower = higher priority)',
          },
        },
        {
          type: 'input',
          block_id: 'is_active',
          element: {
            type: 'static_select',
            action_id: 'input',
            initial_option: {
              text: { type: 'plain_text', text: mapping.isActive ? 'Active' : 'Inactive' },
              value: mapping.isActive ? 'true' : 'false',
            },
            options: [
              { text: { type: 'plain_text', text: 'Active' }, value: 'true' },
              { text: { type: 'plain_text', text: 'Inactive' }, value: 'false' },
            ],
          },
          label: {
            type: 'plain_text',
            text: 'Status',
            emoji: true,
          },
        },
      ],
    },
  };
};

/**
 * Parse Edit Reaction Mapping modal submission
 */
export const parseEditReactionMappingSubmission = (
  values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>>
): {
  emojis: string[];
  displayEmoji: string;
  sortOrder: number;
  isActive: boolean;
} => ({
  emojis: (values.emojis?.input?.value ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean),
  displayEmoji: values.display_emoji?.input?.value ?? '',
  sortOrder: parseInt(values.sort_order?.input?.selected_option?.value ?? '1', 10),
  isActive: values.is_active?.input?.selected_option?.value === 'true',
});
