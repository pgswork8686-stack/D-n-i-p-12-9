import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@nexus/database";

export interface AuthUser {
  id: string;
  roles?: string[];
  permissions?: string[];
}

export interface AccessibleTenant {
  id: string;
  slug: string;
  name: string;
  type: "ORGANIZATION" | "CLIENT";
  parentId: string | null;
  defaultCurrency: string;
  timezone: string;
}

/**
 * Phase 19 — server-side tenant isolation for analytics and AI.
 *
 * A user can access a tenant when they are a member of it, or a member of its parent
 * ORGANIZATION. Platform staff with `analytics.manage` (and super_admin) can access every tenant.
 * A tenant the user cannot access is reported as 404 (same as a non-existent id) so tenant ids
 * cannot be enumerated. Frontends never filter by tenant themselves: every query takes the
 * tenant returned by this service.
 */
@Injectable()
export class TenantAccessService {
  isStaff(user: AuthUser): boolean {
    return Boolean(user.roles?.includes("super_admin") || user.permissions?.includes("analytics.manage"));
  }

  private readonly select = { id: true, slug: true, name: true, type: true, parentId: true, defaultCurrency: true, timezone: true } as const;

  async listAccessible(user: AuthUser, type?: "ORGANIZATION" | "CLIENT"): Promise<AccessibleTenant[]> {
    const where: any = { status: "ACTIVE", ...(type ? { type } : {}) };
    if (!this.isStaff(user)) {
      where.OR = [{ members: { some: { userId: user.id } } }, { parent: { members: { some: { userId: user.id } } } }];
    }
    return prisma.tenant.findMany({ where, select: this.select, orderBy: { name: "asc" } }) as Promise<AccessibleTenant[]>;
  }

  /** Returns the tenant when the user may access it; otherwise 404. */
  async assertAccess(user: AuthUser, tenantId: string, opts: { type?: "ORGANIZATION" | "CLIENT" } = {}): Promise<AccessibleTenant> {
    if (typeof tenantId !== "string" || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new NotFoundException("Không tìm thấy tenant");
    const tenant = (await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        status: "ACTIVE",
        ...(opts.type ? { type: opts.type } : {}),
        ...(this.isStaff(user)
          ? {}
          : { OR: [{ members: { some: { userId: user.id } } }, { parent: { members: { some: { userId: user.id } } } }] }),
      },
      select: this.select,
    })) as AccessibleTenant | null;
    if (!tenant) throw new NotFoundException("Không tìm thấy tenant");
    return tenant;
  }

  /** Membership role on the tenant (direct, or inherited from the parent organization). */
  async roleOn(user: AuthUser, tenant: AccessibleTenant): Promise<"VIEWER" | "ANALYST" | "MANAGER" | "STAFF" | null> {
    if (this.isStaff(user)) return "STAFF";
    const memberships = await prisma.tenantMember.findMany({
      where: { userId: user.id, tenantId: { in: [tenant.id, ...(tenant.parentId ? [tenant.parentId] : [])] } },
      select: { role: true },
    });
    const order = { VIEWER: 0, ANALYST: 1, MANAGER: 2 } as const;
    return memberships.reduce<"VIEWER" | "ANALYST" | "MANAGER" | null>((best, m) => (best === null || order[m.role] > order[best] ? m.role : best), null);
  }
}
