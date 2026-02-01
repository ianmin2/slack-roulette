# PR Roulette - Implementation Checklists

**Generated**: 2026-02-01
**Based on**: pr-roulette-spec.md

---

## Phase 1: Core Foundation

> Goal: Get the basic plumbing working - Slack listens, GitHub responds, data persists.

### 1.1 Database Setup (Prisma)

- [ ] Initialize Prisma with PostgreSQL
- [ ] Design and create schema:
  - [ ] `User` model (slack_id, github_username, email, display_name, role)
  - [ ] `Repository` model (name, url, owner, language, settings JSON)
  - [ ] `RepositoryReviewer` model (user ↔ repo link, weight, max_concurrent)
  - [ ] `Assignment` model (pr_url, pr_number, repo, author, assignee, status, timestamps)
  - [ ] `Skill` model (name) + `UserSkill` junction
- [ ] Run initial migration
- [ ] Create db client singleton (`src/lib/db/index.ts`)
- [ ] Seed script for testing

### 1.2 Slack Integration - Events

- [x] `/api/slack/events` endpoint with signature verification
- [ ] Handle `message` events - detect GitHub PR URLs
- [ ] Parse PR URL → extract owner, repo, PR number
- [ ] Store raw PR detection in DB (for audit trail)
- [ ] Post acknowledgment message to channel ("PR detected, assigning reviewer...")

### 1.3 Slack Integration - Slash Commands

- [ ] Register `/pr-roulette` command in Slack app
- [ ] `/api/slack/commands` endpoint
- [ ] Command router/parser
- [ ] Implement basic commands:
  - [ ] `/pr-roulette help` - list available commands
  - [ ] `/pr-roulette stats` - personal statistics (basic)
  - [ ] `/pr-roulette assign [pr-url] @user` - manual assignment

### 1.4 GitHub Integration - Basic

- [ ] Install `@octokit/rest` or similar
- [ ] GitHub API client (`src/lib/github/client.ts`)
- [ ] Fetch PR details (title, author, files changed, lines changed)
- [ ] Fetch PR diff stats
- [ ] Map GitHub username ↔ Slack user (via email or manual link)

### 1.5 Manual Reviewer Assignment

- [ ] `/pr-roulette assign` command handler
- [ ] Create Assignment record in DB
- [ ] Add reviewer to GitHub PR via API
- [ ] Post Slack notification to assigned reviewer (DM or channel mention)
- [ ] Update Assignment status on completion

### 1.6 Basic Statistics Tracking

- [ ] Track assignments per user
- [ ] Track response times (first review activity)
- [ ] Basic `/pr-roulette stats` output:
  - Total reviews assigned
  - Total reviews completed
  - Average response time
- [ ] Store weekly snapshots for historical tracking

---

## Phase 2: Intelligence Layer

> Goal: Make the system smart - analyze PRs, auto-select reviewers, basic gamification.

### 2.1 PR Analysis Engine

- [ ] Categorize PR size (Trivial/Small/Medium/Large/Complex)
- [ ] Calculate effort score using spec formula:
  ```
  effortScore = (
    linesChanged * 0.1 +
    filesModified * 2 +
    testCoverage * -1 +
    cyclomaticComplexity * 5 +
    dependencyChanges * 10 +
    languageMultiplier
  )
  ```
- [ ] Detect file types changed (frontend, backend, tests, config, docs)
- [ ] Identify skills required based on file extensions/paths
- [ ] Store analysis results with Assignment

### 2.2 Smart Reviewer Selection

- [ ] Build reviewer eligibility filter:
  - [ ] Exclude PR author
  - [ ] Exclude unavailable users
  - [ ] Exclude overloaded users (pending > max_concurrent)
- [ ] Weighted selection algorithm:
  - [ ] Developer weight (junior 0.5x → senior 2.0x)
  - [ ] Current workload factor
  - [ ] Expertise match score
  - [ ] Recent assignment distribution (fairness)
- [ ] Return ranked list of candidates
- [ ] Auto-select top candidate (or top N for multi-reviewer)

### 2.3 GitHub Auto-Assignment

- [ ] Automatically add reviewer to PR when detected
- [ ] Apply labels based on complexity/effort
- [ ] Post comment on PR with assignment details
- [ ] Handle assignment failures gracefully

### 2.4 Enhanced Slack Notifications

- [ ] Rich message blocks for assignment notification:
  - PR title, author, repo
  - Effort estimate, complexity badge
  - Files changed summary
  - Quick action buttons (if using interactivity)
- [ ] Notification to channel when PR assigned
- [ ] DM to assigned reviewer

### 2.5 Basic Gamification

- [ ] Points system:
  - Points per review completed
  - Bonus for fast response (<1h, <2h)
  - Bonus for thorough review (comments > N)
- [ ] Simple leaderboard:
  - [ ] `/pr-roulette leaderboard` - top 10 this week
  - [ ] `/pr-roulette leaderboard month` - top 10 this month
- [ ] Track streaks (consecutive review days)

### 2.6 Repository Configuration

- [ ] `/pr-roulette add-repo [url]` - register repository
- [ ] `/pr-roulette config [repo]` - view/edit settings
- [ ] Configurable per repo:
  - [ ] Auto-assignment on/off
  - [ ] Min/max reviewers
  - [ ] Branch filters
  - [ ] Excluded file patterns
  - [ ] Require senior for complex PRs

---

## Phase 3: Advanced Features

> Goal: Full-featured admin interface, achievements, comprehensive analytics.

### 3.1 Slack App Home

- [ ] Enable App Home in Slack app settings
- [ ] `/api/slack/events` - handle `app_home_opened` event
- [ ] Build App Home view:
  - [ ] My Stats section (pending, completed, response time)
  - [ ] Current assignments list
  - [ ] Quick actions
- [ ] Admin-only sections:
  - [ ] Repository management
  - [ ] Team configuration
  - [ ] Assignment rules

### 3.2 Interactive Modals

- [ ] `/api/slack/interactions` endpoint
- [ ] Add repository modal (form)
- [ ] Configure repository modal
- [ ] Reviewer profile modal
- [ ] Reassignment modal

### 3.3 Achievement System

- [ ] Define achievements:
  - [ ] 🚀 Speed Demon: <1h average response
  - [ ] 🔍 Code Detective: Most issues caught
  - [ ] 🎯 Precision Reviewer: High approval accuracy
  - [ ] 🤝 Team Player: Helped all team members
  - [ ] 🧠 Mentor: Most helpful for juniors
  - [ ] 📈 Velocity Master: Fastest turnaround
  - [ ] 🛡️ Code Guardian: Prevented most bugs
  - [ ] 💪 Iron Reviewer: Longest streak
- [ ] Achievement evaluation logic (nightly job?)
- [ ] Store earned achievements
- [ ] Notify user when achievement unlocked
- [ ] Display achievements in stats/profile

### 3.4 Weekly Challenges

- [ ] Define challenge types:
  - [ ] Lightning Week: All reviews <2h
  - [ ] Quality Focus: 90%+ approval rate
  - [ ] Collaboration: Review 3+ junior PRs
  - [ ] Innovation: Review 2+ complex features
- [ ] Weekly challenge rotation
- [ ] Track challenge progress
- [ ] Announce winners

### 3.5 Advanced Analytics & Reporting

- [ ] Weekly PR Warlord Report (scheduled job):
  - [ ] Hall of Fame (top reviewers)
  - [ ] Speed Champions
  - [ ] Quality Leaders
  - [ ] Team Metrics summary
  - [ ] This week's challenges
- [ ] `/pr-roulette report [repo]` - repository analytics
- [ ] Bottleneck detection (teams with high avg review time)
- [ ] Individual growth tracking over time

### 3.6 Workload Optimization

- [ ] Cognitive load calculation (complexity-weighted pending count)
- [ ] Overload protection (hard limit + soft warning)
- [ ] Time zone awareness (don't assign at 11pm)
- [ ] Working hours configuration per user
- [ ] Availability status (vacation, busy, etc.)

### 3.7 User Profile Management

- [ ] `/pr-roulette profile` - view own profile
- [ ] `/pr-roulette profile @user` - view others (limited)
- [ ] Editable fields:
  - [ ] Skills/expertise
  - [ ] Max concurrent reviews
  - [ ] Working hours
  - [ ] Notification preferences
  - [ ] Learning goals (get assigned PRs in these areas)

---

## Phase 4: Polish & Scale

> Goal: Production-ready, performant, enterprise-grade.

### 4.1 Performance Optimization

- [ ] Database query optimization (indexes, query analysis)
- [ ] Caching layer (Redis?) for frequently accessed data
- [ ] Rate limiting for API endpoints
- [ ] Background job queue for heavy operations
- [ ] Pagination for large datasets

### 4.2 Error Handling & Resilience

- [ ] Graceful GitHub API rate limit handling
- [ ] Slack API retry with exponential backoff
- [ ] Dead letter queue for failed operations
- [ ] Health check endpoint
- [ ] Alerting on critical failures

### 4.3 Security Hardening

- [ ] Audit logging (who changed what, when)
- [ ] Role-based access control (Admin, Team Lead, Developer, Viewer)
- [ ] Data retention policies
- [ ] PII handling compliance
- [ ] Token rotation strategy

### 4.4 Observability

- [ ] Structured logging
- [ ] Metrics collection (assignment success rate, response times)
- [ ] Error tracking (Sentry or similar)
- [ ] Performance monitoring
- [ ] Usage analytics

### 4.5 Advanced Configuration

- [ ] Multi-workspace support (if needed)
- [ ] Custom scoring formulas per organization
- [ ] Webhook integrations (notify external systems)
- [ ] Export functionality (CSV, JSON)
- [ ] Import/migration tools

### 4.6 Documentation & Onboarding

- [ ] User guide
- [ ] Admin guide
- [ ] API documentation (if exposing)
- [ ] Onboarding flow for new workspaces
- [ ] In-app help/tooltips

---

## Quick Reference: Data Models

From spec - to guide Prisma schema:

| Model | Key Fields |
|-------|------------|
| User | slack_id, github_username, email, display_name, weight, max_concurrent, timezone, availability, skills[], role |
| Repository | name, url, owner, language, complexity_multiplier, auto_assignment, min_reviewers, max_reviewers, require_senior_complex, excluded_patterns[], branch_filters[] |
| Assignment | pr_url, pr_number, repository_id, author_id, assignee_id, effort_score, complexity, skills_required[], status, assigned_at, first_response_at, completed_at, github_synced, slack_notified |
| Statistics | user_id, repository_id, period, assigned, completed, avg_response_time, avg_completion_time, quality_comments, bugs_caught, approvals, rejections, skills_used{}, achievements[], streak |
| Achievement | name, description, criteria, icon |
| UserAchievement | user_id, achievement_id, earned_at |

---

## Current Status

**Phase 1 Progress**: ~15% (infrastructure done, schema next)

**Blocked on**: Nothing

**Next Action**: Design Prisma schema based on Phase 1 requirements
