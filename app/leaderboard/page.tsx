"use client";

import { useState, useEffect } from "react";
import { BADGE_TIERS, type BadgeTier } from "@/lib/badges";
import { formatSol, formatPercentage, cn } from "@/lib/utils";

interface Token {
  id: number;
  mint: string;
  name: string | null;
  symbol: string | null;
  creatorWallet: string | null;
  totalFeesCollected: string;
  totalFeesBurned: string;
  totalFeesWithdrawn: string;
  burnPercentage: number;
  badgeTier: string | null;
  updatedAt: string;
}

interface ApiResponse {
  success: boolean;
  data: {
    tokens: Token[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
    };
  };
}

type FilterType = "all" | "burners" | "extractors";
type SortType = "burnPercentage" | "totalFeesBurned" | "totalFeesCollected";
type TimeframeType = "24h" | "7d" | "30d" | "all";

export default function LeaderboardPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("burnPercentage");
  const [timeframe, setTimeframe] = useState<TimeframeType>("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  const fetchTokens = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        sort,
        order: sort === "burnPercentage" ? "desc" : "desc",
        page: page.toString(),
        limit: "20",
      });

      if (filter !== "all") {
        params.set("filter", filter);
      }

      const response = await fetch(`/api/tokens?${params}`);
      const data: ApiResponse = await response.json();

      if (data.success) {
        setTokens(data.data.tokens);
        setHasMore(data.data.pagination.hasMore);
        setTotal(data.data.pagination.total);
      } else {
        setError("Failed to fetch tokens");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sort, timeframe, page]);

  const filterButtons: { value: FilterType; label: string; emoji: string }[] = [
    { value: "all", label: "All Tokens", emoji: "📊" },
    { value: "burners", label: "Burners", emoji: "🔥" },
    { value: "extractors", label: "Extractors", emoji: "💀" },
  ];

  const timeframeButtons: { value: TimeframeType; label: string }[] = [
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" },
    { value: "all", label: "All Time" },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <span>🏆</span>
          Leaderboard
        </h1>
        <p className="text-zinc-400 mt-2">
          Track creators by their fee burning commitment
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Filter Type */}
        <div className="flex gap-2">
          {filterButtons.map((btn) => (
            <button
              key={btn.value}
              onClick={() => {
                setFilter(btn.value);
                setPage(1);
              }}
              className={cn(
                "px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2",
                filter === btn.value
                  ? "bg-fire-500 text-white"
                  : "bg-surface-secondary text-zinc-400 hover:text-white hover:bg-surface-tertiary"
              )}
            >
              <span>{btn.emoji}</span>
              {btn.label}
            </button>
          ))}
        </div>

        {/* Timeframe */}
        <div className="flex gap-2 sm:ml-auto">
          {timeframeButtons.map((btn) => (
            <button
              key={btn.value}
              onClick={() => {
                setTimeframe(btn.value);
                setPage(1);
              }}
              className={cn(
                "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                timeframe === btn.value
                  ? "bg-zinc-700 text-white"
                  : "bg-surface-secondary text-zinc-500 hover:text-white"
              )}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sort Options */}
      <div className="flex gap-4 mb-6 text-sm">
        <span className="text-zinc-500">Sort by:</span>
        <button
          onClick={() => setSort("burnPercentage")}
          className={cn(
            "transition-colors",
            sort === "burnPercentage" ? "text-fire-400" : "text-zinc-400 hover:text-white"
          )}
        >
          Burn %
        </button>
        <button
          onClick={() => setSort("totalFeesBurned")}
          className={cn(
            "transition-colors",
            sort === "totalFeesBurned" ? "text-fire-400" : "text-zinc-400 hover:text-white"
          )}
        >
          Total Burned
        </button>
        <button
          onClick={() => setSort("totalFeesCollected")}
          className={cn(
            "transition-colors",
            sort === "totalFeesCollected" ? "text-fire-400" : "text-zinc-400 hover:text-white"
          )}
        >
          Total Collected
        </button>
      </div>

      {/* Results Count */}
      <div className="text-sm text-zinc-500 mb-4">
        {total} tokens found
      </div>

      {/* Table */}
      <div className="bg-surface-secondary rounded-xl border border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-zinc-800 text-sm font-medium text-zinc-500">
          <div className="col-span-1">Rank</div>
          <div className="col-span-4">Token</div>
          <div className="col-span-2">Badge</div>
          <div className="col-span-2 text-right">Burned</div>
          <div className="col-span-2 text-right">Collected</div>
          <div className="col-span-1 text-right">Burn %</div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="px-6 py-12 text-center text-zinc-500">
            Loading...
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="px-6 py-12 text-center text-red-400">
            {error}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && tokens.length === 0 && (
          <div className="px-6 py-12 text-center text-zinc-500">
            No tokens found
          </div>
        )}

        {/* Token Rows */}
        {!loading && !error && tokens.map((token, idx) => {
          const rank = (page - 1) * 20 + idx + 1;
          const badgeTier = (token.badgeTier as BadgeTier) || "arsonist";
          const badge = BADGE_TIERS[badgeTier] || BADGE_TIERS.arsonist;

          return (
            <a
              key={token.id}
              href={`/token/${token.mint}`}
              className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-zinc-800 hover:bg-surface-tertiary transition-colors items-center"
            >
              {/* Rank */}
              <div className="col-span-1">
                <span
                  className={cn(
                    "font-bold",
                    rank === 1 && "text-yellow-400",
                    rank === 2 && "text-zinc-300",
                    rank === 3 && "text-amber-600",
                    rank > 3 && "text-zinc-500"
                  )}
                >
                  #{rank}
                </span>
              </div>

              {/* Token */}
              <div className="col-span-4 flex items-center gap-3">
                <span className="text-2xl">{badge.emoji}</span>
                <div>
                  <div className="font-medium text-white">
                    {token.symbol || token.name || "Unknown"}
                  </div>
                  <div className="text-xs text-zinc-500 font-mono">
                    {token.mint.slice(0, 8)}...
                  </div>
                </div>
              </div>

              {/* Badge */}
              <div className="col-span-2">
                <span
                  className="px-2 py-1 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: badge.bgColor,
                    color: badge.color,
                  }}
                >
                  {badge.name}
                </span>
              </div>

              {/* Burned */}
              <div className="col-span-2 text-right font-mono text-burn">
                {formatSol(BigInt(token.totalFeesBurned))} SOL
              </div>

              {/* Collected */}
              <div className="col-span-2 text-right font-mono text-zinc-400">
                {formatSol(BigInt(token.totalFeesCollected))} SOL
              </div>

              {/* Burn % */}
              <div
                className="col-span-1 text-right font-bold"
                style={{ color: badge.color }}
              >
                {formatPercentage(token.burnPercentage)}
              </div>
            </a>
          );
        })}
      </div>

      {/* Pagination */}
      {!loading && tokens.length > 0 && (
        <div className="flex justify-center gap-4 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className={cn(
              "px-4 py-2 rounded-lg font-medium transition-colors",
              page === 1
                ? "bg-surface-secondary text-zinc-600 cursor-not-allowed"
                : "bg-surface-secondary text-zinc-300 hover:bg-surface-tertiary"
            )}
          >
            ← Previous
          </button>
          <span className="px-4 py-2 text-zinc-400">
            Page {page}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className={cn(
              "px-4 py-2 rounded-lg font-medium transition-colors",
              !hasMore
                ? "bg-surface-secondary text-zinc-600 cursor-not-allowed"
                : "bg-surface-secondary text-zinc-300 hover:bg-surface-tertiary"
            )}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
