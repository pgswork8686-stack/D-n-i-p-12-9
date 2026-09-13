import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { CartService } from "./cart.service";
import {
  prisma,
  ProductStatus,
  VariantStatus,
  Currency,
  ProductType,
  FulfillmentType,
} from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      cart: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      cartItem: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      productVariant: {
        findUnique: jest.fn(),
      },
    },
  };
});

describe("CartService", () => {
  let service: CartService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CartService],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  describe("getCart & authoritative repricing", () => {
    it("returns authoritatively repriced items and subtotal in minor units", async () => {
      const mockCart = {
        id: "cart-1",
        userId: "user-1",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.cart.findFirst as jest.Mock).mockResolvedValue(mockCart);

      const mockItems = [
        {
          id: "item-1",
          cartId: "cart-1",
          variantId: "var-1",
          quantity: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          variant: {
            id: "var-1",
            sku: "SKU-PRO-1",
            name: "Pro 1 Site",
            product: {
              id: "prod-1",
              name: "Nexus Plugin",
              productType: ProductType.LICENSED_SOFTWARE,
              fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
            },
            prices: [
              {
                id: "price-1",
                currency: Currency.USD,
                amount: 4900, // $49.00
                isActive: true,
              },
            ],
          },
        },
      ];

      (prisma.cartItem.findMany as jest.Mock).mockResolvedValue(mockItems);

      const result = await service.getCart("user-1", Currency.USD);

      expect(result.id).toBe("cart-1");
      expect(result.subtotalAmount).toBe(9800); // 4900 * 2
      expect(result.totalAmount).toBe(9800);
      expect(result.itemCount).toBe(2);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].unitAmount).toBe(4900);
      expect(result.items[0].lineTotalAmount).toBe(9800);
      expect(result.items[0].sku).toBe("SKU-PRO-1");
    });
  });

  describe("addItem", () => {
    it("successfully adds an active variant with active price", async () => {
      const mockVariant = {
        id: "var-1",
        sku: "SKU-PRO-1",
        name: "Pro",
        status: VariantStatus.ACTIVE,
        product: {
          id: "prod-1",
          status: ProductStatus.ACTIVE,
        },
        prices: [
          {
            id: "price-1",
            currency: Currency.USD,
            amount: 2900,
            isActive: true,
          },
        ],
      };

      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue(
        mockVariant,
      );
      (prisma.cart.findFirst as jest.Mock).mockResolvedValue({
        id: "cart-1",
        userId: "user-1",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (prisma.cartItem.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.cartItem.upsert as jest.Mock).mockResolvedValue({});
      (prisma.cartItem.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.addItem("user-1", {
        variantId: "var-1",
        quantity: 1,
        currency: Currency.USD,
      });

      expect(prisma.cartItem.upsert).toHaveBeenCalledWith({
        where: {
          cartId_variantId: {
            cartId: "cart-1",
            variantId: "var-1",
          },
        },
        update: {
          quantity: 1,
          priceId: "price-1",
        },
        create: {
          cartId: "cart-1",
          variantId: "var-1",
          priceId: "price-1",
          quantity: 1,
        },
      });
      expect(result.id).toBe("cart-1");
    });

    it("rejects when variant is inactive or not found", async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue({
        id: "var-draft",
        status: VariantStatus.DRAFT,
      });

      await expect(
        service.addItem("user-1", {
          variantId: "var-draft",
          quantity: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects when product is inactive", async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue({
        id: "var-1",
        status: VariantStatus.ACTIVE,
        product: {
          id: "prod-draft",
          status: ProductStatus.DRAFT,
        },
        prices: [{ currency: Currency.USD, isActive: true, amount: 1000 }],
      });

      await expect(
        service.addItem("user-1", {
          variantId: "var-1",
          quantity: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects when active price for currency does not exist", async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue({
        id: "var-1",
        status: VariantStatus.ACTIVE,
        product: {
          id: "prod-1",
          status: ProductStatus.ACTIVE,
        },
        prices: [], // No active USD price
      });

      await expect(
        service.addItem("user-1", {
          variantId: "var-1",
          quantity: 1,
          currency: Currency.USD,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("ownership enforcement", () => {
    it("forbids updating item belonging to another user's cart", async () => {
      (prisma.cart.findFirst as jest.Mock).mockResolvedValue({
        id: "user1-cart",
        userId: "user-1",
        status: "ACTIVE",
      });

      (prisma.cartItem.findUnique as jest.Mock).mockResolvedValue({
        id: "item-99",
        cartId: "user2-cart",
        cart: {
          id: "user2-cart",
          userId: "user-2", // Belongs to user-2!
        },
      });

      await expect(service.updateItem("user-1", "item-99", 5)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("forbids removing item belonging to another user's cart", async () => {
      (prisma.cart.findFirst as jest.Mock).mockResolvedValue({
        id: "user1-cart",
        userId: "user-1",
        status: "ACTIVE",
      });

      (prisma.cartItem.findUnique as jest.Mock).mockResolvedValue({
        id: "item-99",
        cartId: "user2-cart",
        cart: {
          id: "user2-cart",
          userId: "user-2",
        },
      });

      await expect(service.removeItem("user-1", "item-99")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
