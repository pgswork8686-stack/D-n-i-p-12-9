import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import { prisma } from "@nexus/database";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { AuditService } from "../audit/audit.service";

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,62}$/, { message: "slug chỉ gồm chữ thường, số và dấu gạch ngang" })
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(["ORGANIZATION", "CLIENT"])
  type!: "ORGANIZATION" | "CLIENT";

  @IsOptional()
  @IsUUID("4")
  parentId?: string;

  @IsOptional()
  @IsIn(["VND", "USD"])
  defaultCurrency?: "VND" | "USD";
}

export class AddTenantMemberDto {
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  email!: string;

  @IsEnum({ VIEWER: "VIEWER", ANALYST: "ANALYST", MANAGER: "MANAGER" })
  role!: "VIEWER" | "ANALYST" | "MANAGER";
}

/** Staff-only tenant administration (analytics.manage). */
@Controller(["admin/tenants", "v1/admin/tenants"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminTenantsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions("analytics.manage")
  async list() {
    return prisma.tenant.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, type: true, status: true, parentId: true, defaultCurrency: true, timezone: true, _count: { select: { members: true } } },
    });
  }

  @Post()
  @RequirePermissions("analytics.manage")
  async create(@Req() req: any, @Body() dto: CreateTenantDto) {
    if (dto.type === "ORGANIZATION" && dto.parentId) throw new ConflictException("ORGANIZATION không có tenant cha");
    if (dto.parentId) {
      const parent = await prisma.tenant.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.type !== "ORGANIZATION") throw new NotFoundException("Tenant cha phải là ORGANIZATION");
    }
    const exists = await prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (exists) throw new ConflictException("Slug đã tồn tại");
    const tenant = await prisma.tenant.create({
      data: { slug: dto.slug, name: dto.name, type: dto.type, parentId: dto.parentId ?? null, defaultCurrency: dto.defaultCurrency ?? "VND" },
    });
    await this.audit.logAction({ action: "TENANT_CREATED", entity: "Tenant", entityId: tenant.id, actorId: req.user.id, details: { slug: tenant.slug, type: tenant.type, parentId: tenant.parentId } });
    return tenant;
  }

  @Post(":id/members")
  @RequirePermissions("analytics.manage")
  async addMember(@Req() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AddTenantMemberDto) {
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException("Không tìm thấy tenant");
    const user = await prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user) throw new NotFoundException("Không tìm thấy người dùng với email này");
    const member = await prisma.tenantMember.upsert({
      where: { tenantId_userId: { tenantId: id, userId: user.id } },
      update: { role: dto.role },
      create: { tenantId: id, userId: user.id, role: dto.role },
    });
    await this.audit.logAction({ action: "TENANT_MEMBER_SET", entity: "Tenant", entityId: id, actorId: req.user.id, details: { userId: user.id, role: dto.role } });
    return member;
  }
}
