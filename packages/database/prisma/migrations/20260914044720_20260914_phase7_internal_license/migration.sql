-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "LicenseActivationStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateTable
CREATE TABLE "internal_licenses" (
    "id" TEXT NOT NULL,
    "entitlement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "key_hash" TEXT NOT NULL,
    "key_ciphertext" TEXT NOT NULL,
    "key_iv" TEXT NOT NULL,
    "key_auth_tag" TEXT NOT NULL,
    "key_last4" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "internal_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_activations" (
    "id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "normalized_domain" TEXT NOT NULL,
    "status" "LicenseActivationStatus" NOT NULL DEFAULT 'ACTIVE',
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMP(3),
    "last_validated_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_activations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_licenses_entitlement_id_key" ON "internal_licenses"("entitlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "internal_licenses_key_hash_key" ON "internal_licenses"("key_hash");

-- CreateIndex
CREATE INDEX "internal_licenses_user_id_idx" ON "internal_licenses"("user_id");

-- CreateIndex
CREATE INDEX "internal_licenses_product_id_idx" ON "internal_licenses"("product_id");

-- CreateIndex
CREATE INDEX "internal_licenses_variant_id_idx" ON "internal_licenses"("variant_id");

-- CreateIndex
CREATE INDEX "internal_licenses_status_idx" ON "internal_licenses"("status");

-- CreateIndex
CREATE INDEX "license_activations_license_id_idx" ON "license_activations"("license_id");

-- CreateIndex
CREATE INDEX "license_activations_user_id_idx" ON "license_activations"("user_id");

-- CreateIndex
CREATE INDEX "license_activations_status_idx" ON "license_activations"("status");

-- CreateIndex
CREATE INDEX "license_activations_normalized_domain_idx" ON "license_activations"("normalized_domain");

-- AddForeignKey
ALTER TABLE "internal_licenses" ADD CONSTRAINT "internal_licenses_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_licenses" ADD CONSTRAINT "internal_licenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_licenses" ADD CONSTRAINT "internal_licenses_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_licenses" ADD CONSTRAINT "internal_licenses_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "internal_licenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (Partial Unique Index for active domain under same license)
CREATE UNIQUE INDEX "unique_active_license_domain" ON "license_activations" ("license_id", "normalized_domain") WHERE status = 'ACTIVE';
