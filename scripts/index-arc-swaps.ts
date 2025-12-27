/**
 * Index ARC token swaps and track fee flows
 * ARC trades on Meteora and other DEXes
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { prisma, upsertToken, createFeeEvent, updateTokenStats } from "../lib/db";
import { calculateBurnPercentage, calculateBadgeTier } from "../lib/badges";

const HELIUS_API_BASE = "https://api.helius.xyz/v0";
const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const ARC_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";

// Known fee recipients
const PROTOCOL_FEE_WALLETS = [
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM", // pump.fun
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV", // pump.fun
];

interface FeeEvent {
  type: "collect" | "burn" | "withdraw";
  amountLamports: bigint;
  signature: string;
  blockTime: Date;
}

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("=".repeat(60));
  console.log("Indexing ARC Token Swap Activity");
  console.log("=".repeat(60));

  // Derive vault PDA
  const mintPubkey = new PublicKey(ARC_MINT);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
    new PublicKey(PUMP_PROGRAM_ID)
  );

  // Get actual token creator from first mint transaction
  // For now, use the metadata authority as placeholder
  const creatorWallet = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";

  // Ensure token exists
  console.log("\nUpserting token...");
  const token = await upsertToken({
    mint: ARC_MINT,
    name: "AI Rig Complex",
    symbol: "arc",
    creatorWallet,
    creatorVault: vaultPda.toBase58(),
    imageUri: "https://ipfs.io/ipfs/QmPDJuEobBcLZihjFCvkWA8c1FiW7UzM2ctFdiffSLxf1d",
  });
  console.log(`Token ID: ${token.id}`);

  // Get transactions involving the mint
  console.log("\nFetching mint transactions...");
  const mintSigs = await connection.getSignaturesForAddress(
    new PublicKey(ARC_MINT),
    { limit: 100 }
  );
  console.log(`Found ${mintSigs.length} transactions`);

  // Get existing signatures
  const existingEvents = await prisma.feeEvent.findMany({
    where: { tokenId: token.id },
    select: { signature: true },
  });
  const existingSignatures = new Set(existingEvents.map((e) => e.signature));
  console.log(`Existing events: ${existingSignatures.size}`);

  // Filter new
  const newSigs = mintSigs
    .map((s) => s.signature)
    .filter((sig) => !existingSignatures.has(sig));
  console.log(`New signatures: ${newSigs.length}`);

  if (newSigs.length === 0) {
    console.log("No new transactions");
    await prisma.$disconnect();
    return;
  }

  // Parse transactions
  const batchSize = 20;
  const allEvents: FeeEvent[] = [];

  for (let i = 0; i < newSigs.length; i += batchSize) {
    const batch = newSigs.slice(i, i + batchSize);
    console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}...`);

    const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: batch }),
    });
    const parsed = await response.json();

    for (const tx of parsed) {
      if (!tx || tx.transactionError) continue;

      const blockTime = new Date((tx.timestamp || 0) * 1000);
      const isSwap = tx.type === "SWAP" || tx.source?.includes("DEX") || tx.source === "METEORA";

      // Look for ARC token transfers
      const arcTransfers = (tx.tokenTransfers || []).filter(
        (t: { mint: string }) => t.mint === ARC_MINT
      );

      if (arcTransfers.length === 0) continue;

      // Calculate total ARC moved
      let arcMoved = 0;
      for (const tt of arcTransfers) {
        arcMoved += Math.abs(tt.tokenAmount || 0);
      }

      // Look for SOL flows (fees)
      const nativeTransfers = tx.nativeTransfers || [];

      // Fees to protocol wallets = "collect" (protocol collects)
      for (const nt of nativeTransfers) {
        if (PROTOCOL_FEE_WALLETS.includes(nt.toUserAccount)) {
          allEvents.push({
            type: "collect",
            amountLamports: BigInt(Math.floor(nt.amount)),
            signature: tx.signature,
            blockTime,
          });
        }
      }

      // For swaps, estimate fee as ~1% of trade value
      if (isSwap && arcMoved > 0) {
        // Find the SOL amount in the swap
        let solAmount = 0;
        for (const nt of nativeTransfers) {
          if (nt.amount > solAmount) {
            solAmount = nt.amount;
          }
        }

        if (solAmount > 0) {
          // Estimate 1% fee
          const estimatedFee = Math.floor(solAmount * 0.01);
          if (estimatedFee > 100000) { // > 0.0001 SOL
            allEvents.push({
              type: "collect",
              amountLamports: BigInt(estimatedFee),
              signature: tx.signature,
              blockTime,
            });
          }
        }
      }

      // Check for burns
      const hasBurn = tx.events?.burn ||
        arcTransfers.some((t: { toUserAccount?: string; toTokenAccount?: string }) =>
          !t.toUserAccount || t.toTokenAccount === ""
        );

      if (hasBurn) {
        // Find SOL amount used for burn
        let burnSol = 0;
        for (const nt of nativeTransfers) {
          burnSol += nt.amount;
        }
        if (burnSol > 0) {
          allEvents.push({
            type: "burn",
            amountLamports: BigInt(Math.floor(burnSol)),
            signature: tx.signature,
            blockTime,
          });
        }
      }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nClassified ${allEvents.length} events`);

  // Save to database
  let saved = 0;
  for (const event of allEvents) {
    try {
      await createFeeEvent({
        tokenId: token.id,
        eventType: event.type,
        amountLamports: event.amountLamports,
        signature: event.signature,
        blockTime: event.blockTime,
      });
      saved++;
    } catch (err) {
      if ((err as { code?: string })?.code !== "P2002") {
        console.error("Error saving event:", err);
      }
    }
  }
  console.log(`Saved ${saved} new events`);

  // Calculate stats
  console.log("\nCalculating stats...");
  const stats = await prisma.feeEvent.groupBy({
    by: ["eventType"],
    where: { tokenId: token.id },
    _sum: { amountLamports: true },
    _count: true,
  });

  let totalCollected = BigInt(0);
  let totalBurned = BigInt(0);
  let totalWithdrawn = BigInt(0);

  for (const stat of stats) {
    const amount = stat._sum.amountLamports ?? BigInt(0);
    const solAmount = Number(amount) / 1e9;
    console.log(`  ${stat.eventType}: ${stat._count} events, ${solAmount.toFixed(4)} SOL`);

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

  const burnPercentage = calculateBurnPercentage(totalCollected, totalBurned);
  const badgeTier = calculateBadgeTier(burnPercentage);

  console.log(`\nTotal collected: ${Number(totalCollected) / 1e9} SOL`);
  console.log(`Total burned: ${Number(totalBurned) / 1e9} SOL`);
  console.log(`Burn percentage: ${burnPercentage}%`);
  console.log(`Badge tier: ${badgeTier}`);

  await updateTokenStats(token.id, {
    totalFeesCollected: totalCollected,
    totalFeesBurned: totalBurned,
    totalFeesWithdrawn: totalWithdrawn,
    totalFeesHeld: totalCollected - totalBurned - totalWithdrawn,
    burnPercentage,
    badgeTier,
  });

  console.log("\n" + "=".repeat(60));
  console.log("Indexing complete!");
  console.log("=".repeat(60));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(1);
});
