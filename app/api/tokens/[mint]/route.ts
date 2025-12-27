/**
 * Single Token API Route
 * Returns detailed data for a specific token
 */

import { NextRequest, NextResponse } from "next/server";
import { getTokenByMint, getFeeEventsByToken } from "@/lib/db";
import {
  SolanaAddressSchema,
  TokenDetailQuerySchema,
  safeParseQueryParams,
} from "@/lib/validation";

// Type for fee events from Prisma
interface FeeEventDB {
  id: number;
  eventType: string;
  amountLamports: bigint;
  signature: string;
  blockTime: Date;
  burnedTokenMint: string | null;
  burnedTokenAmount: bigint | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await params;

    // Validate mint address
    const mintValidation = SolanaAddressSchema.safeParse(mint);
    if (!mintValidation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid mint address format" },
        { status: 400 }
      );
    }

    // Validate query parameters
    const parseResult = safeParseQueryParams(
      TokenDetailQuerySchema,
      request.nextUrl.searchParams
    );

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: `Invalid parameters: ${parseResult.error}` },
        { status: 400 }
      );
    }

    const { eventsLimit, eventsOffset } = parseResult.data;

    // Get token from database
    const token = await getTokenByMint(mintValidation.data);

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Token not found" },
        { status: 404 }
      );
    }

    // Get more events if needed
    const events = await getFeeEventsByToken(token.id, {
      limit: eventsLimit,
      offset: eventsOffset,
    });

    // Serialize for JSON
    const serializedToken = {
      id: token.id,
      mint: token.mint,
      name: token.name,
      symbol: token.symbol,
      creatorWallet: token.creatorWallet,
      creatorVault: token.creatorVault,
      imageUri: token.imageUri,
      totalFeesCollected: token.totalFeesCollected.toString(),
      totalFeesBurned: token.totalFeesBurned.toString(),
      totalFeesWithdrawn: token.totalFeesWithdrawn.toString(),
      totalFeesHeld: token.totalFeesHeld.toString(),
      burnPercentage: Number(token.burnPercentage),
      badgeTier: token.badgeTier,
      createdAt: token.createdAt.toISOString(),
      updatedAt: token.updatedAt.toISOString(),
      recentEvents: events.map((event: FeeEventDB) => ({
        id: event.id,
        eventType: event.eventType,
        amountLamports: event.amountLamports.toString(),
        signature: event.signature,
        blockTime: event.blockTime.toISOString(),
        burnedTokenMint: event.burnedTokenMint,
        burnedTokenAmount: event.burnedTokenAmount?.toString(),
      })),
    };

    return NextResponse.json({
      success: true,
      data: serializedToken,
    });
  } catch (error) {
    console.error("Error fetching token:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch token" },
      { status: 500 }
    );
  }
}

export const revalidate = 30;
