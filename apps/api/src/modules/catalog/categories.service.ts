import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { prisma, Category, CategoryStatus } from "@nexus/database";
import { AuditService } from "../audit/audit.service";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/catalog.dto";

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly auditService: AuditService) {}

  async createCategory(dto: CreateCategoryDto, actorId: string): Promise<Category> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.category.findUnique({
        where: { slug: dto.slug },
      });
      if (existing) {
        throw new ConflictException(`Category with slug '${dto.slug}' already exists`);
      }

      if (dto.parentId) {
        const parent = await tx.category.findUnique({
          where: { id: dto.parentId },
        });
        if (!parent) {
          throw new BadRequestException(`Parent category with ID '${dto.parentId}' not found`);
        }
      }

      const category = await tx.category.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description || null,
          parentId: dto.parentId || null,
          sortOrder: dto.sortOrder ?? 0,
          status: dto.status ?? CategoryStatus.ACTIVE,
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "CATEGORY_CREATED",
        entity: "Category",
        entityId: category.id,
        actorId,
        details: { name: category.name, slug: category.slug },
      });

      return category;
    });
  }

  async listCategories(includeArchived = false): Promise<Category[]> {
    return prisma.category.findMany({
      where: includeArchived ? {} : { status: CategoryStatus.ACTIVE },
      include: {
        children: true,
      },
      orderBy: { sortOrder: "asc" },
    });
  }

  async getCategoryById(id: string): Promise<Category> {
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        children: true,
      },
    });
    if (!category) {
      throw new NotFoundException(`Category with ID '${id}' not found`);
    }
    return category;
  }

  async getCategoryBySlug(slug: string, onlyActive = false): Promise<Category> {
    const category = await prisma.category.findUnique({
      where: { slug },
      include: {
        children: true,
      },
    });
    if (!category || (onlyActive && category.status !== CategoryStatus.ACTIVE)) {
      throw new NotFoundException(`Category with slug '${slug}' not found`);
    }
    return category;
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
    actorId: string,
  ): Promise<Category> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.category.findUnique({
        where: { id },
        include: { children: true },
      });
      if (!existing) {
        throw new NotFoundException(`Category with ID '${id}' not found`);
      }

      if (dto.slug && dto.slug !== existing.slug) {
        const slugConflict = await tx.category.findUnique({
          where: { slug: dto.slug },
        });
        if (slugConflict) {
          throw new ConflictException(`Category with slug '${dto.slug}' already exists`);
        }
      }

      if (dto.parentId) {
        if (dto.parentId === id) {
          throw new BadRequestException("Category cannot be its own parent");
        }
        const parent = await tx.category.findUnique({
          where: { id: dto.parentId },
        });
        if (!parent) {
          throw new BadRequestException(`Parent category with ID '${dto.parentId}' not found`);
        }
      }

      const updated = await tx.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.slug !== undefined && { slug: dto.slug }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.parentId !== undefined && { parentId: dto.parentId }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.status !== undefined && { status: dto.status }),
        },
        include: {
          children: true,
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "CATEGORY_UPDATED",
        entity: "Category",
        entityId: id,
        actorId,
        details: { changes: dto },
      });

      return updated;
    });
  }
}
