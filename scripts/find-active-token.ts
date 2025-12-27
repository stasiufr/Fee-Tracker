/**
 * Find an active pump.fun token with real vault activity
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// Known popular pump.fun tokens to try
const POPULAR_TOKENS = [
  // PNUT - popular pump.fun token
  "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump",
  // GOAT - popular AI token
  "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump",
  // FWOG
  "A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump",
  // WIF related
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  // Recent active tokens - check a few
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
];

async function findActiveToken() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("Searching for pump.fun tokens with vault activity...\n");

  for (const mint of POPULAR_TOKENS) {
    console.log(`\nChecking: ${mint.slice(0, 20)}...`);

    try {
      // Derive vault PDA
      const mintPubkey = new PublicKey(mint);
      const programId = new PublicKey(PUMP_PROGRAM_ID);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
        programId
      );

      console.log(`  Vault: ${vaultPda.toBase58()}`);

      // Check vault activity
      const signatures = await connection.getSignaturesForAddress(vaultPda, { limit: 10 });

      if (signatures.length > 0) {
        console.log(`  ✅ Found ${signatures.length} transactions!`);

        // Get vault balance
        const balance = await connection.getBalance(vaultPda);
        console.log(`  Balance: ${(balance / 1e9).toFixed(4)} SOL`);

        // Get token metadata
        const response = await fetch(`https://api.helius.xyz/v0/token-metadata?api-key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mintAccounts: [mint] }),
        });
        const metadata = await response.json();
        const tokenInfo = metadata[0];

        console.log(`\n  Token: ${tokenInfo?.onChainMetadata?.metadata?.data?.name || "Unknown"}`);
        console.log(`  Symbol: ${tokenInfo?.onChainMetadata?.metadata?.data?.symbol || "Unknown"}`);
        console.log(`  First tx: ${new Date((signatures[signatures.length - 1].blockTime || 0) * 1000).toISOString()}`);
        console.log(`  Latest tx: ${new Date((signatures[0].blockTime || 0) * 1000).toISOString()}`);

        console.log(`\n🎯 Use this mint to index: ${mint}`);
        return mint;
      } else {
        console.log(`  ❌ No vault transactions`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠️ Error: ${message}`);
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 300));
  }

  // If none found, search for recent pump.fun activity
  console.log("\n\nSearching for recent pump.fun program activity...");

  try {
    const programSigs = await connection.getSignaturesForAddress(
      new PublicKey(PUMP_PROGRAM_ID),
      { limit: 20 }
    );

    console.log(`Found ${programSigs.length} recent program transactions`);

    // Parse to find tokens
    if (programSigs.length > 0) {
      const response = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: programSigs.slice(0, 5).map((s) => s.signature) }),
      });
      const parsed = await response.json();

      for (const tx of parsed) {
        if (tx?.tokenTransfers?.length > 0) {
          const mint = tx.tokenTransfers[0].mint;
          if (mint && mint.endsWith("pump")) {
            console.log(`\n🎯 Found active token: ${mint}`);
            return mint;
          }
        }
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error searching program:", message);
  }

  console.log("\nNo active tokens found");
  return null;
}

findActiveToken()
  .then((mint) => {
    if (mint) {
      console.log(`\n${"=".repeat(50)}`);
      console.log(`Run: npx tsx workers/indexer.ts ${mint}`);
      console.log(`${"=".repeat(50)}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
