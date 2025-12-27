/**
 * Check database for fee events
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  console.log("Checking database...\n");

  // Get all tokens
  const tokens = await prisma.token.findMany({
    include: {
      _count: {
        select: { feeEvents: true },
      },
    },
  });

  console.log(`Tokens: ${tokens.length}`);
  console.log("-".repeat(60));

  for (const token of tokens) {
    console.log(`\n${token.symbol || token.name || "Unknown"} (${token.mint.slice(0, 20)}...)`);
    console.log(`  Events: ${token._count.feeEvents}`);
    console.log(`  Collected: ${Number(token.totalFeesCollected) / 1e9} SOL`);
    console.log(`  Burned: ${Number(token.totalFeesBurned) / 1e9} SOL`);
    console.log(`  Withdrawn: ${Number(token.totalFeesWithdrawn) / 1e9} SOL`);
    console.log(`  Burn %: ${token.burnPercentage}%`);
    console.log(`  Badge: ${token.badgeTier}`);
  }

  // Get all fee events
  const events = await prisma.feeEvent.findMany({
    take: 20,
    orderBy: { blockTime: "desc" },
    include: {
      token: { select: { symbol: true } },
    },
  });

  console.log(`\n\nRecent Fee Events: ${events.length}`);
  console.log("-".repeat(60));

  for (const event of events) {
    const sol = Number(event.amountLamports) / 1e9;
    console.log(`${event.eventType.toUpperCase().padEnd(10)} ${sol.toFixed(6)} SOL | ${event.token?.symbol || "?"} | ${event.blockTime.toISOString().slice(0, 19)}`);
  }

  // Get creators
  const creators = await prisma.creator.findMany();
  console.log(`\n\nCreators: ${creators.length}`);

  for (const creator of creators) {
    console.log(`  ${creator.wallet.slice(0, 20)}... (${creator.totalTokensCreated} tokens)`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  prisma.$disconnect();
});
