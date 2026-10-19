import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";

const mockCase = {
  findUnique: jest.fn(),
  findUniqueOrThrow: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
};
const mockOrder = { findUnique: jest.fn() };

jest.mock("@nexus/database", () => {
  const client: any = {
    paymentReconciliationCase: mockCase,
    order: mockOrder,
    $transaction: jest.fn(async (fn: any) => fn(client)),
  };
  return { prisma: client, Prisma: {} };
});

import { PaymentReconciliationService } from "./payment-reconciliation.service";

const baseCase = {
  id: "c1", provider: "sepay", externalEventId: "sepay_1", reason: "AMOUNT_MISMATCH", status: "OPEN",
  paymentId: "p1", orderId: "o1", transferCode: "NXS123", expectedAmount: 890000, receivedAmount: 800000,
  currency: "VND", rawPayloadHash: "h", sanitizedPayload: {}, lastRequery: null, lastRequeryAt: null,
  resolutionNote: null, resolvedById: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

describe("PaymentReconciliationService", () => {
  const audit = { logAction: jest.fn(), logActionWithClient: jest.fn() };
  const sepay = { lookupTransfersByCode: jest.fn() };
  let service: PaymentReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentReconciliationService(audit as any, sepay as any);
  });

  describe("recordFromWebhook", () => {
    const event: any = {
      externalEventId: "sepay_1", eventType: "ignored", rawPayloadHash: "h", sanitizedPayload: { id: 1 },
      review: { reason: "AMOUNT_MISMATCH", receivedAmount: 800000, expectedAmount: 890000, transferCode: "NXS123", paymentId: "p1", orderId: "o1" },
    };

    it("opens a case and audits it", async () => {
      mockCase.findUnique.mockResolvedValue(null);
      mockCase.create.mockResolvedValue({ id: "c1" });
      await service.recordFromWebhook("sepay", event);
      expect(mockCase.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ reason: "AMOUNT_MISMATCH", receivedAmount: 800000, expectedAmount: 890000 }),
      }));
      expect(audit.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "PAYMENT_RECONCILIATION_CASE_OPENED" }));
    });

    it("is idempotent for a retried webhook", async () => {
      mockCase.findUnique.mockResolvedValue({ id: "c1" });
      await service.recordFromWebhook("sepay", event);
      expect(mockCase.create).not.toHaveBeenCalled();
    });

    it("ignores events without a review marker (noise such as outgoing transfers)", async () => {
      await service.recordFromWebhook("sepay", { ...event, review: undefined });
      expect(mockCase.create).not.toHaveBeenCalled();
    });

    it("never throws into the webhook path", async () => {
      mockCase.findUnique.mockRejectedValue(new Error("db down"));
      await expect(service.recordFromWebhook("sepay", event)).resolves.toBeUndefined();
    });
  });

  describe("list", () => {
    it("rejects unknown filters and reports signed difference", async () => {
      await expect(service.list({ status: "NOPE" })).rejects.toBeInstanceOf(BadRequestException);
      mockCase.findMany.mockResolvedValue([baseCase]);
      mockCase.count.mockResolvedValue(1);
      const res = await service.list({ status: "OPEN" });
      expect(res.items[0].difference).toBe(-90000); // underpaid
      expect(res.openCount).toBe(1);
    });
  });

  describe("requery", () => {
    it("stores what SePay reports but never touches orders or payments", async () => {
      mockCase.findUnique.mockResolvedValue(baseCase);
      sepay.lookupTransfersByCode.mockResolvedValue([{ id: "9", amount: 890000, transferCode: "NXS123", occurredAt: null }]);
      mockCase.update.mockImplementation(async ({ data }: any) => ({ ...baseCase, ...data }));
      const res: any = await service.requery("c1", "staff1");
      expect(res.lastRequery.matchesExpected).toBe(true);
      expect(mockOrder.findUnique).not.toHaveBeenCalled();
      expect(audit.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "PAYMENT_RECONCILIATION_REQUERIED", actorId: "staff1" }));
    });

    it("fails clearly when SePay is unreachable or has no code", async () => {
      mockCase.findUnique.mockResolvedValue(baseCase);
      sepay.lookupTransfersByCode.mockResolvedValue(null);
      await expect(service.requery("c1", "s")).rejects.toBeInstanceOf(ServiceUnavailableException);
      mockCase.findUnique.mockResolvedValue({ ...baseCase, transferCode: null });
      await expect(service.requery("c1", "s")).rejects.toBeInstanceOf(BadRequestException);
      mockCase.findUnique.mockResolvedValue(null);
      await expect(service.requery("x", "s")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("resolve", () => {
    it("requires a note and a valid resolution", async () => {
      await expect(service.resolve("c1", "s", "RESOLVED", "ok")).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.resolve("c1", "s", "PAID" as any, "ghi chú đủ dài")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("records the decision with an audit entry and cannot be applied twice", async () => {
      mockCase.findUnique.mockResolvedValue({ id: "c1" });
      mockCase.updateMany.mockResolvedValueOnce({ count: 1 });
      mockCase.findUniqueOrThrow.mockResolvedValue({ ...baseCase, status: "RESOLVED", resolutionNote: "Đã hoàn tiền thừa" });
      const res = await service.resolve("c1", "staff1", "RESOLVED", "Đã hoàn tiền thừa");
      expect(res.status).toBe("RESOLVED");
      expect(audit.logActionWithClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "PAYMENT_RECONCILIATION_RESOLVED", actorId: "staff1" }));

      mockCase.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.resolve("c1", "staff1", "DISMISSED", "xử lý lần hai")).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
