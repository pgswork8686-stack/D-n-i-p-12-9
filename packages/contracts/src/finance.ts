import { Currency } from "./index";

export type LedgerAccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "EXPENSE";

export type LedgerAccountCode =
  | "ACCOUNTS_RECEIVABLE"
  | "SALES_REVENUE"
  | "TAX_LIABILITY"
  | "REFUND_EXPENSE"
  | "AFFILIATE_COMMISSION_PAYABLE"
  | "GATEWAY_FEE_EXPENSE";

export type LedgerEntryType = "DEBIT" | "CREDIT";

export type InvoiceStatus =
  | "DRAFT"
  | "ISSUED"
  | "PAID"
  | "VOID"
  | "REFUNDED";

export type TaxJurisdiction =
  | "US"
  | "EU"
  | "VN"
  | "UK"
  | "AU"
  | "ROW";

export interface LedgerEntryDto {
  id: string;
  transactionId: string;
  accountCode: LedgerAccountCode;
  accountType: LedgerAccountType;
  entryType: LedgerEntryType;
  amountMinor: number;
  currency: Currency;
  referenceType: string;
  referenceId: string;
  description: string;
  createdAt: string;
}

export interface TaxCalculationRequest {
  subtotalMinor: number;
  currency: Currency;
  countryCode: string;
  stateCode?: string;
  isB2B?: boolean;
  vatId?: string;
}

export interface TaxCalculationResponse {
  subtotalMinor: number;
  taxRateBasisPoints: number;
  taxAmountMinor: number;
  totalMinor: number;
  jurisdiction: TaxJurisdiction;
  isReverseCharge: boolean;
  taxName: string;
}

export interface InvoiceItemDto {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
  taxRateBasisPoints: number;
  taxAmountMinor: number;
}

export interface InvoiceDto {
  id: string;
  invoiceNumber: string;
  orderId: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  customerAddress?: string | null;
  status: InvoiceStatus;
  currency: Currency;
  subtotalMinor: number;
  taxAmountMinor: number;
  totalAmountMinor: number;
  taxRateBasisPoints: number;
  isReverseCharge: boolean;
  vatId?: string | null;
  pdfStorageKey?: string | null;
  issuedAt: string;
  paidAt?: string | null;
  metadata?: Record<string, unknown> | null;
  items?: InvoiceItemDto[];
}

export interface QueryInvoicesRequest {
  status?: InvoiceStatus;
  orderId?: string;
  userId?: string;
  page?: number;
  limit?: number;
}

export interface QueryLedgerRequest {
  accountCode?: LedgerAccountCode;
  referenceType?: string;
  referenceId?: string;
  page?: number;
  limit?: number;
}

export interface FinancialSummaryReportDto {
  periodStart: string;
  periodEnd: string;
  currency: Currency;
  grossRevenueMinor: number;
  netRevenueMinor: number;
  totalTaxMinor: number;
  totalRefundsMinor: number;
  totalAffiliateCommissionsMinor: number;
  ledgerTransactionCount: number;
}
