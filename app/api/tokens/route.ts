/**
 * Tokens API Route
 * List tokens with filtering and sorting
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  TokenListQuerySchema,
  safeParseQueryParams,
} from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    // Validate query parameters
    const parseResult = safeParseQueryParams(
      TokenListQuerySchema,
      request.nextUrl.searchParams
    );

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: `Invalid parameters: ${parseResult.error}` },
        { status: 400 }
      );
    }

    const { sort, order, filter, search, page, limit } = parseResult.data;

    // Build where clause - using Record type since Prisma types require regeneration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (filter === "burners") {
      where.burnPercentage = { gte: 50 };
    } else if (filter === "extractors") {
      where.burnPercentage = { lt: 50 };
    }

    // Sanitize search input (limit length, escape special chars)
    if (search) {
      const sanitizedSearch = search.slice(0, 100).replace(/[%_]/g, "\\$&");
      where.OR = [
        { name: { contains: sanitizedSearch, mode: "insensitive" } },
        { symbol: { contains: sanitizedSearch, mode: "insensitive" } },
        { mint: { contains: sanitizedSearch } },
      ];
    }

    // Use validated sort parameters
    const sortField = sort;
    const sortOrder = order;

    // Get total count
    const total = await prisma.token.count({ where });

    // Get tokens
    const tokens = await prisma.token.findMany({
      where,
      orderBy: { [sortField]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        mint: true,
        name: true,
        symbol: true,
        creatorWallet: true,
        imageUri: true,
        totalFeesCollected: true,
        totalFeesBurned: true,
        totalFeesWithdrawn: true,
        totalFeesHeld: true,
        burnPercentage: true,
        badgeTier: true,
        updatedAt: true,
      },
    });

    // Convert BigInt to string for JSON serialization
    const serializedTokens = tokens.map((token) => ({
      ...token,
      totalFeesCollected: token.totalFeesCollected.toString(),
      totalFeesBurned: token.totalFeesBurned.toString(),
      totalFeesWithdrawn: token.totalFeesWithdrawn.toString(),
      totalFeesHeld: token.totalFeesHeld.toString(),
      burnPercentage: Number(token.burnPercentage),
    }));

    return NextResponse.json({
      success: true,
      data: {
        tokens: serializedTokens,
        pagination: {
          page,
          limit,
          total,
          hasMore: page * limit < total,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching tokens:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch tokens" },
      { status: 500 }
    );
  }
}

export const revalidate = 60;
