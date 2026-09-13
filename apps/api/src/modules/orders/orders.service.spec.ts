import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { AuditService } from "../audit/audit.service";
import {
  prisma,
  ProductStatus,
  VariantStatus,
  OrderStatus,
  Currency,
  ProductType,
  FulfillmentType,
} from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      $transaction: jest.fn((cb) => cb(prisma)),
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      orderItem: {
        create: jest.fn(),
      },
      payment: {
        create: jest.fn(),
      },
      cart: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      idempotencyKey: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    },
  };
});

describe("OrdersService", () => {
  let service: OrdersService;
  let auditService: AuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: AuditService,
          useValue: {
            logAction: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    auditService = module.get<AuditService>(AuditService);
  });

  describe("checkout & authoritative repricing", () => {
    it("rejects checkout when cart is empty", async () => {
      (prisma.cart.findFirst as jest.Mock).mockResolvedValue({
        id: "cart-empty",
        userId: "user-1",
        items: [],
      });

      await expect(
        service.checkout("user-1", { currency: Currency.USD }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects checkout when a variant in the cart has become inactive", async () => {
      (prisma.cart.findFirst as jest.Mock).mockResolvedValue({
        id: "cart-1",
        userId: "user-1",
        items: [
          {
            id: "item-1",
            variantId: "var-1",
            quantity: 1,
            variant: {
              sku: "SKU-ARCHIVED",
              status: VariantStatus.ARCHIVED,
              product: { status: ProductStatus.ACTIVE },
              prices: [{ currency: Currency.USD, amount: 1000, isActive: true }],
            },
          },
        ],
      });

      await expect(
        service.checkout("user-1", { currency: Currency.USD }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects checkout when an active price in the requested currency is missing", async () => {
      (prisma.cart.findFirst as jest.Mock).mockResolvedValue({
        id: "cart-1",
        userId: "user-1",
        items: [
          {
            id: "item-1",
            variantId: "var-1",
            quantity: 1,
            variant: {
              sku: "SKU-NO-USD",
              status: VariantStatus.ACTIVE,
              product: { status: ProductStatus.ACTIVE },
              prices: [], // No active price for USD
            },
          },
        ],
      });

      await expect(
        service.checkout("user-1", { currency: Currency.USD }),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates Order, immutable OrderItem snapshots, and Payment atomically", async () => {
      const mockCart = {
        id: "cart-1",
        userId: "user-1",
        status: "ACTIVE",
        items: [
          {
            id: "ci-1",
            variantId: "var-1",
            quantity: 2,
            variant: {
              id: "var-1",
              sku: "SKU-THEME-PRO",
              name: "Single Domain License",
              status: VariantStatus.ACTIVE,
              product: {
                id: "prod-1",
                name: "Nexus SaaS Theme",
                productType: ProductType.LICENSED_SOFTWARE,
                fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
                status: ProductStatus.ACTIVE,
              },
              prices: [
                {
                  id: "price-1",
                  currency: Currency.USD,
                  amount: 5900, // $59.00
                  isActive: true,
                },
              ],
            },
          },
        ],
      };

      (prisma.cart.findFirst as jest.Mock).mockResolvedValue(mockCart);

      const mockCreatedOrder = {
        id: "order-123",
        orderNumber: "ORD-20260913-TEST1",
        userId: "user-1",
        status: OrderStatus.PENDING_PAYMENT,
        currency: Currency.USD,
        subtotalAmount: 11800,
        discountAmount: 0,
        totalAmount: 11800,
        cartId: "cart-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (prisma.order.create as jest.Mock).mockResolvedValue(mockCreatedOrder);

      const mockCreatedOrderItem = {
        id: "oi-1",
        orderId: "order-123",
        productId: "prod-1",
        variantId: "var-1",
        productName: "Nexus SaaS Theme",
        variantName: "Single Domain License",
        sku: "SKU-THEME-PRO",
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        unitAmount: 5900,
        quantity: 2,
        lineTotalAmount: 11800,
        currency: Currency.USD,
        createdAt: new Date(),
      };
      (prisma.orderItem.create as jest.Mock).mockResolvedValue(mockCreatedOrderItem);

      const mockPayment = {
        id: "pay-123",
        orderId: "order-123",
        provider: "TEST",
        status: "PENDING",
        amount: 11800,
        currency: Currency.USD,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (prisma.payment.create as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.cart.update as jest.Mock).mockResolvedValue({});

      const response = await service.checkout("user-1", { currency: Currency.USD });

      // 1. Authoritative order created
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            status: OrderStatus.PENDING_PAYMENT,
            currency: Currency.USD,
            subtotalAmount: 11800,
            totalAmount: 11800,
          }),
        }),
      );

      // 2. Immutable OrderItem snapshot
      expect(prisma.orderItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: "order-123",
            productId: "prod-1",
            variantId: "var-1",
            productName: "Nexus SaaS Theme",
            variantName: "Single Domain License",
            sku: "SKU-THEME-PRO",
            productType: ProductType.LICENSED_SOFTWARE,
            fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
            unitAmount: 5900,
            quantity: 2,
            lineTotalAmount: 11800,
            currency: Currency.USD,
          }),
        }),
      );

      // 3. Payment created PENDING
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: "order-123",
            provider: "TEST",
            status: "PENDING",
            amount: 11800,
            currency: Currency.USD,
          }),
        }),
      );

      // 4. Cart converted
      expect(prisma.cart.update).toHaveBeenCalledWith({
        where: { id: "cart-1" },
        data: { status: "CONVERTED" },
      });

      // 5. Audit logged
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ORDER_CREATED",
          entity: "Order",
          entityId: "order-123",
          actorId: "user-1",
        }),
      );

      expect(response.order.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(response.order.totalAmount).toBe(11800);
      expect(response.payment.status).toBe("PENDING");
      expect(response.testPaymentAction?.paymentId).toBe("pay-123");
    });
  });

  describe("customer ownership enforcement", () => {
    it("customer can only view their own order; throws ForbiddenException for another user's order", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: "order-customer-2",
        userId: "customer-2", // Belongs to customer-2
        orderNumber: "ORD-999",
        status: OrderStatus.PAID,
        currency: Currency.USD,
        subtotalAmount: 1000,
        discountAmount: 0,
        totalAmount: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // customer-1 attempts to view customer-2's order
      await expect(
        service.getCustomerOrder("customer-1", "order-customer-2"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("listCustomerOrders filters strictly by user's own id", async () => {
      (prisma.order.count as jest.Mock).mockResolvedValue(1);
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        {
          id: "order-1",
          userId: "customer-1",
          orderNumber: "ORD-1",
          status: OrderStatus.PAID,
          currency: Currency.USD,
          subtotalAmount: 2000,
          discountAmount: 0,
          totalAmount: 2000,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [],
          payments: [],
        },
      ]);

      const res = await service.listCustomerOrders("customer-1", { page: 1, limit: 10 });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "customer-1" }),
        }),
      );
      expect(res.items).toHaveLength(1);
    });
  });
});
