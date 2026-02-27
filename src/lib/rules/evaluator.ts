/**
 * Problem Detection Rule Evaluator
 * Checks assignments against configurable rules to detect issues
 */

import { db } from '@/lib/db';
import { postMessage } from '@/lib/slack/client';
import { createLogger } from '@/lib/utils/logger';
import type { Assignment, ProblemRule, ProblemConditionType, AssignmentProblem } from '@/generated/prisma';

const log = createLogger('rules:evaluator');

type AssignmentWithRelations = Assignment & {
  repository: { fullName: string; name: string };
  reviewer: { slackId: string; displayName: string } | null;
  author: { slackId: string; displayName: string };
};

/**
 * Evaluate a single condition against an assignment
 */
const evaluateCondition = (
  assignment: AssignmentWithRelations,
  conditionType: ProblemConditionType,
  conditionValue: number
): boolean => {
  const now = new Date();

  switch (conditionType) {
    case 'NO_ACTIVITY_FOR': {
      // Hours since last activity (reaction or creation)
      const lastActivity = assignment.firstReviewActivityAt ?? assignment.assignedAt ?? assignment.createdAt;
      const hoursSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);
      return hoursSinceActivity >= conditionValue;
    }

    case 'REJECTION_COUNT_GTE': {
      return assignment.rejectionCount >= conditionValue;
    }

    case 'REVIEWER_CHANGES_GTE': {
      return assignment.reviewerChangeCount >= conditionValue;
    }

    case 'TOTAL_AGE_GTE': {
      // Hours since PR was created
      const hoursSinceCreation = (now.getTime() - assignment.createdAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceCreation >= conditionValue;
    }

    default:
      log.warn('Unknown condition type', { conditionType });
      return false;
  }
};

/**
 * Evaluate all active rules against an assignment
 */
export const evaluateRulesForAssignment = async (
  assignment: AssignmentWithRelations,
  rules: ProblemRule[]
): Promise<{ rule: ProblemRule; triggered: boolean }[]> => {
  return rules.map((rule) => ({
    rule,
    triggered: evaluateCondition(assignment, rule.conditionType, rule.conditionValue),
  }));
};

/**
 * Get description for a problem
 */
const getProblemDescription = (rule: ProblemRule, assignment: AssignmentWithRelations): string => {
  switch (rule.conditionType) {
    case 'NO_ACTIVITY_FOR':
      return `No review activity for ${rule.conditionValue}+ hours`;
    case 'REJECTION_COUNT_GTE':
      return `Rejected ${assignment.rejectionCount} times (threshold: ${rule.conditionValue})`;
    case 'REVIEWER_CHANGES_GTE':
      return `Reviewer changed ${assignment.reviewerChangeCount} times (threshold: ${rule.conditionValue})`;
    case 'TOTAL_AGE_GTE':
      return `PR open for ${rule.conditionValue}+ hours`;
    default:
      return rule.description ?? rule.name;
  }
};

/**
 * Notify about a triggered problem
 */
const notifyProblem = async (
  assignment: AssignmentWithRelations,
  rule: ProblemRule,
  problem: AssignmentProblem
): Promise<void> => {
  if (!assignment.slackChannelId) return;

  const severityEmoji = {
    WARNING: '⚠️',
    PROBLEM: '🔴',
    CRITICAL: '🚨',
  };

  const description = getProblemDescription(rule, assignment);

  const message =
    `${severityEmoji[rule.severity]} *Problem Detected*\n\n` +
    `*PR:* <${assignment.prUrl}|${assignment.repository.fullName}#${assignment.prNumber}>\n` +
    `*Issue:* ${rule.name}\n` +
    `*Details:* ${description}\n` +
    (assignment.reviewer
      ? `*Reviewer:* <@${assignment.reviewer.slackId}>\n`
      : '*Reviewer:* Unassigned\n') +
    `*Author:* <@${assignment.author.slackId}>`;

  try {
    await postMessage(assignment.slackChannelId, message, {
      thread_ts: assignment.slackMessageTs ?? undefined,
    });

    // Mark as notified
    await db.assignmentProblem.update({
      where: { id: problem.id },
      data: { notified: true },
    });

    log.info('Sent problem notification', {
      assignment: assignment.prUrl,
      rule: rule.name,
    });
  } catch (error) {
    log.error('Failed to send problem notification', error instanceof Error ? error : undefined);
  }
};

/**
 * Run problem detection for all open assignments
 */
export const runProblemDetection = async (): Promise<{
  checked: number;
  triggered: number;
  resolved: number;
  notified: number;
}> => {
  const stats = { checked: 0, triggered: 0, resolved: 0, notified: 0 };

  // Get all active rules
  const rules = await db.problemRule.findMany({
    where: { isActive: true },
  });

  if (rules.length === 0) {
    log.debug('No active problem rules');
    return stats;
  }

  // Get all open assignments (not APPROVED, COMPLETED, MERGED, SKIPPED, EXPIRED)
  const openStatuses = ['PENDING', 'ASSIGNED', 'IN_REVIEW', 'CHANGES_REQUESTED'];
  const assignments = await db.assignment.findMany({
    where: {
      status: { in: openStatuses as Assignment['status'][] },
    },
    include: {
      repository: true,
      reviewer: true,
      author: true,
      problems: {
        where: { resolvedAt: null },
        include: { rule: true },
      },
    },
  });

  stats.checked = assignments.length;
  log.info('Running problem detection', { assignments: stats.checked, rules: rules.length });

  for (const assignment of assignments) {
    const results = await evaluateRulesForAssignment(assignment, rules);

    for (const { rule, triggered } of results) {
      const existingProblem = assignment.problems.find((p) => p.ruleId === rule.id);

      if (triggered && !existingProblem) {
        // New problem detected
        const problem = await db.assignmentProblem.create({
          data: {
            assignmentId: assignment.id,
            ruleId: rule.id,
          },
        });

        // Update assignment problem signals
        await db.assignment.update({
          where: { id: assignment.id },
          data: {
            problemSignals: {
              push: rule.name,
            },
          },
        });

        stats.triggered++;
        log.info('Problem triggered', { assignment: assignment.prUrl, rule: rule.name });

        // Notify if rule has autoNotify enabled
        if (rule.autoNotify) {
          await notifyProblem(assignment, rule, problem);
          stats.notified++;
        }
      } else if (!triggered && existingProblem) {
        // Problem resolved
        await db.assignmentProblem.update({
          where: { id: existingProblem.id },
          data: { resolvedAt: new Date() },
        });

        // Remove from problem signals
        const updatedSignals = (assignment.problemSignals ?? []).filter((s) => s !== rule.name);
        await db.assignment.update({
          where: { id: assignment.id },
          data: { problemSignals: updatedSignals },
        });

        stats.resolved++;
        log.info('Problem resolved', { assignment: assignment.prUrl, rule: rule.name });
      }
    }
  }

  log.info('Problem detection complete', stats);
  return stats;
};

/**
 * Seed default problem rules
 */
export const seedProblemRules = async (): Promise<void> => {
  const defaults = [
    {
      name: 'stalled_review',
      description: 'No review activity for 48 hours',
      severity: 'WARNING' as const,
      conditionType: 'NO_ACTIVITY_FOR' as const,
      conditionValue: 48,
      autoNotify: true,
    },
    {
      name: 'stalled_critical',
      description: 'No review activity for 72 hours',
      severity: 'PROBLEM' as const,
      conditionType: 'NO_ACTIVITY_FOR' as const,
      conditionValue: 72,
      autoNotify: true,
    },
    {
      name: 'multiple_rejections',
      description: 'PR rejected 3 or more times',
      severity: 'PROBLEM' as const,
      conditionType: 'REJECTION_COUNT_GTE' as const,
      conditionValue: 3,
      autoNotify: true,
    },
    {
      name: 'reviewer_churn',
      description: 'Reviewer changed 2 or more times',
      severity: 'WARNING' as const,
      conditionType: 'REVIEWER_CHANGES_GTE' as const,
      conditionValue: 2,
      autoNotify: false,
    },
    {
      name: 'ancient_pr',
      description: 'PR open for more than 7 days',
      severity: 'CRITICAL' as const,
      conditionType: 'TOTAL_AGE_GTE' as const,
      conditionValue: 168, // 7 days in hours
      autoNotify: true,
    },
  ];

  for (const rule of defaults) {
    await db.problemRule.upsert({
      where: { name: rule.name },
      create: rule,
      update: {
        description: rule.description,
        severity: rule.severity,
        conditionType: rule.conditionType,
        conditionValue: rule.conditionValue,
        autoNotify: rule.autoNotify,
      },
    });
  }

  log.info('Seeded default problem rules', { count: defaults.length });
};
