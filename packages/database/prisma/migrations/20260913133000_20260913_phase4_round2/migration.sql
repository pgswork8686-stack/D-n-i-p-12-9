-- AlterEnum
ALTER TYPE "OutboxEventStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN "price_id" TEXT;

-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN "lock_owner" TEXT,
ADD COLUMN "locked_at" TIMESTAMP(3);

-- Recreate idempotency_keys
DROP TABLE IF EXISTS "idempotency_keys";

CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "response" JSONB,
    "status" TEXT NOT NULL DEFAULT 'COMMITTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- DropIndex
DROP INDEX IF EXISTS "payment_events_external_event_id_key";

-- CreateIndex
CREATE INDEX "cart_items_price_id_idx" ON "cart_items"("price_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_cart_id_key" ON "orders"("cart_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_external_event_id_key" ON "payment_events"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "outbox_events_locked_at_idx" ON "outbox_events"("locked_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_user_id_key_key" ON "idempotency_keys"("scope", "user_id", "key");

-- CreatePartialUniqueIndex for Active Cart Invariant
CREATE UNIQUE INDEX IF NOT EXISTS "cart_user_active_unique" ON "carts" ("user_id") WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "product_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
