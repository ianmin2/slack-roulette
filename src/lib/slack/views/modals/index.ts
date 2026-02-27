/**
 * App Home Modals
 * Modal dialogs for admin configuration actions
 */

export { buildEditRepositoryModal, type EditRepositoryModalState } from './edit-repository';
export { buildEditUserModal, type EditUserModalState } from './edit-user';
export { buildEditRuleModal, type EditRuleModalState } from './edit-rule';
export { buildConfirmModal, type ConfirmModalState } from './confirm';
export {
  buildEditReactionMappingModal,
  parseEditReactionMappingSubmission,
  type EditReactionMappingModalState,
} from './edit-reaction-mapping';

// Modal callback IDs
export const MODAL_CALLBACKS = {
  EDIT_REPOSITORY: 'edit_repository_modal',
  EDIT_USER: 'edit_user_modal',
  EDIT_RULE: 'edit_rule_modal',
  CONFIRM_ACTION: 'confirm_action_modal',
  EDIT_REACTION_MAPPING: 'edit_reaction_mapping_modal',
} as const;

// Action IDs for buttons/inputs
export const ACTION_IDS = {
  EDIT_REPO_BTN: 'edit_repo_btn',
  REMOVE_REPO_BTN: 'remove_repo_btn',
  EDIT_USER_BTN: 'edit_user_btn',
  EDIT_RULE_BTN: 'edit_rule_btn',
  CONFIRM_YES: 'confirm_yes',
  CONFIRM_NO: 'confirm_no',
} as const;
