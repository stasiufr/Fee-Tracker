# CLAUDE.md — Pump.fun Fee Tracker

## Project Overview

This is a real-time transparency dashboard tracking creator fee flows across the pump.fun ecosystem. Built for Creator Capital Markets (CCM).

**Stack:** Next.js 14 (App Router), Tailwind CSS, Supabase (Postgres), Helius API

**Theme:** "This is Fine" meme — the dog in burning room represents diamond hands

---

## Commands

### Development
```bash
npm run dev          # Start dev server on localhost:3000
npm run build        # Production build
npm run lint         # ESLint check
npm run db:migrate   # Run Supabase migrations
npm run db:generate  # Generate Prisma client
npm run index        # Run indexer manually (fetches new data)
```

### Testing
```bash
npm run test         # Run all tests
npm run test:class   # Test classification logic only
```

---

## Architecture
```
app/                    → Next.js App Router pages
├── api/                → API routes (serverless functions)
├── token/[mint]/       → Token detail page
├── leaderboard/        → Rankings page
└── badges/             → Badge gallery

components/             → React components
├── ui/                 → Base UI (buttons, cards, etc.)
└── [feature].tsx       → Feature components

lib/                    → Core logic
├── helius.ts           → Helius API client
├── classifier.ts       → Fee event classification
├── badges.ts           → Badge tier calculation
├── db.ts               → Database queries (Prisma)
└── utils.ts            → Helpers

workers/                → Background jobs
└── indexer.ts          → Polls and indexes new tokens

prisma/                 → Database
├── schema.prisma       → Schema definition
└── migrations/         → Migration files
```

---

## Key Concepts

### Fee Classification

Every transaction from a creator vault is one of:
- **collect**: Fees entering vault from pump.fun trades
- **withdraw**: SOL leaving vault to creator wallet (extraction)
- **burn**: SOL leaving vault → swap → token burn (aligned)

Classification logic lives in `lib/classifier.ts`.

### Badge Tiers

Based on burn percentage:
| Tier | Burn % | Emoji | Name |
|------|--------|-------|------|
| S | 95%+ | 🔥 | Room on Fire |
| A | 80-95% | ☕ | Coffee Sipper |
| B | 50-80% | 🐕 | Good Boy |
| C | 20-50% | 😰 | Nervous |
| D | 1-20% | 🚪 | Exiting |
| F | 0% | 💀 | Arsonist |

Logic in `lib/badges.ts`.

---

## Database

Using Supabase (Postgres) with Prisma ORM.

**Main tables:**
- `tokens` — Token metadata + aggregated stats
- `fee_events` — Individual fee transactions
- `creators` — Creator wallet profiles

Always use Prisma client from `lib/db.ts`, never raw SQL.

---

## External APIs

### Helius (SDK v2 Hybrid Approach)
- **DAS API** (token metadata): `helius.getAsset()` via helius-sdk v2
- **RPC** (signatures, balances): `@solana/web3.js Connection`
- **Parse Transactions**: Direct REST API to `/v0/transactions/`
- Client: `lib/helius.ts`
- Docs: https://docs.helius.dev/

```typescript
// Hybrid setup in lib/helius.ts
import { Connection } from "@solana/web3.js";
const { createHelius } = require("helius-sdk");

export const helius = createHelius({ apiKey, network: "mainnet" });
export const connection = new Connection(rpcUrl, "confirmed");
```

### Solana RPC
- Used for: Mint info, account data, transaction signatures
- Via Helius RPC endpoint (`https://mainnet.helius-rpc.com`)

**Rate limits:** Be mindful. Use caching. Batch requests when possible.

---

## Code Style

- TypeScript strict mode
- Functional components with hooks
- TanStack Query for data fetching
- Tailwind for styling (no CSS files)
- Named exports preferred
- Error boundaries on pages

### Naming
- Components: PascalCase (`TokenCard.tsx`)
- Utilities: camelCase (`formatSol.ts`)
- Constants: SCREAMING_SNAKE (`PUMP_PROGRAM_ID`)
- Database fields: snake_case (`burn_percentage`)

---

## Environment Variables

Required in `.env.local`:
```
HELIUS_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
```

Never commit secrets. Use Vercel env vars for production.

---

## Testing Data

Primary test token (graduated to DEX):
```
$ARC (AI Rig Complex)
Mint: 61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump
Vault PDA: 4NQ4yGprSPCqvRJmMNV7rnJ81BUcCrgPEq4TVQ1FthYi
Creator Authority: TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM
Status: Trading on Meteora/Jupiter (graduated from pump.fun)
Website: https://www.arc.fun/
```

**Note:** This token has graduated from pump.fun to DEX trading. The vault PDA has no transactions because pump.fun's current fee structure sends fees directly to creator wallets, not to vault PDAs.

Use `scripts/index-arc-simple.ts` to index swap activity.

---

## Common Tasks

### Add a new badge tier
1. Update `lib/badges.ts` with new threshold
2. Add emoji/name to `BADGE_TIERS` constant
3. Update Badge component visuals
4. Run `npm run index` to recalculate

### Debug classification
1. Find transaction signature
2. Run: `npx tsx scripts/debug-tx.ts <signature>`
3. Check parsed instructions output

### Add new token manually
1. Run: `npx tsx -r dotenv/config workers/indexer.ts <mint>`
2. Indexer will fetch history automatically

### Index ARC token activity
1. Run: `npx tsx scripts/index-arc-simple.ts`
2. Check: `npx tsx scripts/check-db-events.ts`

---

## Performance Notes

- Homepage stats are cached 60s (revalidate)
- Token pages use ISR (regenerate on demand)
- Leaderboard queries have indexes on `burn_percentage`
- Use `unstable_cache` for expensive aggregations

---

## Deployment

Hosted on Vercel. Auto-deploys from `main` branch.

- Preview: PR branches get preview URLs
- Production: Merge to `main`
- Cron: `/api/sync` runs every 5 minutes via Vercel Cron

---

## TODOs / Known Issues

- [ ] Classification misses some Jupiter v6 routes
- [ ] Need to handle Token-2022 burns differently
- [ ] Mobile nav needs work
- [ ] Add creator profile pages
- [x] Helius SDK upgraded to v2 (hybrid approach with @solana/web3.js)
- [ ] Pump.fun vault PDA approach needs review - fees now go directly to creator wallets
- [ ] Consider tracking DEX swap fees for graduated tokens

---

## Contact

Project lead: Stanislaz (Jean Terre)
Context: ARC Burn Engine / Creator Capital Markets