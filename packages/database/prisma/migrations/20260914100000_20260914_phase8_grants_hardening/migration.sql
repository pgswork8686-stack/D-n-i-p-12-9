-- AlterTable
ALTER TABLE "product_version_files" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "product_version_files_version_primary_unique" ON "product_version_files"("product_version_id") WHERE is_primary = true;

-- CreateTable
CREATE TABLE "download_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "entitlement_id" TEXT NOT NULL,
    "product_version_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "channel" "DownloadChannel" NOT NULL,
    "license_id" TEXT,
    "normalized_domain" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "download_grants_entitlement_id_issued_at_idx" ON "download_grants"("entitlement_id", "issued_at");

-- CreateIndex
CREATE INDEX "download_grants_license_id_issued_at_idx" ON "download_grants"("license_id", "issued_at");

-- CreateIndex
CREATE INDEX "download_grants_file_id_idx" ON "download_grants"("file_id");

-- AddForeignKey
ALTER TABLE "download_grants" ADD CONSTRAINT "download_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_grants" ADD CONSTRAINT "download_grants_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_grants" ADD CONSTRAINT "download_grants_product_version_id_fkey" FOREIGN KEY ("product_version_id") REFERENCES "product_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_grants" ADD CONSTRAINT "download_grants_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "product_version_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_grants" ADD CONSTRAINT "download_grants_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "internal_licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
