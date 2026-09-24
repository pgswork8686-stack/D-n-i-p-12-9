import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { FinanceService } from "./finance.service";
import {
  prisma,
  Currency,
  InvoiceStatus,
  LedgerAccountCode,
  LedgerAccountType,
  LedgerEntryType,
} from "@nexus/database";
import { isZeroSumLedger } from "@nexus/utils";

describe("FinanceService", () => {
  let service: FinanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FinanceService],
    }).compile();

    service = module.get<FinanceService>(FinanceService);

    jest.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      if (typeof callback === "function") {
        return callback(prisma);
      }
      return callback;
    });

    jest.clearAllMocks();
  });

  describe("Tax Calculation", () => {
    it("calculates standard tax for US California", async () => {
      const result = await service.calculateTax({
        subtotalMinor: 10000, // $100.00
        currency: Currency.USD,
        countryCode: "US",
        stateCode: "CA",
      });

      expect(result.taxRateBasisPoints).toBe(725);
      expect(result.taxAmountMinor).toBe(725);
      expect(result.totalMinor).toBe(10725);
      expect(result.isReverseCharge).toBe(false);
    });

    it("applies EU reverse charge (0% tax) for verified B2B customer in Germany", async () => {
      const result = await service.calculateTax({
        subtotalMinor: 10000,
        currency: Currency.USD,
        countryCode: "DE",
        isB2B: true,
        vatId: "DE123456789",
      });

      expect(result.taxRateBasisPoints).toBe(0);
      expect(result.taxAmountMinor).toBe(0);
      expect(result.totalMinor).toBe(10000);
      expect(result.isReverseCharge).toBe(true);
    });

    it("applies standard EU VAT for consumer in Germany", async () => {
      const result = await service.calculateTax({
        subtotalMinor: 10000,
        currency: Currency.USD,
        countryCode: "DE",
        isB2B: false,
      });

      expect(result.taxRateBasisPoints).toBe(1900); // 19%
      expect(result.taxAmountMinor).toBe(1900);
      expect(result.totalMinor).toBe(11900);
      expect(result.isReverseCharge).toBe(false);
    });

    it("applies 10% VAT for Vietnam", async () => {
      const result = await service.calculateTax({
        subtotalMinor: 25000000, // 250,000 VND
        currency: Currency.VND,
        countryCode: "VN",
      });

      expect(result.taxRateBasisPoints).toBe(1000);
      expect(result.taxAmountMinor).toBe(2500000);
      expect(result.totalMinor).toBe(27500000);
    });
  });

  describe("Invoice Generation & Anti-Enumeration", () => {
    const mockOrder = {
      id: "ord-test-1",
      userId: "usr-cust-1",
      currency: Currency.USD,
      subtotalAmount: 10000,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 10000,
      user: {
        id: "usr-cust-1",
        name: "Test Customer",
        email: "cust@example.com",
      },
      items: [
        {
          id: "item-1",
          orderId: "ord-test-1",
          productId: "prod-1",
          variantId: "var-1",
          productName: "Pro Plan Subscription",
          variantName: "Standard",
          sku: "PRO-STD",
          quantity: 1,
          unitAmount: 10000,
          lineTotalAmount: 10000,
        },
      ],
      invoice: null,
    };

    const mockInvoice = {
      id: "inv-test-1",
      invoiceNumber: "INV-202609-0001",
      orderId: "ord-test-1",
      userId: "usr-cust-1",
      customerName: "Test Customer",
      customerEmail: "cust@example.com",
      customerAddress: null,
      status: InvoiceStatus.PAID,
      currency: Currency.USD,
      subtotalMinor: 10000,
      taxAmountMinor: 725,
      totalAmountMinor: 10725,
      taxRateBasisPoints: 725,
      isReverseCharge: false,
      vatId: null,
      pdfStorageKey: null,
      issuedAt: new Date("2026-09-24T10:00:00Z"),
      paidAt: new Date("2026-09-24T10:00:00Z"),
      metadata: null,
      items: [
        {
          id: "inv-item-1",
          invoiceId: "inv-test-1",
          description: "Pro Plan Subscription",
          quantity: 1,
          unitPriceMinor: 10000,
          amountMinor: 10000,
          taxRateBasisPoints: 725,
          taxAmountMinor: 725,
        },
      ],
    };

    it("generates an invoice for an order", async () => {
      jest.spyOn(prisma.invoice, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(mockOrder as any);
      jest.spyOn(prisma.invoice, "create").mockResolvedValue(mockInvoice as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const invoice = await service.generateInvoiceForOrder("ord-test-1", {
        countryCode: "US",
        stateCode: "CA",
      });

      expect(invoice.invoiceNumber).toBe("INV-202609-0001");
      expect(invoice.totalAmountMinor).toBe(10725);
      expect(prisma.invoice.create).toHaveBeenCalled();
    });

    it("allows a customer to view their own invoice", async () => {
      jest.spyOn(prisma.invoice, "findFirst").mockResolvedValue(mockInvoice as any);

      const invoice = await service.getMyInvoice("usr-cust-1", "inv-test-1");
      expect(invoice.id).toBe("inv-test-1");
      expect(invoice.customerEmail).toBe("cust@example.com");
    });

    it("throws NotFoundException (anti-enumeration) when accessing another user's invoice", async () => {
      jest.spyOn(prisma.invoice, "findFirst").mockResolvedValue(mockInvoice as any);

      // Malicious or other user tries to access inv-test-1
      await expect(
        service.getMyInvoice("usr-other-attacker", "inv-test-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when invoice does not exist", async () => {
      jest.spyOn(prisma.invoice, "findFirst").mockResolvedValue(null);

      await expect(
        service.getMyInvoice("usr-cust-1", "non-existent-inv"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("Double-Entry Ledger Balancing", () => {
    it("creates balanced zero-sum ledger entries on order payment", async () => {
      const order = {
        id: "ord-ledger-1",
        currency: Currency.USD,
        subtotalAmount: 10000,
        totalAmount: 10000,
        invoice: {
          taxAmountMinor: 1000,
        },
      };

      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(order as any);
      const createdEntries: any[] = [];
      jest.spyOn(prisma.financialLedgerEntry, "create").mockImplementation((args: any) => {
        const item = {
          id: `gle-${createdEntries.length + 1}`,
          ...args.data,
          createdAt: new Date(),
        };
        createdEntries.push(item);
        return Promise.resolve(item) as any;
      });

      const entries = await service.recordOrderPaymentLedger("ord-ledger-1", 300);

      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(isZeroSumLedger(entries)).toBe(true);

      const arDebit = entries.find(
        (e) => e.accountCode === LedgerAccountCode.ACCOUNTS_RECEIVABLE && e.entryType === LedgerEntryType.DEBIT,
      );
      const revenueCredit = entries.find(
        (e) => e.accountCode === LedgerAccountCode.SALES_REVENUE && e.entryType === LedgerEntryType.CREDIT,
      );
      const taxCredit = entries.find(
        (e) => e.accountCode === LedgerAccountCode.TAX_LIABILITY && e.entryType === LedgerEntryType.CREDIT,
      );

      expect(arDebit?.amountMinor).toBe(11000); // 10000 + 1000
      expect(revenueCredit?.amountMinor).toBe(10000);
      expect(taxCredit?.amountMinor).toBe(1000);
    });

    it("creates balanced zero-sum ledger entries on order refund", async () => {
      const order = {
        id: "ord-ledger-refund",
        currency: Currency.USD,
        subtotalAmount: 10000,
        totalAmount: 10000,
        invoice: {
          taxAmountMinor: 1000,
        },
      };

      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(order as any);
      const createdEntries: any[] = [];
      jest.spyOn(prisma.financialLedgerEntry, "create").mockImplementation((args: any) => {
        const item = {
          id: `gle-ref-${createdEntries.length + 1}`,
          ...args.data,
          createdAt: new Date(),
        };
        createdEntries.push(item);
        return Promise.resolve(item) as any;
      });

      const entries = await service.recordOrderRefundLedger("ord-ledger-refund");

      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(isZeroSumLedger(entries)).toBe(true);

      const refundDebit = entries.find(
        (e) => e.accountCode === LedgerAccountCode.REFUND_EXPENSE && e.entryType === LedgerEntryType.DEBIT,
      );
      const arCredit = entries.find(
        (e) => e.accountCode === LedgerAccountCode.ACCOUNTS_RECEIVABLE && e.entryType === LedgerEntryType.CREDIT,
      );

      expect(refundDebit?.amountMinor).toBe(10000);
      expect(arCredit?.amountMinor).toBe(11000);
    });
  });

  describe("adminGetFinancialSummary", () => {
    it("aggregates ledger balances and computes gross and net revenue", async () => {
      const mockEntries = [
        {
          id: "1",
          transactionId: "t1",
          accountCode: LedgerAccountCode.ACCOUNTS_RECEIVABLE,
          accountType: LedgerAccountType.ASSET,
          entryType: LedgerEntryType.DEBIT,
          amountMinor: 11000,
          currency: Currency.USD,
          referenceType: "Order",
          referenceId: "ord-1",
          description: "Order payment",
          createdAt: new Date(),
        },
        {
          id: "2",
          transactionId: "t1",
          accountCode: LedgerAccountCode.SALES_REVENUE,
          accountType: LedgerAccountType.REVENUE,
          entryType: LedgerEntryType.CREDIT,
          amountMinor: 10000,
          currency: Currency.USD,
          referenceType: "Order",
          referenceId: "ord-1",
          description: "Order revenue",
          createdAt: new Date(),
        },
        {
          id: "3",
          transactionId: "t1",
          accountCode: LedgerAccountCode.TAX_LIABILITY,
          accountType: LedgerAccountType.LIABILITY,
          entryType: LedgerEntryType.CREDIT,
          amountMinor: 1000,
          currency: Currency.USD,
          referenceType: "Order",
          referenceId: "ord-1",
          description: "Order tax",
          createdAt: new Date(),
        },
        {
          id: "4",
          transactionId: "t2",
          accountCode: LedgerAccountCode.REFUND_EXPENSE,
          accountType: LedgerAccountType.EXPENSE,
          entryType: LedgerEntryType.DEBIT,
          amountMinor: 2000,
          currency: Currency.USD,
          referenceType: "Order",
          referenceId: "ord-2",
          description: "Order refund",
          createdAt: new Date(),
        },
      ];

      jest.spyOn(prisma.financialLedgerEntry, "findMany").mockResolvedValue(mockEntries as any);

      const summary = await service.adminGetFinancialSummary();

      expect(summary.grossRevenueMinor).toBe(10000);
      expect(summary.totalTaxMinor).toBe(1000);
      expect(summary.totalRefundsMinor).toBe(2000);
      expect(summary.netRevenueMinor).toBe(8000); // 10000 - 2000
      expect(summary.ledgerTransactionCount).toBe(4);
    });
  });
});
