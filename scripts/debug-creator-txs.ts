/**
 * Debug creator wallet transactions
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

const HELIUS_API_BASE = "https://api.helius.xyz/v0";
const ARC_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";
const ARC_CREATOR = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM";
const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("Debugging creator wallet transactions\n");
  console.log(`Creator: ${ARC_CREATOR}`);
  console.log(`ARC Mint: ${ARC_MINT}`);

  // Get creator transactions
  const sigs = await connection.getSignaturesForAddress(
    new PublicKey(ARC_CREATOR),
    { limit: 20 }
  );

  console.log(`\nFound ${sigs.length} transactions\n`);

  // Parse them
  const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: sigs.map((s) => s.signature) }),
  });
  const parsed = await response.json();

  for (const tx of parsed) {
    console.log("=".repeat(60));
    console.log(`Sig: ${tx.signature?.slice(0, 40)}...`);
    console.log(`Type: ${tx.type} | Source: ${tx.source}`);
    console.log(`Time: ${new Date((tx.timestamp || 0) * 1000).toISOString()}`);
    console.log(`Description: ${tx.description?.slice(0, 100) || "N/A"}`);

    // Check for ARC token
    const hasARC = tx.tokenTransfers?.some(
      (t: { mint: string }) => t.mint === ARC_MINT
    );
    console.log(`Has ARC token: ${hasARC}`);

    // Check for pump.fun program
    const hasPump = tx.instructions?.some(
      (ix: { programId: string }) => ix.programId === PUMP_PROGRAM_ID
    );
    console.log(`Has pump.fun: ${hasPump}`);

    // Show SOL flows
    if (tx.nativeTransfers?.length > 0) {
      console.log("\nSOL transfers:");
      for (const nt of tx.nativeTransfers) {
        const isFromCreator = nt.fromUserAccount === ARC_CREATOR;
        const isToCreator = nt.toUserAccount === ARC_CREATOR;
        const marker = isFromCreator ? "←OUT" : isToCreator ? "IN→" : "";
        console.log(
          `  ${nt.fromUserAccount?.slice(0, 12)}... → ${nt.toUserAccount?.slice(0, 12)}...: ${(nt.amount / 1e9).toFixed(6)} SOL ${marker}`
        );
      }
    }

    // Show token transfers
    if (tx.tokenTransfers?.length > 0) {
      console.log("\nToken transfers:");
      for (const tt of tx.tokenTransfers) {
        const isARC = tt.mint === ARC_MINT;
        console.log(
          `  ${tt.mint?.slice(0, 12)}... ${tt.tokenAmount?.toFixed(2)} tokens ${isARC ? "(ARC)" : ""}`
        );
      }
    }

    // Show programs involved
    const programs = new Set(tx.instructions?.map((ix: { programId: string }) => ix.programId) || []);
    console.log(`\nPrograms: ${[...programs].slice(0, 5).join(", ")}...`);

    console.log("");
  }
}

main().catch(console.error);
