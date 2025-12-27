import { BADGE_TIERS, BadgeTier } from "@/lib/badges";
import { formatSol, formatPercentage } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

interface StatsData {
  totalTokensTracked: number;
  totalFeesCollected: string;
  totalFeesBurned: string;
  totalFeesWithdrawn: string;
  globalBurnPercentage: number;
  last24h: {
    feesBurned: string;
    feesWithdrawn: string;
    burnPercentage: number;
  };
}

interface TokenData {
  mint: string;
  symbol: string;
  name: string;
  burnPercentage: number;
  totalFeesBurned: string;
  totalFeesWithdrawn: string;
  badgeTier: BadgeTier | null;
}

async function getStats(): Promise<StatsData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/stats`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

async function getTopTokens(filter: "burners" | "extractors", limit = 3): Promise<TokenData[]> {
  try {
    const sort = filter === "burners" ? "totalFeesBurned" : "totalFeesWithdrawn";
    const res = await fetch(
      `${API_BASE}/api/tokens?sort=${sort}&order=desc&limit=${limit}&filter=${filter}`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return json.data?.tokens || [];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [stats, topBurners, topExtractors] = await Promise.all([
    getStats(),
    getTopTokens("burners"),
    getTopTokens("extractors"),
  ]);

  const burnedToday = BigInt(stats?.last24h?.feesBurned || "0");
  const extractedToday = BigInt(stats?.last24h?.feesWithdrawn || "0");
  const burnPercentage = stats?.globalBurnPercentage || 0;
  const totalTokens = stats?.totalTokensTracked || 0;

  // Find featured token (highest burner)
  const featuredToken = topBurners[0];
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {/* Burned Today */}
        <div className="bg-surface-secondary rounded-xl p-6 border border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-zinc-300">BURNED TODAY</h2>
            <span className="text-3xl">🔥</span>
          </div>
          <div className="text-4xl font-bold text-burn mb-3">
            {formatSol(burnedToday)} SOL
          </div>
          <div className="w-full bg-zinc-700 rounded-full h-3 mb-2">
            <div
              className="bg-gradient-to-r from-fire-500 to-burn h-3 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(burnPercentage, 100)}%` }}
            />
          </div>
          <div className="text-sm text-zinc-400">
            {formatPercentage(burnPercentage)} of fees burned • {totalTokens} tokens tracked
          </div>
        </div>

        {/* Extracted Today */}
        <div className="bg-surface-secondary rounded-xl p-6 border border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-zinc-300">EXTRACTED TODAY</h2>
            <span className="text-3xl">💀</span>
          </div>
          <div className="text-4xl font-bold text-extract mb-3">
            {formatSol(extractedToday)} SOL
          </div>
          <div className="w-full bg-zinc-700 rounded-full h-3 mb-2">
            <div
              className="bg-gradient-to-r from-zinc-500 to-extract h-3 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100 - burnPercentage, 100)}%` }}
            />
          </div>
          <div className="text-sm text-zinc-400">
            {formatPercentage(Math.max(0, 100 - burnPercentage))} of fees extracted
          </div>
        </div>
      </div>

      {/* Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Burners */}
        <div className="bg-surface-secondary rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🏆</span>
              <h3 className="font-semibold text-white">TOP BURNERS (24h)</h3>
            </div>
            <a
              href="/leaderboard?filter=burners"
              className="text-sm text-fire-400 hover:text-fire-300 transition-colors"
            >
              View All →
            </a>
          </div>
          <div className="divide-y divide-zinc-800">
            {topBurners.length === 0 ? (
              <div className="px-6 py-8 text-center text-zinc-500">
                No tokens tracked yet. Index some tokens to see data.
              </div>
            ) : (
              topBurners.map((token) => {
                const tier = (token.badgeTier as BadgeTier) || "arsonist";
                return (
                  <a
                    key={token.mint}
                    href={`/token/${token.mint}`}
                    className="flex items-center justify-between px-6 py-4 hover:bg-surface-tertiary transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-2xl">{BADGE_TIERS[tier].emoji}</span>
                      <div>
                        <div className="font-medium text-white">${token.symbol}</div>
                        <div className="text-sm text-zinc-500">
                          {BADGE_TIERS[tier].name}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-white">
                        {formatSol(BigInt(token.totalFeesBurned))} SOL
                      </div>
                      <div
                        className="text-sm font-medium"
                        style={{ color: BADGE_TIERS[tier].color }}
                      >
                        {formatPercentage(token.burnPercentage)}
                      </div>
                    </div>
                  </a>
                );
              })
            )}
          </div>
        </div>

        {/* Top Extractors */}
        <div className="bg-surface-secondary rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">💀</span>
              <h3 className="font-semibold text-white">TOP EXTRACTORS (24h)</h3>
            </div>
            <a
              href="/leaderboard?filter=extractors"
              className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              View All →
            </a>
          </div>
          <div className="divide-y divide-zinc-800">
            {topExtractors.length === 0 ? (
              <div className="px-6 py-8 text-center text-zinc-500">
                No extractors found. Good news!
              </div>
            ) : (
              topExtractors.map((token) => {
                const tier = (token.badgeTier as BadgeTier) || "arsonist";
                return (
                  <a
                    key={token.mint}
                    href={`/token/${token.mint}`}
                    className="flex items-center justify-between px-6 py-4 hover:bg-surface-tertiary transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-2xl">{BADGE_TIERS[tier].emoji}</span>
                      <div>
                        <div className="font-medium text-white">${token.symbol}</div>
                        <div className="text-sm text-zinc-500">
                          {BADGE_TIERS[tier].name}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-white">
                        {formatSol(BigInt(token.totalFeesWithdrawn))} SOL
                      </div>
                      <div
                        className="text-sm font-medium"
                        style={{ color: BADGE_TIERS[tier].color }}
                      >
                        {formatPercentage(token.burnPercentage)}
                      </div>
                    </div>
                  </a>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Featured Token Banner */}
      {featuredToken && (
        <div className="mt-10 bg-gradient-to-r from-fire-900/30 to-surface-secondary rounded-xl border border-fire-800/50 p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="text-5xl animate-fire-flicker">🔥🐕🔥</div>
              <div>
                <div className="text-sm text-fire-400 font-medium mb-1">
                  FEATURED: {BADGE_TIERS[(featuredToken.badgeTier as BadgeTier) || "fire"].name.toUpperCase()}
                </div>
                <h3 className="text-2xl font-bold text-white">${featuredToken.symbol}</h3>
                <p className="text-zinc-400 mt-1">
                  &quot;{BADGE_TIERS[(featuredToken.badgeTier as BadgeTier) || "fire"].quote}&quot;
                </p>
              </div>
            </div>
            <div className="flex items-center gap-8">
              <div className="text-center">
                <div className="text-3xl font-bold text-burn">{formatPercentage(featuredToken.burnPercentage)}</div>
                <div className="text-sm text-zinc-500">Burn Rate</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-white">{formatSol(BigInt(featuredToken.totalFeesBurned))}</div>
                <div className="text-sm text-zinc-500">SOL Burned</div>
              </div>
              <a
                href={`/token/${featuredToken.mint}`}
                className="bg-fire-500 hover:bg-fire-600 text-white font-medium px-6 py-3 rounded-lg transition-colors"
              >
                View Token →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-secondary rounded-xl p-6 border border-zinc-800">
          <div className="text-3xl mb-3">🔍</div>
          <h4 className="font-semibold text-white mb-2">Transparent Tracking</h4>
          <p className="text-sm text-zinc-400">
            Every fee transaction is tracked on-chain. See exactly where creator fees go
            - burned or extracted.
          </p>
        </div>
        <div className="bg-surface-secondary rounded-xl p-6 border border-zinc-800">
          <div className="text-3xl mb-3">🎖️</div>
          <h4 className="font-semibold text-white mb-2">Badge System</h4>
          <p className="text-sm text-zinc-400">
            Creators earn badges based on their burn rate. From &quot;Room on Fire&quot;
            to &quot;Arsonist&quot; - reputation is on-chain.
          </p>
        </div>
        <div className="bg-surface-secondary rounded-xl p-6 border border-zinc-800">
          <div className="text-3xl mb-3">⚡</div>
          <h4 className="font-semibold text-white mb-2">Real-time Updates</h4>
          <p className="text-sm text-zinc-400">
            Data updates in real-time via Helius webhooks. No delays, no hidden
            transactions.
          </p>
        </div>
      </div>
    </div>
  );
}
