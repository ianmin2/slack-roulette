# PR Roulette Usage Guide

This guide covers how to use PR Roulette for automated code review assignments.

## Table of Contents

- [Getting Started](#getting-started)
- [Slash Commands](#slash-commands)
- [Automatic PR Detection](#automatic-pr-detection)
- [App Home](#app-home)
- [Achievements](#achievements)
- [Challenges](#challenges)
- [Admin Features](#admin-features)

## Getting Started

Once PR Roulette is installed in your Slack workspace:

1. **Invite the bot** to channels where you want PR detection:
   ```
   /invite @PR Roulette
   ```

2. **Check your profile** by visiting the App Home (click "PR Roulette" in the Apps section)

3. **Link your GitHub account** (if required by your admin) for better reviewer matching

## Slash Commands

All commands use the `/pr-roulette` prefix.

### Help

```
/pr-roulette help
```

Displays all available commands and their usage.

### View Your Stats

```
/pr-roulette stats
```

Shows your personal review statistics:
- Reviews completed (this week/all time)
- Average response time
- Current streak
- Points earned
- Recent achievements

### View Leaderboard

```
/pr-roulette leaderboard
```

Displays the top reviewers for the current week, ranked by:
1. Points earned
2. Reviews completed
3. Average response time

### Manual PR Assignment

```
/pr-roulette assign <github-pr-url> [@user]
```

Manually assign a PR for review. If no user is specified, the bot will select an appropriate reviewer.

**Examples:**
```
/pr-roulette assign https://github.com/org/repo/pull/123
/pr-roulette assign https://github.com/org/repo/pull/123 @jane
```

### View Active Challenges

```
/pr-roulette challenges
```

Shows current weekly challenges and your progress toward completing them.

### Configuration (Admin Only)

```
/pr-roulette config
```

Opens the configuration panel for channel settings (requires admin or team lead role).

## Automatic PR Detection

When you paste a GitHub PR URL in any channel where PR Roulette is active, the bot automatically:

1. **Parses the PR** - Extracts title, description, files changed, and complexity
2. **Selects a reviewer** - Uses the assignment algorithm considering:
   - Workload balance (pending reviews)
   - Expertise match (skills and past reviews)
   - Availability (working hours, vacation status)
   - Recent history (avoids assigning same pairs repeatedly)
3. **Posts an assignment message** with:
   - PR summary
   - Assigned reviewer
   - Action buttons (Accept, Decline, Reassign)

### PR Message Actions

| Button | Description |
|--------|-------------|
| **Accept** | Confirm you'll review the PR |
| **Decline** | Decline and trigger reassignment |
| **Reassign** | Manually select a different reviewer |
| **View PR** | Open the PR in GitHub |
| **Mark Complete** | Mark the review as done |

## App Home

Click on "PR Roulette" in the Apps section to access your personal dashboard.

### Dashboard Sections

#### Your Stats
- Pending reviews count
- Completed reviews this week
- Average response time
- Points earned
- Current streak

#### Pending Reviews
List of PRs waiting for your review, with:
- PR title and number
- Repository name
- Complexity indicator
- Time since assignment
- Quick link to view the PR

#### Achievements
Preview of your recent achievements with a button to view all.

#### Quick Actions
- **My Stats** - Detailed statistics view
- **Leaderboard** - Weekly rankings
- **Challenges** - Active challenges
- **My Profile** - Edit your settings

#### Admin Dashboard (Admins/Team Leads only)
- Repository count
- Team member count
- Pending reviews count
- Quick links to manage repos, team, and reports

## Achievements

Achievements are earned by completing various milestones. They're permanent and display on your profile.

### Speed Achievements

| Achievement | Description | Points |
|-------------|-------------|--------|
| Speed Demon | Complete a review in under 30 minutes | 50 |
| Lightning Fast | Complete a review in under 15 minutes | 100 |
| Consistent Responder | Maintain avg response under 2 hours | 75 |

### Volume Achievements

| Achievement | Description | Points |
|-------------|-------------|--------|
| First Steps | Complete your first review | 10 |
| Getting Started | Complete 5 reviews | 25 |
| Review Veteran | Complete 25 reviews | 100 |
| Review Master | Complete 50 reviews | 200 |
| Review Legend | Complete 100 reviews | 500 |

### Streak Achievements

| Achievement | Description | Points |
|-------------|-------------|--------|
| On a Roll | Maintain a 3-day streak | 30 |
| Unstoppable | Maintain a 7-day streak | 75 |
| Iron Reviewer | Maintain a 14-day streak | 150 |

### Points Achievements

| Achievement | Description | Points |
|-------------|-------------|--------|
| Point Collector | Earn 100 points | 25 |
| High Scorer | Earn 500 points | 100 |
| Point Master | Earn 1000 points | 250 |

### Special Achievements

| Achievement | Description | Points |
|-------------|-------------|--------|
| Polyglot | Review PRs in 5 different languages | 100 |
| Explorer | Review PRs in 3 different repos | 75 |

## Challenges

Challenges are time-boxed goals that rotate weekly. They can be individual or team-wide.

### Individual Challenges

| Challenge | Description | Reward |
|-----------|-------------|--------|
| Lightning Week | Complete all reviews in under 2 hours | +150 points |
| Speed Sprint | Complete 3 reviews in under 1 hour each | +75 points |
| Quick Responder | Maintain avg response under 30 minutes | +100 points |
| Review Marathon | Complete 10 reviews this week | +100 points |
| Review Blitz | Complete 5 reviews this week | +50 points |
| Consistency King | Maintain a 5-day streak | +75 points |
| Iron Will | Maintain a 7-day streak | Iron Will badge |
| Point Hunter | Earn 200 points this week | +50 points |
| Point Master | Earn 500 points this week | +125 points |
| Clean Slate | End week with zero pending reviews | +75 points |

### Team Challenges

| Challenge | Description | Reward |
|-----------|-------------|--------|
| Team Effort | Team completes 25 reviews | +50 points each |
| Team Surge | Team completes 50 reviews | +100 points each |
| Inbox Zero | Team ends week with zero pending | +100 points each |

### Challenge Difficulty

- Easy: Achievable with normal activity
- Medium: Requires consistent effort
- Hard: Requires dedicated focus

## Admin Features

Admins and Team Leads have access to additional features.

### Managing Repositories

1. Open the App Home
2. Click "Manage Repos" in the Admin Dashboard
3. Add/remove repositories to track
4. Configure per-repo settings:
   - Required reviewers
   - Auto-assignment enabled/disabled
   - Complexity thresholds

### Managing Team Members

1. Open the App Home
2. Click "Manage Team" in the Admin Dashboard
3. Add/remove team members
4. Set roles (Reviewer, Team Lead, Admin)
5. Configure skills and expertise areas
6. Set availability schedules

### Viewing Reports

1. Open the App Home
2. Click "View Reports" in the Admin Dashboard
3. Available reports:
   - Weekly summary
   - Reviewer performance
   - Bottleneck analysis
   - Time-to-review trends

### Sending Digests

1. Open the App Home
2. Click "Send Digest" in the Admin Dashboard
3. Sends weekly summary to all team members

Digests include:
- Team statistics
- Top performers
- Challenge results
- Achievement unlocks

## Tips for Effective Use

1. **Keep response times low** - Fast reviews earn more points and help the team
2. **Check App Home daily** - Stay on top of pending reviews
3. **Participate in challenges** - Earn bonus points and badges
4. **Decline gracefully** - If you can't review, decline early so it can be reassigned
5. **Use skills tagging** - Helps the algorithm match you with relevant PRs

## Troubleshooting

### Bot not detecting PRs

- Ensure the bot is invited to the channel
- Check that the PR URL is from a tracked repository
- Verify the repository is enabled in admin settings

### Not receiving assignments

- Check your availability status
- Verify you're added to the team
- Check your skills match the repository

### Commands not working

- Ensure you're using the correct format: `/pr-roulette <command>`
- Check that the app is installed in your workspace
- Contact your workspace admin if issues persist
