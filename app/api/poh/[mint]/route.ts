/**
 * Proof-of-History API Route
 * Verify and export PoH chains for tokens
 *
 * SECURITY: POST endpoint validates all input with Zod schemas
 */

import { NextRequest, NextResponse } from "next/server";
import {
  SolanaAddressSchema,
  PoHVerifyRequestSchema,
  safeParseBigInt,
} from "@/lib/validation";
import { exportChainToJSON, verifyChain } from "@/lib/proof-of-history";
import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMIT_PRESETS,
} from "@/lib/rate-limit";

// Type for PoH records from Prisma
interface PoHRecordDB {
  sequence: number;
  hash: string;
  prevHash: string;
  timestamp: Date;
  slot: number | null;
  eventType: string;
  vault: string;
  tokenMint: string;
  tokenSymbol: string | null;
  amountLamports: bigint;
  signature: string;
}

/**
 * GET /api/poh/[mint]
 * Get PoH chain status and optionally full chain data
 */
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

    const searchParams = request.nextUrl.searchParams;
    const includeChain = searchParams.get("full") === "true";
    const verify = searchParams.get("verify") === "true";
    const format = searchParams.get("format") || "json"; // json or export

    // Get PoH records for this token
    const records = await prisma.poHRecord.findMany({
      where: { tokenMint: mintValidation.data },
      orderBy: { sequence: "asc" },
    });

    if (records.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          tokenMint: mintValidation.data,
          chainLength: 0,
          verified: true,
          message: "No PoH records found for this token",
        },
      });
    }

    // Get chain summary
    const firstRecord = records[0];
    const lastRecord = records[records.length - 1];

    const response: Record<string, unknown> = {
      success: true,
      data: {
        tokenMint: mintValidation.data,
        chainLength: records.length,
        firstSequence: firstRecord.sequence,
        lastSequence: lastRecord.sequence,
        firstHash: firstRecord.hash,
        lastHash: lastRecord.hash,
        firstTimestamp: firstRecord.timestamp.toISOString(),
        lastTimestamp: lastRecord.timestamp.toISOString(),
      },
    };

    // Verify chain if requested
    if (verify) {
      const pohRecords = records.map((r: PoHRecordDB) => ({
        sequence: r.sequence,
        hash: r.hash,
        prevHash: r.prevHash,
        timestamp: r.timestamp,
        slot: r.slot || undefined,
        eventType: r.eventType as "collect" | "burn" | "withdraw",
        vault: r.vault as "BC" | "AMM" | "UNKNOWN",
        tokenMint: r.tokenMint,
        tokenSymbol: r.tokenSymbol || undefined,
        amountLamports: r.amountLamports,
        signature: r.signature,
      }));

      const verification = verifyChain(pohRecords);
      (response.data as Record<string, unknown>).verification = {
        valid: verification.valid,
        invalidAt: verification.invalidAt,
        error: verification.error,
      };
    }

    // Include full chain if requested
    if (includeChain) {
      const pohRecords = records.map((r: PoHRecordDB) => ({
        sequence: r.sequence,
        hash: r.hash,
        prevHash: r.prevHash,
        timestamp: r.timestamp.toISOString(),
        slot: r.slot,
        eventType: r.eventType,
        vault: r.vault,
        tokenMint: r.tokenMint,
        tokenSymbol: r.tokenSymbol,
        amountLamports: r.amountLamports.toString(),
        signature: r.signature,
      }));

      if (format === "export") {
        // Return as downloadable JSON file
        const exportData = exportChainToJSON(
          records.map((r: PoHRecordDB) => ({
            sequence: r.sequence,
            hash: r.hash,
            prevHash: r.prevHash,
            timestamp: r.timestamp,
            slot: r.slot || undefined,
            eventType: r.eventType as "collect" | "burn" | "withdraw",
            vault: r.vault as "BC" | "AMM" | "UNKNOWN",
            tokenMint: r.tokenMint,
            tokenSymbol: r.tokenSymbol || undefined,
            amountLamports: r.amountLamports,
            signature: r.signature,
          }))
        );

        return new NextResponse(exportData, {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="poh-${mint.slice(0, 8)}.json"`,
          },
        });
      }

      (response.data as Record<string, unknown>).records = pohRecords;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching PoH chain:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch PoH chain" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/poh/[mint]/verify
 * Verify an externally provided PoH chain
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mint: string }> }
) {
  try {
    const { mint } = await params;

    // Apply rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`poh:${clientId}`, RATE_LIMIT_PRESETS.strict);
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
          },
        }
      );
    }

    // Validate mint address
    const mintValidation = SolanaAddressSchema.safeParse(mint);
    if (!mintValidation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid mint address format" },
        { status: 400 }
      );
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Validate with Zod schema
    const bodyValidation = PoHVerifyRequestSchema.safeParse(body);
    if (!bodyValidation.success) {
      const errorMessage = bodyValidation.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");
      return NextResponse.json(
        { success: false, error: `Validation error: ${errorMessage}` },
        { status: 400 }
      );
    }

    const { records } = bodyValidation.data;

    // Convert validated records to PoH format with safe BigInt parsing
    const pohRecords = records.map((r) => {
      const amount = safeParseBigInt(r.amountLamports);
      if (amount === null) {
        throw new Error(`Invalid amountLamports for record ${r.sequence}`);
      }
      return {
        sequence: r.sequence,
        hash: r.hash,
        prevHash: r.prevHash,
        timestamp: new Date(r.timestamp),
        slot: r.slot,
        eventType: r.eventType,
        vault: r.vault,
        tokenMint: r.tokenMint,
        tokenSymbol: r.tokenSymbol,
        amountLamports: amount,
        signature: r.signature,
      };
    });

    // Verify the chain
    const verification = verifyChain(pohRecords);

    return NextResponse.json({
      success: true,
      data: {
        tokenMint: mintValidation.data,
        chainLength: pohRecords.length,
        verification: {
          valid: verification.valid,
          invalidAt: verification.invalidAt,
          error: verification.error,
        },
      },
    });
  } catch (error) {
    console.error("Error verifying PoH chain:", error);
    return NextResponse.json(
      { success: false, error: "Failed to verify PoH chain" },
      { status: 500 }
    );
  }
}

export const revalidate = 0;
