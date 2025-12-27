/**
 * Devnet Testing Script
 * Tests the fee tracker setup on Solana devnet
 *
 * Run with: npx ts-node --esm scripts/test-devnet.ts
 */

import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

// Force devnet for this script
process.env.SOLANA_NETWORK = "devnet";

async function testDevnetConnection() {
  console.log("=".repeat(50));
  console.log("Devnet Connection Test");
  console.log("=".repeat(50));

  // Test 1: Basic Solana connection
  console.log("\n1. Testing Solana Devnet RPC connection...");
  try {
    const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
    const slot = await connection.getSlot();
    console.log(`   Current slot: ${slot}`);
    console.log("   RPC connection: OK");
  } catch (error) {
    console.error(`   RPC connection: FAILED - ${error}`);
    return false;
  }

  // Test 2: Check if Helius API key is set
  console.log("\n2. Checking Helius API key...");
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) {
    console.log("   Helius API key: NOT SET");
    console.log("   Note: Set HELIUS_API_KEY in .env to enable transaction parsing");
  } else {
    console.log(`   Helius API key: SET (${heliusKey.slice(0, 8)}...)`);

    // Test Helius devnet endpoint
    console.log("\n3. Testing Helius Devnet endpoint...");
    try {
      const heliusRpc = `https://devnet.helius-rpc.com/?api-key=${heliusKey}`;
      const heliusConnection = new Connection(heliusRpc, "confirmed");
      const slot = await heliusConnection.getSlot();
      console.log(`   Helius devnet slot: ${slot}`);
      console.log("   Helius devnet: OK");
    } catch (error) {
      console.error(`   Helius devnet: FAILED - ${error}`);
    }
  }

  // Test 3: Check database connection
  console.log("\n4. Checking database connection...");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("   Database URL: NOT SET");
  } else {
    console.log("   Database URL: SET");
    try {
      // Dynamic import to avoid issues if Prisma isn't generated
      const { prisma } = await import("../lib/db");
      await prisma.$queryRaw`SELECT 1`;
      console.log("   Database connection: OK");
    } catch (error) {
      console.log(`   Database connection: FAILED - ${error}`);
    }
  }

  // Test 4: Check pump.fun program on devnet (if it exists)
  console.log("\n5. Checking pump.fun program on devnet...");
  try {
    const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
    const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    const accountInfo = await connection.getAccountInfo(PUMP_PROGRAM);

    if (accountInfo) {
      console.log("   Pump.fun program: EXISTS on devnet");
      console.log(`   Executable: ${accountInfo.executable}`);
    } else {
      console.log("   Pump.fun program: NOT FOUND on devnet");
      console.log("   Note: pump.fun is mainnet-only. Use test tokens for devnet testing.");
    }
  } catch (error) {
    console.log(`   Pump.fun program check: FAILED - ${error}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("Devnet Test Complete");
  console.log("=".repeat(50));

  console.log("\nNotes for devnet testing:");
  console.log("- pump.fun is only on mainnet, no real tokens on devnet");
  console.log("- You can create test data by inserting mock records in the database");
  console.log("- For full testing, use mainnet with a low-value test token");
  console.log("\nRecommended test setup:");
  console.log("1. Run `npm run db:push` to sync the database schema");
  console.log("2. Insert test tokens via Prisma Studio: `npm run db:studio`");
  console.log("3. Start the dev server: `npm run dev`");
  console.log("4. Test the API at: http://localhost:3000/api/health");

  return true;
}

// Create test data script
async function createTestData() {
  console.log("\n" + "=".repeat(50));
  console.log("Creating Test Data");
  console.log("=".repeat(50));

  try {
    const { prisma } = await import("../lib/db");

    // Create a test token
    const testToken = await prisma.token.upsert({
      where: { mint: "DevnetTestToken11111111111111111111111111" },
      update: {},
      create: {
        mint: "DevnetTestToken11111111111111111111111111",
        name: "Test Token",
        symbol: "$TEST",
        creatorWallet: "TestCreator111111111111111111111111111111",
        creatorVault: "TestVault1111111111111111111111111111111",
        totalFeesCollected: BigInt("100000000000000"), // 100 SOL
        totalFeesBurned: BigInt("85000000000000"), // 85 SOL (85%)
        totalFeesWithdrawn: BigInt("10000000000000"), // 10 SOL
        totalFeesHeld: BigInt("5000000000000"), // 5 SOL
        burnPercentage: 85.0,
        badgeTier: "coffee",
      },
    });

    console.log(`Created/updated test token: ${testToken.symbol}`);
    console.log(`  Mint: ${testToken.mint}`);
    console.log(`  Burn %: ${testToken.burnPercentage}%`);
    console.log(`  Badge: ${testToken.badgeTier}`);

    // Create some test fee events
    const events = [
      { type: "collect", amount: BigInt("50000000000000") },
      { type: "burn", amount: BigInt("45000000000000") },
      { type: "collect", amount: BigInt("50000000000000") },
      { type: "burn", amount: BigInt("40000000000000") },
      { type: "withdraw", amount: BigInt("10000000000000") },
    ];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      try {
        await prisma.feeEvent.create({
          data: {
            tokenId: testToken.id,
            eventType: event.type,
            amountLamports: event.amount,
            signature: `TestSignature${Date.now()}${i}${"1".repeat(40)}`.slice(0, 88),
            blockTime: new Date(Date.now() - i * 3600000), // 1 hour apart
          },
        });
      } catch {
        // Ignore duplicate signature errors
      }
    }

    console.log(`\nCreated ${events.length} test fee events`);
    console.log("\nTest data ready! Access at:");
    console.log("  http://localhost:3000/token/DevnetTestToken11111111111111111111111111");

    await prisma.$disconnect();
  } catch (error) {
    console.error("Failed to create test data:", error);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  await testDevnetConnection();

  if (args.includes("--create-test-data")) {
    await createTestData();
  } else {
    console.log("\nTo create test data, run:");
    console.log("  npx ts-node --esm scripts/test-devnet.ts --create-test-data");
  }
}

main().catch(console.error);
