import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  Currency,
  InvoiceStatus,
  LedgerAccountCode,
  LedgerEntryType,
  buildOrderPaymentLedgerEntries,
  buildOrderRefundLedgerEntries,
  calculateLedgerBalances,
} from "@nexus/database";
import {
  resolveTaxRate,
  calculateTaxMinor,
  generateInvoiceNumber,
  isZeroSumLedger,
} from "@nexus/utils";
import {
  InvoiceDto,
  InvoiceItemDto,
  LedgerEntryDto,
  TaxCalculationResponse,
  FinancialSummaryReportDto,
} from "@nexus/contracts";
import {
  CalculateTaxDto,
  QueryInvoicesDto,
  QueryLedgerDto,
  CreateManualInvoiceDto,
} from "./dto/finance.dto";
import * as crypto from "crypto";

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  // ----------------------------------------------------
  // Tax / VAT Calculation Engine
  // ----------------------------------------------------

  calculateTax(dto: CalculateTaxDto): TaxCalculationResponse {
    const taxResolution = resolveTaxRate(
      dto.countryCode,
      dto.stateCode,
      dto.isB2B,
      dto.vatId,
    );

    const taxAmountMinor = calculateTaxMinor(
      dto.subtotalMinor,
      taxResolution.rateBasisPoints,
    );

    const totalMinor = dto.subtotalMinor + taxAmountMinor;

    return {
      subtotalMinor: dto.subtotalMinor,
      taxRateBasisPoints: taxResolution.rateBasisPoints,
      taxAmountMinor,
      totalMinor,
      jurisdiction: taxResolution.jurisdiction,
      isReverseCharge: taxResolution.isReverseCharge,
      taxName: taxResolution.taxName,
    };
  }

  // ----------------------------------------------------
  // Invoice Management & Settlement
  // ----------------------------------------------------

  async generateInvoiceForOrder(
    orderId: string,
    billing?: {
      customerName?: string;
      customerEmail?: string;
      customerAddress?: string;
      countryCode?: string;
      stateCode?: string;
      vatId?: string;
      isB2B?: boolean;
    },
  ): Promise<InvoiceDto> {
    // 1. Idempotency check: if invoice already exists, return it
    const existing = await prisma.invoice.findUnique({
      where: { orderId },
      include: { items: true },
    });
    if (existing) {
      return this.mapInvoiceToDto(existing);
    }

    // 2. Fetch order with items and user
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { include: { profile: true } },
        items: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    const customerName =
      billing?.customerName ||
      order.user.profile?.displayName ||
      order.user.profile?.firstName ||
      order.user.email ||
      "Customer";
    const customerEmail = billing?.customerEmail || order.user.email || "";
    const customerAddress = billing?.customerAddress || null;

    const countryCode = billing?.countryCode || "US";
    const taxRes = resolveTaxRate(
      countryCode,
      billing?.stateCode,
      billing?.isB2B,
      billing?.vatId,
    );

    const invoiceNumber = generateInvoiceNumber("INV");
    const subtotalMinor = order.subtotalAmount;
    const taxAmountMinor = calculateTaxMinor(subtotalMinor, taxRes.rateBasisPoints);
    const totalAmountMinor = subtotalMinor + taxAmountMinor;

    const created = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          invoiceNumber,
          orderId: order.id,
          userId: order.userId,
          customerName,
          customerEmail,
          customerAddress,
          status: InvoiceStatus.PAID,
          currency: order.currency,
          subtotalMinor,
          taxAmountMinor,
          totalAmountMinor,
          taxRateBasisPoints: taxRes.rateBasisPoints,
          isReverseCharge: taxRes.isReverseCharge,
          vatId: billing?.vatId || null,
          issuedAt: new Date(),
          paidAt: new Date(),
          items: {
            create: order.items.map((item) => {
              const itemTax = calculateTaxMinor(
                item.lineTotalAmount,
                taxRes.rateBasisPoints,
              );
              return {
                description: item.productName || `Product item #${item.productId}`,
                quantity: item.quantity,
                unitPriceMinor: item.unitAmount,
                amountMinor: item.lineTotalAmount,
                taxRateBasisPoints: taxRes.rateBasisPoints,
                taxAmountMinor: itemTax,
              };
            }),
          },
        },
        include: { items: true },
      });

      return inv;
    });

    this.logger.log(`Generated commercial invoice ${created.invoiceNumber} for order ${orderId}`);
    return this.mapInvoiceToDto(created);
  }

  async listMyInvoices(
    userId: string,
    query?: QueryInvoicesDto,
  ): Promise<{ items: InvoiceDto[]; total: number }> {
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (query?.status) where.status = query.status;
    if (query?.orderId) where.orderId = query.orderId;

    const [total, records] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issuedAt: "desc" },
        include: { items: true },
      }),
    ]);

    return {
      items: records.map((inv) => this.mapInvoiceToDto(inv)),
      total,
    };
  }

  async getMyInvoice(userId: string, idOrNumber: string): Promise<InvoiceDto> {
    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { invoiceNumber: idOrNumber }, { orderId: idOrNumber }],
      },
      include: { items: true },
    });

    // Anti-enumeration: Return 404 if not found or unauthorized
    if (!invoice || invoice.userId !== userId) {
      throw new NotFoundException("Invoice not found");
    }

    return this.mapInvoiceToDto(invoice);
  }

  async adminListInvoices(
    query?: QueryInvoicesDto,
  ): Promise<{ items: InvoiceDto[]; total: number }> {
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status) where.status = query.status;
    if (query?.orderId) where.orderId = query.orderId;
    if (query?.userId) where.userId = query.userId;

    const [total, records] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issuedAt: "desc" },
        include: { items: true },
      }),
    ]);

    return {
      items: records.map((inv) => this.mapInvoiceToDto(inv)),
      total,
    };
  }

  async adminGetInvoice(idOrNumber: string): Promise<InvoiceDto> {
    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { invoiceNumber: idOrNumber }, { orderId: idOrNumber }],
      },
      include: { items: true },
    });

    if (!invoice) {
      throw new NotFoundException("Invoice not found");
    }

    return this.mapInvoiceToDto(invoice);
  }

  async createManualInvoice(dto: CreateManualInvoiceDto): Promise<InvoiceDto> {
    const taxRes = resolveTaxRate(
      dto.countryCode,
      dto.stateCode,
      dto.isB2B,
      dto.vatId,
    );

    const subtotalMinor = dto.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceMinor,
      0,
    );
    const taxAmountMinor = calculateTaxMinor(
      subtotalMinor,
      taxRes.rateBasisPoints,
    );
    const totalAmountMinor = subtotalMinor + taxAmountMinor;
    const invoiceNumber = generateInvoiceNumber();

    let userId = dto.userId;
    if (!userId) {
      const order = await prisma.order.findUnique({
        where: { id: dto.orderId },
        select: { userId: true },
      });
      if (!order) {
        throw new NotFoundException(`Order #${dto.orderId} not found`);
      }
      userId = order.userId;
    }

    const created = await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId: dto.orderId,
        userId,
        customerName: dto.customerName,
        customerEmail: dto.customerEmail,
        customerAddress: dto.customerAddress,
        status: InvoiceStatus.PAID,
        currency: Currency.USD,
        subtotalMinor,
        taxAmountMinor,
        totalAmountMinor,
        taxRateBasisPoints: taxRes.rateBasisPoints,
        isReverseCharge: taxRes.isReverseCharge,
        vatId: dto.vatId || null,
        issuedAt: new Date(),
        paidAt: new Date(),
        items: {
          create: dto.items.map((item) => {
            const lineAmount = item.quantity * item.unitPriceMinor;
            const itemTax = calculateTaxMinor(lineAmount, taxRes.rateBasisPoints);
            return {
              description: item.description,
              quantity: item.quantity,
              unitPriceMinor: item.unitPriceMinor,
              amountMinor: lineAmount,
              taxRateBasisPoints: taxRes.rateBasisPoints,
              taxAmountMinor: itemTax,
            };
          }),
        },
      },
      include: { items: true },
    });

    this.logger.log(`Created manual invoice ${created.invoiceNumber} for order ${dto.orderId}`);
    return this.mapInvoiceToDto(created);
  }

  // ----------------------------------------------------
  // Double-Entry Financial Ledger
  // ----------------------------------------------------

  async recordOrderPaymentLedger(
    orderId: string,
    gatewayFeeMinor = 0,
  ): Promise<LedgerEntryDto[]> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { invoice: true },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    const subtotalMinor = order.subtotalAmount;
    const taxAmountMinor = order.invoice?.taxAmountMinor || 0;
    const totalAmountMinor = order.totalAmount + taxAmountMinor;
    const transactionId = crypto.randomUUID();

    const entries = buildOrderPaymentLedgerEntries({
      transactionId,
      orderId: order.id,
      subtotalMinor,
      taxAmountMinor,
      totalAmountMinor,
      currency: order.currency,
      gatewayFeeMinor,
    });

    const created = await prisma.$transaction(async (tx) => {
      const records = [];
      for (const entry of entries) {
        const row = await tx.financialLedgerEntry.create({
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
        records.push(row);
      }
      return records;
    });

    this.logger.log(
      `Recorded ${created.length} balanced double-entry ledger rows for order ${orderId} (tx: ${transactionId})`,
    );
    return created.map((r) => this.mapLedgerEntryToDto(r));
  }

  async recordOrderRefundLedger(orderId: string): Promise<LedgerEntryDto[]> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { invoice: true },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    const subtotalMinor = order.subtotalAmount;
    const taxAmountMinor = order.invoice?.taxAmountMinor || 0;
    const totalAmountMinor = order.totalAmount + taxAmountMinor;
    const transactionId = crypto.randomUUID();

    const entries = buildOrderRefundLedgerEntries({
      transactionId,
      orderId: order.id,
      subtotalMinor,
      taxAmountMinor,
      totalAmountMinor,
      currency: order.currency,
    });

    const created = await prisma.$transaction(async (tx) => {
      const records = [];
      for (const entry of entries) {
        const row = await tx.financialLedgerEntry.create({
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
        records.push(row);
      }
      return records;
    });

    this.logger.log(
      `Recorded ${created.length} balanced refund ledger rows for order ${orderId} (tx: ${transactionId})`,
    );
    return created.map((r) => this.mapLedgerEntryToDto(r));
  }

  async adminListLedger(
    query?: QueryLedgerDto,
  ): Promise<{ items: LedgerEntryDto[]; total: number }> {
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? query.limit : 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.accountCode) where.accountCode = query.accountCode;
    if (query?.referenceType) where.referenceType = query.referenceType;
    if (query?.referenceId) where.referenceId = query.referenceId;

    const [total, records] = await Promise.all([
      prisma.financialLedgerEntry.count({ where }),
      prisma.financialLedgerEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      items: records.map((r) => this.mapLedgerEntryToDto(r)),
      total,
    };
  }

  async adminGetFinancialSummary(
    periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    periodEnd = new Date(),
  ): Promise<FinancialSummaryReportDto> {
    const entries = await prisma.financialLedgerEntry.findMany({
      where: {
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
    });

    const balances = calculateLedgerBalances(entries);

    const grossRevenueMinor = balances.SALES_REVENUE;
    const totalTaxMinor = balances.TAX_LIABILITY;
    const totalRefundsMinor = balances.REFUND_EXPENSE;
    const totalAffiliateCommissionsMinor = balances.AFFILIATE_COMMISSION_PAYABLE;
    const netRevenueMinor = grossRevenueMinor - totalRefundsMinor;

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      currency: Currency.USD,
      grossRevenueMinor,
      netRevenueMinor,
      totalTaxMinor,
      totalRefundsMinor,
      totalAffiliateCommissionsMinor,
      ledgerTransactionCount: entries.length,
    };
  }

  // ----------------------------------------------------
  // Helpers
  // ----------------------------------------------------

  private mapInvoiceToDto(inv: any): InvoiceDto {
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      orderId: inv.orderId,
      userId: inv.userId,
      customerName: inv.customerName,
      customerEmail: inv.customerEmail,
      customerAddress: inv.customerAddress || null,
      status: inv.status,
      currency: inv.currency,
      subtotalMinor: inv.subtotalMinor,
      taxAmountMinor: inv.taxAmountMinor,
      totalAmountMinor: inv.totalAmountMinor,
      taxRateBasisPoints: inv.taxRateBasisPoints,
      isReverseCharge: inv.isReverseCharge,
      vatId: inv.vatId || null,
      pdfStorageKey: inv.pdfStorageKey || null,
      issuedAt: inv.issuedAt.toISOString(),
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      metadata: inv.metadata || null,
      items: (inv.items || []).map((it: any): InvoiceItemDto => ({
        id: it.id,
        invoiceId: it.invoiceId,
        description: it.description,
        quantity: it.quantity,
        unitPriceMinor: it.unitPriceMinor,
        amountMinor: it.amountMinor,
        taxRateBasisPoints: it.taxRateBasisPoints,
        taxAmountMinor: it.taxAmountMinor,
      })),
    };
  }

  private mapLedgerEntryToDto(r: any): LedgerEntryDto {
    return {
      id: r.id,
      transactionId: r.transactionId,
      accountCode: r.accountCode,
      accountType: r.accountType,
      entryType: r.entryType,
      amountMinor: r.amountMinor,
      currency: r.currency,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
