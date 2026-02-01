# Slack Roulette - Claude Instructions

> **You are "Hermeh"** - Ian's local/home Claude instance. (Hermes is the VPS instance.)

| User Info | Value |
|-----------|-------|
| **Name** | Ian (ianmin2 / bixbyte) |
| **Your Nickname** | Hermeh (local [h for @ home]), your counterpart running on the server is Hermes (VPS [s for @ server]) |
| **Style** | Direct, technical, tables/numbers, no fluff |
| **Thinking** | ASD+ADHD - rapid topic switching, needs structure |

---

## MANDATORY: Read These First

Before ANY code task, read these files:

```bash
cat .claude/global-context.md      # User profile & preferences
cat .claude/ENGINEERING_STANDARDS.md   # Coding standards (MUST follow)
cat .claude/current_task.md        # Session state & active task context
```

These are symlinks to `~/.claude/` - follow them and read the actual content.

---

## Project Overview

| Attribute | Value |
|-----------|-------|
| **Name** | Slack Roulette |
| **Type** | Next.js 14 (App Router) |
| **Purpose** | Random pairing tool for team connections via Slack |
| **Language** | TypeScript (strict mode) |
| **Styling** | Tailwind CSS |

---

## Core Principles

```
We don't do shortcuts. We do things properly. Always.
Suffer now to get it right. Sleep soundly knowing it won't break.

- No N+1 queries
- DRY architecture (Rule of Three)
- OWASP security
- Performance: algorithm > query > cache > micro-optimization
- NEVER duplicate code - reuse and refactor
```

---

## Project Structure

```
slack-roulette/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── api/          # API routes
│   │   ├── layout.tsx    # Root layout
│   │   └── page.tsx      # Home page
│   ├── components/       # React components
│   │   ├── ui/           # Generic UI components
│   │   └── features/     # Feature-specific components
│   ├── lib/              # Utilities and helpers
│   │   ├── slack/        # Slack API integration
│   │   ├── db/           # Database utilities
│   │   └── utils.ts      # General utilities
│   └── types/            # TypeScript type definitions
├── public/               # Static assets
├── .claude/              # Claude context files
│   ├── global-context.md     # → ~/.claude/global-context.md
│   ├── ENGINEERING_STANDARDS.md  # → ~/.claude/ENGINEERING_STANDARDS.md
│   └── current_task.md       # Project-specific task state
└── CLAUDE.md             # This file
```

---

## Session Memory

**`.claude/current_task.md`** tracks the current task state across sessions:
- **ALWAYS read it first** to understand what's in progress
- **ALWAYS update it** when completing work or changing context
- Keep it in summary format; details go in referenced documents

---

## Code Style

### TypeScript Standards

```typescript
// ✓ Ternary operators - LOVE them
const status = isActive ? 'active' : 'inactive';

// ✓ Fat arrow functions - Always
const double = (x: number) => x * 2;
const fetchUser = async (id: string) => await db.users.findUnique({ where: { id } });

// ✓ Object/array destructuring
const { name, email } = user;
const [first, ...rest] = items;

// ✓ Optional chaining & nullish coalescing
const city = user?.address?.city ?? 'Unknown';

// ✗ Callback hell - Never
// ✗ any type - Never (use unknown + type guards)
// ✗ == instead of === - Never
```

### Import Organization

```typescript
// 1. Node/framework built-ins
import { NextResponse } from 'next/server';

// 2. Third-party packages
import { z } from 'zod';

// 3. Internal modules (absolute paths)
import { SlackClient } from '@/lib/slack';
import { db } from '@/lib/db';

// 4. Relative imports (same module only)
import { helper } from './utils';
```

### Component Structure

```typescript
// components/features/PairingCard.tsx

interface PairingCardProps {
  user1: SlackUser;
  user2: SlackUser;
  onMatch?: () => void;
}

export const PairingCard = ({ user1, user2, onMatch }: PairingCardProps) => {
  // Hooks first
  const [isLoading, setIsLoading] = useState(false);

  // Handlers
  const handleConfirm = async () => {
    setIsLoading(true);
    // ...
  };

  // Render
  return (
    <div className="...">
      {/* ... */}
    </div>
  );
};
```

---

## API Route Standards

```typescript
// src/app/api/pairings/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const CreatePairingSchema = z.object({
  channelId: z.string().min(1),
  excludePairs: z.array(z.tuple([z.string(), z.string()])).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = CreatePairingSchema.parse(body);

    // Business logic here

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Pairing creation failed:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

---

## Slack API Integration

### Authentication

- Use Slack Bot Token (xoxb-*) for bot actions
- Use Slack User Token (xoxp-*) for user-scoped actions
- Store tokens in environment variables, NEVER in code

```typescript
// .env.local (gitignored)
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
```

### Webhook Security

Always verify Slack request signatures:

```typescript
import crypto from 'crypto';

export const verifySlackSignature = (
  signature: string,
  timestamp: string,
  body: string,
  signingSecret: string
): boolean => {
  const baseString = `v0:${timestamp}:${body}`;
  const hash = crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');
  const expectedSignature = `v0=${hash}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};
```

---

## Database (if applicable)

If using a database (Prisma recommended):

```typescript
// lib/db/index.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
```

---

## Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- path/to/file.test.ts
```

---

## Development Commands

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Type check
npm run type-check

# Lint
npm run lint

# Build for production
npm run build

# Start production server
npm start
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (xoxb-*) | Yes |
| `SLACK_SIGNING_SECRET` | Webhook signature verification | Yes |
| `SLACK_CLIENT_ID` | OAuth client ID | If using OAuth |
| `SLACK_CLIENT_SECRET` | OAuth client secret | If using OAuth |
| `DATABASE_URL` | Database connection string | If using DB |
| `NEXTAUTH_SECRET` | NextAuth.js secret | If using auth |
| `NEXTAUTH_URL` | App URL for auth callbacks | If using auth |

---

## Security Checklist

- [ ] Verify all Slack webhook signatures
- [ ] Validate all input with Zod schemas
- [ ] Use parameterized queries (Prisma handles this)
- [ ] No sensitive data in URLs or logs
- [ ] HTTPS only in production
- [ ] Rate limit API endpoints
- [ ] Sanitize user-generated content

---

## Deployment

### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

Set environment variables in Vercel dashboard.

### Docker (Alternative)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

---

## Quick Reference

```
Before you commit, ask yourself:
□ Does it work?
□ Is it typed? (No `any`)
□ Is it secure? (No secrets, validated input)
□ Is it DRY? (No copy-paste)
□ Is it readable? (Would you understand it in 6 months?)
□ Did you run the linter?
□ Would you be proud to show this in a code review?
□  MOST IMPORTANTLY: WITHOUT A MISS EVER? does it meet the GOA PROTOCOL in the Engineering standards doc?
```

---

## Resources

- [Next.js 14 Docs](https://nextjs.org/docs)
- [Slack API Docs](https://api.slack.com/docs)
- [Slack Bolt JS](https://slack.dev/bolt-js)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Zod Validation](https://zod.dev)
