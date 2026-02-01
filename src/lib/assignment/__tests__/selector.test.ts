/**
 * Reviewer Selector Tests
 *
 * Tests for the scoring functions and selection logic with mocked database.
 */

// Mock the db module before imports
jest.mock('@/lib/db', () => ({
  db: {
    repository: {
      findUnique: jest.fn(),
    },
    repositoryReviewer: {
      findMany: jest.fn(),
    },
    assignment: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import {
  selectReviewer,
  formatSelectionSummary,
  type SelectionResult,
  type ReviewerCandidate,
  type SelectionCriteria,
} from '../selector';
import type { User, RepositoryReviewer } from '@/generated/prisma';

const mockedDb = db as jest.Mocked<typeof db>;

// Mock data factories
const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  slackId: 'U12345',
  githubUsername: 'testuser',
  email: 'test@example.com',
  displayName: 'Test User',
  avatarUrl: null,
  role: 'DEVELOPER',
  timezone: 'UTC',
  availabilityStatus: 'AVAILABLE',
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  notificationPrefs: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const createMockRepoReviewer = (overrides: Partial<RepositoryReviewer> = {}): RepositoryReviewer => ({
  id: 'repo-reviewer-1',
  userId: 'user-1',
  repositoryId: 'repo-1',
  weight: 1.0,
  maxConcurrent: 5,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockCandidate = (
  userOverrides: Partial<User> = {},
  repoReviewerOverrides: Partial<RepositoryReviewer> = {},
  scores: ReviewerCandidate['scores'] = {
    weight: 0.5,
    workload: 0.8,
    expertise: 0.6,
    fairness: 0.7,
    availability: 1.0,
  },
  pendingReviews = 2,
  disqualifyReason?: string
): ReviewerCandidate => ({
  user: createMockUser(userOverrides),
  repoReviewer: createMockRepoReviewer(repoReviewerOverrides),
  scores,
  totalScore: Object.values(scores).reduce((sum, s) => sum + s, 0) / 5,
  pendingReviews,
  disqualifyReason,
});

const createBaseCriteria = (overrides: Partial<SelectionCriteria> = {}): SelectionCriteria => ({
  authorId: 'author-1',
  repositoryId: 'repo-1',
  skillsRequired: [],
  complexity: 'MEDIUM',
  prNumber: 123,
  ...overrides,
});

describe('selectReviewer', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockedDb.repository.findUnique.mockResolvedValue({
      id: 'repo-1',
      fullName: 'owner/repo',
      requireSeniorComplex: false,
    });
    mockedDb.repositoryReviewer.findMany.mockResolvedValue([]);
    mockedDb.assignment.count.mockResolvedValue(0);
    mockedDb.assignment.groupBy.mockResolvedValue([]);
    mockedDb.assignment.findMany.mockResolvedValue([]);
  });

  describe('repository validation', () => {
    it('returns null when repository not found', async () => {
      mockedDb.repository.findUnique.mockResolvedValue(null);

      const result = await selectReviewer(createBaseCriteria());

      expect(result.selected).toBeNull();
      expect(result.reason).toBe('Repository not found');
    });

    it('queries correct repository', async () => {
      await selectReviewer(createBaseCriteria({ repositoryId: 'repo-123' }));

      expect(mockedDb.repository.findUnique).toHaveBeenCalledWith({
        where: { id: 'repo-123' },
      });
    });
  });

  describe('no eligible reviewers', () => {
    it('returns null when no reviewers are configured', async () => {
      mockedDb.repositoryReviewer.findMany.mockResolvedValue([]);

      const result = await selectReviewer(createBaseCriteria());

      expect(result.selected).toBeNull();
      expect(result.reason).toBe('No eligible reviewers found for this repository');
    });
  });

  describe('reviewer eligibility', () => {
    it('excludes author from eligible reviewers', async () => {
      await selectReviewer(createBaseCriteria({ authorId: 'author-123' }));

      expect(mockedDb.repositoryReviewer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: expect.objectContaining({
              id: { not: 'author-123' },
            }),
          }),
        })
      );
    });

    it('excludes deleted users', async () => {
      await selectReviewer(createBaseCriteria());

      expect(mockedDb.repositoryReviewer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: expect.objectContaining({
              deletedAt: null,
            }),
          }),
        })
      );
    });

    it('excludes unavailable users', async () => {
      await selectReviewer(createBaseCriteria());

      expect(mockedDb.repositoryReviewer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: expect.objectContaining({
              availabilityStatus: { not: 'UNAVAILABLE' },
            }),
          }),
        })
      );
    });

    it('only includes active repository reviewers', async () => {
      await selectReviewer(createBaseCriteria());

      expect(mockedDb.repositoryReviewer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
          }),
        })
      );
    });
  });

  describe('workload disqualification', () => {
    it('disqualifies overloaded reviewers by cognitive load', async () => {
      const overloadedReviewer = {
        ...createMockRepoReviewer({ maxConcurrent: 3 }),
        user: createMockUser({ id: 'overloaded-user' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([overloadedReviewer]);
      // Mock high cognitive load (2 complex PRs = 6.0 load, exceeds hard threshold of 5.0)
      mockedDb.assignment.findMany.mockResolvedValue([
        { complexity: 'COMPLEX' },
        { complexity: 'COMPLEX' },
      ]);

      const result = await selectReviewer(createBaseCriteria());

      expect(result.selected).toBeNull();
      expect(result.candidates[0].disqualifyReason).toContain('cognitive load');
    });

    it('disqualifies reviewers at max concurrent count', async () => {
      const overloadedReviewer = {
        ...createMockRepoReviewer({ maxConcurrent: 3 }),
        user: createMockUser({ id: 'overloaded-user' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([overloadedReviewer]);
      // Mock 3 trivial PRs (low cognitive load but at max count)
      mockedDb.assignment.findMany.mockResolvedValue([
        { complexity: 'TRIVIAL' },
        { complexity: 'TRIVIAL' },
        { complexity: 'TRIVIAL' },
      ]);

      const result = await selectReviewer(createBaseCriteria());

      expect(result.selected).toBeNull();
      expect(result.candidates[0].disqualifyReason).toContain('max capacity');
    });

    it('allows reviewers below max capacity with low cognitive load', async () => {
      const availableReviewer = {
        ...createMockRepoReviewer({ maxConcurrent: 5 }),
        user: createMockUser({ id: 'available-user', displayName: 'Available Dev' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([availableReviewer]);
      // Mock 2 small PRs (cognitive load = 1.0, well below threshold)
      mockedDb.assignment.findMany.mockResolvedValue([
        { complexity: 'SMALL' },
        { complexity: 'SMALL' },
      ]);

      const result = await selectReviewer(createBaseCriteria());

      expect(result.selected).not.toBeNull();
      expect(result.selected?.user.displayName).toBe('Available Dev');
    });
  });

  describe('senior requirement for complex PRs', () => {
    it('disqualifies junior reviewers for complex PRs when required', async () => {
      mockedDb.repository.findUnique.mockResolvedValue({
        id: 'repo-1',
        fullName: 'owner/repo',
        requireSeniorComplex: true,
      });

      const juniorReviewer = {
        ...createMockRepoReviewer({ weight: 0.5 }), // Junior weight
        user: createMockUser({ id: 'junior-user' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([juniorReviewer]);

      const result = await selectReviewer(createBaseCriteria({ complexity: 'COMPLEX' }));

      expect(result.selected).toBeNull();
      expect(result.candidates[0].disqualifyReason).toContain('Junior developer cannot review');
    });

    it('allows senior reviewers for complex PRs', async () => {
      mockedDb.repository.findUnique.mockResolvedValue({
        id: 'repo-1',
        fullName: 'owner/repo',
        requireSeniorComplex: true,
      });

      const seniorReviewer = {
        ...createMockRepoReviewer({ weight: 1.5 }), // Senior weight
        user: createMockUser({ id: 'senior-user', displayName: 'Senior Dev' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([seniorReviewer]);

      const result = await selectReviewer(createBaseCriteria({ complexity: 'LARGE' }));

      expect(result.selected).not.toBeNull();
      expect(result.selected?.user.displayName).toBe('Senior Dev');
    });

    it('allows junior reviewers when requireSeniorComplex is false', async () => {
      mockedDb.repository.findUnique.mockResolvedValue({
        id: 'repo-1',
        fullName: 'owner/repo',
        requireSeniorComplex: false,
      });

      const juniorReviewer = {
        ...createMockRepoReviewer({ weight: 0.5 }),
        user: createMockUser({ id: 'junior-user', displayName: 'Junior Dev' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([juniorReviewer]);

      const result = await selectReviewer(createBaseCriteria({ complexity: 'COMPLEX' }));

      expect(result.selected).not.toBeNull();
    });
  });

  describe('availability status disqualification', () => {
    it('disqualifies users on vacation', async () => {
      const vacationReviewer = {
        ...createMockRepoReviewer(),
        user: createMockUser({ id: 'vacation-user', availabilityStatus: 'VACATION' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([vacationReviewer]);

      const result = await selectReviewer(createBaseCriteria());

      expect(result.selected).toBeNull();
      expect(result.candidates[0].disqualifyReason).toContain('vacation');
    });

    it('disqualifies unavailable users', async () => {
      const unavailableReviewer = {
        ...createMockRepoReviewer(),
        user: createMockUser({ id: 'unavailable-user', availabilityStatus: 'UNAVAILABLE' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([unavailableReviewer]);

      const result = await selectReviewer(createBaseCriteria());

      expect(result.selected).toBeNull();
      expect(result.candidates[0].disqualifyReason).toContain('unavailable');
    });
  });

  describe('scoring and selection', () => {
    it('selects reviewer with highest score', async () => {
      const highScoreReviewer = {
        ...createMockRepoReviewer({ weight: 2.0, maxConcurrent: 10 }),
        user: createMockUser({ id: 'high-score', displayName: 'Top Developer' }),
      };
      const lowScoreReviewer = {
        ...createMockRepoReviewer({ weight: 0.5, maxConcurrent: 2 }),
        user: createMockUser({ id: 'low-score', displayName: 'Junior Developer' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([lowScoreReviewer, highScoreReviewer]);
      mockedDb.assignment.count.mockResolvedValue(0);

      const result = await selectReviewer(createBaseCriteria());

      expect(result.selected?.user.displayName).toBe('Top Developer');
    });

    it('includes all candidates in result', async () => {
      const reviewer1 = {
        ...createMockRepoReviewer({ userId: 'user-1' }),
        user: createMockUser({ id: 'user-1', displayName: 'Alice' }),
      };
      const reviewer2 = {
        ...createMockRepoReviewer({ userId: 'user-2' }),
        user: createMockUser({ id: 'user-2', displayName: 'Bob' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([reviewer1, reviewer2]);

      const result = await selectReviewer(createBaseCriteria());

      expect(result.candidates.length).toBe(2);
    });

    it('applies workload scoring correctly based on cognitive load', async () => {
      const busyReviewer = {
        ...createMockRepoReviewer({ userId: 'busy', maxConcurrent: 5 }),
        user: createMockUser({ id: 'busy', displayName: 'Busy Dev' }),
      };
      const freeReviewer = {
        ...createMockRepoReviewer({ userId: 'free', maxConcurrent: 5 }),
        user: createMockUser({ id: 'free', displayName: 'Free Dev' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([busyReviewer, freeReviewer]);
      // Mock cognitive load: busy has 3 large PRs (6.0 load), free has 0
      mockedDb.assignment.findMany
        .mockResolvedValueOnce([
          { complexity: 'LARGE' },
          { complexity: 'LARGE' },
          { complexity: 'MEDIUM' },
        ]) // Busy has high load
        .mockResolvedValueOnce([]); // Free has no pending

      const result = await selectReviewer(createBaseCriteria());

      // Free developer should be selected due to lower cognitive load
      expect(result.selected?.user.displayName).toBe('Free Dev');
    });
  });

  describe('fairness scoring', () => {
    it('considers recent assignment history', async () => {
      const frequentReviewer = {
        ...createMockRepoReviewer({ userId: 'frequent' }),
        user: createMockUser({ id: 'frequent', displayName: 'Frequent' }),
      };
      const rareReviewer = {
        ...createMockRepoReviewer({ userId: 'rare' }),
        user: createMockUser({ id: 'rare', displayName: 'Rare' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([frequentReviewer, rareReviewer]);
      mockedDb.assignment.groupBy.mockResolvedValue([
        { reviewerId: 'frequent', _count: { id: 10 } },
        { reviewerId: 'rare', _count: { id: 1 } },
      ]);

      const result = await selectReviewer(createBaseCriteria());

      // Rare reviewer should be preferred for fairness
      const rareCandidate = result.candidates.find(c => c.user.displayName === 'Rare');
      const frequentCandidate = result.candidates.find(c => c.user.displayName === 'Frequent');

      expect(rareCandidate?.scores.fairness).toBeGreaterThan(frequentCandidate?.scores.fairness ?? 0);
    });
  });

  describe('all disqualified case', () => {
    it('returns descriptive reason when all reviewers are disqualified', async () => {
      const overloadedReviewer = {
        ...createMockRepoReviewer({ maxConcurrent: 2 }),
        user: createMockUser({ id: 'overloaded', displayName: 'Overloaded Dev' }),
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([overloadedReviewer]);
      // Mock high cognitive load that exceeds hard threshold
      mockedDb.assignment.findMany.mockResolvedValue([
        { complexity: 'COMPLEX' },
        { complexity: 'COMPLEX' },
      ]); // 6.0 cognitive load, exceeds hard threshold

      const result = await selectReviewer(createBaseCriteria());

      expect(result.selected).toBeNull();
      expect(result.reason).toContain('All reviewers disqualified');
    });
  });

  describe('expertise scoring', () => {
    it('scores higher for reviewers with matching skills', async () => {
      const skilledReviewer = {
        ...createMockRepoReviewer({ userId: 'skilled' }),
        user: {
          ...createMockUser({ id: 'skilled', displayName: 'Skilled Dev' }),
          skills: [
            { skill: { name: 'TypeScript' }, proficiency: 5 },
            { skill: { name: 'React' }, proficiency: 4 },
          ],
        },
      };
      const unskilledReviewer = {
        ...createMockRepoReviewer({ userId: 'unskilled' }),
        user: {
          ...createMockUser({ id: 'unskilled', displayName: 'Unskilled Dev' }),
          skills: [],
        },
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([unskilledReviewer, skilledReviewer]);

      const result = await selectReviewer(
        createBaseCriteria({ skillsRequired: ['TypeScript', 'React'] })
      );

      const skilledCandidate = result.candidates.find(c => c.user.displayName === 'Skilled Dev');
      const unskilledCandidate = result.candidates.find(c => c.user.displayName === 'Unskilled Dev');

      expect(skilledCandidate?.scores.expertise).toBeGreaterThan(
        unskilledCandidate?.scores.expertise ?? 0
      );
    });

    it('uses neutral score when no skills required', async () => {
      const reviewer = {
        ...createMockRepoReviewer(),
        user: {
          ...createMockUser({ displayName: 'Dev' }),
          skills: [{ skill: { name: 'Python' }, proficiency: 5 }],
        },
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([reviewer]);

      const result = await selectReviewer(createBaseCriteria({ skillsRequired: [] }));

      // Neutral score of 0.5 when no skills required
      expect(result.candidates[0].scores.expertise).toBe(0.5);
    });

    it('gives low score when no skills match', async () => {
      const reviewer = {
        ...createMockRepoReviewer(),
        user: {
          ...createMockUser({ displayName: 'Dev' }),
          skills: [{ skill: { name: 'Python' }, proficiency: 5 }],
        },
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([reviewer]);

      const result = await selectReviewer(
        createBaseCriteria({ skillsRequired: ['TypeScript', 'Rust'] })
      );

      // Low score (0.1) when skills don't match
      expect(result.candidates[0].scores.expertise).toBe(0.1);
    });

    it('calculates partial match scores', async () => {
      const reviewer = {
        ...createMockRepoReviewer(),
        user: {
          ...createMockUser({ displayName: 'Dev' }),
          skills: [
            { skill: { name: 'TypeScript' }, proficiency: 4 },
            { skill: { name: 'Go' }, proficiency: 3 },
          ],
        },
      };

      mockedDb.repositoryReviewer.findMany.mockResolvedValue([reviewer]);

      const result = await selectReviewer(
        createBaseCriteria({ skillsRequired: ['TypeScript', 'React', 'Node.js'] })
      );

      // Has 1 out of 3 skills, so should be between 0.1 and 0.9
      const expertiseScore = result.candidates[0].scores.expertise;
      expect(expertiseScore).toBeGreaterThan(0.1);
      expect(expertiseScore).toBeLessThan(0.9);
    });
  });
});

describe('formatSelectionSummary', () => {
  it('formats successful selection', () => {
    const result: SelectionResult = {
      selected: createMockCandidate(
        { displayName: 'John Doe' },
        { weight: 1.5, maxConcurrent: 5 },
        { weight: 0.75, workload: 0.6, expertise: 0.8, fairness: 0.9, availability: 1.0 },
        2
      ),
      candidates: [],
      reason: 'Best match (score: 81.0%)',
    };

    const summary = formatSelectionSummary(result);

    expect(summary).toContain('Selection Result:');
    expect(summary).toContain('John Doe');
    expect(summary).toContain('✅ Selected:');
  });

  it('formats no selection result', () => {
    const result: SelectionResult = {
      selected: null,
      candidates: [],
      reason: 'No eligible reviewers found',
    };

    const summary = formatSelectionSummary(result);

    expect(summary).toContain('Selection Result:');
    expect(summary).toContain('❌ No reviewer selected');
    expect(summary).toContain('No eligible reviewers found');
  });

  it('includes all candidates in summary', () => {
    const result: SelectionResult = {
      selected: createMockCandidate({ id: 'user-1', displayName: 'Alice' }),
      candidates: [
        createMockCandidate({ id: 'user-1', displayName: 'Alice' }),
        createMockCandidate({ id: 'user-2', displayName: 'Bob' }),
        createMockCandidate(
          { id: 'user-3', displayName: 'Charlie' },
          {},
          { weight: 0, workload: 0, expertise: 0, fairness: 0, availability: 0 },
          10,
          'Overloaded'
        ),
      ],
      reason: 'Best match',
    };

    const summary = formatSelectionSummary(result);

    expect(summary).toContain('Alice');
    expect(summary).toContain('Bob');
    expect(summary).toContain('Charlie');
    expect(summary).toContain('All Candidates');
  });

  it('shows disqualify reasons', () => {
    const result: SelectionResult = {
      selected: null,
      candidates: [
        createMockCandidate(
          { displayName: 'Overloaded User' },
          {},
          { weight: 0, workload: 0, expertise: 0, fairness: 0, availability: 0 },
          10,
          'Overloaded (10/5 reviews)'
        ),
      ],
      reason: 'All reviewers disqualified',
    };

    const summary = formatSelectionSummary(result);

    expect(summary).toContain('Overloaded (10/5 reviews)');
  });

  it('shows score breakdown for selected reviewer', () => {
    const result: SelectionResult = {
      selected: createMockCandidate(
        { displayName: 'Selected Dev' },
        {},
        { weight: 0.5, workload: 0.8, expertise: 0.7, fairness: 0.9, availability: 1.0 },
        1
      ),
      candidates: [],
      reason: 'Best match',
    };

    const summary = formatSelectionSummary(result);

    expect(summary).toContain('Weight:');
    expect(summary).toContain('Workload:');
    expect(summary).toContain('Expertise:');
    expect(summary).toContain('Fairness:');
    expect(summary).toContain('Pending:');
  });
});

describe('scoring weights documentation', () => {
  /**
   * Score weights should be:
   * - workload: 0.30 (highest - prevents overload)
   * - weight: 0.25 (developer seniority)
   * - expertise: 0.25 (skill match)
   * - fairness: 0.15 (distribution balance)
   * - availability: 0.05 (tie-breaker)
   */

  it('documents expected score weight distribution', () => {
    const SCORE_WEIGHTS = {
      weight: 0.25,
      workload: 0.30,
      expertise: 0.25,
      fairness: 0.15,
      availability: 0.05,
    };

    // Weights should sum to 1.0
    const totalWeight = Object.values(SCORE_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(totalWeight).toBe(1.0);

    // Workload should be highest priority
    expect(SCORE_WEIGHTS.workload).toBeGreaterThan(SCORE_WEIGHTS.weight);
    expect(SCORE_WEIGHTS.workload).toBeGreaterThan(SCORE_WEIGHTS.expertise);
    expect(SCORE_WEIGHTS.workload).toBeGreaterThan(SCORE_WEIGHTS.fairness);
    expect(SCORE_WEIGHTS.workload).toBeGreaterThan(SCORE_WEIGHTS.availability);

    // Availability should be lowest (tie-breaker)
    expect(SCORE_WEIGHTS.availability).toBeLessThan(SCORE_WEIGHTS.weight);
    expect(SCORE_WEIGHTS.availability).toBeLessThan(SCORE_WEIGHTS.expertise);
    expect(SCORE_WEIGHTS.availability).toBeLessThan(SCORE_WEIGHTS.fairness);
  });
});

describe('developer weight levels', () => {
  it('documents weight levels', () => {
    const WEIGHT_LEVELS = {
      junior: 0.5,
      mid: 1.0,
      senior: 1.5,
      lead: 2.0,
    };

    expect(WEIGHT_LEVELS.junior).toBeLessThan(WEIGHT_LEVELS.mid);
    expect(WEIGHT_LEVELS.mid).toBeLessThan(WEIGHT_LEVELS.senior);
    expect(WEIGHT_LEVELS.senior).toBeLessThan(WEIGHT_LEVELS.lead);
  });

  it('documents senior threshold for complex PRs', () => {
    const SENIOR_WEIGHT_THRESHOLD = 1.2;

    expect(SENIOR_WEIGHT_THRESHOLD).toBeGreaterThan(1.0);
    expect(SENIOR_WEIGHT_THRESHOLD).toBeLessThan(1.5);
  });
});

describe('complexity levels', () => {
  it('documents complexity requiring senior review', () => {
    const COMPLEXITY_REQUIRES_SENIOR = ['LARGE', 'COMPLEX'];

    expect(COMPLEXITY_REQUIRES_SENIOR).toContain('LARGE');
    expect(COMPLEXITY_REQUIRES_SENIOR).toContain('COMPLEX');
    expect(COMPLEXITY_REQUIRES_SENIOR).not.toContain('TRIVIAL');
    expect(COMPLEXITY_REQUIRES_SENIOR).not.toContain('SMALL');
    expect(COMPLEXITY_REQUIRES_SENIOR).not.toContain('MEDIUM');
  });
});

describe('cognitive load status levels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.repository.findUnique.mockResolvedValue({
      id: 'repo-1',
      fullName: 'owner/repo',
      requireSeniorComplex: false,
    });
    mockedDb.assignment.groupBy.mockResolvedValue([]);
  });

  it('returns elevated status when cognitive load is above optimal but below soft threshold', async () => {
    // cognitive load between optimal (2.5) and soft (4.0)
    // 1 large PR + 1 small PR = 2.0 + 0.5 = 2.5, which equals optimal exactly
    // We need slightly above, so 1 large + 1 medium = 2.0 + 1.0 = 3.0
    const reviewer = {
      ...createMockRepoReviewer({ maxConcurrent: 10 }),
      user: createMockUser({ id: 'elevated-user', displayName: 'Elevated User' }),
    };

    mockedDb.repositoryReviewer.findMany.mockResolvedValue([reviewer]);
    // 1 large (2.0) + 1 medium (1.0) = 3.0 cognitive load - between optimal (2.5) and soft (4.0)
    mockedDb.assignment.findMany.mockResolvedValue([
      { complexity: 'LARGE' },
      { complexity: 'MEDIUM' },
    ]);

    const result = await selectReviewer(createBaseCriteria());

    // Should be selected (not disqualified) with reduced workload score
    expect(result.selected).not.toBeNull();
    expect(result.selected?.scores.workload).toBeLessThan(1.0);
    expect(result.selected?.scores.workload).toBeGreaterThanOrEqual(0.5);
  });

  it('returns high status when cognitive load is at soft threshold', async () => {
    // cognitive load between soft (4.0) and hard (5.0)
    // 2 large PRs = 4.0 cognitive load - exactly at soft threshold
    const reviewer = {
      ...createMockRepoReviewer({ maxConcurrent: 10 }),
      user: createMockUser({ id: 'high-load-user', displayName: 'High Load User' }),
    };

    mockedDb.repositoryReviewer.findMany.mockResolvedValue([reviewer]);
    // 2 large PRs = 4.0 cognitive load - at soft threshold
    mockedDb.assignment.findMany.mockResolvedValue([
      { complexity: 'LARGE' },
      { complexity: 'LARGE' },
    ]);

    const result = await selectReviewer(createBaseCriteria());

    // Should be selected but with lower workload score (between 0 and 0.5)
    expect(result.selected).not.toBeNull();
    expect(result.selected?.scores.workload).toBeLessThanOrEqual(0.5);
    expect(result.selected?.scores.workload).toBeGreaterThan(0);
  });

  it('returns overloaded status when cognitive load exceeds hard threshold', async () => {
    // cognitive load >= hard threshold (5.0) should disqualify
    const reviewer = {
      ...createMockRepoReviewer({ maxConcurrent: 10 }),
      user: createMockUser({ id: 'overloaded-user' }),
    };

    mockedDb.repositoryReviewer.findMany.mockResolvedValue([reviewer]);
    // 3 large PRs = 6.0 cognitive load - exceeds hard threshold
    mockedDb.assignment.findMany.mockResolvedValue([
      { complexity: 'LARGE' },
      { complexity: 'LARGE' },
      { complexity: 'LARGE' },
    ]);

    const result = await selectReviewer(createBaseCriteria());

    // Should be disqualified due to cognitive load
    expect(result.selected).toBeNull();
    expect(result.candidates[0].disqualifyReason).toContain('cognitive load');
  });
});

describe('working hours scoring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.repository.findUnique.mockResolvedValue({
      id: 'repo-1',
      fullName: 'owner/repo',
      requireSeniorComplex: false,
    });
    mockedDb.assignment.groupBy.mockResolvedValue([]);
    mockedDb.assignment.findMany.mockResolvedValue([]);
  });

  it('scores busy users lower than available users', async () => {
    const busyReviewer = {
      ...createMockRepoReviewer({ userId: 'busy' }),
      user: createMockUser({ id: 'busy', displayName: 'Busy Dev', availabilityStatus: 'BUSY' }),
    };
    const availableReviewer = {
      ...createMockRepoReviewer({ userId: 'available' }),
      user: createMockUser({ id: 'available', displayName: 'Available Dev', availabilityStatus: 'AVAILABLE' }),
    };

    mockedDb.repositoryReviewer.findMany.mockResolvedValue([busyReviewer, availableReviewer]);

    const result = await selectReviewer(createBaseCriteria());

    const busyCandidate = result.candidates.find(c => c.user.displayName === 'Busy Dev');
    const availableCandidate = result.candidates.find(c => c.user.displayName === 'Available Dev');

    // Available should have higher availability score
    expect(availableCandidate?.scores.availability).toBeGreaterThan(busyCandidate?.scores.availability ?? 0);
  });
});
