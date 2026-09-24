-- AlterEnum
ALTER TYPE "FulfillmentType" ADD VALUE IF NOT EXISTS 'HOSTING_PROVISIONING';

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "HostingProvider" AS ENUM ('CPANEL', 'DIRECTADMIN', 'CLOUDFLARE', 'MOCK');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "HostingAccountStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "DnsRecordType" AS ENUM ('A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "DnsRecordStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR', 'DELETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "hosting_servers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "provider" "HostingProvider" NOT NULL DEFAULT 'MOCK',
    "endpoint_url" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "max_accounts" INTEGER NOT NULL DEFAULT 100,
    "active_accounts" INTEGER NOT NULL DEFAULT 0,
    "auth_encrypted_token" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosting_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "hosting_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "entitlement_id" TEXT,
    "order_id" TEXT,
    "domain" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "package_plan" TEXT NOT NULL DEFAULT 'default',
    "status" "HostingAccountStatus" NOT NULL DEFAULT 'PROVISIONING',
    "disk_usage_mb" INTEGER NOT NULL DEFAULT 0,
    "disk_limit_mb" INTEGER NOT NULL DEFAULT 5120,
    "bandwidth_usage_mb" INTEGER NOT NULL DEFAULT 0,
    "bandwidth_limit_mb" INTEGER NOT NULL DEFAULT 51200,
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "terminated_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosting_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "hosting_dns_records" (
    "id" TEXT NOT NULL,
    "hosting_account_id" TEXT NOT NULL,
    "type" "DnsRecordType" NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "ttl" INTEGER NOT NULL DEFAULT 3600,
    "priority" INTEGER,
    "proxied" BOOLEAN NOT NULL DEFAULT false,
    "cloudflare_record_id" TEXT,
    "status" "DnsRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosting_dns_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "hosting_servers_hostname_key" ON "hosting_servers"("hostname");
CREATE INDEX IF NOT EXISTS "hosting_servers_provider_idx" ON "hosting_servers"("provider");
CREATE INDEX IF NOT EXISTS "hosting_servers_is_active_idx" ON "hosting_servers"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "hosting_accounts_entitlement_id_key" ON "hosting_accounts"("entitlement_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hosting_accounts_domain_key" ON "hosting_accounts"("domain");
CREATE UNIQUE INDEX IF NOT EXISTS "hosting_accounts_username_key" ON "hosting_accounts"("username");
CREATE INDEX IF NOT EXISTS "hosting_accounts_user_id_idx" ON "hosting_accounts"("user_id");
CREATE INDEX IF NOT EXISTS "hosting_accounts_server_id_idx" ON "hosting_accounts"("server_id");
CREATE INDEX IF NOT EXISTS "hosting_accounts_status_idx" ON "hosting_accounts"("status");
CREATE INDEX IF NOT EXISTS "hosting_accounts_domain_idx" ON "hosting_accounts"("domain");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "hosting_dns_records_hosting_account_id_idx" ON "hosting_dns_records"("hosting_account_id");
CREATE INDEX IF NOT EXISTS "hosting_dns_records_name_idx" ON "hosting_dns_records"("name");
CREATE INDEX IF NOT EXISTS "hosting_dns_records_type_idx" ON "hosting_dns_records"("type");
CREATE INDEX IF NOT EXISTS "hosting_dns_records_status_idx" ON "hosting_dns_records"("status");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "hosting_accounts" ADD CONSTRAINT "hosting_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hosting_accounts" ADD CONSTRAINT "hosting_accounts_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "hosting_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hosting_accounts" ADD CONSTRAINT "hosting_accounts_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hosting_accounts" ADD CONSTRAINT "hosting_accounts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hosting_dns_records" ADD CONSTRAINT "hosting_dns_records_hosting_account_id_fkey" FOREIGN KEY ("hosting_account_id") REFERENCES "hosting_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
