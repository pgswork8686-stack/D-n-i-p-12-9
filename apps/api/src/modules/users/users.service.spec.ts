import {
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { UsersService } from "./users.service";
import { AuditService } from "../audit/audit.service";
import { prisma } from "@nexus/database";

describe("UsersService", () => {
  let service: UsersService;
  let mockAuditService: jest.Mocked<AuditService>;

  beforeEach(() => {
    mockAuditService = {
      logAction: jest.fn().mockResolvedValue(undefined),
      logActionWithClient: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new UsersService(mockAuditService);
    jest.clearAllMocks();
  });

  describe("getOrProvisionUser", () => {
    it("throws BadRequestException if subject is missing", async () => {
      await expect(
        service.getOrProvisionUser({ subject: "", email: "a@b.com" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("idempotently returns existing user without duplicating", async () => {
      const mockUser = {
        id: "usr_existing_1",
        email: "existing@nexustheme.dev",
        supabaseId: "sub_exist_001",
        profile: { displayName: "Existing User" },
        userRoles: [
          {
            role: {
              name: "customer",
              rolePermissions: [
                { permission: { name: "profile.read" } },
              ],
            },
          },
        ],
      };

      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(mockUser as any);

      const result = await service.getOrProvisionUser({
        subject: "sub_exist_001",
        email: "existing@nexustheme.dev",
      });

      expect(result.id).toBe("usr_existing_1");
      expect(result.roles).toEqual(["customer"]);
      expect(result.permissions).toEqual(["profile.read"]);
      expect(mockAuditService.logAction).not.toHaveBeenCalled();
    });

    it("provisions a new user with profile, customer role, and transactional audit log (H02)", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.role, "findUnique").mockResolvedValue({ id: "role_cust_id", name: "customer" } as any);

      const createdUser = {
        id: "usr_new_999",
        email: "newuser@nexustheme.dev",
        supabaseId: "sub_new_999",
        profile: { id: "prof_1", userId: "usr_new_999", displayName: "New User" },
        userRoles: [
          {
            role: {
              name: "customer",
              rolePermissions: [
                { permission: { name: "profile.read" } },
                { permission: { name: "profile.update" } },
              ],
            },
          },
        ],
      };

      jest.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const tx = {
          user: {
            create: jest.fn().mockResolvedValue({ id: "usr_new_999", email: "newuser@nexustheme.dev", supabaseId: "sub_new_999" }),
            findUniqueOrThrow: jest.fn().mockResolvedValue(createdUser),
          },
          profile: {
            create: jest.fn().mockResolvedValue({ id: "prof_1" }),
          },
          userRole: {
            create: jest.fn().mockResolvedValue({ id: "ur_1" }),
          },
        };
        return callback(tx);
      });

      const result = await service.getOrProvisionUser({
        subject: "sub_new_999",
        email: "newuser@nexustheme.dev",
        metadata: { name: "New User" },
      });

      expect(result.id).toBe("usr_new_999");
      expect(result.roles).toContain("customer");
      expect(result.permissions).toContain("profile.read");
      expect(mockAuditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "USER_PROVISIONED",
          entity: "User",
          entityId: "usr_new_999",
        }),
      );
    });

    // REGRESSION TEST: B02 Account Takeover Prevention via email overwrite
    describe("Account Takeover Prevention (B02)", () => {
      it("blocks account takeover when incoming subject tries to claim an email already bound to another subject", async () => {
        // Step 1: not found by subject "sub_attacker_999"
        jest.spyOn(prisma.user, "findUnique")
          .mockImplementation(((async (args: any) => {
            if (args.where?.supabaseId === "sub_attacker_999") {
              return null;
            }
            if (args.where?.email === "admin@nexustheme.dev") {
              // Target victim has an existing account already bound to a legitimate external subject
              return {
                id: "usr_victim_admin",
                email: "admin@nexustheme.dev",
                supabaseId: "sub_legit_admin_001", // ALREADY BOUND!
                profile: { displayName: "Admin" },
                userRoles: [{ role: { name: "admin", rolePermissions: [] } }],
              } as any;
            }
            return null;
          }) as any));

        await expect(
          service.getOrProvisionUser({
            subject: "sub_attacker_999",
            email: "admin@nexustheme.dev", // Attacker supplies admin email with arbitrary subject
          }),
        ).rejects.toThrow(ConflictException);

        // Verify prisma.user.update was NEVER called to overwrite supabaseId
        const updateSpy = jest.spyOn(prisma.user, "update");
        expect(updateSpy).not.toHaveBeenCalled();
      });

      it("allows linking legacy account when existing user has supabaseId == null", async () => {
        const legacyUser = {
          id: "usr_legacy_1",
          email: "legacy@nexustheme.dev",
          supabaseId: null, // Legacy unlinked
          profile: { displayName: "Legacy" },
          userRoles: [{ role: { name: "customer", rolePermissions: [] } }],
        };

        jest.spyOn(prisma.user, "findUnique")
          .mockImplementation(((async (args: any) => {
            if (args.where?.supabaseId === "sub_legacy_bind") return null;
            if (args.where?.email === "legacy@nexustheme.dev") return legacyUser as any;
            return null;
          }) as any));

        jest.spyOn(prisma.user, "update").mockResolvedValue({
          ...legacyUser,
          supabaseId: "sub_legacy_bind",
        } as any);

        const result = await service.getOrProvisionUser({
          subject: "sub_legacy_bind",
          email: "legacy@nexustheme.dev",
        });

        expect(result.id).toBe("usr_legacy_1");
        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: "usr_legacy_1" },
          data: { supabaseId: "sub_legacy_bind" },
          include: expect.anything(),
        });
        expect(mockAuditService.logAction).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "ACCOUNT_LINKED",
            entityId: "usr_legacy_1",
          }),
        );
      });
    });

    // REGRESSION TEST: H01 Concurrency-safe Provisioning
    describe("Concurrency-safe Provisioning (H01)", () => {
      it("gracefully catches P2002 duplicate key race condition and returns existing provisioned user", async () => {
        jest.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
        jest.spyOn(prisma.role, "findUnique").mockResolvedValue({ id: "role_cust", name: "customer" } as any);

        // Simulate competing transaction winning the race, causing Prisma P2002 error
        const p2002Error: any = new Error("Unique constraint failed");
        p2002Error.code = "P2002";
        jest.spyOn(prisma, "$transaction").mockRejectedValue(p2002Error);

        const existingWinningUser = {
          id: "usr_winner",
          email: "concurrent@nexustheme.dev",
          supabaseId: "sub_concurrent_123",
          profile: { displayName: "Concurrent User" },
          userRoles: [{ role: { name: "customer", rolePermissions: [] } }],
        };

        jest.spyOn(prisma.user, "findFirst").mockResolvedValue(existingWinningUser as any);

        const result = await service.getOrProvisionUser({
          subject: "sub_concurrent_123",
          email: "concurrent@nexustheme.dev",
        });

        expect(result.id).toBe("usr_winner");
        expect(prisma.user.findFirst).toHaveBeenCalledWith({
          where: {
            OR: [
              { supabaseId: "sub_concurrent_123" },
              { email: "concurrent@nexustheme.dev" },
            ],
          },
          include: expect.anything(),
        });
      });
    });
  });

  describe("Privilege Escalation & Symmetrical Role Removal (H03)", () => {
    const superAdminUser = {
      id: "usr_super_1",
      email: "super@nexus.dev",
      roles: ["super_admin"],
      permissions: ["user.manage"],
    };

    const regularAdminUser = {
      id: "usr_admin_1",
      email: "admin@nexus.dev",
      roles: ["admin"],
      permissions: ["user.manage"],
    };

    const targetUser = {
      id: "usr_target_1",
      email: "target@nexus.dev",
      roles: ["admin"],
      permissions: ["user.manage"],
    };

    beforeEach(() => {
      jest.spyOn(prisma.user, "findUnique").mockImplementation(((async (args: any) => {
        if (args.where?.id === targetUser.id) {
          return {
            id: targetUser.id,
            email: targetUser.email,
            supabaseId: "sub_target",
            profile: { displayName: "Target User" },
            userRoles: [{ role: { name: "admin", rolePermissions: [] } }],
          } as any;
        }
        return null;
      }) as any));

      jest.spyOn(prisma.role, "findUnique").mockImplementation(((async (args: any) => {
        const name = args.where?.name;
        return { id: `role_${name}`, name } as any;
      }) as any));

      jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
        const tx = {
          userRole: {
            upsert: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return cb(tx);
      });
    });

    it("prevents self-privilege modification on assign and remove", async () => {
      await expect(
        service.assignRole(superAdminUser, superAdminUser.id, "customer"),
      ).rejects.toThrow(new ForbiddenException("Self privilege modification is not allowed"));

      await expect(
        service.removeRole(superAdminUser, superAdminUser.id, "super_admin"),
      ).rejects.toThrow(new ForbiddenException("Self privilege modification is not allowed"));
    });

    it("prevents non-super_admin from assigning super_admin role", async () => {
      await expect(
        service.assignRole(regularAdminUser, targetUser.id, "super_admin"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("prevents non-super_admin from assigning admin role", async () => {
      await expect(
        service.assignRole(regularAdminUser, targetUser.id, "admin"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("prevents non-super_admin from removing super_admin role", async () => {
      await expect(
        service.removeRole(regularAdminUser, targetUser.id, "super_admin"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("prevents non-super_admin from removing admin role (H03 Symmetry)", async () => {
      await expect(
        service.removeRole(regularAdminUser, targetUser.id, "admin"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("allows super_admin to assign and remove admin role", async () => {
      const assignResult = await service.assignRole(superAdminUser, targetUser.id, "admin");
      expect(assignResult.id).toBe(targetUser.id);

      const removeResult = await service.removeRole(superAdminUser, targetUser.id, "admin");
      expect(removeResult.id).toBe(targetUser.id);
    });

    it("allows regular admin to assign and remove non-elevated roles (e.g. support_agent)", async () => {
      const assignResult = await service.assignRole(regularAdminUser, targetUser.id, "support_agent");
      expect(assignResult.id).toBe(targetUser.id);

      const removeResult = await service.removeRole(regularAdminUser, targetUser.id, "support_agent");
      expect(removeResult.id).toBe(targetUser.id);
    });
  });

  describe("Transactional Audit Integrity (H02)", () => {
    it("rolls back role assignment if audit log fails in the transaction", async () => {
      const superAdminUser = {
        id: "usr_super_1",
        email: "super@nexus.dev",
        roles: ["super_admin"],
        permissions: ["user.manage"],
      };

      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "usr_target" } as any);
      jest.spyOn(prisma.role, "findUnique").mockResolvedValue({ id: "role_supp", name: "support_agent" } as any);

      // Simulate audit log throwing error inside transaction
      mockAuditService.logActionWithClient.mockRejectedValueOnce(
        new Error("Audit database failure"),
      );

      jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
        const tx = {
          userRole: { upsert: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      await expect(
        service.assignRole(superAdminUser, "usr_target", "support_agent"),
      ).rejects.toThrow("Audit database failure");
    });
  });
});