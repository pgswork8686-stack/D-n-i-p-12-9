import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma, Prisma, ServicePricingMode, ServiceStatus } from "@nexus/database";
import { PaginatedList, ServiceDto } from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import { CreateServiceDto, QueryServiceListDto, UpdateServiceDto } from "./dto/services.dto";
import { toServiceDto } from "./services.mappers";

const SERVICE_INCLUDE = { product: { select: { id: true, slug: true, status: true } } } as const;

export interface ActorContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ServiceCatalogService {
  constructor(private readonly audit: AuditService) {}

  // ---------------------------------------------------------------- public

  async listPublic(): Promise<ServiceDto[]> {
    const rows = await prisma.service.findMany({
      where: { status: ServiceStatus.ACTIVE },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: SERVICE_INCLUDE,
    });
    return rows.map(toServiceDto);
  }

  async getPublicBySlug(slug: string): Promise<ServiceDto> {
    const row = await prisma.service.findFirst({
      where: { slug: String(slug || "").toLowerCase(), status: ServiceStatus.ACTIVE },
      include: SERVICE_INCLUDE,
    });
    if (!row) throw new NotFoundException("Service not found");
    return toServiceDto(row);
  }

  // ----------------------------------------------------------------- admin

  async adminList(query: QueryServiceListDto): Promise<PaginatedList<ServiceDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ServiceWhereInput = {};
    if (query.status && (Object.values(ServiceStatus) as string[]).includes(query.status)) {
      where.status = query.status as ServiceStatus;
    }
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { slug: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const [total, rows] = await Promise.all([
      prisma.service.count({ where }),
      prisma.service.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: SERVICE_INCLUDE,
      }),
    ]);
    return { items: rows.map(toServiceDto), total, page, limit };
  }

  async adminGet(id: string): Promise<ServiceDto> {
    const row = await prisma.service.findUnique({ where: { id }, include: SERVICE_INCLUDE });
    if (!row) throw new NotFoundException("Service not found");
    return toServiceDto(row);
  }

  async create(dto: CreateServiceDto, actor: ActorContext): Promise<ServiceDto> {
    const pricingMode = dto.pricingMode ?? ServicePricingMode.QUOTE_REQUIRED;
    await this.assertPricingConsistent(pricingMode, dto.productId ?? null);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.service.create({
          data: {
            slug: dto.slug,
            name: dto.name,
            summary: dto.summary,
            description: dto.description,
            features: dto.features ?? [],
            processSteps: (dto.processSteps ?? []) as unknown as Prisma.InputJsonValue,
            imageUrl: dto.imageUrl ?? null,
            ctaLabel: dto.ctaLabel ?? "Nhận báo giá",
            pricingMode,
            productId: dto.productId ?? null,
            status: dto.status ?? ServiceStatus.DRAFT,
            sortOrder: dto.sortOrder ?? 0,
          },
          include: SERVICE_INCLUDE,
        });
        await this.audit.logActionWithClient(tx, {
          action: "SERVICE_CREATED",
          entity: "Service",
          entityId: row.id,
          actorId: actor.userId,
          details: { slug: row.slug, status: row.status, pricingMode: row.pricingMode },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
        return row;
      });
      return toServiceDto(created);
    } catch (err) {
      throw this.mapUniqueViolation(err);
    }
  }

  async update(id: string, dto: UpdateServiceDto, actor: ActorContext): Promise<ServiceDto> {
    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Service not found");

    const pricingMode = dto.pricingMode ?? existing.pricingMode;
    const productId = dto.productId !== undefined ? dto.productId : existing.productId;
    await this.assertPricingConsistent(pricingMode, productId);

    const data: Prisma.ServiceUncheckedUpdateInput = {};
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.summary !== undefined) data.summary = dto.summary;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.features !== undefined) data.features = dto.features;
    if (dto.processSteps !== undefined) data.processSteps = dto.processSteps as unknown as Prisma.InputJsonValue;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.ctaLabel !== undefined) data.ctaLabel = dto.ctaLabel;
    if (dto.pricingMode !== undefined) data.pricingMode = dto.pricingMode;
    if (dto.productId !== undefined) data.productId = dto.productId;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.service.update({ where: { id }, data, include: SERVICE_INCLUDE });
        await this.audit.logActionWithClient(tx, {
          action: "SERVICE_UPDATED",
          entity: "Service",
          entityId: id,
          actorId: actor.userId,
          details: { changedFields: Object.keys(data), fromStatus: existing.status, toStatus: row.status },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
        return row;
      });
      return toServiceDto(updated);
    } catch (err) {
      throw this.mapUniqueViolation(err);
    }
  }

  /** DIRECT_CHECKOUT services must point at an existing catalog product. */
  private async assertPricingConsistent(mode: ServicePricingMode, productId: string | null): Promise<void> {
    if (mode !== ServicePricingMode.DIRECT_CHECKOUT) return;
    if (!productId) {
      throw new BadRequestException("DIRECT_CHECKOUT services require a productId");
    }
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) {
      throw new BadRequestException("productId does not reference an existing product");
    }
  }

  private mapUniqueViolation(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException("A service with this slug already exists");
    }
    return err;
  }
}
