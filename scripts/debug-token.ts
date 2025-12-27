/**
 * Debug script to check token and vault info
 */
import "dotenv/config";
import { createHelius } from "helius-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const MINT = process.argv[2] || "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";
const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

interface AssetMetadata {
  content?: {
    metadata?: {
      name?: string;
      symbol?: string;
    };
  };
}

interface SignatureInfo {
  signature: string;
  blockTime?: number | null;
}

async function debug() {
  const apiKey = process.env.HELIUS_API_KEY;
  const network = process.env.SOLANA_NETWORK;
  const isDevnet = network === "devnet";

  console.log("=".repeat(50));
  console.log("Token Debug Info");
  console.log("=".repeat(50));
  console.log("Network:", network);
  console.log("API Key set:", !!apiKey);
  console.log("Mint:", MINT);

  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  // Helius SDK v2 for DAS API
  const helius = createHelius({ apiKey, network: isDevnet ? "devnet" : "mainnet" });

  // Solana Connection for RPC calls
  const rpcUrl = isDevnet
    ? `https://devnet.helius-rpc.com/?api-key=${apiKey}`
    : `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, "confirmed");

  // Get token metadata
  console.log("\nFetching token metadata...");
  try {
    const metadata = (await helius.getAsset({ id: MINT })) as AssetMetadata;
    console.log("Token name:", metadata?.content?.metadata?.name || "Unknown");
    console.log("Token symbol:", metadata?.content?.metadata?.symbol || "Unknown");
  } catch (err) {
    console.error("Error fetching metadata:", err);
  }

  // Derive vault
  const mintPubkey = new PublicKey(MINT);
  const programId = new PublicKey(PUMP_PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
    programId
  );
  console.log("\nDerived vault PDA:", vaultPda.toBase58());

  // Check vault balance
  try {
    const balance = await connection.getBalance(vaultPda);
    console.log("Vault balance:", balance / 1e9, "SOL");
  } catch (err) {
    console.error("Error fetching balance:", err);
  }

  // Get recent signatures for vault
  console.log("\nFetching recent transactions for vault...");
  try {
    const sigs = await connection.getSignaturesForAddress(vaultPda, { limit: 10 });
    console.log("Recent transactions found:", sigs.length);
    if (sigs.length > 0) {
      sigs.forEach((s: SignatureInfo, i: number) => {
        const date = s.blockTime ? new Date(s.blockTime * 1000).toISOString() : "unknown";
        console.log("  " + (i + 1) + ". " + s.signature.slice(0, 30) + "... @ " + date);
      });
    } else {
      console.log("  No transactions found for this vault.");
      console.log("  This could mean:");
      console.log("    - The token has no creator fees collected yet");
      console.log("    - The vault address derivation might be different");
    }
  } catch (err) {
    console.error("Error fetching signatures:", err);
  }

  console.log("\n" + "=".repeat(50));
}

debug().catch(console.error);
