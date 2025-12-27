/**
 * Test Helius SDK v2
 */
import "dotenv/config";
import { createHelius } from "helius-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const VAULT = "4NQ4yGprSPCqvRJmMNV7rnJ81BUcCrgPEq4TVQ1FthYi";
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
  console.log("Network:", process.env.SOLANA_NETWORK);

  if (!apiKey) {
    console.error("No API key!");
    process.exit(1);
  }

  // V2 syntax: object with apiKey and network
  const helius = createHelius({ apiKey, network: "mainnet" });

  // Separate connection for RPC
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  // Test getAsset (DAS API)
  console.log("\n1. Testing getAsset...");
  try {
    const asset = (await helius.getAsset({ id: MINT })) as AssetResponse;
    console.log("   Success! Token:", asset?.content?.metadata?.symbol);
  } catch (e) {
    const error = e as Error;
    console.error("   Error:", error.message);
  }

  // Test getSignaturesForAddress via @solana/web3.js
  console.log("\n2. Testing getSignaturesForAddress...");
  try {
    const pubkey = new PublicKey(VAULT);
    const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 5 });
    console.log("   Success! Signatures:", sigs.length);
  } catch (e) {
    const error = e as Error;
    console.error("   Error:", error.message);
  }

  // Test parseTransactions via REST API
  console.log("\n3. Testing parseTransactions via REST...");
  try {
    const response = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions: ["5wHu1qwD7q5ifaN5nwdcDqNFo53GJqa7nLp2BeeEpcHCusb4GzARz4GjhUXgCnkJxZzo5TpVJgXfq5zqxXodqpYV"],
      }),
    });
    const data = await response.json();
    console.log("   Success! Parsed:", Array.isArray(data) ? data.length : 0, "transactions");
  } catch (e) {
    const error = e as Error;
    console.error("   Error:", error.message);
  }

  console.log("\nDone!");
  process.exit(0);
}

test().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
