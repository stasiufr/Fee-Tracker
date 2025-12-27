/**
 * Debug pump.fun fee collection mechanics
 * Try different PDA seeds and analyze transaction patterns
 */
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const HELIUS_API_BASE = "https://api.helius.xyz/v0";

// Known pump.fun token to analyze
const TEST_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump"; // ASDFASDFA

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  console.log(`Analyzing pump.fun fee mechanics for: ${TEST_MINT}\n`);

  const mintPubkey = new PublicKey(TEST_MINT);
  const programId = new PublicKey(PUMP_PROGRAM_ID);

  // Try different seed combinations
  console.log("Trying different PDA seeds:");
  console.log("-".repeat(60));

  const seedVariants = [
    { name: "creator_vault", seeds: [Buffer.from("creator_vault"), mintPubkey.toBuffer()] },
    { name: "vault", seeds: [Buffer.from("vault"), mintPubkey.toBuffer()] },
    { name: "fee_vault", seeds: [Buffer.from("fee_vault"), mintPubkey.toBuffer()] },
    { name: "creator-vault", seeds: [Buffer.from("creator-vault"), mintPubkey.toBuffer()] },
    { name: "mint only", seeds: [mintPubkey.toBuffer()] },
    { name: "creator_vault + program", seeds: [Buffer.from("creator_vault"), mintPubkey.toBuffer(), programId.toBuffer()] },
  ];

  for (const variant of seedVariants) {
    try {
      const [pda] = PublicKey.findProgramAddressSync(variant.seeds, programId);
      const sigs = await connection.getSignaturesForAddress(pda, { limit: 3 });
      const balance = sigs.length > 0 ? await connection.getBalance(pda) : 0;

      console.log(`\n"${variant.name}":`);
      console.log(`  PDA: ${pda.toBase58()}`);
      console.log(`  Txs: ${sigs.length} | Balance: ${(balance / 1e9).toFixed(4)} SOL`);

      if (sigs.length > 0) {
        console.log(`  ✅ HAS ACTIVITY!`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n"${variant.name}": ERROR - ${msg}`);
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  // Get a pump.fun transaction and analyze it
  console.log("\n\nAnalyzing a pump.fun transaction:");
  console.log("-".repeat(60));

  // Get recent pump transactions for this token
  const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactions: ["5wHu1qwD7q5ifaN5nwdcDqNFo53GJqa7nLp2BeeEpcHCusb4GzARz4GjhUXgCnkJxZzo5TpVJgXfq5zqxXodqpYV"],
    }),
  });
  const parsed = await response.json();
  const tx = parsed[0];

  if (tx) {
    console.log(`\nType: ${tx.type}`);
    console.log(`Source: ${tx.source}`);
    console.log(`Description: ${tx.description}`);

    console.log("\nAccounts involved:");
    for (const acc of tx.accountData || []) {
      const change = acc.nativeBalanceChange / 1e9;
      if (Math.abs(change) > 0.0001) {
        const sign = change > 0 ? "+" : "";
        console.log(`  ${acc.account.slice(0, 20)}... ${sign}${change.toFixed(6)} SOL`);
      }
    }

    console.log("\nNative transfers:");
    for (const nt of tx.nativeTransfers || []) {
      console.log(`  ${nt.fromUserAccount?.slice(0, 15)}... → ${nt.toUserAccount?.slice(0, 15)}...: ${(nt.amount / 1e9).toFixed(6)} SOL`);
    }

    console.log("\nInstructions:");
    for (const ix of tx.instructions || []) {
      console.log(`  Program: ${ix.programId}`);
    }
  }

  // Check pump.fun global fee accounts
  console.log("\n\nChecking pump.fun protocol accounts:");
  console.log("-".repeat(60));

  // Known pump.fun protocol addresses
  const protocolAddresses = [
    { name: "Pump Program", addr: PUMP_PROGRAM_ID },
    { name: "Fee Recipient", addr: "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM" }, // Known fee wallet
    { name: "Fee Recipient 2", addr: "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV" },
  ];

  for (const p of protocolAddresses) {
    try {
      const sigs = await connection.getSignaturesForAddress(new PublicKey(p.addr), { limit: 5 });
      const balance = await connection.getBalance(new PublicKey(p.addr));
      console.log(`\n${p.name}: ${p.addr.slice(0, 20)}...`);
      console.log(`  Txs: ${sigs.length}+ | Balance: ${(balance / 1e9).toFixed(4)} SOL`);
    } catch {
      console.log(`\n${p.name}: ERROR`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
