/**
 * Index pump.fun fees by tracking creator wallet instead of vault
 * Since pump.fun sends fees directly to creators, not to a vault PDA
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { prisma, upsertToken, createFeeEvent, updateTokenStats } from "../lib/db";
import { calculateBurnPercentage, calculateBadgeTier } from "../lib/badges";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const HELIUS_API_BASE = "https://api.helius.xyz/v0";

// ARC token - the actual token at the mint address from CLAUDE.md
const ARC_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";
const ARC_CREATOR = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";

// Known pump.fun fee recipients (protocol fees, not creator fees)
const PROTOCOL_FEE_RECIPIENTS = [
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
];

interface FeeEvent {
  type: "collect" | "burn" | "withdraw";
  amountLamports: bigint;
  signature: string;
  blockTime: Date;
  description?: string;
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
  console.log("Indexing ARC token by tracking creator wallet");
  console.log("=".repeat(60));
  console.log(`\nMint: ${ARC_MINT}`);
  console.log(`Creator: ${ARC_CREATOR}`);

  // Derive vault PDA (even if not used, we need it for the DB)
  const mintPubkey = new PublicKey(ARC_MINT);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
    new PublicKey(PUMP_PROGRAM_ID)
  );
  console.log(`Vault PDA: ${vaultPda.toBase58()}`);

  // Ensure token exists in DB
  console.log("\nUpserting token...");
  const token = await upsertToken({
    mint: ARC_MINT,
    name: "AI Rig Complex",
    symbol: "arc",
    creatorWallet: ARC_CREATOR,
    creatorVault: vaultPda.toBase58(),
    imageUri: "https://ipfs.io/ipfs/QmPDJuEobBcLZihjFCvkWA8c1FiW7UzM2ctFdiffSLxf1d",
  });
  console.log(`Token ID: ${token.id}`);

  // Get creator wallet transactions
  console.log("\nFetching creator wallet transactions...");
  const creatorSigs = await connection.getSignaturesForAddress(
    new PublicKey(ARC_CREATOR),
    { limit: 100 }
  );
  console.log(`Found ${creatorSigs.length} transactions`);

  if (creatorSigs.length === 0) {
    console.log("No transactions found");
    await prisma.$disconnect();
    return;
  }

  // Get existing signatures to avoid duplicates
  const existingEvents = await prisma.feeEvent.findMany({
    where: { tokenId: token.id },
    select: { signature: true },
  });
  const existingSignatures = new Set(existingEvents.map((e) => e.signature));
  console.log(`Existing events: ${existingSignatures.size}`);

  // Filter new signatures
  const newSigs = creatorSigs
    .map((s) => s.signature)
    .filter((sig) => !existingSignatures.has(sig));

  console.log(`New signatures to process: ${newSigs.length}`);

  if (newSigs.length === 0) {
    console.log("No new transactions");
    await prisma.$disconnect();
    return;
  }

  // Parse transactions in batches
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

      // Check if this transaction involves the ARC token
      const hasARCTransfer = tx.tokenTransfers?.some(
        (t: { mint: string }) => t.mint === ARC_MINT
      );

      // Check if this transaction involves pump.fun
      const hasPumpProgram = tx.instructions?.some(
        (ix: { programId: string }) => ix.programId === PUMP_PROGRAM_ID
      );

      if (!hasARCTransfer && !hasPumpProgram) continue;

      // Analyze SOL flows to/from creator
      const nativeTransfers = tx.nativeTransfers || [];

      // SOL received by creator from pump.fun trades = "collect"
      const received = nativeTransfers.filter(
        (nt: { toUserAccount: string; fromUserAccount: string }) =>
          nt.toUserAccount === ARC_CREATOR &&
          !PROTOCOL_FEE_RECIPIENTS.includes(nt.fromUserAccount)
      );

      // SOL sent by creator (could be burn or withdrawal)
      const sent = nativeTransfers.filter(
        (nt: { fromUserAccount: string }) => nt.fromUserAccount === ARC_CREATOR
      );

      for (const r of received) {
        const event: FeeEvent = {
          type: "collect",
          amountLamports: BigInt(Math.floor(r.amount)),
          signature: tx.signature,
          blockTime: new Date((tx.timestamp || 0) * 1000),
          description: tx.description,
        };
        allEvents.push(event);

        // Check for burn pattern: creator receives SOL AND there's a token burn
        const hasBurn = tx.events?.burn || tx.tokenTransfers?.some(
          (t: { mint: string; toTokenAccount: string }) =>
            t.mint === ARC_MINT && t.toTokenAccount === ""
        );

        if (hasBurn) {
          event.type = "burn";
        }
      }

      // Track SOL leaving creator wallet
      for (const s of sent) {
        const event: FeeEvent = {
          type: "withdraw",
          amountLamports: BigInt(Math.floor(s.amount)),
          signature: tx.signature,
          blockTime: new Date((tx.timestamp || 0) * 1000),
          description: tx.description,
        };

        // Check if this is a burn (swap + burn)
        const hasSwap = tx.type === "SWAP" || tx.description?.toLowerCase().includes("swap");
        const hasBurn = tx.events?.burn || tx.tokenTransfers?.some(
          (t: { mint: string; toTokenAccount: string }) =>
            t.mint === ARC_MINT && t.toTokenAccount === ""
        );

        if (hasSwap && hasBurn) {
          event.type = "burn";
        }

        allEvents.push(event);
      }
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nClassified ${allEvents.length} events`);

  // Save events to database
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
      // Skip duplicates
      if ((err as { code?: string })?.code !== "P2002") {
        console.error(`Error saving event:`, err);
      }
    }
  }

  console.log(`Saved ${saved} new events`);

  // Calculate stats
  console.log("\nCalculating stats...");
  const statsAggregation = await prisma.feeEvent.groupBy({
    by: ["eventType"],
    where: { tokenId: token.id },
    _sum: { amountLamports: true },
    _count: true,
  });

  let totalCollected = BigInt(0);
  let totalBurned = BigInt(0);
  let totalWithdrawn = BigInt(0);

  for (const stat of statsAggregation) {
    const amount = stat._sum.amountLamports ?? BigInt(0);
    console.log(`  ${stat.eventType}: ${stat._count} events, ${Number(amount) / 1e9} SOL`);

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

  console.log(`\nBurn percentage: ${burnPercentage}%`);
  console.log(`Badge tier: ${badgeTier}`);

  // Update token stats
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
  console.error("Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
