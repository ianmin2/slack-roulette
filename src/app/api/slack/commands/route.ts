import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { parsePRUrl } from '@/lib/github/parser';
import { addReviewer } from '@/lib/github/client';
import { getUserInfo, postMessage } from '@/lib/slack/client';
import { verifySlackSignature } from '@/lib/slack/security';
import { getUserAchievements, ACHIEVEMENTS } from '@/lib/achievements';
import { getActiveChallenges, formatChallengeDisplay, getWeekInfo } from '@/lib/challenges';
import { generateWeeklyDigest } from '@/lib/digest';
import {
  generateBottleneckReport,
  formatBottleneckReportForSlack,
  generateUserGrowthReport,
  formatGrowthReportForSlack,
} from '@/lib/analytics';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('slack:commands');

/**
 * Slack command payload
 */
interface SlackCommand {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
  response_url: string;
  trigger_id: string;
}

/**
 * Parse command arguments
 */
const parseArgs = (text: string): { subcommand: string; args: string[] } => {
  const parts = text.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? 'help';
  const args = parts.slice(1);
  return { subcommand, args };
};

/**
 * Handle /pr-roulette help
 */
const handleHelp = (): string => {
  return `🎲 *PR Roulette Commands*

*General*
• \`/pr-roulette help\` - Show this help message
• \`/pr-roulette stats\` - View your review statistics
• \`/pr-roulette stats @user\` - View someone else's stats

*Leaderboard*
• \`/pr-roulette leaderboard\` - Top reviewers this week
• \`/pr-roulette leaderboard month\` - Top reviewers this month

*Assignment*
• \`/pr-roulette assign <pr-url> @user\` - Manually assign a reviewer

*Team Setup*
• \`/pr-roulette add-reviewer @user <repo> [weight]\` - Add reviewer to repo pool
• \`/pr-roulette set-skills @user <skill1,skill2,...>\` - Set user's skills
• \`/pr-roulette link-github @user <github-username>\` - Link GitHub account
• \`/pr-roulette my-repos\` - Show repos you're a reviewer for

*Achievements & Challenges*
• \`/pr-roulette achievements\` - View your achievements and progress
• \`/pr-roulette challenges\` - View active weekly challenges

*Profile*
• \`/pr-roulette profile\` - View your profile and settings
• \`/pr-roulette profile @user\` - View another user's profile

*Reports & Analytics*
• \`/pr-roulette report\` - Weekly team digest
• \`/pr-roulette report <repo>\` - Weekly digest for a specific repo
• \`/pr-roulette growth\` - Your personal growth and progress report
• \`/pr-roulette growth @user\` - View another user's growth
• \`/pr-roulette bottlenecks\` - Identify bottlenecks and overloaded areas

_Post any GitHub PR link in a channel where I'm added, and I'll automatically detect it and assign a reviewer!_`;
};

/**
 * Handle /pr-roulette stats
 */
const handleStats = async (userId: string, args: string[]): Promise<string> => {
  // Check if looking up another user
  let targetUserId = userId;
  if (args.length > 0 && args[0].startsWith('<@')) {
    // Extract user ID from <@U123456|username> format
    const match = args[0].match(/<@([A-Z0-9]+)/);
    if (match) targetUserId = match[1];
  }

  const user = await db.user.findUnique({
    where: { slackId: targetUserId },
    include: {
      assignmentsAsReviewer: {
        where: { status: { in: ['COMPLETED', 'APPROVED'] } },
      },
      statistics: {
        where: { periodType: 'week' },
        orderBy: { period: 'desc' },
        take: 1,
      },
    },
  });

  if (!user) {
    return targetUserId === userId
      ? `You haven't reviewed any PRs yet. Post a PR link to get started!`
      : `<@${targetUserId}> hasn't reviewed any PRs yet.`;
  }

  const totalReviews = user.assignmentsAsReviewer.length;
  const weeklyStats = user.statistics[0];
  const weeklyReviews = weeklyStats?.completed ?? 0;
  const weeklyPoints = weeklyStats?.points ?? 0;
  const avgResponseTime = weeklyStats?.avgResponseTime
    ? `${Math.round(weeklyStats.avgResponseTime / 60)}h ${weeklyStats.avgResponseTime % 60}m`
    : 'N/A';
  const streak = weeklyStats?.streak ?? 0;

  // Calculate total points from all statistics
  const allStats = await db.statistics.findMany({
    where: { userId: user.id },
    select: { points: true },
  });
  const totalPoints = allStats.reduce((sum, s) => sum + s.points, 0);

  const isOwnStats = targetUserId === userId;
  const prefix = isOwnStats ? 'Your' : `<@${targetUserId}>'s`;

  return `📊 *${prefix} PR Review Stats*

*All Time*
• Reviews Completed: ${totalReviews}
• Total Points: ${totalPoints} 🏆

*This Week*
• Reviews: ${weeklyReviews}
• Points: ${weeklyPoints} ⭐
• Avg Response Time: ${avgResponseTime}
• Current Streak: ${streak} ${streak > 0 ? '🔥' : ''}

${isOwnStats ? '_Keep reviewing to climb the leaderboard!_' : ''}`;
};

/**
 * Handle /pr-roulette leaderboard
 */
const handleLeaderboard = async (args: string[]): Promise<string> => {
  const period = args[0]?.toLowerCase() === 'month' ? 'month' : 'week';
  const periodLabel = period === 'month' ? 'This Month' : 'This Week';

  // Get current period string
  const now = new Date();
  const periodString = period === 'week'
    ? `${now.getFullYear()}-W${String(Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7)).padStart(2, '0')}`
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const stats = await db.statistics.findMany({
    where: {
      periodType: period,
      period: periodString,
    },
    include: { user: true },
    orderBy: { completed: 'desc' },
    take: 10,
  });

  if (stats.length === 0) {
    return `🏆 *Leaderboard - ${periodLabel}*\n\nNo reviews recorded yet. Be the first!`;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const leaderboard = stats.map((s, i) => {
    const medal = medals[i] ?? `${i + 1}.`;
    const avgTime = s.avgResponseTime
      ? `${Math.round(s.avgResponseTime / 60)}h`
      : '-';
    const points = s.points > 0 ? ` • ${s.points} pts` : '';
    return `${medal} <@${s.user.slackId}> - ${s.completed} reviews (avg ${avgTime})${points}`;
  }).join('\n');

  return `🏆 *Leaderboard - ${periodLabel}*\n\n${leaderboard}`;
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
 * Handle /pr-roulette assign
 */
const handleAssign = async (
  args: string[],
  channelId: string
): Promise<string> => {
  if (args.length < 2) {
    return `Usage: \`/pr-roulette assign <pr-url> @user\`\nExample: \`/pr-roulette assign https://github.com/owner/repo/pull/123 @sarah\``;
  }

  // Parse PR URL
  const prUrl = args[0];
  const pr = parsePRUrl(prUrl);
  if (!pr) {
    return `❌ Invalid PR URL: \`${prUrl}\`\nExpected format: \`https://github.com/owner/repo/pull/123\``;
  }

  // Parse @user mention - format is <@U123456|username> or <@U123456>
  const userMention = args[1];
  const userMatch = userMention.match(/<@([A-Z0-9]+)/);
  if (!userMatch) {
    return `❌ Invalid user mention: \`${userMention}\`\nUse @ to mention a user, e.g., \`@sarah\``;
  }
  const reviewerSlackId = userMatch[1];

  try {
    // Find or create the reviewer
    const reviewer = await findOrCreateUser(reviewerSlackId);

    // Find or create repository
    let repository = await db.repository.findUnique({
      where: { fullName: pr.fullName },
    });

    if (!repository) {
      repository = await db.repository.create({
        data: {
          name: pr.repo,
          fullName: pr.fullName,
          url: `https://github.com/${pr.fullName}`,
          owner: pr.owner,
        },
      });
    }

    // Check if assignment exists
    let assignment = await db.assignment.findUnique({
      where: {
        repositoryId_prNumber: {
          repositoryId: repository.id,
          prNumber: pr.prNumber,
        },
      },
      include: { author: true },
    });

    if (assignment) {
      // Update existing assignment
      assignment = await db.assignment.update({
        where: { id: assignment.id },
        data: {
          reviewerId: reviewer.id,
          status: 'ASSIGNED',
          assignedAt: new Date(),
        },
        include: { author: true },
      });
    } else {
      // Create new assignment (we don't know the author from just the URL)
      assignment = await db.assignment.create({
        data: {
          prUrl: pr.url,
          prNumber: pr.prNumber,
          repositoryId: repository.id,
          authorId: reviewer.id, // Placeholder - ideally we'd fetch from GitHub
          reviewerId: reviewer.id,
          status: 'ASSIGNED',
          assignedAt: new Date(),
          slackChannelId: channelId,
        },
        include: { author: true },
      });
    }

    // Try to add reviewer on GitHub
    const githubSuccess = reviewer.githubUsername
      ? await addReviewer(pr.owner, pr.repo, pr.prNumber, [reviewer.githubUsername])
      : false;

    // Notify in channel
    await postMessage(
      channelId,
      `🎲 *Manual Assignment*\n\n` +
        `<@${reviewerSlackId}> has been assigned to review:\n` +
        `*<${pr.url}|${pr.fullName}#${pr.prNumber}>*` +
        (githubSuccess ? `\n✅ Added as reviewer on GitHub` : ''),
      { unfurl_links: false }
    );

    return `✅ Assigned <@${reviewerSlackId}> to *${pr.fullName}#${pr.prNumber}*` +
      (githubSuccess ? ' (added on GitHub)' : '');
  } catch (error) {
    log.error('Assignment failed', error instanceof Error ? error : undefined);
    return `❌ Failed to assign reviewer. Please try again.`;
  }
};

/**
 * Handle /pr-roulette add-reviewer @user <repo> [weight]
 */
const handleAddReviewer = async (
  args: string[],
  _executorId: string
): Promise<string> => {
  if (args.length < 2) {
    return `Usage: \`/pr-roulette add-reviewer @user <repo> [weight]\`
Example: \`/pr-roulette add-reviewer @sarah owner/repo 1.5\`

Weight is optional (default 1.0):
• 0.5 = Junior (fewer complex PRs)
• 1.0 = Mid-level (default)
• 1.5 = Senior (more weight)
• 2.0 = Lead (highest priority)`;
  }

  // Parse @user mention
  const userMention = args[0];
  const userMatch = userMention.match(/<@([A-Z0-9]+)/);
  if (!userMatch) {
    return `❌ Invalid user mention: \`${userMention}\`\nUse @ to mention a user.`;
  }
  const targetSlackId = userMatch[1];

  // Parse repo (can be "owner/repo" or just "repo")
  const repoArg = args[1];
  const weight = args[2] ? parseFloat(args[2]) : 1.0;

  if (isNaN(weight) || weight < 0.5 || weight > 2.0) {
    return `❌ Invalid weight: \`${args[2]}\`\nWeight must be between 0.5 and 2.0`;
  }

  try {
    // Find or create user
    const user = await findOrCreateUser(targetSlackId);

    // Find repository
    const repository = await db.repository.findFirst({
      where: {
        OR: [
          { fullName: repoArg },
          { name: repoArg },
        ],
      },
    });

    if (!repository) {
      return `❌ Repository not found: \`${repoArg}\`\nMake sure the repo has been used with PR Roulette before, or use the full name (e.g., \`owner/repo\`).`;
    }

    // Check if already a reviewer
    const existing = await db.repositoryReviewer.findUnique({
      where: {
        userId_repositoryId: {
          userId: user.id,
          repositoryId: repository.id,
        },
      },
    });

    if (existing) {
      // Update weight
      await db.repositoryReviewer.update({
        where: { id: existing.id },
        data: { weight, isActive: true },
      });
      return `✅ Updated <@${targetSlackId}> as reviewer for *${repository.fullName}* (weight: ${weight})`;
    }

    // Create new reviewer entry
    await db.repositoryReviewer.create({
      data: {
        userId: user.id,
        repositoryId: repository.id,
        weight,
        maxConcurrent: 5,
        isActive: true,
      },
    });

    return `✅ Added <@${targetSlackId}> as reviewer for *${repository.fullName}* (weight: ${weight})`;
  } catch (error) {
    log.error('Add reviewer failed', error instanceof Error ? error : undefined);
    return `❌ Failed to add reviewer. Please try again.`;
  }
};

/**
 * Handle /pr-roulette set-skills @user <skill1,skill2,...>
 */
const handleSetSkills = async (args: string[]): Promise<string> => {
  if (args.length < 2) {
    return `Usage: \`/pr-roulette set-skills @user <skill1,skill2,...>\`
Example: \`/pr-roulette set-skills @sarah TypeScript,React,Node.js\`

Common skills: TypeScript, JavaScript, React, Python, Go, Rust, SQL, Docker, DevOps, Testing`;
  }

  // Parse @user mention
  const userMention = args[0];
  const userMatch = userMention.match(/<@([A-Z0-9]+)/);
  if (!userMatch) {
    return `❌ Invalid user mention: \`${userMention}\`\nUse @ to mention a user.`;
  }
  const targetSlackId = userMatch[1];

  // Parse skills (comma-separated)
  const skillsArg = args.slice(1).join(' ');
  const skillNames = skillsArg.split(',').map(s => s.trim()).filter(Boolean);

  if (skillNames.length === 0) {
    return `❌ No skills provided. Use comma-separated list, e.g., \`TypeScript,React,Node.js\``;
  }

  try {
    // Find or create user
    const user = await findOrCreateUser(targetSlackId);

    // Clear existing skills
    await db.userSkill.deleteMany({
      where: { userId: user.id },
    });

    // Create skills and user-skill links
    for (const skillName of skillNames) {
      // Find or create skill
      let skill = await db.skill.findUnique({
        where: { name: skillName },
      });

      if (!skill) {
        skill = await db.skill.create({
          data: { name: skillName },
        });
      }

      // Link user to skill
      await db.userSkill.create({
        data: {
          userId: user.id,
          skillId: skill.id,
          proficiency: 3, // Default mid-level proficiency
        },
      });
    }

    return `✅ Set skills for <@${targetSlackId}>: ${skillNames.join(', ')}`;
  } catch (error) {
    log.error('Set skills failed', error instanceof Error ? error : undefined);
    return `❌ Failed to set skills. Please try again.`;
  }
};

/**
 * Handle /pr-roulette link-github @user <github-username>
 */
const handleLinkGithub = async (args: string[]): Promise<string> => {
  if (args.length < 2) {
    return `Usage: \`/pr-roulette link-github @user <github-username>\`
Example: \`/pr-roulette link-github @sarah sarahjones\`

This links a Slack user to their GitHub account for automatic reviewer assignment on GitHub PRs.`;
  }

  // Parse @user mention
  const userMention = args[0];
  const userMatch = userMention.match(/<@([A-Z0-9]+)/);
  if (!userMatch) {
    return `❌ Invalid user mention: \`${userMention}\`\nUse @ to mention a user.`;
  }
  const targetSlackId = userMatch[1];

  const githubUsername = args[1].replace(/^@/, ''); // Remove @ if present

  try {
    // Find or create user
    const user = await findOrCreateUser(targetSlackId);

    // Update GitHub username
    await db.user.update({
      where: { id: user.id },
      data: { githubUsername },
    });

    return `✅ Linked <@${targetSlackId}> to GitHub: \`${githubUsername}\`\nReviewers will now be automatically added to GitHub PRs.`;
  } catch (error) {
    log.error('Link GitHub failed', error instanceof Error ? error : undefined);
    return `❌ Failed to link GitHub account. Please try again.`;
  }
};

/**
 * Handle /pr-roulette my-repos
 */
const handleMyRepos = async (userId: string): Promise<string> => {
  try {
    const user = await db.user.findUnique({
      where: { slackId: userId },
      include: {
        repositoryReviewers: {
          where: { isActive: true },
          include: { repository: true },
        },
        skills: {
          include: { skill: true },
        },
      },
    });

    if (!user) {
      return `You're not set up as a reviewer yet. Ask an admin to add you with \`/pr-roulette add-reviewer @you <repo>\``;
    }

    const repos = user.repositoryReviewers;
    const skills = user.skills.map(us => us.skill.name);
    const githubLinked = user.githubUsername ? `\`${user.githubUsername}\`` : '_Not linked_';

    if (repos.length === 0) {
      return `📋 *Your Reviewer Profile*

*GitHub:* ${githubLinked}
*Skills:* ${skills.length > 0 ? skills.join(', ') : '_None set_'}
*Repositories:* _None - ask an admin to add you_`;
    }

    const repoList = repos.map(r => {
      const weightLabel = r.weight >= 1.5 ? 'Senior' : r.weight <= 0.5 ? 'Junior' : 'Mid';
      return `• *${r.repository.fullName}* (${weightLabel}, max ${r.maxConcurrent} concurrent)`;
    }).join('\n');

    return `📋 *Your Reviewer Profile*

*GitHub:* ${githubLinked}
*Skills:* ${skills.length > 0 ? skills.join(', ') : '_None set_'}

*Repositories:*
${repoList}`;
  } catch (error) {
    log.error('My repos failed', error instanceof Error ? error : undefined);
    return `❌ Failed to fetch your profile. Please try again.`;
  }
};

/**
 * Handle /pr-roulette achievements
 */
const handleAchievements = async (userId: string): Promise<string> => {
  try {
    const user = await db.user.findUnique({
      where: { slackId: userId },
    });

    if (!user) {
      return `You haven't started reviewing yet. Complete your first review to unlock achievements!`;
    }

    const { earned, available, progress } = await getUserAchievements(user.id);

    // Format earned achievements
    const earnedList = earned.length > 0
      ? earned.map(e => `${e.achievement.icon} *${e.achievement.displayName}*`).join('\n')
      : '_None yet - start reviewing to unlock!_';

    // Get closest achievements to unlocking
    const closestToUnlock = available
      .map(a => {
        const p = progress.get(a.name);
        if (!p) return null;
        const percent = Math.min(100, Math.round((p.current / p.required) * 100));
        return { achievement: a, percent, current: p.current, required: p.required };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.percent > 0)
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 3);

    const progressList = closestToUnlock.length > 0
      ? closestToUnlock.map(p => {
          const bar = '█'.repeat(Math.floor(p.percent / 10)) + '░'.repeat(10 - Math.floor(p.percent / 10));
          return `${p.achievement.icon} ${p.achievement.displayName}\n   ${bar} ${p.percent}% (${p.current}/${p.required})`;
        }).join('\n\n')
      : '_Complete reviews to see progress!_';

    const totalPoints = earned.reduce((sum, e) => sum + e.achievement.points, 0);
    const totalPossible = ACHIEVEMENTS.reduce((sum, a) => sum + a.points, 0);

    return `🏆 *Your Achievements*

*Earned (${earned.length}/${ACHIEVEMENTS.length})* - ${totalPoints}/${totalPossible} pts
${earnedList}

*Almost There*
${progressList}

_Complete reviews faster to unlock speed achievements!_`;
  } catch (error) {
    log.error('Achievements failed', error instanceof Error ? error : undefined);
    return `❌ Failed to fetch achievements. Please try again.`;
  }
};

/**
 * Handle /pr-roulette challenges
 */
const handleChallenges = async (userId: string): Promise<string> => {
  try {
    const user = await db.user.findUnique({
      where: { slackId: userId },
    });

    if (!user) {
      return `You haven't started reviewing yet. Complete your first review to participate in challenges!`;
    }

    const activeChallenges = await getActiveChallenges(user.id);
    const { weekNumber, year } = getWeekInfo();

    if (activeChallenges.length === 0) {
      return `🎯 *Weekly Challenges*\n\nNo active challenges this week. Check back soon!`;
    }

    // Separate individual and team challenges
    const individual = activeChallenges.filter(c => c.challenge.scope === 'INDIVIDUAL');
    const team = activeChallenges.filter(c => c.challenge.scope === 'TEAM');

    let response = `🎯 *Weekly Challenges* (Week ${weekNumber}, ${year})\n\n`;

    if (individual.length > 0) {
      response += `*Personal Challenges*\n`;
      response += individual.map(c => formatChallengeDisplay(c)).join('\n\n');
      response += '\n\n';
    }

    if (team.length > 0) {
      response += `*Team Challenges*\n`;
      response += team.map(c => formatChallengeDisplay(c)).join('\n\n');
    }

    response += `\n\n_Complete reviews to make progress. Rewards awarded on completion!_`;

    return response;
  } catch (error) {
    log.error('Challenges failed', error instanceof Error ? error : undefined);
    return `❌ Failed to fetch challenges. Please try again.`;
  }
};

/**
 * Handle /pr-roulette report [repo]
 */
const handleReport = async (args: string[]): Promise<string> => {
  try {
    // Check if a repo was specified
    let repositoryId: string | undefined;
    let repoName = 'all repositories';

    if (args.length > 0) {
      const repoArg = args[0];

      // Find repository by name or fullName
      const repository = await db.repository.findFirst({
        where: {
          OR: [
            { fullName: repoArg },
            { name: repoArg },
          ],
        },
      });

      if (!repository) {
        return `❌ Repository not found: \`${repoArg}\`\nUse \`/pr-roulette report\` to see global stats, or specify a valid repository name.`;
      }

      repositoryId = repository.id;
      repoName = repository.fullName;
    }

    // Generate the digest
    const digest = await generateWeeklyDigest(repositoryId);

    // Format for Slack (ephemeral/shorter version)
    const { period, summary, topReviewers, speedChampions, activeChallenges, trends } = digest;

    let response = `📊 *Weekly Report - Week ${period.weekNumber}*`;
    if (repositoryId) {
      response += ` (${repoName})`;
    }
    response += '\n\n';

    // Summary
    response += `*Summary*\n`;
    response += `• Reviews: ${summary.totalReviews} (${trends.reviewsVsLastWeek >= 0 ? '+' : ''}${trends.reviewsVsLastWeek}% vs last week)\n`;
    response += `• Avg Response: ${formatMinutes(summary.avgResponseTimeMinutes)}\n`;
    response += `• Completion Rate: ${Math.round(summary.completionRate * 100)}%\n`;
    response += `• Active Reviewers: ${summary.activeReviewers}\n`;

    // Top 3 reviewers
    if (topReviewers.length > 0) {
      response += '\n*Top Reviewers*\n';
      const medals = ['🥇', '🥈', '🥉'];
      topReviewers.slice(0, 3).forEach((r, i) => {
        response += `${medals[i]} <@${r.slackId}> - ${r.reviewsCompleted} reviews\n`;
      });
    }

    // Speed Champions (top 3 fastest)
    if (speedChampions.length > 0) {
      response += '\n*Speed Champions* ⚡\n';
      const speedIcons = ['🏎️', '🚀', '👟'];
      speedChampions.slice(0, 3).forEach((c, i) => {
        response += `${speedIcons[i]} <@${c.slackId}> - avg ${formatMinutes(c.avgResponseTimeMinutes)}\n`;
      });
    }

    // Active Challenges
    if (activeChallenges.length > 0) {
      response += '\n*Active Challenges* 🎯\n';
      activeChallenges.forEach(c => {
        const progressBar = `[${'█'.repeat(Math.round(c.percentComplete / 10))}${'░'.repeat(10 - Math.round(c.percentComplete / 10))}]`;
        response += `• ${c.displayName}: ${progressBar} ${c.percentComplete}%\n`;
      });
    }

    // Trend indicators
    response += '\n*Trends*\n';
    response += `• Reviews: ${getTrendEmoji(trends.reviewsVsLastWeek)}\n`;
    response += `• Response Time: ${getTrendEmoji(-trends.responseTimeVsLastWeek)}\n`;
    response += `• Participation: ${getTrendEmoji(trends.activeReviewersVsLastWeek)}\n`;

    return response;
  } catch (error) {
    log.error('Report failed', error instanceof Error ? error : undefined);
    return `❌ Failed to generate report. Please try again.`;
  }
};

/**
 * Handle /pr-roulette bottlenecks [week|month]
 */
const handleBottlenecks = async (args: string[]): Promise<string> => {
  try {
    const period = args[0] === 'month' ? 'month' : 'week';
    const report = await generateBottleneckReport(period);
    return formatBottleneckReportForSlack(report);
  } catch (error) {
    log.error('Bottleneck detection failed', error instanceof Error ? error : undefined);
    return `❌ Failed to generate bottleneck report. Please try again.`;
  }
};

/**
 * Handle /pr-roulette growth [@user]
 */
const handleGrowth = async (args: string[], currentUserId: string): Promise<string> => {
  try {
    let targetUserId = currentUserId;
    let targetSlackId = currentUserId;

    // Check if a user was specified
    if (args.length > 0 && args[0].startsWith('<@')) {
      const match = args[0].match(/<@([A-Z0-9]+)(\|[^>]+)?>/);
      if (match) {
        targetSlackId = match[1];
      }
    }

    // Find the user
    const user = await db.user.findFirst({
      where: { slackId: targetSlackId },
    });

    if (!user) {
      if (targetSlackId === currentUserId) {
        return `❌ Your account is not linked yet. Please ask an admin to add you first.`;
      }
      return `❌ User <@${targetSlackId}> not found in the system.`;
    }

    targetUserId = user.id;

    // Generate growth report
    const report = await generateUserGrowthReport(targetUserId);

    if (!report) {
      return `❌ Could not generate growth report. No data available.`;
    }

    return formatGrowthReportForSlack(report);
  } catch (error) {
    log.error('Growth report failed', error instanceof Error ? error : undefined);
    return `❌ Failed to generate growth report. Please try again.`;
  }
};

/**
 * Handle /pr-roulette profile [@user]
 */
const handleProfile = async (args: string[], currentUserId: string): Promise<string> => {
  try {
    let targetSlackId = currentUserId;

    // Check if a user was specified
    if (args.length > 0 && args[0].startsWith('<@')) {
      const match = args[0].match(/<@([A-Z0-9]+)(\|[^>]+)?>/);
      if (match) {
        targetSlackId = match[1];
      }
    }

    // Find the user with all related data
    const user = await db.user.findFirst({
      where: { slackId: targetSlackId },
      include: {
        skills: { include: { skill: true } },
        achievements: { include: { achievement: true } },
        repositoryReviewers: { include: { repository: true } },
      },
    });

    if (!user) {
      if (targetSlackId === currentUserId) {
        return `❌ Your account is not linked yet. Please ask an admin to add you first.`;
      }
      return `❌ User <@${targetSlackId}> not found in the system.`;
    }

    // Get stats
    const stats = await db.statistics.findFirst({
      where: { userId: user.id, repositoryId: null, periodType: 'all_time' },
      orderBy: { period: 'desc' },
    });

    const pendingReviews = await db.assignment.count({
      where: {
        reviewerId: user.id,
        status: { in: ['ASSIGNED', 'IN_REVIEW'] },
      },
    });

    // Format skills
    const skillsList = user.skills.length > 0
      ? user.skills.map(us => {
          const profLevel = ['', '🌱', '🌿', '🌳', '🌲', '🎋'][us.proficiency] ?? '🌱';
          return `${profLevel} ${us.skill.name}`;
        }).join(', ')
      : '_No skills set_';

    // Format repos
    const activeRepos = user.repositoryReviewers.filter(r => r.isActive);
    const reposList = activeRepos.length > 0
      ? activeRepos
          .slice(0, 5)
          .map(r => `\`${r.repository.fullName}\``)
          .join(', ')
      : '_Not assigned to any repos_';

    // Format achievements (top 5)
    const achievementsList = user.achievements.length > 0
      ? user.achievements
          .slice(0, 5)
          .map(ua => `${ua.achievement.icon}`)
          .join(' ')
      : '_None yet_';

    // Format working hours
    const workingHours = user.workingHoursStart && user.workingHoursEnd
      ? `${user.workingHoursStart} - ${user.workingHoursEnd} (${user.timezone || 'UTC'})`
      : '_Not configured_';

    // Format availability status
    const statusEmoji: Record<string, string> = {
      AVAILABLE: '🟢',
      BUSY: '🟡',
      VACATION: '🏖️',
      UNAVAILABLE: '🔴',
    };
    const status = `${statusEmoji[user.availabilityStatus] ?? '⚪'} ${user.availabilityStatus}`;

    // Build profile output
    const isSelf = targetSlackId === currentUserId;
    const profileTitle = isSelf ? 'Your Profile' : `Profile: ${user.displayName}`;

    let response = `👤 *${profileTitle}*\n\n`;

    // Basic info
    response += `*Status:* ${status}\n`;
    if (user.githubUsername) {
      response += `*GitHub:* \`${user.githubUsername}\`\n`;
    }
    response += `*Role:* ${user.role}\n`;
    response += '\n';

    // Stats section
    response += `*📊 Stats*\n`;
    response += `>Reviews Completed: *${stats?.completed ?? 0}*\n`;
    response += `>Pending Reviews: *${pendingReviews}*\n`;
    if (stats?.avgResponseTime) {
      response += `>Avg Response Time: *${formatMinutes(Math.round(stats.avgResponseTime))}*\n`;
    }
    response += `>Total Points: *${stats?.points ?? 0}*\n`;
    if (stats?.streak && stats.streak > 0) {
      response += `>Current Streak: *${stats.streak} days* 🔥\n`;
    }
    response += '\n';

    // Skills
    response += `*🛠️ Skills*\n`;
    response += `>${skillsList}\n\n`;

    // Repositories
    response += `*📁 Repositories*\n`;
    response += `>${reposList}\n`;
    if (activeRepos.length > 5) {
      response += `> _+${activeRepos.length - 5} more_\n`;
    }
    response += '\n';

    // Achievements
    response += `*🏆 Achievements* (${user.achievements.length})\n`;
    response += `>${achievementsList}\n\n`;

    // Settings (only show to self)
    if (isSelf) {
      response += `*⚙️ Settings*\n`;
      response += `>Working Hours: ${workingHours}\n`;
      response += `>Working Days: ${(user.workingDays || []).join(', ') || '_Not set_'}\n`;
      response += '\n';

      response += '_Edit settings with `/pr-roulette set-skills`, `/pr-roulette link-github`_';
    }

    return response;
  } catch (error) {
    log.error('Profile failed', error instanceof Error ? error : undefined);
    return `❌ Failed to fetch profile. Please try again.`;
  }
};

/**
 * Format minutes to human readable
 */
const formatMinutes = (minutes: number): string => {
  if (minutes === 0) return 'N/A';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

/**
 * Get trend emoji based on percentage change
 */
const getTrendEmoji = (change: number): string => {
  if (change > 10) return '📈 Strong improvement';
  if (change > 0) return '↗️ Improving';
  if (change === 0) return '➡️ Stable';
  if (change > -10) return '↘️ Slight decline';
  return '📉 Needs attention';
};

/**
 * Route command to handler
 */
const routeCommand = async (cmd: SlackCommand): Promise<string> => {
  const { subcommand, args } = parseArgs(cmd.text);

  switch (subcommand) {
    case 'help':
    case '':
      return handleHelp();

    case 'stats':
      return handleStats(cmd.user_id, args);

    case 'leaderboard':
    case 'lb':
      return handleLeaderboard(args);

    case 'assign':
      return handleAssign(args, cmd.channel_id);

    case 'add-reviewer':
    case 'addreviewer':
      return handleAddReviewer(args, cmd.user_id);

    case 'set-skills':
    case 'setskills':
    case 'skills':
      return handleSetSkills(args);

    case 'link-github':
    case 'linkgithub':
    case 'github':
      return handleLinkGithub(args);

    case 'my-repos':
    case 'myrepos':
    case 'profile':
      return handleMyRepos(cmd.user_id);

    case 'achievements':
    case 'badges':
      return handleAchievements(cmd.user_id);

    case 'challenges':
    case 'challenge':
    case 'goals':
      return handleChallenges(cmd.user_id);

    case 'report':
    case 'digest':
    case 'weekly':
      return handleReport(args);

    case 'bottlenecks':
    case 'bottleneck':
    case 'issues':
      return handleBottlenecks(args);

    case 'growth':
    case 'progress':
    case 'trajectory':
      return handleGrowth(args, cmd.user_id);

    case 'profile':
    case 'me':
    case 'whoami':
      return handleProfile(args, cmd.user_id);

    default:
      return `Unknown command: \`${subcommand}\`\nUse \`/pr-roulette help\` to see available commands.`;
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

  // Parse form data
  const params = new URLSearchParams(body);
  const cmd: SlackCommand = {
    command: params.get('command') ?? '',
    text: params.get('text') ?? '',
    user_id: params.get('user_id') ?? '',
    user_name: params.get('user_name') ?? '',
    channel_id: params.get('channel_id') ?? '',
    channel_name: params.get('channel_name') ?? '',
    response_url: params.get('response_url') ?? '',
    trigger_id: params.get('trigger_id') ?? '',
  };

  log.info('Command received', { command: cmd.command, text: cmd.text, user: cmd.user_name });

  try {
    const response = await routeCommand(cmd);

    // Return ephemeral response (only visible to user who ran command)
    return NextResponse.json({
      response_type: 'ephemeral',
      text: response,
    });
  } catch (error) {
    log.error('Command execution failed', error instanceof Error ? error : undefined);
    return NextResponse.json({
      response_type: 'ephemeral',
      text: '❌ Something went wrong. Please try again.',
    });
  }
}
