-- AlterTable
ALTER TABLE "download_events" ADD COLUMN "grant_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "download_events_grant_id_key" ON "download_events"("grant_id");

-- AddForeignKey
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "download_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
