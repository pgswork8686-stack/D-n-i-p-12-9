import {
  processFinancialLedgerForOrder,
  processFinancialLedgerForOrderRefund,
} from "./ledger-processor";
import {
  prisma,
  Currency,
  InvoiceStatus,
  LedgerAccountCode,
  LedgerEntryType,
} from "@nexus/database";
import { isZeroSumLedger } from "@nexus/utils";

describe("Ledger Worker Processor", () => {
  beforeEach(() => {
    jest.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      if (typeof callback === "function") {
        return callback(prisma);
      }
      return callback;
    });
    jest.clearAllMocks();
  });

  describe("processFinancialLedgerForOrder", () => {
    const mockOrder = {
      id: "ord-proc-1",
      userId: "usr-proc-1",
      currency: Currency.USD,
      subtotalAmount: 15000,
      totalAmount: 15000,
      user: {
        id: "usr-proc-1",
        email: "payer@example.com",
        profile: { displayName: "Payer Name" },
      },
      items: [
        {
          id: "item-1",
          orderId: "ord-proc-1",
          productId: "prod-1",
          productName: "Cloud Hosting Deluxe",
          quantity: 1,
          unitAmount: 15000,
          lineTotalAmount: 15000,
        },
      ],
      invoice: null,
    };

    const mockInvoice = {
      id: "inv-proc-1",
      invoiceNumber: "INV-202609-0042",
      orderId: "ord-proc-1",
      userId: "usr-proc-1",
      customerName: "Payer Name",
      customerEmail: "payer@example.com",
      status: InvoiceStatus.PAID,
      currency: Currency.USD,
      subtotalMinor: 15000,
      taxAmountMinor: 0,
      totalAmountMinor: 15000,
      taxRateBasisPoints: 0,
      items: [],
    };

    it("generates invoice and records balanced ledger rows for new order", async () => {
      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(mockOrder as any);
      jest.spyOn(prisma.invoice, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.invoice, "create").mockResolvedValue(mockInvoice as any);
      jest.spyOn(prisma.financialLedgerEntry, "findFirst").mockResolvedValue(null);

      const createdEntries: any[] = [];
      jest.spyOn(prisma.financialLedgerEntry, "create").mockImplementation((args: any) => {
        const item = { id: `gle-${createdEntries.length + 1}`, ...args.data };
        createdEntries.push(item);
        return Promise.resolve(item) as any;
      });

      const result = await processFinancialLedgerForOrder("ord-proc-1", "worker-test");

      expect(result).not.toBeNull();
      expect(result?.invoice.invoiceNumber).toBe("INV-202609-0042");
      expect(createdEntries.length).toBeGreaterThanOrEqual(2);
      expect(isZeroSumLedger(createdEntries)).toBe(true);

      const arDebit = createdEntries.find(
        (e) => e.accountCode === LedgerAccountCode.ACCOUNTS_RECEIVABLE && e.entryType === LedgerEntryType.DEBIT,
      );
      const revCredit = createdEntries.find(
        (e) => e.accountCode === LedgerAccountCode.SALES_REVENUE && e.entryType === LedgerEntryType.CREDIT,
      );

      expect(arDebit.amountMinor).toBe(15000);
      expect(revCredit.amountMinor).toBe(15000);
    });

    it("is idempotent: does not recreate ledger entries if already posted", async () => {
      const orderWithInvoice = {
        ...mockOrder,
        invoice: mockInvoice,
      };

      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(orderWithInvoice as any);
      jest.spyOn(prisma.financialLedgerEntry, "findFirst").mockResolvedValue({
        id: "existing-gle-1",
        transactionId: "tx-existing-123",
        accountCode: LedgerAccountCode.SALES_REVENUE,
      } as any);

      const createSpy = jest.spyOn(prisma.financialLedgerEntry, "create");

      const result = await processFinancialLedgerForOrder("ord-proc-1", "worker-test");

      expect(result).not.toBeNull();
      expect(result?.ledgerTransactionId).toBe("tx-existing-123");
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe("processFinancialLedgerForOrderRefund", () => {
    it("records balanced zero-sum refund ledger rows", async () => {
      const order = {
        id: "ord-ref-1",
        currency: Currency.USD,
        subtotalAmount: 15000,
        totalAmount: 15000,
        invoice: { taxAmountMinor: 0 },
      };

      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(order as any);
      jest.spyOn(prisma.financialLedgerEntry, "findFirst").mockResolvedValue(null);

      const createdEntries: any[] = [];
      jest.spyOn(prisma.financialLedgerEntry, "create").mockImplementation((args: any) => {
        const item = { id: `gle-ref-${createdEntries.length + 1}`, ...args.data };
        createdEntries.push(item);
        return Promise.resolve(item) as any;
      });

      const result = await processFinancialLedgerForOrderRefund("ord-ref-1", "worker-test");

      expect(result).not.toBeNull();
      expect(result?.refunded).toBe(true);
      expect(createdEntries.length).toBeGreaterThanOrEqual(2);
      expect(isZeroSumLedger(createdEntries)).toBe(true);

      const refDebit = createdEntries.find(
        (e) => e.accountCode === LedgerAccountCode.REFUND_EXPENSE && e.entryType === LedgerEntryType.DEBIT,
      );
      expect(refDebit.amountMinor).toBe(15000);
    });

    it("is idempotent: skips duplicate refund ledger posting", async () => {
      const order = {
        id: "ord-ref-1",
        currency: Currency.USD,
        subtotalAmount: 15000,
        totalAmount: 15000,
        invoice: null,
      };

      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(order as any);
      jest.spyOn(prisma.financialLedgerEntry, "findFirst").mockResolvedValue({
        id: "gle-ref-already",
        transactionId: "tx-ref-already-456",
        accountCode: LedgerAccountCode.REFUND_EXPENSE,
      } as any);

      const createSpy = jest.spyOn(prisma.financialLedgerEntry, "create");

      const result = await processFinancialLedgerForOrderRefund("ord-ref-1", "worker-test");

      expect(result?.refunded).toBe(true);
      expect(result?.transactionId).toBe("tx-ref-already-456");
      expect(createSpy).not.toHaveBeenCalled();
    });
  });
});
