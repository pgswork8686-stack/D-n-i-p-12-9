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

    it("rejects setting parent to a descendant (cycle prevention)", async () => {
      (prisma.category.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: "cat_parent", slug: "parent" }) // existing category
        .mockResolvedValueOnce({ id: "cat_child", parentId: "cat_parent" }); // target parent is a child of cat_parent

      await expect(
        service.updateCategory("cat_parent", { parentId: "cat_child" }, "admin_user_id"),
      ).rejects.toThrow("Cannot set category parent to one of its descendants");
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

  describe("getCategoryById", () => {
    it("returns category with its descendants tree", async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        { id: "root_1", slug: "root", parentId: null, status: CategoryStatus.ACTIVE },
        { id: "child_1", slug: "child", parentId: "root_1", status: CategoryStatus.ARCHIVED },
      ]);

      const result = await service.getCategoryById("root_1");
      expect(result.id).toBe("root_1");
      expect(result.children).toHaveLength(1);
      expect(result.children[0].id).toBe("child_1");
    });

    it("throws NotFoundException if category id does not exist", async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([]);

      await expect(service.getCategoryById("unknown_id")).rejects.toThrow(NotFoundException);
    });
  });

  describe("getCategoryBySlug and visibility", () => {
    it("returns category if found without active check (admin/internal mode)", async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "cat_archived",
          slug: "archived-cat",
          parentId: null,
          status: CategoryStatus.ARCHIVED,
        },
      ]);

      const cat = await service.getCategoryBySlug("archived-cat", false);
      expect(cat.id).toBe("cat_archived");
    });

    it("throws NotFoundException when onlyActive=true and category is ARCHIVED", async () => {
      // prisma.category.findMany returns only ACTIVE categories, so archived-cat is not in the list
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([]);

      await expect(service.getCategoryBySlug("archived-cat", true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns category when onlyActive=true and category is ACTIVE root", async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "cat_active",
          slug: "active-cat",
          parentId: null,
          status: CategoryStatus.ACTIVE,
        },
      ]);

      const cat = await service.getCategoryBySlug("active-cat", true);
      expect(cat.id).toBe("cat_active");
    });

    it("returns category with active descendants when onlyActive=true", async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        { id: "cat_parent", slug: "parent-cat", parentId: null, status: CategoryStatus.ACTIVE },
        { id: "child_active", slug: "child-act", parentId: "cat_parent", status: CategoryStatus.ACTIVE },
      ]);

      const cat = await service.getCategoryBySlug("parent-cat", true);
      expect(cat.id).toBe("cat_parent");
      expect(cat.children).toHaveLength(1);
      expect(cat.children[0].id).toBe("child_active");
    });

    it("throws NotFoundException when category is ACTIVE but parent is ARCHIVED (missing from active list)", async () => {
      // Even though child is ACTIVE, its parent was ARCHIVED so parent was omitted from findMany active query.
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "child_active",
          slug: "active-child-with-archived-parent",
          parentId: "archived_parent_id",
          status: CategoryStatus.ACTIVE,
        },
      ]);

      await expect(
        service.getCategoryBySlug("active-child-with-archived-parent", true),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when category is ACTIVE but grandparent is ARCHIVED", async () => {
      // Grandparent is ARCHIVED (omitted from active list), parent is ACTIVE, target child is ACTIVE
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "parent_active",
          slug: "parent-active",
          parentId: "archived_grandparent_id",
          status: CategoryStatus.ACTIVE,
        },
        {
          id: "child_active",
          slug: "child-active",
          parentId: "parent_active",
          status: CategoryStatus.ACTIVE,
        },
      ]);

      await expect(service.getCategoryBySlug("child-active", true)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("listCategories tree hierarchy and archived sanitization", () => {
    it("public listCategories(false): arbitrary depth pruning (ACTIVE root -> ACTIVE child -> ARCHIVED grandchild -> ACTIVE great-grandchild)", async () => {
      // Prisma findMany only returns ACTIVE categories
      // root (ACTIVE) -> child (ACTIVE) -> grandchild (ARCHIVED, excluded by query) -> great-grandchild (ACTIVE, present in DB but orphaned)
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "root_1",
          name: "Root Category",
          slug: "root-category",
          parentId: null,
          status: CategoryStatus.ACTIVE,
        },
        {
          id: "child_1",
          name: "Child Category",
          slug: "child-category",
          parentId: "root_1",
          status: CategoryStatus.ACTIVE,
        },
        {
          id: "great_grandchild_1",
          name: "Great Grandchild",
          slug: "great-grandchild",
          parentId: "archived_grandchild_id",
          status: CategoryStatus.ACTIVE,
        },
      ]);

      const result = await service.listCategories(false);

      expect(prisma.category.findMany).toHaveBeenCalledWith({
        where: { status: CategoryStatus.ACTIVE },
        orderBy: { sortOrder: "asc" },
      });

      // Only root_1 should be at the top level
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("root_1");

      // Root has child_1
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].id).toBe("child_1");

      // child_1 has no active children (grandchild was archived and excluded)
      expect(result[0].children[0].children).toHaveLength(0);

      // great_grandchild_1 must NEVER appear at root or anywhere in the tree
      const allIds = [
        result[0].id,
        ...result[0].children.map((c) => c.id),
      ];
      expect(allIds).not.toContain("great_grandchild_1");
    });

    it("public listCategories(false): child category NEVER appears at top-level (root isolation)", async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "root_1",
          name: "Themes",
          slug: "themes",
          parentId: null,
          status: CategoryStatus.ACTIVE,
        },
        {
          id: "child_1",
          name: "WooCommerce Themes",
          slug: "woocommerce-themes",
          parentId: "root_1",
          status: CategoryStatus.ACTIVE,
        },
      ]);

      const result = await service.listCategories(false);

      // Result should ONLY have 1 item at top-level (root_1)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("root_1");
      expect(result.some((cat) => cat.id === "child_1")).toBe(false);

      // child_1 is strictly nested inside root_1.children
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].id).toBe("child_1");
    });

    it("admin listCategories(true) includes ARCHIVED categories and full arbitrary depth tree", async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: "root_1",
          name: "Root Active",
          slug: "root-active",
          parentId: null,
          status: CategoryStatus.ACTIVE,
        },
        {
          id: "root_archived",
          name: "Root Archived",
          slug: "root-archived",
          parentId: null,
          status: CategoryStatus.ARCHIVED,
        },
        {
          id: "child_archived",
          name: "Child Archived",
          slug: "child-archived",
          parentId: "root_1",
          status: CategoryStatus.ARCHIVED,
        },
        {
          id: "grandchild_active",
          name: "Grandchild Active",
          slug: "grandchild-active",
          parentId: "child_archived",
          status: CategoryStatus.ACTIVE,
        },
      ]);

      const result = await service.listCategories(true);

      expect(prisma.category.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { sortOrder: "asc" },
      });

      // Admin sees both active and archived roots
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual(["root_1", "root_archived"]);

      // root_1 contains child_archived
      const root1 = result.find((r) => r.id === "root_1")!;
      expect(root1.children).toHaveLength(1);
      expect(root1.children[0].id).toBe("child_archived");
      expect(root1.children[0].status).toBe(CategoryStatus.ARCHIVED);

      // child_archived contains grandchild_active
      expect(root1.children[0].children).toHaveLength(1);
      expect(root1.children[0].children[0].id).toBe("grandchild_active");
    });
  });
});
