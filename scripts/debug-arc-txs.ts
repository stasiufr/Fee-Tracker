/**
 * Debug ARC transaction structure
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

const HELIUS_API_BASE = "https://api.helius.xyz/v0";
const ARC_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("Debugging ARC transaction structure\n");

  // Get transactions
  const mintSigs = await connection.getSignaturesForAddress(
    new PublicKey(ARC_MINT),
    { limit: 10 }
  );

  console.log(`Found ${mintSigs.length} transactions\n`);

  const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: mintSigs.map((s) => s.signature) }),
  });
  const parsed = await response.json();

  for (const tx of parsed.slice(0, 5)) {
    console.log("=".repeat(70));
    console.log(`Sig: ${tx.signature}`);
    console.log(`Type: ${tx.type}`);
    console.log(`Source: ${tx.source}`);

    // Token transfers
    console.log("\nToken Transfers:");
    for (const tt of tx.tokenTransfers || []) {
      console.log(`  Mint: ${tt.mint}`);
      console.log(`  From: ${tt.fromUserAccount}`);
      console.log(`  To: ${tt.toUserAccount}`);
      console.log(`  Amount: ${tt.tokenAmount}`);
      console.log("");
    }

    // Native transfers
    console.log("Native Transfers:");
    for (const nt of tx.nativeTransfers || []) {
      console.log(`  From: ${nt.fromUserAccount}`);
      console.log(`  To: ${nt.toUserAccount}`);
      console.log(`  Amount: ${(nt.amount / 1e9).toFixed(6)} SOL`);
      console.log("");
    }

    // Events
    console.log("Events:", JSON.stringify(tx.events, null, 2));

    console.log("");
  }
}

main().catch(console.error);
