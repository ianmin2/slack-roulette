# PR Roulette

Intelligent code review assignment system for Slack with gamification.

PR Roulette automates code review assignments by analyzing GitHub PRs, balancing reviewer workloads, and gamifying the review process to encourage participation.

## Features

- **Auto-detection**: Automatically detects GitHub PR links shared in Slack channels
- **Smart Assignment**: Selects reviewers based on expertise, availability, and workload balance
- **Gamification**: Achievements, challenges, and leaderboards to encourage reviews
- **Weekly Digests**: Automated summary reports for teams and individuals
- **Admin Panel**: Role-based access control for managing reviewers and repositories
- **Analytics**: Comprehensive metrics on review times, bottlenecks, and team performance

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Slack App Setup](#slack-app-setup)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Development](#development)
- [Deployment](#deployment)

## Installation

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 18.x or higher |
| npm | 9.x or higher |
| PostgreSQL | 14.x or higher |
| Redis | 6.x or higher (optional) |

### Steps

1. **Clone the repository**

```bash
git clone https://github.com/ianmin2/slack-roulette.git
cd slack-roulette
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up the database**

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy
```

4. **Configure environment variables**

```bash
cp .env.example .env
# Edit .env with your configuration (see Configuration section)
```

5. **Start the development server**

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

## Dependencies

### Production Dependencies

| Package | Purpose |
|---------|---------|
| `next` | React framework with App Router |
| `react` / `react-dom` | UI library |
| `zod` | Runtime schema validation |
| `clsx` / `tailwind-merge` | CSS class utilities |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `@prisma/client` / `prisma` | Database ORM |
| `typescript` | Type safety |
| `jest` / `ts-jest` | Testing framework |
| `@testing-library/react` | React component testing |
| `eslint` | Code linting |

## Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

#### Required Variables

```bash
# Database connection string
DATABASE_URL=postgresql://user:password@localhost:5432/pr_roulette

# Application URL (used for OAuth callbacks and Slack webhooks)
APP_URL=https://your-domain.com

# NextAuth.js secret (generate with: openssl rand -base64 32)
NEXTAUTH_SECRET=your-32-character-secret
NEXTAUTH_URL=https://your-domain.com

# Slack API credentials
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
```

#### Optional Variables

```bash
# GitHub OAuth (for linking GitHub accounts)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Redis cache (falls back to in-memory if not configured)
REDIS_URL=redis://localhost:6379

# Logging level: debug | info | warn | error
LOG_LEVEL=info

# Metrics endpoint authentication
METRICS_TOKEN=your-metrics-access-token
```

## Slack App Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From a manifest**
3. Select your workspace
4. Paste the contents of `slack-app-manifest.json`
5. Update the URLs to match your deployment domain

### 2. Install to Workspace

1. Navigate to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Authorize the requested permissions
4. Copy the **Bot User OAuth Token** (`xoxb-...`)

### 3. Get Signing Secret

1. Navigate to **Basic Information**
2. Copy the **Signing Secret**

### 4. Configure Event Subscriptions

Ensure your server is running and accessible, then:

1. Navigate to **Event Subscriptions**
2. Enable Events
3. Set Request URL to: `https://your-domain.com/api/slack/events`
4. Slack will verify the endpoint

### Bot Permissions Required

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Respond to @mentions |
| `channels:history` | Read messages for PR detection |
| `channels:read` | List channels |
| `chat:write` | Send messages and notifications |
| `commands` | Handle slash commands |
| `reactions:write` | Add reactions to messages |
| `users:read` | Get user information |
| `users:read.email` | Match users with GitHub accounts |

## Usage

See the [Usage Guide](docs/USAGE.md) for detailed instructions.

### Quick Start

#### Slash Commands

```
/pr-roulette help              # Show available commands
/pr-roulette stats             # View your review statistics
/pr-roulette leaderboard       # See top reviewers this week
/pr-roulette assign <url>      # Manually assign a PR
/pr-roulette config            # Configure channel settings (admin)
```

#### Automatic PR Detection

Simply paste a GitHub PR URL in any channel where PR Roulette is active:

```
https://github.com/org/repo/pull/123
```

The bot will automatically:
1. Parse the PR details
2. Select an appropriate reviewer
3. Post an assignment message with action buttons

#### App Home

Click on **PR Roulette** in the Apps section to view:
- Your pending reviews
- Personal statistics
- Recent achievements
- Active challenges

## API Reference

See the [API Documentation](docs/API.md) for endpoint details.

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/slack/commands` | POST | Slack slash command handler |
| `/api/slack/events` | POST | Slack event subscriptions |
| `/api/slack/interactions` | POST | Button/modal interactions |
| `/api/health` | GET | Health check |
| `/api/metrics` | GET | Prometheus metrics |
| `/api/analytics` | GET | Review analytics |

## Development

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run type-check   # TypeScript type checking
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

### Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── slack/         # Slack webhook handlers
│   │   ├── admin/         # Admin endpoints
│   │   └── ...
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── lib/                   # Core libraries
│   ├── slack/             # Slack API client
│   ├── github/            # GitHub API client
│   ├── assignment/        # Reviewer selection logic
│   ├── achievements/      # Achievement system
│   ├── challenges/        # Challenge system
│   ├── analytics/         # Analytics engine
│   ├── admin/             # Admin functions & RBAC
│   ├── cache/             # Caching layer
│   ├── db/                # Database utilities
│   └── utils/             # Shared utilities
└── types/                 # TypeScript definitions
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/lib/assignment/__tests__/selector.test.ts

# Run with coverage
npm run test:coverage
```

## Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Configure environment variables in the Vercel dashboard
3. Deploy

```bash
npm i -g vercel
vercel
```

### Docker

```bash
# Build the image
docker build -t pr-roulette .

# Run the container
docker run -p 3000:3000 --env-file .env pr-roulette
```

### Manual Deployment

```bash
# Build
npm run build

# Start
npm start
```

Ensure you have:
- PostgreSQL database accessible
- Redis instance (optional but recommended)
- SSL certificate for HTTPS (required for Slack webhooks)

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## Support

- [GitHub Issues](https://github.com/ianmin2/slack-roulette/issues)
