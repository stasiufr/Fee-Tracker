/**
 * Classifier Tests
 * Tests for fee event classification logic
 */

import { describe, it, expect } from "vitest";
import {
  classifyTransaction,
  classifyTransactions,
  calculateEventStats,
  type ParsedTransaction,
  type ClassifiedEvent,
} from "./classifier";

// Test fixtures
const CREATOR_VAULT = "4NQ4yGprSPCqvRJmMNV7rnJ81BUcCrgPEq4TVQ1FthYi";
const CREATOR_WALLET = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";
const TOKEN_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const BURN_ADDRESS = "1nc1nerator11111111111111111111111111111111";

function createBaseTx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    signature: "test-signature-" + Math.random().toString(36).slice(2),
    slot: 123456789,
    timestamp: Math.floor(Date.now() / 1000),
    type: "UNKNOWN",
    source: "SYSTEM_PROGRAM",
    fee: 5000,
    feePayer: CREATOR_WALLET,
    accountData: [],
    nativeTransfers: [],
    tokenTransfers: [],
    instructions: [],
    ...overrides,
  };
}

// =============================================================================
// classifyTransaction tests
// =============================================================================

describe("classifyTransaction", () => {
  describe("null/error handling", () => {
    it("returns null for null transaction", () => {
      const result = classifyTransaction(
        null as unknown as ParsedTransaction,
        CREATOR_VAULT,
        CREATOR_WALLET,
        TOKEN_MINT
      );
      expect(result).toBeNull();
    });

    it("returns null for transaction with error", () => {
      const tx = createBaseTx({ transactionError: { code: 1 } });
      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);
      expect(result).toBeNull();
    });

    it("returns null for transaction with no relevant transfers", () => {
      const tx = createBaseTx({
        nativeTransfers: [
          { fromUserAccount: "random1", toUserAccount: "random2", amount: 1000000 },
        ],
      });
      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);
      expect(result).toBeNull();
    });
  });

  describe("collect detection", () => {
    it("classifies SOL moving into vault as collect", () => {
      const tx = createBaseTx({
        nativeTransfers: [
          {
            fromUserAccount: "random-user",
            toUserAccount: CREATOR_VAULT,
            amount: 1000000000, // 1 SOL
          },
        ],
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("collect");
      expect(result?.amountLamports).toBe(BigInt(1000000000));
    });

    it("ignores SOL from creator wallet to vault (not a fee collection)", () => {
      const tx = createBaseTx({
        nativeTransfers: [
          {
            fromUserAccount: CREATOR_WALLET,
            toUserAccount: CREATOR_VAULT,
            amount: 1000000000,
          },
        ],
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);
      // Should be null because it's the creator's own transfer, not a fee
      expect(result).toBeNull();
    });
  });

  describe("withdraw detection", () => {
    it("classifies SOL from vault to creator wallet as withdraw", () => {
      const tx = createBaseTx({
        nativeTransfers: [
          {
            fromUserAccount: CREATOR_VAULT,
            toUserAccount: CREATOR_WALLET,
            amount: 500000000, // 0.5 SOL
          },
        ],
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("withdraw");
      expect(result?.amountLamports).toBe(BigInt(500000000));
    });

    it("classifies SOL leaving vault to unknown destination as withdraw (conservative)", () => {
      const tx = createBaseTx({
        nativeTransfers: [
          {
            fromUserAccount: CREATOR_VAULT,
            toUserAccount: "unknown-destination",
            amount: 250000000,
          },
        ],
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("withdraw");
    });
  });

  describe("burn detection", () => {
    it("classifies vault outflow + Jupiter swap + burn event as burn", () => {
      const tx = createBaseTx({
        nativeTransfers: [
          {
            fromUserAccount: CREATOR_VAULT,
            toUserAccount: "jupiter-pool",
            amount: 1000000000,
          },
        ],
        instructions: [
          { programId: JUPITER_V6, accounts: [], data: "" },
        ],
        events: {
          burn: { amount: 1000000 },
        },
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("burn");
      expect(result?.burnedTokenAmount).toBe(BigInt(1000000));
    });

    it("classifies vault outflow + swap + transfer to burn address as burn", () => {
      const tx = createBaseTx({
        description: "Swap SOL for tokens and burn",
        nativeTransfers: [
          {
            fromUserAccount: CREATOR_VAULT,
            toUserAccount: "dex-pool",
            amount: 2000000000,
          },
        ],
        tokenTransfers: [
          {
            mint: TOKEN_MINT,
            fromUserAccount: "intermediate",
            toUserAccount: BURN_ADDRESS,
            tokenAmount: 5000000,
          },
        ],
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("burn");
      expect(result?.burnedTokenMint).toBe(TOKEN_MINT);
      expect(result?.burnedTokenAmount).toBe(BigInt(5000000));
    });

    it("detects swap from description containing 'jupiter'", () => {
      const tx = createBaseTx({
        description: "Jupiter V6 swap",
        nativeTransfers: [
          {
            fromUserAccount: CREATOR_VAULT,
            toUserAccount: "pool",
            amount: 1000000000,
          },
        ],
        tokenTransfers: [
          {
            mint: TOKEN_MINT,
            fromUserAccount: "swap-account",
            toUserAccount: "",
            tokenAmount: 100000,
          },
        ],
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      expect(result?.type).toBe("burn");
    });

    it("detects swap from description containing 'raydium'", () => {
      const tx = createBaseTx({
        description: "Raydium AMM swap",
        nativeTransfers: [
          {
            fromUserAccount: CREATOR_VAULT,
            toUserAccount: "pool",
            amount: 1000000000,
          },
        ],
        events: {
          burn: { amount: "50000" },
        },
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      expect(result?.type).toBe("burn");
      expect(result?.burnedTokenAmount).toBe(BigInt(50000));
    });
  });

  describe("edge cases", () => {
    it("handles missing timestamp gracefully", () => {
      const tx = createBaseTx({
        timestamp: undefined as unknown as number,
        nativeTransfers: [
          {
            fromUserAccount: "user",
            toUserAccount: CREATOR_VAULT,
            amount: 100000,
          },
        ],
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      expect(result).not.toBeNull();
      expect(result?.blockTime).toEqual(new Date(0));
    });

    it("handles string amounts correctly", () => {
      const tx = createBaseTx({
        nativeTransfers: [
          {
            fromUserAccount: CREATOR_VAULT,
            toUserAccount: CREATOR_WALLET,
            amount: "123456789" as unknown as number, // String instead of number
          },
        ],
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      // Should still work with string amounts
      expect(result).not.toBeNull();
    });

    it("collect takes priority over outflow in same transaction", () => {
      const tx = createBaseTx({
        nativeTransfers: [
          {
            fromUserAccount: "buyer",
            toUserAccount: CREATOR_VAULT,
            amount: 1000000000,
          },
          {
            fromUserAccount: CREATOR_VAULT,
            toUserAccount: "somewhere",
            amount: 500000000,
          },
        ],
      });

      const result = classifyTransaction(tx, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

      expect(result?.type).toBe("collect");
    });
  });
});

// =============================================================================
// classifyTransactions tests
// =============================================================================

describe("classifyTransactions", () => {
  it("classifies multiple transactions", () => {
    const transactions: ParsedTransaction[] = [
      createBaseTx({
        nativeTransfers: [
          { fromUserAccount: "user1", toUserAccount: CREATOR_VAULT, amount: 1000000000 },
        ],
      }),
      createBaseTx({
        nativeTransfers: [
          { fromUserAccount: CREATOR_VAULT, toUserAccount: CREATOR_WALLET, amount: 500000000 },
        ],
      }),
      createBaseTx({
        nativeTransfers: [
          { fromUserAccount: "irrelevant", toUserAccount: "irrelevant", amount: 100 },
        ],
      }),
    ];

    const results = classifyTransactions(transactions, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);

    expect(results).toHaveLength(2); // Third tx should be filtered out
    expect(results[0].type).toBe("collect");
    expect(results[1].type).toBe("withdraw");
  });

  it("returns empty array for no transactions", () => {
    const results = classifyTransactions([], CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);
    expect(results).toEqual([]);
  });

  it("filters out all null results", () => {
    const transactions: ParsedTransaction[] = [
      createBaseTx({ transactionError: { code: 1 } }),
      createBaseTx({ transactionError: { code: 2 } }),
    ];

    const results = classifyTransactions(transactions, CREATOR_VAULT, CREATOR_WALLET, TOKEN_MINT);
    expect(results).toHaveLength(0);
  });
});

// =============================================================================
// calculateEventStats tests
// =============================================================================

describe("calculateEventStats", () => {
  it("calculates correct totals for mixed events", () => {
    const events: ClassifiedEvent[] = [
      { type: "collect", amountLamports: BigInt(1000000000), signature: "1", blockTime: new Date() },
      { type: "collect", amountLamports: BigInt(2000000000), signature: "2", blockTime: new Date() },
      { type: "burn", amountLamports: BigInt(500000000), signature: "3", blockTime: new Date() },
      { type: "withdraw", amountLamports: BigInt(300000000), signature: "4", blockTime: new Date() },
      { type: "burn", amountLamports: BigInt(200000000), signature: "5", blockTime: new Date() },
    ];

    const stats = calculateEventStats(events);

    expect(stats.totalCollected).toBe(BigInt(3000000000)); // 3 SOL
    expect(stats.totalBurned).toBe(BigInt(700000000)); // 0.7 SOL
    expect(stats.totalWithdrawn).toBe(BigInt(300000000)); // 0.3 SOL
    expect(stats.collectCount).toBe(2);
    expect(stats.burnCount).toBe(2);
    expect(stats.withdrawCount).toBe(1);
  });

  it("returns zeros for empty array", () => {
    const stats = calculateEventStats([]);

    expect(stats.totalCollected).toBe(BigInt(0));
    expect(stats.totalBurned).toBe(BigInt(0));
    expect(stats.totalWithdrawn).toBe(BigInt(0));
    expect(stats.collectCount).toBe(0);
    expect(stats.burnCount).toBe(0);
    expect(stats.withdrawCount).toBe(0);
  });

  it("handles single event type correctly", () => {
    const events: ClassifiedEvent[] = [
      { type: "burn", amountLamports: BigInt(100), signature: "1", blockTime: new Date() },
      { type: "burn", amountLamports: BigInt(200), signature: "2", blockTime: new Date() },
      { type: "burn", amountLamports: BigInt(300), signature: "3", blockTime: new Date() },
    ];

    const stats = calculateEventStats(events);

    expect(stats.totalCollected).toBe(BigInt(0));
    expect(stats.totalBurned).toBe(BigInt(600));
    expect(stats.totalWithdrawn).toBe(BigInt(0));
    expect(stats.burnCount).toBe(3);
  });

  it("handles large BigInt values", () => {
    const events: ClassifiedEvent[] = [
      { type: "collect", amountLamports: BigInt("9000000000000000000"), signature: "1", blockTime: new Date() },
      { type: "collect", amountLamports: BigInt("1000000000000000000"), signature: "2", blockTime: new Date() },
    ];

    const stats = calculateEventStats(events);

    expect(stats.totalCollected).toBe(BigInt("10000000000000000000"));
  });
});
