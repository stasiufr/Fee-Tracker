/**
 * Input Validation Schemas
 * Using Zod for type-safe validation
 */

import { z } from "zod";

// Solana address regex: Base58, 32-44 characters
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Solana address validation schema
 */
export const SolanaAddressSchema = z
  .string()
  .min(32, "Address too short")
  .max(44, "Address too long")
  .regex(SOLANA_ADDRESS_REGEX, "Invalid Solana address format");

/**
 * Pagination parameters
 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Token list query parameters
 */
export const TokenListQuerySchema = z.object({
  sort: z
    .enum([
      "burnPercentage",
      "totalFeesCollected",
      "totalFeesBurned",
      "totalFeesWithdrawn",
      "updatedAt",
    ])
    .default("burnPercentage"),
  order: z.enum(["asc", "desc"]).default("desc"),
  filter: z.enum(["burners", "extractors"]).optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Token detail query parameters
 */
export const TokenDetailQuerySchema = z.object({
  eventsLimit: z.coerce.number().int().min(1).max(100).default(20),
  eventsOffset: z.coerce.number().int().min(0).default(0),
});

/**
 * Sync endpoint parameters
 */
export const SyncQuerySchema = z.object({
  mints: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val
            .split(",")
            .map((m) => m.trim())
            .filter((m) => SOLANA_ADDRESS_REGEX.test(m))
        : undefined
    ),
});

/**
 * Timeframe enum for stats
 */
export const TimeframeSchema = z.enum(["24h", "7d", "30d", "all"]).default("all");

/**
 * PoH Record schema for POST verification
 */
export const PoHRecordSchema = z.object({
  sequence: z.number().int().min(0),
  hash: z.string().min(1).max(128),
  prevHash: z.string().min(1).max(128),
  timestamp: z.string().datetime({ message: "Invalid ISO 8601 timestamp" }),
  slot: z.number().int().min(0).optional(),
  eventType: z.enum(["collect", "burn", "withdraw"]),
  vault: z.enum(["BC", "AMM", "UNKNOWN"]),
  tokenMint: SolanaAddressSchema,
  tokenSymbol: z.string().max(20).optional(),
  amountLamports: z.string().regex(/^\d+$/, "Must be a numeric string"),
  signature: z.string().min(32).max(128),
});

/**
 * PoH verification request body schema
 */
export const PoHVerifyRequestSchema = z.object({
  records: z.array(PoHRecordSchema).min(1).max(1000, "Maximum 1000 records allowed"),
});

/**
 * Safely parse a BigInt from string
 * Returns null if conversion fails
 */
export function safeParseBigInt(value: string | number | undefined | null): bigint | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Parse BigInt with default value
 */
export function parseBigIntOrDefault(value: string | number | undefined | null, defaultValue: bigint = BigInt(0)): bigint {
  const result = safeParseBigInt(value);
  return result !== null ? result : defaultValue;
}

/**
 * Validate and sanitize a Solana address
 * Returns null if invalid
 */
export function validateSolanaAddress(address: string): string | null {
  const result = SolanaAddressSchema.safeParse(address);
  return result.success ? result.data : null;
}

/**
 * Safely parse query parameters with defaults
 */
export function parseQueryParams<T extends z.ZodSchema>(
  schema: T,
  searchParams: URLSearchParams
): z.infer<T> {
  const obj: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    obj[key] = value;
  });
  return schema.parse(obj);
}

/**
 * Safe parse with error handling
 */
export function safeParseQueryParams<T extends z.ZodSchema>(
  schema: T,
  searchParams: URLSearchParams
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const obj: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    obj[key] = value;
  });

  const result = schema.safeParse(obj);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const errorMessage = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join(", ");

  return { success: false, error: errorMessage };
}
