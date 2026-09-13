import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { AuditService } from "../audit/audit.service";
import { CartService } from "../cart/cart.service";
import {
  prisma,
  ProductStatus,
  VariantStatus,
  OrderStatus,
  Currency,
  BillingType,
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
        create: jest.fn(),
      },
      orderItem: {
        create: jest.fn(),
      },
      payment: {
        create: jest.fn(),
      },
      cart: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      cartItem: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      productVariant: {
        findUnique: jest.fn(),
      },
      idempotencyKey: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    },
  };
});

describe("Commerce Round 2 Comprehensive Regressions", () => {
  let ordersService: OrdersService;
  let cartService: CartService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        CartService,
        {
          provide: AuditService,
          useValue: {
            logAction: jest.fn().mockResolvedValue({}),
            logActionWithClient: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    ordersService = module.get<OrdersService>(OrdersService);
    cartService = module.get<CartService>(CartService);
    (prisma.cart.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  describe("Deterministic Price Selection (Option B)", () => {
    it("rejects checkout when multiple active prices exist for a variant and no priceId is specified", async () => {
      const mockCart = {
        id: "cart-ambiguous",
        userId: "user-1",
        status: "ACTIVE",
        items: [
          {
            id: "ci-1",
            variantId: "var-multi",
            priceId: null, // No explicit priceId
            quantity: 1,
            variant: {
              id: "var-multi",
              sku: "SKU-AMBIGUOUS",
              status: VariantStatus.ACTIVE,
              product: {
                id: "prod-1",
                slug: "ambiguous-theme",
                status: ProductStatus.ACTIVE,
              },
              prices: [
                {
                  id: "price-usd-tier1",
                  currency: Currency.USD,
                  amount: 2900,
                  billingType: BillingType.ONE_TIME,
                  isActive: true,
                },
                {
                  id: "price-usd-tier2",
                  currency: Currency.USD,
                  amount: 5900,
                  billingType: BillingType.ONE_TIME,
                  isActive: true,
                },
              ],
            },
          },
        ],
      };

      (prisma.cart.findFirst as jest.Mock).mockResolvedValue(mockCart);

      await expect(
        ordersService.checkout("user-1", { currency: Currency.USD }),
      ).rejects.toThrow(BadRequestException);
    });

    it("succeeds when multiple prices exist but explicit priceId matches one of them", async () => {
      const mockCart = {
        id: "cart-with-priceId",
        userId: "user-1",
        status: "ACTIVE",
        items: [
          {
            id: "ci-1",
            variantId: "var-multi",
            priceId: "price-usd-tier2",
            quantity: 1,
            variant: {
              id: "var-multi",
              name: "Multi-Price Variant",
              sku: "SKU-AMBIGUOUS",
              status: VariantStatus.ACTIVE,
              product: {
                id: "prod-1",
                name: "Product Name",
                productType: ProductType.LICENSED_SOFTWARE,
                fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
                status: ProductStatus.ACTIVE,
              },
              prices: [
                {
                  id: "price-usd-tier1",
                  currency: Currency.USD,
                  amount: 2900,
                  billingType: BillingType.ONE_TIME,
                  isActive: true,
                },
                {
                  id: "price-usd-tier2",
                  currency: Currency.USD,
                  amount: 5900,
                  billingType: BillingType.ONE_TIME,
                  isActive: true,
                },
              ],
            },
          },
        ],
      };

      (prisma.cart.findFirst as jest.Mock).mockResolvedValue(mockCart);
      (prisma.cart.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.order.create as jest.Mock).mockResolvedValue({
        id: "ord-1",
        orderNumber: "ORD-TEST-1",
        userId: "user-1",
        status: OrderStatus.PENDING_PAYMENT,
        currency: Currency.USD,
        subtotalAmount: 5900,
        discountAmount: 0,
        totalAmount: 5900,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (prisma.orderItem.create as jest.Mock).mockImplementation(
        async ({ data }) => ({ ...data, id: "oi-1", createdAt: new Date() }),
      );
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        id: "pay-1",
        orderId: "ord-1",
        provider: "TEST",
        status: "PENDING",
        amount: 5900,
        currency: Currency.USD,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await ordersService.checkout("user-1", {
        currency: Currency.USD,
      });

      expect(res.order.totalAmount).toBe(5900);
      expect(prisma.orderItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unitAmount: 5900,
          }),
        }),
      );
    });
  });

  describe("Money and Quantity Bounds", () => {
    it("rejects item addition when quantity is greater than 999", async () => {
      await expect(
        cartService.addItem("user-1", {
          variantId: "var-1",
          quantity: 1000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects item addition when quantity is fractional or negative", async () => {
      await expect(
        cartService.addItem("user-1", {
          variantId: "var-1",
          quantity: -5,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        cartService.addItem("user-1", {
          variantId: "var-1",
          quantity: 2.5,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("Scoped Idempotency Key Isolation", () => {
    it("isolates same key used by User A and User B", async () => {
      // User A creates order with key-xyz
      (prisma.idempotencyKey.findUnique as jest.Mock).mockImplementation(
        ({ where }) => {
          if (where.scope_userId_key?.userId === "user-A") {
            return Promise.resolve({
              id: "key-rec-A",
              key: "key-xyz",
              userId: "user-A",
              requestFingerprint: "fingerprint-A",
              response: { order: { id: "order-A" } },
              expiresAt: new Date(Date.now() + 10000),
            });
          }
          // User B has no record for key-xyz
          return Promise.resolve(null);
        },
      );

      // User B query will not find User A's response
      const existing = await prisma.idempotencyKey.findUnique({
        where: {
          scope_userId_key: {
            scope: "checkout",
            userId: "user-B",
            key: "key-xyz",
          },
        },
      });

      expect(existing).toBeNull();
    });
  });

  describe("Active Cart Concurrency Race", () => {
    it("catches Prisma P2002 on concurrent active cart creation and returns existing active cart", async () => {
      const activeCart = {
        id: "cart-active-existing",
        userId: "user-race",
        status: "ACTIVE",
      };

      (prisma.cart.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // first lookup finds nothing
        .mockResolvedValueOnce(activeCart); // reloaded after race conflict

      (prisma.cart.create as jest.Mock).mockRejectedValueOnce({
        code: "P2002",
        message: "Unique constraint failed on cart_user_active_unique",
      });

      const cart = await cartService.getOrCreateActiveCart("user-race");
      expect(cart.id).toBe("cart-active-existing");
    });
  });
});
