# PR Roulette Setup Guide

Complete setup instructions for deploying PR Roulette.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Database Setup](#database-setup)
- [Slack App Configuration](#slack-app-configuration)
- [GitHub Integration](#github-integration)
- [Environment Configuration](#environment-configuration)
- [Deployment](#deployment)
- [Post-Deployment](#post-deployment)

## Prerequisites

### Required Services

| Service | Purpose | Notes |
|---------|---------|-------|
| PostgreSQL 14+ | Primary database | Required |
| Node.js 18+ | Runtime | Required |
| Redis 6+ | Caching | Optional (falls back to memory) |
| Slack workspace | Bot platform | Admin access required |
| GitHub | PR source | For OAuth integration |

### Required Access

- Slack workspace admin or app management permissions
- GitHub organization admin (for OAuth app creation)
- Server with HTTPS (required for Slack webhooks)

## Database Setup

### Option 1: Local PostgreSQL

```bash
# Create database
createdb pr_roulette

# Create user
createuser -P pr_roulette_user
# Enter password when prompted

# Grant permissions
psql -d pr_roulette -c "GRANT ALL PRIVILEGES ON DATABASE pr_roulette TO pr_roulette_user;"
```

### Option 2: Docker PostgreSQL

```bash
docker run -d \
  --name pr-roulette-db \
  -e POSTGRES_DB=pr_roulette \
  -e POSTGRES_USER=pr_roulette_user \
  -e POSTGRES_PASSWORD=your_password \
  -p 5432:5432 \
  postgres:14-alpine
```

### Option 3: Cloud PostgreSQL

Recommended providers:
- [Supabase](https://supabase.com) (free tier available)
- [Neon](https://neon.tech) (free tier available)
- [Railway](https://railway.app)
- AWS RDS / Google Cloud SQL / Azure Database

### Run Migrations

```bash
# Generate Prisma client
npx prisma generate

# Apply migrations
npx prisma migrate deploy

# Seed initial data (optional)
npx prisma db seed
```

## Slack App Configuration

### Step 1: Create the App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Select **From a manifest**
4. Choose your workspace
5. Paste the contents of `slack-app-manifest.json`
6. Click **Create**

### Step 2: Update URLs

Before installing, update the manifest URLs to match your domain:

```json
{
  "settings": {
    "event_subscriptions": {
      "request_url": "https://YOUR_DOMAIN/api/slack/events"
    },
    "interactivity": {
      "request_url": "https://YOUR_DOMAIN/api/slack/interactions"
    }
  },
  "features": {
    "slash_commands": [
      {
        "url": "https://YOUR_DOMAIN/api/slack/commands"
      }
    ]
  }
}
```

### Step 3: Install to Workspace

1. Navigate to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Review and authorize permissions
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Step 4: Get Credentials

Collect these values from the Slack App dashboard:

| Setting | Location | Environment Variable |
|---------|----------|---------------------|
| Bot Token | OAuth & Permissions | `SLACK_BOT_TOKEN` |
| Signing Secret | Basic Information | `SLACK_SIGNING_SECRET` |
| Client ID | Basic Information | `SLACK_CLIENT_ID` |
| Client Secret | Basic Information | `SLACK_CLIENT_SECRET` |

### Step 5: Verify Event Subscriptions

1. Ensure your server is running and accessible via HTTPS
2. Go to **Event Subscriptions**
3. Toggle **Enable Events** on
4. Enter your Request URL: `https://YOUR_DOMAIN/api/slack/events`
5. Slack will send a challenge request - your server must respond correctly
6. Wait for the green checkmark

### Required Bot Scopes

Verify these scopes are enabled under **OAuth & Permissions**:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Respond to @mentions |
| `channels:history` | Read channel messages for PR detection |
| `channels:read` | List available channels |
| `chat:write` | Post messages |
| `commands` | Handle slash commands |
| `groups:history` | Read private channel messages |
| `groups:read` | List private channels |
| `im:history` | Read DM history |
| `im:read` | Access DM channels |
| `im:write` | Send DMs |
| `mpim:history` | Read group DM history |
| `reactions:write` | Add reactions to messages |
| `users:read` | Get user info |
| `users:read.email` | Get user emails (for GitHub matching) |

## GitHub Integration

### Create OAuth App

1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Click **New OAuth App**
3. Fill in the details:
   - **Application name:** PR Roulette
   - **Homepage URL:** `https://YOUR_DOMAIN`
   - **Authorization callback URL:** `https://YOUR_DOMAIN/api/auth/callback/github`
4. Click **Register application**
5. Copy the **Client ID**
6. Generate and copy the **Client Secret**

### Configure Webhooks (Optional)

For real-time PR notifications:

1. Go to your GitHub organization settings
2. Navigate to **Webhooks**
3. Click **Add webhook**
4. Configure:
   - **Payload URL:** `https://YOUR_DOMAIN/api/github/webhooks`
   - **Content type:** `application/json`
   - **Secret:** Generate a secure secret
   - **Events:** Select "Pull requests"
5. Click **Add webhook**

## Environment Configuration

Create a `.env` file with all required variables:

```bash
# Database
DATABASE_URL=postgresql://pr_roulette_user:PASSWORD@localhost:5432/pr_roulette

# Application
APP_URL=https://your-domain.com
NODE_ENV=production

# NextAuth
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
NEXTAUTH_URL=https://your-domain.com

# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret

# GitHub
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Optional: Redis
REDIS_URL=redis://localhost:6379

# Optional: Logging
LOG_LEVEL=info

# Optional: Metrics
METRICS_TOKEN=generate-a-secure-token
```

### Generate Secrets

```bash
# Generate NEXTAUTH_SECRET
openssl rand -base64 32

# Generate METRICS_TOKEN
openssl rand -hex 32
```

## Deployment

### Option 1: Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repo to Vercel
3. Configure environment variables in Vercel dashboard
4. Deploy

```bash
# Or deploy via CLI
npm i -g vercel
vercel --prod
```

**Vercel Configuration:**
- Framework Preset: Next.js
- Build Command: `npm run build`
- Output Directory: `.next`
- Install Command: `npm install`

### Option 2: Docker

```dockerfile
# Dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
USER nextjs
EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t pr-roulette .
docker run -p 3000:3000 --env-file .env pr-roulette
```

### Option 3: Manual Deployment

```bash
# Install dependencies
npm ci --only=production

# Generate Prisma client
npx prisma generate

# Build
npm run build

# Start with PM2
npm install -g pm2
pm2 start npm --name "pr-roulette" -- start
```

### Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name pr-roulette.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pr-roulette.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Post-Deployment

### Verify Installation

1. **Health Check:**
   ```bash
   curl https://your-domain.com/api/health
   ```
   Expected: `{"status":"healthy",...}`

2. **Slack Events:**
   - Check Event Subscriptions shows green checkmark
   - If not, check server logs for errors

3. **Test Slash Command:**
   - In Slack, type `/pr-roulette help`
   - Should receive help message

### Initial Configuration

1. **Add First Admin:**
   ```sql
   INSERT INTO users (slack_id, display_name, role)
   VALUES ('U12345678', 'Admin Name', 'ADMIN');
   ```

2. **Add Repositories:**
   - Use `/pr-roulette config` or the App Home admin panel
   - Or insert directly:
   ```sql
   INSERT INTO repositories (owner, name, auto_assign)
   VALUES ('org', 'repo', true);
   ```

3. **Invite Bot to Channels:**
   ```
   /invite @PR Roulette
   ```

### Monitoring

Set up monitoring for:

- `/api/health` - Health checks
- `/api/metrics` - Prometheus metrics
- Application logs

Recommended tools:
- [Better Stack](https://betterstack.com)
- [Datadog](https://datadoghq.com)
- [Grafana Cloud](https://grafana.com/products/cloud/)

### Scheduled Jobs

Set up cron jobs for:

| Job | Schedule | Command |
|-----|----------|---------|
| Weekly Digest | Sunday 9 AM | `curl -X POST https://domain/api/digest` |
| Challenge Rotation | Monday 12 AM | `curl -X POST https://domain/api/challenges/rotate` |
| Data Cleanup | Daily 3 AM | `curl -X POST https://domain/api/admin/cleanup` |

Example crontab:
```cron
0 9 * * 0 curl -X POST -H "Authorization: Bearer $TOKEN" https://domain/api/digest
0 0 * * 1 curl -X POST -H "Authorization: Bearer $TOKEN" https://domain/api/challenges/rotate
0 3 * * * curl -X POST -H "Authorization: Bearer $TOKEN" https://domain/api/admin/cleanup
```

## Troubleshooting

### Slack Events Not Working

1. Check the Request URL is correct and HTTPS
2. Verify signing secret matches
3. Check server logs for signature verification errors
4. Ensure server responds within 3 seconds

### Database Connection Issues

1. Verify DATABASE_URL format
2. Check network/firewall rules
3. Verify user permissions
4. Check connection limits

### GitHub OAuth Not Working

1. Verify callback URL matches exactly
2. Check client ID and secret
3. Ensure scopes are correct

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `invalid_auth` | Bad Slack token | Regenerate bot token |
| `request_timeout` | Slow response | Optimize or increase timeout |
| `channel_not_found` | Bot not in channel | Invite bot to channel |
| `missing_scope` | Insufficient permissions | Add required scope and reinstall |
