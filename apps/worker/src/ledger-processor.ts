import {
  prisma,
  InvoiceStatus,
  LedgerAccountCode,
  buildOrderPaymentLedgerEntries,
  buildOrderRefundLedgerEntries,
} from "@nexus/database";
import { generateInvoiceNumber, calculateTaxMinor } from "@nexus/utils";

export interface ProcessFinancialLedgerResult {
  invoice: any;
  ledgerTransactionId: string;
}

export interface ProcessFinancialRefundResult {
  refunded: boolean;
  transactionId: string;
}

/**
 * Idempotently generates invoice and records double-entry ledger rows for an ORDER_PAID event.
 */
export async function processFinancialLedgerForOrder(
  orderId: string,
  workerId = "worker-default",
): Promise<ProcessFinancialLedgerResult | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { include: { profile: true } },
      items: true,
      invoice: true,
    },
  });

  if (!order) {
    console.warn(
      JSON.stringify({
        level: "warn",
        service: "worker",
        event: "ledger_order_not_found",
        orderId,
        workerId,
        timestamp: new Date().toISOString(),
      }),
    );
    return null;
  }

  // 1. Idempotently generate invoice if one does not exist yet
  let invoice = order.invoice;
  if (!invoice) {
    const existingInvoice = await prisma.invoice.findUnique({
      where: { orderId },
      include: { items: true },
    });

    if (existingInvoice) {
      invoice = existingInvoice;
    } else {
      const invoiceNumber = generateInvoiceNumber();
      const customerName =
        order.user?.profile?.displayName ||
        (order.user?.profile?.firstName
          ? `${order.user.profile.firstName} ${order.user.profile.lastName || ""}`.trim()
          : order.user?.email?.split("@")[0]) ||
        "Customer";
      const customerEmail = order.user?.email || "customer@example.com";

      const subtotalMinor = order.subtotalAmount;
      const taxRateBasisPoints = 0; // Default 0 bps unless tax recalculation requested
      const taxAmountMinor = 0;
      const totalAmountMinor = order.totalAmount;

      invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          orderId: order.id,
          userId: order.userId,
          customerName,
          customerEmail,
          customerAddress: null,
          status: InvoiceStatus.PAID,
          currency: order.currency,
          subtotalMinor,
          taxAmountMinor,
          totalAmountMinor,
          taxRateBasisPoints,
          isReverseCharge: false,
          vatId: null,
          issuedAt: new Date(),
          paidAt: new Date(),
          items: {
            create: order.items.map((item) => ({
              description: item.productName || `Product item #${item.productId}`,
              quantity: item.quantity,
              unitPriceMinor: item.unitAmount,
              amountMinor: item.lineTotalAmount,
              taxRateBasisPoints: 0,
              taxAmountMinor: 0,
            })),
          },
        },
        include: { items: true },
      });

      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          event: "invoice_auto_generated",
          invoiceNumber: invoice.invoiceNumber,
          orderId: order.id,
          workerId,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  // 2. Idempotently record double-entry balanced ledger entries
  const existingLedger = await prisma.financialLedgerEntry.findFirst({
    where: {
      referenceType: "Order",
      referenceId: orderId,
      accountCode: LedgerAccountCode.SALES_REVENUE,
    },
  });

  if (existingLedger) {
    console.log(
      JSON.stringify({
        level: "info",
        service: "worker",
        event: "ledger_already_recorded",
        orderId,
        transactionId: existingLedger.transactionId,
        workerId,
        timestamp: new Date().toISOString(),
      }),
    );
    return { invoice, ledgerTransactionId: existingLedger.transactionId };
  }

  const transactionId = crypto.randomUUID();
  const subtotalMinor = order.subtotalAmount;
  const taxAmountMinor = invoice?.taxAmountMinor || 0;
  const totalAmountMinor = order.totalAmount + taxAmountMinor;

  const entries = buildOrderPaymentLedgerEntries({
    transactionId,
    orderId: order.id,
    subtotalMinor,
    taxAmountMinor,
    totalAmountMinor,
    currency: order.currency,
  });

  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      await tx.financialLedgerEntry.create({
        data: {
          transactionId: entry.transactionId,
          accountCode: entry.accountCode,
          accountType: entry.accountType,
          entryType: entry.entryType,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          description: entry.description,
        },
      });
    }
  });

  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      event: "ledger_entries_recorded",
      orderId: order.id,
      transactionId,
      entriesCount: entries.length,
      workerId,
      timestamp: new Date().toISOString(),
    }),
  );

  return { invoice, ledgerTransactionId: transactionId };
}

/**
 * Idempotently records double-entry refund ledger rows for an ORDER_REFUNDED event.
 */
export async function processFinancialLedgerForOrderRefund(
  orderId: string,
  workerId = "worker-default",
): Promise<ProcessFinancialRefundResult | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { invoice: true },
  });

  if (!order) {
    return null;
  }

  // Idempotency: check if refund ledger already exists
  const existingRefund = await prisma.financialLedgerEntry.findFirst({
    where: {
      referenceType: "Order",
      referenceId: orderId,
      accountCode: LedgerAccountCode.REFUND_EXPENSE,
    },
  });

  if (existingRefund) {
    return { refunded: true, transactionId: existingRefund.transactionId };
  }

  const transactionId = crypto.randomUUID();
  const subtotalMinor = order.subtotalAmount;
  const taxAmountMinor = order.invoice?.taxAmountMinor || 0;
  const totalAmountMinor = order.totalAmount + taxAmountMinor;

  const entries = buildOrderRefundLedgerEntries({
    transactionId,
    orderId: order.id,
    subtotalMinor,
    taxAmountMinor,
    totalAmountMinor,
    currency: order.currency,
  });

  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      await tx.financialLedgerEntry.create({
        data: {
          transactionId: entry.transactionId,
          accountCode: entry.accountCode,
          accountType: entry.accountType,
          entryType: entry.entryType,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          description: entry.description,
        },
      });
    }
  });

  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      event: "ledger_refund_entries_recorded",
      orderId: order.id,
      transactionId,
      entriesCount: entries.length,
      workerId,
      timestamp: new Date().toISOString(),
    }),
  );

  return { refunded: true, transactionId };
}
