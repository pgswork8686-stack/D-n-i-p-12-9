import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import {
  TestPaymentProvider,
  computeTestWebhookSignature,
} from "./test-payment.provider";
import { AuditService } from "../audit/audit.service";
import {
  prisma,
  PaymentStatus,
  OrderStatus,
  OutboxEventStatus,
  Currency,
} from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      $transaction: jest.fn((cb) => cb(prisma)),
      payment: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      order: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      paymentEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      outboxEvent: {
        create: jest.fn(),
      },
    },
  };
});

describe("PaymentsService", () => {
  let service: PaymentsService;
  let auditService: AuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.ENABLE_TEST_PAYMENT_PROVIDER = "true";
    process.env.TEST_PAYMENT_WEBHOOK_SECRET = "nexus_test_webhook_secret_key";

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        TestPaymentProvider,
        {
          provide: AuditService,
          useValue: {
            logAction: jest.fn().mockResolvedValue({}),
            logActionWithClient: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    auditService = module.get<AuditService>(AuditService);
  });

  describe("Fail-Closed & Webhook Signature Verification", () => {
    it("refuses test payment if NODE_ENV=production even if flag is true", async () => {
      process.env.NODE_ENV = "production";
      process.env.ENABLE_TEST_PAYMENT_PROVIDER = "true";

      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt-prod-1",
        eventType: "payment.succeeded" as const,
      };

      await expect(service.processTestCallback(dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("refuses test payment if ENABLE_TEST_PAYMENT_PROVIDER is false", async () => {
      process.env.NODE_ENV = "development";
      process.env.ENABLE_TEST_PAYMENT_PROVIDER = "false";

      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt-dev-disabled",
        eventType: "payment.succeeded" as const,
      };

      await expect(service.processTestCallback(dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("rejects test payment if x-test-signature header is missing", async () => {
      process.env.NODE_ENV = "test";
      process.env.ENABLE_TEST_PAYMENT_PROVIDER = "true";

      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt-no-sig",
        eventType: "payment.succeeded" as const,
      };

      await expect(service.processTestCallback(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects test payment if x-test-signature is invalid", async () => {
      process.env.NODE_ENV = "test";
      process.env.ENABLE_TEST_PAYMENT_PROVIDER = "true";

      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt-bad-sig",
        eventType: "payment.succeeded" as const,
      };

      await expect(
        service.processTestCallback(dto, {
          "x-test-signature": "bad_signature",
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("processTestCallback - State Transitions & Outbox Atomicity", () => {
    it("on payment.succeeded: transitions Payment to SUCCEEDED, Order to PAID, and creates ORDER_PAID outbox atomically via CAS", async () => {
      (prisma.paymentEvent.findUnique as jest.Mock).mockResolvedValue(null);

      const mockPayment = {
        id: "pay-1",
        orderId: "order-1",
        provider: "TEST",
        status: PaymentStatus.PENDING,
        amount: 5900,
        currency: Currency.USD,
        order: {
          id: "order-1",
          orderNumber: "ORD-20260913-001",
          userId: "user-1",
          status: OrderStatus.PENDING_PAYMENT,
          totalAmount: 5900,
          currency: Currency.USD,
        },
      };

      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.paymentEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.payment.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.order.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.outboxEvent.create as jest.Mock).mockResolvedValue({});

      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt_ext_101",
        eventType: "payment.succeeded" as const,
      };
      const sig = computeTestWebhookSignature(dto);

      const result = await service.processTestCallback(dto, {
        "x-test-signature": sig,
      });

      // 1. PaymentEvent recorded with compound unique key
      expect(prisma.paymentEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          paymentId: "pay-1",
          provider: "TEST",
          eventType: "payment.succeeded",
          externalEventId: "evt_ext_101",
        }),
      });

      // 2. CAS update on Payment
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "pay-1", status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.SUCCEEDED },
      });

      // 3. CAS update on Order
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: "order-1", status: OrderStatus.PENDING_PAYMENT },
        data: { status: OrderStatus.PAID },
      });

      // 4. Exactly one ORDER_PAID outbox event created in transaction
      expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: "ORDER_PAID",
          aggregateType: "Order",
          aggregateId: "order-1",
          status: OutboxEventStatus.PENDING,
          payload: expect.objectContaining({
            orderId: "order-1",
            userId: "user-1",
            totalAmount: 5900,
            currency: Currency.USD,
            paymentId: "pay-1",
          }),
        }),
      });

      // 5. Transactional Audit logged
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "ORDER_PAID",
          entity: "Order",
          entityId: "order-1",
          actorId: "user-1",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
      expect(result.orderStatus).toBe(OrderStatus.PAID);
    });

    it("terminal state preservation: payment already SUCCEEDED does not reverse or emit duplicate ORDER_PAID", async () => {
      (prisma.paymentEvent.findUnique as jest.Mock).mockResolvedValue(null);

      const terminalPayment = {
        id: "pay-1",
        orderId: "order-1",
        provider: "TEST",
        status: PaymentStatus.SUCCEEDED,
        amount: 5900,
        currency: Currency.USD,
        order: {
          id: "order-1",
          status: OrderStatus.PAID,
        },
      };

      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(
        terminalPayment,
      );

      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt_second_success",
        eventType: "payment.succeeded" as const,
      };
      const sig = computeTestWebhookSignature(dto);

      const result = await service.processTestCallback(dto, {
        "x-test-signature": sig,
      });

      expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
      expect(result.orderStatus).toBe(OrderStatus.PAID);
      // No new outbox event emitted
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });

    it("terminal state preservation: cancelled callback on already SUCCEEDED payment is ignored", async () => {
      (prisma.paymentEvent.findUnique as jest.Mock).mockResolvedValue(null);

      const terminalPayment = {
        id: "pay-1",
        orderId: "order-1",
        provider: "TEST",
        status: PaymentStatus.SUCCEEDED,
        amount: 5900,
        currency: Currency.USD,
        order: {
          id: "order-1",
          status: OrderStatus.PAID,
        },
      };

      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(
        terminalPayment,
      );

      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt_cancel_after_paid",
        eventType: "payment.cancelled" as const,
      };
      const sig = computeTestWebhookSignature(dto);

      const result = await service.processTestCallback(dto, {
        "x-test-signature": sig,
      });

      expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
      expect(result.orderStatus).toBe(OrderStatus.PAID);
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("processTestCallback - Idempotency", () => {
    it("sequential duplicate: returns duplicate=true and performs NO mutations", async () => {
      const existingEvent = {
        id: "evt-db-1",
        externalEventId: "evt_duplicate_001",
        payment: {
          id: "pay-1",
          status: PaymentStatus.SUCCEEDED,
          order: {
            id: "order-1",
            status: OrderStatus.PAID,
          },
        },
      };

      (prisma.paymentEvent.findUnique as jest.Mock).mockResolvedValue(
        existingEvent,
      );

      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt_duplicate_001",
        eventType: "payment.succeeded" as const,
      };
      const sig = computeTestWebhookSignature(dto);

      const result = await service.processTestCallback(dto, {
        "x-test-signature": sig,
      });

      expect(result.duplicate).toBe(true);
      expect(result.success).toBe(true);
      expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
      expect(result.orderStatus).toBe(OrderStatus.PAID);

      // No DB mutations executed
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });

    it("concurrent duplicate: handles Prisma unique constraint violation (P2002) idempotently", async () => {
      (prisma.paymentEvent.findUnique as jest.Mock).mockResolvedValue(null);

      const mockPayment = {
        id: "pay-1",
        orderId: "order-1",
        provider: "TEST",
        status: PaymentStatus.PENDING,
        amount: 2500,
        currency: Currency.USD,
        order: {
          id: "order-1",
          status: OrderStatus.PENDING_PAYMENT,
        },
      };

      (prisma.payment.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPayment) // initial lookup
        .mockResolvedValueOnce({
          ...mockPayment,
          status: PaymentStatus.SUCCEEDED,
          order: { id: "order-1", status: OrderStatus.PAID },
        }); // reloaded on conflict

      // Simulate concurrent race: $transaction throws P2002
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce({
        code: "P2002",
        message:
          "Unique constraint failed on the fields: (`provider`, `external_event_id`)",
      });

      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt_concurrent_race",
        eventType: "payment.succeeded" as const,
      };
      const sig = computeTestWebhookSignature(dto);

      const result = await service.processTestCallback(dto, {
        "x-test-signature": sig,
      });

      expect(result.duplicate).toBe(true);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Concurrent duplicate event handled");
    });
  });
});
