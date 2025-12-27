/**
 * Add demo fee events to make the dashboard more interesting
 * Uses realistic patterns based on ARC token activity
 */
import "dotenv/config";
import { prisma, updateTokenStats } from "../lib/db";
import { calculateBurnPercentage, calculateBadgeTier } from "../lib/badges";

async function main() {
  console.log("Adding demo fee events...\n");

  // Get ARC token
  const token = await prisma.token.findFirst({
    where: { symbol: "arc" },
  });

  if (!token) {
    console.error("ARC token not found!");
    await prisma.$disconnect();
    return;
  }

  console.log(`Token: ${token.symbol} (ID: ${token.id})`);

  // Create realistic fee events over the past 7 days
  const now = new Date();
  const events = [];

  // Generate 50 events with 85% burn rate (good burner)
  for (let i = 0; i < 50; i++) {
    const hoursAgo = Math.random() * 168; // Last 7 days
    const blockTime = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

    // Random SOL amount between 0.01 and 2 SOL
    const solAmount = 0.01 + Math.random() * 1.99;
    const lamports = BigInt(Math.floor(solAmount * 1e9));

    // 85% burn, 10% collect, 5% withdraw
    const rand = Math.random();
    let eventType: "burn" | "collect" | "withdraw";
    if (rand < 0.85) {
      eventType = "burn";
    } else if (rand < 0.95) {
      eventType = "collect";
    } else {
      eventType = "withdraw";
    }

    // Generate unique signature
    const sig = `demo_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`;

    events.push({
      tokenId: token.id,
      eventType,
      amountLamports: lamports,
      signature: sig,
      blockTime,
    });
  }

  // Insert events
  let created = 0;
  for (const event of events) {
    try {
      await prisma.feeEvent.create({ data: event });
      created++;
    } catch (err) {
      // Skip duplicates
    }
  }

  console.log(`Created ${created} demo events`);

  // Recalculate stats
  const stats = await prisma.feeEvent.groupBy({
    by: ["eventType"],
    where: { tokenId: token.id },
    _sum: { amountLamports: true },
    _count: true,
  });

  let collected = BigInt(0);
  let burned = BigInt(0);
  let withdrawn = BigInt(0);

  console.log("\nEvent stats:");
  for (const stat of stats) {
    const amount = stat._sum.amountLamports ?? BigInt(0);
    console.log(`  ${stat.eventType}: ${stat._count} events, ${(Number(amount) / 1e9).toFixed(4)} SOL`);

    switch (stat.eventType) {
      case "collect": collected = amount; break;
      case "burn": burned = amount; break;
      case "withdraw": withdrawn = amount; break;
    }
  }

  // Total collected = what was collected + what was burned + what was withdrawn
  const totalCollected = collected + burned + withdrawn;
  const burnPercentage = calculateBurnPercentage(totalCollected, burned);
  const badgeTier = calculateBadgeTier(burnPercentage);

  console.log(`\nTotal collected: ${Number(totalCollected) / 1e9} SOL`);
  console.log(`Total burned: ${Number(burned) / 1e9} SOL`);
  console.log(`Total withdrawn: ${Number(withdrawn) / 1e9} SOL`);
  console.log(`Burn percentage: ${burnPercentage}%`);
  console.log(`Badge tier: ${badgeTier}`);

  await updateTokenStats(token.id, {
    totalFeesCollected: totalCollected,
    totalFeesBurned: burned,
    totalFeesWithdrawn: withdrawn,
    totalFeesHeld: collected,
    burnPercentage,
    badgeTier,
  });

  console.log("\nDone!");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  prisma.$disconnect();
});
