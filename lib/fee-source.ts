/**
 * Fee Source Detection & Dual-Track Module
 *
 * Pump.fun has two fee models:
 * 1. Legacy: Fees go to vault PDA (creator_vault seed)
 * 2. Current: Fees go directly to creator wallet
 *
 * This module handles detection and tracking of both models.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getHeliusRpcUrl, getTransactionHistory, PUMP_PROGRAM_ID } from "./helius";

// =============================================================================
// TYPES
// =============================================================================

export type FeeModel = "vault_pda" | "creator_wallet" | "hybrid" | "unknown";

export type FeeSourceType = "vault" | "wallet";

export interface FeeSource {
  type: FeeSourceType;
  address: string;
  label: string;
  isActive: boolean;
  lastActivity?: Date;
  transactionCount: number;
}

export interface DualTrackConfig {
  tokenMint: string;
  creatorWallet: string;
  vaultPda: string;
  detectedModel?: FeeModel;
  sources: FeeSource[];
}

export interface FeeSourceDetectionResult {
  model: FeeModel;
  primarySource: FeeSourceType;
  vaultPda: {
    address: string;
    hasActivity: boolean;
    recentTxCount: number;
    balance: bigint;
  };
  creatorWallet: {
    address: string;
    hasActivity: boolean;
    recentTxCount: number;
    balance: bigint;
  };
  recommendation: string;
}

// =============================================================================
// VAULT PDA DERIVATION
// =============================================================================

/**
 * Derive the creator vault PDA from a token mint
 * Uses pump.fun seeds: ["creator_vault", mint.pubkey]
 */
export function deriveCreatorVaultPda(mint: string): string {
  const mintPubkey = new PublicKey(mint);
  const programId = new PublicKey(PUMP_PROGRAM_ID);

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
    programId
  );

  return vaultPda.toBase58();
}

/**
 * Derive bonding curve PDA (alternative seed pattern some tokens use)
 */
export function deriveBondingCurvePda(mint: string): string {
  const mintPubkey = new PublicKey(mint);
  const programId = new PublicKey(PUMP_PROGRAM_ID);

  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mintPubkey.toBuffer()],
    programId
  );

  return bondingCurve.toBase58();
}

// =============================================================================
// FEE MODEL DETECTION
// =============================================================================

/**
 * Detect which fee model a token uses by analyzing transaction activity
 */
export async function detectFeeModel(
  tokenMint: string,
  creatorWallet: string,
  connection?: Connection
): Promise<FeeSourceDetectionResult> {
  const conn = connection || new Connection(getHeliusRpcUrl());
  const vaultPda = deriveCreatorVaultPda(tokenMint);

  // Fetch data in parallel
  const [
    vaultInfo,
    walletInfo,
    vaultSigs,
    walletSigs,
  ] = await Promise.all([
    conn.getAccountInfo(new PublicKey(vaultPda)).catch(() => null),
    conn.getAccountInfo(new PublicKey(creatorWallet)).catch(() => null),
    getTransactionHistory(vaultPda, { limit: 20 }).catch(() => []),
    // For creator wallet, we need pump.fun specific transactions
    // This is trickier - we look for transactions involving the pump program
    getTransactionHistory(creatorWallet, { limit: 50 }).catch(() => []),
  ]);

  const vaultBalance = BigInt(vaultInfo?.lamports || 0);
  const walletBalance = BigInt(walletInfo?.lamports || 0);
  const vaultTxCount = vaultSigs.length;

  // Filter wallet transactions to only count pump.fun related ones
  // (This is a heuristic - real implementation would parse transactions)
  const walletTxCount = walletSigs.length;

  // Determine fee model
  let model: FeeModel = "unknown";
  let primarySource: FeeSourceType = "vault";
  let recommendation = "";

  if (vaultTxCount > 0 && walletTxCount === 0) {
    model = "vault_pda";
    primarySource = "vault";
    recommendation = "Token uses legacy vault PDA model. Track vault only.";
  } else if (vaultTxCount === 0 && walletTxCount > 0) {
    model = "creator_wallet";
    primarySource = "wallet";
    recommendation = "Token uses direct creator wallet model. Track wallet only.";
  } else if (vaultTxCount > 0 && walletTxCount > 0) {
    model = "hybrid";
    // Determine which is primary based on recent activity
    const vaultRecent = vaultSigs[0]?.blockTime || 0;
    const walletRecent = walletSigs[0]?.blockTime || 0;
    primarySource = vaultRecent > walletRecent ? "vault" : "wallet";
    recommendation = "Token uses hybrid model. Track both sources, prioritize " +
      (primarySource === "vault" ? "vault PDA" : "creator wallet") + ".";
  } else {
    model = "unknown";
    primarySource = "vault";
    recommendation = "No transaction activity detected. Default to tracking both sources.";
  }

  return {
    model,
    primarySource,
    vaultPda: {
      address: vaultPda,
      hasActivity: vaultTxCount > 0,
      recentTxCount: vaultTxCount,
      balance: vaultBalance,
    },
    creatorWallet: {
      address: creatorWallet,
      hasActivity: walletTxCount > 0,
      recentTxCount: walletTxCount,
      balance: walletBalance,
    },
    recommendation,
  };
}

// =============================================================================
// DUAL-TRACK CONFIGURATION BUILDER
// =============================================================================

/**
 * Build a dual-track configuration for a token
 */
export async function buildDualTrackConfig(
  tokenMint: string,
  creatorWallet: string,
  options?: {
    forceModel?: FeeModel;
    connection?: Connection;
  }
): Promise<DualTrackConfig> {
  const vaultPda = deriveCreatorVaultPda(tokenMint);

  // Detect model if not forced
  let detectedModel: FeeModel = options?.forceModel || "unknown";

  if (!options?.forceModel) {
    try {
      const detection = await detectFeeModel(tokenMint, creatorWallet, options?.connection);
      detectedModel = detection.model;
      console.log(`[FeeSource] Detected model for ${tokenMint.slice(0, 8)}...: ${detectedModel}`);
      console.log(`[FeeSource] ${detection.recommendation}`);
    } catch (error) {
      console.warn(`[FeeSource] Detection failed, defaulting to hybrid:`, error);
      detectedModel = "hybrid";
    }
  }

  // Build sources based on model
  const sources: FeeSource[] = [];

  // Always include vault PDA for legacy/hybrid/unknown
  if (detectedModel !== "creator_wallet") {
    sources.push({
      type: "vault",
      address: vaultPda,
      label: "Vault PDA",
      isActive: detectedModel === "vault_pda" || detectedModel === "hybrid",
      transactionCount: 0,
    });
  }

  // Always include creator wallet for wallet/hybrid/unknown
  if (detectedModel !== "vault_pda") {
    sources.push({
      type: "wallet",
      address: creatorWallet,
      label: "Creator Wallet",
      isActive: detectedModel === "creator_wallet" || detectedModel === "hybrid",
      transactionCount: 0,
    });
  }

  // For unknown, include both
  if (detectedModel === "unknown") {
    if (!sources.find(s => s.type === "vault")) {
      sources.push({
        type: "vault",
        address: vaultPda,
        label: "Vault PDA",
        isActive: true,
        transactionCount: 0,
      });
    }
    if (!sources.find(s => s.type === "wallet")) {
      sources.push({
        type: "wallet",
        address: creatorWallet,
        label: "Creator Wallet",
        isActive: true,
        transactionCount: 0,
      });
    }
  }

  return {
    tokenMint,
    creatorWallet,
    vaultPda,
    detectedModel,
    sources,
  };
}

// =============================================================================
// FEE SOURCE MANAGER
// =============================================================================

/**
 * Manages fee sources for multiple tokens
 * Handles detection, caching, and updates
 */
export class FeeSourceManager {
  private configs: Map<string, DualTrackConfig> = new Map();
  private connection: Connection;

  constructor(rpcUrl?: string) {
    this.connection = new Connection(rpcUrl || getHeliusRpcUrl());
  }

  /**
   * Get or create dual-track config for a token
   */
  async getConfig(tokenMint: string, creatorWallet: string): Promise<DualTrackConfig> {
    const cached = this.configs.get(tokenMint);
    if (cached) {
      return cached;
    }

    const config = await buildDualTrackConfig(tokenMint, creatorWallet, {
      connection: this.connection,
    });

    this.configs.set(tokenMint, config);
    return config;
  }

  /**
   * Force refresh detection for a token
   */
  async refreshConfig(tokenMint: string, creatorWallet: string): Promise<DualTrackConfig> {
    this.configs.delete(tokenMint);
    return this.getConfig(tokenMint, creatorWallet);
  }

  /**
   * Update activity for a source
   */
  updateSourceActivity(tokenMint: string, sourceType: FeeSourceType): void {
    const config = this.configs.get(tokenMint);
    if (!config) return;

    const source = config.sources.find(s => s.type === sourceType);
    if (source) {
      source.lastActivity = new Date();
      source.transactionCount++;
    }
  }

  /**
   * Get all addresses to track for a token
   */
  getTrackingAddresses(tokenMint: string): string[] {
    const config = this.configs.get(tokenMint);
    if (!config) return [];

    return config.sources
      .filter(s => s.isActive)
      .map(s => s.address);
  }

  /**
   * Check if an address belongs to a token's fee sources
   */
  identifySource(address: string): { tokenMint: string; sourceType: FeeSourceType } | null {
    for (const [tokenMint, config] of this.configs) {
      const source = config.sources.find(s => s.address === address);
      if (source) {
        return { tokenMint, sourceType: source.type };
      }
    }
    return null;
  }

  /**
   * Get stats for all tracked tokens
   */
  getStats(): {
    totalTokens: number;
    byModel: Record<FeeModel, number>;
    totalSources: number;
  } {
    const byModel: Record<FeeModel, number> = {
      vault_pda: 0,
      creator_wallet: 0,
      hybrid: 0,
      unknown: 0,
    };

    let totalSources = 0;

    for (const config of this.configs.values()) {
      if (config.detectedModel) {
        byModel[config.detectedModel]++;
      }
      totalSources += config.sources.length;
    }

    return {
      totalTokens: this.configs.size,
      byModel,
      totalSources,
    };
  }
}

// =============================================================================
// TRANSACTION CLASSIFICATION HELPERS
// =============================================================================

/**
 * Determine if a transaction is a fee-related transaction
 * based on source type and transfer direction
 */
export function classifyFeeTransaction(
  sourceType: FeeSourceType,
  isIncoming: boolean,
  creatorWallet: string,
  toAddress?: string
): "collect" | "withdraw" | "potential_burn" | "unknown" {
  if (sourceType === "vault") {
    // Vault PDA transactions
    if (isIncoming) {
      return "collect"; // SOL coming into vault = fee collection
    } else {
      // SOL leaving vault
      if (toAddress === creatorWallet) {
        return "withdraw"; // Going to creator = withdrawal
      }
      return "potential_burn"; // Going elsewhere = potential burn
    }
  } else {
    // Creator wallet transactions
    // This is more complex - we need to distinguish between:
    // - Regular wallet activity
    // - Fee-related activity from pump.fun
    if (isIncoming) {
      // Could be fee collection OR just receiving funds
      return "unknown"; // Needs further classification
    } else {
      // Outgoing from creator wallet
      return "unknown"; // Could be burn, could be personal tx
    }
  }
}

/**
 * Filter creator wallet transactions to identify pump.fun fee-related ones
 * This uses heuristics based on transaction patterns
 */
export interface PumpFeeHeuristics {
  isPumpRelated: boolean;
  confidence: "high" | "medium" | "low";
  indicators: string[];
}

export function analyzePumpFeeHeuristics(
  transaction: {
    programIds?: string[];
    description?: string;
    nativeTransfers?: Array<{ fromUserAccount: string; toUserAccount: string; amount: number }>;
  },
  creatorWallet: string
): PumpFeeHeuristics {
  const indicators: string[] = [];
  let confidence: "high" | "medium" | "low" = "low";

  // Check for pump.fun program involvement
  const hasPumpProgram = transaction.programIds?.includes(PUMP_PROGRAM_ID);
  if (hasPumpProgram) {
    indicators.push("pump.fun program involved");
    confidence = "high";
  }

  // Check description for pump-related keywords
  const desc = transaction.description?.toLowerCase() || "";
  if (desc.includes("pump") || desc.includes("bonding curve")) {
    indicators.push("pump-related description");
    confidence = confidence === "high" ? "high" : "medium";
  }

  // Check for transfer patterns typical of fee distribution
  const transfers = transaction.nativeTransfers || [];
  const incomingToCreator = transfers.filter(t => t.toUserAccount === creatorWallet);

  if (incomingToCreator.length === 1) {
    // Single transfer to creator is typical of fee distribution
    indicators.push("single transfer to creator");
    confidence = confidence === "low" ? "medium" : confidence;
  }

  return {
    isPumpRelated: indicators.length > 0,
    confidence,
    indicators,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  deriveCreatorVaultPda as deriveVaultPda,
};
