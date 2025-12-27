/**
 * Check ASDF vault specifically
 * ASDF is documented as having 99%+ burn rate
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const HELIUS_API_BASE = "https://api.helius.xyz/v0";

// ASDF token from CLAUDE.md
const ASDF_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("Checking ASDF token vault activity\n");
  console.log(`Mint: ${ASDF_MINT}`);

  // Derive vault
  const mintPubkey = new PublicKey(ASDF_MINT);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
    new PublicKey(PUMP_PROGRAM_ID)
  );

  console.log(`Derived vault: ${vaultPda.toBase58()}`);
  console.log("");

  // Check vault on-chain
  const vaultBalance = await connection.getBalance(vaultPda);
  console.log(`Vault balance: ${(vaultBalance / 1e9).toFixed(6)} SOL`);

  const vaultSigs = await connection.getSignaturesForAddress(vaultPda, { limit: 20 });
  console.log(`Vault transactions: ${vaultSigs.length}`);

  // Get token metadata
  console.log("\nFetching token metadata...");
  const metaRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getAsset",
      params: { id: ASDF_MINT },
    }),
  });
  const metaData = await metaRes.json();
  const asset = metaData.result;

  console.log(`Name: ${asset?.content?.metadata?.name}`);
  console.log(`Symbol: ${asset?.content?.metadata?.symbol}`);

  // Get creator/authority
  const authorities = asset?.authorities || [];
  console.log(`\nAuthorities (${authorities.length}):`);
  for (const auth of authorities) {
    console.log(`  ${auth.address} (${auth.scopes?.join(", ")})`);

    // Check this wallet's transactions
    try {
      const authSigs = await connection.getSignaturesForAddress(new PublicKey(auth.address), { limit: 5 });
      const authBalance = await connection.getBalance(new PublicKey(auth.address));
      console.log(`    → ${authSigs.length}+ txs, ${(authBalance / 1e9).toFixed(4)} SOL`);
    } catch {
      console.log(`    → (couldn't check)`);
    }
  }

  // Search for transactions involving this mint
  console.log("\n\nSearching for token transactions...");

  // Get recent program transactions and filter for this token
  const programSigs = await connection.getSignaturesForAddress(
    new PublicKey(PUMP_PROGRAM_ID),
    { limit: 200 }
  );

  // Parse and filter
  let foundTxs = 0;
  const batchSize = 50;

  for (let i = 0; i < Math.min(programSigs.length, 100); i += batchSize) {
    const batch = programSigs.slice(i, i + batchSize);
    const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: batch.map(s => s.signature) }),
    });
    const parsed = await response.json();

    for (const tx of parsed) {
      const hasASDFTransfer = tx.tokenTransfers?.some(
        (t: { mint: string }) => t.mint === ASDF_MINT
      );
      if (hasASDFTransfer) {
        foundTxs++;
        console.log(`\nFound ASDF tx: ${tx.signature?.slice(0, 40)}...`);
        console.log(`  Type: ${tx.type}`);
        console.log(`  Time: ${new Date((tx.timestamp || 0) * 1000).toISOString()}`);

        // Show SOL flows
        for (const nt of (tx.nativeTransfers || []).slice(0, 3)) {
          console.log(`  SOL: ${(nt.amount / 1e9).toFixed(6)} → ${nt.toUserAccount?.slice(0, 20)}...`);
        }

        if (foundTxs >= 5) break;
      }
    }

    if (foundTxs >= 5) break;
    await new Promise(r => setTimeout(r, 200));
  }

  if (foundTxs === 0) {
    console.log("No recent ASDF transactions found in pump.fun program activity");
    console.log("\nThis could mean:");
    console.log("1. ASDF is not actively traded");
    console.log("2. It graduated to Raydium and trades there");
    console.log("3. Different search approach needed");
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`ASDF vault (${vaultPda.toBase58().slice(0, 20)}...): ${vaultSigs.length} txs, ${(vaultBalance/1e9).toFixed(4)} SOL`);
}

main().catch(console.error);
