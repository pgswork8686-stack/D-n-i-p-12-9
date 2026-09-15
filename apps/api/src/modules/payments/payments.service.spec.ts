import { Test, TestingModule } from "@nestjs/testing";
import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import {
  TestPaymentProvider,
  computeTestWebhookSignature,
} from "./test-payment.provider";
import { StripePaymentProvider } from "./stripe-payment.provider";
import { PaymentProviderFactory } from "./payment-provider.factory";
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
  const prismaMock: any = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    payment: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
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
  };
  prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));
  return { ...actual, prisma: prismaMock };
});

describe("PaymentsService", () => {
  let service: PaymentsService;
  let auditService: AuditService;
  let testProvider: TestPaymentProvider;
  let stripeProvider: StripePaymentProvider;

  const invokeAuthoritativeSuccess = (params: Record<string, any>) =>
    (service as any).processAuthoritativePaymentEvent({
      ...params,
      eventType: "payment.succeeded",
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.ENABLE_TEST_PAYMENT_PROVIDER = "true";
    process.env.TEST_PAYMENT_WEBHOOK_SECRET = "nexus_test_webhook_secret_key";
    process.env.STRIPE_MOCK_CLIENT = "true";
    process.env.PAYMENT_RETURN_BASE_URL = "http://localhost:3001";

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        TestPaymentProvider,
        StripePaymentProvider,
        PaymentProviderFactory,
        {
          provide: AuditService,
          useValue: {
            logAction: jest.fn().mockResolvedValue({}),
            logActionWithClient: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
    auditService = module.get(AuditService);
    testProvider = module.get(TestPaymentProvider);
    stripeProvider = module.get(StripePaymentProvider);
  });

  afterEach(() => {
    delete process.env.STRIPE_MOCK_CLIENT;
    delete process.env.PAYMENT_RETURN_BASE_URL;
  });

  describe("Phase 4 test provider regression", () => {
    it("fails closed in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.ENABLE_TEST_PAYMENT_PROVIDER = "true";
      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt-prod",
        eventType: "payment.succeeded" as const,
      };
      await expect(service.processTestCallback(dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("requires a valid test callback signature", async () => {
      const dto = {
        paymentId: "pay-1",
        externalEventId: "evt-no-sig",
        eventType: "payment.succeeded" as const,
      };
      await expect(service.processTestCallback(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("keeps Payment, Order, Outbox and Audit in one successful transaction", async () => {
      const payment = {
        id: "pay-1",
        orderId: "order-1",
        provider: "TEST",
        providerReference: null,
        status: PaymentStatus.PENDING,
        amount: 5900,
        currency: Currency.USD,
        order: {
          id: "order-1",
          orderNumber: "ORD-1",
          userId: "user-1",
          status: OrderStatus.PENDING_PAYMENT,
          totalAmount: 5900,
          currency: Currency.USD,
        },
      };
      (prisma.paymentEvent.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(payment);
      (prisma.payment.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.order.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.outboxEvent.create as jest.Mock).mockResolvedValue({});

      const dto = {
        paymentId: payment.id,
        externalEventId: "evt-success",
        eventType: "payment.succeeded" as const,
      };
      const result = await service.processTestCallback(dto, {
        "x-test-signature": computeTestWebhookSignature(dto),
      });

      expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
      expect(result.orderStatus).toBe(OrderStatus.PAID);
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: "ORDER_PAID",
          aggregateType: "Order",
          aggregateId: payment.orderId,
          status: OutboxEventStatus.PENDING,
        }),
      });
      expect(auditService.logActionWithClient).toHaveBeenCalled();
    });
  });

  describe("payment-session", () => {
    it("returns 404 semantics for unknown order", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.createPaymentSession("user-1", "missing"),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects cross-user order access", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: "order-1",
        userId: "other",
        status: OrderStatus.PENDING_PAYMENT,
        payments: [],
      });
      await expect(
        service.createPaymentSession("user-1", "order-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("creates a session from authoritative Order price/currency", async () => {
      const order = {
        id: "order-1",
        orderNumber: "ORD-1",
        userId: "user-1",
        status: OrderStatus.PENDING_PAYMENT,
        totalAmount: 5000,
        currency: Currency.USD,
        payments: [],
      };
      const payment = {
        id: "pay-1",
        orderId: order.id,
        provider: "stripe",
        providerReference: null,
        status: PaymentStatus.PENDING,
        amount: order.totalAmount,
        currency: order.currency,
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(order);
      (prisma.payment.create as jest.Mock).mockResolvedValue(payment);
      (prisma.payment.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.createPaymentSession("user-1", order.id, {
        provider: "stripe",
      });

      expect(result.amount).toBe(5000);
      expect(result.currency).toBe(Currency.USD);
      expect(result.paymentId).toBe(payment.id);
      expect(result.providerReference).toBe(`cs_test_${payment.id}`);
    });

    it("never fabricates a URL when provider session retrieval fails", async () => {
      const order = {
        id: "order-1",
        orderNumber: "ORD-1",
        userId: "user-1",
        status: OrderStatus.PENDING_PAYMENT,
        totalAmount: 5000,
        currency: Currency.USD,
        payments: [
          {
            id: "pay-1",
            orderId: "order-1",
            provider: "stripe",
            providerReference: "cs_missing",
            status: PaymentStatus.PENDING,
            amount: 5000,
            currency: Currency.USD,
          },
        ],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(order);
      jest.spyOn(stripeProvider, "getPaymentSession").mockResolvedValue(null);

      await expect(
        service.createPaymentSession("user-1", order.id, {
          provider: "stripe",
        }),
      ).rejects.toThrow(BadGatewayException);
    });

    it("rejects an untrusted absolute redirect", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: "order-1",
        userId: "user-1",
        status: OrderStatus.PENDING_PAYMENT,
        payments: [],
      });
      await expect(
        service.createPaymentSession("user-1", "order-1", {
          successUrl: "https://evil.example/phish",
        }),
      ).rejects.toThrow("Untrusted redirect URL origin");
    });
  });

  describe("authoritative provider evidence", () => {
    const order = {
      id: "order-1",
      orderNumber: "ORD-1",
      userId: "user-1",
      status: OrderStatus.PENDING_PAYMENT,
      totalAmount: 5000,
      currency: Currency.USD,
    };
    const payment = {
      id: "pay-1",
      orderId: order.id,
      provider: "test",
      providerReference: "test_ref_pay-1",
      status: PaymentStatus.PENDING,
      amount: 5000,
      currency: Currency.USD,
      order,
    };

    beforeEach(() => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(payment);
      (prisma.payment.findUniqueOrThrow as jest.Mock).mockResolvedValue(payment);
      (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue(order);
      (prisma.paymentEvent.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.paymentEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.payment.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.order.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.outboxEvent.create as jest.Mock).mockResolvedValue({});
    });

    it("rejects provider mismatch before state mutation", async () => {
      await expect(
        invokeAuthoritativeSuccess({
          provider: "stripe",
          externalEventId: "evt-provider-mismatch",
          paymentId: payment.id,
          orderId: order.id,
          providerReference: payment.providerReference,
          amount: payment.amount,
          currency: payment.currency,
        }),
      ).rejects.toThrow("Payment provider mismatch");
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });

    it("rejects amount mismatch", async () => {
      await expect(
        invokeAuthoritativeSuccess({
          provider: "test",
          externalEventId: "evt-amount-mismatch",
          paymentId: payment.id,
          orderId: order.id,
          providerReference: payment.providerReference,
          amount: 4999,
          currency: payment.currency,
        }),
      ).rejects.toThrow("Payment amount mismatch");
    });

    it("rejects provider-reference mismatch", async () => {
      await expect(
        invokeAuthoritativeSuccess({
          provider: "test",
          externalEventId: "evt-ref-mismatch",
          paymentId: payment.id,
          orderId: order.id,
          providerReference: "test_ref_other",
          amount: payment.amount,
          currency: payment.currency,
        }),
      ).rejects.toThrow("Provider reference mismatch");
    });

    it("transitions PENDING -> SUCCEEDED and emits exactly one ORDER_PAID", async () => {
      const result = await invokeAuthoritativeSuccess({
        provider: "test",
        externalEventId: "evt-paid",
        paymentId: payment.id,
        orderId: order.id,
        providerReference: payment.providerReference,
        amount: payment.amount,
        currency: payment.currency,
      });
      expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
      expect(result.orderStatus).toBe(OrderStatus.PAID);
      expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
    });

    it("does not resurrect FAILED payment attempts", async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        ...payment,
        status: PaymentStatus.FAILED,
      });
      const result = await invokeAuthoritativeSuccess({
        provider: "test",
        externalEventId: "evt-late-success",
        paymentId: payment.id,
        orderId: order.id,
        providerReference: payment.providerReference,
        amount: payment.amount,
        currency: payment.currency,
      });
      expect(result.paymentStatus).toBe(PaymentStatus.FAILED);
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });

    it("logs duplicate-payment anomaly but emits no second outbox", async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        ...payment,
        order: { ...order, status: OrderStatus.PAID },
      });
      const result = await invokeAuthoritativeSuccess({
        provider: "test",
        externalEventId: "evt-second-payment",
        paymentId: payment.id,
        orderId: order.id,
        providerReference: payment.providerReference,
        amount: payment.amount,
        currency: payment.currency,
      });
      expect(result.orderStatus).toBe(OrderStatus.PAID);
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "DUPLICATE_PAYMENT_DETECTED" }),
      );
    });
  });

  describe("reconciliation", () => {
    it("requires exact amount and currency", async () => {
      const payment = {
        id: "pay-rec",
        orderId: "order-1",
        provider: "test",
        providerReference: "test_session_rec",
        amount: 5000,
        currency: Currency.USD,
        status: PaymentStatus.PENDING,
        order: {
          id: "order-1",
          orderNumber: "ORD-1",
          userId: "user-1",
          status: OrderStatus.PENDING_PAYMENT,
          totalAmount: 5000,
          currency: Currency.USD,
        },
      };
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(payment);
      testProvider.setMockStatus(payment.providerReference, {
        status: PaymentStatus.SUCCEEDED,
        amount: 9999,
        currency: "USD",
      });
      await expect(service.reconcilePayment(payment.id)).rejects.toThrow(
        "Amount mismatch in reconciliation",
      );
    });

    it("routes a verified provider status through the same private authority", async () => {
      const payment = {
        id: "pay-rec-ok",
        orderId: "order-1",
        provider: "test",
        providerReference: "test_session_rec_ok",
        amount: 5000,
        currency: Currency.USD,
        status: PaymentStatus.PENDING,
        order: {
          id: "order-1",
          orderNumber: "ORD-1",
          userId: "user-1",
          status: OrderStatus.PENDING_PAYMENT,
          totalAmount: 5000,
          currency: Currency.USD,
        },
      };
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(payment);
      (prisma.payment.findUniqueOrThrow as jest.Mock).mockResolvedValue(payment);
      (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue(payment.order);
      (prisma.paymentEvent.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.payment.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.order.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      testProvider.setMockStatus(payment.providerReference, {
        status: PaymentStatus.SUCCEEDED,
        amount: payment.amount,
        currency: payment.currency,
      });

      const result = await service.reconcilePayment(payment.id);
      expect(result.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
      expect(result.orderStatus).toBe(OrderStatus.PAID);
    });
  });

  describe("payment read scoping", () => {
    it("returns 404 to a different customer and strips sensitive metadata for owner", async () => {
      const payment = {
        id: "pay-secret",
        orderId: "order-1",
        provider: "stripe",
        providerReference: "cs_1",
        status: PaymentStatus.SUCCEEDED,
        amount: 5000,
        currency: Currency.USD,
        metadata: {
          clientSecret: "secret",
          safeNote: "ok",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        order: { userId: "owner" },
      };
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(payment);

      await expect(
        service.getPayment("pay-secret", {
          id: "other",
          roles: ["customer"],
          permissions: [],
        } as any),
      ).rejects.toThrow(NotFoundException);

      const owner = await service.getPayment("pay-secret", {
        id: "owner",
        roles: ["customer"],
        permissions: [],
      } as any);
      expect(owner.metadata?.clientSecret).toBeUndefined();
      expect(owner.metadata?.safeNote).toBe("ok");
    });
  });
});
