-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "DownloadChannel" AS ENUM ('CUSTOMER_PORTAL', 'LICENSE_UPDATER');

-- CreateTable
CREATE TABLE "product_versions" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "release_notes" TEXT,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_version_files" (
    "id" TEXT NOT NULL,
    "product_version_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'application/zip',
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_version_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "entitlement_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_version_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "channel" "DownloadChannel" NOT NULL,
    "ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_versions_product_id_version_key" ON "product_versions"("product_id", "version");

-- CreateIndex
CREATE INDEX "product_versions_product_id_idx" ON "product_versions"("product_id");

-- CreateIndex
CREATE INDEX "product_versions_status_idx" ON "product_versions"("status");

-- CreateIndex
CREATE INDEX "product_versions_product_id_status_idx" ON "product_versions"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_version_files_storage_key_key" ON "product_version_files"("storage_key");

-- CreateIndex
CREATE INDEX "product_version_files_product_version_id_idx" ON "product_version_files"("product_version_id");

-- CreateIndex
CREATE INDEX "product_version_files_storage_key_idx" ON "product_version_files"("storage_key");

-- CreateIndex
CREATE INDEX "download_events_entitlement_id_idx" ON "download_events"("entitlement_id");

-- CreateIndex
CREATE INDEX "download_events_user_id_idx" ON "download_events"("user_id");

-- CreateIndex
CREATE INDEX "download_events_product_id_idx" ON "download_events"("product_id");

-- CreateIndex
CREATE INDEX "download_events_product_version_id_idx" ON "download_events"("product_version_id");

-- CreateIndex
CREATE INDEX "download_events_file_id_idx" ON "download_events"("file_id");

-- CreateIndex
CREATE INDEX "download_events_created_at_idx" ON "download_events"("created_at");

-- AddForeignKey
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_version_files" ADD CONSTRAINT "product_version_files_product_version_id_fkey" FOREIGN KEY ("product_version_id") REFERENCES "product_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_product_version_id_fkey" FOREIGN KEY ("product_version_id") REFERENCES "product_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "product_version_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
