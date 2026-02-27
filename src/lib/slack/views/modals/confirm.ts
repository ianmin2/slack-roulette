/**
 * Confirm Action Modal
 * Generic confirmation dialog for destructive actions
 */

export interface ConfirmModalState {
  action: string; // 'remove_repository' | 'delete_user' | 'delete_rule'
  entityId: string;
  entityName: string;
  impact?: string; // Optional impact message
}

/**
 * Build Confirm modal view
 */
export const buildConfirmModal = (
  state: ConfirmModalState,
  triggerId: string
): { trigger_id: string; view: object } => {
  const actionDescriptions: Record<string, { title: string; warning: string; buttonText: string; buttonStyle: string }> = {
    remove_repository: {
      title: 'Remove Repository',
      warning: 'This will stop tracking PRs from this repository.',
      buttonText: 'Remove',
      buttonStyle: 'danger',
    },
    delete_user: {
      title: 'Remove User',
      warning: 'This will remove the user from PR Roulette.',
      buttonText: 'Remove',
      buttonStyle: 'danger',
    },
    delete_rule: {
      title: 'Delete Rule',
      warning: 'This will permanently delete this problem detection rule.',
      buttonText: 'Delete',
      buttonStyle: 'danger',
    },
    reassign_reviews: {
      title: 'Reassign Reviews',
      warning: 'This will reassign all pending reviews from this user.',
      buttonText: 'Reassign',
      buttonStyle: 'primary',
    },
  };

  const config = actionDescriptions[state.action] ?? {
    title: 'Confirm Action',
    warning: 'Are you sure you want to proceed?',
    buttonText: 'Confirm',
    buttonStyle: 'primary',
  };

  return {
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'confirm_action_modal',
      private_metadata: JSON.stringify(state),
      title: {
        type: 'plain_text',
        text: config.title,
        emoji: true,
      },
      submit: {
        type: 'plain_text',
        text: config.buttonText,
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
            text: `Are you sure you want to ${state.action.replace(/_/g, ' ')}?\n\n*${state.entityName}*`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `⚠️ ${config.warning}`,
            },
          ],
        },
        ...(state.impact
          ? [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Impact:* ${state.impact}`,
                },
              },
            ]
          : []),
      ],
    },
  };
};

/**
 * Parse Confirm modal state from private_metadata
 */
export const parseConfirmState = (privateMetadata: string): ConfirmModalState => {
  return JSON.parse(privateMetadata) as ConfirmModalState;
};
