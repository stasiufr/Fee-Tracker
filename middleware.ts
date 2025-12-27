/**
 * Next.js Middleware
 * Handles rate limiting and security checks
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Simple in-memory rate limit for Edge Runtime
// Note: This resets on each deployment/cold start
// For production, use Redis/Upstash
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = {
  "/api/sync": 5,
  "/api/tokens": 100,
  "/api/stats": 100,
  default: 60,
};

function getRateLimit(pathname: string): number {
  if (pathname.startsWith("/api/sync")) return RATE_LIMIT_MAX_REQUESTS["/api/sync"];
  if (pathname.startsWith("/api/tokens")) return RATE_LIMIT_MAX_REQUESTS["/api/tokens"];
  if (pathname.startsWith("/api/stats")) return RATE_LIMIT_MAX_REQUESTS["/api/stats"];
  return RATE_LIMIT_MAX_REQUESTS.default;
}

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Only rate limit API routes
  if (!pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Skip rate limiting in development
  if (process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }

  const clientIP = getClientIP(request);
  const key = `${clientIP}:${pathname.split("/").slice(0, 3).join("/")}`;
  const now = Date.now();
  const maxRequests = getRateLimit(pathname);

  const entry = rateLimitMap.get(key);

  // Clean up old entry
  if (entry && entry.resetTime < now) {
    rateLimitMap.delete(key);
  }

  const currentEntry = rateLimitMap.get(key);

  if (!currentEntry) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
  } else if (currentEntry.count >= maxRequests) {
    const retryAfter = Math.ceil((currentEntry.resetTime - now) / 1000);
    return new NextResponse(
      JSON.stringify({
        success: false,
        error: "Too many requests",
        retryAfter,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(maxRequests),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(currentEntry.resetTime),
        },
      }
    );
  } else {
    currentEntry.count++;
  }

  // Add rate limit headers to successful responses
  const response = NextResponse.next();
  const remaining = maxRequests - (rateLimitMap.get(key)?.count || 1);
  response.headers.set("X-RateLimit-Limit", String(maxRequests));
  response.headers.set("X-RateLimit-Remaining", String(Math.max(0, remaining)));

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
