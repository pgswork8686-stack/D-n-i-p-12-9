import {
  LedgerAccountType,
  LedgerAccountCode,
  LedgerEntryType,
  Currency,
} from "@prisma/client";
import { isZeroSumLedger } from "@nexus/utils";

export interface LedgerEntryInput {
  transactionId: string;
  accountCode: LedgerAccountCode;
  accountType: LedgerAccountType;
  entryType: LedgerEntryType;
  amountMinor: number;
  currency: Currency;
  referenceType: string;
  referenceId: string;
  description: string;
}

/**
 * Maps standard Chart of Accounts code to accounting Account Type.
 */
export function resolveAccountType(
  code: LedgerAccountCode,
): LedgerAccountType {
  switch (code) {
    case "ACCOUNTS_RECEIVABLE":
      return LedgerAccountType.ASSET;
    case "TAX_LIABILITY":
    case "AFFILIATE_COMMISSION_PAYABLE":
      return LedgerAccountType.LIABILITY;
    case "SALES_REVENUE":
      return LedgerAccountType.REVENUE;
    case "REFUND_EXPENSE":
    case "GATEWAY_FEE_EXPENSE":
      return LedgerAccountType.EXPENSE;
    default:
      return LedgerAccountType.EXPENSE;
  }
}

/**
 * Builds double-entry balanced ledger entries for an order settlement (ORDER_PAID).
 * Invariant: Sum(Debit) === Sum(Credit).
 */
export function buildOrderPaymentLedgerEntries(params: {
  transactionId: string;
  orderId: string;
  subtotalMinor: number;
  taxAmountMinor: number;
  totalAmountMinor: number;
  currency: Currency;
  gatewayFeeMinor?: number;
}): LedgerEntryInput[] {
  const {
    transactionId,
    orderId,
    subtotalMinor,
    taxAmountMinor,
    totalAmountMinor,
    currency,
    gatewayFeeMinor = 0,
  } = params;

  const entries: LedgerEntryInput[] = [];

  // 1. Debit Accounts Receivable / Cash Clearing for total amount collected
  entries.push({
    transactionId,
    accountCode: LedgerAccountCode.ACCOUNTS_RECEIVABLE,
    accountType: resolveAccountType(LedgerAccountCode.ACCOUNTS_RECEIVABLE),
    entryType: LedgerEntryType.DEBIT,
    amountMinor: totalAmountMinor,
    currency,
    referenceType: "Order",
    referenceId: orderId,
    description: `Payment collected for order #${orderId}`,
  });

  // 2. Credit Sales Revenue for subtotal
  entries.push({
    transactionId,
    accountCode: LedgerAccountCode.SALES_REVENUE,
    accountType: resolveAccountType(LedgerAccountCode.SALES_REVENUE),
    entryType: LedgerEntryType.CREDIT,
    amountMinor: subtotalMinor,
    currency,
    referenceType: "Order",
    referenceId: orderId,
    description: `Sales revenue recognized for order #${orderId}`,
  });

  // 3. Credit Tax Liability for sales tax / VAT collected
  if (taxAmountMinor > 0) {
    entries.push({
      transactionId,
      accountCode: LedgerAccountCode.TAX_LIABILITY,
      accountType: resolveAccountType(LedgerAccountCode.TAX_LIABILITY),
      entryType: LedgerEntryType.CREDIT,
      amountMinor: taxAmountMinor,
      currency,
      referenceType: "Order",
      referenceId: orderId,
      description: `Tax liability collected for order #${orderId}`,
    });
  }

  // 4. Gateway Processing Fee if applicable (balanced sub-entry)
  if (gatewayFeeMinor > 0) {
    entries.push({
      transactionId,
      accountCode: LedgerAccountCode.GATEWAY_FEE_EXPENSE,
      accountType: resolveAccountType(LedgerAccountCode.GATEWAY_FEE_EXPENSE),
      entryType: LedgerEntryType.DEBIT,
      amountMinor: gatewayFeeMinor,
      currency,
      referenceType: "Order",
      referenceId: orderId,
      description: `Payment gateway processing fee for order #${orderId}`,
    });

    entries.push({
      transactionId,
      accountCode: LedgerAccountCode.ACCOUNTS_RECEIVABLE,
      accountType: resolveAccountType(LedgerAccountCode.ACCOUNTS_RECEIVABLE),
      entryType: LedgerEntryType.CREDIT,
      amountMinor: gatewayFeeMinor,
      currency,
      referenceType: "Order",
      referenceId: orderId,
      description: `Gateway fee withholding for order #${orderId}`,
    });
  }

  if (!isZeroSumLedger(entries)) {
    throw new Error(
      `Ledger integrity error: Unbalanced transaction generated for order ${orderId}`,
    );
  }

  return entries;
}

/**
 * Builds double-entry balanced ledger entries for an order refund (ORDER_REFUNDED).
 * Invariant: Sum(Debit) === Sum(Credit).
 */
export function buildOrderRefundLedgerEntries(params: {
  transactionId: string;
  orderId: string;
  subtotalMinor: number;
  taxAmountMinor: number;
  totalAmountMinor: number;
  currency: Currency;
}): LedgerEntryInput[] {
  const {
    transactionId,
    orderId,
    subtotalMinor,
    taxAmountMinor,
    totalAmountMinor,
    currency,
  } = params;

  const entries: LedgerEntryInput[] = [];

  // 1. Debit Refund Expense for product subtotal
  entries.push({
    transactionId,
    accountCode: LedgerAccountCode.REFUND_EXPENSE,
    accountType: resolveAccountType(LedgerAccountCode.REFUND_EXPENSE),
    entryType: LedgerEntryType.DEBIT,
    amountMinor: subtotalMinor,
    currency,
    referenceType: "Order",
    referenceId: orderId,
    description: `Refund recognized for order #${orderId}`,
  });

  // 2. Debit Tax Liability reversing previously collected tax
  if (taxAmountMinor > 0) {
    entries.push({
      transactionId,
      accountCode: LedgerAccountCode.TAX_LIABILITY,
      accountType: resolveAccountType(LedgerAccountCode.TAX_LIABILITY),
      entryType: LedgerEntryType.DEBIT,
      amountMinor: taxAmountMinor,
      currency,
      referenceType: "Order",
      referenceId: orderId,
      description: `Reversal of tax liability for refunded order #${orderId}`,
    });
  }

  // 3. Credit Accounts Receivable / Cash clearing for total refunded payout
  entries.push({
    transactionId,
    accountCode: LedgerAccountCode.ACCOUNTS_RECEIVABLE,
    accountType: resolveAccountType(LedgerAccountCode.ACCOUNTS_RECEIVABLE),
    entryType: LedgerEntryType.CREDIT,
    amountMinor: totalAmountMinor,
    currency,
    referenceType: "Order",
    referenceId: orderId,
    description: `Disbursement of refund for order #${orderId}`,
  });

  if (!isZeroSumLedger(entries)) {
    throw new Error(
      `Ledger integrity error: Unbalanced refund transaction generated for order ${orderId}`,
    );
  }

  return entries;
}

/**
 * Aggregates net balances across accounts respecting normal debit/credit balances.
 */
export function calculateLedgerBalances(
  entries: {
    accountCode: LedgerAccountCode;
    accountType: LedgerAccountType;
    entryType: LedgerEntryType;
    amountMinor: number;
  }[],
): Record<LedgerAccountCode, number> {
  const balances: Record<LedgerAccountCode, number> = {
    ACCOUNTS_RECEIVABLE: 0,
    SALES_REVENUE: 0,
    TAX_LIABILITY: 0,
    REFUND_EXPENSE: 0,
    AFFILIATE_COMMISSION_PAYABLE: 0,
    GATEWAY_FEE_EXPENSE: 0,
  };

  for (const entry of entries) {
    const isDebit = entry.entryType === LedgerEntryType.DEBIT;
    const isAssetOrExpense =
      entry.accountType === LedgerAccountType.ASSET ||
      entry.accountType === LedgerAccountType.EXPENSE;

    // Normal debit balance (Asset, Expense): + Debit, - Credit
    // Normal credit balance (Liability, Equity, Revenue): + Credit, - Debit
    if (isAssetOrExpense) {
      balances[entry.accountCode] += isDebit ? entry.amountMinor : -entry.amountMinor;
    } else {
      balances[entry.accountCode] += isDebit ? -entry.amountMinor : entry.amountMinor;
    }
  }

  return balances;
}
