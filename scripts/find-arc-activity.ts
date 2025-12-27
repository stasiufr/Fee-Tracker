/**
 * Find ARC token trading activity
 * ARC likely graduated to Raydium and trades there
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

  console.log("Finding ARC token trading activity\n");
  console.log(`Mint: ${ARC_MINT}`);

  // Get token account info
  console.log("\nToken on-chain info:");
  const mintInfo = await connection.getAccountInfo(new PublicKey(ARC_MINT));
  console.log(`  Account exists: ${!!mintInfo}`);

  // Get token supply
  const supply = await connection.getTokenSupply(new PublicKey(ARC_MINT));
  console.log(`  Supply: ${(Number(supply.value.amount) / 1e6).toLocaleString()} tokens`);
  console.log(`  Decimals: ${supply.value.decimals}`);

  // Search for transactions involving this mint directly
  console.log("\n\nSearching for ARC transactions...");

  // Use getTransactionsForAddress with the mint account
  const mintSigs = await connection.getSignaturesForAddress(
    new PublicKey(ARC_MINT),
    { limit: 30 }
  );

  console.log(`Found ${mintSigs.length} transactions involving the mint account`);

  if (mintSigs.length > 0) {
    // Parse them
    const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: mintSigs.slice(0, 20).map((s) => s.signature) }),
    });
    const parsed = await response.json();

    console.log("\nRecent transactions:");

    for (const tx of parsed.slice(0, 10)) {
      console.log("\n" + "=".repeat(60));
      console.log(`Sig: ${tx.signature?.slice(0, 40)}...`);
      console.log(`Type: ${tx.type} | Source: ${tx.source}`);
      console.log(`Time: ${new Date((tx.timestamp || 0) * 1000).toISOString()}`);
      console.log(`Fee payer: ${tx.feePayer?.slice(0, 20)}...`);

      // Show token transfers
      const arcTransfers = (tx.tokenTransfers || []).filter(
        (t: { mint: string }) => t.mint === ARC_MINT
      );

      if (arcTransfers.length > 0) {
        console.log("\nARC token transfers:");
        for (const tt of arcTransfers) {
          console.log(`  ${tt.fromUserAccount?.slice(0, 15) || "???"}... → ${tt.toUserAccount?.slice(0, 15) || "???"}...`);
          console.log(`  Amount: ${(tt.tokenAmount || 0).toLocaleString()} ARC`);
        }
      }

      // Show SOL flows
      if (tx.nativeTransfers?.length > 0) {
        const significant = tx.nativeTransfers.filter(
          (nt: { amount: number }) => nt.amount > 1000000 // > 0.001 SOL
        );
        if (significant.length > 0) {
          console.log("\nSOL transfers:");
          for (const nt of significant.slice(0, 3)) {
            console.log(`  ${(nt.amount / 1e9).toFixed(6)} SOL`);
          }
        }
      }

      // Check for swap events
      if (tx.events?.swap) {
        console.log("\nSwap detected!");
        console.log(`  Input: ${JSON.stringify(tx.events.swap.nativeInput || tx.events.swap.tokenInputs)}`);
        console.log(`  Output: ${JSON.stringify(tx.events.swap.nativeOutput || tx.events.swap.tokenOutputs)}`);
      }
    }
  }

  // Also check the token's largest holders
  console.log("\n\nFetching largest token holders...");
  const largestAccounts = await connection.getTokenLargestAccounts(new PublicKey(ARC_MINT));

  console.log("Top holders:");
  for (const account of largestAccounts.value.slice(0, 5)) {
    const pct = (Number(account.amount) / Number(supply.value.amount) * 100).toFixed(2);
    console.log(`  ${account.address.toBase58().slice(0, 20)}...: ${(Number(account.amount) / 1e6).toLocaleString()} (${pct}%)`);
  }
}

main().catch(console.error);
