/**
 * Utility Functions
 * Helpers for formatting, calculations, and common operations
 */

// Lamports per SOL
const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: bigint | number): number {
  const value = typeof lamports === "bigint" ? Number(lamports) : lamports;
  return value / LAMPORTS_PER_SOL;
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * LAMPORTS_PER_SOL));
}

/**
 * Format SOL amount with appropriate precision
 */
export function formatSol(lamports: bigint | number, decimals = 2): string {
  const sol = lamportsToSol(lamports);

  if (sol >= 1_000_000) {
    return `${(sol / 1_000_000).toFixed(decimals)}M`;
  }
  if (sol >= 1_000) {
    return `${(sol / 1_000).toFixed(decimals)}K`;
  }
  return sol.toFixed(decimals);
}

/**
 * Format USD value
 */
export function formatUsd(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(2)}K`;
  }
  return `$${amount.toFixed(2)}`;
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Shorten Solana address for display
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString();
}

/**
 * Format date for display
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Get Solscan URL for a transaction
 */
export function getSolscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

/**
 * Get Solscan URL for a token
 */
export function getSolscanTokenUrl(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}

/**
 * Get Solscan URL for an address
 */
export function getSolscanAddressUrl(address: string): string {
  return `https://solscan.io/account/${address}`;
}

/**
 * Generate Pump.fun URL for a token
 */
export function getPumpFunUrl(mint: string): string {
  return `https://pump.fun/${mint}`;
}

/**
 * Validate Solana address format
 */
export function isValidSolanaAddress(address: string): boolean {
  // Base58 characters, 32-44 characters long
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Sleep utility for rate limiting
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chunk array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Calculate timeframe date from string
 */
export function getTimeframeDate(timeframe: "24h" | "7d" | "30d" | "all"): Date | null {
  const now = new Date();

  switch (timeframe) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "all":
      return null;
    default:
      return null;
  }
}

/**
 * Class names utility (like clsx/classnames)
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}
