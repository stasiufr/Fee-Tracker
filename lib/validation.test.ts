import { describe, it, expect } from "vitest";
import {
  SolanaAddressSchema,
  PaginationSchema,
  TokenListQuerySchema,
  TimeframeSchema,
  validateSolanaAddress,
  safeParseBigInt,
} from "./validation";

describe("SolanaAddressSchema", () => {
  it("validates correct Solana addresses", () => {
    const validAddresses = [
      "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump",
      "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM",
      "11111111111111111111111111111111",
    ];

    for (const addr of validAddresses) {
      expect(SolanaAddressSchema.safeParse(addr).success).toBe(true);
    }
  });

  it("rejects invalid addresses", () => {
    const invalidAddresses = [
      "", // empty
      "short", // too short
      "has spaces in it",
      "has-invalid-chars!@#",
      "0OIl", // only 4 chars but has ambiguous chars
    ];

    for (const addr of invalidAddresses) {
      expect(SolanaAddressSchema.safeParse(addr).success).toBe(false);
    }
  });
});

describe("PaginationSchema", () => {
  it("uses defaults when no values provided", () => {
    const result = PaginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it("validates page and limit bounds", () => {
    expect(PaginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(PaginationSchema.safeParse({ page: 1 }).success).toBe(true);
    expect(PaginationSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(PaginationSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(PaginationSchema.safeParse({ limit: 100 }).success).toBe(true);
  });
});

describe("TokenListQuerySchema", () => {
  it("uses default values", () => {
    const result = TokenListQuerySchema.parse({});
    expect(result.sort).toBe("burnPercentage");
    expect(result.order).toBe("desc");
  });

  it("validates sort options", () => {
    expect(TokenListQuerySchema.safeParse({ sort: "burnPercentage" }).success).toBe(true);
    expect(TokenListQuerySchema.safeParse({ sort: "totalFeesBurned" }).success).toBe(true);
    expect(TokenListQuerySchema.safeParse({ sort: "invalidSort" }).success).toBe(false);
  });

  it("validates filter options", () => {
    expect(TokenListQuerySchema.safeParse({ filter: "burners" }).success).toBe(true);
    expect(TokenListQuerySchema.safeParse({ filter: "extractors" }).success).toBe(true);
    expect(TokenListQuerySchema.safeParse({ filter: "invalid" }).success).toBe(false);
  });
});

describe("TimeframeSchema", () => {
  it("accepts valid timeframes", () => {
    expect(TimeframeSchema.safeParse("24h").success).toBe(true);
    expect(TimeframeSchema.safeParse("7d").success).toBe(true);
    expect(TimeframeSchema.safeParse("30d").success).toBe(true);
    expect(TimeframeSchema.safeParse("all").success).toBe(true);
  });

  it("rejects invalid timeframes", () => {
    expect(TimeframeSchema.safeParse("1h").success).toBe(false);
    expect(TimeframeSchema.safeParse("1y").success).toBe(false);
    expect(TimeframeSchema.safeParse("").success).toBe(false);
  });
});

describe("validateSolanaAddress", () => {
  it("returns address for valid input", () => {
    const addr = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";
    expect(validateSolanaAddress(addr)).toBe(addr);
  });

  it("returns null for invalid input", () => {
    expect(validateSolanaAddress("invalid")).toBeNull();
    expect(validateSolanaAddress("")).toBeNull();
  });
});

describe("safeParseBigInt", () => {
  it("parses valid bigint strings", () => {
    expect(safeParseBigInt("123")).toBe(BigInt(123));
    expect(safeParseBigInt("0")).toBe(BigInt(0));
    expect(safeParseBigInt("999999999999999999")).toBe(BigInt("999999999999999999"));
  });

  it("parses numbers", () => {
    expect(safeParseBigInt(123)).toBe(BigInt(123));
  });

  it("converts empty string to 0n (BigInt behavior)", () => {
    // Note: BigInt("") returns 0n in JavaScript
    expect(safeParseBigInt("")).toBe(BigInt(0));
  });

  it("returns null for invalid input", () => {
    expect(safeParseBigInt("not a number")).toBeNull();
    expect(safeParseBigInt(null as unknown as string)).toBeNull();
    expect(safeParseBigInt(undefined)).toBeNull();
  });
});
