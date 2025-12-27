/**
 * Find pump.fun token vaults that actually have transactions
 * Searches recent pump tokens and checks their vault PDAs
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const HELIUS_API_BASE = "https://api.helius.xyz/v0";

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("Finding pump.fun tokens with active vaults...\n");

  // Get recent pump.fun transactions to find mints
  const programSigs = await connection.getSignaturesForAddress(
    new PublicKey(PUMP_PROGRAM_ID),
    { limit: 100 }
  );

  console.log(`Found ${programSigs.length} program transactions`);

  // Parse to extract mints
  const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: programSigs.slice(0, 30).map((s) => s.signature) }),
  });
  const parsed = await response.json();

  // Collect unique mints
  const mints = new Set<string>();
  for (const tx of parsed) {
    if (tx.tokenTransfers?.length > 0) {
      for (const tt of tx.tokenTransfers) {
        if (tt.mint && tt.mint.endsWith("pump")) {
          mints.add(tt.mint);
        }
      }
    }
  }

  console.log(`Found ${mints.size} unique pump.fun mints\n`);

  // Check each mint's vault for transactions
  let foundCount = 0;

  for (const mint of mints) {
    try {
      const mintPubkey = new PublicKey(mint);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
        new PublicKey(PUMP_PROGRAM_ID)
      );

      const vaultSigs = await connection.getSignaturesForAddress(vaultPda, { limit: 3 });

      if (vaultSigs.length > 0) {
        foundCount++;
        const balance = await connection.getBalance(vaultPda);

        console.log(`✅ ${mint.slice(0, 20)}...`);
        console.log(`   Vault: ${vaultPda.toBase58()}`);
        console.log(`   Transactions: ${vaultSigs.length}+`);
        console.log(`   Balance: ${(balance / 1e9).toFixed(4)} SOL`);

        if (foundCount === 1) {
          // Get token metadata for the first one
          const metaRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: "1",
              method: "getAsset",
              params: { id: mint },
            }),
          });
          const metaData = await metaRes.json();
          const asset = metaData.result;

          console.log(`   Name: ${asset?.content?.metadata?.name || "Unknown"}`);
          console.log(`   Symbol: ${asset?.content?.metadata?.symbol || "Unknown"}`);
          console.log(`   Authorities: ${(asset?.authorities || []).length}`);

          console.log(`\n${"=".repeat(60)}`);
          console.log(`🎯 BEST CANDIDATE: ${mint}`);
          console.log(`Run: npx tsx -r dotenv/config workers/indexer.ts ${mint}`);
          console.log(`${"=".repeat(60)}\n`);
        }
        console.log("");
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 150));
    } catch {
      // Skip invalid mints
    }
  }

  if (foundCount === 0) {
    console.log("\n❌ No vaults with transactions found in recent activity");
    console.log("This could mean:");
    console.log("  1. Fees haven't been collected yet (still pending)");
    console.log("  2. The vault PDA derivation might be different");
    console.log("  3. These are new tokens without fee activity");
  } else {
    console.log(`\nFound ${foundCount} tokens with vault activity`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
