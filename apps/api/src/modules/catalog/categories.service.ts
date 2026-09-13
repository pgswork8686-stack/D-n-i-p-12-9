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

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

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

  private buildTree(
    categories: Category[],
    includeArchived: boolean,
  ): {
    roots: CategoryTreeNode[];
    idMap: Map<string, CategoryTreeNode>;
  } {
    const idMap = new Map<string, CategoryTreeNode>();

    for (const cat of categories) {
      idMap.set(cat.id, {
        ...cat,
        children: [],
      });
    }

    const roots: CategoryTreeNode[] = [];

    for (const node of idMap.values()) {
      if (!node.parentId) {
        roots.push(node);
      } else {
        const parent = idMap.get(node.parentId);
        if (parent) {
          parent.children.push(node);
        } else if (includeArchived) {
          // If in admin mode and parent category does not exist in DB, treat as root so it is visible
          roots.push(node);
        }
        // In public mode (!includeArchived):
        // If parent is not in idMap, parent is ARCHIVED (or missing).
        // The node is an orphan of an inactive ancestor and is NOT attached to roots.
      }
    }

    return { roots, idMap };
  }

  async listCategories(includeArchived = false): Promise<CategoryTreeNode[]> {
    const categories = await prisma.category.findMany({
      where: includeArchived ? {} : { status: CategoryStatus.ACTIVE },
      orderBy: { sortOrder: "asc" },
    });

    const { roots } = this.buildTree(categories, includeArchived);
    return roots;
  }

  async getCategoryById(id: string): Promise<CategoryTreeNode> {
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
    });
    const { idMap } = this.buildTree(categories, true);
    const category = idMap.get(id);
    if (!category) {
      throw new NotFoundException(`Category with ID '${id}' not found`);
    }
    return category;
  }

  async getCategoryBySlug(slug: string, onlyActive = false): Promise<CategoryTreeNode> {
    if (onlyActive) {
      const activeCategories = await prisma.category.findMany({
        where: { status: CategoryStatus.ACTIVE },
        orderBy: { sortOrder: "asc" },
      });

      const { idMap } = this.buildTree(activeCategories, false);
      const target = Array.from(idMap.values()).find((cat) => cat.slug === slug);
      if (!target) {
        throw new NotFoundException(`Category with slug '${slug}' not found`);
      }

      // Check transitive reachability to an active root:
      // Every ancestor in the chain must exist in idMap and terminate at a root (parentId === null).
      const visited = new Set<string>([target.id]);
      let current: CategoryTreeNode | undefined = target;
      while (current.parentId) {
        if (visited.has(current.parentId)) {
          throw new BadRequestException("Cycle detected in category hierarchy");
        }
        visited.add(current.parentId);
        const parent = idMap.get(current.parentId);
        if (!parent) {
          // An ancestor is archived or missing!
          throw new NotFoundException(`Category with slug '${slug}' not found`);
        }
        current = parent;
      }

      return target;
    }

    // Admin / full lookup
    const allCategories = await prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
    });
    const { idMap } = this.buildTree(allCategories, true);
    const target = Array.from(idMap.values()).find((cat) => cat.slug === slug);
    if (!target) {
      throw new NotFoundException(`Category with slug '${slug}' not found`);
    }
    return target;
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

        // Prevent cyclic hierarchy: check that id is not an ancestor of dto.parentId
        let checkId: string | null = parent.parentId;
        const seen = new Set<string>([id, dto.parentId]);
        while (checkId) {
          if (checkId === id) {
            throw new BadRequestException("Cannot set category parent to one of its descendants");
          }
          if (seen.has(checkId)) break;
          seen.add(checkId);
          const ancestor = await tx.category.findUnique({
            where: { id: checkId },
            select: { parentId: true },
          });
          checkId = ancestor?.parentId || null;
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
