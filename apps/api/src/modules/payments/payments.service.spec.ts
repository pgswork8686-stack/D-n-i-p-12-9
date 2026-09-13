import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { TestPaymentProvider } from "./test-payment.provider";
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
      },
      order: {
        update: jest.fn(),
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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        TestPaymentProvider,
        {
          provide: AuditService,
          useValue: {
            logAction: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    auditService = module.get<AuditService>(AuditService);
  });

  describe("processTestCallback - State Transitions & Outbox Atomicity", () => {
    it("on payment.succeeded: transitions Payment to SUCCEEDED, Order to PAID, and creates ORDER_PAID outbox atomically", async () => {
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
      (prisma.payment.update as jest.Mock).mockResolvedValue({});
      (prisma.order.update as jest.Mock).mockResolvedValue({});
      (prisma.outboxEvent.create as jest.Mock).mockResolvedValue({});

      const result = await service.processTestCallback({
        paymentId: "pay-1",
        externalEventId: "evt_ext_101",
        eventType: "payment.succeeded",
      });

      // 1. PaymentEvent recorded with externalEventId
      expect(prisma.paymentEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          paymentId: "pay-1",
          provider: "TEST",
          eventType: "payment.succeeded",
          externalEventId: "evt_ext_101",
        }),
      });

      // 2. Payment marked SUCCEEDED
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: "pay-1" },
        data: { status: PaymentStatus.SUCCEEDED },
      });

      // 3. Order marked PAID
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: "order-1" },
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

      // 5. Audit logged
      expect(auditService.logAction).toHaveBeenCalledWith(
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

    it("on payment.failed: marks Payment as FAILED, but leaves Order NOT PAID", async () => {
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
          orderNumber: "ORD-FAIL-1",
          userId: "user-1",
          status: OrderStatus.PENDING_PAYMENT,
          totalAmount: 2500,
          currency: Currency.USD,
        },
      };

      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.paymentEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.payment.update as jest.Mock).mockResolvedValue({});

      const result = await service.processTestCallback({
        paymentId: "pay-1",
        externalEventId: "evt_fail_1",
        eventType: "payment.failed",
      });

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: "pay-1" },
        data: { status: PaymentStatus.FAILED },
      });

      // Order must NOT be marked PAID
      expect(prisma.order.update).not.toHaveBeenCalled();
      // No ORDER_PAID outbox event created
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();

      expect(result.paymentStatus).toBe(PaymentStatus.FAILED);
      expect(result.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
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

      (prisma.paymentEvent.findUnique as jest.Mock).mockResolvedValue(existingEvent);

      const result = await service.processTestCallback({
        paymentId: "pay-1",
        externalEventId: "evt_duplicate_001",
        eventType: "payment.succeeded",
      });

      expect(result.duplicate).toBe(true);
      expect(result.success).toBe(true);
      expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
      expect(result.orderStatus).toBe(OrderStatus.PAID);

      // No DB transaction / mutations executed
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
        message: "Unique constraint failed on the fields: (`external_event_id`)",
      });

      const result = await service.processTestCallback({
        paymentId: "pay-1",
        externalEventId: "evt_concurrent_race",
        eventType: "payment.succeeded",
      });

      expect(result.duplicate).toBe(true);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Concurrent duplicate event handled");
    });
  });
});
