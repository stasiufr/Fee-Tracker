/**
 * Rate Limiter with Upstash Redis backend
 * Falls back to in-memory for development without Redis
 *
 * PRODUCTION: Uses @upstash/ratelimit for distributed rate limiting
 * DEVELOPMENT: Falls back to in-memory store if UPSTASH_* not configured
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// =============================================================================
// CONFIGURATION
// =============================================================================

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

// Log configuration status at startup
if (process.env.NODE_ENV === "production" && !USE_UPSTASH) {
  console.warn(
    "⚠️ UPSTASH_REDIS_REST_URL/TOKEN not configured - using in-memory rate limiting. " +
    "This will reset on each deployment. Configure Upstash for production."
  );
}

// =============================================================================
// TYPES
// =============================================================================

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

// =============================================================================
// UPSTASH RATE LIMITERS (Production)
// =============================================================================

let redis: Redis | null = null;
let rateLimiters: Map<string, Ratelimit> | null = null;

function getUpstashRedis(): Redis {
  if (!redis && USE_UPSTASH) {
    redis = new Redis({
      url: UPSTASH_URL!,
      token: UPSTASH_TOKEN!,
    });
  }
  return redis!;
}

function getUpstashRateLimiter(config: RateLimitConfig): Ratelimit {
  if (!rateLimiters) {
    rateLimiters = new Map();
  }

  // Create unique key for this config
  const configKey = `${config.windowMs}:${config.maxRequests}`;

  if (!rateLimiters.has(configKey)) {
    const windowSec = Math.ceil(config.windowMs / 1000);
    const limiter = new Ratelimit({
      redis: getUpstashRedis(),
      limiter: Ratelimit.slidingWindow(config.maxRequests, `${windowSec} s`),
      analytics: true,
      prefix: "fee-tracker:ratelimit",
    });
    rateLimiters.set(configKey, limiter);
  }

  return rateLimiters.get(configKey)!;
}

// =============================================================================
// IN-MEMORY FALLBACK (Development / No Redis)
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 60 * 1000;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }
}

function checkRateLimitInMemory(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  startCleanup();

  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || entry.resetTime < now) {
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs,
    };
  }

  if (entry.count >= config.maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetTime: entry.resetTime,
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    };
  }

  entry.count++;
  return {
    success: true,
    remaining: config.maxRequests - entry.count,
    resetTime: entry.resetTime,
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Check if a request should be rate limited
 * Uses Upstash Redis in production, in-memory in development
 *
 * @param identifier - Unique identifier (IP, API key, etc.)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export async function checkRateLimitAsync(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  if (!USE_UPSTASH) {
    return checkRateLimitInMemory(identifier, config);
  }

  try {
    const limiter = getUpstashRateLimiter(config);
    const result = await limiter.limit(identifier);

    return {
      success: result.success,
      remaining: result.remaining,
      resetTime: result.reset,
      retryAfter: result.success ? undefined : Math.ceil((result.reset - Date.now()) / 1000),
    };
  } catch (error) {
    // Fallback to in-memory on Redis errors (fail open)
    console.error("Upstash rate limit error, falling back to in-memory:", error);
    return checkRateLimitInMemory(identifier, config);
  }
}

/**
 * Synchronous rate limit check (in-memory only)
 * Use this for Edge Runtime middleware where async isn't ideal
 * For full production support, use checkRateLimitAsync
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  return checkRateLimitInMemory(identifier, config);
}

/**
 * Get client identifier from request
 * Uses X-Forwarded-For header if behind proxy, falls back to IP
 */
export function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  return "unknown";
}

// =============================================================================
// PRESET CONFIGURATIONS
// =============================================================================

export const RATE_LIMIT_PRESETS = {
  // Standard API - 100 requests per minute
  standard: {
    windowMs: 60 * 1000,
    maxRequests: 100,
  },
  // Strict - 20 requests per minute (for expensive operations)
  strict: {
    windowMs: 60 * 1000,
    maxRequests: 20,
  },
  // Lenient - 300 requests per minute (for lightweight reads)
  lenient: {
    windowMs: 60 * 1000,
    maxRequests: 300,
  },
  // Sync endpoint - 5 requests per 5 minutes
  sync: {
    windowMs: 5 * 60 * 1000,
    maxRequests: 5,
  },
} as const;

// =============================================================================
// DIAGNOSTICS
// =============================================================================

/**
 * Get rate limiter configuration status
 */
export function getRateLimiterStatus(): {
  backend: "upstash" | "memory";
  configured: boolean;
} {
  return {
    backend: USE_UPSTASH ? "upstash" : "memory",
    configured: USE_UPSTASH,
  };
}
