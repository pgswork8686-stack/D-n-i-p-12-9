import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { prisma, Prisma } from "@nexus/database";
import { AuditService } from "../audit/audit.service";
import { SepayPaymentProvider } from "./sepay-payment.provider";
import { NormalizedPaymentEvent } from "./payment-provider.interface";

export type ReconciliationStatus = "OPEN" | "RESOLVED" | "DISMISSED";
export type ReconciliationResolution = "RESOLVED" | "DISMISSED";

export interface ReconciliationQuery {
  status?: string;
  reason?: string;
  page?: number;
  limit?: number;
}

export interface ReconciliationCaseView {
  id: string;
  provider: string;
  externalEventId: string;
  reason: string;
  status: string;
  paymentId: string | null;
  orderId: string | null;
  transferCode: string | null;
  expectedAmount: number | null;
  receivedAmount: number;
  /** > 0: khách chuyển thừa, < 0: chuyển thiếu, null: không xác định được đơn. */
  difference: number | null;
  currency: string;
  lastRequery: unknown;
  lastRequeryAt: Date | null;
  resolutionNote: string | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface ReconciliationList {
  items: ReconciliationCaseView[];
  total: number;
  openCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReconciliationDetail extends ReconciliationCaseView {
  order: { id: string; orderNumber: string; status: string; totalAmount: number } | null;
}

const STATUSES = ["OPEN", "RESOLVED", "DISMISSED"];
const REASONS = ["AMOUNT_MISMATCH", "UNKNOWN_TRANSFER_CODE", "NO_TRANSFER_CODE"];

/**
 * Staff reconciliation of bank transfers the webhook could not safely attach to an order.
 *
 * Invariants:
 *  - A case NEVER changes an order or payment. Marking one resolved only records the human decision
 *    (refund, top-up arranged, matched elsewhere…); the money side is handled outside this system.
 *  - Re-querying the provider is read-only and informational.
 *  - Recording is idempotent per (provider, externalEventId) so webhook retries do not duplicate cases.
 *  - Every state change writes an audit log entry.
 */
@Injectable()
export class PaymentReconciliationService {
  constructor(
    private readonly audit: AuditService,
    private readonly sepay: SepayPaymentProvider,
  ) {}

  /**
   * Called by the webhook path for "ignored" events that need a human.
   *
   * FAIL-CLOSED: if the case (and its audit entry) cannot be stored this THROWS, so the webhook is NOT
   * acknowledged and the provider retries instead of the transfer silently disappearing. The case and its
   * audit log are written in one transaction. A retry of an already-recorded event is a no-op success.
   */
  async recordFromWebhook(provider: string, event: NormalizedPaymentEvent): Promise<void> {
    const review = event.review;
    if (!review) return;
    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.paymentReconciliationCase.create({
          data: {
            provider,
            externalEventId: event.externalEventId,
            reason: review.reason,
            paymentId: review.paymentId ?? null,
            orderId: review.orderId ?? null,
            transferCode: review.transferCode ?? null,
            expectedAmount: review.expectedAmount ?? null,
            receivedAmount: review.receivedAmount,
            rawPayloadHash: event.rawPayloadHash ?? null,
            sanitizedPayload: event.sanitizedPayload as Prisma.InputJsonValue,
          },
        });
        await this.audit.logActionWithClient(tx, {
          action: "PAYMENT_RECONCILIATION_CASE_OPENED",
          entity: "PaymentReconciliationCase",
          entityId: created.id,
          details: {
            provider,
            reason: review.reason,
            receivedAmount: review.receivedAmount,
            expectedAmount: review.expectedAmount ?? null,
            orderId: review.orderId ?? null,
          },
        });
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        // Unique (provider, externalEventId): a retry or a concurrent delivery already stored this case.
        const stored = await prisma.paymentReconciliationCase.findUnique({
          where: { provider_externalEventId: { provider, externalEventId: event.externalEventId } },
          select: { id: true },
        });
        if (stored) return;
      }
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ event: "reconciliation_case_record_failed", externalEventId: event.externalEventId, message: String(err?.message).slice(0, 200) }));
      throw new ServiceUnavailableException("Không lưu được giao dịch cần đối soát; vui lòng gửi lại webhook");
    }
  }
  async list(query: ReconciliationQuery): Promise<ReconciliationList> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where: Prisma.PaymentReconciliationCaseWhereInput = {};
    if (query.status) {
      if (!STATUSES.includes(query.status)) throw new BadRequestException("Trạng thái không hợp lệ");
      where.status = query.status;
    }
    if (query.reason) {
      if (!REASONS.includes(query.reason)) throw new BadRequestException("Lý do không hợp lệ");
      where.reason = query.reason;
    }
    const [items, total, openCount] = await Promise.all([
      prisma.paymentReconciliationCase.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.paymentReconciliationCase.count({ where }),
      prisma.paymentReconciliationCase.count({ where: { status: "OPEN" } }),
    ]);
    return {
      items: items.map((c) => this.view(c)),
      total,
      openCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async get(id: string): Promise<ReconciliationDetail> {
    const found = await prisma.paymentReconciliationCase.findUnique({ where: { id } });
    if (!found) throw new NotFoundException("Không tìm thấy giao dịch cần đối soát");
    const order = found.orderId
      ? await prisma.order.findUnique({ where: { id: found.orderId }, select: { id: true, orderNumber: true, status: true, totalAmount: true } })
      : null;
    return { ...this.view(found), order };
  }

  /** Read-only: asks SePay what it actually received for this transfer code. Never confirms a payment. */
  async requery(id: string, actorId: string): Promise<ReconciliationCaseView> {
    const found = await prisma.paymentReconciliationCase.findUnique({ where: { id } });
    if (!found) throw new NotFoundException("Không tìm thấy giao dịch cần đối soát");
    if (found.provider !== "sepay") throw new BadRequestException("Chỉ hỗ trợ truy vấn lại với SePay");
    if (!found.transferCode) {
      throw new BadRequestException("Giao dịch không có mã chuyển khoản để truy vấn lại");
    }
    const transfers = await this.sepay.lookupTransfersByCode(found.transferCode);
    if (transfers === null) {
      throw new ServiceUnavailableException("Không truy vấn được SePay (chưa cấu hình SEPAY_API_TOKEN hoặc SePay không phản hồi)");
    }
    const summary = {
      checkedAt: new Date().toISOString(),
      transfers,
      totalReceived: transfers.reduce((sum, t) => sum + t.amount, 0),
      matchesExpected: found.expectedAmount != null && transfers.length === 1 && transfers[0].amount === found.expectedAmount,
    };
    const updated = await prisma.paymentReconciliationCase.update({
      where: { id },
      data: { lastRequery: summary as unknown as Prisma.InputJsonValue, lastRequeryAt: new Date() },
    });
    await this.audit.logAction({
      action: "PAYMENT_RECONCILIATION_REQUERIED",
      entity: "PaymentReconciliationCase",
      entityId: id,
      actorId,
      details: { transferCount: transfers.length, totalReceived: summary.totalReceived },
    });
    return this.view(updated);
  }

  async resolve(id: string, actorId: string, resolution: ReconciliationResolution, note: string): Promise<ReconciliationCaseView> {
    if (resolution !== "RESOLVED" && resolution !== "DISMISSED") {
      throw new BadRequestException("Kết quả xử lý không hợp lệ");
    }
    const cleanNote = (note ?? "").trim();
    if (cleanNote.length < 5) throw new BadRequestException("Cần ghi chú xử lý (tối thiểu 5 ký tự)");
    if (cleanNote.length > 1000) throw new BadRequestException("Ghi chú quá dài (tối đa 1000 ký tự)");

    const exists = await prisma.paymentReconciliationCase.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Không tìm thấy giao dịch cần đối soát");

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.paymentReconciliationCase.updateMany({
        where: { id, status: "OPEN" },
        data: { status: resolution, resolutionNote: cleanNote, resolvedById: actorId, resolvedAt: new Date() },
      });
      if (res.count === 0) throw new ConflictException("Giao dịch này đã được xử lý");
      await this.audit.logActionWithClient(tx, {
        action: resolution === "RESOLVED" ? "PAYMENT_RECONCILIATION_RESOLVED" : "PAYMENT_RECONCILIATION_DISMISSED",
        entity: "PaymentReconciliationCase",
        entityId: id,
        actorId,
        details: { note: cleanNote },
      });
      return tx.paymentReconciliationCase.findUniqueOrThrow({ where: { id } });
    });
    return this.view(updated);
  }

  private view(c: Prisma.PaymentReconciliationCaseGetPayload<object>): ReconciliationCaseView {
    const difference = c.expectedAmount != null ? c.receivedAmount - c.expectedAmount : null;
    return {
      id: c.id,
      provider: c.provider,
      externalEventId: c.externalEventId,
      reason: c.reason,
      status: c.status,
      paymentId: c.paymentId,
      orderId: c.orderId,
      transferCode: c.transferCode,
      expectedAmount: c.expectedAmount,
      receivedAmount: c.receivedAmount,
      /** > 0: khách chuyển thừa, < 0: chuyển thiếu, null: không xác định được đơn. */
      difference,
      currency: c.currency,
      lastRequery: c.lastRequery,
      lastRequeryAt: c.lastRequeryAt,
      resolutionNote: c.resolutionNote,
      resolvedById: c.resolvedById,
      resolvedAt: c.resolvedAt,
      createdAt: c.createdAt,
    };
  }
}
