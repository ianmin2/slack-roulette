// Slack-related types

export interface SlackUser {
  id: string;
  name: string;
  realName?: string;
  email?: string;
  avatar?: string;
  isBot?: boolean;
  deleted?: boolean;
}

export interface Pairing {
  id: string;
  user1: SlackUser;
  user2: SlackUser;
  channelId: string;
  createdAt: Date;
  meetingScheduled?: Date;
  status: PairingStatus;
}

export type PairingStatus = 'pending' | 'accepted' | 'completed' | 'declined';

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  memberCount?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

// =============================================================================
// WEEKLY DIGEST TYPES
// =============================================================================

export interface WeeklyDigest {
  period: {
    start: Date;
    end: Date;
    weekNumber: number;
    year: number;
  };
  summary: DigestSummary;
  topReviewers: DigestLeaderboardEntry[];
  speedChampions: DigestSpeedChampion[];
  activeChallenges: DigestActiveChallenge[];
  recentAchievements: DigestAchievement[];
  repositoryStats: DigestRepositoryStats[];
  trends: DigestTrends;
}

export interface DigestSpeedChampion {
  userId: string;
  displayName: string;
  slackId: string;
  avgResponseTimeMinutes: number;
  reviewsCompleted: number;
  rank: number;
}

export interface DigestActiveChallenge {
  id: string;
  name: string;
  displayName: string;
  type: string;
  scope: string;
  target: number;
  currentProgress: number;
  percentComplete: number;
  participantCount: number;
  topContributor: {
    displayName: string;
    slackId: string;
    progress: number;
  } | null;
  endsAt: Date;
}

export interface DigestSummary {
  totalReviews: number;
  totalAssignments: number;
  avgResponseTimeMinutes: number;
  completionRate: number; // 0-1
  activeReviewers: number;
  newAchievementsUnlocked: number;
}

export interface DigestLeaderboardEntry {
  userId: string;
  displayName: string;
  slackId: string;
  reviewsCompleted: number;
  avgResponseTimeMinutes: number | null;
  pointsEarned: number;
  rank: number;
  rankChange: number; // positive = moved up, negative = moved down
}

export interface DigestAchievement {
  userId: string;
  displayName: string;
  slackId: string;
  achievementName: string;
  achievementDisplayName: string;
  achievementIcon: string;
  earnedAt: Date;
}

export interface DigestRepositoryStats {
  repositoryId: string;
  fullName: string;
  reviewsCompleted: number;
  avgResponseTimeMinutes: number | null;
  topReviewer: {
    displayName: string;
    reviewCount: number;
  } | null;
}

export interface DigestTrends {
  reviewsVsLastWeek: number; // percentage change
  responseTimeVsLastWeek: number; // percentage change (negative = faster)
  activeReviewersVsLastWeek: number; // percentage change
}

export type DigestFrequency = 'weekly' | 'daily';

export interface DigestConfig {
  channelId: string;
  frequency: DigestFrequency;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  hourUtc: number; // 0-23
  enabled: boolean;
  includeLeaderboard: boolean;
  includeAchievements: boolean;
  includeRepoStats: boolean;
  includeTrends: boolean;
}

// =============================================================================
// ADMIN INTERFACE TYPES
// =============================================================================

export interface AdminDashboardData {
  overview: AdminOverview;
  repositories: AdminRepositoryData[];
  users: AdminUserData[];
  recentActivity: AdminActivityEntry[];
}

export interface AdminOverview {
  totalUsers: number;
  activeUsers: number;
  totalRepositories: number;
  activeRepositories: number;
  totalAssignments: number;
  pendingAssignments: number;
  completedAssignments: number;
  avgCompletionRate: number;
}

export interface AdminRepositoryData {
  id: string;
  fullName: string;
  isActive: boolean;
  reviewerCount: number;
  pendingReviews: number;
  completedReviews: number;
  avgResponseTimeMinutes: number | null;
  requireSeniorComplex: boolean;
  createdAt: Date;
}

export interface AdminUserData {
  id: string;
  slackId: string;
  displayName: string;
  githubUsername: string | null;
  email: string | null;
  role: string;
  availabilityStatus: string;
  repositoryCount: number;
  pendingReviews: number;
  completedReviews: number;
  totalPoints: number;
  achievementCount: number;
  createdAt: Date;
}

export interface AdminActivityEntry {
  id: string;
  type: AdminActivityType;
  description: string;
  userId: string | null;
  userDisplayName: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export type AdminActivityType =
  | 'assignment_created'
  | 'assignment_completed'
  | 'user_added'
  | 'user_updated'
  | 'repository_added'
  | 'repository_updated'
  | 'achievement_unlocked'
  | 'config_changed';

export interface AdminUserUpdate {
  displayName?: string;
  role?: string;
  availabilityStatus?: string;
  githubUsername?: string;
}

export interface AdminRepositoryUpdate {
  isActive?: boolean;
  requireSeniorComplex?: boolean;
  defaultReviewerWeight?: number;
  maxConcurrentDefault?: number;
}

export interface AdminReviewerUpdate {
  weight?: number;
  maxConcurrent?: number;
  isActive?: boolean;
}

// =============================================================================
// ADVANCED ANALYTICS TYPES
// =============================================================================

export interface AnalyticsDashboard {
  dateRange: {
    start: Date;
    end: Date;
  };
  reviewMetrics: ReviewMetrics;
  responseTimeAnalytics: ResponseTimeAnalytics;
  workloadDistribution: WorkloadDistribution;
  skillsAnalytics: SkillsAnalytics;
  trendData: TrendDataPoint[];
}

export interface ReviewMetrics {
  total: number;
  completed: number;
  pending: number;
  declined: number;
  reassigned: number;
  completionRate: number;
  avgTimeToCompletion: number; // minutes
}

export interface ResponseTimeAnalytics {
  avgMinutes: number;
  medianMinutes: number;
  p90Minutes: number;
  p99Minutes: number;
  fastestMinutes: number;
  slowestMinutes: number;
  distribution: ResponseTimeDistribution[];
}

export interface ResponseTimeDistribution {
  bucket: string; // e.g., "< 30 min", "30-60 min", "1-2 hours"
  count: number;
  percentage: number;
}

export interface WorkloadDistribution {
  byUser: UserWorkload[];
  byRepository: RepositoryWorkload[];
  giniCoefficient: number; // 0 = perfect equality, 1 = perfect inequality
  topHeavyRatio: number; // what % of work is done by top 20% of reviewers
}

export interface UserWorkload {
  userId: string;
  displayName: string;
  assigned: number;
  completed: number;
  pending: number;
  avgResponseTime: number | null;
  utilizationRate: number; // pending / maxConcurrent
}

export interface RepositoryWorkload {
  repositoryId: string;
  fullName: string;
  assigned: number;
  completed: number;
  pending: number;
  reviewerCount: number;
  avgResponseTime: number | null;
}

export interface SkillsAnalytics {
  topSkills: SkillDemand[];
  skillGaps: SkillGap[];
  skillCoverage: number; // percentage of requested skills that have reviewers
}

export interface SkillDemand {
  skillName: string;
  requestCount: number;
  reviewerCount: number;
  demandRatio: number; // requests / reviewers
}

export interface SkillGap {
  skillName: string;
  requestCount: number;
  reviewerCount: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface TrendDataPoint {
  date: Date;
  reviews: number;
  avgResponseTime: number;
  activeReviewers: number;
  completionRate: number;
}

export type AnalyticsPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface AnalyticsQuery {
  period: AnalyticsPeriod;
  startDate?: Date;
  endDate?: Date;
  repositoryId?: string;
  userId?: string;
}

// =============================================================================
// BOTTLENECK DETECTION TYPES
// =============================================================================

export interface BottleneckReport {
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  slowResponders: SlowResponderBottleneck[];
  overloadedRepos: OverloadedRepoBottleneck[];
  overloadedUsers: OverloadedUserBottleneck[];
  skillGapBottlenecks: SkillGapBottleneck[];
  summary: BottleneckSummary;
}

export interface SlowResponderBottleneck {
  userId: string;
  displayName: string;
  slackId: string;
  avgResponseTimeMinutes: number;
  teamAvgResponseTimeMinutes: number;
  responseTimeRatio: number; // user avg / team avg
  reviewsCompleted: number;
  severity: BottleneckSeverity;
  recommendation: string;
}

export interface OverloadedRepoBottleneck {
  repositoryId: string;
  fullName: string;
  pendingReviews: number;
  avgResponseTimeMinutes: number | null;
  reviewerCount: number;
  reviewsPerReviewer: number;
  severity: BottleneckSeverity;
  recommendation: string;
}

export interface OverloadedUserBottleneck {
  userId: string;
  displayName: string;
  slackId: string;
  pendingReviews: number;
  maxConcurrent: number;
  utilizationRate: number;
  avgResponseTimeMinutes: number | null;
  severity: BottleneckSeverity;
  recommendation: string;
}

export interface SkillGapBottleneck {
  skillName: string;
  requestCount: number;
  reviewerCount: number;
  pendingWithSkill: number;
  severity: BottleneckSeverity;
  recommendation: string;
}

export type BottleneckSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface BottleneckSummary {
  totalBottlenecks: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  topRecommendations: string[];
}

// =============================================================================
// INDIVIDUAL GROWTH TRACKING TYPES
// =============================================================================

export interface UserGrowthReport {
  userId: string;
  displayName: string;
  slackId: string;
  period: {
    start: Date;
    end: Date;
  };
  metrics: GrowthMetrics;
  trends: GrowthTrends;
  milestones: GrowthMilestone[];
  recommendations: string[];
}

export interface GrowthMetrics {
  // Current period
  reviewsCompleted: number;
  avgResponseTimeMinutes: number | null;
  pointsEarned: number;
  streakDays: number;
  achievementsUnlocked: number;

  // All-time
  totalReviews: number;
  totalPoints: number;
  totalAchievements: number;
  memberSince: Date;
}

export interface GrowthTrends {
  // Week over week
  reviewsWoW: TrendValue;
  responseTimeWoW: TrendValue;
  pointsWoW: TrendValue;

  // Month over month
  reviewsMoM: TrendValue;
  responseTimeMoM: TrendValue;
  pointsMoM: TrendValue;

  // Historical sparkline data (last 8 weeks)
  weeklyReviews: number[];
  weeklyResponseTime: number[];
  weeklyPoints: number[];
}

export interface TrendValue {
  current: number;
  previous: number;
  change: number; // percentage
  direction: 'up' | 'down' | 'stable';
  isPositive: boolean; // Is this change good?
}

export interface GrowthMilestone {
  type: MilestoneType;
  description: string;
  achievedAt: Date;
  value?: number;
}

export type MilestoneType =
  | 'first_review'
  | 'reviews_10'
  | 'reviews_50'
  | 'reviews_100'
  | 'reviews_500'
  | 'first_achievement'
  | 'speed_improvement'
  | 'streak_week'
  | 'streak_month'
  | 'top_reviewer'
  | 'level_up';

// =============================================================================
// CHALLENGES / WEEKLY GOALS TYPES
// =============================================================================

export interface Challenge {
  id: string;
  name: string;
  description: string;
  type: ChallengeType;
  target: number;
  reward: ChallengeReward;
  startDate: Date;
  endDate: Date;
  scope: ChallengeScope;
  repositoryId: string | null; // null = global
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
}

export type ChallengeType =
  | 'reviews_completed'      // Complete N reviews
  | 'fast_reviews'           // Complete N reviews in under X minutes
  | 'streak_days'            // Maintain a streak for N days
  | 'points_earned'          // Earn N points
  | 'team_reviews'           // Team completes N reviews collectively
  | 'response_time_avg'      // Keep average response time under X minutes
  | 'zero_pending';          // End the week with zero pending reviews

export type ChallengeScope = 'individual' | 'team' | 'repository';

export interface ChallengeReward {
  type: RewardType;
  value: number;
  description: string;
}

export type RewardType =
  | 'points'           // Bonus points
  | 'badge'            // Special badge
  | 'achievement';     // Unlocks an achievement

export interface ChallengeProgress {
  challengeId: string;
  challenge: Challenge;
  userId: string | null; // null for team challenges
  currentValue: number;
  targetValue: number;
  percentComplete: number;
  isCompleted: boolean;
  completedAt: Date | null;
  lastUpdated: Date;
}

export interface UserChallengeStatus {
  active: ChallengeProgress[];
  completed: ChallengeProgress[];
  available: Challenge[];
}

export interface TeamChallengeStatus {
  challenge: Challenge;
  participants: ChallengeParticipant[];
  totalProgress: number;
  isCompleted: boolean;
}

export interface ChallengeParticipant {
  userId: string;
  displayName: string;
  contribution: number;
  percentOfTotal: number;
}

export interface ChallengeCreateInput {
  name: string;
  description: string;
  type: ChallengeType;
  target: number;
  reward: ChallengeReward;
  startDate: Date;
  endDate: Date;
  scope: ChallengeScope;
  repositoryId?: string;
}

export interface WeeklyGoal {
  id: string;
  userId: string;
  weekStart: Date;
  targetReviews: number;
  targetPoints: number;
  targetAvgResponseMinutes: number | null;
  currentReviews: number;
  currentPoints: number;
  currentAvgResponseMinutes: number | null;
  isAchieved: boolean;
  createdAt: Date;
}

export interface WeeklyGoalInput {
  targetReviews?: number;
  targetPoints?: number;
  targetAvgResponseMinutes?: number;
}
