/**
 * Test Helius SDK v2 with correct syntax
 */
import "dotenv/config";
import { createHelius } from "helius-sdk";
import { Connection } from "@solana/web3.js";

const MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";

interface AssetResponse {
  content?: {
    metadata?: {
      symbol?: string;
    };
  };
}

async function test() {
  const apiKey = process.env.HELIUS_API_KEY;
  console.log("API Key length:", apiKey?.length);

  if (!apiKey) {
    console.error("No API key!");
    process.exit(1);
  }

  // V2 correct syntax: object with apiKey and network
  const helius = createHelius({ apiKey, network: "mainnet" });

  // Separate connection for RPC calls
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("\nHelius instance created");
  console.log("Available methods:", Object.keys(helius).slice(0, 15).join(", "));

  // Test 1: getAsset
  console.log("\n1. Testing getAsset...");
  try {
    const asset = (await helius.getAsset({ id: MINT })) as AssetResponse;
    console.log("   OK! Token:", asset?.content?.metadata?.symbol);
  } catch (e) {
    const error = e as Error;
    console.error("   ERROR:", error.message);
  }

  // Test 2: Get transactions via REST API (parseTransactions)
  console.log("\n2. Testing parseTransactions via REST...");
  try {
    const response = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions: ["5wHu1qwD7q5ifaN5nwdcDqNFo53GJqa7nLp2BeeEpcHCusb4GzARz4GjhUXgCnkJxZzo5TpVJgXfq5zqxXodqpYV"],
      }),
    });
    const data = await response.json();
    console.log("   OK! Parsed", Array.isArray(data) ? data.length : 0, "transactions");
  } catch (e) {
    const error = e as Error;
    console.error("   ERROR:", error.message);
  }

  // Test 3: Connection via @solana/web3.js
  console.log("\n3. Testing @solana/web3.js Connection...");
  try {
    const slot = await connection.getSlot();
    console.log("   OK! Current slot:", slot);
  } catch (e) {
    const error = e as Error;
    console.error("   ERROR:", error.message);
  }

  console.log("\nDone!");
  process.exit(0);
}

test().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
