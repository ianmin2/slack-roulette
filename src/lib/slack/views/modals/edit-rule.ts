/**
 * Edit Problem Rule Modal
 * Allows admins to configure problem detection rules
 */

import type { ProblemRule, ProblemSeverity, ProblemConditionType } from '@/generated/prisma';

export interface EditRuleModalState {
  ruleId?: string; // undefined = new rule
  updatedAt?: string; // ISO string for optimistic locking (undefined for new rules)
}

const SEVERITY_OPTIONS: { text: string; value: ProblemSeverity }[] = [
  { text: '⚠️ Warning', value: 'WARNING' },
  { text: '🔴 Problem', value: 'PROBLEM' },
  { text: '🚨 Critical', value: 'CRITICAL' },
];

const CONDITION_OPTIONS: { text: string; value: ProblemConditionType; hint: string }[] = [
  { text: 'No activity for X hours', value: 'NO_ACTIVITY_FOR', hint: 'Hours since last review activity' },
  { text: 'Rejection count >= X', value: 'REJECTION_COUNT_GTE', hint: 'Number of times PR was rejected' },
  { text: 'Reviewer changes >= X', value: 'REVIEWER_CHANGES_GTE', hint: 'Number of reviewer reassignments' },
  { text: 'PR age >= X hours', value: 'TOTAL_AGE_GTE', hint: 'Total hours since PR was created' },
];

/**
 * Build Edit Rule modal view
 */
export const buildEditRuleModal = (
  rule: ProblemRule | null,
  triggerId: string
): { trigger_id: string; view: object } => {
  const isNew = !rule;
  const severityOption = rule
    ? SEVERITY_OPTIONS.find((s) => s.value === rule.severity) ?? SEVERITY_OPTIONS[1]
    : SEVERITY_OPTIONS[1];
  const conditionOption = rule
    ? CONDITION_OPTIONS.find((c) => c.value === rule.conditionType) ?? CONDITION_OPTIONS[0]
    : CONDITION_OPTIONS[0];

  return {
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'edit_rule_modal',
      private_metadata: JSON.stringify({ ruleId: rule?.id, updatedAt: rule?.updatedAt.toISOString() } satisfies EditRuleModalState),
      title: {
        type: 'plain_text',
        text: isNew ? 'Create Rule' : 'Edit Rule',
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
          type: 'input',
          block_id: 'name',
          element: {
            type: 'plain_text_input',
            action_id: 'name_input',
            initial_value: rule?.name ?? '',
            placeholder: {
              type: 'plain_text',
              text: 'e.g., stalled_review',
            },
          },
          label: {
            type: 'plain_text',
            text: 'Rule Name',
            emoji: true,
          },
          hint: {
            type: 'plain_text',
            text: 'Unique identifier (lowercase, underscores)',
          },
        },
        {
          type: 'input',
          block_id: 'description',
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            initial_value: rule?.description ?? '',
            placeholder: {
              type: 'plain_text',
              text: 'e.g., No review activity for 48 hours',
            },
          },
          label: {
            type: 'plain_text',
            text: 'Description',
            emoji: true,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'input',
          block_id: 'severity',
          element: {
            type: 'static_select',
            action_id: 'severity_select',
            initial_option: {
              text: { type: 'plain_text', text: severityOption.text },
              value: severityOption.value,
            },
            options: SEVERITY_OPTIONS.map((s) => ({
              text: { type: 'plain_text', text: s.text },
              value: s.value,
            })),
          },
          label: {
            type: 'plain_text',
            text: 'Severity',
            emoji: true,
          },
        },
        {
          type: 'input',
          block_id: 'condition_type',
          element: {
            type: 'static_select',
            action_id: 'condition_type_select',
            initial_option: {
              text: { type: 'plain_text', text: conditionOption.text },
              value: conditionOption.value,
            },
            options: CONDITION_OPTIONS.map((c) => ({
              text: { type: 'plain_text', text: c.text },
              value: c.value,
            })),
          },
          label: {
            type: 'plain_text',
            text: 'Condition Type',
            emoji: true,
          },
        },
        {
          type: 'input',
          block_id: 'condition_value',
          element: {
            type: 'plain_text_input',
            action_id: 'condition_value_input',
            initial_value: rule ? String(rule.conditionValue) : '48',
            placeholder: {
              type: 'plain_text',
              text: 'e.g., 48',
            },
          },
          label: {
            type: 'plain_text',
            text: 'Condition Value',
            emoji: true,
          },
          hint: {
            type: 'plain_text',
            text: 'The threshold number (hours or count)',
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'input',
          block_id: 'auto_notify',
          element: {
            type: 'static_select',
            action_id: 'auto_notify_select',
            initial_option: {
              text: { type: 'plain_text', text: rule?.autoNotify !== false ? 'Yes' : 'No' },
              value: rule?.autoNotify !== false ? 'true' : 'false',
            },
            options: [
              { text: { type: 'plain_text', text: 'Yes' }, value: 'true' },
              { text: { type: 'plain_text', text: 'No' }, value: 'false' },
            ],
          },
          label: {
            type: 'plain_text',
            text: 'Auto-Notify',
            emoji: true,
          },
          hint: {
            type: 'plain_text',
            text: 'Automatically post to channel when triggered',
          },
        },
        {
          type: 'input',
          block_id: 'is_active',
          element: {
            type: 'static_select',
            action_id: 'is_active_select',
            initial_option: {
              text: { type: 'plain_text', text: rule?.isActive !== false ? 'Active' : 'Disabled' },
              value: rule?.isActive !== false ? 'true' : 'false',
            },
            options: [
              { text: { type: 'plain_text', text: 'Active' }, value: 'true' },
              { text: { type: 'plain_text', text: 'Disabled' }, value: 'false' },
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
 * Parse Edit Rule modal submission
 */
export const parseEditRuleSubmission = (
  values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>>
): {
  name: string;
  description: string | null;
  severity: ProblemSeverity;
  conditionType: ProblemConditionType;
  conditionValue: number;
  autoNotify: boolean;
  isActive: boolean;
} => ({
  name: values.name?.name_input?.value ?? '',
  description: values.description?.description_input?.value || null,
  severity: (values.severity?.severity_select?.selected_option?.value as ProblemSeverity) ?? 'PROBLEM',
  conditionType: (values.condition_type?.condition_type_select?.selected_option?.value as ProblemConditionType) ?? 'NO_ACTIVITY_FOR',
  conditionValue: parseInt(values.condition_value?.condition_value_input?.value ?? '48', 10),
  autoNotify: values.auto_notify?.auto_notify_select?.selected_option?.value === 'true',
  isActive: values.is_active?.is_active_select?.selected_option?.value === 'true',
});
