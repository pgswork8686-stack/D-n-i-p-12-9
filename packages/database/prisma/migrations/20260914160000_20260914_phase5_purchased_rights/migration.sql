-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "updates_days" INTEGER,
ADD COLUMN "support_days" INTEGER;

-- AlterTable
ALTER TABLE "entitlements" ADD COLUMN "max_activations" INTEGER,
ADD COLUMN "updates_until" TIMESTAMP(3),
ADD COLUMN "support_until" TIMESTAMP(3);