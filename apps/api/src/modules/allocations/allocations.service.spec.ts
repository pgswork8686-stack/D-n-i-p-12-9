import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AllocationsService } from "./allocations.service";
import { AuditService } from "../audit/audit.service";
import {
  requestDomainAllocation,
  adminActivateAllocation,
  adminRejectAllocation,
  requestAllocationDeactivation,
  adminConfirmDeactivated,
  adminUpdateProviderAccount,
  AllocationEngineError,
  prisma,
} from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    requestDomainAllocation: jest.fn(),
    adminActivateAllocation: jest.fn(),
    adminRejectAllocation: jest.fn(),
    requestAllocationDeactivation: jest.fn(),
    adminConfirmDeactivated: jest.fn(),
    adminUpdateProviderAccount: jest.fn(),
    prisma: {
      licenseProvider: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      providerAccount: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      licenseAllocation: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      entitlement: {
        findUnique: jest.fn(),
      },
    },
  };
});

describe("AllocationsService", () => {
  let service: AllocationsService;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    auditService = {
      logAction: jest.fn().mockResolvedValue({} as any),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllocationsService,
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<AllocationsService>(AllocationsService);
  });

  describe("requestAllocation", () => {
    it("delegates to requestDomainAllocation and maps result to CustomerAllocationDto", async () => {
      const mockAllocation = {
        id: "alloc-1",
        entitlementId: "ent-1",
        providerId: "prov-1",
        userId: "user-1",
        domain: "https://www.example.com/",
        normalizedDomain: "example.com",
        status: "PENDING" as const,
        requestedAt: new Date("2026-09-14T00:00:00.000Z"),
        activatedAt: null,
        deactivatedAt: null,
        createdAt: new Date("2026-09-14T00:00:00.000Z"),
      };

      (requestDomainAllocation as jest.Mock).mockResolvedValue(mockAllocation);
      (prisma.licenseProvider.findUnique as jest.Mock).mockResolvedValue({
        id: "prov-1",
        code: "ELEMENTOR",
      });

      const result = await service.requestAllocation("ent-1", "user-1", {
        domain: "https://www.example.com/",
      });

      expect(result.id).toBe("alloc-1");
      expect(result.domain).toBe("https://www.example.com/");
      expect(result.normalizedDomain).toBe("example.com");
      expect(result.status).toBe("PENDING");
      expect(result.providerCode).toBe("ELEMENTOR");
      expect(result.fulfillmentMode).toBe("MANUAL_EXTERNAL");
    });

    it("maps 403 AllocationEngineError to ForbiddenException", async () => {
      (requestDomainAllocation as jest.Mock).mockRejectedValue(
        new AllocationEngineError("Forbidden: You do not own this entitlement", 403),
      );

      await expect(
        service.requestAllocation("ent-1", "user-other", { domain: "example.com" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("maps 404 AllocationEngineError to NotFoundException", async () => {
      (requestDomainAllocation as jest.Mock).mockRejectedValue(
        new AllocationEngineError("Entitlement not found", 404),
      );

      await expect(
        service.requestAllocation("ent-missing", "user-1", { domain: "example.com" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("maps 409 AllocationEngineError to ConflictException", async () => {
      (requestDomainAllocation as jest.Mock).mockRejectedValue(
        new AllocationEngineError("Allocation capacity reached", 409),
      );

      await expect(
        service.requestAllocation("ent-1", "user-1", { domain: "example.com" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("adminActivateAllocation", () => {
    it("successfully activates allocation", async () => {
      const mockUpdated = {
        id: "alloc-1",
        entitlementId: "ent-1",
        providerId: "prov-1",
        providerAccountId: "pa-1",
        userId: "user-1",
        domain: "example.com",
        normalizedDomain: "example.com",
        status: "ACTIVE" as const,
        requestedAt: new Date("2026-09-14T00:00:00.000Z"),
        activatedAt: new Date("2026-09-14T01:00:00.000Z"),
        deactivatedAt: null,
        metadata: { adminActivationNotes: "Done upstream" },
        createdAt: new Date("2026-09-14T00:00:00.000Z"),
        updatedAt: new Date("2026-09-14T01:00:00.000Z"),
      };

      (adminActivateAllocation as jest.Mock).mockResolvedValue(mockUpdated);

      const result = await service.adminActivateAllocation(
        "alloc-1",
        { providerAccountId: "pa-1", notes: "Done upstream" },
        "admin-1",
      );

      expect(result.status).toBe("ACTIVE");
      expect(result.providerAccountId).toBe("pa-1");
      expect(result.activatedAt).toBe("2026-09-14T01:00:00.000Z");
    });

    it("throws ConflictException on exhausted capacity", async () => {
      (adminActivateAllocation as jest.Mock).mockRejectedValue(
        new AllocationEngineError(
          "Provider account capacity exhausted: total capacity is 10 (active: 10)",
          409,
        ),
      );

      await expect(
        service.adminActivateAllocation(
          "alloc-1",
          { providerAccountId: "pa-1" },
          "admin-1",
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("adminRejectAllocation", () => {
    it("successfully rejects allocation with reason", async () => {
      const mockUpdated = {
        id: "alloc-1",
        entitlementId: "ent-1",
        providerId: "prov-1",
        providerAccountId: null,
        userId: "user-1",
        domain: "example.com",
        normalizedDomain: "example.com",
        status: "REJECTED" as const,
        requestedAt: new Date("2026-09-14T00:00:00.000Z"),
        activatedAt: null,
        deactivatedAt: null,
        metadata: { rejectionReason: "Invalid site" },
        createdAt: new Date("2026-09-14T00:00:00.000Z"),
        updatedAt: new Date("2026-09-14T01:00:00.000Z"),
      };

      (adminRejectAllocation as jest.Mock).mockResolvedValue(mockUpdated);

      const result = await service.adminRejectAllocation(
        "alloc-1",
        { reason: "Invalid site" },
        "admin-1",
      );

      expect(result.status).toBe("REJECTED");
    });
  });

  describe("deactivation lifecycle", () => {
    it("transitions ACTIVE -> DEACTIVATION_PENDING on customer request", async () => {
      (prisma.licenseAllocation.findUnique as jest.Mock).mockResolvedValue({
        id: "alloc-1",
        entitlementId: "ent-1",
        provider: { code: "ELEMENTOR" },
      });

      const mockUpdated = {
        id: "alloc-1",
        entitlementId: "ent-1",
        userId: "user-1",
        domain: "example.com",
        normalizedDomain: "example.com",
        status: "DEACTIVATION_PENDING" as const,
        requestedAt: new Date("2026-09-14T00:00:00.000Z"),
        activatedAt: new Date("2026-09-14T01:00:00.000Z"),
        deactivatedAt: null,
        createdAt: new Date("2026-09-14T00:00:00.000Z"),
      };

      (requestAllocationDeactivation as jest.Mock).mockResolvedValue(mockUpdated);

      const result = await service.customerRequestDeactivation(
        "ent-1",
        "alloc-1",
        "user-1",
        { reason: "Changing domain" },
      );

      expect(result.status).toBe("DEACTIVATION_PENDING");
    });

    it("transitions DEACTIVATION_PENDING -> DEACTIVATED on admin confirmation", async () => {
      const mockUpdated = {
        id: "alloc-1",
        entitlementId: "ent-1",
        providerId: "prov-1",
        providerAccountId: "pa-1",
        userId: "user-1",
        domain: "example.com",
        normalizedDomain: "example.com",
        status: "DEACTIVATED" as const,
        requestedAt: new Date("2026-09-14T00:00:00.000Z"),
        activatedAt: new Date("2026-09-14T01:00:00.000Z"),
        deactivatedAt: new Date("2026-09-14T02:00:00.000Z"),
        metadata: { adminDeactivationNotes: "Removed from Elementor dashboard" },
        createdAt: new Date("2026-09-14T00:00:00.000Z"),
        updatedAt: new Date("2026-09-14T02:00:00.000Z"),
      };

      (adminConfirmDeactivated as jest.Mock).mockResolvedValue(mockUpdated);

      const result = await service.adminConfirmDeactivated(
        "alloc-1",
        { notes: "Removed from Elementor dashboard" },
        "admin-1",
      );

      expect(result.status).toBe("DEACTIVATED");
      expect(result.deactivatedAt).toBe("2026-09-14T02:00:00.000Z");
    });
  });

  describe("provider accounts & security", () => {
    it("rejects provider account creation with secret in metadata", async () => {
      await expect(
        service.adminCreateProviderAccount(
          {
            providerId: "prov-1",
            name: "Test PA",
            totalCapacity: 5,
            metadata: { apiToken: "super-secret" },
          },
          "admin-1",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects provider account creation with nested password in metadata", async () => {
      await expect(
        service.adminCreateProviderAccount(
          {
            providerId: "prov-1",
            name: "Test PA",
            totalCapacity: 5,
            metadata: { upstream: { password: "secret" } },
          },
          "admin-1",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("delegates adminUpdateProviderAccount to domain engine and maps result", async () => {
      (adminUpdateProviderAccount as jest.Mock).mockResolvedValue({
        account: {
          id: "pa-1",
          providerId: "prov-1",
          name: "Updated PA",
          externalReference: "EXT-1",
          totalCapacity: 10,
          status: "ACTIVE",
          metadata: { env: "prod" },
          createdAt: new Date("2026-09-14T00:00:00.000Z"),
          updatedAt: new Date("2026-09-14T01:00:00.000Z"),
        },
        consumedCount: 3,
        availableCapacity: 7,
      });

      const result = await service.adminUpdateProviderAccount(
        "pa-1",
        { name: "Updated PA", totalCapacity: 10 },
        "admin-1",
      );

      expect(result.id).toBe("pa-1");
      expect(result.totalCapacity).toBe(10);
      expect(result.activeAllocationsCount).toBe(3);
      expect(result.availableCapacity).toBe(7);
    });
  });
});
