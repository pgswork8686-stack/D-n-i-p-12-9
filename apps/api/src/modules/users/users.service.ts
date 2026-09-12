import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
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

const USER_INCLUDE = {
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
} as const;

const ELEVATED_ROLES = ["admin", "super_admin"];

@Injectable()
export class UsersService {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Idempotently provision or retrieve an authenticated user from an external identity.
   * Concurrency-safe against race conditions (H01).
   * Prevents account-linking takeover through email overwrite (B02).
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
      include: USER_INCLUDE,
    });

    // 2. If not found by supabaseId, check if email exists to link account
    if (!user && identity.email) {
      const existingByEmail = await prisma.user.findUnique({
        where: { email: identity.email },
        include: USER_INCLUDE,
      });

      if (existingByEmail) {
        // SECURITY CHECK (B02):
        // If existing user already has a bound supabaseId and it is different from identity.subject,
        // this is an account takeover attempt or identity conflict. FAIL CLOSED.
        if (existingByEmail.supabaseId && existingByEmail.supabaseId !== identity.subject) {
          throw new ConflictException(
            `Account identity conflict: Email '${identity.email}' is already bound to another external identity`,
          );
        }

        // Only auto-link if existing account has NO bound supabaseId (legacy unlinked account)
        if (!existingByEmail.supabaseId) {
          user = await prisma.user.update({
            where: { id: existingByEmail.id },
            data: { supabaseId: identity.subject },
            include: USER_INCLUDE,
          });

          await this.auditService.logAction({
            action: "ACCOUNT_LINKED",
            entity: "User",
            entityId: user.id,
            actorId: user.id,
            details: {
              email: user.email,
              supabaseId: identity.subject,
            },
            ipAddress: reqContext?.ipAddress,
            userAgent: reqContext?.userAgent,
          });
        }
      }
    }

    // 3. If still not found, provision new user, profile, and assign default "customer" role
    if (!user) {
      const customerRole = await prisma.role.findUnique({
        where: { name: "customer" },
      });

      try {
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

          // Atomic audit log inside same transaction (H02)
          await this.auditService.logActionWithClient(tx, {
            action: "USER_PROVISIONED",
            entity: "User",
            entityId: newUser.id,
            actorId: newUser.id,
            details: {
              email: newUser.email,
              supabaseId: newUser.supabaseId,
              assignedRole: "customer",
            },
            ipAddress: reqContext?.ipAddress,
            userAgent: reqContext?.userAgent,
          });

          return tx.user.findUniqueOrThrow({
            where: { id: newUser.id },
            include: USER_INCLUDE,
          });
        });
      } catch (error: any) {
        // Concurrency handling (H01):
        // If competing concurrent request created the user first, Prisma raises P2002.
        // Catch P2002 and safely resolve the provisioned user.
        if (error?.code === "P2002") {
          user = await prisma.user.findFirst({
            where: {
              OR: [
                { supabaseId: identity.subject },
                identity.email ? { email: identity.email } : {},
              ],
            },
            include: USER_INCLUDE,
          });

          if (!user) {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    // Ensure Profile exists idempotently (e.g. legacy user edge case)
    if (!user.profile) {
      const displayName =
        identity.metadata?.name ||
        identity.metadata?.full_name ||
        (identity.email ? identity.email.split("@")[0] : "Customer");
      await prisma.profile.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, displayName },
      });
      user = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: USER_INCLUDE,
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
      include: USER_INCLUDE,
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
   * Assign a role to a user with privilege escalation prevention & atomic transaction (H02, H03)
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

    // 4. Privilege escalation checks (H03: Symmetrical elevated role policy)
    const actorIsSuperAdmin = actor.roles.includes("super_admin");
    if (ELEVATED_ROLES.includes(roleName) && !actorIsSuperAdmin) {
      throw new ForbiddenException(
        `Only super administrators can assign elevated roles (${ELEVATED_ROLES.join(", ")})`,
      );
    }

    // 5. Atomic Transaction: upsert UserRole + audit log (H02)
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

      // Atomic audit logging inside same transaction
      await this.auditService.logActionWithClient(tx, {
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
    });

    return this.getUserById(targetUserId);
  }

  /**
   * Remove a role from a user with privilege escalation prevention & atomic transaction (H02, H03)
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

    // 4. Privilege escalation checks (H03: Symmetrical elevated role removal policy)
    const actorIsSuperAdmin = actor.roles.includes("super_admin");
    if (ELEVATED_ROLES.includes(roleName) && !actorIsSuperAdmin) {
      throw new ForbiddenException(
        `Only super administrators can remove elevated roles (${ELEVATED_ROLES.join(", ")})`,
      );
    }

    // 5. Atomic Transaction: delete UserRole + audit log (H02)
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: {
          userId: targetUserId,
          roleId: role.id,
        },
      });

      // Atomic audit logging inside same transaction
      await this.auditService.logActionWithClient(tx, {
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
    });

    return this.getUserById(targetUserId);
  }
}