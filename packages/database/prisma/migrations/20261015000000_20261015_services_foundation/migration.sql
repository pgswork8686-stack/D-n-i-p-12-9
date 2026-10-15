-- Services Foundation: service catalog, inquiries, project management foundation.
-- Additive only: creates new enums/tables/indexes; no existing table or column is altered or dropped.

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ServicePricingMode" AS ENUM ('QUOTE_REQUIRED', 'DIRECT_CHECKOUT');

-- CreateEnum
CREATE TYPE "ServiceInquiryStatus" AS ENUM ('NEW', 'REVIEWING', 'QUALIFIED', 'REJECTED', 'SPAM', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ServiceProjectStatus" AS ENUM ('PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'IN_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceMilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ServiceProjectMemberRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "ServiceDocumentVisibility" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ServiceSenderType" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "ServiceProjectEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'MEMBER_ASSIGNED', 'MEMBER_REMOVED', 'MILESTONE_CREATED', 'MILESTONE_UPDATED', 'DOCUMENT_ADDED', 'MESSAGE_POSTED');

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "process_steps" JSONB NOT NULL DEFAULT '[]',
    "image_url" TEXT,
    "cta_label" TEXT NOT NULL DEFAULT 'Nhận báo giá',
    "pricing_mode" "ServicePricingMode" NOT NULL DEFAULT 'QUOTE_REQUIRED',
    "product_id" TEXT,
    "status" "ServiceStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_inquiries" (
    "id" TEXT NOT NULL,
    "inquiry_number" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "user_id" TEXT,
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "requirements" TEXT NOT NULL,
    "desired_features" JSONB NOT NULL DEFAULT '[]',
    "budget_range" TEXT,
    "timeline" TEXT,
    "status" "ServiceInquiryStatus" NOT NULL DEFAULT 'NEW',
    "submission_key" TEXT,
    "ip_hash" TEXT,
    "staff_note" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_inquiry_attachments" (
    "id" TEXT NOT NULL,
    "inquiry_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_inquiry_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_projects" (
    "id" TEXT NOT NULL,
    "project_code" TEXT NOT NULL,
    "inquiry_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "ServiceProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "start_date" TIMESTAMP(3),
    "target_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_project_members" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "ServiceProjectMemberRole" NOT NULL DEFAULT 'MEMBER',
    "assigned_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_milestones" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMP(3),
    "status" "ServiceMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_project_documents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "visibility" "ServiceDocumentVisibility" NOT NULL DEFAULT 'CUSTOMER',
    "uploaded_by_id" TEXT,
    "uploader_type" "ServiceSenderType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_project_messages" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_type" "ServiceSenderType" NOT NULL,
    "is_internal_note" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_project_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_project_events" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "type" "ServiceProjectEventType" NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "from_status" TEXT,
    "to_status" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_project_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE INDEX "services_status_sort_order_idx" ON "services"("status", "sort_order");

-- CreateIndex
CREATE INDEX "services_product_id_idx" ON "services"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_inquiries_inquiry_number_key" ON "service_inquiries"("inquiry_number");

-- CreateIndex
CREATE UNIQUE INDEX "service_inquiries_submission_key_key" ON "service_inquiries"("submission_key");

-- CreateIndex
CREATE INDEX "service_inquiries_user_id_idx" ON "service_inquiries"("user_id");

-- CreateIndex
CREATE INDEX "service_inquiries_service_id_idx" ON "service_inquiries"("service_id");

-- CreateIndex
CREATE INDEX "service_inquiries_status_idx" ON "service_inquiries"("status");

-- CreateIndex
CREATE INDEX "service_inquiries_contact_email_idx" ON "service_inquiries"("contact_email");

-- CreateIndex
CREATE INDEX "service_inquiries_created_at_idx" ON "service_inquiries"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_inquiry_attachments_storage_key_key" ON "service_inquiry_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "service_inquiry_attachments_inquiry_id_idx" ON "service_inquiry_attachments"("inquiry_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_projects_project_code_key" ON "service_projects"("project_code");

-- CreateIndex
CREATE UNIQUE INDEX "service_projects_inquiry_id_key" ON "service_projects"("inquiry_id");

-- CreateIndex
CREATE INDEX "service_projects_customer_id_idx" ON "service_projects"("customer_id");

-- CreateIndex
CREATE INDEX "service_projects_service_id_idx" ON "service_projects"("service_id");

-- CreateIndex
CREATE INDEX "service_projects_status_idx" ON "service_projects"("status");

-- CreateIndex
CREATE INDEX "service_projects_created_at_idx" ON "service_projects"("created_at");

-- CreateIndex
CREATE INDEX "service_project_members_user_id_idx" ON "service_project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_project_members_project_id_user_id_key" ON "service_project_members"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "service_milestones_project_id_sort_order_idx" ON "service_milestones"("project_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "service_project_documents_storage_key_key" ON "service_project_documents"("storage_key");

-- CreateIndex
CREATE INDEX "service_project_documents_project_id_idx" ON "service_project_documents"("project_id");

-- CreateIndex
CREATE INDEX "service_project_messages_project_id_created_at_idx" ON "service_project_messages"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "service_project_events_project_id_created_at_idx" ON "service_project_events"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_inquiries" ADD CONSTRAINT "service_inquiries_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_inquiries" ADD CONSTRAINT "service_inquiries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_inquiries" ADD CONSTRAINT "service_inquiries_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_inquiry_attachments" ADD CONSTRAINT "service_inquiry_attachments_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "service_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_inquiry_attachments" ADD CONSTRAINT "service_inquiry_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_projects" ADD CONSTRAINT "service_projects_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "service_inquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_projects" ADD CONSTRAINT "service_projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_projects" ADD CONSTRAINT "service_projects_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_projects" ADD CONSTRAINT "service_projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_project_members" ADD CONSTRAINT "service_project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "service_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_project_members" ADD CONSTRAINT "service_project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_project_members" ADD CONSTRAINT "service_project_members_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_milestones" ADD CONSTRAINT "service_milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "service_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_project_documents" ADD CONSTRAINT "service_project_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "service_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_project_documents" ADD CONSTRAINT "service_project_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_project_messages" ADD CONSTRAINT "service_project_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "service_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_project_messages" ADD CONSTRAINT "service_project_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_project_events" ADD CONSTRAINT "service_project_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "service_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_project_events" ADD CONSTRAINT "service_project_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

