/**
 * Test RPC methods with Helius v2
 */
import "dotenv/config";
import { createHelius } from "helius-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const VAULT = "4NQ4yGprSPCqvRJmMNV7rnJ81BUcCrgPEq4TVQ1FthYi";

async function test() {
  const apiKey = process.env.HELIUS_API_KEY;
  console.log("API Key length:", apiKey?.length);

  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  // Method 1: Use helius-sdk v2 for DAS API
  const helius = createHelius({ apiKey, network: "mainnet" });
  console.log("\n1. helius.getAsset available:", typeof helius.getAsset === "function");

  // Method 2: Use @solana/web3.js Connection with Helius RPC URL
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("\n2. Testing @solana/web3.js Connection...");
  try {
    const slot = await connection.getSlot();
    console.log("   Current slot:", slot);
  } catch (e) {
    const error = e as Error;
    console.error("   Slot error:", error.message);
  }

  console.log("\n3. Testing getSignaturesForAddress...");
  try {
    const pubkey = new PublicKey(VAULT);
    const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 5 });
    console.log("   Found", sigs.length, "signatures");
    if (sigs.length > 0) {
      console.log("   First:", sigs[0].signature.slice(0, 30) + "...");
    }
  } catch (e) {
    const error = e as Error;
    console.error("   Signatures error:", error.message);
  }

  // Method 3: Test parseTransactions via enhanced API
  console.log("\n4. Testing parseTransactions via REST API...");
  try {
    const response = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions: ["5wHu1qwD7q5ifaN5nwdcDqNFo53GJqa7nLp2BeeEpcHCusb4GzARz4GjhUXgCnkJxZzo5TpVJgXfq5zqxXodqpYV"],
      }),
    });
    const data = await response.json();
    console.log("   Response status:", response.status);
    console.log("   Parsed:", Array.isArray(data) ? data.length : 0, "transactions");
  } catch (e) {
    const error = e as Error;
    console.error("   Parse error:", error.message);
  }

  console.log("\nDone!");
  process.exit(0);
}

test().catch(console.error);
