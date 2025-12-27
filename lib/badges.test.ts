import { describe, it, expect } from "vitest";
import {
  calculateBadgeTier,
  calculateBurnPercentage,
  getBadgeInfo,
  BADGE_TIERS,
} from "./badges";

describe("calculateBadgeTier", () => {
  it("returns 'fire' for 95%+ burn rate", () => {
    expect(calculateBadgeTier(95)).toBe("fire");
    expect(calculateBadgeTier(99.9)).toBe("fire");
    expect(calculateBadgeTier(100)).toBe("fire");
  });

  it("returns 'coffee' for 80-95% burn rate", () => {
    expect(calculateBadgeTier(80)).toBe("coffee");
    expect(calculateBadgeTier(90)).toBe("coffee");
    expect(calculateBadgeTier(94.9)).toBe("coffee");
  });

  it("returns 'good' for 50-80% burn rate", () => {
    expect(calculateBadgeTier(50)).toBe("good");
    expect(calculateBadgeTier(65)).toBe("good");
    expect(calculateBadgeTier(79.9)).toBe("good");
  });

  it("returns 'nervous' for 20-50% burn rate", () => {
    expect(calculateBadgeTier(20)).toBe("nervous");
    expect(calculateBadgeTier(35)).toBe("nervous");
    expect(calculateBadgeTier(49.9)).toBe("nervous");
  });

  it("returns 'exiting' for 1-20% burn rate", () => {
    expect(calculateBadgeTier(1)).toBe("exiting");
    expect(calculateBadgeTier(10)).toBe("exiting");
    expect(calculateBadgeTier(19.9)).toBe("exiting");
  });

  it("returns 'arsonist' for 0% burn rate", () => {
    expect(calculateBadgeTier(0)).toBe("arsonist");
    expect(calculateBadgeTier(0.5)).toBe("arsonist");
  });
});

describe("calculateBurnPercentage", () => {
  it("returns 0 when no fees collected", () => {
    expect(calculateBurnPercentage(BigInt(0), BigInt(0))).toBe(0);
    expect(calculateBurnPercentage(BigInt(0), BigInt(100))).toBe(0);
  });

  it("calculates correct percentage", () => {
    expect(calculateBurnPercentage(BigInt(100), BigInt(50))).toBe(50);
    expect(calculateBurnPercentage(BigInt(1000), BigInt(999))).toBe(99.9);
    expect(calculateBurnPercentage(BigInt(100), BigInt(100))).toBe(100);
  });

  it("handles large numbers (lamports)", () => {
    const collected = BigInt("100000000000"); // 100 SOL
    const burned = BigInt("95000000000"); // 95 SOL
    expect(calculateBurnPercentage(collected, burned)).toBe(95);
  });
});

describe("getBadgeInfo", () => {
  it("returns correct badge info for fire tier", () => {
    const info = getBadgeInfo(99);
    expect(info.tier).toBe("fire");
    expect(info.emoji).toBe("🔥");
    expect(info.name).toBe("Room on Fire");
  });

  it("returns correct badge info for arsonist tier", () => {
    const info = getBadgeInfo(0);
    expect(info.tier).toBe("arsonist");
    expect(info.emoji).toBe("💀");
  });
});

describe("BADGE_TIERS", () => {
  it("has all 6 tiers defined", () => {
    expect(Object.keys(BADGE_TIERS)).toHaveLength(6);
    expect(BADGE_TIERS).toHaveProperty("fire");
    expect(BADGE_TIERS).toHaveProperty("coffee");
    expect(BADGE_TIERS).toHaveProperty("good");
    expect(BADGE_TIERS).toHaveProperty("nervous");
    expect(BADGE_TIERS).toHaveProperty("exiting");
    expect(BADGE_TIERS).toHaveProperty("arsonist");
  });

  it("each tier has required properties", () => {
    for (const tier of Object.values(BADGE_TIERS)) {
      expect(tier).toHaveProperty("emoji");
      expect(tier).toHaveProperty("name");
      expect(tier).toHaveProperty("quote");
      expect(tier).toHaveProperty("color");
      expect(tier).toHaveProperty("minBurn");
      expect(tier).toHaveProperty("maxBurn");
    }
  });
});
