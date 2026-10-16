-- F-12: consent evidence on service inquiries + notification types.
-- Additive only: no existing column, row or constraint is altered or removed.
-- Rows created before this migration keep consent_version / consent_at NULL, which means
-- "no consent recorded" and is never backfilled.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SERVICE_INQUIRY_CREATED';
ALTER TYPE "AutomationJobType" ADD VALUE IF NOT EXISTS 'SERVICE_INQUIRY_NOTIFY_EMAIL';

ALTER TABLE "service_inquiries"
  ADD COLUMN "consent_version" TEXT,
  ADD COLUMN "consent_at" TIMESTAMP(3),
  ADD COLUMN "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "marketing_consent_at" TIMESTAMP(3);

-- A consent version always travels with its timestamp, and marketing consent with its own.
ALTER TABLE "service_inquiries"
  ADD CONSTRAINT "service_inquiries_consent_pair_check"
    CHECK (("consent_version" IS NULL) = ("consent_at" IS NULL)),
  ADD CONSTRAINT "service_inquiries_marketing_consent_check"
    CHECK ("marketing_consent" = ("marketing_consent_at" IS NOT NULL));
