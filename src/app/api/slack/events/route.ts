import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { extractPRUrls, type ParsedPRUrl } from '@/lib/github/parser';
import { getPullRequest, getPullRequestFiles, addReviewer } from '@/lib/github/client';
import { getUserInfo, postMessage, addReaction } from '@/lib/slack/client';
import { verifySlackSignature } from '@/lib/slack/security';
import { publishAppHome } from '@/lib/slack/views/app-home';
import { handleReactionEvent } from '@/lib/slack/reactions';
import { handleMemberJoined, handleMemberLeft } from '@/lib/sync';
import { selectReviewer, formatSelectionSummary } from '@/lib/assignment/selector';
import { recordAssignment } from '@/lib/stats';
import { createLogger } from '@/lib/utils/logger';
import type { PRComplexity } from '@/generated/prisma';

const log = createLogger('slack:events');

/**
 * Determine PR complexity based on changes
 */
const calculateComplexity = (
  linesChanged: number,
  filesChanged: number
): PRComplexity => {
  if (linesChanged < 10) return 'TRIVIAL';
  if (linesChanged < 50 && filesChanged <= 3) return 'SMALL';
  if (linesChanged < 200 && filesChanged <= 10) return 'MEDIUM';
  if (linesChanged < 500) return 'LARGE';
  return 'COMPLEX';
};

/**
 * Calculate effort score based on PR metrics
 */
const calculateEffortScore = (
  linesChanged: number,
  filesChanged: number
): number => {
  // Simplified effort formula
  return Math.round(linesChanged * 0.1 + filesChanged * 2);
};

/**
 * Find or create a user from Slack
 */
const findOrCreateUser = async (slackId: string) => {
  const existing = await db.user.findUnique({ where: { slackId } });
  if (existing) return existing;

  const slackUser = await getUserInfo(slackId);
  if (!slackUser) {
    throw new Error(`Could not fetch Slack user info for ${slackId}`);
  }

  return db.user.create({
    data: {
      slackId,
      displayName: slackUser.profile.display_name || slackUser.real_name || slackUser.name,
      email: slackUser.profile.email,
      avatarUrl: slackUser.profile.image_48,
    },
  });
};

/**
 * Find or create a repository
 */
const findOrCreateRepository = async (pr: ParsedPRUrl) => {
  const existing = await db.repository.findUnique({
    where: { fullName: pr.fullName },
  });
  if (existing) return existing;

  return db.repository.create({
    data: {
      name: pr.repo,
      fullName: pr.fullName,
      url: `https://github.com/${pr.fullName}`,
      owner: pr.owner,
    },
  });
};

/**
 * Detect skills required based on file extensions
 */
const detectSkills = (files: { filename: string }[]): string[] => {
  const skills = new Set<string>();
  const extensionMap: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'React',
    '.js': 'JavaScript',
    '.jsx': 'React',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.swift': 'Swift',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.sql': 'SQL',
    '.prisma': 'Prisma',
    '.yml': 'DevOps',
    '.yaml': 'DevOps',
    '.dockerfile': 'Docker',
  };

  for (const file of files) {
    const ext = file.filename.substring(file.filename.lastIndexOf('.')).toLowerCase();
    if (extensionMap[ext]) {
      skills.add(extensionMap[ext]);
    }
    if (file.filename.toLowerCase().includes('test')) {
      skills.add('Testing');
    }
    if (file.filename.toLowerCase() === 'dockerfile' || file.filename.includes('docker')) {
      skills.add('Docker');
    }
  }

  return Array.from(skills);
};

/**
 * Get complexity emoji
 */
const getComplexityEmoji = (complexity: PRComplexity): string => {
  const emojis: Record<PRComplexity, string> = {
    TRIVIAL: '🟢',
    SMALL: '🟡',
    MEDIUM: '🟠',
    LARGE: '🔴',
    COMPLEX: '🔴🔴',
  };
  return emojis[complexity];
};

/**
 * Process a detected PR
 */
const processPRDetection = async (
  pr: ParsedPRUrl,
  slackUserId: string,
  channelId: string,
  messageTs: string
) => {
  // Get or create user and repo
  const [author, repository] = await Promise.all([
    findOrCreateUser(slackUserId),
    findOrCreateRepository(pr),
  ]);

  // Check if assignment already exists
  const existingAssignment = await db.assignment.findUnique({
    where: {
      repositoryId_prNumber: {
        repositoryId: repository.id,
        prNumber: pr.prNumber,
      },
    },
  });

  if (existingAssignment) {
    log.debug('Assignment already exists', { pr: `${pr.fullName}#${pr.prNumber}` });
    return { assignment: existingAssignment, isNew: false };
  }

  // Fetch PR details from GitHub
  const [ghPR, ghFiles] = await Promise.all([
    getPullRequest(pr.owner, pr.repo, pr.prNumber),
    getPullRequestFiles(pr.owner, pr.repo, pr.prNumber),
  ]);

  const linesChanged = ghPR ? ghPR.additions + ghPR.deletions : 0;
  const filesChanged = ghPR?.changed_files ?? ghFiles.length;
  const complexity = calculateComplexity(linesChanged, filesChanged);
  const effortScore = calculateEffortScore(linesChanged, filesChanged);
  const skills = detectSkills(ghFiles);

  // Create new assignment with GitHub data
  const assignment = await db.assignment.create({
    data: {
      prUrl: pr.url,
      prNumber: pr.prNumber,
      prTitle: ghPR?.title,
      repositoryId: repository.id,
      authorId: author.id,
      slackChannelId: channelId,
      slackMessageTs: messageTs,
      status: 'PENDING',
      linesChanged,
      filesChanged,
      complexity,
      effortScore,
      skillsRequired: skills,
    },
  });

  log.info('Created assignment', { pr: `${pr.fullName}#${pr.prNumber}`, complexity });

  // Auto-assign reviewer if enabled
  let selectedReviewer = null;
  let selectionReason = '';

  if (repository.autoAssignment) {
    const selectionResult = await selectReviewer({
      authorId: author.id,
      repositoryId: repository.id,
      skillsRequired: skills,
      complexity,
      prNumber: pr.prNumber,
    });

    log.debug('Reviewer selection', { summary: formatSelectionSummary(selectionResult) });

    if (selectionResult.selected) {
      selectedReviewer = selectionResult.selected.user;
      selectionReason = selectionResult.reason;

      // Update assignment with reviewer
      await db.assignment.update({
        where: { id: assignment.id },
        data: {
          reviewerId: selectedReviewer.id,
          status: 'ASSIGNED',
          assignedAt: new Date(),
        },
      });

      // Record statistics
      await recordAssignment(selectedReviewer.id, repository.id);

      // Try to add reviewer on GitHub
      if (selectedReviewer.githubUsername) {
        const githubSuccess = await addReviewer(
          pr.owner,
          pr.repo,
          pr.prNumber,
          [selectedReviewer.githubUsername]
        );

        if (githubSuccess) {
          await db.assignment.update({
            where: { id: assignment.id },
            data: { githubSynced: true },
          });
        }
      }
    } else {
      selectionReason = selectionResult.reason;
    }
  }

  return {
    assignment,
    isNew: true,
    ghPR,
    complexity,
    skills,
    selectedReviewer,
    selectionReason,
  };
};

/**
 * Handle message events
 */
const handleMessageEvent = async (event: {
  type: string;
  text?: string;
  user?: string;
  channel?: string;
  ts?: string;
  bot_id?: string;
  subtype?: string;
}) => {
  // Ignore bot messages and message edits/deletions
  if (event.bot_id || event.subtype) return;
  if (!event.text || !event.user || !event.channel || !event.ts) return;

  const prUrls = extractPRUrls(event.text);
  if (prUrls.length === 0) return;

  log.info('Detected PRs in message', { count: prUrls.length, user: event.user, urls: prUrls.map(p => p.url) });

  // Add eyes emoji to acknowledge detection
  await addReaction(event.channel, event.ts, 'eyes');

  // Process each PR
  for (const pr of prUrls) {
    try {
      const result = await processPRDetection(pr, event.user, event.channel, event.ts);

      if (result.isNew) {
        const { ghPR, complexity, skills, selectedReviewer, selectionReason } = result as {
          assignment: typeof result.assignment;
          isNew: true;
          ghPR?: { title: string; additions: number; deletions: number; changed_files: number };
          complexity: PRComplexity;
          skills: string[];
          selectedReviewer?: { id: string; slackId: string; displayName: string; githubUsername?: string | null };
          selectionReason: string;
        };

        const title = ghPR?.title ?? `PR #${pr.prNumber}`;
        const emoji = getComplexityEmoji(complexity);
        const skillsText = skills.length > 0 ? `\n*Skills:* ${skills.join(', ')}` : '';

        // Build assignment message
        let assignmentText: string;
        if (selectedReviewer) {
          const githubNote = result.assignment
            ? ' ✅ Added on GitHub'
            : '';
          assignmentText = `\n\n🎯 *Assigned to:* <@${selectedReviewer.slackId}>${githubNote}`;
        } else {
          assignmentText = `\n\n⚠️ _${selectionReason}_\nUse \`/pr-roulette assign ${pr.url} @user\` to assign manually.`;
        }

        await postMessage(
          event.channel,
          `🎲 *PR Detected*\n\n` +
          `*<${pr.url}|${pr.fullName}#${pr.prNumber}>*\n` +
          `${title}\n\n` +
          `${emoji} *Complexity:* ${complexity.toLowerCase()}\n` +
          `📝 *Changes:* +${ghPR?.additions ?? 0} / -${ghPR?.deletions ?? 0} in ${ghPR?.changed_files ?? 0} files` +
          skillsText +
          assignmentText,
          { thread_ts: event.ts, unfurl_links: false }
        );

        // Add complexity reaction
        const complexityReactions: Record<PRComplexity, string> = {
          TRIVIAL: 'white_check_mark',
          SMALL: 'thumbsup',
          MEDIUM: 'eyes',
          LARGE: 'warning',
          COMPLEX: 'rotating_light',
        };
        await addReaction(event.channel, event.ts, complexityReactions[complexity]);
      }
    } catch (error) {
      log.error('Error processing PR', error instanceof Error ? error : undefined, { url: pr.url });
    }
  }
};

export async function POST(request: NextRequest) {
  const body = await request.text();
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';
  const signature = request.headers.get('x-slack-signature') ?? '';

  // Verify signature
  if (!verifySlackSignature(signature, timestamp, body)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);

  // Handle URL verification
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Handle event callbacks
  if (payload.type === 'event_callback') {
    const event = payload.event;

    if (event.type === 'message') {
      // Process async to avoid Slack timeout
      handleMessageEvent(event).catch((err) => log.error('Message event handler failed', err instanceof Error ? err : undefined));
    }

    if (event.type === 'app_home_opened') {
      // Refresh App Home when user opens it
      publishAppHome(event.user).catch((err) => log.error('App Home publish failed', err instanceof Error ? err : undefined));
    }

    if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
      // Process reaction events for status tracking
      handleReactionEvent(event).catch((err) =>
        log.error('Reaction event handler failed', err instanceof Error ? err : undefined)
      );
    }

    if (event.type === 'member_joined_channel') {
      handleMemberJoined(event).catch((err) =>
        log.error('Member joined handler failed', err instanceof Error ? err : undefined)
      );
    }

    if (event.type === 'member_left_channel') {
      handleMemberLeft(event).catch((err) =>
        log.error('Member left handler failed', err instanceof Error ? err : undefined)
      );
    }
  }

  // Acknowledge immediately (Slack requires <3s response)
  return NextResponse.json({ ok: true });
}
