/**
 * Sync API Route
 * Triggered by cron to run the indexer
 * Vercel Cron: /api/sync runs every 5 minutes
 *
 * SECURITY: Protected by CRON_SECRET authentication with timing-safe comparison
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHmac } from "crypto";
import {
  getTransactionHistory,
  getParsedTransactions,
  getTokenMetadata,
  PUMP_PROGRAM_ID,
} from "@/lib/helius";
import { classifyTransaction } from "@/lib/classifier";
import {
  prisma,
  upsertToken,
  createFeeEvent,
  updateTokenStats,
  getTokenByMint,
} from "@/lib/db";
import { calculateBurnPercentage, calculateBadgeTier } from "@/lib/badges";
import { SolanaAddressSchema } from "@/lib/validation";
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMIT_PRESETS,
} from "@/lib/rate-limit";

// Cron secret to prevent unauthorized access
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function secureCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  // Pad to same length to prevent length-based timing leaks
  const maxLength = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLength);
  const bufB = Buffer.alloc(maxLength);

  bufA.write(a);
  bufB.write(b);

  // Use constant-time comparison
  return a.length === b.length && timingSafeEqual(bufA, bufB);
}

/**
 * Verify HMAC signature for Vercel Cron requests
 * Vercel signs the request path with CRON_SECRET using HMAC-SHA256
 */
function verifyVercelSignature(signature: string, path: string): boolean {
  if (!CRON_SECRET || !signature) {
    return false;
  }

  try {
    // Vercel uses HMAC-SHA256 to sign the request path
    const expectedSignature = createHmac("sha256", CRON_SECRET)
      .update(path)
      .digest("hex");

    return secureCompare(signature, expectedSignature);
  } catch {
    return false;
  }
}

// Maximum number of mints allowed per request (prevent resource exhaustion)
const MAX_MINTS_PER_REQUEST = 10;

// Default token to index (for testing) - only used if explicitly requested
const ASDFASDFA_MINT = "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump";

/**
 * Validate CRON authentication
 * Supports multiple authentication methods in order of preference:
 * 1. Vercel Cron HMAC signature verification (x-vercel-cron-signature)
 * 2. Authorization Bearer token with timing-safe comparison
 */
function validateCronAuth(request: NextRequest): { valid: boolean; error?: string } {
  // Check if CRON_SECRET is configured
  if (!CRON_SECRET || CRON_SECRET.trim() === "") {
    // In development, allow without secret but log warning
    if (process.env.NODE_ENV === "development") {
      console.warn("⚠️ CRON_SECRET not configured - allowing request in development");
      return { valid: true };
    }
    console.error("❌ CRON_SECRET not configured in production");
    return { valid: false, error: "Server configuration error" };
  }

  // Method 1: Verify Vercel Cron HMAC signature
  const vercelSignature = request.headers.get("x-vercel-cron-signature");
  if (vercelSignature) {
    const requestPath = request.nextUrl.pathname + request.nextUrl.search;

    if (verifyVercelSignature(vercelSignature, requestPath)) {
      return { valid: true };
    }

    // Log failed signature verification (potential attack)
    console.warn("⚠️ Invalid Vercel Cron signature attempted", {
      path: requestPath,
      timestamp: new Date().toISOString(),
    });
    // Don't return immediately - fall through to check Bearer token
  }

  // Method 2: Authorization Bearer token with timing-safe comparison
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const expectedToken = `Bearer ${CRON_SECRET}`;

    if (secureCompare(authHeader, expectedToken)) {
      return { valid: true };
    }

    // Log failed Bearer token (potential attack)
    console.warn("⚠️ Invalid Authorization header attempted", {
      timestamp: new Date().toISOString(),
    });
  }

  return { valid: false, error: "Unauthorized" };
}

async function deriveCreatorVault(mint: string): Promise<string | null> {
  try {
    const { PublicKey } = await import("@solana/web3.js");
    const mintPubkey = new PublicKey(mint);
    const programId = new PublicKey(PUMP_PROGRAM_ID);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_vault"), mintPubkey.toBuffer()],
      programId
    );

    return vaultPda.toBase58();
  } catch {
    return null;
  }
}

async function indexToken(mint: string): Promise<{
  newEvents: number;
  error?: string;
}> {
  // Check if token exists
  const existingToken = await getTokenByMint(mint);
  let tokenId: number;
  let creatorVault: string;
  let creatorWallet: string;

  if (existingToken && existingToken.creatorVault && existingToken.creatorWallet) {
    tokenId = existingToken.id;
    creatorVault = existingToken.creatorVault;
    creatorWallet = existingToken.creatorWallet;
  } else {
    // Create token
    const vault = await deriveCreatorVault(mint);
    if (!vault) {
      return { newEvents: 0, error: "Could not derive vault" };
    }

    const metadata = await getTokenMetadata(mint);
    const content = metadata?.content as {
      metadata?: { name?: string; symbol?: string };
      links?: { image?: string };
    } | undefined;
    const authorities = (metadata as { authorities?: { address: string }[] })?.authorities;
    const ownership = (metadata as { ownership?: { owner: string } })?.ownership;

    creatorWallet = authorities?.[0]?.address || ownership?.owner || "";
    creatorVault = vault;

    if (!creatorWallet) {
      return { newEvents: 0, error: "Could not find creator wallet" };
    }

    const newToken = await upsertToken({
      mint,
      name: content?.metadata?.name,
      symbol: content?.metadata?.symbol,
      creatorWallet,
      creatorVault: vault,
      imageUri: content?.links?.image,
    });

    tokenId = newToken.id;
  }

  // Get transaction history
  const signatures = await getTransactionHistory(creatorVault, { limit: 50 });
  if (!signatures || signatures.length === 0) {
    return { newEvents: 0 };
  }

  // Get existing signatures
  const existingEvents = await prisma.feeEvent.findMany({
    where: { tokenId },
    select: { signature: true },
  });
  const existingSignatures = new Set(existingEvents.map((e: { signature: string }) => e.signature));

  // Filter new signatures
  const newSignatures = signatures
    .map((s) => s.signature)
    .filter((sig) => !existingSignatures.has(sig));

  if (newSignatures.length === 0) {
    return { newEvents: 0 };
  }

  // Parse and classify
  let newEvents = 0;
  const batchSize = 10;

  for (let i = 0; i < newSignatures.length; i += batchSize) {
    const batch = newSignatures.slice(i, i + batchSize);
    const parsed = await getParsedTransactions(batch);

    for (const tx of parsed) {
      if (!tx) continue;

      const event = classifyTransaction(tx, creatorVault, creatorWallet, mint);
      if (event) {
        try {
          await createFeeEvent({
            tokenId,
            eventType: event.type,
            amountLamports: event.amountLamports,
            signature: event.signature,
            blockTime: event.blockTime,
            burnedTokenMint: event.burnedTokenMint,
            burnedTokenAmount: event.burnedTokenAmount,
          });
          newEvents++;
        } catch {
          // Skip duplicates
        }
      }
    }
  }

  // Recalculate stats using DB aggregation (much more efficient than loading all events)
  const statsAggregation = await prisma.feeEvent.groupBy({
    by: ["eventType"],
    where: { tokenId },
    _sum: { amountLamports: true },
  });

  // Extract totals from aggregation result
  let totalCollected = BigInt(0);
  let totalBurned = BigInt(0);
  let totalWithdrawn = BigInt(0);

  for (const stat of statsAggregation) {
    const amount = stat._sum.amountLamports ?? BigInt(0);
    switch (stat.eventType) {
      case "collect":
        totalCollected = amount;
        break;
      case "burn":
        totalBurned = amount;
        break;
      case "withdraw":
        totalWithdrawn = amount;
        break;
    }
  }

  const totalHeld = totalCollected - totalBurned - totalWithdrawn;
  const burnPercentage = calculateBurnPercentage(totalCollected, totalBurned);
  const badgeTier = calculateBadgeTier(burnPercentage);

  await updateTokenStats(tokenId, {
    totalFeesCollected: totalCollected,
    totalFeesBurned: totalBurned,
    totalFeesWithdrawn: totalWithdrawn,
    totalFeesHeld: totalHeld < 0 ? BigInt(0) : totalHeld,
    burnPercentage,
    badgeTier,
  });

  return { newEvents };
}

export async function GET(request: NextRequest) {
  try {
    // Verify CRON authentication
    const authResult = validateCronAuth(request);
    if (!authResult.valid) {
      console.warn(`Sync auth failed: ${authResult.error}`);
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: 401 }
      );
    }

    // Apply rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`sync:${clientId}`, RATE_LIMIT_PRESETS.sync);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Rate limit exceeded",
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfter),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const startTime = Date.now();

    // Get mints to index from query or use default
    const searchParams = request.nextUrl.searchParams;
    const mintsParam = searchParams.get("mints");
    const modeParam = searchParams.get("mode");

    // Parse and validate mints
    let mints: string[] = [];

    if (modeParam === "all") {
      // Sync all existing tokens in database
      const existingTokens = await prisma.token.findMany({
        select: { mint: true },
        orderBy: { updatedAt: "asc" }, // Oldest first
        take: MAX_MINTS_PER_REQUEST,
      });
      mints = existingTokens.map((t) => t.mint);
      console.log(`Syncing ${mints.length} existing tokens`);
    } else if (mintsParam) {
      const rawMints = mintsParam.split(",").map((m) => m.trim()).filter(Boolean);

      // Validate each mint address
      for (const mint of rawMints) {
        const validation = SolanaAddressSchema.safeParse(mint);
        if (validation.success) {
          mints.push(validation.data);
        } else {
          console.warn(`Invalid mint address skipped: ${mint}`);
        }
      }
    } else {
      // Use default token only if no mints provided
      mints = [ASDFASDFA_MINT];
    }

    // Enforce maximum mints limit
    if (mints.length > MAX_MINTS_PER_REQUEST) {
      return NextResponse.json(
        {
          success: false,
          error: `Maximum ${MAX_MINTS_PER_REQUEST} mints allowed per request, got ${mints.length}`,
        },
        { status: 400 }
      );
    }

    if (mints.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid mint addresses provided" },
        { status: 400 }
      );
    }

    let totalEvents = 0;
    const errors: string[] = [];

    for (const mint of mints) {
      const result = await indexToken(mint);
      totalEvents += result.newEvents;
      if (result.error) {
        errors.push(`${mint.slice(0, 8)}...: ${result.error}`);
      }
    }

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: "Sync completed",
      stats: {
        tokensProcessed: mints.length,
        newEventsFound: totalEvents,
        elapsedMs: elapsed,
        errors: errors.length > 0 ? errors : undefined,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Sync failed",
      },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
