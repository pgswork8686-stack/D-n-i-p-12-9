import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, BadRequestException, NotFoundException } from "@nestjs/common";
import { CategoriesService } from "./categories.service";
import { AuditService } from "../audit/audit.service";
import { prisma, CategoryStatus } from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      $transaction: jest.fn((cb) => cb(prisma)),
      category: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    },
  };
});

describe("CategoriesService", () => {
  let service: CategoriesService;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockAuditService = {
      logAction: jest.fn().mockResolvedValue({}),
      logActionWithClient: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    auditService = module.get(AuditService);
  });

  describe("createCategory", () => {
    it("creates category atomically and logs CATEGORY_CREATED audit via tx client", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.category.create as jest.Mock).mockResolvedValueOnce({
        id: "cat_1",
        name: "WordPress",
        slug: "wordpress",
        status: CategoryStatus.ACTIVE,
      });

      const result = await service.createCategory(
        { name: "WordPress", slug: "wordpress" },
        "admin_user_id",
      );

      expect(result.id).toBe("cat_1");
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "CATEGORY_CREATED",
          entity: "Category",
          entityId: "cat_1",
          actorId: "admin_user_id",
        }),
      );
    });

    it("rejects duplicate category slug with ConflictException", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "existing_cat",
        slug: "wordpress",
      });

      await expect(
        service.createCategory({ name: "WordPress 2", slug: "wordpress" }, "admin_user_id"),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects invalid parentId with BadRequestException", async () => {
      (prisma.category.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // slug check
        .mockResolvedValueOnce(null); // parent check

      await expect(
        service.createCategory(
          { name: "Plugins", slug: "plugins", parentId: "non_existent" },
          "admin_user_id",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rolls back transaction if audit logging fails", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.category.create as jest.Mock).mockResolvedValueOnce({
        id: "cat_fail",
        name: "Fail Cat",
        slug: "fail-cat",
      });
      (auditService.logActionWithClient as jest.Mock).mockRejectedValueOnce(
        new Error("Audit DB error"),
      );

      await expect(
        service.createCategory({ name: "Fail Cat", slug: "fail-cat" }, "admin_user_id"),
      ).rejects.toThrow("Audit DB error");
    });
  });

  describe("updateCategory", () => {
    it("rejects self-parenting with BadRequestException", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "cat_1",
        slug: "plugins",
      });

      await expect(
        service.updateCategory("cat_1", { parentId: "cat_1" }, "admin_user_id"),
      ).rejects.toThrow(BadRequestException);
    });

    it("updates category atomically and logs CATEGORY_UPDATED audit via tx client", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "cat_1",
        slug: "plugins",
      });
      (prisma.category.update as jest.Mock).mockResolvedValueOnce({
        id: "cat_1",
        name: "WordPress Plugins",
        slug: "plugins",
      });

      const result = await service.updateCategory(
        "cat_1",
        { name: "WordPress Plugins" },
        "admin_user_id",
      );

      expect(result.name).toBe("WordPress Plugins");
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "CATEGORY_UPDATED",
          entity: "Category",
          entityId: "cat_1",
          actorId: "admin_user_id",
        }),
      );
    });
  });

  describe("getCategoryBySlug and visibility", () => {
    it("returns category if found without active check", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "cat_archived",
        slug: "archived-cat",
        status: CategoryStatus.ARCHIVED,
      });

      const cat = await service.getCategoryBySlug("archived-cat", false);
      expect(cat.id).toBe("cat_archived");
    });

    it("throws NotFoundException when onlyActive=true and category is ARCHIVED", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "cat_archived",
        slug: "archived-cat",
        status: CategoryStatus.ARCHIVED,
      });

      await expect(service.getCategoryBySlug("archived-cat", true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns category when onlyActive=true and category is ACTIVE", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "cat_active",
        slug: "active-cat",
        status: CategoryStatus.ACTIVE,
      });

      const cat = await service.getCategoryBySlug("active-cat", true);
      expect(cat.id).toBe("cat_active");
    });

    it("filters out ARCHIVED children when onlyActive=true in getCategoryBySlug", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce({
        id: "cat_parent",
        slug: "parent-cat",
        status: CategoryStatus.ACTIVE,
        children: [
          { id: "child_active", name: "Active Child", status: CategoryStatus.ACTIVE },
          { id: "child_archived", name: "Archived Child", status: CategoryStatus.ARCHIVED },
        ],
      });

      const cat = await service.getCategoryBySlug("parent-cat", true);
      expect(cat.id).toBe("cat_parent");
      expect((cat as any).children).toHaveLength(1);
      expect((cat as any).children[0].id).toBe("child_active");
    });
  });

  describe("listCategories tree hierarchy and archived sanitization", () => {
    it("public listCategories(false) prunes ARCHIVED children under ACTIVE parent", async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "parent_1",
          name: "Parent Category",
          slug: "parent-category",
          status: CategoryStatus.ACTIVE,
          children: [
            {
              id: "child_active",
              name: "Active Child",
              slug: "active-child",
              status: CategoryStatus.ACTIVE,
            },
            {
              id: "child_archived",
              name: "Archived Child",
              slug: "archived-child",
              status: CategoryStatus.ARCHIVED,
            },
          ],
        },
      ]);

      const result = await service.listCategories(false);

      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: CategoryStatus.ACTIVE },
          include: {
            children: expect.objectContaining({
              where: { status: CategoryStatus.ACTIVE },
            }),
          },
        }),
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("parent_1");
      const children = (result[0] as any).children;
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe("child_active");
      expect(children.some((c: any) => c.id === "child_archived")).toBe(false);
    });

    it("admin listCategories(true) includes ARCHIVED categories and children", async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "parent_1",
          status: CategoryStatus.ACTIVE,
          children: [
            { id: "child_active", status: CategoryStatus.ACTIVE },
            { id: "child_archived", status: CategoryStatus.ARCHIVED },
          ],
        },
        {
          id: "parent_archived",
          status: CategoryStatus.ARCHIVED,
          children: [],
        },
      ]);

      const result = await service.listCategories(true);

      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );

      expect(result).toHaveLength(2);
      expect((result[0] as any).children).toHaveLength(2);
    });
  });
});
