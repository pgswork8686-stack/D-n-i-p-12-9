import { ForbiddenException, NotFoundException, BadRequestException } from "@nestjs/common";
import { UsersService } from "./users.service";
import { AuditService } from "../audit/audit.service";
import { prisma } from "@nexus/database";

describe("UsersService", () => {
  let service: UsersService;
  let mockAuditService: jest.Mocked<AuditService>;

  beforeEach(() => {
    mockAuditService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new UsersService(mockAuditService);
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

    it("provisions a new user with profile, customer role, and audit log", async () => {
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
            create: jest.fn().mockResolvedValue({ id: "usr_new_999" }),
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
      expect(mockAuditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "USER_PROVISIONED",
          entity: "User",
          entityId: "usr_new_999",
        }),
      );
    });
  });

  describe("Privilege Escalation Prevention", () => {
    const regularAdminUser = {
      id: "usr_admin_1",
      email: "admin@nexus.dev",
      roles: ["admin"],
      permissions: ["user.manage"],
    };

    const customerUser = {
      id: "usr_cust_1",
      email: "cust@nexus.dev",
      roles: ["customer"],
      permissions: ["profile.read"],
    };

    it("prevents self-privilege modification", async () => {
      await expect(
        service.assignRole(regularAdminUser, "usr_admin_1", "super_admin"),
      ).rejects.toThrow(new ForbiddenException("Self privilege modification is not allowed"));

      await expect(
        service.removeRole(regularAdminUser, "usr_admin_1", "admin"),
      ).rejects.toThrow(new ForbiddenException("Self privilege modification is not allowed"));
    });

    it("prevents non-super_admin from assigning super_admin role", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "usr_target" } as any);
      jest.spyOn(prisma.role, "findUnique").mockResolvedValue({ id: "role_super", name: "super_admin" } as any);

      await expect(
        service.assignRole(regularAdminUser, "usr_target", "super_admin"),
      ).rejects.toThrow(new ForbiddenException("Only super administrators can assign the super_admin role"));
    });

    it("prevents non-super_admin from assigning admin role", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "usr_target" } as any);
      jest.spyOn(prisma.role, "findUnique").mockResolvedValue({ id: "role_admin", name: "admin" } as any);

      await expect(
        service.assignRole(customerUser, "usr_target", "admin"),
      ).rejects.toThrow(new ForbiddenException("Only super administrators can assign the admin role"));
    });

    it("prevents non-super_admin from removing super_admin role", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "usr_target" } as any);
      jest.spyOn(prisma.role, "findUnique").mockResolvedValue({ id: "role_super", name: "super_admin" } as any);

      await expect(
        service.removeRole(regularAdminUser, "usr_target", "super_admin"),
      ).rejects.toThrow(new ForbiddenException("Only super administrators can remove the super_admin role"));
    });
  });
});