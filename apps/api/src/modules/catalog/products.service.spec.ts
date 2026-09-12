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
  Currency,
  BillingType,
} from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
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
  // PRODUCT CRUD & AUDIT TESTS
  // ====================================================

  describe("createProduct", () => {
    const validDto: any = {
      slug: "nexus-plugin-pro",
      name: "Nexus Plugin Pro",
      productType: ProductType.LICENSED_SOFTWARE,
      fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
      status: ProductStatus.DRAFT,
    };

    it("creates product and logs PRODUCT_CREATED audit", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.product.create as jest.Mock).mockResolvedValueOnce({
        id: "prod_1",
        ...validDto,
      });

      const result = await service.createProduct(validDto, "admin_user_id", ["product.write"]);

      expect(result.id).toBe("prod_1");
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PRODUCT_CREATED",
          entity: "Product",
          entityId: "prod_1",
          actorId: "admin_user_id",
        }),
      );
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
        service.createProduct(activeDto, "admin_user_id", ["product.write"]), // lacks product.publish
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
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PRODUCT_PUBLISHED",
          entity: "Product",
          entityId: "prod_1",
          actorId: "admin_user_id",
        }),
      );
    });

    it("rejects publishing to ACTIVE if lacking 'product.publish' permission", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(existingProduct);

      await expect(
        service.updateProduct(
          "prod_1",
          { status: ProductStatus.ACTIVE },
          "admin_user_id",
          ["product.write"], // lacks product.publish
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("archives product and logs PRODUCT_ARCHIVED", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
        ...existingProduct,
        status: ProductStatus.ACTIVE,
      });
      (prisma.product.update as jest.Mock).mockResolvedValueOnce({
        ...existingProduct,
        status: ProductStatus.ARCHIVED,
      });

      const result = await service.updateProduct(
        "prod_1",
        { status: ProductStatus.ARCHIVED },
        "admin_user_id",
        ["product.write"],
      );

      expect(result.status).toBe(ProductStatus.ARCHIVED);
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PRODUCT_ARCHIVED",
          entity: "Product",
          entityId: "prod_1",
          actorId: "admin_user_id",
        }),
      );
    });

    it("logs PRODUCT_UPDATED for non-status changes", async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(existingProduct);
      (prisma.product.update as jest.Mock).mockResolvedValueOnce({
        ...existingProduct,
        name: "Elementor Pro Updated",
      });

      await service.updateProduct(
        "prod_1",
        { name: "Elementor Pro Updated" },
        "admin_user_id",
        ["product.write"],
      );

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PRODUCT_UPDATED",
          entity: "Product",
          entityId: "prod_1",
        }),
      );
    });
  });

  // ====================================================
  // VARIANT CRUD & AUDIT TESTS
  // ====================================================

  describe("Variant CRUD", () => {
    it("creates variant and logs VARIANT_CREATED", async () => {
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
      expect(auditService.logAction).toHaveBeenCalledWith(
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
  // PRICE CRUD & VALIDATION TESTS
  // ====================================================

  describe("Price CRUD", () => {
    it("creates price and logs PRICE_CREATED", async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValueOnce({ id: "var_1" });
      (prisma.productPrice.create as jest.Mock).mockResolvedValueOnce({
        id: "price_1",
        variantId: "var_1",
        currency: Currency.VND,
        amount: 299000,
        billingType: BillingType.ONE_TIME,
        isActive: true,
      });

      const result = await service.createPrice(
        "var_1",
        { currency: Currency.VND, amount: 299000 },
        "admin_user_id",
      );

      expect(result.id).toBe("price_1");
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PRICE_CREATED",
          entity: "ProductPrice",
          entityId: "price_1",
        }),
      );
    });

    it("rejects negative amount with BadRequestException", async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValueOnce({ id: "var_1" });

      await expect(
        service.createPrice(
          "var_1",
          { currency: Currency.VND, amount: -1000 },
          "admin_user_id",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects non-integer amount with BadRequestException", async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValueOnce({ id: "var_1" });

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
  // PUBLIC CATALOG VISIBILITY & SANITIZATION TESTS
  // ====================================================

  describe("Public Catalog Visibility & Sanitization", () => {
    it("listPublicProducts filters strictly by ProductStatus.ACTIVE and VariantStatus.ACTIVE", async () => {
      (prisma.product.count as jest.Mock).mockResolvedValueOnce(1);
      (prisma.product.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "prod_active",
          slug: "active-product",
          name: "Active Product",
          shortDescription: "Description",
          productType: ProductType.DOWNLOADABLE_ASSET,
          fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
          brand: "Nexus",
          categories: [{ category: { id: "c1", name: "Design", slug: "design" } }],
          variants: [
            {
              id: "v1",
              sku: "V1",
              name: "Standard",
              status: VariantStatus.ACTIVE,
              prices: [{ currency: Currency.VND, amount: 199000, isActive: true }],
            },
          ],
          media: [{ url: "https://example.com/thumb.png", type: "THUMBNAIL" }],
        },
      ]);

      const result = await service.listPublicProducts({});

      // Verify Prisma query specified status: ACTIVE
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: ProductStatus.ACTIVE,
          }),
        }),
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0].slug).toBe("active-product");
      expect(result.items[0].minPrice).toEqual({ currency: Currency.VND, amount: 199000 });
      expect(result.items[0].thumbnailUrl).toBe("https://example.com/thumb.png");
    });

    it("getPublicProductBySlug returns 404 for DRAFT or ARCHIVED products", async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValueOnce(null); // findFirst filters status: ACTIVE

      await expect(service.getPublicProductBySlug("draft-product")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("getPublicProductBySlug returns sanitized data and hides sensitive internal fields", async () => {
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
        metadata: {
          internalSecret: "SECRET_TOKEN_DO_NOT_EXPOSE",
          providerCredentials: "SUPER_SECRET_KEY",
        },
        categories: [{ category: { id: "c1", name: "WordPress", slug: "wordpress" } }],
        variants: [
          {
            id: "v1",
            sku: "ELE-PRO-1SITE",
            name: "1 Website",
            sortOrder: 1,
            metadata: { internalVariantCode: "SECRET_CODE" },
            licensePlan: {
              id: "lp1",
              name: "1 Site Plan",
              maxActivations: 1,
              isLifetime: false,
              durationDays: 365,
              metadata: { secretPlanNote: "hidden" },
            },
            prices: [
              {
                id: "pr1",
                currency: Currency.VND,
                amount: 299000,
                compareAtAmount: null,
                billingType: BillingType.ONE_TIME,
                billingInterval: null,
              },
            ],
          },
        ],
        media: [
          {
            id: "m1",
            type: "IMAGE",
            url: "https://example.com/image.png",
            storageKey: "internal-s3-key-private.png", // Must not be leaked
            altText: "Banner",
          },
        ],
      });

      const result = await service.getPublicProductBySlug("elementor-pro");

      expect(result.slug).toBe("elementor-pro");
      // Verify internal metadata is NOT present on product
      expect((result as any).metadata).toBeUndefined();
      // Verify internal metadata is NOT present on variant
      expect((result.variants[0] as any).metadata).toBeUndefined();
      // Verify internal storageKey is NOT present on media
      expect((result.media[0] as any).storageKey).toBeUndefined();
      // Safe fields ARE present
      expect(result.variants[0].licensePlan?.name).toBe("1 Site Plan");
      expect(result.variants[0].licensePlan?.maxActivations).toBe(1);
    });
  });
});
