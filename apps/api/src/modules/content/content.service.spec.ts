import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ContentService } from "./content.service";
import { AuditService } from "../audit/audit.service";
import { prisma } from "@nexus/database";
import { ContentStatus, ContentType } from "@nexus/contracts";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      $transaction: jest.fn((cb) => cb(prisma)),
      contentCategory: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      contentPost: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    },
  };
});

describe("ContentService", () => {
  let service: ContentService;
  let auditService: { logAction: jest.Mock };

  beforeEach(async () => {
    auditService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
    jest.clearAllMocks();
  });

  describe("Categories", () => {
    it("should create a category with auto slug", async () => {
      (prisma.contentCategory.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.contentCategory.create as jest.Mock).mockResolvedValue({
        id: "cat_1",
        name: "Guides & Tutorials",
        slug: "guides-tutorials",
        description: "Helpful guides",
        seoTitle: null,
        seoDescription: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.createCategory({
        name: "Guides & Tutorials",
      });

      expect(res.slug).toBe("guides-tutorials");
      expect(prisma.contentCategory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Guides & Tutorials",
          slug: "guides-tutorials",
        }),
      });
    });

    it("should throw ConflictException if category slug exists", async () => {
      (prisma.contentCategory.findUnique as jest.Mock).mockResolvedValue({
        id: "cat_existing",
        slug: "guides",
      });

      await expect(
        service.createCategory({ name: "Guides", slug: "guides" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("Post Creation", () => {
    it("should create a post with sanitized content and calculated reading time", async () => {
      (prisma.contentPost.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.contentPost.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({
          id: "post_1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          category: null,
          author: { id: "user_1", email: "editor@nexus.local", profile: { displayName: "Editor" } },
        }),
      );

      const res = await service.createPost(
        "user_1",
        {
          title: "Introduction to Next.js 15",
          content: "<p>Hello world</p><script>alert(1)</script>",
          contentType: ContentType.ARTICLE,
        },
      );

      expect(res.title).toBe("Introduction to Next.js 15");
      expect(res.slug).toBe("introduction-to-nextjs-15");
      expect(res.status).toBe(ContentStatus.DRAFT);
      // Verify sanitization
      expect(prisma.contentPost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: "<p>Hello world</p>",
            slug: "introduction-to-nextjs-15",
            authorId: "user_1",
          }),
        }),
      );
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CONTENT_CREATED",
          entityId: "post_1",
        }),
      );
    });

    it("should reject invalid canonical URL", async () => {
      (prisma.contentPost.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createPost(
          "user_1",
          {
            title: "Test Post",
            content: "Content here",
            canonicalUrl: "javascript:alert(1)",
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject manual creation with PUBLISHED status", async () => {
      await expect(
        service.createPost(
          "user_1",
          {
            title: "Bypass Post",
            content: "Content here",
            status: ContentStatus.PUBLISHED as any,
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject manual creation with SCHEDULED status", async () => {
      await expect(
        service.createPost(
          "user_1",
          {
            title: "Bypass Scheduled Post",
            content: "Content here",
            status: ContentStatus.SCHEDULED as any,
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject manual creation with REVIEW status", async () => {
      await expect(
        service.createPost(
          "user_1",
          {
            title: "Bypass Review Post",
            content: "Content here",
            status: ContentStatus.REVIEW as any,
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject manual creation with AI_DRAFT or ARCHIVED status", async () => {
      await expect(
        service.createPost(
          "user_1",
          {
            title: "Bypass AI Draft",
            content: "Content here",
            status: ContentStatus.AI_DRAFT as any,
          },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createPost(
          "user_1",
          {
            title: "Bypass Archived",
            content: "Content here",
            status: ContentStatus.ARCHIVED as any,
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("State Machine Transitions", () => {
    it("should allow DRAFT -> REVIEW", async () => {
      const mockPost = {
        id: "post_1",
        status: ContentStatus.DRAFT,
        title: "Test",
        slug: "test",
        content: "Content body",
        readingTimeMinutes: 1,
        authorId: "user_1",
        publishedAt: null,
        scheduledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        author: { id: "user_1", email: "author@test.com", profile: { displayName: "Author" } },
        category: null,
      };
      (prisma.contentPost.findUnique as jest.Mock).mockResolvedValue(mockPost);
      (prisma.contentPost.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.contentPost.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        ...mockPost,
        status: ContentStatus.REVIEW,
      });

      const res = await service.transitionPost(
        "post_1",
        "editor_1",
        { targetStatus: ContentStatus.REVIEW },
      );

      expect(res.status).toBe(ContentStatus.REVIEW);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "CONTENT_STATUS_CHANGED",
          }),
        }),
      );
    });

    it("should reject same-state transition with BadRequestException", async () => {
      (prisma.contentPost.findUnique as jest.Mock).mockResolvedValue({
        id: "post_1",
        status: ContentStatus.PUBLISHED,
      });

      await expect(
        service.transitionPost(
          "post_1",
          "editor_1",
          { targetStatus: ContentStatus.PUBLISHED },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw ConflictException on concurrent CAS collision (count = 0)", async () => {
      (prisma.contentPost.findUnique as jest.Mock).mockResolvedValue({
        id: "post_1",
        status: ContentStatus.REVIEW,
      });
      (prisma.contentPost.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(
        service.transitionPost(
          "post_1",
          "editor_1",
          { targetStatus: ContentStatus.PUBLISHED },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it("should reject invalid transition ARCHIVED -> SCHEDULED", async () => {
      (prisma.contentPost.findUnique as jest.Mock).mockResolvedValue({
        id: "post_1",
        status: ContentStatus.ARCHIVED,
      });

      await expect(
        service.transitionPost(
          "post_1",
          "editor_1",
          { targetStatus: ContentStatus.SCHEDULED },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject transition to SCHEDULED without valid future date", async () => {
      (prisma.contentPost.findUnique as jest.Mock).mockResolvedValue({
        id: "post_1",
        status: ContentStatus.REVIEW,
      });

      // Past date
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      await expect(
        service.transitionPost(
          "post_1",
          "editor_1",
          { targetStatus: ContentStatus.SCHEDULED, scheduledAt: pastDate },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should set publishedAt when transitioning to PUBLISHED", async () => {
      const mockPost = {
        id: "post_1",
        status: ContentStatus.REVIEW,
        publishedAt: null,
        scheduledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        author: { id: "user_1", email: "author@test.com", profile: { displayName: "Author" } },
        category: null,
      };
      (prisma.contentPost.findUnique as jest.Mock).mockResolvedValue(mockPost);
      (prisma.contentPost.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.contentPost.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        ...mockPost,
        status: ContentStatus.PUBLISHED,
        publishedAt: new Date(),
      });

      const res = await service.transitionPost(
        "post_1",
        "editor_1",
        { targetStatus: ContentStatus.PUBLISHED },
      );

      expect(res.status).toBe(ContentStatus.PUBLISHED);
      expect(res.publishedAt).toBeDefined();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "CONTENT_PUBLISHED",
          }),
        }),
      );
    });
  });

  describe("Public Querying & Anti-Enumeration", () => {
    it("should return published post for public reader", async () => {
      (prisma.contentPost.findFirst as jest.Mock).mockResolvedValue({
        id: "post_pub",
        title: "Live Article",
        slug: "live-article",
        excerpt: "An excerpt",
        content: "<p>Live content</p>",
        contentType: ContentType.ARTICLE,
        status: ContentStatus.PUBLISHED,
        publishedAt: new Date("2026-01-01"),
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        readingTimeMinutes: 2,
        seoTitle: null,
        seoDescription: null,
        canonicalUrl: null,
        featuredImageUrl: null,
        featuredImageAlt: null,
        ogImageUrl: null,
        category: { id: "cat_1", name: "News", slug: "news" },
      });

      const res = await service.getPublicPostBySlug("live-article");
      expect(res.slug).toBe("live-article");
      expect(res.title).toBe("Live Article");
      expect(res.category?.name).toBe("News");
    });

    it("should throw NotFoundException (anti-enumeration) if post is not published", async () => {
      (prisma.contentPost.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getPublicPostBySlug("draft-article"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
