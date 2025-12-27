/**
 * Find pump.fun tokens with REAL vault activity (fees collected)
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

  console.log("Searching for pump.fun tokens with vault fees...\n");

  // Get recent pump.fun program transactions
  const programSigs = await connection.getSignaturesForAddress(
    new PublicKey(PUMP_PROGRAM_ID),
    { limit: 100 }
  );

  console.log(`Fetching ${programSigs.length} recent transactions...`);

  // Parse transactions to find tokens with fees
  const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: programSigs.slice(0, 50).map((s) => s.signature) }),
  });
  const parsed = await response.json();

  console.log(`Parsed ${parsed.length} transactions\n`);

  // Find tokens with fee transfers
  const tokenFees = new Map<string, { mint: string; feeCount: number; totalFees: number }>();

  for (const tx of parsed) {
    // Look for SOL transfers that go to vault addresses
    if (tx?.nativeTransfers?.length > 0) {
      for (const transfer of tx.nativeTransfers) {
        // Check if this is a fee collection (SOL going to a vault)
        if (transfer.amount > 0 && transfer.toUserAccount) {
          // Check if destination looks like a vault (we'll verify later)
          const to = transfer.toUserAccount;

          // Look for associated token in the transaction
          if (tx.tokenTransfers?.length > 0) {
            for (const tokenTx of tx.tokenTransfers) {
              if (tokenTx.mint && tokenTx.mint.endsWith("pump")) {
                const mint = tokenTx.mint;
                const existing = tokenFees.get(mint) || { mint, feeCount: 0, totalFees: 0 };
                existing.feeCount++;
                existing.totalFees += transfer.amount / 1e9;
                tokenFees.set(mint, existing);
              }
            }
          }
        }
      }
    }
  }

  // Sort by fee count
  const sorted = Array.from(tokenFees.values()).sort((a, b) => b.feeCount - a.feeCount);

  console.log("Top tokens with activity:");
  console.log("-".repeat(60));

  let foundToken: string | null = null;

  for (const token of sorted.slice(0, 10)) {
    console.log(`\nMint: ${token.mint}`);
    console.log(`  Activity: ${token.feeCount} transactions`);
    console.log(`  Total SOL moved: ${token.totalFees.toFixed(4)} SOL`);

    // Derive and check vault
    try {
      const mintPubkey = new PublicKey(token.mint);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
        new PublicKey(PUMP_PROGRAM_ID)
      );

      const vaultSigs = await connection.getSignaturesForAddress(vaultPda, { limit: 5 });

      if (vaultSigs.length > 0) {
        const balance = await connection.getBalance(vaultPda);
        console.log(`  Vault: ${vaultPda.toBase58()}`);
        console.log(`  Vault txs: ${vaultSigs.length}+`);
        console.log(`  Vault balance: ${(balance / 1e9).toFixed(4)} SOL`);

        if (!foundToken && vaultSigs.length >= 3) {
          foundToken = token.mint;
        }
      }
    } catch {
      console.log(`  (vault check failed)`);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  if (foundToken) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 Best token to index: ${foundToken}`);
    console.log(`Run: npx tsx -r dotenv/config workers/indexer.ts ${foundToken}`);
    console.log(`${"=".repeat(60)}`);
  } else {
    console.log("\nNo ideal tokens found. Trying fallback search...");

    // Fallback: search for any vault with activity
    console.log("\nSearching for ANY vault with transactions...");

    // Try some well-known pump tokens
    const fallbackTokens = [
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK (may have pump activity)
      "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82", // BOME
    ];

    for (const mint of fallbackTokens) {
      try {
        const mintPubkey = new PublicKey(mint);
        const [vaultPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
          new PublicKey(PUMP_PROGRAM_ID)
        );

        const vaultSigs = await connection.getSignaturesForAddress(vaultPda, { limit: 5 });
        if (vaultSigs.length > 0) {
          console.log(`\n✅ Found: ${mint}`);
          console.log(`Vault has ${vaultSigs.length}+ transactions`);
          foundToken = mint;
          break;
        }
      } catch {
        // Skip
      }
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
