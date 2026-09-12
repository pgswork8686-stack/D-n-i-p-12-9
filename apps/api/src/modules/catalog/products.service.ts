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
} from "./dto/catalog.dto";

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly auditService: AuditService) {}

  // ==========================================
  // ADMIN PRODUCT OPERATIONS
  // ==========================================

  async createProduct(
    dto: CreateProductDto,
    actorId: string,
    userPermissions: string[] = [],
  ): Promise<Product> {
    const existing = await prisma.product.findUnique({
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
      const count = await prisma.category.count({
        where: { id: { in: dto.categoryIds } },
      });
      if (count !== dto.categoryIds.length) {
        throw new BadRequestException("One or more category IDs are invalid");
      }
    }

    const product = await prisma.product.create({
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

    await this.auditService.logAction({
      action: "PRODUCT_CREATED",
      entity: "Product",
      entityId: product.id,
      actorId,
      details: { slug: product.slug, name: product.name, status: product.status },
    });

    return product;
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
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product with ID '${id}' not found`);
    }

    if (dto.slug && dto.slug !== existing.slug) {
      const conflict = await prisma.product.findUnique({
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
        const count = await prisma.category.count({
          where: { id: { in: dto.categoryIds } },
        });
        if (count !== dto.categoryIds.length) {
          throw new BadRequestException("One or more category IDs are invalid");
        }
      }

      await prisma.productCategory.deleteMany({
        where: { productId: id },
      });

      if (dto.categoryIds.length > 0) {
        await prisma.productCategory.createMany({
          data: dto.categoryIds.map((cId) => ({
            productId: id,
            categoryId: cId,
          })),
        });
      }
    }

    const updated = await prisma.product.update({
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

    await this.auditService.logAction({
      action,
      entity: "Product",
      entityId: id,
      actorId,
      details: { changes: dto },
    });

    return updated;
  }

  async deleteProduct(id: string, actorId: string): Promise<Product> {
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product with ID '${id}' not found`);
    }

    const archived = await prisma.product.update({
      where: { id },
      data: { status: ProductStatus.ARCHIVED },
    });

    await this.auditService.logAction({
      action: "PRODUCT_ARCHIVED",
      entity: "Product",
      entityId: id,
      actorId,
      details: { reason: "Soft-deleted by admin" },
    });

    return archived;
  }

  async listAdminProducts(query: {
    page?: number;
    limit?: number;
    status?: ProductStatus;
    productType?: ProductType;
    search?: string;
  }): Promise<PaginatedResponse<any>> {
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
  // VARIANT OPERATIONS
  // ==========================================

  async createVariant(
    productId: string,
    dto: CreateVariantDto,
    actorId: string,
  ): Promise<ProductVariant> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException(`Product with ID '${productId}' not found`);
    }

    const skuConflict = await prisma.productVariant.findUnique({
      where: { sku: dto.sku },
    });
    if (skuConflict) {
      throw new ConflictException(`Variant with SKU '${dto.sku}' already exists`);
    }

    if (dto.licensePlanId) {
      const plan = await prisma.licensePlan.findUnique({
        where: { id: dto.licensePlanId },
      });
      if (!plan) {
        throw new BadRequestException(`LicensePlan with ID '${dto.licensePlanId}' not found`);
      }
    }

    const variant = await prisma.productVariant.create({
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

    await this.auditService.logAction({
      action: "VARIANT_CREATED",
      entity: "ProductVariant",
      entityId: variant.id,
      actorId,
      details: { productId, sku: variant.sku, name: variant.name },
    });

    return variant;
  }

  async updateVariant(
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
    actorId: string,
  ): Promise<ProductVariant> {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant || variant.productId !== productId) {
      throw new NotFoundException(`Variant with ID '${variantId}' not found on product '${productId}'`);
    }

    if (dto.sku && dto.sku !== variant.sku) {
      const skuConflict = await prisma.productVariant.findUnique({
        where: { sku: dto.sku },
      });
      if (skuConflict) {
        throw new ConflictException(`Variant with SKU '${dto.sku}' already exists`);
      }
    }

    if (dto.licensePlanId) {
      const plan = await prisma.licensePlan.findUnique({
        where: { id: dto.licensePlanId },
      });
      if (!plan) {
        throw new BadRequestException(`LicensePlan with ID '${dto.licensePlanId}' not found`);
      }
    }

    const updated = await prisma.productVariant.update({
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

    await this.auditService.logAction({
      action: "VARIANT_UPDATED",
      entity: "ProductVariant",
      entityId: variantId,
      actorId,
      details: { changes: dto },
    });

    return updated;
  }

  async deleteVariant(
    productId: string,
    variantId: string,
    actorId: string,
  ): Promise<ProductVariant> {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant || variant.productId !== productId) {
      throw new NotFoundException(`Variant with ID '${variantId}' not found on product '${productId}'`);
    }

    const archived = await prisma.productVariant.update({
      where: { id: variantId },
      data: { status: VariantStatus.ARCHIVED },
    });

    await this.auditService.logAction({
      action: "VARIANT_UPDATED",
      entity: "ProductVariant",
      entityId: variantId,
      actorId,
      details: { status: "ARCHIVED", reason: "Soft-deleted" },
    });

    return archived;
  }

  // ==========================================
  // PRICE OPERATIONS
  // ==========================================

  async createPrice(
    variantId: string,
    dto: CreatePriceDto,
    actorId: string,
  ): Promise<ProductPrice> {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant) {
      throw new NotFoundException(`Variant with ID '${variantId}' not found`);
    }

    if (dto.amount < 0 || !Number.isInteger(dto.amount)) {
      throw new BadRequestException("Price amount must be a non-negative integer");
    }

    const price = await prisma.productPrice.create({
      data: {
        variantId,
        currency: dto.currency,
        amount: dto.amount,
        compareAtAmount: dto.compareAtAmount || null,
        billingType: dto.billingType || "ONE_TIME",
        billingInterval: dto.billingInterval || null,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditService.logAction({
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
  }

  async updatePrice(
    priceId: string,
    dto: UpdatePriceDto,
    actorId: string,
  ): Promise<ProductPrice> {
    const price = await prisma.productPrice.findUnique({
      where: { id: priceId },
    });
    if (!price) {
      throw new NotFoundException(`Price with ID '${priceId}' not found`);
    }

    if (dto.amount !== undefined && (dto.amount < 0 || !Number.isInteger(dto.amount))) {
      throw new BadRequestException("Price amount must be a non-negative integer");
    }

    const updated = await prisma.productPrice.update({
      where: { id: priceId },
      data: {
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.compareAtAmount !== undefined && { compareAtAmount: dto.compareAtAmount }),
        ...(dto.billingType !== undefined && { billingType: dto.billingType }),
        ...(dto.billingInterval !== undefined && { billingInterval: dto.billingInterval }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditService.logAction({
      action: "PRICE_UPDATED",
      entity: "ProductPrice",
      entityId: priceId,
      actorId,
      details: { changes: dto },
    });

    return updated;
  }

  // ==========================================
  // PUBLIC CATALOG OPERATIONS (Sanitized)
  // ==========================================

  async listPublicProducts(
    query: CatalogFilterQueryDto,
  ): Promise<PaginatedResponse<PublicProductListItemDto>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

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
            status: "ACTIVE",
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
            include: {
              category: true,
            },
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
      // Find lowest active price
      let minPrice: { currency: any; amount: number } | null = null;
      for (const v of p.variants) {
        for (const pr of v.prices) {
          if (!minPrice || pr.amount < minPrice.amount) {
            minPrice = { currency: pr.currency, amount: pr.amount };
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
        minPrice,
        thumbnailUrl: p.media[0]?.url || null,
        categories: p.categories.map((c) => ({
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
      categories: product.categories.map((c) => ({
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
