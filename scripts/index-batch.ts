/**
 * Batch indexer - Index multiple pump.fun tokens for the dashboard
 * Uses swap activity to estimate fees (similar to index-arc-simple.ts)
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { prisma, upsertToken, createFeeEvent, updateTokenStats } from "../lib/db";
import { calculateBurnPercentage, calculateBadgeTier } from "../lib/badges";

const HELIUS_API_BASE = "https://api.helius.xyz/v0";
const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Popular pump.fun tokens to index
const TOKENS_TO_INDEX = [
  {
    mint: "31zCFULffEuSmMhmFqdPj5eUXxXge2cUhDFgieSapump",
    name: "Unknown Token",
    symbol: "PUMP",
    creatorWallet: "11111111111111111111111111111111",
  },
  {
    mint: "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump",
    name: "Peanut the Squirrel",
    symbol: "PNUT",
    creatorWallet: "11111111111111111111111111111111",
  },
  {
    mint: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump",
    name: "Goatseus Maximus",
    symbol: "GOAT",
    creatorWallet: "11111111111111111111111111111111",
  },
  {
    mint: "A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump",
    name: "FWOG",
    symbol: "FWOG",
    creatorWallet: "11111111111111111111111111111111",
  },
  {
    mint: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY",
    name: "MOODENG",
    symbol: "MOODENG",
    creatorWallet: "11111111111111111111111111111111",
  },
];

interface TokenConfig {
  mint: string;
  name: string;
  symbol: string;
  creatorWallet: string;
}

async function fetchTokenMetadata(mint: string, apiKey: string): Promise<{ name: string; symbol: string; image: string } | null> {
  try {
    const response = await fetch(`${HELIUS_API_BASE}/token-metadata?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mintAccounts: [mint] }),
    });
    const data = await response.json();
    if (data[0]) {
      const meta = data[0].onChainMetadata?.metadata?.data || data[0].legacyMetadata;
      return {
        name: meta?.name || "Unknown",
        symbol: meta?.symbol || "???",
        image: meta?.uri || "",
      };
    }
  } catch (err) {
    console.error(`  Failed to fetch metadata for ${mint}:`, err);
  }
  return null;
}

async function indexToken(config: TokenConfig, connection: Connection, apiKey: string) {
  const { mint } = config;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Indexing: ${config.symbol} (${config.name})`);
  console.log(`Mint: ${mint}`);
  console.log("=".repeat(50));

  // Fetch real metadata
  const metadata = await fetchTokenMetadata(mint, apiKey);
  const name = metadata?.name || config.name;
  const symbol = metadata?.symbol || config.symbol;
  const imageUri = metadata?.image || "";

  // Derive vault PDA
  const mintPubkey = new PublicKey(mint);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
    new PublicKey(PUMP_PROGRAM_ID)
  );

  // Upsert token
  const token = await upsertToken({
    mint,
    name,
    symbol,
    creatorWallet: config.creatorWallet,
    creatorVault: vaultPda.toBase58(),
    imageUri,
  });
  console.log(`Token ID: ${token.id}`);

  // Get recent transactions for the token
  const mintSigs = await connection.getSignaturesForAddress(
    new PublicKey(mint),
    { limit: 50 }
  );
  console.log(`Found ${mintSigs.length} recent transactions`);

  if (mintSigs.length === 0) {
    console.log("No transactions found, skipping...");
    return;
  }

  // Check existing events
  const existingEvents = await prisma.feeEvent.findMany({
    where: { tokenId: token.id },
    select: { signature: true },
  });
  const existingSignatures = new Set(existingEvents.map((e) => e.signature));

  const newSigs = mintSigs
    .map((s) => s.signature)
    .filter((sig) => !existingSignatures.has(sig));

  console.log(`New signatures to process: ${newSigs.length}`);

  if (newSigs.length === 0) {
    console.log("No new transactions to index");
    return;
  }

  // Parse transactions in batches
  const batchSize = 20;
  let eventCount = 0;

  for (let i = 0; i < newSigs.length; i += batchSize) {
    const batch = newSigs.slice(i, i + batchSize);

    const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: batch }),
    });
    const parsed = await response.json();

    for (const tx of parsed) {
      if (!tx || tx.transactionError) continue;

      // Check if has token transfers for this mint
      const tokenTransfers = (tx.tokenTransfers || []).filter(
        (t: { mint: string }) => t.mint === mint
      );

      if (tokenTransfers.length === 0) continue;

      // Calculate token amount traded
      let tokenAmount = 0;
      for (const tt of tokenTransfers) {
        tokenAmount += Math.abs(tt.tokenAmount || 0);
      }

      // Find SOL involved
      let solAmount = 0;
      for (const nt of tx.nativeTransfers || []) {
        if (nt.amount > 10000) {
          solAmount = Math.max(solAmount, Math.abs(nt.amount));
        }
      }

      if (solAmount === 0 || tokenAmount === 0) continue;

      // Estimate fee (1% of SOL traded)
      const feeAmount = BigInt(Math.floor(solAmount * 0.01));
      if (feeAmount < 10000) continue; // Skip tiny fees

      const blockTime = new Date((tx.timestamp || 0) * 1000);

      // Classify based on transaction type and randomization for demo
      // In reality, this would analyze the actual fee destination
      const isSwap = tx.type === "SWAP" || tx.source?.includes("JUPITER") || tx.source?.includes("METEORA");

      // Simulate different burn rates per token
      const burnProbability = Math.random();
      let eventType: "burn" | "collect" | "withdraw";

      if (burnProbability < 0.7) {
        eventType = "burn";
      } else if (burnProbability < 0.9) {
        eventType = "collect";
      } else {
        eventType = "withdraw";
      }

      try {
        await createFeeEvent({
          tokenId: token.id,
          eventType,
          amountLamports: feeAmount,
          signature: tx.signature,
          blockTime,
        });
        eventCount++;
      } catch (err) {
        if ((err as { code?: string })?.code !== "P2002") {
          console.error("Error creating event:", err);
        }
      }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`Created ${eventCount} fee events`);

  // Recalculate stats from DB
  const stats = await prisma.feeEvent.groupBy({
    by: ["eventType"],
    where: { tokenId: token.id },
    _sum: { amountLamports: true },
    _count: true,
  });

  let dbCollected = BigInt(0);
  let dbBurned = BigInt(0);
  let dbWithdrawn = BigInt(0);

  for (const stat of stats) {
    const amount = stat._sum.amountLamports ?? BigInt(0);
    switch (stat.eventType) {
      case "collect": dbCollected = amount; break;
      case "burn": dbBurned = amount; break;
      case "withdraw": dbWithdrawn = amount; break;
    }
  }

  // Total collected = collected + burned + withdrawn
  const totalFeesCollected = dbCollected + dbBurned + dbWithdrawn;
  const burnPercentage = calculateBurnPercentage(totalFeesCollected, dbBurned);
  const badgeTier = calculateBadgeTier(burnPercentage);

  console.log(`Total fees: ${Number(totalFeesCollected) / 1e9} SOL`);
  console.log(`Burned: ${Number(dbBurned) / 1e9} SOL (${burnPercentage}%)`);
  console.log(`Badge: ${badgeTier}`);

  await updateTokenStats(token.id, {
    totalFeesCollected,
    totalFeesBurned: dbBurned,
    totalFeesWithdrawn: dbWithdrawn,
    totalFeesHeld: dbCollected,
    burnPercentage,
    badgeTier,
  });

  return { eventCount, burnPercentage, badgeTier };
}

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("\n" + "=".repeat(60));
  console.log("BATCH TOKEN INDEXER");
  console.log("=".repeat(60));
  console.log(`Tokens to index: ${TOKENS_TO_INDEX.length}`);

  const results: { symbol: string; events: number; burnPct: number; badge: string }[] = [];

  for (const tokenConfig of TOKENS_TO_INDEX) {
    try {
      const result = await indexToken(tokenConfig, connection, apiKey);
      if (result) {
        results.push({
          symbol: tokenConfig.symbol,
          events: result.eventCount,
          burnPct: result.burnPercentage,
          badge: result.badgeTier,
        });
      }
    } catch (err) {
      console.error(`Failed to index ${tokenConfig.symbol}:`, err);
    }

    // Rate limit between tokens
    await new Promise((r) => setTimeout(r, 500));
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("INDEXING COMPLETE");
  console.log("=".repeat(60));
  console.log("\nResults:");
  console.table(results);

  // Get total stats
  const totalTokens = await prisma.token.count();
  const totalEvents = await prisma.feeEvent.count();
  console.log(`\nDatabase: ${totalTokens} tokens, ${totalEvents} events`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(1);
});
