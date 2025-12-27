/**
 * Health Check API Route
 * Returns service status for monitoring
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { NETWORK_INFO } from "@/lib/helius";
import { getRateLimiterStatus } from "@/lib/rate-limit";

export async function GET() {
  const rateLimiterStatus = getRateLimiterStatus();

  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.1.0",
    environment: process.env.NODE_ENV || "development",
    network: NETWORK_INFO.cluster,
    checks: {
      database: "unknown",
      helius: "unknown",
      rateLimit: rateLimiterStatus.backend,
    },
  };

  // Check database connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    health.checks.database = "ok";
  } catch {
    health.checks.database = "error";
    health.status = "degraded";
  }

  // Check if Helius API key is configured
  if (process.env.HELIUS_API_KEY) {
    health.checks.helius = "configured";
  } else {
    health.checks.helius = "not_configured";
    if (process.env.NODE_ENV === "production") {
      health.status = "degraded";
    }
  }

  const statusCode = health.status === "ok" ? 200 : 503;

  return NextResponse.json(health, { status: statusCode });
}

// No caching for health checks
export const revalidate = 0;
export const dynamic = "force-dynamic";
