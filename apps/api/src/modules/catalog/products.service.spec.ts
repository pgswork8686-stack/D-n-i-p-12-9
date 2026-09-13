import { Test, TestingModule } from "@nestjs/testing";
import {
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { ProductsService } from "./products.service";
import { AuditService } from "../audit/audit.service";
import {
  prisma,
  ProductStatus,
  VariantStatus,
  ProductType,
  FulfillmentType,
  CategoryStatus,
  Currency,
  BillingType,
  BillingInterval,
} from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      $transaction: jest.fn((cb) => cb(prisma)),
      product: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      productVariant: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      productPrice: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      category: {
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      productCategory: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      licensePlan: {
        findUnique: jest.fn(),
      },
    },
  };
});

describe("ProductsService", () => {
  let service: ProductsService;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockAuditService = {
      logAction: jest.fn().mockResolvedValue({}),
      logActionWithClient: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    auditService = module.get(AuditService);
  });

  // ====================================================
  // 1. PRODUCT CRUD & ATOMIC TRANSACTION TESTS
  // ====================================================

  describe("createProduct", () => {
    const validDto: any = {
      slug: "nexus-plugin-pro",
      name: "Nexus Plugin Pro",
      productType: ProductType.LICENSED_SOFTWARE,
      fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
      status: ProductStatus.DRAFT,
    };

    it("creates product atomically and logs PRODUCT_CREATED audit via tx client", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.product.create as jest.Mock).mockResolvedValueOnce({
        id: "prod_1",
        ...validDto,
      });

      const result = await service.createProduct(validDto, "admin_user_id", ["product.write"]);

      expect(result.id).toBe("prod_1");
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "PRODUCT_CREATED",
          entity: "Product",
          entityId: "prod_1",
          actorId: "admin_user_id",
        }),
      );
    });

    it("rolls back transaction when audit logging fails in createProduct", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.product.create as jest.Mock).mockResolvedValueOnce({
        id: "prod_1",
        ...validDto,
      });
      (auditService.logActionWithClient as jest.Mock).mockRejectedValueOnce(
        new Error("Audit write failed"),
      );

      await expect(
        service.createProduct(validDto, "admin_user_id", ["product.write"]),
      ).rejects.toThrow("Audit write failed");
    });

    it("rejects duplicate product slug with ConflictException", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "existing_prod",
        slug: "nexus-plugin-pro",
      });

      await expect(
        service.createProduct(validDto, "admin_user_id", ["product.write"]),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects creating ACTIVE product if user lacks 'product.publish' permission", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const activeDto = { ...validDto, status: ProductStatus.ACTIVE };

      await expect(
        service.createProduct(activeDto, "admin_user_id", ["product.write"]),
      ).rejects.toThrow(ForbiddenException);
    });

    it("allows creating ACTIVE product if user has 'product.publish' permission", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.product.create as jest.Mock).mockResolvedValueOnce({
        id: "prod_active",
        ...validDto,
        status: ProductStatus.ACTIVE,
      });

      const activeDto = { ...validDto, status: ProductStatus.ACTIVE };
      const result = await service.createProduct(activeDto, "admin_user_id", [
        "product.write",
        "product.publish",
      ]);

      expect(result.id).toBe("prod_active");
    });

    it("rejects invalid categoryIds with BadRequestException", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.category.count as jest.Mock).mockResolvedValueOnce(1); // 1 found out of 2 requested

      const dtoWithBadCats = {
        ...validDto,
        categoryIds: ["cat_1", "bad_cat"],
      };

      await expect(
        service.createProduct(dtoWithBadCats, "admin_user_id", ["product.write"]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateProduct", () => {
    const existingProduct: any = {
      id: "prod_1",
      slug: "elementor-pro",
      name: "Elementor Pro",
      status: ProductStatus.DRAFT,
      productType: ProductType.EXTERNAL_MANAGED_LICENSE,
      fulfillmentType: FulfillmentType.EXTERNAL_MANAGED,
    };

    it("publishes DRAFT to ACTIVE with 'product.publish' permission and logs PRODUCT_PUBLISHED", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(existingProduct);
      (prisma.product.update as jest.Mock).mockResolvedValueOnce({
        ...existingProduct,
        status: ProductStatus.ACTIVE,
      });

      const result = await service.updateProduct(
        "prod_1",
        { status: ProductStatus.ACTIVE },
        "admin_user_id",
        ["product.write", "product.publish"],
      );

      expect(result.status).toBe(ProductStatus.ACTIVE);
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "PRODUCT_PUBLISHED",
          entity: "Product",
          entityId: "prod_1",
          actorId: "admin_user_id",
        }),
      );
    });

    it("rolls back category sync and product update if category creation fails", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(existingProduct);
      (prisma.category.count as jest.Mock).mockResolvedValueOnce(1);
      (prisma.productCategory.deleteMany as jest.Mock).mockResolvedValueOnce({});
      (prisma.productCategory.createMany as jest.Mock).mockRejectedValueOnce(
        new Error("Category sync DB conflict"),
      );

      await expect(
        service.updateProduct(
          "prod_1",
          { categoryIds: ["cat_1"] },
          "admin_user_id",
          ["product.write"],
        ),
      ).rejects.toThrow("Category sync DB conflict");
    });
  });

  // ====================================================
  // 2. VARIANT CRUD & ATOMICTY TESTS
  // ====================================================

  describe("Variant CRUD", () => {
    it("creates variant atomically and logs VARIANT_CREATED via tx client", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({ id: "prod_1" });
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.productVariant.create as jest.Mock).mockResolvedValueOnce({
        id: "var_1",
        productId: "prod_1",
        sku: "ELE-PRO-1SITE",
        name: "1 Website",
        status: VariantStatus.ACTIVE,
      });

      const result = await service.createVariant(
        "prod_1",
        { sku: "ELE-PRO-1SITE", name: "1 Website" },
        "admin_user_id",
      );

      expect(result.id).toBe("var_1");
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "VARIANT_CREATED",
          entity: "ProductVariant",
          entityId: "var_1",
        }),
      );
    });

    it("rejects duplicate SKU with ConflictException", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({ id: "prod_1" });
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "existing_var",
        sku: "ELE-PRO-1SITE",
      });

      await expect(
        service.createVariant(
          "prod_1",
          { sku: "ELE-PRO-1SITE", name: "Duplicate" },
          "admin_user_id",
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ====================================================
  // 3. PRICE VALIDATION & BILLING CONSISTENCY TESTS
  // ====================================================

  describe("Price Validation & Billing Consistency", () => {
    it("creates price and logs PRICE_CREATED via tx client", async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValueOnce({ id: "var_1" });
      (prisma.productPrice.create as jest.Mock).mockResolvedValueOnce({
        id: "price_1",
        variantId: "var_1",
        currency: Currency.VND,
        amount: 299000,
        billingType: BillingType.ONE_TIME,
        billingInterval: null,
        isActive: true,
      });

      const result = await service.createPrice(
        "var_1",
        { currency: Currency.VND, amount: 299000, billingType: BillingType.ONE_TIME },
        "admin_user_id",
      );

      expect(result.id).toBe("price_1");
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "PRICE_CREATED",
          entity: "ProductPrice",
          entityId: "price_1",
        }),
      );
    });

    it("rejects RECURRING price without billingInterval with BadRequestException", async () => {
      await expect(
        service.createPrice(
          "var_1",
          { currency: Currency.USD, amount: 1200, billingType: BillingType.RECURRING }, // missing interval
          "admin_user_id",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects ONE_TIME price with billingInterval with BadRequestException", async () => {
      await expect(
        service.createPrice(
          "var_1",
          {
            currency: Currency.USD,
            amount: 1200,
            billingType: BillingType.ONE_TIME,
            billingInterval: BillingInterval.MONTHLY,
          },
          "admin_user_id",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("clears billingInterval to null when updating from RECURRING to ONE_TIME", async () => {
      (prisma.productPrice.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "pr_recurring",
        billingType: BillingType.RECURRING,
        billingInterval: BillingInterval.MONTHLY,
      });
      (prisma.productPrice.update as jest.Mock).mockResolvedValueOnce({
        id: "pr_recurring",
        billingType: BillingType.ONE_TIME,
        billingInterval: null,
      });

      await service.updatePrice(
        "pr_recurring",
        { billingType: BillingType.ONE_TIME },
        "admin_user_id",
      );

      expect(prisma.productPrice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            billingType: BillingType.ONE_TIME,
            billingInterval: null,
          }),
        }),
      );
    });

    it("rejects negative amount with BadRequestException", async () => {
      await expect(
        service.createPrice(
          "var_1",
          { currency: Currency.VND, amount: -1000 },
          "admin_user_id",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects non-integer amount with BadRequestException", async () => {
      await expect(
        service.createPrice(
          "var_1",
          { currency: Currency.VND, amount: 299.5 },
          "admin_user_id",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ====================================================
  // 4. MULTI-CURRENCY ISOLATION & REGRESSION TESTS
  // ====================================================

  describe("Multi-Currency Isolation (Never Raw-Compare VND and USD)", () => {
    const dualCurrencyProduct: any = {
      id: "prod_dual",
      slug: "dual-currency-plugin",
      name: "Dual Currency Plugin",
      shortDescription: "Description",
      productType: ProductType.LICENSED_SOFTWARE,
      fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
      brand: "Nexus",
      categories: [{ category: { id: "c1", name: "WordPress", slug: "wordpress", status: CategoryStatus.ACTIVE } }],
      variants: [
        {
          id: "v1",
          sku: "DUAL-1",
          name: "Standard",
          status: VariantStatus.ACTIVE,
          prices: [
            { currency: Currency.USD, amount: 1200, isActive: true }, // $12.00 = 1200 cents
            { currency: Currency.VND, amount: 299000, isActive: true }, // 299,000 VND
          ],
        },
      ],
      media: [],
    };

    it("calculates minPrice strictly in requested currency context (VND)", async () => {
      (prisma.product.count as jest.Mock).mockResolvedValueOnce(1);
      (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([dualCurrencyProduct]);

      const result = await service.listPublicProducts({ currency: Currency.VND });

      expect(result.items[0].minPrice).toEqual({
        currency: Currency.VND,
        amount: 299000, // NOT 1200 USD raw-compared!
      });
      expect(result.items[0].minPricesByCurrency).toEqual({
        VND: 299000,
        USD: 1200,
      });
    });

    it("calculates minPrice strictly in requested currency context (USD)", async () => {
      (prisma.product.count as jest.Mock).mockResolvedValueOnce(1);
      (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([dualCurrencyProduct]);

      const result = await service.listPublicProducts({ currency: Currency.USD });

      expect(result.items[0].minPrice).toEqual({
        currency: Currency.USD,
        amount: 1200,
      });
    });

    it("sorts by price_asc strictly within the requested currency", async () => {
      const cheapUSDExpensiveVND: any = {
        id: "p1",
        slug: "p1",
        name: "P1",
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
        categories: [],
        media: [],
        variants: [
          {
            status: VariantStatus.ACTIVE,
            prices: [
              { currency: Currency.USD, amount: 1000, isActive: true }, // $10.00 (cheaper in USD)
              { currency: Currency.VND, amount: 500000, isActive: true }, // 500,000 VND (more expensive in VND)
            ],
          },
        ],
      };

      const expensiveUSDCheapVND: any = {
        id: "p2",
        slug: "p2",
        name: "P2",
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
        categories: [],
        media: [],
        variants: [
          {
            status: VariantStatus.ACTIVE,
            prices: [
              { currency: Currency.USD, amount: 2000, isActive: true }, // $20.00
              { currency: Currency.VND, amount: 200000, isActive: true }, // 200,000 VND
            ],
          },
        ],
      };

      (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([
        expensiveUSDCheapVND,
        cheapUSDExpensiveVND,
      ]);

      // When sorting by USD price_asc: p1 ($10) comes before p2 ($20)
      const resUSD = await service.listPublicProducts({
        currency: Currency.USD,
        sort: "price_asc",
      });
      expect(resUSD.items[0].slug).toBe("p1");
      expect(resUSD.items[1].slug).toBe("p2");

      (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([
        cheapUSDExpensiveVND,
        expensiveUSDCheapVND,
      ]);

      // When sorting by VND price_asc: p2 (200k) comes before p1 (500k)
      const resVND = await service.listPublicProducts({
        currency: Currency.VND,
        sort: "price_asc",
      });
      expect(resVND.items[0].slug).toBe("p2");
      expect(resVND.items[1].slug).toBe("p1");
    });
  });

  // ====================================================
  // 5. PUBLIC CATEGORY VISIBILITY & SANITIZATION TESTS
  // ====================================================

  describe("Public Category Visibility & Sanitization", () => {
    it("filters out ARCHIVED categories from public product list and detail", async () => {
      const productWithArchivedCat: any = {
        id: "p1",
        slug: "p1",
        name: "Product 1",
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
        categories: [
          { category: { id: "c1", name: "Active Cat", slug: "active-cat", status: CategoryStatus.ACTIVE } },
          { category: { id: "c2", name: "Archived Cat", slug: "archived-cat", status: CategoryStatus.ARCHIVED } },
        ],
        variants: [],
        media: [],
      };

      (prisma.product.count as jest.Mock).mockResolvedValueOnce(1);
      (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([productWithArchivedCat]);

      const listResult = await service.listPublicProducts({});
      expect(listResult.items[0].categories.length).toBe(1);
      expect(listResult.items[0].categories[0].slug).toBe("active-cat");

      (prisma.product.findFirst as jest.Mock).mockResolvedValueOnce(productWithArchivedCat);
      const detailResult = await service.getPublicProductBySlug("p1");
      expect(detailResult.categories.length).toBe(1);
      expect(detailResult.categories[0].slug).toBe("active-cat");
    });

    it("getPublicProductBySlug sanitizes metadata and storageKey", async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValueOnce({
        id: "prod_active",
        slug: "elementor-pro",
        name: "Elementor Pro",
        shortDescription: "Short",
        description: "Full desc",
        productType: ProductType.EXTERNAL_MANAGED_LICENSE,
        fulfillmentType: FulfillmentType.EXTERNAL_MANAGED,
        brand: "Elementor",
        status: ProductStatus.ACTIVE,
        metadata: { secret: "hidden" },
        categories: [],
        variants: [
          {
            id: "v1",
            sku: "ELE-1",
            name: "1 Site",
            sortOrder: 1,
            metadata: { secret: "hidden" },
            licensePlan: { name: "Plan 1", maxActivations: 1 },
            prices: [{ id: "pr1", currency: Currency.USD, amount: 1200, billingType: BillingType.ONE_TIME }],
          },
        ],
        media: [
          { id: "m1", type: "IMAGE", url: "https://example.com/img.png", storageKey: "secret-key" },
        ],
      });

      const result = await service.getPublicProductBySlug("elementor-pro");
      expect((result as any).metadata).toBeUndefined();
      expect((result.variants[0] as any).metadata).toBeUndefined();
      expect((result.media[0] as any).storageKey).toBeUndefined();
    });
  });
});
