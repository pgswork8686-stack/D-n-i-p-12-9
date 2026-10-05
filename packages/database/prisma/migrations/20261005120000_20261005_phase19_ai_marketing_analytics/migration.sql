-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "analytics";

-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('ORGANIZATION', 'CLIENT');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TenantMemberRole" AS ENUM ('VIEWER', 'ANALYST', 'MANAGER');

-- CreateEnum
CREATE TYPE "AiContextScope" AS ENUM ('SYSTEM', 'ORGANIZATION', 'CLIENT');

-- CreateEnum
CREATE TYPE "AiExecutionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiToolRisk" AS ENUM ('READ', 'WRITE_LOW_RISK', 'WRITE_HIGH_RISK');

-- CreateEnum
CREATE TYPE "AiStepStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AiApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "analytics"."AnalyticsIngestKind" AS ENUM ('MARKETING_DAILY', 'LEAD_FUNNEL_DAILY', 'REVENUE_DAILY', 'SEO_DAILY');

-- CreateEnum
CREATE TYPE "analytics"."AnalyticsBatchStatus" AS ENUM ('NORMALIZED', 'REJECTED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TenantType" NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "parent_id" TEXT,
    "default_currency" "Currency" NOT NULL DEFAULT 'VND',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "TenantMemberRole" NOT NULL DEFAULT 'VIEWER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_contexts" (
    "id" TEXT NOT NULL,
    "scope" "AiContextScope" NOT NULL,
    "tenant_id" TEXT,
    "key" TEXT NOT NULL DEFAULT 'marketing',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_context_versions" (
    "id" TEXT NOT NULL,
    "context_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "change_reason" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_context_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_executions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "workflow_version" TEXT NOT NULL,
    "skills" TEXT[],
    "context_versions" JSONB NOT NULL,
    "status" "AiExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "provider" TEXT,
    "model" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "result_summary" TEXT,
    "error" TEXT,
    "idempotency_key" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_execution_steps" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "risk" "AiToolRisk",
    "status" "AiStepStatus" NOT NULL,
    "input_summary" JSONB,
    "output_summary" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_execution_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_approvals" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "risk" "AiToolRisk" NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" "AiApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_action_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_report_drafts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_report_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."raw_ingest_batches" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "kind" "analytics"."AnalyticsIngestKind" NOT NULL,
    "event_timestamp" TIMESTAMP(3) NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "record_count" INTEGER NOT NULL,
    "status" "analytics"."AnalyticsBatchStatus" NOT NULL,
    "request_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalized_at" TIMESTAMP(3),

    CONSTRAINT "raw_ingest_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."dim_client" (
    "client_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dim_client_pkey" PRIMARY KEY ("client_id")
);

-- CreateTable
CREATE TABLE "analytics"."dim_channel" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "dim_channel_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "analytics"."dim_campaign" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "channel_key" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dim_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."dim_product" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dim_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."dim_date" (
    "date" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "iso_week" INTEGER NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "is_weekend" BOOLEAN NOT NULL,

    CONSTRAINT "dim_date_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "analytics"."fact_marketing_daily" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel_key" TEXT NOT NULL,
    "campaign_key" TEXT NOT NULL DEFAULT '_all',
    "currency" TEXT NOT NULL,
    "spend_minor" BIGINT NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "sessions" BIGINT NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "qualified_leads" INTEGER NOT NULL DEFAULT 0,
    "customers" INTEGER NOT NULL DEFAULT 0,
    "revenue_minor" BIGINT NOT NULL DEFAULT 0,
    "source_batch_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fact_marketing_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."fact_lead_funnel_daily" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel_key" TEXT NOT NULL,
    "sessions" BIGINT NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "qualified_leads" INTEGER NOT NULL DEFAULT 0,
    "opportunities" INTEGER NOT NULL DEFAULT 0,
    "customers" INTEGER NOT NULL DEFAULT 0,
    "source_batch_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fact_lead_funnel_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."fact_revenue_daily" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel_key" TEXT NOT NULL,
    "product_key" TEXT NOT NULL DEFAULT '_all',
    "currency" TEXT NOT NULL,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue_minor" BIGINT NOT NULL DEFAULT 0,
    "refunds_minor" BIGINT NOT NULL DEFAULT 0,
    "source_batch_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fact_revenue_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."fact_seo_daily" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "page_key" TEXT NOT NULL,
    "query_key" TEXT NOT NULL DEFAULT '_all',
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "position_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sessions" BIGINT NOT NULL DEFAULT 0,
    "source_batch_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fact_seo_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_parent_id_idx" ON "tenants"("parent_id");

-- CreateIndex
CREATE INDEX "tenant_members_user_id_idx" ON "tenant_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_members_tenant_id_user_id_key" ON "tenant_members"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "ai_contexts_tenant_id_idx" ON "ai_contexts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_context_versions_context_id_version_key" ON "ai_context_versions"("context_id", "version");

-- CreateIndex
CREATE INDEX "ai_executions_tenant_id_started_at_idx" ON "ai_executions"("tenant_id", "started_at");

-- CreateIndex
CREATE INDEX "ai_executions_user_id_started_at_idx" ON "ai_executions"("user_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_executions_user_id_idempotency_key_key" ON "ai_executions"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_execution_steps_execution_id_seq_key" ON "ai_execution_steps"("execution_id", "seq");

-- CreateIndex
CREATE INDEX "ai_action_approvals_tenant_id_status_idx" ON "ai_action_approvals"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_report_drafts_execution_id_key" ON "ai_report_drafts"("execution_id");

-- CreateIndex
CREATE INDEX "ai_report_drafts_tenant_id_created_at_idx" ON "ai_report_drafts"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "raw_ingest_batches_client_id_received_at_idx" ON "analytics"."raw_ingest_batches"("client_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "raw_ingest_batches_source_idempotency_key_key" ON "analytics"."raw_ingest_batches"("source", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "dim_campaign_client_id_channel_key_external_id_key" ON "analytics"."dim_campaign"("client_id", "channel_key", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "dim_product_client_id_external_id_key" ON "analytics"."dim_product"("client_id", "external_id");

-- CreateIndex
CREATE INDEX "fact_marketing_daily_client_id_date_idx" ON "analytics"."fact_marketing_daily"("client_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "fact_marketing_daily_client_id_date_channel_key_campaign_ke_key" ON "analytics"."fact_marketing_daily"("client_id", "date", "channel_key", "campaign_key");

-- CreateIndex
CREATE INDEX "fact_lead_funnel_daily_client_id_date_idx" ON "analytics"."fact_lead_funnel_daily"("client_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "fact_lead_funnel_daily_client_id_date_channel_key_key" ON "analytics"."fact_lead_funnel_daily"("client_id", "date", "channel_key");

-- CreateIndex
CREATE INDEX "fact_revenue_daily_client_id_date_idx" ON "analytics"."fact_revenue_daily"("client_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "fact_revenue_daily_client_id_date_channel_key_product_key_key" ON "analytics"."fact_revenue_daily"("client_id", "date", "channel_key", "product_key");

-- CreateIndex
CREATE INDEX "fact_seo_daily_client_id_date_idx" ON "analytics"."fact_seo_daily"("client_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "fact_seo_daily_client_id_date_page_key_query_key_key" ON "analytics"."fact_seo_daily"("client_id", "date", "page_key", "query_key");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_contexts" ADD CONSTRAINT "ai_contexts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_context_versions" ADD CONSTRAINT "ai_context_versions_context_id_fkey" FOREIGN KEY ("context_id") REFERENCES "ai_contexts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_execution_steps" ADD CONSTRAINT "ai_execution_steps_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "ai_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "ai_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_drafts" ADD CONSTRAINT "ai_report_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report_drafts" ADD CONSTRAINT "ai_report_drafts_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "ai_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics"."raw_ingest_batches" ADD CONSTRAINT "raw_ingest_batches_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "analytics"."dim_client"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics"."dim_client" ADD CONSTRAINT "dim_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics"."dim_campaign" ADD CONSTRAINT "dim_campaign_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "analytics"."dim_client"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics"."dim_product" ADD CONSTRAINT "dim_product_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "analytics"."dim_client"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics"."fact_marketing_daily" ADD CONSTRAINT "fact_marketing_daily_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "analytics"."dim_client"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics"."fact_lead_funnel_daily" ADD CONSTRAINT "fact_lead_funnel_daily_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "analytics"."dim_client"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics"."fact_revenue_daily" ADD CONSTRAINT "fact_revenue_daily_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "analytics"."dim_client"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics"."fact_seo_daily" ADD CONSTRAINT "fact_seo_daily_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "analytics"."dim_client"("client_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Phase 19 hand-written invariants (not expressible in Prisma schema).
-- Additive only: no existing table, column, row or constraint is modified.
-- ============================================================================

-- Tenancy: a CLIENT may hang under an ORGANIZATION; an ORGANIZATION has no parent.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_hierarchy_check"
  CHECK ((type = 'ORGANIZATION' AND parent_id IS NULL) OR type = 'CLIENT');
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slug_format_check"
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$');

-- AI context: SYSTEM contexts are global; ORGANIZATION/CLIENT contexts belong to a tenant.
ALTER TABLE "ai_contexts" ADD CONSTRAINT "ai_contexts_scope_tenant_check"
  CHECK ((scope = 'SYSTEM' AND tenant_id IS NULL) OR (scope <> 'SYSTEM' AND tenant_id IS NOT NULL));
-- One context per (scope, tenant, key); NULL tenant (SYSTEM) handled with COALESCE.
CREATE UNIQUE INDEX "ai_contexts_scope_tenant_key_unique"
  ON "ai_contexts" (scope, COALESCE(tenant_id, ''), key);
ALTER TABLE "ai_context_versions" ADD CONSTRAINT "ai_context_versions_version_positive"
  CHECK (version >= 1 AND length(change_reason) >= 3);

-- Context versions are append-only: never silently overwritten or deleted.
CREATE OR REPLACE FUNCTION ai_context_versions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai_context_versions is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ai_context_versions_no_update_delete"
  BEFORE UPDATE OR DELETE ON "ai_context_versions"
  FOR EACH ROW EXECUTE FUNCTION ai_context_versions_immutable();

-- An approval decision is recorded exactly once.
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_decision_check"
  CHECK ((status = 'PENDING' AND decided_by_id IS NULL AND decided_at IS NULL)
      OR (status <> 'PENDING' AND decided_by_id IS NOT NULL AND decided_at IS NOT NULL));
-- Four-eyes rule: the requester cannot approve their own high-risk action.
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_four_eyes_check"
  CHECK (decided_by_id IS NULL OR decided_by_id <> requested_by_id);

-- Warehouse measures are never negative.
ALTER TABLE "analytics"."fact_marketing_daily" ADD CONSTRAINT "fact_marketing_daily_non_negative"
  CHECK (spend_minor >= 0 AND impressions >= 0 AND clicks >= 0 AND sessions >= 0
     AND leads >= 0 AND qualified_leads >= 0 AND customers >= 0 AND revenue_minor >= 0
     AND qualified_leads <= leads);
ALTER TABLE "analytics"."fact_lead_funnel_daily" ADD CONSTRAINT "fact_lead_funnel_daily_non_negative"
  CHECK (sessions >= 0 AND leads >= 0 AND qualified_leads >= 0 AND opportunities >= 0 AND customers >= 0);
ALTER TABLE "analytics"."fact_revenue_daily" ADD CONSTRAINT "fact_revenue_daily_non_negative"
  CHECK (orders >= 0 AND revenue_minor >= 0 AND refunds_minor >= 0);
ALTER TABLE "analytics"."fact_seo_daily" ADD CONSTRAINT "fact_seo_daily_non_negative"
  CHECK (impressions >= 0 AND clicks >= 0 AND position_sum >= 0 AND sessions >= 0);

-- Calendar dimension 2020-01-01 .. 2035-12-31.
INSERT INTO "analytics"."dim_date" (date, year, quarter, month, iso_week, day_of_week, is_weekend)
SELECT d::date,
       EXTRACT(YEAR FROM d)::int,
       EXTRACT(QUARTER FROM d)::int,
       EXTRACT(MONTH FROM d)::int,
       EXTRACT(WEEK FROM d)::int,
       EXTRACT(ISODOW FROM d)::int,
       EXTRACT(ISODOW FROM d) IN (6, 7)
FROM generate_series('2020-01-01'::date, '2035-12-31'::date, interval '1 day') AS d
ON CONFLICT (date) DO NOTHING;

-- Canonical acquisition channels (connectors map their sources onto these keys).
INSERT INTO "analytics"."dim_channel" (key, name, category) VALUES
  ('google_ads', 'Google Ads', 'PAID'),
  ('meta_ads', 'Meta Ads', 'PAID'),
  ('tiktok_ads', 'TikTok Ads', 'PAID'),
  ('zalo_ads', 'Zalo Ads', 'PAID'),
  ('organic_search', 'Organic Search', 'EARNED'),
  ('organic_social', 'Organic Social', 'EARNED'),
  ('referral', 'Referral', 'EARNED'),
  ('email', 'Email', 'OWNED'),
  ('direct', 'Direct', 'OWNED'),
  ('other', 'Other', 'OTHER')
ON CONFLICT (key) DO NOTHING;
