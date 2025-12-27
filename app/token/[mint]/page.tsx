import Link from "next/link";
import { getBadgeInfo } from "@/lib/badges";
import {
  formatSol,
  formatPercentage,
  formatRelativeTime,
  shortenAddress,
  getSolscanTxUrl,
  getSolscanTokenUrl,
  getPumpFunUrl,
} from "@/lib/utils";
import { notFound } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

interface TokenData {
  id: number;
  mint: string;
  name: string;
  symbol: string;
  creatorWallet: string;
  creatorVault: string;
  imageUri: string | null;
  totalFeesCollected: string;
  totalFeesBurned: string;
  totalFeesWithdrawn: string;
  totalFeesHeld: string;
  burnPercentage: number;
  badgeTier: string | null;
  createdAt: string;
  updatedAt: string;
  recentEvents: EventData[];
}

interface EventData {
  id: number;
  eventType: "collect" | "burn" | "withdraw";
  amountLamports: string;
  signature: string;
  blockTime: string;
  burnedTokenMint: string | null;
}

async function getToken(mint: string): Promise<TokenData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/tokens/${mint}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

const eventIcons = {
  collect: "📥",
  burn: "🔥",
  withdraw: "💸",
};

const eventColors = {
  collect: "text-blue-400",
  burn: "text-red-400",
  withdraw: "text-zinc-400",
};

interface PageProps {
  params: Promise<{ mint: string }>;
}

export default async function TokenPage({ params }: PageProps) {
  const { mint } = await params;
  const token = await getToken(mint);

  if (!token) {
    notFound();
  }

  const events = token.recentEvents || [];
  const badge = getBadgeInfo(token.burnPercentage);

  // Calculate percentages for pie chart visualization
  const totalCollected = Number(BigInt(token.totalFeesCollected));
  const burnedPct =
    totalCollected > 0
      ? (Number(BigInt(token.totalFeesBurned)) / totalCollected) * 100
      : 0;
  const withdrawnPct =
    totalCollected > 0
      ? (Number(BigInt(token.totalFeesWithdrawn)) / totalCollected) * 100
      : 0;
  const heldPct =
    totalCollected > 0
      ? (Number(BigInt(token.totalFeesHeld)) / totalCollected) * 100
      : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-zinc-400 hover:text-white mb-6 transition-colors"
      >
        ← Back to Dashboard
      </Link>

      {/* Header */}
      <div className="bg-surface-secondary rounded-xl border border-zinc-800 p-6 mb-6">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
          {/* Badge */}
          <div
            className="p-4 rounded-xl text-center"
            style={{ backgroundColor: badge.bgColor }}
          >
            <div className="text-5xl mb-2">{badge.emoji}🐕{badge.emoji}</div>
            <div
              className="text-sm font-bold uppercase"
              style={{ color: badge.color }}
            >
              {badge.name}
            </div>
          </div>

          {/* Token Info */}
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-white mb-2">${token.symbol}</h1>
            <p className="text-zinc-400 text-sm mb-1">{token.name}</p>
            <p className="text-zinc-400 italic mb-3">&quot;{badge.quote}&quot;</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-zinc-500">Creator:</span>{" "}
                <a
                  href={`https://solscan.io/account/${token.creatorWallet}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fire-400 hover:underline"
                >
                  {shortenAddress(token.creatorWallet)}
                </a>
              </div>
              <div>
                <span className="text-zinc-500">Since:</span>{" "}
                <span className="text-white">
                  {new Date(token.createdAt).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* Burn Rate */}
          <div className="text-center">
            <div
              className="text-5xl font-bold"
              style={{ color: badge.color }}
            >
              {formatPercentage(token.burnPercentage)}
            </div>
            <div className="text-zinc-500 text-sm">Burn Rate</div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface-secondary rounded-xl border border-zinc-800 p-4">
          <div className="text-zinc-500 text-sm mb-1">Total Collected</div>
          <div className="text-xl font-bold text-white">
            {formatSol(BigInt(token.totalFeesCollected))} SOL
          </div>
        </div>
        <div className="bg-surface-secondary rounded-xl border border-zinc-800 p-4">
          <div className="text-zinc-500 text-sm mb-1 flex items-center gap-1">
            🔥 Burned
          </div>
          <div className="text-xl font-bold text-burn">
            {formatSol(BigInt(token.totalFeesBurned))} SOL
          </div>
        </div>
        <div className="bg-surface-secondary rounded-xl border border-zinc-800 p-4">
          <div className="text-zinc-500 text-sm mb-1 flex items-center gap-1">
            💸 Withdrawn
          </div>
          <div className="text-xl font-bold text-extract">
            {formatSol(BigInt(token.totalFeesWithdrawn))} SOL
          </div>
        </div>
        <div className="bg-surface-secondary rounded-xl border border-zinc-800 p-4">
          <div className="text-zinc-500 text-sm mb-1 flex items-center gap-1">
            🏦 Held in Vault
          </div>
          <div className="text-xl font-bold text-hold">
            {formatSol(BigInt(token.totalFeesHeld))} SOL
          </div>
        </div>
      </div>

      {/* Distribution Bar */}
      <div className="bg-surface-secondary rounded-xl border border-zinc-800 p-6 mb-6">
        <h3 className="font-semibold text-white mb-4">Fee Distribution</h3>
        <div className="h-8 rounded-lg overflow-hidden flex">
          {burnedPct > 0 && (
            <div
              className="bg-burn flex items-center justify-center text-xs font-medium text-white"
              style={{ width: `${burnedPct}%` }}
            >
              {burnedPct > 10 && `${burnedPct.toFixed(0)}%`}
            </div>
          )}
          {withdrawnPct > 0 && (
            <div
              className="bg-extract flex items-center justify-center text-xs font-medium text-white"
              style={{ width: `${withdrawnPct}%` }}
            >
              {withdrawnPct > 10 && `${withdrawnPct.toFixed(0)}%`}
            </div>
          )}
          {heldPct > 0 && (
            <div
              className="bg-hold flex items-center justify-center text-xs font-medium text-white"
              style={{ width: `${heldPct}%` }}
            >
              {heldPct > 10 && `${heldPct.toFixed(0)}%`}
            </div>
          )}
        </div>
        <div className="flex justify-center gap-6 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-burn" />
            <span className="text-zinc-400">Burned</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-extract" />
            <span className="text-zinc-400">Withdrawn</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-hold" />
            <span className="text-zinc-400">Held</span>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-surface-secondary rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-semibold text-white">Recent Activity</h3>
          <select className="bg-surface-tertiary border border-zinc-700 rounded px-3 py-1 text-sm text-white">
            <option value="all">All Events</option>
            <option value="burn">Burns Only</option>
            <option value="withdraw">Withdrawals Only</option>
            <option value="collect">Collections Only</option>
          </select>
        </div>
        <div className="divide-y divide-zinc-800">
          {events.length === 0 ? (
            <div className="px-6 py-8 text-center text-zinc-500">
              No events recorded yet.
            </div>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between px-6 py-4 hover:bg-surface-tertiary transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-2xl">{eventIcons[event.eventType]}</span>
                  <div>
                    <div className={`font-medium ${eventColors[event.eventType]}`}>
                      {event.eventType.charAt(0).toUpperCase() +
                        event.eventType.slice(1)}
                    </div>
                    <div className="text-sm text-zinc-500">
                      {formatRelativeTime(new Date(event.blockTime))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-mono text-white">
                      {formatSol(BigInt(event.amountLamports))} SOL
                    </div>
                  </div>
                  <a
                    href={getSolscanTxUrl(event.signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-fire-400 transition-colors"
                  >
                    tx ↗
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="px-6 py-4 border-t border-zinc-800 text-center">
          <button className="text-fire-400 hover:text-fire-300 text-sm font-medium">
            Load More
          </button>
        </div>
      </div>

      {/* Action Links */}
      <div className="flex flex-wrap gap-4 mt-6 justify-center">
        <a
          href={getPumpFunUrl(mint)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-surface-secondary border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
        >
          View on Pump.fun ↗
        </a>
        <a
          href={getSolscanTokenUrl(mint)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-surface-secondary border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
        >
          View on Solscan ↗
        </a>
        <button className="inline-flex items-center gap-2 bg-surface-secondary border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors">
          Share 🔗
        </button>
        <button className="inline-flex items-center gap-2 bg-surface-secondary border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors">
          Export CSV 📊
        </button>
      </div>
    </div>
  );
}
