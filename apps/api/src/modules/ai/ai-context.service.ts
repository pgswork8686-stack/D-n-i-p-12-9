import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@nexus/database";
import { ContextValidationError, hashContextContent, mergeContextLayers, normalizeContextContent } from "@nexus/ai-core";
import type { AiContextContent, AiContextDto, AiContextVersionDto } from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import { AccessibleTenant, AuthUser, TenantAccessService } from "../tenants/tenant-access.service";
import { CreateContextVersionDto } from "./ai.dto";

export const CONTEXT_KEY = "marketing";

/**
 * Versioned AI context (SYSTEM → ORGANIZATION → CLIENT). Versions are append-only (DB trigger);
 * a new version requires a change reason and the base version the editor started from, so two
 * concurrent edits cannot silently overwrite each other (409 instead).
 */
@Injectable()
export class AiContextService {
  constructor(
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditService,
  ) {}

  private versionDto(v: any): AiContextVersionDto {
    return { id: v.id, version: v.version, content: v.content as AiContextContent, contentHash: v.contentHash, changeReason: v.changeReason, createdById: v.createdById, createdAt: v.createdAt.toISOString() };
  }

  private async contextDto(ctx: any): Promise<AiContextDto> {
    const current = ctx.currentVersion > 0 ? await prisma.aiContextVersion.findUnique({ where: { contextId_version: { contextId: ctx.id, version: ctx.currentVersion } } }) : null;
    return { id: ctx.id, scope: ctx.scope, tenantId: ctx.tenantId, key: ctx.key, currentVersion: ctx.currentVersion, current: current ? this.versionDto(current) : null, updatedAt: ctx.updatedAt.toISOString() };
  }

  /** Context chain for a tenant: SYSTEM, its ORGANIZATION (if any) and the tenant itself. */
  async chain(tenant: Pick<AccessibleTenant, "id" | "type" | "parentId">) {
    const orgId = tenant.type === "ORGANIZATION" ? tenant.id : tenant.parentId;
    const [system, org, client] = await Promise.all([
      prisma.aiContext.findFirst({ where: { scope: "SYSTEM", tenantId: null, key: CONTEXT_KEY } }),
      orgId ? prisma.aiContext.findFirst({ where: { scope: "ORGANIZATION", tenantId: orgId, key: CONTEXT_KEY } }) : null,
      tenant.type === "CLIENT" ? prisma.aiContext.findFirst({ where: { scope: "CLIENT", tenantId: tenant.id, key: CONTEXT_KEY } }) : null,
    ]);
    return { SYSTEM: system, ORGANIZATION: org, CLIENT: client };
  }

  /** Merged effective context plus the exact versions used (recorded on every execution). */
  async resolveForExecution(tenant: AccessibleTenant) {
    const chain = await this.chain(tenant);
    const versions: Record<string, { contextId: string; version: number } | null> = {};
    const layers: AiContextContent[] = [];
    for (const scope of ["SYSTEM", "ORGANIZATION", "CLIENT"] as const) {
      const ctx = chain[scope];
      if (!ctx || ctx.currentVersion === 0) {
        versions[scope] = null;
        continue;
      }
      const v = await prisma.aiContextVersion.findUnique({ where: { contextId_version: { contextId: ctx.id, version: ctx.currentVersion } } });
      versions[scope] = { contextId: ctx.id, version: ctx.currentVersion };
      if (v) layers.push(v.content as AiContextContent);
    }
    return { merged: mergeContextLayers(layers), versions };
  }

  async listForTenant(user: AuthUser, tenantId: string): Promise<AiContextDto[]> {
    const tenant = await this.tenants.assertAccess(user, tenantId);
    const chain = await this.chain(tenant);
    const out: AiContextDto[] = [];
    for (const ctx of [chain.SYSTEM, chain.ORGANIZATION, chain.CLIENT]) if (ctx) out.push(await this.contextDto(ctx));
    return out;
  }

  async versions(user: AuthUser, contextId: string): Promise<AiContextVersionDto[]> {
    const ctx = await prisma.aiContext.findUnique({ where: { id: contextId } });
    if (!ctx) throw new NotFoundException("Không tìm thấy context");
    if (ctx.tenantId) await this.tenants.assertAccess(user, ctx.tenantId);
    const rows = await prisma.aiContextVersion.findMany({ where: { contextId }, orderBy: { version: "desc" }, take: 100 });
    return rows.map((v) => this.versionDto(v));
  }

  async createVersion(user: AuthUser, dto: CreateContextVersionDto): Promise<AiContextDto> {
    const tenant = await this.tenants.assertAccess(user, dto.tenantId);
    if ((dto.scope === "ORGANIZATION") !== (tenant.type === "ORGANIZATION")) {
      throw new BadRequestException(`Tenant loại ${tenant.type} không nhận context phạm vi ${dto.scope}`);
    }
    const role = await this.tenants.roleOn(user, tenant);
    if (role !== "MANAGER" && role !== "ANALYST" && role !== "STAFF") throw new ForbiddenException("Cần vai trò ANALYST hoặc MANAGER trên tenant để sửa context");

    let content: AiContextContent;
    try {
      content = normalizeContextContent(dto.content);
    } catch (err) {
      if (err instanceof ContextValidationError) throw new BadRequestException(err.message);
      throw err;
    }
    const contentHash = hashContextContent(content);

    const created = await prisma.$transaction(async (tx) => {
      let ctx = await tx.aiContext.findFirst({ where: { scope: dto.scope, tenantId: tenant.id, key: CONTEXT_KEY } });
      if (!ctx) {
        if (dto.baseVersion !== 0) throw new ConflictException("Context chưa tồn tại; baseVersion phải là 0");
        ctx = await tx.aiContext.create({ data: { scope: dto.scope, tenantId: tenant.id, key: CONTEXT_KEY, currentVersion: 0 } });
      }
      // Serialize concurrent editors of the same context.
      await tx.$queryRaw`SELECT id FROM ai_contexts WHERE id = ${ctx.id} FOR UPDATE`;
      const locked = await tx.aiContext.findUniqueOrThrow({ where: { id: ctx.id } });
      if (locked.currentVersion !== dto.baseVersion) {
        throw new ConflictException(`Context đã được cập nhật lên phiên bản ${locked.currentVersion}; hãy tải lại trước khi lưu`);
      }
      if (locked.currentVersion > 0) {
        const current = await tx.aiContextVersion.findUnique({ where: { contextId_version: { contextId: ctx.id, version: locked.currentVersion } } });
        if (current?.contentHash === contentHash) throw new BadRequestException("Nội dung không thay đổi so với phiên bản hiện tại");
      }
      const version = locked.currentVersion + 1;
      await tx.aiContextVersion.create({ data: { contextId: ctx.id, version, content: content as any, contentHash, changeReason: dto.changeReason.trim(), createdById: user.id } });
      const updated = await tx.aiContext.update({ where: { id: ctx.id }, data: { currentVersion: version } });
      await this.audit.logActionWithClient(tx, {
        action: "AI_CONTEXT_VERSION_CREATED",
        entity: "AiContext",
        entityId: ctx.id,
        actorId: user.id,
        details: { tenantId: tenant.id, scope: dto.scope, version, contentHash, changeReason: dto.changeReason.trim().slice(0, 300) },
      });
      return updated;
    });
    return this.contextDto(created);
  }
}
