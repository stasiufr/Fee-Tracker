/**
 * Real-time Fee Tracking Daemon
 * Combines WebSocket tracking, PoH recording, and burn verification
 * Compatible with ASDF ecosystem (asdf-validator, burn-engine)
 */

import { PublicKey } from "@solana/web3.js";
import {
  WebSocketTracker,
  type FeeDetectedEvent,
  type BalanceChange,
} from "../lib/websocket-tracker";
import { PoHChainManager } from "../lib/proof-of-history";
import {
  verifyBurnTransaction,
  BurnEngineMonitor,
  type BurnVerification,
} from "../lib/burn-engine";
import { classifyTransaction } from "../lib/classifier";
import {
  prisma,
  upsertToken,
  createFeeEvent,
  updateTokenStats,
  getTokenByMint,
} from "../lib/db";
import { calculateBurnPercentage, calculateBadgeTier } from "../lib/badges";
import {
  getParsedTransactions,
  getTokenMetadata,
  PUMP_PROGRAM_ID,
  NETWORK_INFO,
} from "../lib/helius";

interface DaemonConfig {
  tokenMints: string[];
  enablePoH?: boolean;
  enableBurnVerification?: boolean;
  onFeeDetected?: (event: FeeDetectedEvent & { verified?: boolean }) => void;
  onBurnVerified?: (burn: BurnVerification) => void;
  onError?: (error: Error) => void;
  verbose?: boolean;
}

interface TokenTracker {
  mint: string;
  symbol?: string;
  tracker: WebSocketTracker;
  pohManager: PoHChainManager;
}

/**
 * Real-time daemon that tracks multiple tokens
 */
export class RealtimeDaemon {
  private config: DaemonConfig;
  private trackers: Map<string, TokenTracker> = new Map();
  private burnMonitor: BurnEngineMonitor | null = null;
  private isRunning: boolean = false;

  constructor(config: DaemonConfig) {
    this.config = {
      enablePoH: true,
      enableBurnVerification: true,
      verbose: false,
      ...config,
    };
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn("Daemon already running");
      return;
    }

    console.log("=".repeat(60));
    console.log("Starting Real-time Fee Tracking Daemon");
    console.log(`Network: ${NETWORK_INFO.cluster}`);
    console.log(`Tokens to track: ${this.config.tokenMints.length}`);
    console.log(`PoH enabled: ${this.config.enablePoH}`);
    console.log(`Burn verification: ${this.config.enableBurnVerification}`);
    console.log("=".repeat(60));

    // Initialize trackers for each token
    for (const mint of this.config.tokenMints) {
      await this.initializeTokenTracker(mint);
    }

    // Start burn engine monitor if enabled
    if (this.config.enableBurnVerification) {
      this.burnMonitor = new BurnEngineMonitor({
        onBurnDetected: (burn) => {
          this.log(`Burn Engine: ${burn.burnType} burn verified`);
          this.config.onBurnVerified?.(burn);
        },
      });
      await this.burnMonitor.start();
    }

    // Start all trackers
    for (const [mint, tokenTracker] of this.trackers) {
      await tokenTracker.tracker.start();
      this.log(`Started tracker for ${tokenTracker.symbol || mint}`);
    }

    this.isRunning = true;
    console.log("\nDaemon running. Press Ctrl+C to stop.\n");
  }

  /**
   * Stop the daemon
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log("\nStopping daemon...");

    // Stop all trackers
    for (const [mint, tokenTracker] of this.trackers) {
      await tokenTracker.tracker.stop();
      this.log(`Stopped tracker for ${tokenTracker.symbol || mint}`);
    }

    // Stop burn monitor
    if (this.burnMonitor) {
      await this.burnMonitor.stop();
    }

    this.isRunning = false;
    console.log("Daemon stopped.");
  }

  /**
   * Initialize tracker for a single token
   */
  private async initializeTokenTracker(mint: string): Promise<void> {
    this.log(`Initializing tracker for ${mint}`);

    // Get or create token in database
    const existingToken = await getTokenByMint(mint);
    let creatorVault: string;
    let creatorWallet: string;
    let symbol: string | undefined;

    if (existingToken && existingToken.creatorVault && existingToken.creatorWallet) {
      creatorVault = existingToken.creatorVault;
      creatorWallet = existingToken.creatorWallet;
      symbol = existingToken.symbol || undefined;
    } else {
      // Derive vault and fetch metadata
      const mintPubkey = new PublicKey(mint);
      const programId = new PublicKey(PUMP_PROGRAM_ID);

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
        programId
      );
      creatorVault = vaultPda.toBase58();

      // Fetch metadata
      const metadata = await getTokenMetadata(mint);
      const content = metadata?.content as {
        metadata?: { name?: string; symbol?: string };
      } | undefined;
      const authorities = (metadata as { authorities?: { address: string }[] })?.authorities;
      const ownership = (metadata as { ownership?: { owner: string } })?.ownership;

      creatorWallet = authorities?.[0]?.address || ownership?.owner || "";
      symbol = content?.metadata?.symbol;

      // Save to database
      await upsertToken({
        mint,
        name: content?.metadata?.name,
        symbol,
        creatorWallet,
        creatorVault,
      });
    }

    // Create PoH manager
    const pohManager = new PoHChainManager(mint);
    await pohManager.initialize();

    // Create WebSocket tracker
    const tracker = new WebSocketTracker({
      tokenMint: mint,
      tokenSymbol: symbol,
      bcVault: creatorVault,
      creatorWallet,
      enablePoH: this.config.enablePoH,
      onFeeDetected: async (event) => {
        await this.handleFeeDetected(mint, event);
      },
      onBalanceChange: (change) => {
        this.handleBalanceChange(mint, change);
      },
      onError: (error) => {
        this.config.onError?.(error);
      },
    });

    this.trackers.set(mint, {
      mint,
      symbol,
      tracker,
      pohManager,
    });

    this.log(`Tracker initialized for ${symbol || mint}`);
  }

  /**
   * Handle detected fee event
   */
  private async handleFeeDetected(
    mint: string,
    event: FeeDetectedEvent
  ): Promise<void> {
    const tokenTracker = this.trackers.get(mint);
    if (!tokenTracker) return;

    this.log(
      `[${tokenTracker.symbol || mint}] ${event.eventType.toUpperCase()}: ` +
        `${event.amountLamports} lamports`
    );

    // Get token from DB
    const token = await getTokenByMint(mint);
    if (!token) return;

    // If we have a signature, verify it and get full classification
    let verifiedEventType = event.eventType;
    let verified = false;

    if (event.signature && this.config.enableBurnVerification) {
      // For burns, verify via burn engine
      if (event.eventType === "burn" || event.eventType === "withdraw") {
        const verification = await verifyBurnTransaction(event.signature);
        verified = verification.verified;

        if (verification.burnType !== "unknown") {
          verifiedEventType = "burn";
          this.log(`  Burn verified: ${verification.burnType}`);
        }
      }

      // Get full transaction for accurate classification
      try {
        const [parsedTx] = await getParsedTransactions([event.signature]);
        if (parsedTx && token.creatorVault && token.creatorWallet) {
          const classified = classifyTransaction(
            parsedTx,
            token.creatorVault,
            token.creatorWallet,
            mint
          );
          if (classified) {
            verifiedEventType = classified.type;
          }
        }
      } catch {
        // Use WebSocket classification as fallback
      }
    }

    // Save to database
    try {
      await createFeeEvent({
        tokenId: token.id,
        eventType: verifiedEventType,
        amountLamports: event.amountLamports,
        signature: event.signature || `ws-${Date.now()}`,
        blockTime: event.timestamp,
      });

      // Add to PoH chain
      if (this.config.enablePoH && event.signature) {
        // Map WALLET to UNKNOWN for PoH compatibility
        const pohVault: "BC" | "AMM" | "UNKNOWN" = event.vault === "WALLET" ? "UNKNOWN" : event.vault;

        await tokenTracker.pohManager.addEvent({
          eventType: verifiedEventType,
          vault: pohVault,
          amountLamports: event.amountLamports,
          signature: event.signature,
          tokenSymbol: tokenTracker.symbol,
          slot: event.slot,
        });
      }

      // Recalculate token stats
      await this.recalculateTokenStats(token.id);

      // Notify callback
      this.config.onFeeDetected?.({
        ...event,
        eventType: verifiedEventType,
        verified,
      });
    } catch (error) {
      // Likely duplicate, ignore
      this.log(`  Event already recorded or error: ${error}`);
    }
  }

  /**
   * Handle balance change (for logging)
   */
  private handleBalanceChange(mint: string, change: BalanceChange): void {
    if (!this.config.verbose) return;

    const tokenTracker = this.trackers.get(mint);
    const symbol = tokenTracker?.symbol || mint.slice(0, 8);

    this.log(
      `[${symbol}] Balance change on ${change.vault}: ` +
        `${change.previousBalance} → ${change.newBalance} ` +
        `(${change.change > 0 ? "+" : ""}${change.change})`
    );
  }

  /**
   * Recalculate token statistics
   * Uses DB aggregation for efficiency (avoids loading all events into memory)
   */
  private async recalculateTokenStats(tokenId: number): Promise<void> {
    // Use DB aggregation instead of loading all events
    const statsAggregation = await prisma.feeEvent.groupBy({
      by: ["eventType"],
      where: { tokenId },
      _sum: { amountLamports: true },
    });

    let totalCollected = BigInt(0);
    let totalBurned = BigInt(0);
    let totalWithdrawn = BigInt(0);

    for (const stat of statsAggregation) {
      const amount = stat._sum.amountLamports ?? BigInt(0);
      switch (stat.eventType) {
        case "collect":
          totalCollected = amount;
          break;
        case "burn":
          totalBurned = amount;
          break;
        case "withdraw":
          totalWithdrawn = amount;
          break;
      }
    }

    const totalHeld = totalCollected - totalBurned - totalWithdrawn;
    const burnPercentage = calculateBurnPercentage(totalCollected, totalBurned);
    const badgeTier = calculateBadgeTier(burnPercentage);

    await updateTokenStats(tokenId, {
      totalFeesCollected: totalCollected,
      totalFeesBurned: totalBurned,
      totalFeesWithdrawn: totalWithdrawn,
      totalFeesHeld: totalHeld < 0 ? BigInt(0) : totalHeld,
      burnPercentage,
      badgeTier,
    });
  }

  /**
   * Add a new token to track
   */
  async addToken(mint: string): Promise<void> {
    if (this.trackers.has(mint)) {
      console.warn(`Token ${mint} already being tracked`);
      return;
    }

    await this.initializeTokenTracker(mint);

    if (this.isRunning) {
      const tracker = this.trackers.get(mint);
      if (tracker) {
        await tracker.tracker.start();
      }
    }
  }

  /**
   * Remove a token from tracking
   */
  async removeToken(mint: string): Promise<void> {
    const tracker = this.trackers.get(mint);
    if (!tracker) return;

    await tracker.tracker.stop();
    this.trackers.delete(mint);
    this.log(`Removed tracker for ${tracker.symbol || mint}`);
  }

  /**
   * Get daemon status
   */
  getStatus(): {
    isRunning: boolean;
    trackedTokens: number;
    tokens: { mint: string; symbol?: string; pohLength: number }[];
  } {
    const tokens = Array.from(this.trackers.values()).map((t) => ({
      mint: t.mint,
      symbol: t.symbol,
      pohLength: t.pohManager.getState().lastSequence,
    }));

    return {
      isRunning: this.isRunning,
      trackedTokens: this.trackers.size,
      tokens,
    };
  }

  /**
   * Verify all PoH chains
   */
  async verifyAllChains(): Promise<
    Map<string, { valid: boolean; chainLength: number; error?: string }>
  > {
    const results = new Map();

    for (const [mint, tracker] of this.trackers) {
      const verification = await tracker.pohManager.verifyFullChain();
      results.set(mint, verification);
    }

    return results;
  }

  /**
   * Log message if verbose mode
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[${new Date().toISOString()}] ${message}`);
    }
  }
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const mints: string[] = [];
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-v" || args[i] === "--verbose") {
      verbose = true;
    } else if (args[i] === "-m" || args[i] === "--mint") {
      if (args[i + 1]) {
        mints.push(args[++i]);
      }
    } else if (!args[i].startsWith("-")) {
      mints.push(args[i]);
    }
  }

  // Default to ASDFASDFA test token
  if (mints.length === 0) {
    mints.push("61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump");
  }

  console.log("\n🔥 Fee Tracker Real-time Daemon");
  console.log("================================\n");

  const daemon = new RealtimeDaemon({
    tokenMints: mints,
    verbose,
    onFeeDetected: (event) => {
      console.log(
        `\n📊 Fee Event: ${event.eventType.toUpperCase()}` +
          `\n   Token: ${event.tokenSymbol || event.tokenMint.slice(0, 8)}` +
          `\n   Amount: ${event.amountLamports} lamports` +
          `\n   Verified: ${event.verified ? "Yes" : "Pending"}`
      );
    },
    onBurnVerified: (burn) => {
      console.log(
        `\n🔥 Burn Verified: ${burn.burnType}` +
          `\n   Signature: ${burn.signature.slice(0, 16)}...`
      );
    },
    onError: (error) => {
      console.error(`\n❌ Error: ${error.message}`);
    },
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down...");
    await daemon.stop();
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down...");
    await daemon.stop();
    await prisma.$disconnect();
    process.exit(0);
  });

  // Start daemon
  await daemon.start();
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
