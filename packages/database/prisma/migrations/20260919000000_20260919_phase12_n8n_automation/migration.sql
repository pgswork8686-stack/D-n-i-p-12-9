-- CreateEnum
CREATE TYPE "AutomationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationJobType" AS ENUM ('CMS_AI_DRAFT', 'ORDER_PAID_EMAIL', 'LICENSE_PROVISIONED_EMAIL', 'EXTERNAL_ALLOCATION_EMAIL');

-- CreateTable
CREATE TABLE "automation_jobs" (
    "id" TEXT NOT NULL,
    "type" "AutomationJobType" NOT NULL,
    "status" "AutomationJobStatus" NOT NULL DEFAULT 'PENDING',
    "source_type" TEXT,
    "source_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "result_json" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_deliveries" (
    "id" TEXT NOT NULL,
    "job_id" TEXT,
    "recipient_email" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload_json" JSONB,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_jobs_idempotency_key_key" ON "automation_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "automation_jobs_status_scheduled_at_idx" ON "automation_jobs"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "automation_jobs_type_status_idx" ON "automation_jobs"("type", "status");

-- CreateIndex
CREATE INDEX "automation_jobs_source_type_source_id_idx" ON "automation_jobs"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_deliveries_idempotency_key_key" ON "automation_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "automation_deliveries_job_id_idx" ON "automation_deliveries"("job_id");

-- CreateIndex
CREATE INDEX "automation_deliveries_status_idx" ON "automation_deliveries"("status");

-- AddForeignKey
ALTER TABLE "automation_deliveries" ADD CONSTRAINT "automation_deliveries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "automation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
