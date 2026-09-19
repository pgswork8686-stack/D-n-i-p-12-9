-- CreateEnum
CREATE TYPE "AutomationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "automation_deliveries" ADD COLUMN "provider_message_id" TEXT;

-- Convert status from text to AutomationDeliveryStatus
ALTER TABLE "automation_deliveries" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "automation_deliveries" ALTER COLUMN "status" TYPE "AutomationDeliveryStatus" USING ("status"::text::"AutomationDeliveryStatus");
ALTER TABLE "automation_deliveries" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"AutomationDeliveryStatus";
