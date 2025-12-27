import { describe, it, expect } from "vitest";
import {
  lamportsToSol,
  solToLamports,
  formatSol,
  formatPercentage,
  shortenAddress,
  isValidSolanaAddress,
  getSolscanTxUrl,
  getSolscanTokenUrl,
  getPumpFunUrl,
  chunk,
} from "./utils";

describe("lamportsToSol", () => {
  it("converts lamports to SOL correctly", () => {
    expect(lamportsToSol(BigInt(1_000_000_000))).toBe(1);
    expect(lamportsToSol(BigInt(500_000_000))).toBe(0.5);
    expect(lamportsToSol(BigInt(0))).toBe(0);
  });

  it("handles large numbers", () => {
    expect(lamportsToSol(BigInt("100000000000000000"))).toBe(100_000_000);
  });
});

describe("solToLamports", () => {
  it("converts SOL to lamports correctly", () => {
    expect(solToLamports(1)).toBe(BigInt(1_000_000_000));
    expect(solToLamports(0.5)).toBe(BigInt(500_000_000));
    expect(solToLamports(0)).toBe(BigInt(0));
  });
});

describe("formatSol", () => {
  it("formats small amounts", () => {
    expect(formatSol(BigInt(1_000_000_000))).toBe("1.00");
    expect(formatSol(BigInt(100_000_000))).toBe("0.10");
  });

  it("formats with K suffix for thousands", () => {
    expect(formatSol(BigInt(1_000_000_000_000))).toContain("K");
  });

  it("formats with M suffix for millions", () => {
    expect(formatSol(BigInt(1_000_000_000_000_000))).toContain("M");
  });
});

describe("formatPercentage", () => {
  it("formats percentages with default decimals", () => {
    expect(formatPercentage(50)).toBe("50.0%");
    expect(formatPercentage(99.9)).toBe("99.9%");
  });

  it("respects decimal parameter", () => {
    expect(formatPercentage(50.123, 2)).toBe("50.12%");
    expect(formatPercentage(50.123, 0)).toBe("50%");
  });
});

describe("shortenAddress", () => {
  it("shortens addresses correctly", () => {
    const addr = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";
    const short = shortenAddress(addr);
    expect(short).toContain("...");
    expect(short.length).toBeLessThan(addr.length);
  });

  it("respects chars parameter", () => {
    const addr = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";
    expect(shortenAddress(addr, 6)).toMatch(/^.{6}\.\.\..{6}$/);
  });
});

describe("isValidSolanaAddress", () => {
  it("validates correct addresses", () => {
    expect(isValidSolanaAddress("61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump")).toBe(true);
    expect(isValidSolanaAddress("11111111111111111111111111111111")).toBe(true);
  });

  it("rejects invalid addresses", () => {
    expect(isValidSolanaAddress("")).toBe(false);
    expect(isValidSolanaAddress("short")).toBe(false);
    expect(isValidSolanaAddress("invalid!@#")).toBe(false);
  });
});

describe("URL generators", () => {
  it("generates correct Solscan TX URL", () => {
    const sig = "abc123";
    expect(getSolscanTxUrl(sig)).toBe("https://solscan.io/tx/abc123");
  });

  it("generates correct Solscan token URL", () => {
    const mint = "token123";
    expect(getSolscanTokenUrl(mint)).toBe("https://solscan.io/token/token123");
  });

  it("generates correct pump.fun URL", () => {
    const mint = "token123";
    expect(getPumpFunUrl(mint)).toBe("https://pump.fun/token123");
  });
});

describe("chunk", () => {
  it("chunks array correctly", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(chunk(arr, 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk(arr, 3)).toEqual([[1, 2, 3], [4, 5]]);
  });

  it("handles empty array", () => {
    expect(chunk([], 2)).toEqual([]);
  });

  it("handles chunk size larger than array", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
});
