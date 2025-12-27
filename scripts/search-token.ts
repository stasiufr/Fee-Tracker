/**
 * Search for a token by name/symbol
 */
import "dotenv/config";
import { createHelius } from "helius-sdk";

const SEARCH_TERM = process.argv[2] || "asdfasdf";

async function searchToken() {
  const apiKey = process.env.HELIUS_API_KEY;
  const network = process.env.SOLANA_NETWORK;
  const isDevnet = network === "devnet";

  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  console.log("Searching for token:", SEARCH_TERM);
  console.log("Network:", network);

  // Helius SDK v2
  const helius = createHelius({ apiKey, network: isDevnet ? "devnet" : "mainnet" });

  try {
    // Search using DAS API - searchAssets with pump.fun program as grouping
    const response = await helius.searchAssets({
      grouping: ["collection", "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
      page: 1,
      limit: 10,
    });

    console.log("Search response:", JSON.stringify(response, null, 2).slice(0, 1000));
    console.log("\nNote: DAS API doesn't support text search. Use mint address directly.");
  } catch (err) {
    console.error("Error searching:", err);
  }
}

searchToken().catch(console.error);
