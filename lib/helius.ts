/**
 * Helius API Client
 * Fetches parsed transactions and token metadata from Helius
 *
 * SECURITY: API keys are only used server-side. Never expose to client.
 *
 * Uses hybrid approach with helius-sdk v2:
 * - createHelius for DAS API (getAsset, searchAssets)
 * - @solana/web3.js Connection for RPC (getSignaturesForAddress)
 * - Direct REST API for parseTransactions
 *
 * RELIABILITY: All API calls use exponential backoff with jitter
 */

import { Connection, PublicKey } from "@solana/web3.js";
const { createHelius } = require("helius-sdk");

// =============================================================================
// RETRY CONFIGURATION
// =============================================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number; // 0-1, adds randomness to prevent thundering herd
  retryableStatusCodes: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 30000,
  jitterFactor: 0.3,
  retryableStatusCodes: [429, 500, 502, 503, 504, 520, 521, 522, 523, 524],
};

// Specific configs for different operation types
const RETRY_CONFIGS = {
  // RPC calls - faster retry, fewer attempts
  rpc: {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 4,
    baseDelayMs: 300,
    maxDelayMs: 10000,
  },
  // REST API calls - standard retry
  rest: {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 5,
    baseDelayMs: 500,
    maxDelayMs: 20000,
  },
  // DAS API calls - more patient, metadata is cacheable
  das: {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: 4,
    baseDelayMs: 1000,
    maxDelayMs: 15000,
  },
} as const;

// =============================================================================
// RETRY UTILITIES
// =============================================================================

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter: delay * (1 - jitter + random * 2 * jitter)
  // This spreads retries to avoid thundering herd
  const jitter = config.jitterFactor * (Math.random() * 2 - 1);
  const finalDelay = cappedDelay * (1 + jitter);

  return Math.floor(Math.max(config.baseDelayMs, finalDelay));
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown, config: RetryConfig): boolean {
  if (error instanceof HeliusApiError) {
    // Always retry rate limits and timeouts
    if (error.isRateLimit || error.isTimeout) {
      return true;
    }
    // Retry specific status codes
    if (error.statusCode && config.retryableStatusCodes.includes(error.statusCode)) {
      return true;
    }
  }

  // Retry network errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("etimedout") ||
      message.includes("socket hang up") ||
      message.includes("fetch failed")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extract retry-after hint from error (for 429 responses)
 */
function getRetryAfterMs(error: unknown): number | null {
  if (error instanceof HeliusApiError && error.isRateLimit) {
    // Helius typically suggests 1-5 seconds for rate limits
    // Default to 2 seconds if no specific header
    return 2000;
  }
  return null;
}

/**
 * Execute a function with exponential backoff retry
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= config.maxRetries || !isRetryableError(error, config)) {
        throw error;
      }

      // Calculate delay
      let delayMs = calculateBackoffDelay(attempt, config);

      // Use retry-after hint if available (for 429s)
      const retryAfter = getRetryAfterMs(error);
      if (retryAfter && retryAfter > delayMs) {
        delayMs = retryAfter;
      }

      // Log retry attempt
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      const isRateLimit = error instanceof HeliusApiError && error.isRateLimit;

      console.warn(
        `[Helius] ${operationName} failed (attempt ${attempt + 1}/${config.maxRetries + 1}): ${errorMsg}` +
        `${isRateLimit ? " [RATE LIMITED]" : ""}` +
        ` - Retrying in ${delayMs}ms...`
      );

      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Helius enriched transaction type (parseTransactions response)
 */
export interface EnrichedTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  description?: string;
  transactionError?: unknown;
  accountData: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: Array<{
      mint: string;
      rawTokenAmount: {
        tokenAmount: string;
        decimals: number;
      };
      userAccount: string;
    }>;
  }>;
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers: Array<{
    mint: string;
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    fromTokenAccount?: string;
    toTokenAccount?: string;
    tokenStandard?: string;
  }>;
  instructions: Array<{
    programId: string;
    accounts: string[];
    data: string;
    innerInstructions?: Array<{
      programId: string;
      accounts: string[];
      data: string;
    }>;
  }>;
  events?: {
    swap?: {
      nativeInput?: { account: string; amount: string };
      nativeOutput?: { account: string; amount: string };
      tokenInputs?: Array<{ mint: string; tokenAmount: number }>;
      tokenOutputs?: Array<{ mint: string; tokenAmount: number }>;
    };
    burn?: {
      amount: number | string;
    };
  };
}

/**
 * Helius signature info type (getSignaturesForAddress response)
 */
export interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown | null;
  memo: string | null;
  blockTime: number | null;
}

/**
 * Helius DAS API token metadata response
 */
export interface TokenMetadataResponse {
  id: string;
  interface: string;
  content?: {
    metadata?: {
      name?: string;
      symbol?: string;
      description?: string;
    };
    links?: {
      image?: string;
      external_url?: string;
    };
  };
  authorities?: Array<{
    address: string;
    scopes: string[];
  }>;
  ownership?: {
    owner: string;
    frozen: boolean;
    delegated: boolean;
  };
  supply?: {
    print_max_supply: number;
    print_current_supply: number;
    edition_nonce: number | null;
  };
  mutable: boolean;
  burnt: boolean;
}

// =============================================================================
// ENVIRONMENT CONFIGURATION
// =============================================================================

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "devnet";
const IS_DEVNET = SOLANA_NETWORK === "devnet";

// Request timeout - reduced from 30s to 10s (if Helius doesn't respond in 10s, retry)
const REQUEST_TIMEOUT_MS = 10000;

// Validate API key at startup (only warn, don't crash)
if (!HELIUS_API_KEY) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("HELIUS_API_KEY is required in production");
  }
  console.warn("Warning: HELIUS_API_KEY not set in environment variables");
}

// Initialize Helius SDK v2 for DAS API methods
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const helius: any = createHelius({
  apiKey: HELIUS_API_KEY,
  network: IS_DEVNET ? "devnet" : "mainnet",
});

// Initialize @solana/web3.js Connection for RPC methods
const rpcUrl = IS_DEVNET
  ? `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

export const connection = new Connection(rpcUrl, "confirmed");

// Helius API base URL for REST endpoints
const HELIUS_API_BASE = "https://api.helius.xyz/v0";

/**
 * Get the Helius RPC URL - SERVER SIDE ONLY
 * WARNING: Contains API key, never expose to client-side code
 */
export function getHeliusRpcUrl(): string {
  if (typeof window !== "undefined") {
    throw new Error("getHeliusRpcUrl() cannot be called client-side - API key would be exposed");
  }
  return rpcUrl;
}

/**
 * Get public RPC URL without API key (for client-side fallback)
 * Rate limited but safe to expose
 */
export function getPublicRpcUrl(): string {
  return IS_DEVNET
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
}

// Export network info for logging/debugging (without sensitive data)
export const NETWORK_INFO = {
  cluster: IS_DEVNET ? "devnet" : "mainnet-beta",
  isDevnet: IS_DEVNET,
};

/**
 * Helius API error types for better error handling
 */
export class HeliusApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isRateLimit: boolean = false,
    public readonly isTimeout: boolean = false
  ) {
    super(message);
    this.name = "HeliusApiError";
  }
}

/**
 * Wrap a promise with timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new HeliusApiError(`${operation} timed out after ${ms}ms`, undefined, false, true)),
        ms
      )
    ),
  ]);
}

// Known program IDs
export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const JUPITER_V6_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const RAYDIUM_AMM_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/**
 * Get parsed transaction history for an address
 * Uses @solana/web3.js Connection for RPC
 * Includes automatic retry with exponential backoff
 */
export async function getTransactionHistory(
  address: string,
  options?: {
    before?: string;
    limit?: number;
  }
): Promise<SignatureInfo[]> {
  const addressPubkey = new PublicKey(address);

  return withRetry(
    async () => {
      try {
        const response = await withTimeout(
          connection.getSignaturesForAddress(addressPubkey, {
            limit: options?.limit || 100,
            before: options?.before,
          }),
          REQUEST_TIMEOUT_MS,
          "getTransactionHistory"
        );
        return response as SignatureInfo[];
      } catch (error) {
        if (error instanceof HeliusApiError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new HeliusApiError(`Failed to fetch transaction history: ${message}`);
      }
    },
    `getTransactionHistory(${address.slice(0, 8)}...)`,
    RETRY_CONFIGS.rpc
  );
}

/**
 * Get parsed transactions with full details
 * Uses Helius REST API for enhanced transaction parsing
 * Includes automatic retry with exponential backoff
 */
export async function getParsedTransactions(signatures: string[]): Promise<EnrichedTransaction[]> {
  if (signatures.length === 0) {
    return [];
  }

  return withRetry(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(`${HELIUS_API_BASE}/transactions/?api-key=${HELIUS_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: signatures }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Extract retry-after header if present
          const retryAfter = response.headers.get("retry-after");
          const error = new HeliusApiError(
            `HTTP error ${response.status}: ${response.statusText}`,
            response.status,
            response.status === 429
          );
          // Attach retry-after info for rate limit handling
          if (retryAfter && response.status === 429) {
            (error as HeliusApiError & { retryAfterSeconds?: number }).retryAfterSeconds = parseInt(retryAfter, 10);
          }
          throw error;
        }

        const data = await response.json();
        return data as EnrichedTransaction[];
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof HeliusApiError) {
          throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
          throw new HeliusApiError("Request timed out", undefined, false, true);
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new HeliusApiError(`Failed to parse transactions: ${message}`);
      }
    },
    `getParsedTransactions(${signatures.length} sigs)`,
    RETRY_CONFIGS.rest
  );
}

/**
 * Get token metadata using DAS API
 * Uses helius-sdk v2
 * Includes automatic retry with exponential backoff
 */
export async function getTokenMetadata(mintAddress: string): Promise<TokenMetadataResponse | null> {
  return withRetry(
    async () => {
      try {
        const response = await withTimeout(
          helius.getAsset({
            id: mintAddress,
            displayOptions: {
              showFungible: true,
            },
          }),
          REQUEST_TIMEOUT_MS,
          "getTokenMetadata"
        ) as TokenMetadataResponse;
        return response;
      } catch (error) {
        if (error instanceof HeliusApiError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new HeliusApiError(`Failed to fetch token metadata: ${message}`);
      }
    },
    `getTokenMetadata(${mintAddress.slice(0, 8)}...)`,
    RETRY_CONFIGS.das
  );
}

/**
 * Get multiple token metadata at once
 * Uses helius-sdk v2
 * Includes automatic retry with exponential backoff
 */
export async function getMultipleTokenMetadata(mintAddresses: string[]) {
  if (mintAddresses.length === 0) {
    return [];
  }

  return withRetry(
    async () => {
      try {
        const response = await withTimeout(
          helius.getAssetBatch({
            ids: mintAddresses,
            displayOptions: {
              showFungible: true,
            },
          }),
          REQUEST_TIMEOUT_MS,
          "getMultipleTokenMetadata"
        );
        return response;
      } catch (error) {
        if (error instanceof HeliusApiError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new HeliusApiError(`Failed to fetch multiple token metadata: ${message}`);
      }
    },
    `getMultipleTokenMetadata(${mintAddresses.length} mints)`,
    RETRY_CONFIGS.das
  );
}

/**
 * Search for pump.fun tokens
 * Uses helius-sdk v2
 * Includes automatic retry with exponential backoff
 */
export async function searchPumpTokens(options?: {
  page?: number;
  limit?: number;
}) {
  return withRetry(
    async () => {
      try {
        const response = await withTimeout(
          helius.searchAssets({
            ownerAddress: PUMP_PROGRAM_ID,
            page: options?.page || 1,
            limit: options?.limit || 100,
          }),
          REQUEST_TIMEOUT_MS,
          "searchPumpTokens"
        );
        return response;
      } catch (error) {
        if (error instanceof HeliusApiError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new HeliusApiError(`Failed to search pump tokens: ${message}`);
      }
    },
    `searchPumpTokens(page=${options?.page || 1})`,
    RETRY_CONFIGS.das
  );
}

/**
 * Fetch transaction details by signature
 * Uses Helius REST API
 */
export async function getTransactionDetails(signature: string): Promise<EnrichedTransaction | null> {
  try {
    const results = await getParsedTransactions([signature]);
    return results[0] ?? null;
  } catch (error) {
    if (error instanceof HeliusApiError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching transaction details:", message);
    throw new HeliusApiError(`Failed to fetch transaction details: ${message}`);
  }
}

export type ParsedTransaction = Awaited<ReturnType<typeof getParsedTransactions>>[number];
export type TokenMetadata = Awaited<ReturnType<typeof getTokenMetadata>>;

// =============================================================================
// RETRY EXPORTS & DIAGNOSTICS
// =============================================================================

/**
 * Export retry configs for external use/testing
 */
export { RETRY_CONFIGS, DEFAULT_RETRY_CONFIG };

/**
 * Get retry statistics for monitoring
 */
export function getRetryConfig(type: keyof typeof RETRY_CONFIGS): RetryConfig {
  return { ...RETRY_CONFIGS[type] };
}

/**
 * Health check - test Helius connectivity with retry
 * Useful for diagnostics and monitoring
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  latencyMs: number;
  network: string;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    // Simple RPC call to test connectivity
    await withRetry(
      async () => {
        const result = await withTimeout(
          connection.getSlot(),
          5000,
          "healthCheck"
        );
        return result;
      },
      "healthCheck",
      {
        ...RETRY_CONFIGS.rpc,
        maxRetries: 2, // Quick health check
      }
    );

    return {
      healthy: true,
      latencyMs: Date.now() - startTime,
      network: NETWORK_INFO.cluster,
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - startTime,
      network: NETWORK_INFO.cluster,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Batch processor with automatic retry and rate limiting
 * Processes items in batches with configurable delays
 */
export async function processBatch<T, R>(
  items: T[],
  processor: (batch: T[]) => Promise<R[]>,
  options: {
    batchSize?: number;
    delayBetweenBatchesMs?: number;
    onBatchComplete?: (results: R[], batchIndex: number) => void;
    onBatchError?: (error: Error, batchIndex: number) => void;
  } = {}
): Promise<R[]> {
  const {
    batchSize = 10,
    delayBetweenBatchesMs = 200,
    onBatchComplete,
    onBatchError,
  } = options;

  const results: R[] = [];
  const batches: T[][] = [];

  // Split into batches
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  // Process each batch
  for (let i = 0; i < batches.length; i++) {
    try {
      const batchResults = await processor(batches[i]);
      results.push(...batchResults);
      onBatchComplete?.(batchResults, i);
    } catch (error) {
      onBatchError?.(error as Error, i);
      // Continue processing remaining batches
    }

    // Delay between batches (except last one)
    if (i < batches.length - 1) {
      await sleep(delayBetweenBatchesMs);
    }
  }

  return results;
}
