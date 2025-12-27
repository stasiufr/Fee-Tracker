/**
 * Database Client
 * Prisma client singleton for database operations
 */

import { PrismaClient } from "@prisma/client";

// Prevent multiple instances in development
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Token queries
export async function getTokenByMint(mint: string) {
  return prisma.token.findUnique({
    where: { mint },
    include: {
      feeEvents: {
        orderBy: { blockTime: "desc" },
        take: 10,
      },
    },
  });
}

export async function getTokenWithAllEvents(mint: string) {
  return prisma.token.findUnique({
    where: { mint },
    include: {
      feeEvents: {
        orderBy: { blockTime: "desc" },
      },
    },
  });
}

export async function getTopBurners(limit = 10, timeframe?: Date) {
  const where = timeframe
    ? { updatedAt: { gte: timeframe } }
    : {};

  return prisma.token.findMany({
    where: {
      ...where,
      burnPercentage: { gt: 0 },
    },
    orderBy: { burnPercentage: "desc" },
    take: limit,
  });
}

export async function getTopExtractors(limit = 10, timeframe?: Date) {
  const where = timeframe
    ? { updatedAt: { gte: timeframe } }
    : {};

  return prisma.token.findMany({
    where: {
      ...where,
      totalFeesWithdrawn: { gt: 0 },
    },
    orderBy: { totalFeesWithdrawn: "desc" },
    take: limit,
  });
}

export async function getGlobalStats() {
  const result = await prisma.token.aggregate({
    _sum: {
      totalFeesCollected: true,
      totalFeesBurned: true,
      totalFeesWithdrawn: true,
      totalFeesHeld: true,
    },
    _count: {
      id: true,
    },
  });

  const totalCollected = result._sum.totalFeesCollected ?? BigInt(0);
  const totalBurned = result._sum.totalFeesBurned ?? BigInt(0);
  const totalWithdrawn = result._sum.totalFeesWithdrawn ?? BigInt(0);
  const totalHeld = result._sum.totalFeesHeld ?? BigInt(0);

  const burnPercentage =
    totalCollected > 0
      ? Number((totalBurned * BigInt(10000)) / totalCollected) / 100
      : 0;

  return {
    totalTokens: result._count.id,
    totalFeesCollected: totalCollected,
    totalFeesBurned: totalBurned,
    totalFeesWithdrawn: totalWithdrawn,
    totalFeesHeld: totalHeld,
    globalBurnPercentage: burnPercentage,
  };
}

export async function upsertToken(data: {
  mint: string;
  name?: string;
  symbol?: string;
  creatorWallet?: string;
  creatorVault?: string;
  imageUri?: string;
}) {
  // Ensure creator exists before upserting token (foreign key constraint)
  if (data.creatorWallet) {
    await prisma.creator.upsert({
      where: { wallet: data.creatorWallet },
      update: {}, // No updates needed, just ensure existence
      create: {
        wallet: data.creatorWallet,
        totalTokensCreated: 1,
      },
    });
  }

  return prisma.token.upsert({
    where: { mint: data.mint },
    update: {
      name: data.name,
      symbol: data.symbol,
      creatorWallet: data.creatorWallet,
      creatorVault: data.creatorVault,
      imageUri: data.imageUri,
    },
    create: data,
  });
}

export async function createFeeEvent(data: {
  tokenId: number;
  eventType: "collect" | "withdraw" | "burn";
  amountLamports: bigint;
  signature: string;
  blockTime: Date;
  burnedTokenMint?: string;
  burnedTokenAmount?: bigint;
}) {
  return prisma.feeEvent.create({
    data,
  });
}

export async function updateTokenStats(
  tokenId: number,
  stats: {
    totalFeesCollected: bigint;
    totalFeesBurned: bigint;
    totalFeesWithdrawn: bigint;
    totalFeesHeld: bigint;
    burnPercentage: number;
    badgeTier: string;
  }
) {
  return prisma.token.update({
    where: { id: tokenId },
    data: stats,
  });
}

export async function getRecentFeeEvents(limit = 20) {
  return prisma.feeEvent.findMany({
    orderBy: { blockTime: "desc" },
    take: limit,
    include: {
      token: {
        select: {
          mint: true,
          name: true,
          symbol: true,
        },
      },
    },
  });
}

export async function getFeeEventsByToken(tokenId: number, options?: {
  limit?: number;
  offset?: number;
  eventType?: "collect" | "withdraw" | "burn";
}) {
  return prisma.feeEvent.findMany({
    where: {
      tokenId,
      ...(options?.eventType ? { eventType: options.eventType } : {}),
    },
    orderBy: { blockTime: "desc" },
    take: options?.limit ?? 50,
    skip: options?.offset ?? 0,
  });
}

export default prisma;
