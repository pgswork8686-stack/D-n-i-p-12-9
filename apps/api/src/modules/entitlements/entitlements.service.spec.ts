import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { EntitlementsService } from "./entitlements.service";
import {
  prisma,
  OrderStatus,
  EntitlementStatus,
  ProductType,
  FulfillmentType,
} from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      $transaction: jest.fn((cb) => cb(prisma)),
      order: {
        findUnique: jest.fn(),
      },
      entitlement: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $queryRaw: jest.fn(),
    },
  };
});

describe("EntitlementsService", () => {
  let service: EntitlementsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    (global as any).prismaGlobal = prisma;
    const module: TestingModule = await Test.createTestingModule({
      providers: [EntitlementsService],
    }).compile();

    service = module.get<EntitlementsService>(EntitlementsService);
  });

  describe("issueEntitlementsForOrder", () => {
    it("throws NotFoundException if order does not exist", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.issueEntitlementsForOrder("order-999")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException if order is in PENDING_PAYMENT state", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: "order-pending",
        status: OrderStatus.PENDING_PAYMENT,
        items: [],
      });

      await expect(
        service.issueEntitlementsForOrder("order-pending"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if order is CANCELLED", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: "order-cancelled",
        status: OrderStatus.CANCELLED,
        items: [],
      });

      await expect(
        service.issueEntitlementsForOrder("order-cancelled"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if legacy order item is missing snapshotVersion", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: "order-legacy",
        status: OrderStatus.PAID,
        items: [
          {
            id: "item-legacy",
            productId: "prod-1",
            variantId: "var-1",
            productName: "Legacy Item",
            snapshotVersion: null,
          },
        ],
      });

      await expect(
        service.issueEntitlementsForOrder("order-legacy"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if finite plan has missing duration in snapshot", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: "order-bad",
        status: OrderStatus.PAID,
        items: [
          {
            id: "item-bad",
            productId: "prod-1",
            variantId: "var-1",
            productName: "Bad Item",
            snapshotVersion: 1,
            licensePlanIdAtPurchase: "plan-1",
            isLifetime: false,
            durationDays: null,
            durationMonths: null,
          },
        ],
      });

      await expect(
        service.issueEntitlementsForOrder("order-bad"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if snapshotVersion is unsupported (e.g. 99)", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: "order-v99",
        status: OrderStatus.PAID,
        items: [
          {
            id: "item-v99",
            productId: "prod-1",
            variantId: "var-1",
            productName: "Future Item",
            snapshotVersion: 99,
            licensePlanIdAtPurchase: "plan-1",
            isLifetime: true,
          },
        ],
      });

      await expect(
        service.issueEntitlementsForOrder("order-v99"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if updatesDays in snapshot is negative", async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: "order-bad-upd",
        status: OrderStatus.PAID,
        items: [
          {
            id: "item-bad-upd",
            productId: "prod-1",
            variantId: "var-1",
            productName: "Bad Updates",
            snapshotVersion: 1,
            licensePlanIdAtPurchase: "plan-1",
            isLifetime: true,
            updatesDays: -5,
          },
        ],
      });

      await expect(
        service.issueEntitlementsForOrder("order-bad-upd"),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates entitlements for all items when order is PAID", async () => {
      const mockOrder = {
        id: "order-1",
        orderNumber: "ORD-20260913-001",
        userId: "user-1",
        status: OrderStatus.PAID,
        items: [
          {
            id: "item-1",
            productId: "prod-1",
            variantId: "var-1",
            productName: "Nexus Theme",
            variantName: "Standard",
            sku: "SKU-THM-1",
            productType: ProductType.DOWNLOADABLE_ASSET,
            fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
            quantity: 2,
            snapshotVersion: 1,
            isLifetime: true,
            durationDays: null,
            durationMonths: null,
            maxActivations: null,
            licensePlanIdAtPurchase: "plan-life-1",
          },
          {
            id: "item-2",
            productId: "prod-2",
            variantId: "var-2",
            productName: "Nexus Pro Plugin",
            variantName: "Annual",
            sku: "SKU-PLG-1Y",
            productType: ProductType.LICENSED_SOFTWARE,
            fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
            quantity: 1,
            snapshotVersion: 1,
            isLifetime: false,
            durationDays: 365,
            durationMonths: null,
            maxActivations: 3,
            licensePlanIdAtPurchase: "plan-year-1",
          },
        ],
      };

      const ent1 = {
        id: "ent-item-1",
        orderId: "order-1",
        orderItemId: "item-1",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        expiresAt: null,
        quantity: 2,
        productType: ProductType.DOWNLOADABLE_ASSET,
      };
      const ent2 = {
        id: "ent-item-2",
        orderId: "order-1",
        orderItemId: "item-2",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 365 * 86400000),
        quantity: 1,
        productType: ProductType.LICENSED_SOFTWARE,
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      // Item 1: findUnique (null) -> $queryRaw -> findUnique (ent1)
      // Item 2: findUnique (null) -> $queryRaw -> findUnique (ent2)
      (prisma.entitlement.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(ent1)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(ent2);
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ id: "ent-item-1" }])
        .mockResolvedValueOnce([{ id: "ent-item-2" }]);
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: "audit-1" });

      const results = await service.issueEntitlementsForOrder("order-1");

      expect(results).toHaveLength(2);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);

      // Item 1: Lifetime -> expiresAt is null
      expect(results[0].status).toBe(EntitlementStatus.ACTIVE);
      expect(results[0].expiresAt).toBeNull();
      expect(results[0].quantity).toBe(2);
      expect(results[0].productType).toBe(ProductType.DOWNLOADABLE_ASSET);

      // Item 2: 365 Days -> expiresAt is defined
      expect(results[1].status).toBe(EntitlementStatus.ACTIVE);
      expect(results[1].expiresAt).toBeDefined();
      expect(results[1].quantity).toBe(1);

      // Audit logs recorded
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    });

    it("rolls back transaction if audit log recording fails", async () => {
      const mockOrder = {
        id: "order-rollback",
        status: OrderStatus.PAID,
        items: [
          {
            id: "item-rb",
            productId: "prod-1",
            variantId: "var-1",
            productName: "Theme",
            snapshotVersion: 1,
            isLifetime: true,
            quantity: 1,
          },
        ],
      };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "ent-rb" }]);
      (prisma.auditLog.create as jest.Mock).mockRejectedValueOnce(
        new Error("Audit failure DB connection died"),
      );

      await expect(
        service.issueEntitlementsForOrder("order-rollback"),
      ).rejects.toThrow("Audit failure DB connection died");
    });

    it("does not duplicate entitlement if already exists (idempotent replay)", async () => {
      const mockOrder = {
        id: "order-1",
        orderNumber: "ORD-20260913-001",
        userId: "user-1",
        status: OrderStatus.PAID,
        items: [
          {
            id: "item-1",
            productId: "prod-1",
            variantId: "var-1",
            productName: "Nexus Theme",
            variantName: "Standard",
            sku: "SKU-THM-1",
            productType: ProductType.DOWNLOADABLE_ASSET,
            fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
            quantity: 1,
            snapshotVersion: 1,
            isLifetime: true,
            durationDays: null,
            durationMonths: null,
            licensePlanIdAtPurchase: null,
          },
        ],
      };

      const existingEntitlement = {
        id: "ent-existing",
        orderItemId: "item-1",
        status: EntitlementStatus.ACTIVE,
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(
        existingEntitlement,
      );

      const results = await service.issueEntitlementsForOrder("order-1");

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(existingEntitlement);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("Customer ownership: getUserEntitlement", () => {
    it("returns entitlement when requested by owner", async () => {
      const mockEntitlement = {
        id: "ent-1",
        userId: "user-alice",
        orderId: "ord-1",
        orderItemId: "item-1",
        productId: "p-1",
        variantId: "v-1",
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        status: EntitlementStatus.ACTIVE,
        quantity: 1,
        activatedAt: new Date(),
        expiresAt: null,
        revokedAt: null,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(
        mockEntitlement,
      );

      const result = await service.getUserEntitlement("user-alice", "ent-1");
      expect(result.id).toBe("ent-1");
      expect(result.userId).toBe("user-alice");
    });

    it("throws NotFoundException when user does not own the entitlement (enumeration prevention)", async () => {
      const mockEntitlement = {
        id: "ent-1",
        userId: "user-alice",
      };

      (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(
        mockEntitlement,
      );

      await expect(
        service.getUserEntitlement("user-bob", "ent-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when entitlement does not exist", async () => {
      (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getUserEntitlement("user-alice", "ent-missing"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("Admin revocation: revokeEntitlement", () => {
    it("successfully revokes an active entitlement using CAS and logs audit", async () => {
      (prisma.entitlement.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue({
        id: "ent-1",
        userId: "user-1",
        orderId: "ord-1",
        orderItemId: "item-1",
        productId: "p-1",
        variantId: "v-1",
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        status: EntitlementStatus.REVOKED,
        quantity: 1,
        activatedAt: new Date(),
        expiresAt: null,
        revokedAt: new Date(),
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.revokeEntitlement(
        "ent-1",
        "admin-user",
        "Chargeback detected",
      );

      expect(result.status).toBe("REVOKED");
      expect(prisma.entitlement.updateMany).toHaveBeenCalledWith({
        where: { id: "ent-1", status: EntitlementStatus.ACTIVE },
        data: expect.objectContaining({ status: EntitlementStatus.REVOKED }),
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "ENTITLEMENT_REVOKED",
          entityId: "ent-1",
          actorId: "admin-user",
        }),
      });
    });

    it("throws ConflictException if entitlement is already in terminal state", async () => {
      (prisma.entitlement.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue({
        id: "ent-1",
        status: EntitlementStatus.REVOKED,
      });

      await expect(
        service.revokeEntitlement("ent-1", "admin-user", "Duplicate call"),
      ).rejects.toThrow(ConflictException);
    });

    it("throws NotFoundException if entitlement does not exist", async () => {
      (prisma.entitlement.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.revokeEntitlement("ent-missing", "admin-user"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("mapToDto", () => {
    it("maps typed rights correctly including maxActivations, updatesUntil, supportUntil", () => {
      const now = new Date();
      const updatesUntil = new Date(now.getTime() + 365 * 86400000);
      const supportUntil = new Date(now.getTime() + 180 * 86400000);

      const dto = service.mapToDto({
        id: "ent-1",
        userId: "user-1",
        orderId: "order-1",
        orderItemId: "item-1",
        productId: "prod-1",
        variantId: "var-1",
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        status: EntitlementStatus.ACTIVE,
        quantity: 1,
        activatedAt: now,
        expiresAt: null,
        revokedAt: null,
        maxActivations: 5,
        updatesUntil,
        supportUntil,
        metadata: { sku: "SKU-PRO" },
        createdAt: now,
        updatedAt: now,
      } as any);

      expect(dto.maxActivations).toBe(5);
      expect(dto.updatesUntil).toBe(updatesUntil.toISOString());
      expect(dto.supportUntil).toBe(supportUntil.toISOString());
      expect(dto.expiresAt).toBeNull();
    });
  });
});
