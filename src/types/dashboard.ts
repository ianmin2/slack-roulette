// =============================================================================
// DASHBOARD FRONTEND TYPES
// =============================================================================

/**
 * Assignment status values matching the Prisma AssignmentStatus enum.
 * Used for status badges and filtering throughout the dashboard.
 */
export type AssignmentStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'EXPIRED';

/**
 * Problem severity values matching the Prisma ProblemSeverity enum.
 */
export type ProblemSeverity = 'WARNING' | 'PROBLEM' | 'CRITICAL';

// =============================================================================
// API RESPONSE SHAPES
// =============================================================================

/** GET /api/dashboard/stats */
export interface DashboardStats {
  totalReviews: number;
  activeReviewers: number;
  avgResponseTimeMinutes: number;
  pendingAssignments: number;
  activeProblems: number;
}

/** Individual assignment in the live feed */
export interface DashboardAssignment {
  id: string;
  prTitle: string;
  prNumber: number;
  prUrl: string;
  repositoryFullName: string;
  author: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
  reviewer: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  status: AssignmentStatus;
  complexity: string;
  createdAt: string;
  assignedAt: string | null;
}

/** GET /api/dashboard/assignments */
export interface DashboardAssignmentsResponse {
  assignments: DashboardAssignment[];
  total: number;
}

/** SSE event from /api/dashboard/events */
export interface DashboardEvent {
  type: 'assignment_created' | 'assignment_updated' | 'problem_detected' | 'stats_updated';
  data: DashboardAssignment | DashboardStats | DashboardProblem;
  timestamp: string;
}

// =============================================================================
// LEADERBOARD
// =============================================================================

/** Individual entry in the leaderboard table */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  reviewsCompleted: number;
  avgResponseTimeMinutes: number | null;
  points: number;
}

/** GET /api/dashboard/leaderboard?period=week|month */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  period: 'week' | 'month';
}

// =============================================================================
// PROBLEMS
// =============================================================================

/** Individual problem entry */
export interface DashboardProblem {
  id: string;
  severity: ProblemSeverity;
  ruleName: string;
  ruleDescription: string | null;
  assignment: {
    id: string;
    prTitle: string;
    prNumber: number;
    prUrl: string;
    repositoryFullName: string;
    reviewer: {
      id: string;
      displayName: string;
      avatarUrl: string | null;
    } | null;
  };
  triggeredAt: string;
  resolvedAt: string | null;
}

/** GET /api/dashboard/problems */
export interface ProblemsResponse {
  problems: DashboardProblem[];
  total: number;
}

// =============================================================================
// AUTH
// =============================================================================

/** GET /api/auth/me */
export interface DashboardUser {
  id: string;
  slackId: string;
  displayName: string;
  role: string;
  avatarUrl: string | null;
}

// =============================================================================
// COMPONENT PROPS
// =============================================================================

export interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}
