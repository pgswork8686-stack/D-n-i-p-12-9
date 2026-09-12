import {
  ForbiddenException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
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
              rolePermissions: [{ permission: { name: "profile.read" } }],
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
          role: {
            findUnique: jest.fn().mockResolvedValue({ id: "role_cust_id", name: "customer" }),
          },
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
        emailVerified: true,
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

    // 1. Same subject + concurrent requests -> 1 user, all requests resolve to same user
    it("handles concurrent requests for the same subject via P2002 catch and returns existing user (Regression 1)", async () => {
      let firstCheck = true;
      jest.spyOn(prisma.user, "findUnique").mockImplementation(((args: any) => {
        if (args?.where?.supabaseId === "sub_concurrent_123") {
          if (firstCheck) {
            firstCheck = false;
            return Promise.resolve(null); // Before race
          }
          // After race won by competing request
          return Promise.resolve({
            id: "usr_first_won",
            email: "concurrent@nexustheme.dev",
            supabaseId: "sub_concurrent_123",
            profile: { displayName: "Concurrent User" },
            userRoles: [{ role: { name: "customer", rolePermissions: [] } }],
          });
        }
        return Promise.resolve(null);
      }) as any);

      const p2002Error: any = new Error("Unique constraint failed");
      p2002Error.code = "P2002";
      jest.spyOn(prisma, "$transaction").mockRejectedValue(p2002Error);

      const result = await service.getOrProvisionUser({
        subject: "sub_concurrent_123",
        email: "concurrent@nexustheme.dev",
      });

      expect(result.id).toBe("usr_first_won");
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { supabaseId: "sub_concurrent_123" },
        include: expect.anything(),
      });
    });

    // 2. Different subject + same verified email concurrent -> no account crossover, one side conflicts (BLOCKER 1 & Regression 2)
    it("prevents account crossover on P2002 when different subject attempts to use same email (Regression 2)", async () => {
      // Incoming is Subject B
      jest.spyOn(prisma.user, "findUnique")
        .mockResolvedValueOnce(null) // Step 1: not found by subject B
        .mockResolvedValueOnce(null) // Step 2: not found by email initially in race
        .mockResolvedValueOnce(null) // Step 3 P2002 fallback 1: not found by subject B
        .mockResolvedValueOnce({
          id: "usr_subject_A",
          email: "shared@nexustheme.dev",
          supabaseId: "sub_subject_A", // Belongs to Subject A!
        } as any); // Step 3 P2002 fallback 2: email belongs to subject A

      const p2002Error: any = new Error("Unique constraint failed on email");
      p2002Error.code = "P2002";
      jest.spyOn(prisma, "$transaction").mockRejectedValue(p2002Error);

      // Subject B calls getOrProvisionUser with the same email
      await expect(
        service.getOrProvisionUser({
          subject: "sub_subject_B",
          email: "shared@nexustheme.dev",
          emailVerified: true,
        }),
      ).rejects.toThrow(ConflictException);
    });

    // 3. Legacy account + two subjects concurrent -> atomic conditional update ensures only one binds, other conflicts (BLOCKER 2 & Regression 3)
    it("handles legacy account concurrent linking atomically with conditional update (Regression 3)", async () => {
      const legacyUser = {
        id: "usr_legacy_target",
        email: "legacy@nexustheme.dev",
        supabaseId: null,
      };

      jest.spyOn(prisma.user, "findUnique")
        .mockResolvedValueOnce(null) // not found by subject B
        .mockResolvedValueOnce(legacyUser as any); // found by email (legacy)

      // Subject B's updateMany returns count: 0 because Subject A bound it right before
      jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
        const tx = {
          user: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              id: "usr_legacy_target",
              supabaseId: "sub_subject_A", // Already claimed by A
              profile: { displayName: "Legacy" },
              userRoles: [{ role: { name: "customer", rolePermissions: [] } }],
            }),
          },
        };
        return cb(tx);
      });

      await expect(
        service.getOrProvisionUser({
          subject: "sub_subject_B",
          email: "legacy@nexustheme.dev",
          emailVerified: true,
        }),
      ).rejects.toThrow(ConflictException);
    });

    // 4. Legacy account + unverified email -> does not auto-link, fails closed (BLOCKER 3 & Regression 4)
    it("rejects auto-linking legacy account if email is unverified (Regression 4)", async () => {
      jest.spyOn(prisma.user, "findUnique")
        .mockResolvedValueOnce(null) // not found by subject
        .mockResolvedValueOnce({
          id: "usr_legacy_1",
          email: "unverified@nexustheme.dev",
          supabaseId: null,
        } as any);

      await expect(
        service.getOrProvisionUser({
          subject: "sub_unverified_claimant",
          email: "unverified@nexustheme.dev",
          emailVerified: false, // NOT VERIFIED!
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockAuditService.logActionWithClient).not.toHaveBeenCalled();
    });

    // 5. Existing bound email + different subject -> 409 Conflict (Regression 5)
    it("blocks request when email is already bound to a different subject (Regression 5)", async () => {
      jest.spyOn(prisma.user, "findUnique")
        .mockResolvedValueOnce(null) // not found by attacker subject
        .mockResolvedValueOnce({
          id: "usr_victim_admin",
          email: "admin@nexustheme.dev",
          supabaseId: "sub_legit_admin_001", // Already bound!
          profile: { displayName: "Admin" },
          userRoles: [{ role: { name: "admin", rolePermissions: [] } }],
        } as any);

      await expect(
        service.getOrProvisionUser({
          subject: "sub_attacker_evil",
          email: "admin@nexustheme.dev",
          emailVerified: true,
        }),
      ).rejects.toThrow(ConflictException);
    });

    // 6. Identity without email -> provisioning succeeds without fake email (HIGH & Regression 6)
    it("provisions user without email cleanly when identity has no email (Regression 6)", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(null);

      const createdUserWithoutEmail = {
        id: "usr_no_email_1",
        email: null, // Nullable email
        supabaseId: "sub_no_email_1",
        profile: { id: "p1", userId: "usr_no_email_1", displayName: "User sub_no_e" },
        userRoles: [{ role: { name: "customer", rolePermissions: [] } }],
      };

      let capturedUserData: any = null;

      jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
        const tx = {
          role: { findUnique: jest.fn().mockResolvedValue({ id: "r_cust", name: "customer" }) },
          user: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedUserData = args.data;
              return Promise.resolve({ id: "usr_no_email_1", ...args.data });
            }),
            findUniqueOrThrow: jest.fn().mockResolvedValue(createdUserWithoutEmail),
          },
          profile: { create: jest.fn().mockResolvedValue({}) },
          userRole: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.getOrProvisionUser({
        subject: "sub_no_email_1",
        email: null, // No email provided
        emailVerified: false,
      });

      expect(result.id).toBe("usr_no_email_1");
      expect(result.email).toBeNull();
      expect(capturedUserData.email).toBeNull();
    });

    // 7. Customer role missing -> transaction rollback (HIGH & Regression 7)
    it("fails closed and rolls back transaction if customer role is missing from DB (Regression 7)", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(null);

      jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
        const tx = {
          role: { findUnique: jest.fn().mockResolvedValue(null) }, // Customer role NOT found!
          user: { create: jest.fn() },
          profile: { create: jest.fn() },
          userRole: { create: jest.fn() },
        };
        return cb(tx);
      });

      await expect(
        service.getOrProvisionUser({
          subject: "sub_new_orphan",
          email: "orphan@nexus.dev",
          emailVerified: true,
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    // 8. Audit failure during ACCOUNT_LINKED -> identity binding rollback (Regression 8)
    it("rolls back account linking transaction if audit logging fails (Regression 8)", async () => {
      jest.spyOn(prisma.user, "findUnique")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "usr_legacy_target",
          email: "legacy@nexustheme.dev",
          supabaseId: null,
        } as any);

      mockAuditService.logActionWithClient.mockRejectedValueOnce(
        new Error("Audit write failed during link"),
      );

      jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
        const tx = {
          user: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return cb(tx);
      });

      await expect(
        service.getOrProvisionUser({
          subject: "sub_binder_1",
          email: "legacy@nexustheme.dev",
          emailVerified: true,
        }),
      ).rejects.toThrow("Audit write failed during link");
    });
  });

  describe("Privilege Escalation & Symmetrical Role Removal (H03 & Regression 10)", () => {
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

  describe("Transactional Audit Integrity (H02 & Regression 9)", () => {
    it("rolls back role assignment if audit log fails in the transaction (Regression 9)", async () => {
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
        new Error("Audit database failure during role assignment"),
      );

      jest.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
        const tx = {
          userRole: { upsert: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      await expect(
        service.assignRole(superAdminUser, "usr_target", "support_agent"),
      ).rejects.toThrow("Audit database failure during role assignment");
    });
  });
});