/**
 * Fee Indexer Worker
 * Polls Helius for pump.fun transactions and indexes fee events
 */

import {
  getTransactionHistory,
  getParsedTransactions,
  getTokenMetadata,
  PUMP_PROGRAM_ID,
} from "../lib/helius";
import {
  classifyTransaction,
  type ClassifiedEvent,
} from "../lib/classifier";
import {
  prisma,
  upsertToken,
  createFeeEvent,
  updateTokenStats,
  getTokenByMint,
} from "../lib/db";
import { calculateBurnPercentage, calculateBadgeTier } from "../lib/badges";

// Reference token for testing
const ASDFASDFA_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";

interface IndexResult {
  tokensProcessed: number;
  newEventsFound: number;
  errors: string[];
}

/**
 * Derive creator vault PDA from mint
 * pump.fun uses: seeds = ["creator_vault", mint.pubkey]
 */
async function deriveCreatorVault(mint: string): Promise<string | null> {
  try {
    const { PublicKey } = await import("@solana/web3.js");
    const mintPubkey = new PublicKey(mint);
    const programId = new PublicKey(PUMP_PROGRAM_ID);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
      programId
    );

    return vaultPda.toBase58();
  } catch (error) {
    console.error(`Error deriving vault for ${mint}:`, error);
    return null;
  }
}

/**
 * Get or create token in database
 */
async function ensureTokenExists(mint: string): Promise<{
  id: number;
  creatorVault: string;
  creatorWallet: string;
} | null> {
  try {
    // Check if already exists
    const existingToken = await getTokenByMint(mint);

    if (existingToken && existingToken.creatorVault && existingToken.creatorWallet) {
      return {
        id: existingToken.id,
        creatorVault: existingToken.creatorVault,
        creatorWallet: existingToken.creatorWallet,
      };
    }

    // Fetch metadata from Helius
    const metadata = await getTokenMetadata(mint);

    // Derive vault PDA
    const creatorVault = await deriveCreatorVault(mint);
    if (!creatorVault) {
      console.error(`Could not derive vault for ${mint}`);
      return null;
    }

    // Get creator wallet from metadata or first authority
    const creatorWallet =
      (metadata as { authorities?: { address: string }[] })?.authorities?.[0]?.address ||
      (metadata as { ownership?: { owner: string } })?.ownership?.owner ||
      "";

    if (!creatorWallet) {
      console.error(`Could not find creator wallet for ${mint}`);
      return null;
    }

    // Upsert token
    const content = metadata?.content as { metadata?: { name?: string; symbol?: string }; links?: { image?: string } } | undefined;
    const newToken = await upsertToken({
      mint,
      name: content?.metadata?.name || metadata?.content?.metadata?.name,
      symbol: content?.metadata?.symbol || metadata?.content?.metadata?.symbol,
      creatorWallet,
      creatorVault,
      imageUri: content?.links?.image,
    });

    console.log(`Created/updated token: ${newToken.symbol || mint}`);

    return {
      id: newToken.id,
      creatorVault,
      creatorWallet,
    };
  } catch (error) {
    console.error(`Error ensuring token ${mint}:`, error);
    return null;
  }
}

/**
 * Index transactions for a single token
 */
async function indexToken(mint: string): Promise<{
  newEvents: number;
  error?: string;
}> {
  console.log(`\nIndexing token: ${mint}`);

  // Ensure token exists in DB
  const tokenInfo = await ensureTokenExists(mint);
  if (!tokenInfo) {
    return { newEvents: 0, error: `Could not setup token ${mint}` };
  }

  const { id: tokenId, creatorVault, creatorWallet } = tokenInfo;

  try {
    // Get transaction history for creator vault
    console.log(`Fetching transactions for vault: ${creatorVault}`);
    const signatures = await getTransactionHistory(creatorVault, { limit: 100 });

    if (!signatures || signatures.length === 0) {
      console.log("No transactions found");
      return { newEvents: 0 };
    }

    console.log(`Found ${signatures.length} transactions`);

    // Get existing signatures to avoid duplicates
    const existingEvents = await prisma.feeEvent.findMany({
      where: { tokenId },
      select: { signature: true },
    });
    const existingSignatures = new Set(existingEvents.map((e: { signature: string }) => e.signature));

    // Filter new signatures
    const newSignatures = signatures
      .map((s) => s.signature)
      .filter((sig) => !existingSignatures.has(sig));

    if (newSignatures.length === 0) {
      console.log("No new transactions to process");
      return { newEvents: 0 };
    }

    console.log(`Processing ${newSignatures.length} new transactions`);

    // Parse transactions in batches of 10
    const batchSize = 10;
    const allEvents: ClassifiedEvent[] = [];

    for (let i = 0; i < newSignatures.length; i += batchSize) {
      const batch = newSignatures.slice(i, i + batchSize);
      const parsed = await getParsedTransactions(batch);

      // Classify each transaction
      for (const tx of parsed) {
        if (!tx) continue;

        const event = classifyTransaction(tx, creatorVault, creatorWallet, mint);
        if (event) {
          allEvents.push(event);

          // Save to database
          try {
            await createFeeEvent({
              tokenId,
              eventType: event.type,
              amountLamports: event.amountLamports,
              signature: event.signature,
              blockTime: event.blockTime,
              burnedTokenMint: event.burnedTokenMint,
              burnedTokenAmount: event.burnedTokenAmount,
            });
          } catch (err) {
            // Skip duplicates
            if ((err as { code?: string })?.code !== "P2002") {
              console.error(`Error saving event ${event.signature}:`, err);
            }
          }
        }
      }

      // Rate limit
      if (i + batchSize < newSignatures.length) {
        await sleep(200);
      }
    }

    console.log(`Classified ${allEvents.length} events`);

    // Recalculate token stats
    await recalculateTokenStats(tokenId, mint);

    return { newEvents: allEvents.length };
  } catch (error) {
    console.error(`Error indexing ${mint}:`, error);
    return { newEvents: 0, error: String(error) };
  }
}

/**
 * Recalculate and update token statistics
 * Uses DB aggregation for efficiency (avoids loading all events into memory)
 */
async function recalculateTokenStats(tokenId: number, mint: string) {
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

  // Calculate held = collected - burned - withdrawn
  const totalHeld = totalCollected - totalBurned - totalWithdrawn;

  // Calculate burn percentage (of collected that was burned)
  const burnPercentage = calculateBurnPercentage(totalCollected, totalBurned);
  const badgeTier = calculateBadgeTier(burnPercentage);

  console.log(`Stats for ${mint}:`);
  console.log(`  Collected: ${totalCollected} lamports`);
  console.log(`  Burned: ${totalBurned} lamports (${burnPercentage}%)`);
  console.log(`  Withdrawn: ${totalWithdrawn} lamports`);
  console.log(`  Held: ${totalHeld} lamports`);
  console.log(`  Badge: ${badgeTier}`);

  // Update token
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
 * Sleep helper for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main indexer function
 */
export async function runIndexer(mints?: string[]): Promise<IndexResult> {
  console.log("=".repeat(50));
  console.log("Starting Fee Indexer");
  console.log("=".repeat(50));

  const result: IndexResult = {
    tokensProcessed: 0,
    newEventsFound: 0,
    errors: [],
  };

  // Use provided mints or default to ASDFASDFA for testing
  const tokensToIndex = mints || [ASDFASDFA_MINT];

  for (const mint of tokensToIndex) {
    const { newEvents, error } = await indexToken(mint);
    result.tokensProcessed++;
    result.newEventsFound += newEvents;

    if (error) {
      result.errors.push(error);
    }

    // Rate limit between tokens
    await sleep(500);
  }

  console.log("\n" + "=".repeat(50));
  console.log("Indexer Complete");
  console.log(`Tokens processed: ${result.tokensProcessed}`);
  console.log(`New events found: ${result.newEventsFound}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log("=".repeat(50));

  return result;
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Check for specific mint argument
  const mints = args.length > 0 ? args : undefined;

  try {
    const result = await runIndexer(mints);

    if (result.errors.length > 0) {
      console.error("\nErrors encountered:");
      result.errors.forEach((e) => console.error(`  - ${e}`));
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
