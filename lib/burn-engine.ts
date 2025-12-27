/**
 * ASDF Burn Engine Integration
 * Verifies burns against the official burn-engine program
 * Program: ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getHeliusRpcUrl, NETWORK_INFO } from "./helius";

// ASDF Burn Engine Program ID
export const BURN_ENGINE_PROGRAM_ID = "ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui";

// Token mint for $ASDF
export const ASDF_TOKEN_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";

// Known burn addresses
export const BURN_ADDRESSES = [
  "1nc1nerator11111111111111111111111111111111", // Incinerator
  "11111111111111111111111111111111", // System program (null account)
];

export interface BurnVerification {
  signature: string;
  verified: boolean;
  burnType: "direct" | "buyback" | "engine" | "unknown";
  amountBurned?: bigint;
  tokenMint?: string;
  timestamp?: Date;
  slot?: number;
  error?: string;
}

export interface BurnEngineStats {
  totalBurned: bigint;
  totalBuybacks: number;
  lastBurnSlot: number;
  lastBurnTimestamp: Date;
  rootTokenBurned: bigint; // $ASDF specifically
  secondaryTokensBurned: bigint;
}

/**
 * Verify if a transaction is a valid burn via the burn engine
 */
export async function verifyBurnTransaction(
  signature: string,
  connection?: Connection
): Promise<BurnVerification> {
  const conn = connection || new Connection(getHeliusRpcUrl());

  try {
    const tx = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return {
        signature,
        verified: false,
        burnType: "unknown",
        error: "Transaction not found",
      };
    }

    // Check if burn engine program was involved
    const programIds = tx.transaction.message.accountKeys.map((k) =>
      k.pubkey.toBase58()
    );
    const involvesBurnEngine = programIds.includes(BURN_ENGINE_PROGRAM_ID);

    // Check for SPL Token burn instruction
    const burnInstruction = tx.transaction.message.instructions.find((ix) => {
      if ("parsed" in ix && ix.parsed?.type === "burn") {
        return true;
      }
      return false;
    });

    // Check for transfer to burn address
    const burnTransfer = tx.transaction.message.instructions.find((ix) => {
      if ("parsed" in ix && ix.parsed?.type === "transfer") {
        const dest = ix.parsed.info?.destination;
        return BURN_ADDRESSES.includes(dest);
      }
      return false;
    });

    // Determine burn type
    let burnType: BurnVerification["burnType"] = "unknown";
    let amountBurned: bigint | undefined;
    let tokenMint: string | undefined;

    if (involvesBurnEngine) {
      burnType = "engine";
    } else if (burnInstruction && "parsed" in burnInstruction) {
      burnType = "direct";
      amountBurned = BigInt(burnInstruction.parsed.info?.amount || 0);
      tokenMint = burnInstruction.parsed.info?.mint;
    } else if (burnTransfer) {
      burnType = "direct";
    }

    // Check for Jupiter swap (indicates buyback & burn pattern)
    const hasJupiterSwap = programIds.some(
      (id) =>
        id === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" ||
        id.startsWith("JUP")
    );

    if (hasJupiterSwap && (burnInstruction || burnTransfer)) {
      burnType = "buyback";
    }

    const verified = burnType !== "unknown";

    return {
      signature,
      verified,
      burnType,
      amountBurned,
      tokenMint,
      timestamp: tx.blockTime ? new Date(tx.blockTime * 1000) : undefined,
      slot: tx.slot,
    };
  } catch (error) {
    return {
      signature,
      verified: false,
      burnType: "unknown",
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

/**
 * Check if a token is part of the ASDF ecosystem (root or secondary)
 */
export async function isASDFEcosystemToken(
  tokenMint: string
): Promise<{
  isEcosystem: boolean;
  tokenType: "root" | "secondary" | "unknown";
  rootContribution?: number; // percentage to root (44.8% for secondaries)
}> {
  // Root token check
  if (tokenMint === ASDF_TOKEN_MINT) {
    return {
      isEcosystem: true,
      tokenType: "root",
      rootContribution: 100,
    };
  }

  // Check if token interacts with burn engine
  // This would require checking on-chain data for registered tokens
  // For now, return unknown
  return {
    isEcosystem: false,
    tokenType: "unknown",
  };
}

/**
 * Get burn statistics for a specific token
 */
export async function getTokenBurnStats(
  tokenMint: string
): Promise<{
  totalBurned: bigint;
  burnCount: number;
  lastBurn?: Date;
  verifiedBurns: number;
}> {
  // This would typically query indexed data
  // For now, return placeholder
  console.log(`Fetching burn stats for ${tokenMint} on ${NETWORK_INFO.cluster}`);

  return {
    totalBurned: BigInt(0),
    burnCount: 0,
    verifiedBurns: 0,
  };
}

/**
 * Verify burn engine program is deployed and active
 */
export async function verifyBurnEngineDeployment(
  connection?: Connection
): Promise<{
  deployed: boolean;
  executable: boolean;
  owner?: string;
}> {
  const conn = connection || new Connection(getHeliusRpcUrl());

  try {
    const programPubkey = new PublicKey(BURN_ENGINE_PROGRAM_ID);
    const accountInfo = await conn.getAccountInfo(programPubkey);

    if (!accountInfo) {
      return { deployed: false, executable: false };
    }

    return {
      deployed: true,
      executable: accountInfo.executable,
      owner: accountInfo.owner.toBase58(),
    };
  } catch (error) {
    console.error("Error verifying burn engine:", error);
    return { deployed: false, executable: false };
  }
}

/**
 * Monitor burn engine activity in real-time
 */
export class BurnEngineMonitor {
  private connection: Connection;
  private subscriptionId: number | null = null;
  private onBurnDetected?: (burn: BurnVerification) => void;

  constructor(options?: {
    rpcUrl?: string;
    onBurnDetected?: (burn: BurnVerification) => void;
  }) {
    this.connection = new Connection(options?.rpcUrl || getHeliusRpcUrl());
    this.onBurnDetected = options?.onBurnDetected;
  }

  /**
   * Start monitoring burn engine program
   */
  async start(): Promise<void> {
    const programPubkey = new PublicKey(BURN_ENGINE_PROGRAM_ID);

    console.log("Starting Burn Engine monitor...");
    console.log(`Program: ${BURN_ENGINE_PROGRAM_ID}`);
    console.log(`Network: ${NETWORK_INFO.cluster}`);

    // Subscribe to program logs
    this.subscriptionId = this.connection.onLogs(
      programPubkey,
      async (logs) => {
        console.log(`Burn Engine activity detected: ${logs.signature}`);

        // Verify the burn
        const verification = await verifyBurnTransaction(
          logs.signature,
          this.connection
        );

        if (verification.verified) {
          this.onBurnDetected?.(verification);
        }
      },
      "confirmed"
    );

    console.log("Burn Engine monitor active");
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
      console.log("Burn Engine monitor stopped");
    }
  }
}

/**
 * Calculate if a creator qualifies for CCM (Creator Capital Markets) recognition
 */
export function calculateCCMStatus(stats: {
  totalCollected: bigint;
  totalBurned: bigint;
  totalWithdrawn: bigint;
  verifiedBurns: number;
  totalBurnTxs: number;
}): {
  qualifies: boolean;
  burnRate: number;
  verificationRate: number;
  tier: "diamond" | "gold" | "silver" | "bronze" | "none";
  message: string;
} {
  const burnRate =
    stats.totalCollected > 0
      ? Number((stats.totalBurned * BigInt(10000)) / stats.totalCollected) / 100
      : 0;

  const verificationRate =
    stats.totalBurnTxs > 0
      ? (stats.verifiedBurns / stats.totalBurnTxs) * 100
      : 0;

  // CCM tiers based on burn rate AND verification rate
  let tier: "diamond" | "gold" | "silver" | "bronze" | "none" = "none";
  let message = "";

  if (burnRate >= 95 && verificationRate >= 90) {
    tier = "diamond";
    message = "Diamond Hands - True believer, maximum alignment";
  } else if (burnRate >= 80 && verificationRate >= 80) {
    tier = "gold";
    message = "Gold Standard - Strong commitment to the ecosystem";
  } else if (burnRate >= 50 && verificationRate >= 70) {
    tier = "silver";
    message = "Silver Lining - Balanced approach with good faith";
  } else if (burnRate >= 20 && verificationRate >= 50) {
    tier = "bronze";
    message = "Bronze Start - Room for improvement";
  } else {
    message = "Not yet qualified for CCM recognition";
  }

  return {
    qualifies: tier !== "none",
    burnRate,
    verificationRate,
    tier,
    message,
  };
}
