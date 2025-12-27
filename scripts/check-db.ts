/**
 * Check database contents
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function checkDb() {
  console.log("=".repeat(50));
  console.log("Database Check");
  console.log("=".repeat(50));

  // Count records
  const tokenCount = await prisma.token.count();
  const creatorCount = await prisma.creator.count();
  const eventCount = await prisma.feeEvent.count();

  console.log("\nRecord counts:");
  console.log("  Tokens:", tokenCount);
  console.log("  Creators:", creatorCount);
  console.log("  Fee Events:", eventCount);

  // Get all tokens
  const tokens = await prisma.token.findMany({
    include: {
      feeEvents: { take: 3 },
      creator: true,
    },
  });

  console.log("\nTokens:");
  for (const token of tokens) {
    console.log("\n  Token:", token.symbol || token.name || token.mint);
    console.log("    Mint:", token.mint);
    console.log("    Creator Vault:", token.creatorVault);
    console.log("    Creator Wallet:", token.creatorWallet);
    console.log("    Total Collected:", Number(token.totalFeesCollected) / 1e9, "SOL");
    console.log("    Total Burned:", Number(token.totalFeesBurned) / 1e9, "SOL");
    console.log("    Total Withdrawn:", Number(token.totalFeesWithdrawn) / 1e9, "SOL");
    console.log("    Burn %:", Number(token.burnPercentage));
    console.log("    Badge:", token.badgeTier);
    console.log("    Fee Events:", token.feeEvents.length);
  }

  // Get creators
  const creators = await prisma.creator.findMany();
  console.log("\nCreators:");
  for (const creator of creators) {
    console.log("  Wallet:", creator.wallet.slice(0, 20) + "...");
    console.log("    Total Tokens:", creator.totalTokensCreated);
    console.log("    Burn %:", Number(creator.overallBurnPercentage));
  }

  console.log("\n" + "=".repeat(50));

  await prisma.$disconnect();
}

checkDb().catch(console.error);
