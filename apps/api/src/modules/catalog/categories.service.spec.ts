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
    it("creates category and logs CATEGORY_CREATED audit", async () => {
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
      expect(auditService.logAction).toHaveBeenCalledWith(
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

    it("updates category and logs CATEGORY_UPDATED audit", async () => {
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
      expect(auditService.logAction).toHaveBeenCalledWith(
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
    it("throws NotFoundException if category does not exist", async () => {
      (prisma.category.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.getCategoryById("unknown")).rejects.toThrow(NotFoundException);
    });
  });
});
