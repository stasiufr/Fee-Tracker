# Pump.fun Fee Tracker

Real-time transparency dashboard tracking creator fee flows across the pump.fun ecosystem.

**Live:** https://fees.alonisthe.dev

## Quick Start

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Start dev server
npm run dev
```

## Environment Variables

Create `.env.local` with:

```env
# Helius API
HELIUS_API_KEY=your_helius_api_key

# Supabase Database
DATABASE_URL=postgresql://user:pass@host:5432/db?pgbouncer=true
DIRECT_URL=postgresql://user:pass@host:5432/db

# Supabase Client (for future realtime features)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# Cron Auth (for production)
CRON_SECRET=random_secret_string
```

## Deploy to Vercel

1. Push to GitHub
2. Import in Vercel
3. Add environment variables
4. Configure domain: `fees.alonisthe.dev`
5. Deploy

Vercel Cron will auto-run `/api/sync` every 5 minutes.

## Manual Indexing

```bash
# Index default token ($ASDFASDFA)
npm run index

# Index specific token
npm run index 61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump
```

Or via API:
```
GET /api/sync?mints=mint1,mint2,mint3
```

## Project Structure

```
app/
  page.tsx           # Dashboard
  leaderboard/       # Token rankings
  badges/            # Badge gallery
  token/[mint]/      # Token detail
  api/
    stats/           # Global stats
    tokens/          # Token list & detail
    sync/            # Indexer trigger (cron)

lib/
  helius.ts          # Helius API client
  classifier.ts      # Fee classification logic
  badges.ts          # Badge tier system
  db.ts              # Prisma queries
  utils.ts           # Helpers

workers/
  indexer.ts         # CLI indexer script
```

## Badge Tiers

| Tier | Burn % | Badge |
|------|--------|-------|
| 🔥 | 95%+ | Room on Fire |
| ☕ | 80-95% | Coffee Sipper |
| 🐕 | 50-80% | Good Boy |
| 😰 | 20-50% | Nervous |
| 🚪 | 1-20% | Exiting |
| 💀 | 0% | Arsonist |

## Tech Stack

- Next.js 14 (App Router)
- Tailwind CSS
- Prisma + Supabase (PostgreSQL)
- Helius API
- Vercel

---

Built by [alonisthe.dev](https://alonisthe.dev) for Creator Capital Markets (CCM)
