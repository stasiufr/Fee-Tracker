-- CreateTable
CREATE TABLE "tokens" (
    "id" SERIAL NOT NULL,
    "mint" VARCHAR(44) NOT NULL,
    "name" VARCHAR(100),
    "symbol" VARCHAR(20),
    "creator_wallet" VARCHAR(44),
    "creator_vault" VARCHAR(44),
    "image_uri" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_fees_collected" BIGINT NOT NULL DEFAULT 0,
    "total_fees_burned" BIGINT NOT NULL DEFAULT 0,
    "total_fees_withdrawn" BIGINT NOT NULL DEFAULT 0,
    "total_fees_held" BIGINT NOT NULL DEFAULT 0,
    "burn_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "badge_tier" VARCHAR(20),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_events" (
    "id" SERIAL NOT NULL,
    "token_id" INTEGER NOT NULL,
    "event_type" VARCHAR(20) NOT NULL,
    "amount_lamports" BIGINT NOT NULL,
    "signature" VARCHAR(88) NOT NULL,
    "block_time" TIMESTAMP(3) NOT NULL,
    "burned_token_mint" VARCHAR(44),
    "burned_token_amount" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creators" (
    "id" SERIAL NOT NULL,
    "wallet" VARCHAR(44) NOT NULL,
    "total_tokens_created" INTEGER NOT NULL DEFAULT 0,
    "total_fees_earned" BIGINT NOT NULL DEFAULT 0,
    "total_fees_burned" BIGINT NOT NULL DEFAULT 0,
    "overall_burn_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "badge_tier" VARCHAR(20),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poh_records" (
    "id" SERIAL NOT NULL,
    "sequence" INTEGER NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "prev_hash" VARCHAR(64) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "slot" INTEGER,
    "event_type" VARCHAR(20) NOT NULL,
    "vault" VARCHAR(10) NOT NULL,
    "token_mint" VARCHAR(44) NOT NULL,
    "token_symbol" VARCHAR(20),
    "amount_lamports" BIGINT NOT NULL,
    "signature" VARCHAR(88) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poh_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tokens_mint_key" ON "tokens"("mint");

-- CreateIndex
CREATE INDEX "tokens_burn_percentage_idx" ON "tokens"("burn_percentage" DESC);

-- CreateIndex
CREATE INDEX "tokens_creator_wallet_idx" ON "tokens"("creator_wallet");

-- CreateIndex
CREATE INDEX "tokens_updated_at_idx" ON "tokens"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "fee_events_signature_key" ON "fee_events"("signature");

-- CreateIndex
CREATE INDEX "fee_events_token_id_block_time_idx" ON "fee_events"("token_id", "block_time" DESC);

-- CreateIndex
CREATE INDEX "fee_events_event_type_idx" ON "fee_events"("event_type");

-- CreateIndex
CREATE INDEX "fee_events_block_time_idx" ON "fee_events"("block_time" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "creators_wallet_key" ON "creators"("wallet");

-- CreateIndex
CREATE INDEX "creators_overall_burn_percentage_idx" ON "creators"("overall_burn_percentage" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "poh_records_hash_key" ON "poh_records"("hash");

-- CreateIndex
CREATE INDEX "poh_records_token_mint_sequence_idx" ON "poh_records"("token_mint", "sequence");

-- CreateIndex
CREATE INDEX "poh_records_signature_idx" ON "poh_records"("signature");

-- CreateIndex
CREATE UNIQUE INDEX "poh_records_token_mint_sequence_key" ON "poh_records"("token_mint", "sequence");

-- AddForeignKey
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_creator_wallet_fkey" FOREIGN KEY ("creator_wallet") REFERENCES "creators"("wallet") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
