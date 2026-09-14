-- CreateEnum
CREATE TYPE "LicenseFulfillmentMode" AS ENUM ('MANUAL_EXTERNAL');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProviderAccountStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('PENDING', 'ACTIVE', 'DEACTIVATION_PENDING', 'DEACTIVATED', 'REJECTED');

-- CreateTable
CREATE TABLE "license_providers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "fulfillment_mode" "LicenseFulfillmentMode" NOT NULL DEFAULT 'MANUAL_EXTERNAL',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_accounts" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_reference" TEXT,
    "total_capacity" INTEGER NOT NULL,
    "status" "ProviderAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_allocations" (
    "id" TEXT NOT NULL,
    "entitlement_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "provider_account_id" TEXT,
    "user_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "normalized_domain" TEXT NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),
    "deactivated_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "license_providers_code_key" ON "license_providers"("code");

-- CreateIndex
CREATE INDEX "provider_accounts_provider_id_idx" ON "provider_accounts"("provider_id");

-- CreateIndex
CREATE INDEX "provider_accounts_status_idx" ON "provider_accounts"("status");

-- CreateIndex
CREATE INDEX "license_allocations_entitlement_id_idx" ON "license_allocations"("entitlement_id");

-- CreateIndex
CREATE INDEX "license_allocations_provider_id_idx" ON "license_allocations"("provider_id");

-- CreateIndex
CREATE INDEX "license_allocations_provider_account_id_idx" ON "license_allocations"("provider_account_id");

-- CreateIndex
CREATE INDEX "license_allocations_user_id_idx" ON "license_allocations"("user_id");

-- CreateIndex
CREATE INDEX "license_allocations_status_idx" ON "license_allocations"("status");

-- CreateIndex
CREATE INDEX "license_allocations_normalized_domain_idx" ON "license_allocations"("normalized_domain");

-- AddForeignKey
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "license_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_allocations" ADD CONSTRAINT "license_allocations_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_allocations" ADD CONSTRAINT "license_allocations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "license_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_allocations" ADD CONSTRAINT "license_allocations_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "provider_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_allocations" ADD CONSTRAINT "license_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index for active domain per provider
CREATE UNIQUE INDEX "unique_active_provider_domain" ON "license_allocations" ("provider_id", "normalized_domain") WHERE "status" = 'ACTIVE';

-- Partial unique index for non-terminal allocation per entitlement and domain
CREATE UNIQUE INDEX "unique_non_terminal_entitlement_domain" ON "license_allocations" ("entitlement_id", "normalized_domain") WHERE "status" IN ('PENDING', 'ACTIVE', 'DEACTIVATION_PENDING');

