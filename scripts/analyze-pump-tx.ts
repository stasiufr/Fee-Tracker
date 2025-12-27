/**
 * Analyze actual pump.fun transactions to understand fee flow
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

  console.log("Analyzing pump.fun transaction fee flows...\n");

  // Get recent pump.fun program transactions
  const programSigs = await connection.getSignaturesForAddress(
    new PublicKey(PUMP_PROGRAM_ID),
    { limit: 10 }
  );

  console.log(`Found ${programSigs.length} recent transactions\n`);

  // Parse them
  const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: programSigs.map((s) => s.signature) }),
  });
  const parsed = await response.json();

  // Known fee recipients
  const KNOWN_FEE_RECIPIENTS = [
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
    "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
  ];

  // Analyze each transaction
  for (const tx of parsed) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Sig: ${tx.signature?.slice(0, 40)}...`);
    console.log(`Type: ${tx.type} | Source: ${tx.source}`);
    console.log(`Description: ${tx.description?.slice(0, 100)}`);

    // Find the token involved
    let mint = "";
    for (const tt of tx.tokenTransfers || []) {
      if (tt.mint?.endsWith("pump")) {
        mint = tt.mint;
        break;
      }
    }

    if (mint) {
      console.log(`Token: ${mint.slice(0, 30)}...`);

      // Derive expected vault PDA
      const mintPubkey = new PublicKey(mint);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
        new PublicKey(PUMP_PROGRAM_ID)
      );
      console.log(`Expected vault: ${vaultPda.toBase58().slice(0, 30)}...`);
    }

    // Analyze SOL flows
    console.log("\nSOL transfers:");
    for (const nt of tx.nativeTransfers || []) {
      const from = nt.fromUserAccount || "system";
      const to = nt.toUserAccount || "unknown";
      const amt = (nt.amount / 1e9).toFixed(6);

      let note = "";
      if (KNOWN_FEE_RECIPIENTS.includes(to)) {
        note = " ← PUMP.FUN PROTOCOL FEE";
      } else if (to === PUMP_PROGRAM_ID) {
        note = " ← PROGRAM";
      }

      console.log(`  ${from.slice(0, 15)}... → ${to.slice(0, 15)}...: ${amt} SOL${note}`);
    }

    // Show account balance changes (to find creator fee recipient)
    console.log("\nBalance changes (significant):");
    for (const acc of tx.accountData || []) {
      const change = acc.nativeBalanceChange / 1e9;
      if (Math.abs(change) > 0.001) {
        let note = "";
        if (KNOWN_FEE_RECIPIENTS.includes(acc.account)) {
          note = " ← PROTOCOL FEE";
        }
        const sign = change > 0 ? "+" : "";
        console.log(`  ${acc.account.slice(0, 25)}... ${sign}${change.toFixed(6)} SOL${note}`);
      }
    }
  }

  console.log(`\n\n${"=".repeat(60)}`);
  console.log("ANALYSIS COMPLETE");
  console.log(`${"=".repeat(60)}`);
  console.log("\nPump.fun fee structure:");
  console.log("- Protocol fees go to: CebN5WGQ... and 62qc2CNX...");
  console.log("- Creator fees might go directly to creator wallet");
  console.log("- Or to a different vault/escrow structure");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
