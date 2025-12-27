/**
 * Check vault and index a specific token
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const HELIUS_API_BASE = "https://api.helius.xyz/v0";

// Most active token from our search
const MINT = process.argv[2] || "Ee7EK64MmfngHJCuezMys7Pwt1kmPEfLyCDCQ6rspump";

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log(`Checking token: ${MINT}\n`);

  // Derive vault PDA
  const mintPubkey = new PublicKey(MINT);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
    new PublicKey(PUMP_PROGRAM_ID)
  );

  console.log(`Vault PDA: ${vaultPda.toBase58()}`);

  // Check vault signatures
  const vaultSigs = await connection.getSignaturesForAddress(vaultPda, { limit: 20 });
  console.log(`Vault transactions: ${vaultSigs.length}`);

  if (vaultSigs.length === 0) {
    console.log("\n❌ No vault transactions found");
    process.exit(1);
  }

  // Check vault balance
  const balance = await connection.getBalance(vaultPda);
  console.log(`Vault balance: ${(balance / 1e9).toFixed(6)} SOL`);

  // Get token metadata via DAS API
  console.log("\nFetching token metadata...");
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getAsset",
      params: { id: MINT },
    }),
  });
  const data = await response.json();
  const asset = data.result;

  console.log(`Token name: ${asset?.content?.metadata?.name || "Unknown"}`);
  console.log(`Symbol: ${asset?.content?.metadata?.symbol || "Unknown"}`);

  // Get authorities (creator wallet)
  const authorities = asset?.authorities || [];
  console.log(`Authorities: ${authorities.length}`);
  for (const auth of authorities) {
    console.log(`  - ${auth.address} (${auth.scopes?.join(", ")})`);
  }

  // Parse a vault transaction to see what's happening
  console.log("\nParsing vault transactions...");
  const sigs = vaultSigs.slice(0, 5).map((s) => s.signature);
  const parseResponse = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: sigs }),
  });
  const parsed = await parseResponse.json();

  for (const tx of parsed) {
    console.log(`\nTx: ${tx.signature?.slice(0, 30)}...`);
    console.log(`  Type: ${tx.type}`);
    console.log(`  Description: ${tx.description?.slice(0, 80) || "N/A"}`);

    // Show native transfers
    if (tx.nativeTransfers?.length > 0) {
      console.log("  Native transfers:");
      for (const nt of tx.nativeTransfers.slice(0, 3)) {
        const amt = (nt.amount / 1e9).toFixed(6);
        console.log(`    ${nt.fromUserAccount?.slice(0, 8)}... → ${nt.toUserAccount?.slice(0, 8)}...: ${amt} SOL`);
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ Token ready for indexing!`);
  console.log(`${"=".repeat(60)}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
