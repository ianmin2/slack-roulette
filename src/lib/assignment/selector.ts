/**
 * Smart Reviewer Selection Service
 *
 * Implements intelligent reviewer assignment based on:
 * - Eligibility (not author, available, not overloaded)
 * - Developer weight (0.5x junior → 2.0x senior)
 * - Current workload (pending reviews)
 * - Expertise matching (skills alignment)
 * - Fairness (recent assignment distribution)
 */

import { db } from '@/lib/db';
import type { User, RepositoryReviewer, PRComplexity } from '@/generated/prisma';

/**
 * Reviewer candidate with computed scores
 */
export interface ReviewerCandidate {
  user: User;
  repoReviewer: RepositoryReviewer;
  scores: {
    weight: number;          // Base developer weight (0.5-2.0)
    workload: number;        // Inverse of current load (0-1)
    expertise: number;       // Skill match score (0-1)
    fairness: number;        // Recent assignment balance (0-1)
    availability: number;    // Working hours/status (0-1)
  };
  totalScore: number;
  pendingReviews: number;
  disqualifyReason?: string;
  warning?: string;          // Non-blocking warning (e.g., outside working hours)
}

/**
 * Selection criteria for finding reviewers
 */
export interface SelectionCriteria {
  authorId: string;
  repositoryId: string;
  skillsRequired: string[];
  complexity: PRComplexity;
  prNumber: number;
}

/**
 * Selection result
 */
export interface SelectionResult {
  selected: ReviewerCandidate | null;
  candidates: ReviewerCandidate[];
  reason: string;
  warning?: string;          // Non-blocking warning about the selection
}

/**
 * Score weights for different factors
 */
const SCORE_WEIGHTS = {
  weight: 0.25,      // Developer seniority weight
  workload: 0.30,    // Current workload (most important)
  expertise: 0.25,   // Skill match
  fairness: 0.15,    // Recent assignment balance
  availability: 0.05, // Working hours (tie-breaker)
};

/**
 * Complexity weights for cognitive load calculation
 * Each pending PR adds to cognitive load based on its complexity
 */
const COMPLEXITY_WEIGHTS: Record<string, number> = {
  TRIVIAL: 0.25,    // Quick doc/config changes
  SMALL: 0.5,       // Simple changes
  MEDIUM: 1.0,      // Standard PRs
  LARGE: 2.0,       // Significant changes
  COMPLEX: 3.0,     // Complex refactors/features
};

/**
 * Cognitive load thresholds
 */
const COGNITIVE_LOAD_THRESHOLDS = {
  soft: 3.0,        // Soft warning threshold (reduced priority)
  hard: 5.0,        // Hard limit (cannot assign more)
  optimal: 2.0,     // Optimal cognitive load
};

/**
 * Complexity thresholds for junior/senior requirements
 */
const COMPLEXITY_REQUIRES_SENIOR: PRComplexity[] = ['LARGE', 'COMPLEX'];
const SENIOR_WEIGHT_THRESHOLD = 1.2;

/**
 * Get all eligible reviewers for a repository
 */
const getEligibleReviewers = async (
  repositoryId: string,
  authorId: string
): Promise<Array<{ user: User; repoReviewer: RepositoryReviewer }>> => {
  const reviewers = await db.repositoryReviewer.findMany({
    where: {
      repositoryId,
      isActive: true,
      user: {
        id: { not: authorId },
        deletedAt: null,
        availabilityStatus: { not: 'UNAVAILABLE' },
      },
    },
    include: {
      user: {
        include: {
          skills: {
            include: { skill: true },
          },
        },
      },
    },
  });

  return reviewers.map((r) => ({
    user: r.user,
    repoReviewer: r,
  }));
};

/**
 * Cognitive load result with detailed breakdown
 */
export interface CognitiveLoadResult {
  totalLoad: number;           // Weighted cognitive load
  pendingCount: number;        // Raw pending count
  breakdown: {                 // Count by complexity
    trivial: number;
    small: number;
    medium: number;
    large: number;
    complex: number;
  };
  status: 'optimal' | 'elevated' | 'high' | 'overloaded';
  canAcceptMore: boolean;
  warningMessage?: string;
}

/**
 * Calculate cognitive load for a user based on complexity-weighted pending reviews
 */
export const calculateCognitiveLoad = async (userId: string): Promise<CognitiveLoadResult> => {
  // Get all pending assignments with their complexity
  const pendingAssignments = await db.assignment.findMany({
    where: {
      reviewerId: userId,
      status: { in: ['ASSIGNED', 'IN_REVIEW'] },
    },
    select: {
      complexity: true,
    },
  });

  // Calculate weighted load
  let totalLoad = 0;
  const breakdown = {
    trivial: 0,
    small: 0,
    medium: 0,
    large: 0,
    complex: 0,
  };

  for (const assignment of pendingAssignments) {
    const complexityWeight = COMPLEXITY_WEIGHTS[assignment.complexity] ?? 1.0;
    totalLoad += complexityWeight;

    // Update breakdown
    const key = assignment.complexity.toLowerCase() as keyof typeof breakdown;
    if (key in breakdown) {
      breakdown[key]++;
    }
  }

  // Determine status
  let status: 'optimal' | 'elevated' | 'high' | 'overloaded';
  let canAcceptMore = true;
  let warningMessage: string | undefined;

  if (totalLoad >= COGNITIVE_LOAD_THRESHOLDS.hard) {
    status = 'overloaded';
    canAcceptMore = false;
    warningMessage = `At capacity (cognitive load: ${totalLoad.toFixed(1)})`;
  } else if (totalLoad >= COGNITIVE_LOAD_THRESHOLDS.soft) {
    status = 'high';
    canAcceptMore = true; // Can still accept, but with reduced priority
    warningMessage = `Approaching capacity (cognitive load: ${totalLoad.toFixed(1)})`;
  } else if (totalLoad > COGNITIVE_LOAD_THRESHOLDS.optimal) {
    status = 'elevated';
    canAcceptMore = true;
  } else {
    status = 'optimal';
    canAcceptMore = true;
  }

  return {
    totalLoad,
    pendingCount: pendingAssignments.length,
    breakdown,
    status,
    canAcceptMore,
    warningMessage,
  };
};

/**
 * Get recent assignments for fairness calculation
 */
const getRecentAssignments = async (
  repositoryId: string,
  days = 7
): Promise<Map<string, number>> => {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const assignments = await db.assignment.groupBy({
    by: ['reviewerId'],
    where: {
      repositoryId,
      assignedAt: { gte: since },
      reviewerId: { not: null },
    },
    _count: { id: true },
  });

  const counts = new Map<string, number>();
  for (const a of assignments) {
    if (a.reviewerId) {
      counts.set(a.reviewerId, a._count.id);
    }
  }
  return counts;
};

/**
 * Calculate expertise match score
 */
const calculateExpertiseScore = (
  userSkills: Array<{ skill: { name: string }; proficiency: number }>,
  requiredSkills: string[]
): number => {
  if (requiredSkills.length === 0) return 0.5; // Neutral if no skills required

  const userSkillMap = new Map(
    userSkills.map((us) => [us.skill.name.toLowerCase(), us.proficiency])
  );

  let totalScore = 0;
  let matchedCount = 0;

  for (const required of requiredSkills) {
    const proficiency = userSkillMap.get(required.toLowerCase());
    if (proficiency !== undefined) {
      // Normalize proficiency (1-5) to 0-1
      totalScore += proficiency / 5;
      matchedCount++;
    }
  }

  if (matchedCount === 0) return 0.1; // Low score if no matches

  // Weighted by match coverage
  const coverage = matchedCount / requiredSkills.length;
  const avgProficiency = totalScore / matchedCount;

  return coverage * 0.5 + avgProficiency * 0.5;
};

/**
 * Calculate workload score using cognitive load (inverse - lower load = higher score)
 */
const calculateWorkloadScore = (
  cognitiveLoad: number,
  pendingCount: number,
  maxConcurrent: number
): number => {
  // First check raw count against max concurrent
  if (pendingCount >= maxConcurrent) return 0;

  // Check cognitive load against hard threshold
  if (cognitiveLoad >= COGNITIVE_LOAD_THRESHOLDS.hard) return 0;

  // Calculate base score from cognitive load
  // Optimal = 1.0, soft threshold = 0.3, hard threshold = 0.0
  if (cognitiveLoad <= COGNITIVE_LOAD_THRESHOLDS.optimal) {
    return 1.0;
  }

  if (cognitiveLoad <= COGNITIVE_LOAD_THRESHOLDS.soft) {
    // Linear decrease from 1.0 to 0.5 between optimal and soft
    const range = COGNITIVE_LOAD_THRESHOLDS.soft - COGNITIVE_LOAD_THRESHOLDS.optimal;
    const position = cognitiveLoad - COGNITIVE_LOAD_THRESHOLDS.optimal;
    return 1.0 - (position / range) * 0.5;
  }

  // Between soft and hard: 0.5 to 0.0
  const range = COGNITIVE_LOAD_THRESHOLDS.hard - COGNITIVE_LOAD_THRESHOLDS.soft;
  const position = cognitiveLoad - COGNITIVE_LOAD_THRESHOLDS.soft;
  return 0.5 - (position / range) * 0.5;
};

/**
 * Calculate fairness score based on recent assignments
 */
const calculateFairnessScore = (
  recentCount: number,
  avgCount: number,
  maxCount: number
): number => {
  if (maxCount === 0) return 1; // No recent assignments = fair

  // Prefer reviewers with fewer recent assignments
  const deviation = recentCount - avgCount;

  if (deviation <= 0) return 1; // At or below average
  if (deviation >= avgCount) return 0.2; // Well above average

  return 1 - (deviation / (avgCount * 2));
};

/**
 * Calculate availability score based on status and working hours
 */
/**
 * Check if current time is within user's working hours
 */
const isWithinWorkingHours = (user: User): { inHours: boolean; score: number; message?: string } => {
  // Get current time in user's timezone
  const now = new Date();

  try {
    // Convert to user's timezone
    const userTimezone = user.timezone || 'UTC';
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'long',
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '12', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() ?? 'monday';

    // Check if today is a working day
    const workingDays = user.workingDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    if (!workingDays.includes(weekday)) {
      return { inHours: false, score: 0.2, message: `Not a working day (${weekday})` };
    }

    // Parse working hours
    const startHour = parseTimeString(user.workingHoursStart || '09:00');
    const endHour = parseTimeString(user.workingHoursEnd || '18:00');
    const currentMinutes = hour * 60 + minute;

    // Check if within working hours
    if (currentMinutes >= startHour && currentMinutes <= endHour) {
      return { inHours: true, score: 1.0 };
    }

    // Calculate how far outside working hours
    const minutesOutside = currentMinutes < startHour
      ? startHour - currentMinutes
      : currentMinutes - endHour;

    // Score decreases as we get further from working hours
    // Within 1 hour: 0.6, Within 2 hours: 0.4, More than 2 hours: 0.2
    if (minutesOutside <= 60) {
      return { inHours: false, score: 0.6, message: 'Just outside working hours' };
    } else if (minutesOutside <= 120) {
      return { inHours: false, score: 0.4, message: 'Outside working hours' };
    } else {
      return { inHours: false, score: 0.2, message: 'Well outside working hours' };
    }
  } catch {
    // If timezone parsing fails, assume available
    return { inHours: true, score: 0.8 };
  }
};

/**
 * Parse time string (HH:MM) to minutes since midnight
 */
const parseTimeString = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

/**
 * Calculate availability score based on status and working hours
 */
const calculateAvailabilityScore = (user: User): number => {
  const statusScores: Record<string, number> = {
    AVAILABLE: 1.0,
    BUSY: 0.5,
    VACATION: 0.0,
    UNAVAILABLE: 0.0,
  };

  const baseScore = statusScores[user.availabilityStatus] ?? 0.5;

  // If user is unavailable or on vacation, just return 0
  if (baseScore === 0) return 0;

  // Check working hours
  const workingHoursCheck = isWithinWorkingHours(user);

  // Combine status score with working hours score
  return baseScore * workingHoursCheck.score;
};

/**
 * Select the best reviewer for a PR
 */
export const selectReviewer = async (
  criteria: SelectionCriteria
): Promise<SelectionResult> => {
  const { authorId, repositoryId, skillsRequired, complexity } = criteria;

  // Get repository settings
  const repository = await db.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    return {
      selected: null,
      candidates: [],
      reason: 'Repository not found',
    };
  }

  // Get all eligible reviewers
  const eligibleReviewers = await getEligibleReviewers(repositoryId, authorId);

  if (eligibleReviewers.length === 0) {
    return {
      selected: null,
      candidates: [],
      reason: 'No eligible reviewers found for this repository',
    };
  }

  // Get recent assignment data for fairness
  const recentAssignments = await getRecentAssignments(repositoryId);
  const recentCounts = Array.from(recentAssignments.values());
  const avgRecentCount = recentCounts.length > 0
    ? recentCounts.reduce((a, b) => a + b, 0) / recentCounts.length
    : 0;
  const maxRecentCount = recentCounts.length > 0
    ? Math.max(...recentCounts)
    : 0;

  // Calculate scores for each candidate
  const candidates: ReviewerCandidate[] = [];

  for (const { user, repoReviewer } of eligibleReviewers) {
    // Calculate cognitive load for better workload assessment
    const cognitiveLoad = await calculateCognitiveLoad(user.id);

    // Check cognitive load overload
    if (!cognitiveLoad.canAcceptMore) {
      candidates.push({
        user,
        repoReviewer,
        scores: { weight: 0, workload: 0, expertise: 0, fairness: 0, availability: 0 },
        totalScore: 0,
        pendingReviews: cognitiveLoad.pendingCount,
        disqualifyReason: cognitiveLoad.warningMessage ?? `Overloaded (cognitive load: ${cognitiveLoad.totalLoad.toFixed(1)})`,
      });
      continue;
    }

    // Check raw count overload
    if (cognitiveLoad.pendingCount >= repoReviewer.maxConcurrent) {
      candidates.push({
        user,
        repoReviewer,
        scores: { weight: 0, workload: 0, expertise: 0, fairness: 0, availability: 0 },
        totalScore: 0,
        pendingReviews: cognitiveLoad.pendingCount,
        disqualifyReason: `At max capacity (${cognitiveLoad.pendingCount}/${repoReviewer.maxConcurrent} reviews)`,
      });
      continue;
    }

    // Check senior requirement for complex PRs
    if (
      repository.requireSeniorComplex &&
      COMPLEXITY_REQUIRES_SENIOR.includes(complexity) &&
      repoReviewer.weight < SENIOR_WEIGHT_THRESHOLD
    ) {
      candidates.push({
        user,
        repoReviewer,
        scores: { weight: 0, workload: 0, expertise: 0, fairness: 0, availability: 0 },
        totalScore: 0,
        pendingReviews: cognitiveLoad.pendingCount,
        disqualifyReason: `Junior developer cannot review ${complexity} PR`,
      });
      continue;
    }

    // Check unavailable status
    if (user.availabilityStatus === 'UNAVAILABLE' || user.availabilityStatus === 'VACATION') {
      candidates.push({
        user,
        repoReviewer,
        scores: { weight: 0, workload: 0, expertise: 0, fairness: 0, availability: 0 },
        totalScore: 0,
        pendingReviews: cognitiveLoad.pendingCount,
        disqualifyReason: `User is ${user.availabilityStatus.toLowerCase()}`,
      });
      continue;
    }

    // Calculate individual scores
    const userWithSkills = user as User & { skills: Array<{ skill: { name: string }; proficiency: number }> };

    // Check working hours for warning
    const workingHoursStatus = isWithinWorkingHours(user);
    const warning = !workingHoursStatus.inHours ? workingHoursStatus.message : undefined;

    const scores = {
      weight: repoReviewer.weight / 2, // Normalize to 0-1 (max weight is 2.0)
      workload: calculateWorkloadScore(
        cognitiveLoad.totalLoad,
        cognitiveLoad.pendingCount,
        repoReviewer.maxConcurrent
      ),
      expertise: calculateExpertiseScore(userWithSkills.skills || [], skillsRequired),
      fairness: calculateFairnessScore(
        recentAssignments.get(user.id) ?? 0,
        avgRecentCount,
        maxRecentCount
      ),
      availability: calculateAvailabilityScore(user),
    };

    // Calculate weighted total
    const totalScore =
      scores.weight * SCORE_WEIGHTS.weight +
      scores.workload * SCORE_WEIGHTS.workload +
      scores.expertise * SCORE_WEIGHTS.expertise +
      scores.fairness * SCORE_WEIGHTS.fairness +
      scores.availability * SCORE_WEIGHTS.availability;

    candidates.push({
      user,
      repoReviewer,
      scores,
      totalScore,
      pendingReviews: cognitiveLoad.pendingCount,
      warning,
    });
  }

  // Sort by total score (highest first)
  const qualifiedCandidates = candidates
    .filter((c) => !c.disqualifyReason)
    .sort((a, b) => b.totalScore - a.totalScore);

  if (qualifiedCandidates.length === 0) {
    // All reviewers are disqualified
    const reasons = candidates
      .map((c) => c.disqualifyReason)
      .filter(Boolean)
      .join('; ');

    return {
      selected: null,
      candidates,
      reason: `All reviewers disqualified: ${reasons}`,
    };
  }

  // Select the top candidate
  const selected = qualifiedCandidates[0];

  // Add randomness among top candidates with similar scores
  // This prevents always picking the same person when scores are close
  const topScore = selected.totalScore;
  const closeContenders = qualifiedCandidates.filter(
    (c) => c.totalScore >= topScore - 0.05 // Within 5% of top score
  );

  if (closeContenders.length > 1) {
    // Random selection among close contenders
    const randomIndex = Math.floor(Math.random() * closeContenders.length);
    const randomSelected = closeContenders[randomIndex];

    return {
      selected: randomSelected,
      candidates,
      reason: `Selected from ${closeContenders.length} equally qualified candidates`,
      warning: randomSelected.warning,
    };
  }

  return {
    selected,
    candidates,
    reason: `Best match (score: ${(selected.totalScore * 100).toFixed(1)}%)`,
    warning: selected.warning,
  };
};

/**
 * Get formatted selection summary for logging/debugging
 */
export const formatSelectionSummary = (result: SelectionResult): string => {
  const lines: string[] = [];

  lines.push(`Selection Result: ${result.reason}`);
  lines.push('');

  if (result.selected) {
    const s = result.selected;
    lines.push(`✅ Selected: ${s.user.displayName}`);
    lines.push(`   Score: ${(s.totalScore * 100).toFixed(1)}%`);
    lines.push(`   - Weight: ${(s.scores.weight * 100).toFixed(0)}%`);
    lines.push(`   - Workload: ${(s.scores.workload * 100).toFixed(0)}%`);
    lines.push(`   - Expertise: ${(s.scores.expertise * 100).toFixed(0)}%`);
    lines.push(`   - Fairness: ${(s.scores.fairness * 100).toFixed(0)}%`);
    lines.push(`   Pending: ${s.pendingReviews}/${s.repoReviewer.maxConcurrent}`);
  } else {
    lines.push('❌ No reviewer selected');
  }

  lines.push('');
  lines.push('All Candidates:');

  for (const c of result.candidates.sort((a, b) => b.totalScore - a.totalScore)) {
    const status = c.disqualifyReason
      ? `❌ ${c.disqualifyReason}`
      : `${(c.totalScore * 100).toFixed(1)}%`;
    lines.push(`  ${c.user.displayName}: ${status}`);
  }

  return lines.join('\n');
};
