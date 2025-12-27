/**
 * Proof-of-History Module
 * Cryptographic chain for tamper-proof fee event recording
 * Compatible with asdf-validator PoH format
 */

import { createHash } from "crypto";
import { prisma } from "./db";

export interface PoHRecord {
  sequence: number;
  hash: string;
  prevHash: string;
  timestamp: Date;
  slot?: number;
  eventType: "collect" | "burn" | "withdraw";
  vault: "BC" | "AMM" | "UNKNOWN";
  tokenMint: string;
  tokenSymbol?: string;
  amountLamports: bigint;
  signature: string;
}

export interface PoHChainState {
  lastSequence: number;
  lastHash: string;
  chainLength: number;
  createdAt: Date;
  lastUpdated: Date;
}

// Genesis hash for new chains
const GENESIS_HASH = "0".repeat(64);

/**
 * Generate SHA-256 hash for a PoH record
 */
function generateHash(record: Omit<PoHRecord, "hash">): string {
  const data = [
    record.sequence.toString(),
    record.prevHash,
    record.timestamp.toISOString(),
    record.slot?.toString() || "0",
    record.eventType,
    record.vault,
    record.tokenMint,
    record.amountLamports.toString(),
    record.signature,
  ].join("|");

  return createHash("sha256").update(data).digest("hex");
}

/**
 * Verify a single PoH record's hash
 */
export function verifyRecordHash(record: PoHRecord): boolean {
  const expectedHash = generateHash({
    sequence: record.sequence,
    prevHash: record.prevHash,
    timestamp: record.timestamp,
    slot: record.slot,
    eventType: record.eventType,
    vault: record.vault,
    tokenMint: record.tokenMint,
    tokenSymbol: record.tokenSymbol,
    amountLamports: record.amountLamports,
    signature: record.signature,
  });

  return record.hash === expectedHash;
}

/**
 * Verify an entire PoH chain
 */
export function verifyChain(records: PoHRecord[]): {
  valid: boolean;
  invalidAt?: number;
  error?: string;
} {
  if (records.length === 0) {
    return { valid: true };
  }

  // Sort by sequence
  const sorted = [...records].sort((a, b) => a.sequence - b.sequence);

  // First record should link to genesis
  if (sorted[0].prevHash !== GENESIS_HASH && sorted[0].sequence === 1) {
    return {
      valid: false,
      invalidAt: 0,
      error: "First record does not link to genesis hash",
    };
  }

  for (let i = 0; i < sorted.length; i++) {
    const record = sorted[i];

    // Verify hash
    if (!verifyRecordHash(record)) {
      return {
        valid: false,
        invalidAt: i,
        error: `Record ${record.sequence}: Hash mismatch`,
      };
    }

    // Verify chain link (except first)
    if (i > 0) {
      const prevRecord = sorted[i - 1];
      if (record.prevHash !== prevRecord.hash) {
        return {
          valid: false,
          invalidAt: i,
          error: `Record ${record.sequence}: Chain link broken`,
        };
      }
    }

    // Verify sequence
    if (i > 0 && record.sequence !== sorted[i - 1].sequence + 1) {
      return {
        valid: false,
        invalidAt: i,
        error: `Record ${record.sequence}: Sequence gap detected`,
      };
    }
  }

  return { valid: true };
}

/**
 * PoH Chain Manager for a specific token
 */
export class PoHChainManager {
  private tokenMint: string;
  private lastHash: string = GENESIS_HASH;
  private lastSequence: number = 0;

  constructor(tokenMint: string) {
    this.tokenMint = tokenMint;
  }

  /**
   * Initialize from existing chain in database
   */
  async initialize(): Promise<void> {
    // Get the last PoH record for this token
    const lastRecord = await prisma.poHRecord.findFirst({
      where: { tokenMint: this.tokenMint },
      orderBy: { sequence: "desc" },
    });

    if (lastRecord) {
      this.lastHash = lastRecord.hash;
      this.lastSequence = lastRecord.sequence;
    }
  }

  /**
   * Add a new event to the PoH chain
   */
  async addEvent(event: {
    eventType: "collect" | "burn" | "withdraw";
    vault: "BC" | "AMM" | "UNKNOWN";
    amountLamports: bigint;
    signature: string;
    tokenSymbol?: string;
    slot?: number;
  }): Promise<PoHRecord> {
    const sequence = this.lastSequence + 1;
    const timestamp = new Date();

    const recordData: Omit<PoHRecord, "hash"> = {
      sequence,
      prevHash: this.lastHash,
      timestamp,
      slot: event.slot,
      eventType: event.eventType,
      vault: event.vault,
      tokenMint: this.tokenMint,
      tokenSymbol: event.tokenSymbol,
      amountLamports: event.amountLamports,
      signature: event.signature,
    };

    const hash = generateHash(recordData);

    const record: PoHRecord = {
      ...recordData,
      hash,
    };

    // Save to database
    await prisma.poHRecord.create({
      data: {
        sequence: record.sequence,
        hash: record.hash,
        prevHash: record.prevHash,
        timestamp: record.timestamp,
        slot: record.slot,
        eventType: record.eventType,
        vault: record.vault,
        tokenMint: record.tokenMint,
        tokenSymbol: record.tokenSymbol,
        amountLamports: record.amountLamports,
        signature: record.signature,
      },
    });

    // Update state
    this.lastHash = hash;
    this.lastSequence = sequence;

    return record;
  }

  /**
   * Get chain state
   */
  getState(): { lastHash: string; lastSequence: number; tokenMint: string } {
    return {
      lastHash: this.lastHash,
      lastSequence: this.lastSequence,
      tokenMint: this.tokenMint,
    };
  }

  /**
   * Get full chain for verification
   */
  async getFullChain(): Promise<PoHRecord[]> {
    const records = await prisma.poHRecord.findMany({
      where: { tokenMint: this.tokenMint },
      orderBy: { sequence: "asc" },
    });

    // Type for Prisma PoHRecord result
    type PrismaPoHRecord = {
      sequence: number;
      hash: string;
      prevHash: string;
      timestamp: Date;
      slot: number | null;
      eventType: string;
      vault: string;
      tokenMint: string;
      tokenSymbol: string | null;
      amountLamports: bigint;
      signature: string;
    };

    return records.map((r: PrismaPoHRecord) => ({
      sequence: r.sequence,
      hash: r.hash,
      prevHash: r.prevHash,
      timestamp: r.timestamp,
      slot: r.slot || undefined,
      eventType: r.eventType as "collect" | "burn" | "withdraw",
      vault: r.vault as "BC" | "AMM" | "UNKNOWN",
      tokenMint: r.tokenMint,
      tokenSymbol: r.tokenSymbol || undefined,
      amountLamports: r.amountLamports,
      signature: r.signature,
    }));
  }

  /**
   * Verify the token's entire PoH chain
   */
  async verifyFullChain(): Promise<{
    valid: boolean;
    chainLength: number;
    invalidAt?: number;
    error?: string;
  }> {
    const chain = await this.getFullChain();
    const result = verifyChain(chain);
    return {
      ...result,
      chainLength: chain.length,
    };
  }
}

/**
 * Export chain to JSON file format (compatible with asdf-validator)
 */
export function exportChainToJSON(records: PoHRecord[]): string {
  return JSON.stringify(
    records.map((r) => ({
      ...r,
      amountLamports: r.amountLamports.toString(),
      timestamp: r.timestamp.toISOString(),
    })),
    null,
    2
  );
}

/**
 * Import chain from JSON file
 */
export function importChainFromJSON(json: string): PoHRecord[] {
  const data = JSON.parse(json) as Array<{
    sequence: number;
    hash: string;
    prevHash: string;
    timestamp: string;
    slot?: number;
    eventType: "collect" | "burn" | "withdraw";
    vault: "BC" | "AMM" | "UNKNOWN";
    tokenMint: string;
    tokenSymbol?: string;
    amountLamports: string;
    signature: string;
  }>;
  return data.map((r) => ({
    sequence: r.sequence,
    hash: r.hash,
    prevHash: r.prevHash,
    timestamp: new Date(r.timestamp),
    slot: r.slot,
    eventType: r.eventType,
    vault: r.vault,
    tokenMint: r.tokenMint,
    tokenSymbol: r.tokenSymbol,
    amountLamports: BigInt(r.amountLamports),
    signature: r.signature,
  }));
}
