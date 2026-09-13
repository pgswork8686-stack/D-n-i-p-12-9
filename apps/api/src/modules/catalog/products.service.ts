import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  Product,
  ProductVariant,
  ProductPrice,
  ProductStatus,
  VariantStatus,
  ProductType,
  CategoryStatus,
  Currency,
  BillingType,
  BillingInterval,
} from "@nexus/database";
import {
  PublicProductListItemDto,
  PublicProductDetailDto,
  PaginatedResponse,
} from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import {
  CreateProductDto,
  UpdateProductDto,
  CreateVariantDto,
  UpdateVariantDto,
  CreatePriceDto,
  UpdatePriceDto,
  CatalogFilterQueryDto,
  AdminProductFilterQueryDto,
} from "./dto/catalog.dto";

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly auditService: AuditService) {}

  // ==========================================
  // ADMIN PRODUCT OPERATIONS (Atomic Transactions)
  // ==========================================

  async createProduct(
    dto: CreateProductDto,
    actorId: string,
    userPermissions: string[] = [],
  ): Promise<Product> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({
        where: { slug: dto.slug },
      });
      if (existing) {
        throw new ConflictException(`Product with slug '${dto.slug}' already exists`);
      }

      if (dto.status === ProductStatus.ACTIVE) {
        const canPublish =
          userPermissions.includes("product.publish") ||
          userPermissions.includes("*");
        if (!canPublish) {
          throw new ForbiddenException(
            "Publishing products to ACTIVE status requires 'product.publish' permission",
          );
        }
      }

      if (dto.categoryIds && dto.categoryIds.length > 0) {
        const count = await tx.category.count({
          where: { id: { in: dto.categoryIds } },
        });
        if (count !== dto.categoryIds.length) {
          throw new BadRequestException("One or more category IDs are invalid");
        }
      }

      const product = await tx.product.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          shortDescription: dto.shortDescription || null,
          description: dto.description || null,
          productType: dto.productType,
          fulfillmentType: dto.fulfillmentType,
          status: dto.status ?? ProductStatus.DRAFT,
          brand: dto.brand || null,
          metadata: dto.metadata || {},
          ...(dto.categoryIds && dto.categoryIds.length > 0
            ? {
                categories: {
                  create: dto.categoryIds.map((cId) => ({ categoryId: cId })),
                },
              }
            : {}),
        },
        include: {
          categories: { include: { category: true } },
          variants: { include: { prices: true } },
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "PRODUCT_CREATED",
        entity: "Product",
        entityId: product.id,
        actorId,
        details: { slug: product.slug, name: product.name, status: product.status },
      });

      return product;
    });
  }

  async getProductById(id: string): Promise<any> {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        categories: { include: { category: true } },
        variants: {
          include: {
            prices: { orderBy: { amount: "asc" } },
            licensePlan: true,
          },
          orderBy: { sortOrder: "asc" },
        },
        media: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!product) {
      throw new NotFoundException(`Product with ID '${id}' not found`);
    }
    return product;
  }

  async getProductBySlug(slug: string): Promise<any> {
    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        categories: { include: { category: true } },
        variants: {
          include: {
            prices: { orderBy: { amount: "asc" } },
            licensePlan: true,
          },
          orderBy: { sortOrder: "asc" },
        },
        media: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!product) {
      throw new NotFoundException(`Product with slug '${slug}' not found`);
    }
    return product;
  }

  async updateProduct(
    id: string,
    dto: UpdateProductDto,
    actorId: string,
    userPermissions: string[] = [],
  ): Promise<Product> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`Product with ID '${id}' not found`);
      }

      if (dto.slug && dto.slug !== existing.slug) {
        const conflict = await tx.product.findUnique({
          where: { slug: dto.slug },
        });
        if (conflict) {
          throw new ConflictException(`Product with slug '${dto.slug}' already exists`);
        }
      }

      if (dto.status === ProductStatus.ACTIVE && existing.status !== ProductStatus.ACTIVE) {
        const canPublish =
          userPermissions.includes("product.publish") ||
          userPermissions.includes("*");
        if (!canPublish) {
          throw new ForbiddenException(
            "Publishing products to ACTIVE status requires 'product.publish' permission",
          );
        }
      }

      if (dto.categoryIds) {
        if (dto.categoryIds.length > 0) {
          const count = await tx.category.count({
            where: { id: { in: dto.categoryIds } },
          });
          if (count !== dto.categoryIds.length) {
            throw new BadRequestException("One or more category IDs are invalid");
          }
        }

        await tx.productCategory.deleteMany({
          where: { productId: id },
        });

        if (dto.categoryIds.length > 0) {
          await tx.productCategory.createMany({
            data: dto.categoryIds.map((cId) => ({
              productId: id,
              categoryId: cId,
            })),
          });
        }
      }

      const updated = await tx.product.update({
        where: { id },
        data: {
          ...(dto.slug !== undefined && { slug: dto.slug }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.shortDescription !== undefined && { shortDescription: dto.shortDescription }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.productType !== undefined && { productType: dto.productType }),
          ...(dto.fulfillmentType !== undefined && { fulfillmentType: dto.fulfillmentType }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.brand !== undefined && { brand: dto.brand }),
          ...(dto.metadata !== undefined && { metadata: dto.metadata }),
        },
        include: {
          categories: { include: { category: true } },
          variants: { include: { prices: true } },
          media: true,
        },
      });

      let action = "PRODUCT_UPDATED";
      if (dto.status === ProductStatus.ACTIVE && existing.status !== ProductStatus.ACTIVE) {
        action = "PRODUCT_PUBLISHED";
      } else if (dto.status === ProductStatus.ARCHIVED && existing.status !== ProductStatus.ARCHIVED) {
        action = "PRODUCT_ARCHIVED";
      }

      await this.auditService.logActionWithClient(tx, {
        action,
        entity: "Product",
        entityId: id,
        actorId,
        details: { changes: dto },
      });

      return updated;
    });
  }

  async deleteProduct(id: string, actorId: string): Promise<Product> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`Product with ID '${id}' not found`);
      }

      const archived = await tx.product.update({
        where: { id },
        data: { status: ProductStatus.ARCHIVED },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "PRODUCT_ARCHIVED",
        entity: "Product",
        entityId: id,
        actorId,
        details: { reason: "Soft-deleted by admin" },
      });

      return archived;
    });
  }

  async listAdminProducts(
    query: AdminProductFilterQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.productType) {
      where.productType = query.productType;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { slug: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: {
          categories: { include: { category: true } },
          variants: {
            include: {
              prices: { orderBy: { amount: "asc" } },
              licensePlan: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  // ==========================================
  // VARIANT OPERATIONS (Atomic Transactions)
  // ==========================================

  async createVariant(
    productId: string,
    dto: CreateVariantDto,
    actorId: string,
  ): Promise<ProductVariant> {
    return prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        throw new NotFoundException(`Product with ID '${productId}' not found`);
      }

      const skuConflict = await tx.productVariant.findUnique({
        where: { sku: dto.sku },
      });
      if (skuConflict) {
        throw new ConflictException(`Variant with SKU '${dto.sku}' already exists`);
      }

      if (dto.licensePlanId) {
        const plan = await tx.licensePlan.findUnique({
          where: { id: dto.licensePlanId },
        });
        if (!plan) {
          throw new BadRequestException(`LicensePlan with ID '${dto.licensePlanId}' not found`);
        }
      }

      const variant = await tx.productVariant.create({
        data: {
          productId,
          sku: dto.sku,
          name: dto.name,
          status: dto.status ?? VariantStatus.ACTIVE,
          sortOrder: dto.sortOrder ?? 0,
          metadata: dto.metadata || {},
          licensePlanId: dto.licensePlanId || null,
        },
        include: {
          prices: true,
          licensePlan: true,
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "VARIANT_CREATED",
        entity: "ProductVariant",
        entityId: variant.id,
        actorId,
        details: { productId, sku: variant.sku, name: variant.name },
      });

      return variant;
    });
  }

  async updateVariant(
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
    actorId: string,
  ): Promise<ProductVariant> {
    return prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
      });
      if (!variant || variant.productId !== productId) {
        throw new NotFoundException(`Variant with ID '${variantId}' not found on product '${productId}'`);
      }

      if (dto.sku && dto.sku !== variant.sku) {
        const skuConflict = await tx.productVariant.findUnique({
          where: { sku: dto.sku },
        });
        if (skuConflict) {
          throw new ConflictException(`Variant with SKU '${dto.sku}' already exists`);
        }
      }

      if (dto.licensePlanId) {
        const plan = await tx.licensePlan.findUnique({
          where: { id: dto.licensePlanId },
        });
        if (!plan) {
          throw new BadRequestException(`LicensePlan with ID '${dto.licensePlanId}' not found`);
        }
      }

      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: {
          ...(dto.sku !== undefined && { sku: dto.sku }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.metadata !== undefined && { metadata: dto.metadata }),
          ...(dto.licensePlanId !== undefined && { licensePlanId: dto.licensePlanId }),
        },
        include: {
          prices: true,
          licensePlan: true,
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "VARIANT_UPDATED",
        entity: "ProductVariant",
        entityId: variantId,
        actorId,
        details: { changes: dto },
      });

      return updated;
    });
  }

  async deleteVariant(
    productId: string,
    variantId: string,
    actorId: string,
  ): Promise<ProductVariant> {
    return prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
      });
      if (!variant || variant.productId !== productId) {
        throw new NotFoundException(`Variant with ID '${variantId}' not found on product '${productId}'`);
      }

      const archived = await tx.productVariant.update({
        where: { id: variantId },
        data: { status: VariantStatus.ARCHIVED },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "VARIANT_UPDATED",
        entity: "ProductVariant",
        entityId: variantId,
        actorId,
        details: { status: "ARCHIVED", reason: "Soft-deleted" },
      });

      return archived;
    });
  }

  // ==========================================
  // PRICE OPERATIONS (Atomic Transactions & Billing Consistency)
  // ==========================================

  async createPrice(
    variantId: string,
    dto: CreatePriceDto,
    actorId: string,
  ): Promise<ProductPrice> {
    if (dto.amount < 0 || !Number.isInteger(dto.amount)) {
      throw new BadRequestException("Price amount must be a non-negative integer");
    }

    const billingType = dto.billingType || BillingType.ONE_TIME;
    if (billingType === BillingType.RECURRING && !dto.billingInterval) {
      throw new BadRequestException(
        "billingInterval is required when billingType is RECURRING",
      );
    }
    if (billingType === BillingType.ONE_TIME && dto.billingInterval) {
      throw new BadRequestException(
        "billingInterval must be null when billingType is ONE_TIME",
      );
    }

    return prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
      });
      if (!variant) {
        throw new NotFoundException(`Variant with ID '${variantId}' not found`);
      }

      const price = await tx.productPrice.create({
        data: {
          variantId,
          currency: dto.currency,
          amount: dto.amount,
          compareAtAmount: dto.compareAtAmount || null,
          billingType,
          billingInterval: billingType === BillingType.ONE_TIME ? null : dto.billingInterval || null,
          isActive: dto.isActive ?? true,
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "PRICE_CREATED",
        entity: "ProductPrice",
        entityId: price.id,
        actorId,
        details: {
          variantId,
          currency: price.currency,
          amount: price.amount,
          billingType: price.billingType,
        },
      });

      return price;
    });
  }

  async updatePrice(
    priceId: string,
    dto: UpdatePriceDto,
    actorId: string,
  ): Promise<ProductPrice> {
    if (dto.amount !== undefined && (dto.amount < 0 || !Number.isInteger(dto.amount))) {
      throw new BadRequestException("Price amount must be a non-negative integer");
    }

    return prisma.$transaction(async (tx) => {
      const price = await tx.productPrice.findUnique({
        where: { id: priceId },
      });
      if (!price) {
        throw new NotFoundException(`Price with ID '${priceId}' not found`);
      }

      const effectiveBillingType = dto.billingType ?? price.billingType;
      let finalBillingInterval: BillingInterval | null | undefined =
        dto.billingInterval !== undefined ? dto.billingInterval : price.billingInterval;

      if (effectiveBillingType === BillingType.ONE_TIME) {
        if (dto.billingInterval) {
          throw new BadRequestException(
            "billingInterval must be null when billingType is ONE_TIME",
          );
        }
        finalBillingInterval = null; // Clean interval to null when switching to ONE_TIME
      } else if (effectiveBillingType === BillingType.RECURRING) {
        if (!finalBillingInterval) {
          throw new BadRequestException(
            "billingInterval is required when billingType is RECURRING",
          );
        }
      }

      const updated = await tx.productPrice.update({
        where: { id: priceId },
        data: {
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.compareAtAmount !== undefined && { compareAtAmount: dto.compareAtAmount }),
          ...(dto.billingType !== undefined && { billingType: dto.billingType }),
          billingInterval: finalBillingInterval,
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "PRICE_UPDATED",
        entity: "ProductPrice",
        entityId: priceId,
        actorId,
        details: { changes: dto },
      });

      return updated;
    });
  }

  // ==========================================
  // PUBLIC CATALOG OPERATIONS (Sanitized & Multi-Currency Isolated)
  // ==========================================

  async listPublicProducts(
    query: CatalogFilterQueryDto,
  ): Promise<PaginatedResponse<PublicProductListItemDto>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const targetCurrency: Currency = query.currency || Currency.USD;

    const where: any = {
      status: ProductStatus.ACTIVE,
    };

    if (query.productType) {
      where.productType = query.productType;
    }

    if (query.category) {
      where.categories = {
        some: {
          category: {
            slug: query.category,
            status: CategoryStatus.ACTIVE,
          },
        },
      };
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { shortDescription: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
      ];
    }

    // If sorting by price, sort in-memory per target currency context to NEVER compare cross-currency
    if (query.sort === "price_asc" || query.sort === "price_desc") {
      const allMatching = await prisma.product.findMany({
        where,
        include: {
          categories: {
            include: { category: true },
          },
          variants: {
            where: { status: VariantStatus.ACTIVE },
            include: {
              prices: {
                where: { isActive: true },
                orderBy: { amount: "asc" },
              },
            },
          },
          media: {
            where: { type: "THUMBNAIL" },
            take: 1,
          },
        },
      });

      const withMinPrice = allMatching.map((p) => {
        let minInTarget: number | null = null;
        const minPricesByCurrency: Partial<Record<Currency, number>> = {};

        for (const v of p.variants) {
          for (const pr of v.prices) {
            if (pr.isActive) {
              if (
                minPricesByCurrency[pr.currency] === undefined ||
                pr.amount < minPricesByCurrency[pr.currency]!
              ) {
                minPricesByCurrency[pr.currency] = pr.amount;
              }
              if (pr.currency === targetCurrency) {
                if (minInTarget === null || pr.amount < minInTarget) {
                  minInTarget = pr.amount;
                }
              }
            }
          }
        }

        const item: PublicProductListItemDto = {
          id: p.id,
          slug: p.slug,
          name: p.name,
          shortDescription: p.shortDescription,
          productType: p.productType as any,
          fulfillmentType: p.fulfillmentType as any,
          brand: p.brand,
          minPrice:
            minInTarget !== null
              ? { currency: targetCurrency, amount: minInTarget }
              : null,
          minPricesByCurrency,
          thumbnailUrl: p.media[0]?.url || null,
          categories: p.categories
            .filter((c) => c.category.status === CategoryStatus.ACTIVE)
            .map((c) => ({
              id: c.category.id,
              name: c.category.name,
              slug: c.category.slug,
            })),
        };

        return { item, sortAmount: minInTarget };
      });

      withMinPrice.sort((a, b) => {
        if (a.sortAmount === null && b.sortAmount === null) return 0;
        if (a.sortAmount === null) return 1;
        if (b.sortAmount === null) return -1;
        return query.sort === "price_asc"
          ? a.sortAmount - b.sortAmount
          : b.sortAmount - a.sortAmount;
      });

      const total = withMinPrice.length;
      const items = withMinPrice.slice(skip, skip + limit).map((x) => x.item);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // Standard ordering (newest or name_asc)
    let orderBy: any = { createdAt: "desc" };
    if (query.sort === "name_asc") {
      orderBy = { name: "asc" };
    }

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          categories: {
            include: { category: true },
          },
          variants: {
            where: { status: VariantStatus.ACTIVE },
            include: {
              prices: {
                where: { isActive: true },
                orderBy: { amount: "asc" },
              },
            },
          },
          media: {
            where: { type: "THUMBNAIL" },
            take: 1,
          },
        },
      }),
    ]);

    const items: PublicProductListItemDto[] = products.map((p) => {
      let minInTarget: number | null = null;
      const minPricesByCurrency: Partial<Record<Currency, number>> = {};

      for (const v of p.variants) {
        for (const pr of v.prices) {
          if (pr.isActive) {
            if (
              minPricesByCurrency[pr.currency] === undefined ||
              pr.amount < minPricesByCurrency[pr.currency]!
            ) {
              minPricesByCurrency[pr.currency] = pr.amount;
            }
            if (pr.currency === targetCurrency) {
              if (minInTarget === null || pr.amount < minInTarget) {
                minInTarget = pr.amount;
              }
            }
          }
        }
      }

      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        shortDescription: p.shortDescription,
        productType: p.productType as any,
        fulfillmentType: p.fulfillmentType as any,
        brand: p.brand,
        minPrice:
          minInTarget !== null
            ? { currency: targetCurrency, amount: minInTarget }
            : null,
        minPricesByCurrency,
        thumbnailUrl: p.media[0]?.url || null,
        categories: p.categories
          .filter((c) => c.category.status === CategoryStatus.ACTIVE)
          .map((c) => ({
            id: c.category.id,
            name: c.category.name,
            slug: c.category.slug,
          })),
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getPublicProductBySlug(slug: string): Promise<PublicProductDetailDto> {
    const product = await prisma.product.findFirst({
      where: {
        slug,
        status: ProductStatus.ACTIVE,
      },
      include: {
        categories: {
          include: {
            category: true,
          },
        },
        variants: {
          where: { status: VariantStatus.ACTIVE },
          orderBy: { sortOrder: "asc" },
          include: {
            prices: {
              where: { isActive: true },
              orderBy: { amount: "asc" },
            },
            licensePlan: true,
          },
        },
        media: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with slug '${slug}' not found`);
    }

    // Sanitize response: do NOT expose metadata, storageKey, secrets
    // Exclude archived/non-active categories from public view
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      shortDescription: product.shortDescription,
      description: product.description,
      productType: product.productType as any,
      fulfillmentType: product.fulfillmentType as any,
      brand: product.brand,
      variants: product.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        sortOrder: v.sortOrder,
        licensePlan: v.licensePlan
          ? {
              name: v.licensePlan.name,
              maxActivations: v.licensePlan.maxActivations,
              isLifetime: v.licensePlan.isLifetime,
              durationDays: v.licensePlan.durationDays,
            }
          : null,
        prices: v.prices.map((pr) => ({
          id: pr.id,
          currency: pr.currency as any,
          amount: pr.amount,
          compareAtAmount: pr.compareAtAmount,
          billingType: pr.billingType as any,
          billingInterval: pr.billingInterval as any,
        })),
      })),
      categories: product.categories
        .filter((c) => c.category.status === CategoryStatus.ACTIVE)
        .map((c) => ({
          id: c.category.id,
          name: c.category.name,
          slug: c.category.slug,
        })),
      media: product.media.map((m) => ({
        id: m.id,
        type: m.type as any,
        url: m.url,
        altText: m.altText,
      })),
    };
  }
}
