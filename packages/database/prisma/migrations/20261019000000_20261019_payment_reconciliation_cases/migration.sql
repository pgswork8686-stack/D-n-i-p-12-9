-- CreateTable
CREATE TABLE "payment_reconciliation_cases" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "payment_id" TEXT,
    "order_id" TEXT,
    "transfer_code" TEXT,
    "expected_amount" INTEGER,
    "received_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "raw_payload_hash" TEXT,
    "sanitized_payload" JSONB NOT NULL,
    "last_requery" JSONB,
    "last_requery_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_reconciliation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_reconciliation_cases_provider_external_event_id_key" ON "payment_reconciliation_cases"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "payment_reconciliation_cases_status_created_at_idx" ON "payment_reconciliation_cases"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_reconciliation_cases_payment_id_idx" ON "payment_reconciliation_cases"("payment_id");

-- CreateIndex
CREATE INDEX "payment_reconciliation_cases_order_id_idx" ON "payment_reconciliation_cases"("order_id");
