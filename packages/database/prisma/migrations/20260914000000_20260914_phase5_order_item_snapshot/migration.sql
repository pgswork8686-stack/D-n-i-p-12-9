-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "license_plan_id_at_purchase" TEXT,
ADD COLUMN "is_lifetime" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "duration_days" INTEGER,
ADD COLUMN "duration_months" INTEGER,
ADD COLUMN "max_activations" INTEGER;

-- CreateIndex
CREATE INDEX "entitlements_status_expires_at_idx" ON "entitlements"("status", "expires_at");

