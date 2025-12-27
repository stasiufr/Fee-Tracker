/**
 * Find the actual ASDFASDFA token
 */
import "dotenv/config";

const HELIUS_API_BASE = "https://api.helius.xyz/v0";

async function main() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("HELIUS_API_KEY not set!");
    process.exit(1);
  }

  console.log("Searching for ASDFASDFA token...\n");

  // Search using DAS API
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "searchAssets",
      params: {
        tokenType: "fungible",
        displayOptions: {
          showFungible: true,
        },
        limit: 50,
        page: 1,
      },
    }),
  });

  const data = await response.json();
  console.log("Search response received");

  // Look for ASDFASDFA in results
  if (data.result?.items) {
    console.log(`Found ${data.result.items.length} tokens`);

    for (const item of data.result.items) {
      const name = item.content?.metadata?.name?.toLowerCase() || "";
      const symbol = item.content?.metadata?.symbol?.toLowerCase() || "";

      if (name.includes("asdf") || symbol.includes("asdf")) {
        console.log(`\nFound potential match:`);
        console.log(`  Mint: ${item.id}`);
        console.log(`  Name: ${item.content?.metadata?.name}`);
        console.log(`  Symbol: ${item.content?.metadata?.symbol}`);
      }
    }
  }

  // Also try direct token metadata lookup for known pump addresses
  console.log("\n\nTrying direct metadata lookup...");

  // The mint address from CLAUDE.md
  const knownMint = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";

  const metaRes = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getAsset",
      params: { id: knownMint },
    }),
  });

  const metaData = await metaRes.json();
  console.log(`\nKnown mint (${knownMint}):`);
  console.log(`  Name: ${metaData.result?.content?.metadata?.name}`);
  console.log(`  Symbol: ${metaData.result?.content?.metadata?.symbol}`);

  // Let's try searching for pump.fun tokens with "asdf" in name
  console.log("\n\nSearching token-metadata API...");
  const tokenMetaRes = await fetch(
    `${HELIUS_API_BASE}/token-metadata?api-key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mintAccounts: [knownMint],
        includeOffChain: true,
        disableCache: false,
      }),
    }
  );

  const tokenMeta = await tokenMetaRes.json();
  console.log("Token metadata:", JSON.stringify(tokenMeta, null, 2));
}

main().catch(console.error);
