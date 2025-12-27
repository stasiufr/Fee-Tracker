"use client";

import { useState, useEffect } from "react";
import {
  BADGE_TIERS,
  getBadgeStatsOrder,
  type BadgeTier,
} from "@/lib/badges";
import { cn } from "@/lib/utils";

interface BadgeStats {
  tier: BadgeTier;
  count: number;
}

interface Token {
  id: number;
  mint: string;
  name: string | null;
  symbol: string | null;
  burnPercentage: number;
  badgeTier: string | null;
}

export default function BadgesPage() {
  const [stats, setStats] = useState<BadgeStats[]>([]);
  const [selectedTier, setSelectedTier] = useState<BadgeTier | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch token counts by badge tier
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/tokens?limit=1000");
        const data = await response.json();

        if (data.success) {
          // Count tokens by badge tier
          const counts: Record<BadgeTier, number> = {
            fire: 0,
            coffee: 0,
            good: 0,
            nervous: 0,
            exiting: 0,
            arsonist: 0,
          };

          for (const token of data.data.tokens) {
            const tier = (token.badgeTier as BadgeTier) || "arsonist";
            if (counts[tier] !== undefined) {
              counts[tier]++;
            }
          }

          const statsArray = getBadgeStatsOrder().map((tier) => ({
            tier,
            count: counts[tier],
          }));

          setStats(statsArray);
        }
      } catch (err) {
        console.error("Failed to fetch stats:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  // Fetch tokens for selected tier
  useEffect(() => {
    if (!selectedTier) {
      setTokens([]);
      return;
    }

    const fetchTokens = async () => {
      try {
        const response = await fetch("/api/tokens?limit=100");
        const data = await response.json();

        if (data.success) {
          const filtered = data.data.tokens.filter(
            (t: Token) => t.badgeTier === selectedTier
          );
          setTokens(filtered);
        }
      } catch (err) {
        console.error("Failed to fetch tokens:", err);
      }
    };

    fetchTokens();
  }, [selectedTier]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white flex items-center justify-center gap-3">
          <span>🎖️</span>
          Badge Gallery
        </h1>
        <p className="text-zinc-400 mt-2 max-w-xl mx-auto">
          &quot;This is Fine&quot; Badge Collection — Creators earn badges based on their
          fee burning commitment. From diamond hands to paper hands.
        </p>
      </div>

      {/* Badge Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
        {stats.map(({ tier, count }) => {
          const badge = BADGE_TIERS[tier];
          const isSelected = selectedTier === tier;

          return (
            <button
              key={tier}
              onClick={() => setSelectedTier(isSelected ? null : tier)}
              className={cn(
                "bg-surface-secondary rounded-xl p-6 border transition-all hover:scale-105",
                isSelected
                  ? "border-2"
                  : "border-zinc-800 hover:border-zinc-700"
              )}
              style={{
                borderColor: isSelected ? badge.color : undefined,
                boxShadow: isSelected ? `0 0 20px ${badge.color}40` : undefined,
              }}
            >
              <div className="text-5xl mb-3 animate-pulse-slow">{badge.emoji}</div>
              <div
                className="font-bold text-lg mb-1"
                style={{ color: badge.color }}
              >
                {badge.name.toUpperCase()}
              </div>
              <div className="text-sm text-zinc-500 mb-3">
                {badge.minBurn}% - {badge.maxBurn === 100 ? "100" : badge.maxBurn}%
              </div>
              <div className="text-2xl font-bold text-white">
                {loading ? "..." : count}
              </div>
              <div className="text-xs text-zinc-500">tokens</div>
            </button>
          );
        })}
      </div>

      {/* Badge Details */}
      {selectedTier && (
        <div
          className="bg-surface-secondary rounded-xl border p-8 mb-8"
          style={{ borderColor: BADGE_TIERS[selectedTier].color }}
        >
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Badge Visual */}
            <div className="text-center">
              <div className="text-8xl mb-4 animate-fire-flicker">
                {BADGE_TIERS[selectedTier].emoji}
              </div>
              <div
                className="text-2xl font-bold"
                style={{ color: BADGE_TIERS[selectedTier].color }}
              >
                {BADGE_TIERS[selectedTier].name}
              </div>
            </div>

            {/* Badge Info */}
            <div className="flex-1 text-center md:text-left">
              <blockquote className="text-2xl text-zinc-300 italic mb-4">
                &quot;{BADGE_TIERS[selectedTier].quote}&quot;
              </blockquote>
              <div className="text-zinc-500">
                Awarded to creators who burn{" "}
                <span className="text-white font-bold">
                  {BADGE_TIERS[selectedTier].minBurn}% -{" "}
                  {BADGE_TIERS[selectedTier].maxBurn}%
                </span>{" "}
                of their collected fees.
              </div>
            </div>
          </div>

          {/* Tokens with this badge */}
          {tokens.length > 0 && (
            <div className="mt-8 pt-8 border-t border-zinc-800">
              <h3 className="font-semibold text-white mb-4">
                Tokens with this badge ({tokens.length})
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {tokens.slice(0, 12).map((token) => (
                  <a
                    key={token.id}
                    href={`/token/${token.mint}`}
                    className="bg-surface-tertiary rounded-lg p-3 hover:bg-zinc-700 transition-colors text-center"
                  >
                    <div className="font-medium text-white text-sm truncate">
                      {token.symbol || token.name || "Unknown"}
                    </div>
                    <div
                      className="text-xs font-bold mt-1"
                      style={{ color: BADGE_TIERS[selectedTier].color }}
                    >
                      {token.burnPercentage.toFixed(1)}%
                    </div>
                  </a>
                ))}
              </div>
              {tokens.length > 12 && (
                <a
                  href={`/leaderboard?filter=${selectedTier === "arsonist" || selectedTier === "exiting" || selectedTier === "nervous" ? "extractors" : "burners"}`}
                  className="inline-block mt-4 text-sm text-fire-400 hover:text-fire-300"
                >
                  View all {tokens.length} tokens →
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Info Section */}
      <div className="bg-surface-secondary rounded-xl border border-zinc-800 p-8">
        <h2 className="text-xl font-bold text-white mb-6 text-center">
          How Badges Work
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
              <span>🔥</span> Burn Rate
            </h3>
            <p className="text-zinc-400 text-sm">
              Your badge tier is determined by the percentage of collected fees
              that you burn. Burning fees = buying and burning your own token,
              which benefits holders.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
              <span>📊</span> Real-time Tracking
            </h3>
            <p className="text-zinc-400 text-sm">
              Badge tiers update automatically as new transactions are indexed.
              Every fee collection, withdrawal, and burn is tracked on-chain.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
              <span>🏆</span> Reputation
            </h3>
            <p className="text-zinc-400 text-sm">
              Higher burn rates = better reputation. &quot;Room on Fire&quot; creators
              demonstrate maximum alignment with their community.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
              <span>🐕</span> &quot;This is Fine&quot;
            </h3>
            <p className="text-zinc-400 text-sm">
              Inspired by the famous meme — diamond hands who stay calm in chaos.
              The dog represents creators who burn fees instead of extracting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
