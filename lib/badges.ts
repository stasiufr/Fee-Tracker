/**
 * Badge Tier System
 * "This is Fine" themed badges based on burn percentage
 */

export type BadgeTier = "fire" | "coffee" | "good" | "nervous" | "exiting" | "arsonist";

export interface BadgeInfo {
  tier: BadgeTier;
  name: string;
  emoji: string;
  quote: string;
  minBurn: number;
  maxBurn: number;
  color: string;
  bgColor: string;
}

// Badge tiers from best (most burns) to worst (most extraction)
export const BADGE_TIERS: Record<BadgeTier, BadgeInfo> = {
  fire: {
    tier: "fire",
    name: "Room on Fire",
    emoji: "🔥",
    quote: "This is fine. Everything is fine.",
    minBurn: 95,
    maxBurn: 100,
    color: "#ef4444",
    bgColor: "rgba(239, 68, 68, 0.1)",
  },
  coffee: {
    tier: "coffee",
    name: "Coffee Sipper",
    emoji: "☕",
    quote: "I'm okay with the events unfolding.",
    minBurn: 80,
    maxBurn: 95,
    color: "#f59e0b",
    bgColor: "rgba(245, 158, 11, 0.1)",
  },
  good: {
    tier: "good",
    name: "Good Boy",
    emoji: "🐕",
    quote: "Things are going well.",
    minBurn: 50,
    maxBurn: 80,
    color: "#22c55e",
    bgColor: "rgba(34, 197, 94, 0.1)",
  },
  nervous: {
    tier: "nervous",
    name: "Nervous",
    emoji: "😰",
    quote: "This is... okay?",
    minBurn: 20,
    maxBurn: 50,
    color: "#eab308",
    bgColor: "rgba(234, 179, 8, 0.1)",
  },
  exiting: {
    tier: "exiting",
    name: "Exiting",
    emoji: "🚪",
    quote: "I should go.",
    minBurn: 1,
    maxBurn: 20,
    color: "#f97316",
    bgColor: "rgba(249, 115, 22, 0.1)",
  },
  arsonist: {
    tier: "arsonist",
    name: "Arsonist",
    emoji: "💀",
    quote: "I started the fire.",
    minBurn: 0,
    maxBurn: 1,
    color: "#6b7280",
    bgColor: "rgba(107, 114, 128, 0.1)",
  },
};

/**
 * Calculate badge tier based on burn percentage
 */
export function calculateBadgeTier(burnPercentage: number): BadgeTier {
  if (burnPercentage >= 95) return "fire";
  if (burnPercentage >= 80) return "coffee";
  if (burnPercentage >= 50) return "good";
  if (burnPercentage >= 20) return "nervous";
  if (burnPercentage >= 1) return "exiting";
  return "arsonist";
}

/**
 * Get badge info for a burn percentage
 */
export function getBadgeInfo(burnPercentage: number): BadgeInfo {
  const tier = calculateBadgeTier(burnPercentage);
  return BADGE_TIERS[tier];
}

/**
 * Calculate burn percentage from fee totals
 */
export function calculateBurnPercentage(
  totalCollected: bigint,
  totalBurned: bigint
): number {
  if (totalCollected === BigInt(0)) return 0;

  // Use integer math then convert to percentage
  const percentage = Number((totalBurned * BigInt(10000)) / totalCollected) / 100;
  return Math.round(percentage * 100) / 100; // Round to 2 decimal places
}

/**
 * Get all badge tiers as array (sorted best to worst)
 */
export function getAllBadgeTiers(): BadgeInfo[] {
  return Object.values(BADGE_TIERS);
}

/**
 * Get badge tier display for UI
 */
export function getBadgeDisplay(tier: BadgeTier): string {
  const info = BADGE_TIERS[tier];
  return `${info.emoji} ${info.name}`;
}

/**
 * Check if a token qualifies for a specific badge tier
 */
export function qualifiesForTier(burnPercentage: number, targetTier: BadgeTier): boolean {
  const info = BADGE_TIERS[targetTier];
  return burnPercentage >= info.minBurn && burnPercentage < info.maxBurn;
}

/**
 * Get tokens count by badge tier (for gallery stats)
 */
export interface BadgeStats {
  tier: BadgeTier;
  count: number;
  info: BadgeInfo;
}

export function getBadgeStatsOrder(): BadgeTier[] {
  return ["fire", "coffee", "good", "nervous", "exiting", "arsonist"];
}
