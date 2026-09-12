import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@nexus/database";
import {
  AuthIdentity,
  AuthUser,
  RoleDetail,
  PermissionDetail,
  AdminUserListItem,
} from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class UsersService {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Idempotently provision or retrieve an authenticated user from an external identity.
   */
  async getOrProvisionUser(
    identity: AuthIdentity,
    reqContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthUser> {
    if (!identity || !identity.subject) {
      throw new BadRequestException("Identity subject is required");
    }

    // 1. Check if user already exists by external Supabase ID
    let user = await prisma.user.findUnique({
      where: { supabaseId: identity.subject },
      include: {
        profile: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // 2. If not found by supabaseId, check if email exists to link account
    if (!user && identity.email) {
      const existingByEmail = await prisma.user.findUnique({
        where: { email: identity.email },
        include: {
          profile: true,
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (existingByEmail) {
        user = await prisma.user.update({
          where: { id: existingByEmail.id },
          data: { supabaseId: identity.subject },
          include: {
            profile: true,
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });
      }
    }

    // 3. If still not found, provision new user, profile, and assign default "customer" role
    if (!user) {
      const customerRole = await prisma.role.findUnique({
        where: { name: "customer" },
      });

      user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            supabaseId: identity.subject,
            email: identity.email || `${identity.subject}@auth.nexus`,
          },
        });

        const displayName =
          identity.metadata?.name ||
          identity.metadata?.full_name ||
          (identity.email ? identity.email.split("@")[0] : "Customer");

        await tx.profile.create({
          data: {
            userId: newUser.id,
            displayName,
          },
        });

        if (customerRole) {
          await tx.userRole.create({
            data: {
              userId: newUser.id,
              roleId: customerRole.id,
              assignedBy: "system_provision",
            },
          });
        }

        return tx.user.findUniqueOrThrow({
          where: { id: newUser.id },
          include: {
            profile: true,
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });
      });

      // Audit log event
      await this.auditService.logAction({
        action: "USER_PROVISIONED",
        entity: "User",
        entityId: user.id,
        actorId: user.id,
        details: {
          email: user.email,
          supabaseId: user.supabaseId,
          assignedRole: "customer",
        },
        ipAddress: reqContext?.ipAddress,
        userAgent: reqContext?.userAgent,
      });
    }

    return this.buildAuthUser(user);
  }

  /**
   * Helper to format DB user to AuthUser contracts representation
   */
  private async buildAuthUser(user: any): Promise<AuthUser> {
    const roles = user.userRoles.map((ur: any) => ur.role.name);
    let permissions: string[] = [];

    // Super admin has all permissions
    if (roles.includes("super_admin")) {
      const allPerms = await prisma.permission.findMany({ select: { name: true } });
      permissions = allPerms.map((p) => p.name);
    } else {
      const permsSet = new Set<string>();
      for (const ur of user.userRoles) {
        for (const rp of ur.role.rolePermissions) {
          permsSet.add(rp.permission.name);
        }
      }
      permissions = Array.from(permsSet);
    }

    return {
      id: user.id,
      email: user.email,
      supabaseId: user.supabaseId,
      roles,
      permissions,
      profile: user.profile
        ? {
            id: user.profile.id,
            userId: user.profile.userId,
            displayName: user.profile.displayName,
            firstName: user.profile.firstName,
            lastName: user.profile.lastName,
            avatarUrl: user.profile.avatarUrl,
            bio: user.profile.bio,
          }
        : null,
    };
  }

  /**
   * List users for Admin Foundation
   */
  async listUsers(): Promise<AdminUserListItem[]> {
    const users = await prisma.user.findMany({
      include: {
        profile: true,
        userRoles: {
          include: {
            role: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      supabaseId: u.supabaseId,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      profile: u.profile
        ? {
            displayName: u.profile.displayName,
            firstName: u.profile.firstName,
            lastName: u.profile.lastName,
          }
        : null,
      roles: u.userRoles.map((ur) => ur.role.name),
    }));
  }

  /**
   * Get specific user by ID
   */
  async getUserById(id: string): Promise<AuthUser> {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return this.buildAuthUser(user);
  }

  /**
   * List all roles with their assigned permissions
   */
  async listRoles(): Promise<RoleDetail[]> {
    const roles = await prisma.role.findMany({
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      displayName: r.displayName,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.rolePermissions.map((rp) => rp.permission.name),
    }));
  }

  /**
   * List all system permissions
   */
  async listPermissions(): Promise<PermissionDetail[]> {
    const permissions = await prisma.permission.findMany({
      orderBy: { name: "asc" },
    });

    return permissions.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      module: p.module,
      description: p.description,
    }));
  }

  /**
   * Assign a role to a user with privilege escalation prevention & transaction
   */
  async assignRole(
    actor: AuthUser,
    targetUserId: string,
    roleName: string,
    reqContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthUser> {
    // 1. Prevent self privilege modification
    if (actor.id === targetUserId) {
      throw new ForbiddenException("Self privilege modification is not allowed");
    }

    // 2. Validate target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException(`Target user with ID ${targetUserId} not found`);
    }

    // 3. Validate role exists
    const role = await prisma.role.findUnique({
      where: { name: roleName },
    });
    if (!role) {
      throw new BadRequestException(`Role '${roleName}' does not exist`);
    }

    // 4. Privilege escalation checks
    const actorIsSuperAdmin = actor.roles.includes("super_admin");
    if (roleName === "super_admin" && !actorIsSuperAdmin) {
      throw new ForbiddenException(
        "Only super administrators can assign the super_admin role",
      );
    }
    if (roleName === "admin" && !actorIsSuperAdmin) {
      throw new ForbiddenException(
        "Only super administrators can assign the admin role",
      );
    }

    // 5. Transaction: upsert UserRole + audit log
    await prisma.$transaction(async (tx) => {
      await tx.userRole.upsert({
        where: {
          userId_roleId: {
            userId: targetUserId,
            roleId: role.id,
          },
        },
        update: {},
        create: {
          userId: targetUserId,
          roleId: role.id,
          assignedBy: actor.id,
        },
      });
    });

    await this.auditService.logAction({
      action: "ROLE_ASSIGNED",
      entity: "User",
      entityId: targetUserId,
      actorId: actor.id,
      details: {
        role: roleName,
        assignedBy: actor.id,
      },
      ipAddress: reqContext?.ipAddress,
      userAgent: reqContext?.userAgent,
    });

    return this.getUserById(targetUserId);
  }

  /**
   * Remove a role from a user with privilege escalation prevention & transaction
   */
  async removeRole(
    actor: AuthUser,
    targetUserId: string,
    roleName: string,
    reqContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthUser> {
    // 1. Prevent self privilege modification
    if (actor.id === targetUserId) {
      throw new ForbiddenException("Self privilege modification is not allowed");
    }

    // 2. Validate target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException(`Target user with ID ${targetUserId} not found`);
    }

    // 3. Validate role exists
    const role = await prisma.role.findUnique({
      where: { name: roleName },
    });
    if (!role) {
      throw new BadRequestException(`Role '${roleName}' does not exist`);
    }

    // 4. Privilege escalation checks
    const actorIsSuperAdmin = actor.roles.includes("super_admin");
    if (roleName === "super_admin" && !actorIsSuperAdmin) {
      throw new ForbiddenException(
        "Only super administrators can remove the super_admin role",
      );
    }

    // 5. Transaction: delete UserRole + audit log
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: {
          userId: targetUserId,
          roleId: role.id,
        },
      });
    });

    await this.auditService.logAction({
      action: "ROLE_REMOVED",
      entity: "User",
      entityId: targetUserId,
      actorId: actor.id,
      details: {
        role: roleName,
        removedBy: actor.id,
      },
      ipAddress: reqContext?.ipAddress,
      userAgent: reqContext?.userAgent,
    });

    return this.getUserById(targetUserId);
  }
}