# PR Roulette API Reference

This document describes the API endpoints available in PR Roulette.

## Table of Contents

- [Authentication](#authentication)
- [Slack Webhooks](#slack-webhooks)
- [Health & Metrics](#health--metrics)
- [Analytics](#analytics)
- [Challenges & Goals](#challenges--goals)
- [Admin Endpoints](#admin-endpoints)

## Authentication

### Slack Webhook Verification

All Slack webhook endpoints verify requests using the Slack signing secret:

```
x-slack-signature: v0=<signature>
x-slack-request-timestamp: <timestamp>
```

### API Token Authentication

Admin endpoints require a bearer token:

```
Authorization: Bearer <token>
```

### Metrics Authentication

The metrics endpoint requires the `METRICS_TOKEN`:

```
Authorization: Bearer <metrics-token>
```

## Slack Webhooks

These endpoints receive webhooks from Slack.

### POST /api/slack/commands

Handles slash commands from Slack.

**Request Body:**
```
command=/pr-roulette
text=<subcommand>
user_id=U12345678
channel_id=C12345678
response_url=https://hooks.slack.com/...
```

**Subcommands:**
- `help` - Show help message
- `stats` - Show user statistics
- `leaderboard` - Show weekly leaderboard
- `assign <url> [@user]` - Assign a PR
- `challenges` - Show active challenges
- `config` - Open configuration (admin only)

**Response:**
```json
{
  "response_type": "ephemeral",
  "text": "...",
  "blocks": [...]
}
```

### POST /api/slack/events

Handles Slack Events API subscriptions.

**Supported Events:**

| Event | Description |
|-------|-------------|
| `url_verification` | Slack URL verification challenge |
| `app_home_opened` | User opened App Home tab |
| `app_mention` | Bot was @mentioned |
| `message.channels` | Message in public channel |
| `message.groups` | Message in private channel |
| `message.im` | Direct message to bot |

**Request Body:**
```json
{
  "type": "event_callback",
  "event": {
    "type": "message",
    "text": "https://github.com/org/repo/pull/123",
    "user": "U12345678",
    "channel": "C12345678"
  }
}
```

**Response:**
```json
{
  "ok": true
}
```

### POST /api/slack/interactions

Handles interactive components (buttons, modals, etc).

**Interaction Types:**

| Type | Description |
|------|-------------|
| `block_actions` | Button clicks, select menus |
| `view_submission` | Modal form submissions |
| `shortcut` | Global/message shortcuts |

**Request Body:**
```json
{
  "type": "block_actions",
  "user": { "id": "U12345678" },
  "actions": [
    {
      "action_id": "accept_assignment",
      "value": "assignment_123"
    }
  ]
}
```

**Supported Actions:**

| Action ID | Description |
|-----------|-------------|
| `accept_assignment` | Accept a PR assignment |
| `decline_assignment` | Decline and reassign |
| `reassign_pr` | Manually reassign to another user |
| `mark_complete` | Mark review as complete |
| `view_achievements` | Open achievements modal |
| `show_stats` | Show detailed stats |
| `show_leaderboard` | Show leaderboard |
| `show_challenges` | Show challenges |
| `admin_manage_repos` | Open repo management |
| `admin_manage_team` | Open team management |
| `admin_view_reports` | View analytics reports |
| `admin_send_digest` | Trigger weekly digest |

## Health & Metrics

### GET /api/health

Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "0.1.0",
  "checks": {
    "database": "ok",
    "cache": "ok",
    "slack": "ok"
  }
}
```

**Status Codes:**
- `200` - All systems healthy
- `503` - One or more systems unhealthy

### GET /api/metrics

Prometheus-compatible metrics endpoint.

**Authentication:** Requires `METRICS_TOKEN`

**Response:**
```
# HELP pr_roulette_assignments_total Total PR assignments
# TYPE pr_roulette_assignments_total counter
pr_roulette_assignments_total{status="pending"} 12
pr_roulette_assignments_total{status="completed"} 156

# HELP pr_roulette_response_time_seconds Review response time
# TYPE pr_roulette_response_time_seconds histogram
pr_roulette_response_time_seconds_bucket{le="1800"} 45
pr_roulette_response_time_seconds_bucket{le="3600"} 89
...
```

**Available Metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| `pr_roulette_assignments_total` | Counter | Total assignments by status |
| `pr_roulette_response_time_seconds` | Histogram | Response time distribution |
| `pr_roulette_active_reviewers` | Gauge | Currently active reviewers |
| `pr_roulette_pending_reviews` | Gauge | Current pending reviews |
| `pr_roulette_api_requests_total` | Counter | API requests by endpoint |
| `pr_roulette_api_latency_seconds` | Histogram | API response latency |

## Analytics

### GET /api/analytics

Retrieve review analytics and insights.

**Authentication:** Required (Admin or Team Lead)

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | ISO date | Start of date range |
| `endDate` | ISO date | End of date range |
| `repositoryId` | string | Filter by repository |
| `userId` | string | Filter by user |

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalReviews": 156,
      "avgResponseTimeMinutes": 87,
      "completionRate": 0.94
    },
    "byDay": [
      { "date": "2024-01-15", "reviews": 12, "avgTime": 65 }
    ],
    "byReviewer": [
      { "userId": "...", "displayName": "Jane", "reviews": 23, "avgTime": 45 }
    ],
    "bottlenecks": [
      { "prUrl": "...", "waitingHours": 48 }
    ]
  }
}
```

## Challenges & Goals

### GET /api/challenges

List active challenges.

**Authentication:** Required

**Response:**
```json
{
  "success": true,
  "data": {
    "individual": [
      {
        "id": "...",
        "displayName": "Review Blitz",
        "description": "Complete 5 reviews this week",
        "target": 5,
        "progress": 3,
        "endsAt": "2024-01-21T23:59:59Z",
        "reward": "+50 bonus points"
      }
    ],
    "team": [
      {
        "id": "...",
        "displayName": "Team Effort",
        "target": 25,
        "progress": 18
      }
    ]
  }
}
```

### GET /api/challenges/[id]

Get challenge details.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "displayName": "Review Blitz",
    "description": "Complete 5 reviews this week",
    "type": "REVIEWS_COMPLETED",
    "scope": "INDIVIDUAL",
    "target": 5,
    "progress": 3,
    "startsAt": "2024-01-15T00:00:00Z",
    "endsAt": "2024-01-21T23:59:59Z",
    "participants": [
      { "userId": "...", "displayName": "Jane", "progress": 3 }
    ]
  }
}
```

### POST /api/goals

Create or update personal goals.

**Authentication:** Required

**Request Body:**
```json
{
  "type": "reviews_per_week",
  "target": 5
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "type": "reviews_per_week",
    "target": 5,
    "current": 2
  }
}
```

### GET /api/goals

Get user's personal goals.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "type": "reviews_per_week",
      "target": 5,
      "current": 2,
      "weekStart": "2024-01-15"
    }
  ]
}
```

## Admin Endpoints

All admin endpoints require Admin or Team Lead role.

### GET /api/admin

Get admin dashboard data.

**Response:**
```json
{
  "success": true,
  "data": {
    "stats": {
      "repositories": 5,
      "users": 12,
      "pendingReviews": 8,
      "reviewsThisWeek": 34
    },
    "recentActivity": [
      { "type": "assignment", "description": "...", "timestamp": "..." }
    ]
  }
}
```

### GET /api/admin/repositories

List managed repositories.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "name": "org/repo",
      "enabled": true,
      "autoAssign": true,
      "requiredReviewers": 1,
      "pendingCount": 3
    }
  ]
}
```

### POST /api/admin/repositories

Add a repository.

**Request Body:**
```json
{
  "owner": "org",
  "name": "repo",
  "autoAssign": true,
  "requiredReviewers": 1
}
```

### PATCH /api/admin/repositories

Update repository settings.

**Request Body:**
```json
{
  "id": "...",
  "autoAssign": false
}
```

### DELETE /api/admin/repositories

Remove a repository.

**Request Body:**
```json
{
  "id": "..."
}
```

### GET /api/admin/users

List team members.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "displayName": "Jane Doe",
      "slackId": "U12345678",
      "githubUsername": "janedoe",
      "role": "REVIEWER",
      "skills": ["typescript", "react"],
      "available": true,
      "pendingReviews": 2
    }
  ]
}
```

### POST /api/admin/users

Add a team member.

**Request Body:**
```json
{
  "slackId": "U12345678",
  "role": "REVIEWER",
  "skills": ["typescript", "react"]
}
```

### PATCH /api/admin/users

Update team member.

**Request Body:**
```json
{
  "id": "...",
  "role": "TEAM_LEAD",
  "skills": ["typescript", "react", "node"]
}
```

### DELETE /api/admin/users

Remove a team member.

**Request Body:**
```json
{
  "id": "..."
}
```

### GET /api/admin/reviewers

List available reviewers for assignment.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `repositoryId` | string | Filter by repository expertise |
| `skills` | string[] | Filter by required skills |
| `excludeUserIds` | string[] | Exclude specific users |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "displayName": "Jane Doe",
      "workload": 2,
      "skills": ["typescript", "react"],
      "avgResponseMinutes": 45,
      "score": 0.85
    }
  ]
}
```

## Weekly Digest

### POST /api/digest

Trigger weekly digest generation and distribution.

**Authentication:** Admin only

**Request Body:**
```json
{
  "dryRun": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sent": 12,
    "failed": 0,
    "preview": "..."
  }
}
```

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

**Common Error Codes:**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

## Rate Limiting

API endpoints are rate limited:

| Endpoint Type | Limit |
|---------------|-------|
| Slack webhooks | 1000/minute |
| Read endpoints | 100/minute per user |
| Write endpoints | 20/minute per user |
| Admin endpoints | 50/minute per user |

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705312800
```
