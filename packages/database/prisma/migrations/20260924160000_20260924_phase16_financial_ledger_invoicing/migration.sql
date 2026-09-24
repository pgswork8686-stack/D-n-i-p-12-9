-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "LedgerAccountCode" AS ENUM ('ACCOUNTS_RECEIVABLE', 'SALES_REVENUE', 'TAX_LIABILITY', 'REFUND_EXPENSE', 'AFFILIATE_COMMISSION_PAYABLE', 'GATEWAY_FEE_EXPENSE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID', 'REFUNDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable financial_ledger_entries
CREATE TABLE IF NOT EXISTS "financial_ledger_entries" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "account_code" "LedgerAccountCode" NOT NULL,
    "account_type" "LedgerAccountType" NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable invoices
CREATE TABLE IF NOT EXISTS "invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "customer_address" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "subtotal_minor" INTEGER NOT NULL,
    "tax_amount_minor" INTEGER NOT NULL DEFAULT 0,
    "total_amount_minor" INTEGER NOT NULL,
    "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
    "is_reverse_charge" BOOLEAN NOT NULL DEFAULT false,
    "vat_id" TEXT,
    "pdf_storage_key" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable invoice_items
CREATE TABLE IF NOT EXISTS "invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_minor" INTEGER NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
    "tax_amount_minor" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "financial_ledger_entries_transaction_id_idx" ON "financial_ledger_entries"("transaction_id");
CREATE INDEX IF NOT EXISTS "financial_ledger_entries_account_code_idx" ON "financial_ledger_entries"("account_code");
CREATE INDEX IF NOT EXISTS "financial_ledger_entries_reference_type_reference_id_idx" ON "financial_ledger_entries"("reference_type", "reference_id");
CREATE INDEX IF NOT EXISTS "financial_ledger_entries_created_at_idx" ON "financial_ledger_entries"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_order_id_key" ON "invoices"("order_id");
CREATE INDEX IF NOT EXISTS "invoices_user_id_idx" ON "invoices"("user_id");
CREATE INDEX IF NOT EXISTS "invoices_order_id_idx" ON "invoices"("order_id");
CREATE INDEX IF NOT EXISTS "invoices_invoice_number_idx" ON "invoices"("invoice_number");
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices"("status");
CREATE INDEX IF NOT EXISTS "invoices_issued_at_idx" ON "invoices"("issued_at");

CREATE INDEX IF NOT EXISTS "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- AddForeignKeys
DO $$ BEGIN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
