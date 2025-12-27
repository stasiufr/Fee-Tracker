/**
 * Global Stats API Route
 * Returns ecosystem-wide fee statistics
 */

import { NextResponse } from "next/server";
import { getGlobalStats, prisma } from "@/lib/db";
import { subDays } from "date-fns";

export async function GET() {
  try {
    // Get global stats from database
    const stats = await getGlobalStats();

    // Get 24h stats by type (removed redundant aggregate query)
    const last24hByType = await prisma.feeEvent.groupBy({
      by: ["eventType"],
      where: {
        blockTime: { gte: subDays(new Date(), 1) },
      },
      _sum: {
        amountLamports: true,
      },
    });

    // Get 7d stats
    const last7dByType = await prisma.feeEvent.groupBy({
      by: ["eventType"],
      where: {
        blockTime: { gte: subDays(new Date(), 7) },
      },
      _sum: {
        amountLamports: true,
      },
    });

    // Process 24h data
    let burned24h = BigInt(0);
    let withdrawn24h = BigInt(0);
    let collected24h = BigInt(0);

    for (const item of last24hByType) {
      const amount = item._sum.amountLamports || BigInt(0);
      if (item.eventType === "burn") burned24h = amount;
      if (item.eventType === "withdraw") withdrawn24h = amount;
      if (item.eventType === "collect") collected24h = amount;
    }

    // Process 7d data
    let burned7d = BigInt(0);
    let withdrawn7d = BigInt(0);
    let collected7d = BigInt(0);

    for (const item of last7dByType) {
      const amount = item._sum.amountLamports || BigInt(0);
      if (item.eventType === "burn") burned7d = amount;
      if (item.eventType === "withdraw") withdrawn7d = amount;
      if (item.eventType === "collect") collected7d = amount;
    }

    // Calculate percentages
    const burnPct24h =
      collected24h > 0
        ? Number((burned24h * BigInt(10000)) / collected24h) / 100
        : 0;
    const burnPct7d =
      collected7d > 0
        ? Number((burned7d * BigInt(10000)) / collected7d) / 100
        : 0;

    return NextResponse.json({
      success: true,
      data: {
        totalTokensTracked: stats.totalTokens,
        totalFeesCollected: stats.totalFeesCollected.toString(),
        totalFeesBurned: stats.totalFeesBurned.toString(),
        totalFeesWithdrawn: stats.totalFeesWithdrawn.toString(),
        totalFeesHeld: stats.totalFeesHeld.toString(),
        globalBurnPercentage: stats.globalBurnPercentage,
        last24h: {
          feesCollected: collected24h.toString(),
          feesBurned: burned24h.toString(),
          feesWithdrawn: withdrawn24h.toString(),
          burnPercentage: burnPct24h,
        },
        last7d: {
          feesCollected: collected7d.toString(),
          feesBurned: burned7d.toString(),
          feesWithdrawn: withdrawn7d.toString(),
          burnPercentage: burnPct7d,
        },
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching global stats:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

// Revalidate every 60 seconds
export const revalidate = 60;
