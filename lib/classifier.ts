/**
 * Fee Event Classifier
 * Classifies pump.fun transactions as: collect, withdraw, or burn
 */

import type { EnrichedTransaction } from "./helius";

// Re-export for backwards compatibility
export type ParsedTransaction = EnrichedTransaction;

export type FeeEventType = "collect" | "withdraw" | "burn";

/**
 * Safely convert a value to BigInt
 * Returns BigInt(0) if conversion fails
 */
function safeBigInt(value: unknown): bigint {
  if (value === undefined || value === null) {
    return BigInt(0);
  }
  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.floor(value));
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return BigInt(value);
    }
    return BigInt(0);
  } catch {
    return BigInt(0);
  }
}

export interface ClassifiedEvent {
  type: FeeEventType;
  amountLamports: bigint;
  signature: string;
  blockTime: Date;
  // For burns
  burnedTokenMint?: string;
  burnedTokenAmount?: bigint;
}

// Known program IDs
const JUPITER_V6_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const RAYDIUM_AMM_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// Burn address (tokens sent here are burned)
const BURN_ADDRESS = "1nc1nerator11111111111111111111111111111111";

/**
 * Classify a parsed transaction from Helius
 */
export function classifyTransaction(
  tx: ParsedTransaction,
  creatorVault: string,
  creatorWallet: string,
  tokenMint: string
): ClassifiedEvent | null {
  if (!tx || tx.transactionError) {
    return null;
  }

  const signature = tx.signature;
  const blockTime = new Date((tx.timestamp ?? 0) * 1000);

  // Check native transfers for SOL movements
  const nativeTransfers = tx.nativeTransfers || [];
  const tokenTransfers = tx.tokenTransfers || [];

  // Look for SOL moving into vault (collect)
  const collectTransfer = nativeTransfers.find(
    (t) => t.toUserAccount === creatorVault && t.fromUserAccount !== creatorWallet
  );

  if (collectTransfer) {
    return {
      type: "collect",
      amountLamports: safeBigInt(collectTransfer.amount),
      signature,
      blockTime,
    };
  }

  // Look for SOL leaving vault
  const vaultOutflow = nativeTransfers.find(
    (t) => t.fromUserAccount === creatorVault
  );

  if (!vaultOutflow) {
    return null;
  }

  const outflowAmount = safeBigInt(vaultOutflow.amount);

  // Check if this is a burn (swap + burn in same tx)
  const hasSwap = hasSwapInstruction(tx);
  const burnInfo = findBurnInTransaction(tx, tokenMint);

  if (hasSwap && burnInfo) {
    return {
      type: "burn",
      amountLamports: outflowAmount,
      signature,
      blockTime,
      burnedTokenMint: tokenMint,
      burnedTokenAmount: burnInfo.amount,
    };
  }

  // Check if going to creator wallet (withdraw)
  if (vaultOutflow.toUserAccount === creatorWallet) {
    return {
      type: "withdraw",
      amountLamports: outflowAmount,
      signature,
      blockTime,
    };
  }

  // If SOL left vault but not to creator and no burn detected,
  // check for DEX swap patterns that indicate burn
  if (hasSwap) {
    // Look for token transfer to burn address or burn instruction
    const tokenBurn = tokenTransfers.find(
      (t) =>
        t.mint === tokenMint &&
        (t.toUserAccount === BURN_ADDRESS ||
          t.toUserAccount === "" ||
          t.toTokenAccount === "")
    );

    if (tokenBurn) {
      return {
        type: "burn",
        amountLamports: outflowAmount,
        signature,
        blockTime,
        burnedTokenMint: tokenMint,
        burnedTokenAmount: safeBigInt(tokenBurn.tokenAmount),
      };
    }
  }

  // Default: if SOL left vault to unknown destination without clear burn,
  // classify as withdraw (conservative)
  return {
    type: "withdraw",
    amountLamports: outflowAmount,
    signature,
    blockTime,
  };
}

/**
 * Check if transaction contains a swap instruction
 */
function hasSwapInstruction(tx: ParsedTransaction): boolean {
  const accountData = tx.accountData || [];
  const instructions = tx.instructions || [];

  // Check for Jupiter or Raydium program involvement
  const hasJupiter = accountData.some((a) =>
    a.account?.includes(JUPITER_V6_PROGRAM_ID)
  );
  const hasRaydium = accountData.some((a) =>
    a.account?.includes(RAYDIUM_AMM_PROGRAM_ID)
  );

  if (hasJupiter || hasRaydium) {
    return true;
  }

  // Also check instructions
  for (const ix of instructions) {
    if (
      ix.programId === JUPITER_V6_PROGRAM_ID ||
      ix.programId === RAYDIUM_AMM_PROGRAM_ID
    ) {
      return true;
    }
  }

  // Check for swap in description
  const description = tx.description?.toLowerCase() || "";
  if (
    description.includes("swap") ||
    description.includes("jupiter") ||
    description.includes("raydium")
  ) {
    return true;
  }

  return false;
}

/**
 * Find burn evidence in transaction
 */
function findBurnInTransaction(
  tx: ParsedTransaction,
  tokenMint: string
): { amount: bigint } | null {
  const tokenTransfers = tx.tokenTransfers || [];
  const instructions = tx.instructions || [];

  // Look for direct burn instruction
  for (const ix of instructions) {
    if (ix.programId === TOKEN_PROGRAM_ID) {
      // Check for Burn instruction type
      const innerIx = (ix as { innerInstructions?: { type?: string }[] })
        .innerInstructions;
      if (innerIx?.some((inner) => inner.type === "burn")) {
        // Find the amount from token transfers
        const burnTransfer = tokenTransfers.find(
          (t) => t.mint === tokenMint && !t.toUserAccount
        );
        if (burnTransfer) {
          return { amount: safeBigInt(burnTransfer.tokenAmount) };
        }
      }
    }
  }

  // Look for transfer to burn address
  const toBurnAddress = tokenTransfers.find(
    (t) =>
      t.mint === tokenMint &&
      (t.toUserAccount === BURN_ADDRESS || t.toTokenAccount === "")
  );

  if (toBurnAddress) {
    return { amount: safeBigInt(toBurnAddress.tokenAmount) };
  }

  // Look for events that indicate burn
  const events = tx.events || {};
  if (events.burn) {
    return { amount: safeBigInt(events.burn.amount) };
  }

  return null;
}

/**
 * Batch classify multiple transactions
 */
export function classifyTransactions(
  transactions: ParsedTransaction[],
  creatorVault: string,
  creatorWallet: string,
  tokenMint: string
): ClassifiedEvent[] {
  const events: ClassifiedEvent[] = [];

  for (const tx of transactions) {
    const event = classifyTransaction(tx, creatorVault, creatorWallet, tokenMint);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Calculate stats from classified events
 */
export function calculateEventStats(events: ClassifiedEvent[]): {
  totalCollected: bigint;
  totalBurned: bigint;
  totalWithdrawn: bigint;
  collectCount: number;
  burnCount: number;
  withdrawCount: number;
} {
  let totalCollected = BigInt(0);
  let totalBurned = BigInt(0);
  let totalWithdrawn = BigInt(0);
  let collectCount = 0;
  let burnCount = 0;
  let withdrawCount = 0;

  for (const event of events) {
    switch (event.type) {
      case "collect":
        totalCollected += event.amountLamports;
        collectCount++;
        break;
      case "burn":
        totalBurned += event.amountLamports;
        burnCount++;
        break;
      case "withdraw":
        totalWithdrawn += event.amountLamports;
        withdrawCount++;
        break;
    }
  }

  return {
    totalCollected,
    totalBurned,
    totalWithdrawn,
    collectCount,
    burnCount,
    withdrawCount,
  };
}
