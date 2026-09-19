import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import {
  prisma,
  ContentStatus,
  ContentType,
  isValidContentTransition,
  estimateReadingTimeMinutes,
} from "@nexus/database";
import {
  slugify,
  isReservedSlug,
  sanitizeContentHtml,
  isValidCanonicalUrl,
} from "@nexus/utils";
import {
  AdminContentPostDto,
  PublicContentListItemDto,
  PublicContentPostDto,
  ContentCategoryDto,
  PaginatedResponse,
} from "@nexus/contracts";
import {
  CreateContentPostDto,
  UpdateContentPostDto,
  ContentPostTransitionDto,
  CreateContentCategoryDto,
  UpdateContentCategoryDto,
  QueryContentPostsDto,
  QueryPublicPostsDto,
} from "./dto/content.dto";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class ContentService {
  constructor(private readonly auditService: AuditService) {}

  // --------------------------------------------------------
  // Helpers
  // --------------------------------------------------------

  private isValidImageUrl(url: string): boolean {
    if (!url || typeof url !== "string") return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  private normalizeAndValidateSlug(raw: string, entityName: string = "Slug"): string {
    const normalized = slugify(raw);
    if (!normalized || normalized.trim() === "") {
      throw new BadRequestException(`${entityName} cannot be empty or contain only symbols.`);
    }
    if (isReservedSlug(normalized)) {
      throw new BadRequestException(`${entityName} '${normalized}' is reserved.`);
    }
    if (normalized.length > 200) {
      throw new BadRequestException(`${entityName} exceeds maximum length of 200 characters.`);
    }
    return normalized;
  }

  // --------------------------------------------------------
  // Slug Generation & Collision Resolution
  // --------------------------------------------------------

  async generateUniquePostSlug(baseTitle: string, explicitSlug?: string): Promise<string> {
    const raw = explicitSlug ? this.normalizeAndValidateSlug(explicitSlug, "Post slug") : slugify(baseTitle);
    const candidate = raw || `post-${Date.now()}`;

    if (isReservedSlug(candidate)) {
      throw new BadRequestException(`Slug '${candidate}' is reserved and cannot be used.`);
    }

    // Check collision
    const existing = await prisma.contentPost.findUnique({
      where: { slug: candidate },
    });

    if (!existing) {
      return candidate;
    }

    if (explicitSlug) {
      throw new ConflictException(`Slug '${candidate}' already exists.`);
    }

    // Auto-generate unique numerical suffix for title-derived slugs
    let counter = 1;
    while (counter < 100) {
      const suffixed = `${candidate}-${counter}`;
      const conflict = await prisma.contentPost.findUnique({
        where: { slug: suffixed },
      });
      if (!conflict) {
        return suffixed;
      }
      counter++;
    }

    return `${candidate}-${Date.now()}`;
  }

  async generateUniqueCategorySlug(name: string, explicitSlug?: string): Promise<string> {
    const candidate = explicitSlug
      ? this.normalizeAndValidateSlug(explicitSlug, "Category slug")
      : this.normalizeAndValidateSlug(name, "Category slug");

    const existing = await prisma.contentCategory.findUnique({
      where: { slug: candidate },
    });
    if (existing) {
      throw new ConflictException(`Category slug '${candidate}' already exists.`);
    }
    return candidate;
  }

  // --------------------------------------------------------
  // Admin Content Posts
  // --------------------------------------------------------

  async createPost(actorId: string, data: CreateContentPostDto): Promise<AdminContentPostDto> {
    // Authority Boundary: Normal admin manual creation permits ONLY DRAFT or IDEA
    const initialStatus = data.status || ContentStatus.DRAFT;
    if (initialStatus !== ContentStatus.DRAFT && initialStatus !== ContentStatus.IDEA) {
      throw new BadRequestException(
        `Invalid initial status '${initialStatus}'. Manual creation permits only DRAFT or IDEA status. Publishing and scheduling require workflow transitions.`,
      );
    }

    if ((data as any).scheduledAt) {
      throw new BadRequestException(
        "Scheduling is not permitted during initial post creation; use workflow transition REVIEW -> SCHEDULED.",
      );
    }

    if (data.canonicalUrl && !isValidCanonicalUrl(data.canonicalUrl)) {
      throw new BadRequestException("Invalid canonical URL format or unsafe protocol.");
    }

    if (data.featuredImageUrl && !this.isValidImageUrl(data.featuredImageUrl)) {
      throw new BadRequestException("Invalid featured image URL: must use http or https protocol.");
    }

    if (data.ogImageUrl && !this.isValidImageUrl(data.ogImageUrl)) {
      throw new BadRequestException("Invalid OpenGraph image URL: must use http or https protocol.");
    }

    const slug = await this.generateUniquePostSlug(data.title, data.slug);
    const sanitizedContent = sanitizeContentHtml(data.content);
    const readingTimeMinutes = estimateReadingTimeMinutes(sanitizedContent);

    const post = await prisma.contentPost.create({
      data: {
        title: data.title,
        slug,
        excerpt: data.excerpt ?? null,
        content: sanitizedContent,
        status: initialStatus,
        contentType: data.contentType || ContentType.ARTICLE,
        authorId: actorId || null,
        seoTitle: data.seoTitle ?? null,
        seoDescription: data.seoDescription ?? null,
        canonicalUrl: data.canonicalUrl ?? null,
        featuredImageUrl: data.featuredImageUrl ?? null,
        featuredImageAlt: data.featuredImageAlt ?? null,
        ogImageUrl: data.ogImageUrl ?? null,
        publishedAt: null,
        scheduledAt: null,
        categoryId: data.categoryId ?? null,
        readingTimeMinutes,
      },
      include: {
        author: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
        category: true,
      },
    });

    await this.auditService.logAction({
      action: "CONTENT_CREATED",
      entity: "ContentPost",
      entityId: post.id,
      actorId,
      details: {
        title: post.title,
        slug: post.slug,
        status: post.status,
      },
    });

    return this.mapAdminPost(post);
  }

  async updatePost(id: string, actorId: string, data: UpdateContentPostDto): Promise<AdminContentPostDto> {
    const existing = await prisma.contentPost.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Content post '${id}' not found.`);
    }

    let slug = existing.slug;
    if (data.slug && data.slug !== existing.slug) {
      const candidate = this.normalizeAndValidateSlug(data.slug, "Post slug");
      const conflict = await prisma.contentPost.findUnique({
        where: { slug: candidate },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException(`Slug '${candidate}' already in use.`);
      }
      slug = candidate;
    }

    if (data.canonicalUrl && !isValidCanonicalUrl(data.canonicalUrl)) {
      throw new BadRequestException("Invalid canonical URL format or unsafe protocol.");
    }

    if (data.featuredImageUrl && !this.isValidImageUrl(data.featuredImageUrl)) {
      throw new BadRequestException("Invalid featured image URL: must use http or https protocol.");
    }

    if (data.ogImageUrl && !this.isValidImageUrl(data.ogImageUrl)) {
      throw new BadRequestException("Invalid OpenGraph image URL: must use http or https protocol.");
    }

    const sanitizedContent =
      data.content !== undefined ? sanitizeContentHtml(data.content) : existing.content;
    const readingTimeMinutes = estimateReadingTimeMinutes(sanitizedContent);

    const updated = await prisma.contentPost.update({
      where: { id },
      data: {
        ...(data.title ? { title: data.title } : {}),
        slug,
        ...(data.excerpt !== undefined ? { excerpt: data.excerpt } : {}),
        content: sanitizedContent,
        ...(data.contentType ? { contentType: data.contentType } : {}),
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
        ...(data.seoTitle !== undefined ? { seoTitle: data.seoTitle } : {}),
        ...(data.seoDescription !== undefined ? { seoDescription: data.seoDescription } : {}),
        ...(data.canonicalUrl !== undefined ? { canonicalUrl: data.canonicalUrl } : {}),
        ...(data.featuredImageUrl !== undefined ? { featuredImageUrl: data.featuredImageUrl } : {}),
        ...(data.featuredImageAlt !== undefined ? { featuredImageAlt: data.featuredImageAlt } : {}),
        ...(data.ogImageUrl !== undefined ? { ogImageUrl: data.ogImageUrl } : {}),
        readingTimeMinutes,
      },
      include: {
        author: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
        category: true,
      },
    });

    await this.auditService.logAction({
      action: "CONTENT_UPDATED",
      entity: "ContentPost",
      entityId: id,
      actorId,
      details: {
        title: updated.title,
        slug: updated.slug,
      },
    });

    return this.mapAdminPost(updated);
  }

  async transitionPost(
    id: string,
    actorId: string,
    transition: ContentPostTransitionDto,
  ): Promise<AdminContentPostDto> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.contentPost.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new NotFoundException(`Content post '${id}' not found.`);
      }

      if (existing.status === transition.targetStatus) {
        throw new BadRequestException(
          `Post is already in status '${transition.targetStatus}'. Same-state transitions are disallowed.`,
        );
      }

      if (!isValidContentTransition(existing.status, transition.targetStatus)) {
        throw new BadRequestException(
          `Invalid status transition from '${existing.status}' to '${transition.targetStatus}'.`,
        );
      }

      let publishedAt = existing.publishedAt;
      let scheduledAt = existing.scheduledAt;

      if (transition.targetStatus === ContentStatus.PUBLISHED) {
        publishedAt = existing.publishedAt || new Date();
      } else if (transition.targetStatus === ContentStatus.SCHEDULED) {
        const schedTimestamp = transition.scheduledAt || existing.scheduledAt?.toISOString();
        if (!schedTimestamp) {
          throw new BadRequestException("Scheduling requires a scheduledAt timestamp.");
        }
        const sched = new Date(schedTimestamp);
        if (sched.getTime() <= Date.now()) {
          throw new BadRequestException("Scheduled time must be in the future.");
        }
        scheduledAt = sched;
      }

      // Concurrency CAS update: ensures status was not mutated concurrently
      const updateResult = await tx.contentPost.updateMany({
        where: {
          id,
          status: existing.status,
        },
        data: {
          status: transition.targetStatus,
          publishedAt,
          scheduledAt,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException(
          `Concurrent transition conflict: content post '${id}' status was changed by another process.`,
        );
      }

      let action = "CONTENT_STATUS_CHANGED";
      if (transition.targetStatus === ContentStatus.PUBLISHED) {
        action = "CONTENT_PUBLISHED";
      } else if (transition.targetStatus === ContentStatus.ARCHIVED) {
        action = "CONTENT_ARCHIVED";
      }

      // Atomic audit write within the same database transaction
      await tx.auditLog.create({
        data: {
          action,
          entity: "ContentPost",
          entityId: id,
          actorId,
          details: {
            previousStatus: existing.status,
            newStatus: transition.targetStatus,
            notes: transition.notes,
            publishedAt: publishedAt?.toISOString(),
            scheduledAt: scheduledAt?.toISOString(),
          },
        },
      });

      const updated = await tx.contentPost.findUniqueOrThrow({
        where: { id },
        include: {
          author: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
          category: true,
        },
      });

      return this.mapAdminPost(updated);
    });
  }

  async listAdminPosts(
    query?: QueryContentPostsDto,
  ): Promise<PaginatedResponse<AdminContentPostDto>> {
    const page = Math.max(query?.page || 1, 1);
    const limit = Math.min(Math.max(query?.limit || 20, 1), 100);
    const offset = query?.offset !== undefined ? Math.max(query.offset, 0) : (page - 1) * limit;

    const where: any = {};
    if (query?.status) {
      where.status = query.status;
    }
    if (query?.categoryId) {
      where.categoryId = query.categoryId;
    }
    if (query?.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: "insensitive" } },
        { slug: { contains: term, mode: "insensitive" } },
      ];
    }

    const orderBy: any = {};
    const sortField = query?.sortBy || "createdAt";
    const sortDir = query?.sortOrder || "desc";
    orderBy[sortField] = sortDir;

    const [items, total] = await Promise.all([
      prisma.contentPost.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy,
        include: {
          author: {
            select: { id: true, email: true, profile: { select: { displayName: true } } },
          },
          category: true,
        },
      }),
      prisma.contentPost.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: items.map((p) => this.mapAdminPost(p)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getAdminPost(id: string): Promise<AdminContentPostDto> {
    const post = await prisma.contentPost.findUnique({
      where: { id },
      include: {
        author: {
          select: { id: true, email: true, profile: { select: { displayName: true } } },
        },
        category: true,
      },
    });

    if (!post) {
      throw new NotFoundException(`Content post '${id}' not found.`);
    }

    return this.mapAdminPost(post);
  }

  // --------------------------------------------------------
  // Categories
  // --------------------------------------------------------

  async createCategory(data: CreateContentCategoryDto): Promise<ContentCategoryDto> {
    const slug = await this.generateUniqueCategorySlug(data.name, data.slug);
    const category = await prisma.contentCategory.create({
      data: {
        name: data.name,
        slug,
        description: data.description ?? null,
        seoTitle: data.seoTitle ?? null,
        seoDescription: data.seoDescription ?? null,
      },
    });
    return this.mapCategory(category);
  }

  async updateCategory(id: string, data: UpdateContentCategoryDto): Promise<ContentCategoryDto> {
    const existing = await prisma.contentCategory.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Category '${id}' not found.`);
    }

    let slug = existing.slug;
    if (data.slug && data.slug !== existing.slug) {
      const candidate = this.normalizeAndValidateSlug(data.slug, "Category slug");
      const conflict = await prisma.contentCategory.findUnique({ where: { slug: candidate } });
      if (conflict && conflict.id !== id) {
        throw new ConflictException(`Category slug '${candidate}' already in use.`);
      }
      slug = candidate;
    }

    const updated = await prisma.contentCategory.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        slug,
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.seoTitle !== undefined ? { seoTitle: data.seoTitle } : {}),
        ...(data.seoDescription !== undefined ? { seoDescription: data.seoDescription } : {}),
      },
    });
    return this.mapCategory(updated);
  }

  async listAdminCategories(): Promise<ContentCategoryDto[]> {
    const categories = await prisma.contentCategory.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { posts: true },
        },
      },
    });
    return categories.map((c) => ({
      ...this.mapCategory(c),
      postCount: c._count.posts,
    }));
  }

  // --------------------------------------------------------
  // Public Content (PUBLISHED ARTICLE ONLY)
  // --------------------------------------------------------

  async listPublicPosts(
    query?: QueryPublicPostsDto,
  ): Promise<PaginatedResponse<PublicContentListItemDto>> {
    const page = Math.max(query?.page || 1, 1);
    const limit = Math.min(Math.max(query?.limit || 10, 1), 50);
    const offset = query?.offset !== undefined ? Math.max(query.offset, 0) : (page - 1) * limit;

    const where: any = {
      status: ContentStatus.PUBLISHED,
      contentType: ContentType.ARTICLE, // Strictly ARTICLE only in public blog
    };

    const catSlug = query?.categorySlug || query?.category;
    if (catSlug) {
      where.category = {
        slug: catSlug,
      };
    }

    if (query?.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: "insensitive" } },
        { excerpt: { contains: term, mode: "insensitive" } },
      ];
    }

    const [posts, total] = await Promise.all([
      prisma.contentPost.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          featuredImageUrl: true,
          featuredImageAlt: true,
          publishedAt: true,
          readingTimeMinutes: true,
          category: {
            select: { id: true, slug: true, name: true },
          },
        },
      }),
      prisma.contentPost.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: posts.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        featuredImageUrl: p.featuredImageUrl,
        featuredImageAlt: p.featuredImageAlt,
        publishedAt: p.publishedAt ? p.publishedAt.toISOString() : "",
        readingTimeMinutes: p.readingTimeMinutes,
        category: p.category,
      })),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getPublicPostBySlug(slug: string): Promise<PublicContentPostDto> {
    const post = await prisma.contentPost.findFirst({
      where: {
        slug,
        status: ContentStatus.PUBLISHED,
        contentType: ContentType.ARTICLE, // Strictly ARTICLE only
      },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        content: true,
        contentType: true,
        featuredImageUrl: true,
        featuredImageAlt: true,
        ogImageUrl: true,
        seoTitle: true,
        seoDescription: true,
        canonicalUrl: true,
        publishedAt: true,
        updatedAt: true,
        readingTimeMinutes: true,
        category: {
          select: { id: true, slug: true, name: true },
        },
      },
    });

    if (!post) {
      // Clean 404 for non-existent or non-published posts (anti-enumeration)
      throw new NotFoundException(`Article '${slug}' not found.`);
    }

    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      contentType: post.contentType as any,
      featuredImageUrl: post.featuredImageUrl,
      featuredImageAlt: post.featuredImageAlt,
      ogImageUrl: post.ogImageUrl,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      canonicalUrl: post.canonicalUrl,
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : "",
      updatedAt: post.updatedAt.toISOString(),
      readingTimeMinutes: post.readingTimeMinutes,
      category: post.category,
    };
  }

  async listPublicCategories(): Promise<ContentCategoryDto[]> {
    const categories = await prisma.contentCategory.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            posts: {
              where: { status: ContentStatus.PUBLISHED, contentType: ContentType.ARTICLE },
            },
          },
        },
      },
    });

    return categories.map((c) => ({
      ...this.mapCategory(c),
      postCount: c._count.posts,
    }));
  }

  // --------------------------------------------------------
  // Projection Mappers
  // --------------------------------------------------------

  private mapAdminPost(post: any): AdminContentPostDto {
    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      status: post.status,
      contentType: post.contentType,
      authorId: post.authorId,
      author: post.author
        ? {
            id: post.author.id,
            email: post.author.email,
            displayName: post.author.profile?.displayName || null,
          }
        : null,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      canonicalUrl: post.canonicalUrl,
      featuredImageUrl: post.featuredImageUrl,
      featuredImageAlt: post.featuredImageAlt,
      ogImageUrl: post.ogImageUrl,
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
      scheduledAt: post.scheduledAt ? post.scheduledAt.toISOString() : null,
      categoryId: post.categoryId,
      category: post.category ? this.mapCategory(post.category) : null,
      readingTimeMinutes: post.readingTimeMinutes,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    };
  }

  private mapCategory(c: any): ContentCategoryDto {
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      seoTitle: c.seoTitle,
      seoDescription: c.seoDescription,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}

